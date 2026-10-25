import { execFileSync } from "node:child_process";

import { expect, it } from "vitest";

import { runTests } from "#e2e/verify/testRun.ts";

it("releases signal subscriptions when runner preflight rejects", async () => {
  const sigint = process.listeners("SIGINT");
  const sigterm = process.listeners("SIGTERM");

  await expect(
    runTests({
      runId: "invalid-preflight",
      directory: "unused",
      target: "node",
      environment: () => ({}),
      playwrightArguments: [],
      echo: false,
      timeoutMs: -1,
    }),
  ).rejects.toThrow(RangeError);

  expect(process.listeners("SIGINT")).toEqual(sigint);
  expect(process.listeners("SIGTERM")).toEqual(sigterm);
});

it("advertises verification commands and evidence paths", () => {
  const help = execFileSync("bun", ["run", "verify", "--help"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });

  expect(help).toContain("bun run verify ");
  expect(help).toContain("bun run verify --recover");
  expect(help).toContain(".artifacts/verify/<run-id>/");
  expect(help).not.toContain("--surfaces");
});
