#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { Schema } from "effect";

import { testEnvironment, verificationEnvironment } from "./verify/environment.ts";
import { DeclaredCriteriaJson } from "./verify/evidence.ts";
import { LockHeld } from "./verify/lifecycle.ts";
import { selectServiceModule } from "./verify/scenarios.ts";
import { describeSource, scratchTasks, sourceFingerprint } from "./verify/source.ts";
import { duration, recoverAbandonedRun, reportOutcome, root, runTests } from "./verify/testRun.ts";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== "--"),
    options: {
      target: { type: "string", default: "node" },
      grep: { type: "string" },
      criteria: { type: "string" },
      video: { type: "boolean", default: false },
      timeout: { type: "string", default: "30m" },
      recover: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
  if (values.help === true) {
    console.log(usage);
    return;
  }
  const target = values.target;
  if (target !== "node" && target !== "cloudflare" && target !== "container") {
    throw new Error("Application verification target must be node, cloudflare, or container.");
  }

  if (values.recover === true) {
    const report = await recoverAbandonedRun();
    console.log(JSON.stringify(report, null, 2));
    const recovered =
      report.recovery.status === "recovered" || report.recovery.status === "no-lock";
    process.exitCode = recovered && report.orphans.problems.length === 0 ? 0 : 1;
    return;
  }

  const criteria =
    values.criteria === undefined
      ? undefined
      : Schema.decodeSync(DeclaredCriteriaJson)(await readFile(values.criteria, "utf8"));
  for (const path of positionals.filter((selected) => selected.startsWith("e2e/scratch/"))) {
    if (path.split("/").length < 4) {
      throw new Error(
        `${path} must be inside a task directory, such as e2e/scratch/<task>/${path.slice("e2e/scratch/".length)}.`,
      );
    }
  }
  const timeoutMs = duration(values.timeout);
  const runId = randomUUID();
  const directory = join(root, ".artifacts/verify", runId);
  const source = (): string => sourceFingerprint(root, positionals);
  const sourceAtStart = source();
  const description = describeSource(root);

  await mkdir(directory, { recursive: true });
  const declaration = criteria === undefined ? undefined : JSON.stringify(criteria, null, 2);
  if (declaration !== undefined) {
    await writeFile(join(directory, "criteria.json"), declaration);
  }
  await writeFile(
    join(directory, "run.json"),
    JSON.stringify(
      {
        runId,
        composition: "e2e-test",
        servicePrograms: selectServiceModule(root, positionals),
        nodeVersion: process.version,
        startedAt: new Date().toISOString(),
        target,
        selection: { files: positionals, grep: values.grep },
        video: values.video,
        criteriaDeclared: declaration !== undefined,
        criteriaSha256:
          declaration === undefined
            ? undefined
            : createHash("sha256").update(declaration).digest("hex"),
        versionControl: description.vcs,
        revision: description.revision,
        workingTree: description.workingTree,
        sourceFingerprint: sourceAtStart,
      },
      null,
      2,
    ),
  );
  await writeFile(join(directory, "source.patch"), description.patch);

  for (const task of scratchTasks(positionals)) {
    await cp(join(root, task), join(directory, task), { recursive: true });
  }
  console.log(`Application verification evidence: ${directory}`);

  try {
    const outcome = await runTests({
      runId,
      directory,
      target,
      environment: (defaults, stack) => ({
        ...verificationEnvironment(
          testEnvironment(defaults, process.env, stack, target),
          stack,
          target,
          directory,
        ),
        E2E_TEST_COMPOSITION: "true",
        VERIFICATION_SCRATCH: positionals.some((path) => path.startsWith("e2e/scratch/"))
          ? "true"
          : "false",
        VERIFICATION_VIDEO: values.video ? "true" : "false",
      }),
      playwrightArguments: [
        ...positionals,
        ...(values.grep === undefined ? [] : ["--grep", values.grep]),
      ],
      echo: false,
      timeoutMs,
    });
    const sourceAtEnd = source();
    const sourceChanged = sourceAtStart !== sourceAtEnd;
    await writeFile(
      join(directory, "source-check.json"),
      JSON.stringify(
        { atStart: sourceAtStart, atEnd: sourceAtEnd, changedDuringRun: sourceChanged },
        null,
        2,
      ),
    );
    reportOutcome(outcome, directory);
    if (sourceChanged) {
      console.error(
        "The source changed during the run; its evidence describes no single version. Rerun without editing.",
      );
    }
    if (outcome.cleanupComplete) {
      console.log(`Cleanup complete; evidence retained at ${directory}`);
    }
    process.exitCode =
      outcome.status === "completed" &&
      outcome.cleanupComplete &&
      outcome.problems.length === 0 &&
      !sourceChanged
        ? 0
        : 1;
  } catch (error) {
    if (!(error instanceof LockHeld)) {
      throw error;
    }
    await writeFile(join(directory, "refused.txt"), error.message);
    console.error(error.message);
    process.exitCode = 1;
  }
}

const usage = `bun run verify [--target node|cloudflare|container] [--grep pattern] [--criteria file.json] [--video]
                [--timeout 30m] [e2e/file.e2e.ts ...]
bun run verify --recover

Runs selected browser, MCP, and backend public-service behavior with Playwright on infrastructure of the run's own.
Browser/MCP use the application adapters; named service programs run in the target application through a test-build-only authenticated route.
Each run owns
a disposable PostgreSQL container and free ports, retaining evidence in
.artifacts/verify/<run-id>/. Runs in one checkout take turns; checkouts run in parallel.

  --criteria  Declares the criteria to prove before anything runs; claims must match them.
  --video     Records video, and lets capture holds pause for readable footage.
  --recover   Releases the resources of a run whose owner was killed, including test runs. Runs
              also do this themselves when they find an abandoned lock; it refuses while that
              owner is still running.

A second Ctrl-C kills owned processes without waiting for them to finish.`;

await main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
