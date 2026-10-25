import { defineConfig, devices } from "@playwright/test";

process.loadEnvFile(new URL("e2e.env", import.meta.url));
const baseURL = readBaseUrl();
const verificationDirectory = process.env["VERIFICATION_DIR"];
const artifactDirectory = verificationDirectory ?? process.env["E2E_ARTIFACT_DIR"];
const verifying = verificationDirectory !== undefined;
const recordingVideo = process.env["VERIFICATION_VIDEO"] === "true";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  testIgnore: verifying && process.env["VERIFICATION_SCRATCH"] === "true" ? [] : ["scratch/**"],
  outputDir: artifactDirectory === undefined ? "test-results" : `${artifactDirectory}/test-results`,
  fullyParallel: !verifying,
  workers: verifying || process.env["CI"] !== undefined ? 1 : 2,
  retries: 0,
  failOnFlakyTests: true,
  ...(verifying ? { globalSetup: "./verify/doctor.ts" } : {}),
  forbidOnly: process.env["CI"] !== undefined,

  ...(recordingVideo ? { timeout: 120_000 } : {}),
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder:
          artifactDirectory === undefined ? "playwright-report" : `${artifactDirectory}/report`,
        open: "never",
      },
    ],
    ...(verifying ? [["./verify/reporter.ts", { directory: verificationDirectory }] as const] : []),
  ],
  use: {
    baseURL,
    trace: verifying ? "on" : "retain-on-failure",
    video: recordingVideo ? { mode: "on", size: { width: 1280, height: 900 } } : "off",
    screenshot: verifying ? "on" : "only-on-failure",
    ...(verifying
      ? {
          viewport: { width: 1280, height: 900 },

          ...(recordingVideo ? { launchOptions: { slowMo: 120 } } : {}),
        }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(verifying ? { viewport: { width: 1280, height: 900 } } : {}),
      },
    },
  ],
});

function readRequired(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(
      `${name} is required; run the suite with \`bun run test:e2e\` or \`bun run verify\`, which supply each run's own infrastructure.`,
    );
  }
  return value;
}

function readBaseUrl(): string {
  return readRequired("BETTER_AUTH_URL");
}
