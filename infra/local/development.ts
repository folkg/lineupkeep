import { createServer } from "node:net";
import { loadEnvFile } from "node:process";
import { createInterface } from "node:readline/promises";

import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Core from "alchemy/Test/Core";
import { Effect, Exit, Layer, Scope } from "effect";

import { developmentApplicationConfig, developmentEnvironmentNames } from "#infra/config.ts";
import { migrate as migrateDatabase } from "#infra/migrations.ts";
import { DatabaseDeployment } from "#infra/services/DatabaseDeployment.ts";
import { HostDeployment } from "#infra/services/HostDeployment.ts";
import { databaseLayer, hostLayer, stageSpec } from "#infra/stage.ts";

import {
  developmentDatabase,
  developmentDatabaseIdentity,
  developmentPostgresProvider,
  resetDevelopmentDatabase,
} from "./developmentDatabase.ts";
import { developmentStopSignal } from "./developmentInterrupt.ts";
import { acquireDevelopmentLock } from "./developmentLock.ts";

async function main(): Promise<void> {
  prepareDevelopmentProcessEnvironment(process.argv[2]);
  const command = parseCommand(process.argv[2]);
  await command();
}

const commands: Readonly<Record<CommandName, DevelopmentCommand>> = {
  node: serve("node"),
  cloudflare: serve("cloudflare"),
  start,
  stop,
  reset,
  migrate,
  studio,
};

function serve(host: DevelopmentHost): DevelopmentCommand {
  return () =>
    withDevelopmentLifecycle(async (lifecycle) => {
      await assertPortAvailable();
      await startDatabase(lifecycle);
      await runApplication(lifecycle, { kind: "serve", host }, async () => {
        console.log("Development ready: http://127.0.0.1:3000");
        await waitForStop(lifecycle.signal);
      });
    });
}

async function start(): Promise<void> {
  await withDevelopmentLifecycle(startDatabase);
}

async function stop(): Promise<void> {
  await withDevelopmentLifecycle(async (lifecycle) => {
    await destroyDatabase(lifecycle);
    console.log("Development database stopped; named volume retained.");
  });
}

async function reset(): Promise<void> {
  if (!(await confirmReset())) {
    return;
  }
  await withDevelopmentLifecycle(async (lifecycle) => {
    await destroyDatabase(lifecycle);
    await resetDevelopmentDatabase(developmentDatabaseIdentity());
    console.log("Development data explicitly reset.");
  });
}

async function migrate(): Promise<void> {
  await withDevelopmentLifecycle(async (lifecycle) => {
    await startDatabase(lifecycle);
    await runApplication(lifecycle, { kind: "migrate" });
  });
}

async function studio(): Promise<void> {
  await withDevelopmentLifecycle(async (lifecycle) => {
    await startDatabase(lifecycle);
    await runApplication(lifecycle, { kind: "studio" }, async () => {
      console.log("Development Studio ready.");
      await waitForStop(lifecycle.signal);
    });
  });
}

function parseCommand(name: string | undefined): DevelopmentCommand {
  const command = Object.entries(commands).find(([key]) => key === name)?.[1];
  if (command === undefined) {
    throw new Error(`Expected ${Object.keys(commands).join(", ")}`);
  }
  return command;
}

async function withDevelopmentLifecycle(
  run: (lifecycle: DevelopmentLifecycle) => Promise<void>,
): Promise<void> {
  const release = await acquireDevelopmentLock(
    new URL("../../.artifacts/development/lock/", import.meta.url),
  );
  const scope = Scope.makeUnsafe("sequential");
  const signal = developmentStopSignal();
  try {
    await run({ scope, signal });
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await release();
  }
}

async function startDatabase({ scope }: DevelopmentLifecycle): Promise<void> {
  await Core.run(Core.makeDeploy(options, scope)(developmentDatabase), options, scope);
  console.log("Persistent development database ready (separate from verification and Compose).");
}

async function destroyDatabase({ scope }: DevelopmentLifecycle): Promise<void> {
  await Core.run(Core.destroy(options, developmentDatabase, { scope }), options, scope);
}

async function runApplication(
  { scope }: DevelopmentLifecycle,
  activation: DevelopmentActivation,
  ready?: () => Promise<void>,
): Promise<void> {
  const stack = developmentStack(activation);
  try {
    await Core.run(Core.makeDeploy(options, scope)(stack), options, scope);
    await ready?.();
  } finally {
    await Core.run(Core.destroy(options, stack, { scope }), options, scope);
  }
}

function developmentStack(
  activation: DevelopmentActivation,
): ReturnType<typeof Alchemy.Stack<DevelopmentOutputs, DevelopmentRequirements>> {
  return Alchemy.Stack(
    "LineupkeepDevelopment",
    { providers, state: Alchemy.localState() },
    Effect.gen(function* () {
      if (!(yield* AlchemyContext).dev) {
        return yield* Effect.die(new Error("Development requires local mode"));
      }
      const stage = stageSpec(
        activation.kind === "serve" && activation.host === "cloudflare"
          ? "development-cloudflare"
          : "development",
      );
      const database = yield* DatabaseDeployment.pipe(Effect.provide(databaseLayer(stage)));
      const migrated = yield* migrateDatabase(database);
      switch (activation.kind) {
        case "migrate":
          return { url: migrated.runtimeUrl };
        case "studio": {
          const studio = yield* Command.Dev("Studio", {
            cwd: new URL("../../", import.meta.url).pathname,
            command:
              "node node_modules/drizzle-kit/bin.cjs studio --config=packages/backend/drizzle.config.ts",
            env: { DATABASE_URL: migrated.runtimeUrl },
          });
          return { url: studio.url };
        }
        case "serve": {
          const environment = {
            ...(yield* developmentApplicationConfig),
            APP_ENV: "development",
            NODE_ENV: "development",
            DATABASE_URL: migrated.runtimeUrl,
            BETTER_AUTH_URL: "http://127.0.0.1:3000",
          };
          const host = yield* HostDeployment.pipe(
            Effect.provide(hostLayer(stage, migrated, environment, { development: true })),
          );
          return { url: host.url };
        }
      }
    }),
  );
}

function prepareDevelopmentProcessEnvironment(command: string | undefined): void {
  try {
    loadEnvFile(new URL("../../.env", import.meta.url));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const allowed = new Set(["PATH", "HOME", "TMPDIR", ...developmentEnvironmentNames()]);
  for (const key of Object.keys(process.env)) {
    if (!allowed.has(key)) {
      delete process.env[key];
    }
  }
  process.env["NODE_ENV"] = "development";
  process.env["DEPLOY_TARGET"] = command === "cloudflare" ? "cloudflare" : "node";
  process.env["DEVELOPMENT_STACK"] = "true";
  process.env["BUILD_WITHOUT_DOTENV"] = "true";
}

async function waitForStop(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
    } else {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }
  });
}

async function confirmReset(): Promise<boolean> {
  if (process.argv.slice(3).includes("--yes")) {
    return true;
  }
  if (!process.stdin.isTTY) {
    throw new Error(
      "db:reset deletes all development data. Run interactively or pass --yes explicitly.",
    );
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (
      (await input.question("Delete ALL Alchemy development data? Type reset to confirm: ")) ===
      "reset"
    );
  } finally {
    input.close();
  }
}

async function assertPortAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error("Development port 3000 is occupied. Stop its owner; no process was killed."),
      ),
    );
    server.listen(3000, "127.0.0.1", () =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });
}

const providers = Layer.mergeAll(
  Cloudflare.providers(),
  Command.providers(),
  developmentPostgresProvider(),
);
const options = {
  providers,
  state: Alchemy.localState(),
  stage: "development",
  dev: true,
  sidecar: false,
};

type CommandName = "node" | "cloudflare" | "start" | "stop" | "reset" | "migrate" | "studio";

type DevelopmentCommand = () => Promise<void>;

type DevelopmentLifecycle = { readonly scope: Scope.Closeable; readonly signal: AbortSignal };

type DevelopmentActivation =
  | {
      readonly kind: "serve";
      readonly host: DevelopmentHost;
    }
  | { readonly kind: "migrate" }
  | { readonly kind: "studio" };

type DevelopmentHost = "node" | "cloudflare";

await main();

type DevelopmentOutputs = {
  readonly url: Alchemy.Input<string | import("effect/Redacted").Redacted<string> | undefined>;
};
type DevelopmentRequirements =
  | AlchemyContext
  | Layer.Services<ReturnType<typeof databaseLayer>>
  | Layer.Services<ReturnType<typeof hostLayer>>;
