#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Option, Schema } from "effect";

import { testEnvironment, verificationEnvironment } from "#e2e/verify/environment.ts";
import { LockHeld } from "#e2e/verify/lifecycle.ts";
import { duration, reportOutcome, root, runTests } from "#e2e/verify/testRun.ts";

async function main(): Promise<void> {
  const options = parseOptions();
  if (options.help) {
    console.log(usage);
    return;
  }
  const origin = options.origin === undefined ? undefined : absoluteOrigin(options.origin);
  if (options.tokenEnvironment !== undefined) {
    if (origin === undefined) {
      throw new Error("--token-env requires --origin.");
    }
    if (options.scopes !== undefined) {
      throw new Error("--scopes is only for local flow; a provided token carries its own grant.");
    }
    const token = process.env[options.tokenEnvironment];
    if (token === undefined || token === "") {
      throw new Error(`Environment variable ${options.tokenEnvironment} is not set.`);
    }
    process.exitCode = (await runProvidedToken(origin, options.tokenEnvironment, options.timeoutMs))
      ? 0
      : 1;
    return;
  }
  if (origin !== undefined && !isLoopback(origin)) {
    throw new Error("Local flow is loopback-only; use --token-env for a deployed origin.");
  }
  process.exitCode = (await runLocal(origin, options.scopes, options.timeoutMs)) ? 0 : 1;
}

function parseOptions(): Options {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      origin: { type: "string" },
      scopes: { type: "string", multiple: true },
      "token-env": { type: "string" },
      timeout: { type: "string", default: "30m" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  const tokenEnvironment = values["token-env"];
  if (tokenEnvironment !== undefined && !isEnvironmentName(tokenEnvironment)) {
    throw new Error("--token-env must name an environment variable.");
  }
  return {
    origin: values.origin,
    scopes: values.scopes === undefined ? undefined : values.scopes.join(" "),
    tokenEnvironment,
    timeoutMs: duration(values.timeout),
    help: values.help === true,
  };
}

async function runLocal(
  origin: string | undefined,
  scopes: string | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const { runId, directory, reportPath } = await createRunDirectory();
  if (origin === undefined) {
    const outcome = await runTests({
      runId,
      directory,
      target: "node",
      environment: (defaults, stack) => ({
        ...verificationEnvironment(
          testEnvironment(defaults, process.env, stack, "node"),
          stack,
          "node",
          directory,
        ),
        E2E_TEST_COMPOSITION: "true",
        MCP_ACCEPT_MODE: "local",
        MCP_ACCEPT_REPORT: reportPath,
        E2E_ARTIFACT_DIR: directory,
        ...(scopes === undefined ? {} : { MCP_ACCEPT_SCOPES: scopes }),
      }),
      playwrightArguments: ["e2e/mcpAccept.local.ts"],
      playwrightConfig: "e2e/mcpAccept.config.ts",
      echo: true,
      timeoutMs,
    });
    reportOutcome(outcome, directory);
    const passed =
      outcome.status === "completed" && outcome.cleanupComplete && outcome.problems.length === 0;
    return (await printReport(directory, reportPath, !passed)) && passed;
  }
  const resend = process.env["RESEND_API_BASE_URL"];
  if (resend === undefined || resend === "") {
    throw new Error(
      "Local flow against an existing origin needs RESEND_API_BASE_URL pointing at its fake inbox. Omit --origin to launch a disposable local stack.",
    );
  }
  const passed = await runPlaywright(
    {
      ...process.env,
      BETTER_AUTH_URL: origin,
      APP_ENV: "test",
      E2E_TEST_COMPOSITION: "true",
      MCP_ACCEPT_MODE: "local",
      MCP_ACCEPT_REPORT: reportPath,
      E2E_ARTIFACT_DIR: directory,
      RESEND_API_BASE_URL: resend,
      ...(scopes === undefined ? {} : { MCP_ACCEPT_SCOPES: scopes }),
    },
    timeoutMs,
  );
  return (await printReport(directory, reportPath, !passed)) && passed;
}

async function runProvidedToken(
  origin: string,
  tokenEnvironment: string,
  timeoutMs: number,
): Promise<boolean> {
  const { directory, reportPath } = await createRunDirectory();
  const passed = await runPlaywright(
    {
      ...process.env,
      BETTER_AUTH_URL: origin,
      MCP_ACCEPT_MODE: "token",
      MCP_ACCEPT_TOKEN_ENV: tokenEnvironment,
      MCP_ACCEPT_REPORT: reportPath,
      E2E_ARTIFACT_DIR: directory,
    },
    timeoutMs,
  );
  return (await printReport(directory, reportPath, !passed)) && passed;
}

async function runPlaywright(environment: NodeJS.ProcessEnv, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("@playwright/test/cli")),
      "test",
      "--config",
      "e2e/mcpAccept.config.ts",
    ],
    {
      cwd: root,
      env: environment,
      stdio: "inherit",
      signal: controller.signal,
    },
  );
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    return exitCode === 0;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`MCP acceptance exceeded its ${timeoutMs}ms deadline.`);
      return false;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function createRunDirectory(): Promise<RunDirectory> {
  const runId = randomUUID();
  const directory = join(root, ".artifacts/mcp-accept", runId);
  await mkdir(directory, { recursive: true });
  return { runId, directory, reportPath: join(directory, "report.md") };
}

async function printReport(
  directory: string,
  reportPath: string,
  failed: boolean,
): Promise<boolean> {
  const markdown = await readFile(reportPath, "utf8").catch(() => undefined);
  if (markdown === undefined) {
    console.error(`No acceptance report was written. See ${directory}.`);
    return false;
  }
  console.log(markdown);
  const summary = await readSummary(join(directory, "report.json"));
  console.log(`Report: ${reportPath}`);
  const ok = !failed && summary?.ok === true;
  if (!ok) {
    console.error("MCP acceptance failed; see the findings above.");
  }
  return ok;
}

async function readSummary(path: string): Promise<ReportSummary | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) {
    return undefined;
  }
  const parsed = Schema.decodeUnknownOption(ReportSummary)(parseJson(text));
  return Option.isSome(parsed) ? parsed.value : undefined;
}

function absoluteOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--origin must be an http or https URL.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("--origin must be an origin, not a path.");
  }
  return url.origin;
}

function isLoopback(origin: string): boolean {
  const hostname = new URL(origin).hostname;
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isEnvironmentName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const usage = `bun run mcp:accept [--origin <url>] [--scopes <scopes>] [--timeout 30m]
bun run mcp:accept --origin <url> --token-env <NAME>

Local flow (default): starts a disposable local stack, registers a dynamic client, and signs in
through the browser. Pass --origin only for an existing loopback test-composition stack with
RESEND_API_BASE_URL pointing at its fake inbox. --scopes defaults to the full advertised set.

Provided-token mode: requires --origin and reads the access token from the environment variable
named by --token-env. Never pass the token itself. Write tools are called only with empty
arguments, so this mode never writes to a deployed origin.

Exit status is non-zero when metadata, the 401 baseline, or per-tool scope enforcement disagrees.

  --origin     Local or deployed origin, such as http://127.0.0.1:3000 or https://<host>.
  --scopes     Space- or comma-separated scope subset for the local flow.
  --token-env  Name of the environment variable holding the access token.
  --timeout    Whole seconds or minutes, such as 90s or 30m.
  --help       Show this text.`;

type Options = {
  readonly origin: string | undefined;
  readonly scopes: string | undefined;
  readonly tokenEnvironment: string | undefined;
  readonly timeoutMs: number;
  readonly help: boolean;
};

type RunDirectory = {
  readonly runId: string;
  readonly directory: string;
  readonly reportPath: string;
};

const ReportSummary = Schema.Struct({
  ok: Schema.Boolean,
  mode: Schema.Literals(["local", "token"]),
  origin: Schema.String,
  findings: Schema.Array(Schema.String),
  generatedAt: Schema.String,
});

type ReportSummary = typeof ReportSummary.Type;

await main().catch((error: unknown) => {
  if (error instanceof LockHeld) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
