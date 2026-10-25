import { readFile } from "node:fs/promises";

import * as Command from "alchemy/Command";
import * as GCP from "alchemy/GCP";
import type { Input } from "alchemy/Input";
import * as Output from "alchemy/Output";
import { Stage } from "alchemy/Stage";
import { Config, Effect, Layer } from "effect";
import type { Redacted } from "effect";

import { buildNodeImage } from "#infra/build/node.ts";
import { HostDeployment } from "#infra/services/HostDeployment.ts";
import type { HostEnvironment } from "#infra/services/HostDeployment.ts";

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
      const account = yield* GCP.IAM.ServiceAccount("Runtime", {
        displayName: "Lineupkeep web runtime",
      });
      const { plain, secrets } = partitionEnvironment(environment);
      const secretEntries = yield* Effect.forEach(secrets, ([name, value]) =>
        runtimeSecret(name, value, account),
      );
      const image = yield* publishCloudRunImage(
        Output.map(registry.registryUri, (uri) => {
          if (uri === undefined) {
            throw new Error("Artifact Registry did not return a registry URI");
          }
          return uri;
        }),
        region,
      );
      const service = yield* GCP.Run.Service("Web", {
        location: region,
        ingress: "INGRESS_TRAFFIC_ALL",
        invokerIamDisabled: true,
        template: {
          ...cloudRunTemplate(),
          serviceAccount: account.email,
          containers: [
            {
              ...cloudRunContainer(),
              image,
              env: [
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
              ],
            },
          ],
        },
      });
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

function publishCloudRunImage(
  registry: Output.Output<string>,
  region: string,
): Effect.Effect<
  Output.Output<string>,
  never,
  | import("alchemy").Provider<Command.Build>
  | import("alchemy").Provider<Command.Exec>
  | import("alchemy/Docker/Providers").Providers
> {
  return Effect.gen(function* () {
    const build = yield* buildNodeImage();
    const image = Output.map(Output.all(registry, build.imageId), ([name, hash]) => {
      return `${name}/web:${hash.replace("sha256:", "")}`;
    });
    const published = yield* Command.Exec("PublishImage", {
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

function runtimeSecret(
  name: string,
  value: Input<string | Redacted.Redacted<string>>,
  account: GCP.IAM.ServiceAccount,
): Effect.Effect<
  {
    name: string;
    secret: GCP.SecretManager.Secret;
    version: Output.Output<string, never>;
  },
  never,
  import("alchemy").Provider<Command.Build> | GCP.Providers | Stage
> {
  return Effect.gen(function* () {
    const secret = yield* GCP.SecretManager.Secret(`Secret-${name}`, {});
    const access = yield* GCP.IAM.Member(`Access-${name}`, {
      kind: "secretmanager.secret",
      name: secret.name,
      role: "roles/secretmanager.secretAccessor",
      member: Output.map(account.email, (email) => `serviceAccount:${email}`),
    });
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
      timeout: "1 minute",
    });
    const version = Output.all(published.outdir, access.member).pipe(
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
