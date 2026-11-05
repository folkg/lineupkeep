import { readFile } from "node:fs/promises";

import * as Command from "alchemy/Command";
import * as GCP from "alchemy/GCP";
import type { Input } from "alchemy/Input";
import * as Output from "alchemy/Output";
import { Stage } from "alchemy/Stage";
import { Config, Effect, Layer, Option } from "effect";
import type { Redacted } from "effect";

import { buildHostedBrowserImage } from "#infra/build/hostedBrowser.ts";
import { buildNodeImage } from "#infra/build/node.ts";
import { HostDeployment } from "#infra/services/HostDeployment.ts";
import type { HostEnvironment } from "#infra/services/HostDeployment.ts";

const retainedSecretVersions = 1;

export function cloudRunHost(
  environment: HostEnvironment,
): Layer.Layer<
  HostDeployment,
  Config.ConfigError,
  | import("alchemy").Provider<Command.Build>
  | import("alchemy").Provider<Command.Exec>
  | import("alchemy/Docker/Providers").Providers
  | GCP.Providers
  | Stage
> {
  return Layer.effect(HostDeployment)(
    Effect.gen(function* () {
      const region = yield* Config.String("GCP_REGION");
      const registry = yield* GCP.ArtifactRegistry.Repository("Registry", {
        location: region,
        format: "DOCKER",
      });
      yield* Command.Exec("RegistryCleanupPolicy", {
        cwd: new URL("../../", import.meta.url).pathname,
        command: `gcloud artifacts repositories set-cleanup-policies "$REPOSITORY" --location="$LOCATION" --policy=infra/registryCleanupPolicy.json --no-dry-run --quiet`,
        shell: true,
        env: { REPOSITORY: registry.name, LOCATION: region },
        memo: { include: ["infra/registryCleanupPolicy.json"] },
        timeout: "1 minute",
      });
      const account = yield* GCP.IAM.ServiceAccount("Runtime", {
        displayName: "Lineupgrade web runtime",
      });
      const workerAccount = yield* GCP.IAM.ServiceAccount("WorkerRuntime", {
        displayName: "Lineupgrade private lineup worker",
      });
      const browserAccount = yield* GCP.IAM.ServiceAccount("HostedBrowserRuntime", {
        displayName: "Lineupgrade hosted browser runtime",
      });
      const project = yield* Config.String("GOOGLE_PROJECT_ID").pipe(
        Config.orElse(() => Config.String("GOOGLE_CLOUD_PROJECT")),
      );
      const telemetryEnvironment = [
        { name: "OTEL_TRACES_EXPORTER", value: "otlp" },
        { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "https://telemetry.googleapis.com" },
        { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
        { name: "OTEL_RESOURCE_ATTRIBUTES", value: `gcp.project_id=${project}` },
      ];
      const telemetryNames = new Set(telemetryEnvironment.map((entry) => entry.name));
      yield* Effect.forEach(
        [
          { id: "WebTelemetryWriter", account },
          { id: "WorkerTelemetryWriter", account: workerAccount },
        ],
        ({ id, account: writer }) =>
          GCP.IAM.Member(id, {
            kind: "project",
            name: project,
            role: "roles/telemetry.tracesWriter",
            member: Output.map(writer.email, (email) => `serviceAccount:${email}`),
          }),
      );
      const { plain, secrets } = partitionEnvironment(environment);
      const secretEntries = yield* Effect.forEach(secrets, ([name, value]) =>
        runtimeSecret(name, value, [
          { id: `Access-${name}`, account },
          { id: `Access-${name}-Worker`, account: workerAccount },
        ]),
      );
      const registryUri = Output.map(registry.registryUri, (uri) => {
        if (uri === undefined) {
          throw new Error("Artifact Registry did not return a registry URI");
        }
        return uri;
      });
      const descriptorKey = yield* Config.Redacted("HOSTED_BROWSER_DESCRIPTOR_KEY");
      const descriptorSecret = yield* runtimeSecret(
        "HOSTED_BROWSER_DESCRIPTOR_KEY",
        descriptorKey,
        [
          { id: "Access-HOSTED_BROWSER_DESCRIPTOR_KEY", account },
          { id: "Access-HOSTED_BROWSER_DESCRIPTOR_KEY-Browser", account: browserAccount },
        ],
      );
      const descriptorEnv = {
        name: "HOSTED_BROWSER_DESCRIPTOR_KEY",
        valueSource: {
          secretKeyRef: {
            secret: descriptorSecret.secret.name,
            version: descriptorSecret.version,
          },
        },
      };
      const image = yield* publishImage(
        "PublishImage",
        "web",
        yield* buildNodeImage(),
        registryUri,
        region,
      );
      const browserImage = yield* publishImage(
        "PublishHostedBrowserImage",
        "browser",
        yield* buildHostedBrowserImage(),
        registryUri,
        region,
      );
      const runtimeEnv = [
        ...plain.map(([name, value]) => ({ name, value })),
        ...secretEntries.map(({ name, secret, version }) => ({
          name,
          valueSource: {
            secretKeyRef: {
              secret: secret.name,
              version,
            },
          },
        })),
      ].filter((entry) => !telemetryNames.has(entry.name));
      const queueEnqueuer = yield* GCP.IAM.ServiceAccount("QueueEnqueuer", {
        displayName: "Lineupgrade queue enqueuer and scheduler invoker",
      });
      const queue = yield* GCP.CloudTasks.Queue("LineupWorkerQueue", {
        location: region,
        retryConfig: {
          maxAttempts: 5,
          minBackoff: "10s",
          maxBackoff: "300s",
          maxDoublings: 3,
        },
        rateLimits: { maxDispatchesPerSecond: 5, maxConcurrentDispatches: 4 },
      });
      const worker = yield* GCP.Run.Service("Worker", {
        location: region,
        ingress: "INGRESS_TRAFFIC_ALL",
        invokerIamDisabled: false,
        template: {
          timeout: "300s",
          maxInstanceRequestConcurrency: 2,
          scaling: { minInstanceCount: 0, maxInstanceCount: 2 },
          serviceAccount: workerAccount.email,
          containers: [
            {
              ...cloudRunContainer(),
              image,
              env: [
                ...runtimeEnv,
                ...telemetryEnvironment,
                { name: "LINEUP_WORKER_ENABLED", value: "true" },
              ],
            },
          ],
        },
      });
      const workerUrl = Output.map(worker.uri, (uri) => {
        if (uri === undefined) {
          throw new Error("Cloud Run did not return a worker URI");
        }
        return uri;
      });
      const alertEmail = yield* Config.option(Config.String("ALERT_EMAIL"));
      const alertChannel = Option.isSome(alertEmail)
        ? yield* GCP.Monitoring.NotificationChannel("LineupRunAlerts", {
            type: "email",
            displayName: "Lineupgrade lineup run alerts",
            labels: { email_address: alertEmail.value },
          })
        : undefined;
      yield* GCP.Monitoring.AlertPolicy("LineupRunFailures", {
        displayName: "Lineupgrade failed or uncertain lineup runs",
        combiner: "OR",
        severity: "ERROR",
        conditions: [
          {
            displayName: "Failed or uncertain lineup run",
            conditionMatchedLog: {
              filter:
                'resource.type="cloud_run_revision" AND jsonPayload.event.kind="lineup_run" AND jsonPayload.event.outcome=("failed" OR "uncertain")',
            },
          },
        ],
        ...(alertChannel === undefined ? {} : { notificationChannels: [alertChannel.name] }),
        alertStrategy: { notificationRateLimit: { period: "300s" } },
        documentation: {
          subject: "Lineupgrade lineup run needs attention",
          mimeType: "text/markdown",
          content:
            "A lineup run finished failed or uncertain. Find the `lineup_run` wide event, then follow its trace to the provider calls. The deployment runbook lists the queries and the support boundary.",
        },
      });
      yield* GCP.IAM.Member("WorkerInvoker", {
        kind: "run.service",
        name: worker.name,
        role: "roles/run.invoker",
        member: Output.map(queueEnqueuer.email, (email) => `serviceAccount:${email}`),
      });
      yield* GCP.IAM.Member("QueueEnqueuer", {
        kind: "cloudtasks.queue",
        name: queue.name,
        role: "roles/cloudtasks.enqueuer",
        member: Output.map(account.email, (email) => `serviceAccount:${email}`),
      });
      yield* GCP.IAM.Member("QueueActAs", {
        kind: "iam.serviceAccount",
        name: queueEnqueuer.name,
        role: "roles/iam.serviceAccountUser",
        member: Output.map(account.email, (email) => `serviceAccount:${email}`),
      });
      yield* GCP.CloudScheduler.Job("LineupTick", {
        location: region,
        schedule: "55 * * * *",
        timeZone: "UTC",
        attemptDeadline: "300s",
        retryConfig: {
          retryCount: 2,
          maxRetryDuration: "300s",
          maxDoublings: 2,
          minBackoffDuration: "30s",
          maxBackoffDuration: "300s",
        },
        httpTarget: {
          uri: Output.interpolate`${workerUrl}/api/internal/lineup-worker`,
          httpMethod: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "tick", limit: 50 }),
          oidcToken: {
            serviceAccountEmail: queueEnqueuer.email,
            audience: workerUrl,
          },
        },
      });
      const browser = yield* GCP.Run.Service("HostedBrowser", {
        serviceId: "lineupkeep-hb",
        location: region,
        ingress: "INGRESS_TRAFFIC_ALL",
        invokerIamDisabled: false,
        template: {
          ...hostedBrowserTemplate(),
          serviceAccount: browserAccount.email,
          containers: [
            {
              ...hostedBrowserContainer(),
              image: browserImage,
              env: [{ name: "NODE_ENV", value: "production" }, descriptorEnv],
            },
          ],
        },
      });
      const browserUrl = Output.map(browser.uri, (uri) => {
        if (uri === undefined) {
          throw new Error("Cloud Run did not return a hosted browser URI");
        }
        return uri;
      });
      yield* GCP.IAM.Member("HostedBrowserInvoker", {
        kind: "run.service",
        name: browser.name,
        role: "roles/run.invoker",
        member: Output.map(account.email, (email) => `serviceAccount:${email}`),
      });
      const service = yield* GCP.Run.Service("Web", {
        location: region,
        ingress: "INGRESS_TRAFFIC_ALL",
        invokerIamDisabled: true,
        template: {
          ...cloudRunTemplate(),
          serviceAccount: account.email,
          containers: [
            {
              ...webContainer(),
              image,
              env: [
                ...runtimeEnv,
                ...telemetryEnvironment,
                { name: "LINEUP_CLOUD_TASKS_QUEUE", value: queue.name },
                { name: "LINEUP_WORKER_URL", value: workerUrl },
                { name: "LINEUP_QUEUE_SERVICE_ACCOUNT", value: queueEnqueuer.email },
                { name: "HOSTED_BROWSER_URL", value: browserUrl },
                descriptorEnv,
              ],
            },
          ],
        },
      });
      yield* Effect.forEach(
        [...secretEntries, descriptorSecret],
        (secret) => pruneSecretVersions(secret, service.latestReadyRevision),
        { concurrency: 1 },
      );
      return {
        url: service.uri,
        healthUrl: service.uri,
        artifact: image,
      };
    }),
  );
}

export function partitionEnvironment(environment: HostEnvironment): {
  readonly plain: ReadonlyArray<readonly [string, string]>;
  readonly secrets: ReadonlyArray<readonly [string, Input<string | Redacted.Redacted<string>>]>;
} {
  const plain: [string, string][] = [];
  const secrets: [string, Input<string | Redacted.Redacted<string>>][] = [];
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string") {
      plain.push([name, value]);
    } else {
      secrets.push([name, value]);
    }
  }
  return { plain, secrets };
}

function cloudRunTemplate(): {
  timeout: string;
  maxInstanceRequestConcurrency: number;
  scaling: {
    minInstanceCount: number;
    maxInstanceCount: number;
  };
} {
  return {
    timeout: "300s",
    maxInstanceRequestConcurrency: 20,
    scaling: { minInstanceCount: 0, maxInstanceCount: 3 },
  };
}

export function hostedBrowserTemplate(): {
  timeout: string;
  maxInstanceRequestConcurrency: number;
  scaling: { minInstanceCount: number; maxInstanceCount: number };
} {
  return {
    timeout: "780s",
    maxInstanceRequestConcurrency: 1,
    scaling: { minInstanceCount: 0, maxInstanceCount: 2 },
  };
}

export function webContainer(): ReturnType<typeof cloudRunContainer> {
  const container = cloudRunContainer();
  return {
    ...container,
    startupProbe: { ...container.startupProbe, periodSeconds: 1, failureThreshold: 60 },
  };
}

export function hostedBrowserContainer(): ReturnType<typeof cloudRunContainer> {
  return {
    ports: [{ containerPort: 8080 }],
    env: [{ name: "NODE_ENV", value: "production" }],
    resources: { limits: { cpu: "1", memory: "2Gi" }, cpuIdle: true, startupCpuBoost: true },
    startupProbe: {
      httpGet: { path: "/healthz", port: 8080 },
      periodSeconds: 5,
      failureThreshold: 30,
    },
  };
}

export function cloudRunContainer(): {
  ports: {
    containerPort: number;
  }[];
  env: {
    name: string;
    value: string;
  }[];
  resources: {
    limits: {
      cpu: string;
      memory: string;
    };
    cpuIdle: boolean;
    startupCpuBoost: boolean;
  };
  startupProbe: {
    httpGet: {
      path: string;
      port: number;
    };
    periodSeconds: number;
    failureThreshold: number;
  };
} {
  return {
    ports: [{ containerPort: 8080 }],
    env: [
      { name: "HOST", value: "0.0.0.0" },
      { name: "NODE_ENV", value: "production" },
    ],
    resources: { limits: { cpu: "1", memory: "512Mi" }, cpuIdle: true, startupCpuBoost: true },
    startupProbe: { httpGet: { path: "/", port: 8080 }, periodSeconds: 5, failureThreshold: 12 },
  };
}

function publishImage(
  id: string,
  tag: string,
  build: import("alchemy/Docker").Image,
  registry: Output.Output<string>,
  region: string,
): Effect.Effect<
  Output.Output<string>,
  never,
  import("alchemy").Provider<Command.Exec> | import("alchemy/Docker/Providers").Providers
> {
  return Effect.gen(function* () {
    const image = Output.map(Output.all(registry, build.imageId), ([name, hash]) => {
      return `${name}/${tag}:${hash.replace("sha256:", "")}`;
    });
    const published = yield* Command.Exec(id, {
      cwd: new URL("../../", import.meta.url).pathname,
      command: `gcloud auth configure-docker ${region}-docker.pkg.dev --quiet && docker tag "$LOCAL_IMAGE" "$IMAGE" && docker push "$IMAGE"`,
      shell: true,
      env: { IMAGE: image, LOCAL_IMAGE: build.imageRef, E2E_TEST_COMPOSITION: "false" },
      memo: false,
      timeout: "15 minutes",
    });
    return Output.map(Output.all(image, published.hash.input), ([ref]) => ref);
  });
}

type RuntimeSecret = {
  readonly name: string;
  readonly secret: GCP.SecretManager.Secret;
  readonly version: Output.Output<string>;
};

function pruneSecretVersions(
  entry: RuntimeSecret,
  deployedRevision: Output.Output<string | undefined>,
): Effect.Effect<void, never, import("alchemy").Provider<Command.Exec>> {
  return Command.Exec(`Retain-${entry.name}-Version`, {
    cwd: new URL("../../", import.meta.url).pathname,
    command: [
      "set -e",
      'echo "retaining the newest $RETAINED_VERSIONS version(s) of $SECRET_NAME behind $DEPLOYED_REVISION"',
      'versions=$(gcloud secrets versions list "$SECRET_NAME" --filter="state!=DESTROYED" --format="value(name)" --sort-by=~createTime)',
      "count=0",
      "for version in $versions; do",
      "  count=$((count + 1))",
      '  if [ "$count" -gt "$RETAINED_VERSIONS" ]; then',
      '    gcloud secrets versions destroy "$SECRET_NAME/versions/$version" --quiet',
      "  fi",
      "done",
    ].join("\n"),
    shell: true,
    env: {
      SECRET_NAME: entry.secret.name,
      RETAINED_VERSIONS: String(retainedSecretVersions),
      DEPLOYED_REVISION: deployedRevision,
    },
    memo: false,
    timeout: "2 minutes",
  });
}

function runtimeSecret(
  name: string,
  value: Input<string | Redacted.Redacted<string>>,
  readers: ReadonlyArray<SecretReader>,
): Effect.Effect<
  RuntimeSecret,
  never,
  import("alchemy").Provider<Command.Build> | GCP.Providers | Stage
> {
  return Effect.gen(function* () {
    const secret = yield* GCP.SecretManager.Secret(`Secret-${name}`, {});
    const accesses = yield* Effect.forEach(readers, ({ id, account }) =>
      GCP.IAM.Member(id, {
        kind: "secretmanager.secret",
        name: secret.name,
        role: "roles/secretmanager.secretAccessor",
        member: Output.map(account.email, (email) => `serviceAccount:${email}`),
      }),
    );
    const directory = new URL(`../.alchemy/versions/${yield* Stage}/${name}/`, import.meta.url);

    const published = yield* Command.Build(`Version-${name}`, {
      command:
        'mkdir -p "$VERSION_DIRECTORY" && printf \'%s\' "$SECRET_VALUE" | gcloud secrets versions add "$SECRET_NAME" --data-file=- --quiet --format=\'value(name)\' > "$VERSION_FILE"',
      shell: true,
      env: {
        SECRET_NAME: secret.name,
        SECRET_VALUE: value,
        VERSION_DIRECTORY: directory.pathname,
        VERSION_FILE: new URL("version", directory).pathname,
      },
      outdir: directory.pathname,
      memo: { include: [] },
      timeout: "1 minute",
    });
    const version = Output.all(published.outdir, ...accesses.map((access) => access.member)).pipe(
      Output.mapEffect(() =>
        Effect.promise(async () => {
          const resourceName = await readFile(new URL("version", directory), "utf8");
          const number = resourceName.trim().match(/\/versions\/([1-9]\d*)$/)?.[1];
          if (number === undefined) {
            throw new Error("Secret Manager did not return an immutable version identity");
          }
          return number;
        }),
      ),
    );
    return { name, secret, version };
  });
}

type SecretReader = {
  readonly id: string;
  readonly account: GCP.IAM.ServiceAccount;
};
