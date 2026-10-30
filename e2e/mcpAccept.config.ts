import { defineConfig, devices } from "@playwright/test";

const mode = process.env["MCP_ACCEPT_MODE"];
if (mode !== "local" && mode !== "token") {
  throw new Error("MCP_ACCEPT_MODE must be local or token; run through `bun run mcp:accept`.");
}

const artifactDirectory = process.env["E2E_ARTIFACT_DIR"];

export default defineConfig({
  testDir: ".",
  testMatch: mode === "token" ? "mcpAccept.token.ts" : "mcpAccept.local.ts",
  outputDir:
    artifactDirectory === undefined
      ? "test-results/mcp-accept"
      : `${artifactDirectory}/test-results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: readBaseUrl(),
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

function readBaseUrl(): string {
  const value = process.env["BETTER_AUTH_URL"];
  if (value === undefined) {
    throw new Error("BETTER_AUTH_URL is required; run through `bun run mcp:accept`.");
  }
  return value;
}
