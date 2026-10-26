import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtempDisposable, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  containerNameFor,
  postgresContainer,
} from "@lineupkeep/tools/local-stack/postgresContainer.ts";
import { assert, expect, it, type TestContext } from "vitest";

import { acquireDevelopmentLock } from "./local/developmentLock.ts";
import { assertVerificationStage, stageSpec } from "./stage.ts";

it("finishes cleanup when a terminal and Bun both forward Ctrl-C", async (context) => {
  await using fixture = await developmentInterruptFixture(context);
  await fixture.exited;

  expect(fixture.output()).toContain("CLEANED");
});

it("terminates stalled shutdown and removes its directory before native teardown completes", async (context) => {
  const cancellation = new AbortController();
  context.onTestFinished(async () => {
    try {
      expect(() => process.kill(-fixture.pid, 0)).toThrow();
      expect(existsSync(fixture.directory)).toBe(false);
    } finally {
      await fixture[Symbol.asyncDispose]();
    }
  });
  const fixture = await developmentInterruptFixture(
    {
      signal: AbortSignal.any([context.signal, cancellation.signal]),
      onTestFinished: context.onTestFinished,
    },
    true,
  );
  await expect.poll(fixture.output, { timeout: 10_000 }).toContain("STOPPING");
  await using deadline = new AsyncDisposableStack();
  const bounded = new AbortController();
  deadline.defer(() => bounded.abort());
  const stopped = Promise.race([
    fixture.exited,
    delay(1000, undefined, { signal: bounded.signal }).then(() => {
      throw new Error("The exit wait ignored cancellation");
    }),
  ]);

  cancellation.abort(new Error("Test cancelled"));

  await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
});

it("excludes concurrent development maintenance and releases on completion", async () => {
  await using temporary = await mkdtempDisposable(join(tmpdir(), "lineupkeep-dev-lock-"));
  const root = temporary.path;
  const directory = pathToFileURL(`${root}/lock/`);
  const release = await acquireDevelopmentLock(directory);

  await expect(acquireDevelopmentLock(directory)).rejects.toThrow(
    "Another development/database command",
  );
  await release();
  const next = await acquireDevelopmentLock(directory);
  await next();
});

it("reclaims a development lock whose owner no longer exists", async () => {
  await using temporary = await mkdtempDisposable(join(tmpdir(), "lineupkeep-dev-lock-"));
  const root = temporary.path;
  const directory = pathToFileURL(`${root}/`);
  await writeFile(new URL("owner.json", directory), JSON.stringify({ pid: 2147483647 }));

  const release = await acquireDevelopmentLock(directory);
  await expect(acquireDevelopmentLock(directory)).rejects.toThrow(
    "Another development/database command",
  );
  await release();
});

it("rejects persistent stages and database identities in verification", () => {
  const runId = "01234567-89ab-cdef-0123-456789abcdef";
  const databaseName = containerNameFor(runId);

  expect(stageSpec("development").database).toBe("development");
  expect(stageSpec("development-cloudflare").database).toBe("development");
  expect(() => assertVerificationStage("development", runId, databaseName)).toThrow();
  expect(() =>
    assertVerificationStage("verify-checkout-run", runId, "lineupkeep-dev-data"),
  ).toThrow();
  expect(() => assertVerificationStage("verify-checkout-run", runId, databaseName)).not.toThrow();
  expect(() => postgresContainer("lineupkeep-dev-data", "/test/lock")).toThrow("disposable test");
});

async function developmentInterruptFixture(
  context: Pick<TestContext, "signal" | "onTestFinished">,
  stallShutdown = false,
): Promise<{
  directory: string;
  pid: number;
  output: () => string;
  exited: Promise<void>;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  await using resources = new AsyncDisposableStack();
  const temporary = resources.use(
    await mkdtempDisposable(join(tmpdir(), "lineupkeep-dev-interrupt-")),
  );
  const root = temporary.path;
  const module = new URL("./local/developmentInterrupt.ts", import.meta.url).href;
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ type: "module", scripts: { dev: "node fixture.mjs" } }),
  );
  await writeFile(
    join(root, "fixture.mjs"),
    `
    import { developmentStopSignal } from ${JSON.stringify(module)};
    const signal = developmentStopSignal();
    const resource = setInterval(() => {}, 1000);
    console.log("READY");
    await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
    ${stallShutdown ? 'console.log("STOPPING"); await new Promise(() => {});' : ""}
    await new Promise(resolve => setTimeout(resolve, 250));
    console.log("CLEANED");
    clearInterval(resource);
  `,
  );

  context.signal.throwIfAborted();
  const child = spawn("bun", ["run", "dev"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
  resources.defer(async () => {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, "SIGKILL");
    }
    await exited;
  });
  let output = "";
  child.stderr.on("data", () => undefined);
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (chunk.toString().includes("READY") && child.pid !== undefined) {
      process.kill(-child.pid, "SIGINT");
    }
  });
  assert(child.pid !== undefined);
  const interruptedExit = once(child, "close", { signal: context.signal }).then(() => undefined);
  const cleanup = resources.move();
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => (disposal ??= cleanup.disposeAsync());
  context.onTestFinished(dispose);
  return {
    directory: root,
    pid: child.pid,
    output: () => output,
    exited: interruptedExit,
    [Symbol.asyncDispose]: dispose,
  };
}
