import { glob, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { LocalEndpointsSchema, LocalRunSchema } from "@lineupkeep/tools/local-stack/contract.ts";
import type { LocalRun } from "@lineupkeep/tools/local-stack/contract.ts";
import * as Alchemy from "alchemy";
import { State } from "alchemy/State";
import * as Core from "alchemy/Test/Core";
import { Effect, Exit, Schema, Scope } from "effect";

import { cleanSafetyResources } from "./safety.ts";
import {
  verificationProviders,
  verificationStack,
  verificationStackName,
} from "./verificationStack.ts";

async function main(): Promise<void> {
  const run = await readRun(process.argv[2]);
  const driver = makeDriver(run);
  try {
    if (process.argv[3] === "--destroy") {
      await destroyStack(driver);
    } else {
      await serveStack(driver);
    }
  } finally {
    await Effect.runPromise(Scope.close(driver.scope, Exit.void));
  }
}

async function serveStack(driver: Driver): Promise<void> {
  const { run, options, scope, stack } = driver;
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  try {
    const endpoints = Schema.decodeUnknownSync(LocalEndpointsSchema)(
      await Core.run(Core.makeDeploy(options, scope)(stack), options, scope),
    );
    await assertTestArtifact(run);
    for (const url of [endpoints.application, endpoints.email, endpoints.traces]) {
      await healthy(url, stop.signal);
    }
    const inspector =
      run.target === "node" && run.environment["VERIFICATION_DIR"] !== undefined
        ? Schema.decodeSync(Schema.fromJsonString(Schema.Struct({ url: Schema.String })))(
            await readFile(join(run.directory, "inspector.json"), "utf8"),
          ).url
        : undefined;
    await publish(run.directory, "endpoints.json", { ...endpoints, inspector });
    console.log(`Alchemy stack ready: ${endpoints.application}`);
    await new Promise<void>((resolve) => {
      if (stop.signal.aborted) {
        resolve();
      } else {
        stop.signal.addEventListener("abort", () => resolve(), { once: true });
      }
    });
  } finally {
    await destroyStack(driver);
  }
}

async function destroyStack(driver: Driver): Promise<void> {
  const { run, options, scope, stack } = driver;
  if (run.target === "node") {
    await cleanSafetyResources(run);
  }
  await Core.run(Core.destroy(options, stack, { scope }), options, scope);
  const remainingResources = await Core.run(
    Effect.gen(function* () {
      const state = yield* yield* State;
      return yield* state.list({ stack: verificationStackName, stage: run.stage });
    }),
    options,
    scope,
  );
  await publish(run.directory, "alchemy-destroy.json", { remainingResources });
  if (remainingResources.length > 0) {
    throw new Error(`Alchemy still owns resources: ${remainingResources.join(", ")}`);
  }
}

async function readRun(path: string | undefined): Promise<LocalRun> {
  if (path === undefined) {
    throw new Error("A journaled local run manifest is required");
  }
  const run = Schema.decodeSync(Schema.fromJsonString(LocalRunSchema))(
    await readFile(path, "utf8"),
  );
  if (process.cwd() !== run.cwd) {
    throw new Error("Alchemy recovery must use the journaled checkout cwd");
  }
  return run;
}

function makeDriver(run: LocalRun): Driver {
  return {
    run,
    stack: verificationStack(run),
    scope: Scope.makeUnsafe("sequential"),
    options: {
      providers: verificationProviders,
      state: Alchemy.localState(),
      stage: run.stage,
      dev: true,
      sidecar: false,
    },
  };
}

async function publish(directory: string, name: string, value: unknown): Promise<void> {
  const path = join(directory, name);
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

async function healthy(url: string, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    signal.throwIfAborted();
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
    }).catch(() => undefined);
    if (response?.ok === true) {
      await response.body?.cancel();
      return;
    }
    await response?.body?.cancel();
    if (Date.now() > deadline) {
      throw new Error(`Local resource did not become healthy: ${url}`);
    }
    await delay(100, undefined, { signal });
  }
}

async function assertTestArtifact(run: LocalRun): Promise<void> {
  const directory = join(
    run.cwd,
    "apps/web",
    run.target === "cloudflare" ? "dist/server" : ".output/server",
  );
  for await (const file of glob("**/*.{js,mjs,cjs}", { cwd: directory })) {
    if (
      (await readFile(join(directory, file), "utf8")).includes("E2E_TEST_COMPOSITION_DO_NOT_DEPLOY")
    ) {
      return;
    }
  }
  throw new Error(
    "Verification artifact has no E2E composition marker, so test-service isolation cannot be established; rerun bun run verify or bun run test:e2e to rebuild through the owned local driver.",
  );
}

type Driver = {
  readonly run: LocalRun;
  readonly stack: ReturnType<typeof verificationStack>;
  readonly scope: ReturnType<typeof Scope.makeUnsafe>;
  readonly options: {
    readonly providers: typeof verificationProviders;
    readonly state: ReturnType<typeof Alchemy.localState>;
    readonly stage: string;
    readonly dev: boolean;
    readonly sidecar: boolean;
  };
};

await main();
