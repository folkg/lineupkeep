import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LocalRun } from "@lineupkeep/tools/local-stack/contract.ts";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import * as Output from "alchemy/Output";
import { Effect, Layer, Redacted } from "effect";

import { migrate } from "#infra/migrations.ts";
import { HostDeployment } from "#infra/services/HostDeployment.ts";
import { assertVerificationStage, hostLayer, stageSpec } from "#infra/stage.ts";

import { Postgres, postgresProvider } from "./Postgres.ts";

export const verificationProviders = Layer.mergeAll(
  Cloudflare.providers(),
  Command.providers(),
  Docker.providers(),
  postgresProvider,
);

export const verificationStackName = "LineupkeepVerification";

export function verificationStack(
  run: LocalRun,
): ReturnType<typeof Alchemy.Stack<VerificationOutputs, VerificationRequirements>> {
  return Alchemy.Stack(
    verificationStackName,
    { providers: verificationProviders, state: Alchemy.localState() },
    Effect.gen(function* () {
      if (!(yield* AlchemyContext).dev) {
        return yield* Effect.die(new Error("Verification requires explicit Alchemy local mode"));
      }
      assertVerificationStage(run.stage, run.runId, run.databaseName);
      const database = yield* Postgres("Postgres", {
        name: run.databaseName,
        lockDirectory: run.lockDirectory,
      });
      const migrated = yield* migrate({ runtimeUrl: database.url, directUrl: database.url });
      const targetFile = join(run.directory, "application-upstream");
      const address = yield* Command.Dev("ApplicationAddress", {
        cwd: run.cwd,
        command: "node infra/local/loopbackRelay.ts",
        env: { RELAY_BIND: "127.0.0.1", RELAY_TARGET_FILE: targetFile },
      });
      const resend = yield* Command.Dev("Resend", {
        cwd: run.cwd,
        command: "node e2e/fakeResend.ts",
        env: {
          RESEND_API_KEY: Redacted.make(required(run.environment, "RESEND_API_KEY")),
          FAKE_RESEND_PORT: "0",
        },
      });
      const traces = yield* Command.Dev("Traces", {
        cwd: run.cwd,
        command: "node e2e/traceCollector.ts",
        env: { VERIFICATION_DIR: run.directory, OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:0" },
      });
      const environment = {
        ...run.environment,
        NODE_ENV: "production",
        DATABASE_URL: migrated.runtimeUrl,
        BETTER_AUTH_URL: Output.map(address.url, requireUrl),
        RESEND_API_BASE_URL: Output.map(resend.url, requireUrl),
        OTEL_EXPORTER_OTLP_ENDPOINT: Output.map(traces.url, requireUrl),
      };
      const programs = required(run.environment, "E2E_SERVICE_PROGRAMS");
      const stage = stageSpec(
        { node: "local", cloudflare: "local-cloudflare", container: "local-container" }[run.target],
      );
      const application = yield* HostDeployment.pipe(
        Effect.provide(
          hostLayer(stage, migrated, environment, {
            programs,
            ownership: { name: run.databaseName, lockDirectory: run.lockDirectory },
            inspector: run.environment["VERIFICATION_DIR"] !== undefined,
          }),
        ),
      );
      const publicUrl = Output.all(Output.asOutput(application.url), address.url).pipe(
        Output.mapEffect(([upstream, publicAddress]) =>
          Effect.promise(async () => {
            await writeFile(targetFile, requireUrl(upstream));
            return requireUrl(publicAddress);
          }),
        ),
      );
      return {
        database: Output.map(database.url, Redacted.value),
        application: publicUrl,
        email: Output.map(resend.url, requireUrl),
        traces: Output.map(traces.url, requireUrl),
      };
    }),
  );
}

function required(environment: Readonly<Record<string, string>>, name: string): string {
  const value = environment[name];
  if (value === undefined) {
    throw new Error(`Missing local configuration: ${name}`);
  }
  return value;
}

function requireUrl(url: string | undefined): string {
  if (url === undefined) {
    throw new Error("Local resource did not report its endpoint");
  }
  return url;
}

type VerificationOutputs = {
  readonly database: Alchemy.Input<string>;
  readonly application: Alchemy.Input<string>;
  readonly email: Alchemy.Input<string>;
  readonly traces: Alchemy.Input<string>;
};

type VerificationRequirements =
  | AlchemyContext
  | Layer.Success<typeof postgresProvider>
  | Layer.Services<ReturnType<typeof hostLayer>>;
