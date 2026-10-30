import {
  AcceptanceReport,
  runAcceptance,
  tokenGrantedScopes,
  writeAcceptanceReport,
} from "./mcpAccept.ts";
import { expect, test } from "./support.ts";

test("accepts the MCP scope boundary with a provided access token", async ({ baseURL }) => {
  test.setTimeout(120_000);
  const origin = requiredBaseUrl(baseURL);
  const report = new AcceptanceReport({ mode: "token", origin });
  try {
    const tokenEnvironment = requiredEnvironmentName();
    const token = process.env[tokenEnvironment];
    if (token === undefined || token === "") {
      throw new Error(`Environment variable ${tokenEnvironment} is not set.`);
    }
    const granted = tokenGrantedScopes(token);
    await runAcceptance({ mode: "token", origin, tokenEnvironment, token, granted }, report);
  } catch (error) {
    report.fatal(error);
  } finally {
    await writeAcceptanceReport(report, requiredReportPath());
  }
  expect(report.summary().findings, report.failureMessage()).toEqual([]);
});

function requiredBaseUrl(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("MCP acceptance needs BETTER_AUTH_URL; run through `bun run mcp:accept`.");
  }
  return value;
}

function requiredEnvironmentName(): string {
  const name = process.env["MCP_ACCEPT_TOKEN_ENV"];
  if (name === undefined) {
    throw new Error("MCP_ACCEPT_TOKEN_ENV is required; run through `bun run mcp:accept`.");
  }
  return name;
}

function requiredReportPath(): string {
  const path = process.env["MCP_ACCEPT_REPORT"];
  if (path === undefined) {
    throw new Error("MCP_ACCEPT_REPORT is required; run through `bun run mcp:accept`.");
  }
  return path;
}
