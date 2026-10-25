import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import {
  containerNameFor,
  removeOwnedContainer,
  testContainers,
} from "@sourdough/tools/local-stack/postgresContainer.ts";

import {
  isOrphaned,
  LockHeld,
  recoverVerification,
  runVerification,
  type RecoveryOutcome,
  type Stack,
  type VerificationCommand,
  type VerificationOutcome,
} from "./lifecycle.ts";
import { localStack, manifest } from "./localStack.ts";
import { scenarioFiles, selectServiceModule } from "./scenarios.ts";
import { sourceFingerprint } from "./source.ts";
export async function runTests(run: TestRun): Promise<VerificationOutcome> {
  const interruption = new AbortController();
  const urgency = new AbortController();
  const interrupt = (signal: NodeJS.Signals): void => {
    if (!interruption.signal.aborted) {
      interruption.abort(new Error(`The run received ${signal}.`));
    } else if (!urgency.signal.aborted) {
      console.error("Second interruption: killing owned processes without waiting.");
      urgency.abort();
    }
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const signal = AbortSignal.any([interruption.signal, AbortSignal.timeout(run.timeoutMs)]);
    const defaults = parseEnv(await readFile(join(root, "e2e/e2e.env"), "utf8"));

    const orphans = await collectOrphanedContainers(signal);
    for (const name of orphans.removed) {
      console.log(`Removed ${name}, which outlived its run.`);
    }
    for (const problem of orphans.problems) {
      console.error(problem);
    }
    const before = sourceFingerprint(root, run.playwrightArguments);
    const stage = `verify-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${run.runId}`;
    const environment = {
      ...run.environment(defaults, undefined),
      E2E_SERVICE_PROGRAMS: selectServiceModule(root, run.playwrightArguments),
    };
    await writeFile(
      manifest(run.directory),
      JSON.stringify(
        {
          runId: run.runId,
          stage,
          cwd: root.replace(/\/$/u, ""),
          directory: run.directory,
          databaseName: containerNameFor(run.runId),
          lockDirectory,
          target: run.target,
          sourceFingerprint: before,
          labels: { "sourdough.disposable": "test-database", "sourdough.lock": lockDirectory },
          environment: Object.fromEntries(
            Object.entries(environment).filter(([, value]) => typeof value === "string"),
          ),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const prepare = (name: string, arguments_: ReadonlyArray<string>): VerificationCommand => ({
      name,
      executable: "bun",
      arguments: arguments_,
      cwd: root,
      environment,
      echo: run.echo,
    });
    const outcome = await waitForLock(signal, () =>
      runVerification({
        runId: run.runId,
        directory: run.directory,
        lockDirectory,
        infrastructure: localStack(containerNameFor(run.runId), lockDirectory),
        infrastructureNamed: (name) => localStack(name, lockDirectory),
        alchemy: {
          stage,
          cwd: root.replace(/\/$/u, ""),
          manifest: manifest(run.directory),
          sourceFingerprint: before,
        },
        prepare: [
          prepare("scenario-policy", [
            "--no-env-file",
            "run",
            "lint:check",
            "--no-ignore",
            ...scenarioFiles(root, run.playwrightArguments),
          ]),
          prepare("scenario-architecture", ["--no-env-file", "run", "architecture"]),
        ],
        signal,
        urgent: urgency.signal,
        shutdownMs,
        commands: (stack) => {
          const environment = {
            ...run.environment(defaults, stack),
            E2E_SERVICE_PROGRAMS: selectServiceModule(root, run.playwrightArguments),
          };
          const safetyCommand: VerificationCommand = {
            name: "infrastructure-safety",
            echo: run.echo,
            executable: process.execPath,
            arguments: [
              "node_modules/vitest/vitest.mjs",
              "run",
              "--config",
              "vitest.config.ts",
              "--project",
              `safety-${run.target}`,
            ],
            cwd: root,
            environment: {
              PATH: process.env["PATH"],
              HOME: process.env["HOME"],
              TMPDIR: process.env["TMPDIR"],
              NODE_ENV: "production",
              INFRA_SAFETY_MANIFEST: manifest(run.directory),
            },
          };
          return [
            ...(run.target === "node" ? [safetyCommand] : []),
            {
              name: "playwright",
              echo: run.echo,
              executable: process.execPath,
              arguments: [
                fileURLToPath(import.meta.resolve("@playwright/test/cli")),
                "test",
                "--config",
                "e2e/playwright.config.ts",
                ...run.playwrightArguments,
              ],
              cwd: root,
              environment,
            },
            ...(run.target === "container" ? [safetyCommand] : []),
          ];
        },
      }),
    );
    const after = sourceFingerprint(root, run.playwrightArguments);
    await writeFile(
      join(run.directory, "source-check.json"),
      JSON.stringify(
        { atStart: before, atEnd: after, changedDuringRun: before !== after },
        null,
        2,
      ),
    );
    return before === after
      ? outcome
      : { ...outcome, status: "failed", failure: "Source changed during the run" };
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

export async function recoverAbandonedRun(): Promise<RecoveryReport> {
  let recovery: RecoveryReport["recovery"];
  let orphans: OrphanCollection;
  try {
    recovery = existsSync(lockDirectory)
      ? await recoverVerification(
          lockDirectory,
          (name) => localStack(name, lockDirectory),
          shutdownMs,
        )
      : { status: "no-lock" };
  } catch (cause) {
    throw new Error("Recovering this checkout's lock failed.", { cause });
  } finally {
    orphans = await collectOrphanedContainers(AbortSignal.timeout(sweepMs));
  }
  return { recovery, orphans };
}

async function collectOrphanedContainers(signal: AbortSignal): Promise<OrphanCollection> {
  const removed: Array<string> = [];
  const problems: Array<string> = [];
  const describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
  let containers: Awaited<ReturnType<typeof testContainers>> = [];
  try {
    containers = [...(await testContainers(signal)), ...(await testContainers(signal, "test-web"))];
  } catch (error) {
    problems.push(`Test containers could not be listed: ${describe(error)}`);
  }
  for (const container of containers) {
    if (!container.name.startsWith("sourdough-test-")) {
      continue;
    }
    try {
      const web = container.name.endsWith("-web");
      const databaseName = web ? container.name.slice(0, -4) : container.name;
      if (await isOrphaned(container.lockDirectory, databaseName)) {
        await removeOwnedContainer(
          container.name,
          container.lockDirectory,
          web ? "test-web" : "test-database",
          signal,
          true,
        );
        removed.push(container.name);
      }
    } catch (error) {
      problems.push(`${container.name} could not be collected: ${describe(error)}`);
    }
  }
  return { removed, problems };
}

export function reportOutcome(outcome: VerificationOutcome, directory: string): void {
  if (outcome.recoveredRun !== undefined) {
    console.log(`Recovered abandoned run ${outcome.recoveredRun} before starting.`);
  }
  if (outcome.failure !== undefined) {
    console.error(`Run ${outcome.status}: ${outcome.failure}`);
  }
  for (const problem of outcome.problems) {
    console.error(problem);
  }
  if (!outcome.cleanupComplete) {
    console.error(
      `Cleanup incomplete; the lock is retained. See ${join(directory, "cleanup.json")}, then run \`bun run verify --recover\`.`,
    );
  }
}

export function duration(value: string): number {
  const match = /^(\d+)(s|m)$/u.exec(value);
  if (match === null) {
    throw new Error("--timeout must be a whole number of seconds or minutes, such as 90s or 30m.");
  }
  return Number(match[1]) * (match[2] === "m" ? 60_000 : 1000);
}

async function waitForLock(
  signal: AbortSignal,
  run: () => Promise<VerificationOutcome>,
): Promise<VerificationOutcome> {
  let announced = false;
  for (;;) {
    signal.throwIfAborted();
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof LockHeld) || !error.inProgress) {
        throw error;
      }
      if (!announced) {
        console.log(`${error.message} Waiting for it to finish.`);
        announced = true;
      }
      await delay(lockPollMs, undefined, { signal }).catch(() => {
        throw error;
      });
    }
  }
}

export const root = fileURLToPath(new URL("../../", import.meta.url));

const lockDirectory = join(root, ".artifacts/.lock");

const lockPollMs = 5000;

const sweepMs = 60_000;

const shutdownMs = 15_000;

type OrphanCollection = {
  readonly removed: ReadonlyArray<string>;
  readonly problems: ReadonlyArray<string>;
};

export type RecoveryReport = {
  readonly recovery: RecoveryOutcome | { readonly status: "no-lock" };
  readonly orphans: OrphanCollection;
};

export type TestRun = {
  readonly runId: string;
  readonly directory: string;
  readonly target: "node" | "cloudflare" | "container";
  readonly environment: (
    defaults: Readonly<Record<string, string | undefined>>,
    stack: Stack | undefined,
  ) => Record<string, string | undefined>;
  readonly playwrightArguments: ReadonlyArray<string>;
  readonly echo: boolean;
  readonly timeoutMs: number;
};
