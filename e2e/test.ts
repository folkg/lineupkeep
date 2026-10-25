#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { testEnvironment } from "./verify/environment.ts";
import { LockHeld } from "./verify/lifecycle.ts";
import { duration, reportOutcome, root, runTests } from "./verify/testRun.ts";

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--");
  const targetIndex = arguments_.indexOf("--target");
  const target = targetIndex === -1 ? "node" : arguments_[targetIndex + 1];
  if (target !== "node" && target !== "cloudflare" && target !== "container") {
    throw new Error("--target must be node, cloudflare, or container.");
  }
  const playwrightArguments = arguments_.filter(
    (_, index) => targetIndex === -1 || (index !== targetIndex && index !== targetIndex + 1),
  );
  await runSuite(target, playwrightArguments);
}

async function runSuite(
  target: "node" | "cloudflare" | "container",
  playwrightArguments: ReadonlyArray<string>,
): Promise<void> {
  const runId = randomUUID();
  const directory = join(root, ".artifacts/e2e", runId);
  await mkdir(directory, { recursive: true });

  try {
    const outcome = await runTests({
      runId,
      directory,
      target,
      environment: (defaults, stack) => ({
        ...testEnvironment(defaults, process.env, stack, target),
        E2E_TEST_COMPOSITION: "true",
        E2E_ARTIFACT_DIR: directory,
      }),
      playwrightArguments,
      echo: true,
      timeoutMs: duration("30m"),
    });
    reportOutcome(outcome, directory);
    const passed = outcome.status === "completed" && outcome.problems.length === 0;
    if (passed && outcome.cleanupComplete) {
      await rm(directory, { recursive: true });
    } else {
      console.error(`The run's logs and cleanup record are in ${directory}.`);
    }
    process.exitCode = passed && outcome.cleanupComplete ? 0 : 1;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (!(error instanceof LockHeld)) {
      throw error;
    }
    console.error(error.message);
    process.exitCode = 1;
  }
}

await main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
