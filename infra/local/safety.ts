import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { LocalEndpointsSchema, LocalRunSchema } from "@lineupkeep/tools/local-stack/contract.ts";
import type { LocalRun } from "@lineupkeep/tools/local-stack/contract.ts";
import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Output from "alchemy/Output";
import * as Core from "alchemy/Test/Core";
import { Effect, Layer, Redacted, Schema } from "effect";

import { localPostgres } from "#infra/database/localPostgres.ts";
import { migrate } from "#infra/migrations.ts";
import { DatabaseDeployment } from "#infra/services/DatabaseDeployment.ts";

import {
  DevelopmentPostgres,
  developmentPostgresProvider,
  resetDevelopmentDatabase,
} from "./developmentDatabase.ts";
import { postgresProvider } from "./Postgres.ts";

export async function readSafetyRun(): Promise<{
  readonly run: LocalRun;
  readonly database: string;
}> {
  const manifest = process.env["INFRA_SAFETY_MANIFEST"];
  if (manifest === undefined) {
    throw new Error(
      "Infrastructure safety tests need the owned Node E2E run; use bun run test:e2e.",
    );
  }
  const run = Schema.decodeSync(Schema.fromJsonString(LocalRunSchema))(
    await readFile(manifest, "utf8"),
  );
  const endpoints = Schema.decodeSync(Schema.fromJsonString(LocalEndpointsSchema))(
    await readFile(join(run.directory, "endpoints.json"), "utf8"),
  );
  return { run, database: endpoints.database };
}

export function developmentSafety(run: LocalRun): DevelopmentSafety {
  const name = `lineupkeep-dev-safety-${run.runId}`;
  const identity = {
    name,
    volume: `${name}-data`,
    checkout: run.directory,
    restartPolicy: "no" as const,
  };
  const providers = developmentPostgresProvider();
  const options = safetyOptions(run, providers);
  const stack = Alchemy.Stack(
    "LineupgradeDevelopmentDatabaseSafety",
    options,
    Effect.gen(function* () {
      const database = yield* DevelopmentPostgres("Postgres", identity);
      return { url: database.url };
    }),
  );
  return { identity, options, stack };
}

export function migrationSafety(run: LocalRun, fail: boolean): MigrationSafety {
  const options = safetyOptions(run, Layer.mergeAll(Command.providers(), postgresProvider));
  const marker = join(run.directory, "migration-activated");
  const stack = Alchemy.Stack(
    "LineupgradeMigrationGateSafety",
    options,
    Effect.gen(function* () {
      const database = yield* DatabaseDeployment.pipe(Effect.provide(localPostgres(options.stage)));
      const migrated = yield* migrate({
        ...database,
        directUrl: fail
          ? Output.map(database.directUrl, () =>
              Redacted.make("postgres://invalid:invalid@127.0.0.1:1/invalid?connect_timeout=1"),
            )
          : database.directUrl,
      });
      const activation = yield* Command.Exec("Activate", {
        command: 'node -e \'require("node:fs").writeFileSync(process.env.MARKER, "activated")\'',
        env: { DATABASE_URL: migrated.runtimeUrl, MARKER: marker },
        memo: false,
        shell: true,
      });
      return { activated: Output.map(activation.hash.input, () => true) };
    }),
  );
  return { options, marker, stack };
}

export async function cleanSafetyResources(run: LocalRun): Promise<void> {
  const development = developmentSafety(run);
  await Core.run(Core.destroy(development.options, development.stack), development.options);
  await resetDevelopmentDatabase(development.identity);
  const migration = migrationSafety(run, false);
  await Core.run(Core.destroy(migration.options, migration.stack), migration.options);
}

function safetyOptions<ROut, RIn>(
  run: LocalRun,
  providers: Layer.Layer<ROut, never, RIn>,
): SafetyOptions<ROut, RIn> {
  return {
    providers,
    state: Alchemy.localState(),
    stage: `${run.stage}-safety`,
    dev: true,
    sidecar: false,
  };
}

type SafetyOptions<ROut, RIn> = {
  readonly providers: Layer.Layer<ROut, never, RIn>;
  readonly state: ReturnType<typeof Alchemy.localState>;
  readonly stage: string;
  readonly dev: boolean;
  readonly sidecar: boolean;
};

type DevelopmentRequirements = Layer.Success<ReturnType<typeof developmentPostgresProvider>>;
type DevelopmentSafety = {
  readonly identity: {
    readonly name: string;
    readonly volume: string;
    readonly checkout: string;
    readonly restartPolicy: "no";
  };
  readonly options: SafetyOptions<DevelopmentRequirements, never>;
  readonly stack: ReturnType<
    typeof Alchemy.Stack<
      { readonly url: Output.Output<Redacted.Redacted<string>> },
      DevelopmentRequirements
    >
  >;
};
type MigrationRequirements =
  | Layer.Success<typeof postgresProvider>
  | Alchemy.Provider<Command.Exec>;
type MigrationSafety = {
  readonly options: SafetyOptions<
    Layer.Success<ReturnType<typeof Command.providers>> | Layer.Success<typeof postgresProvider>,
    Layer.Services<ReturnType<typeof Command.providers>>
  >;
  readonly marker: string;
  readonly stack: ReturnType<
    typeof Alchemy.Stack<{ readonly activated: Alchemy.Input<boolean> }, MigrationRequirements>
  >;
};
