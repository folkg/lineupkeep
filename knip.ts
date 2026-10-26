import type { KnipConfig } from "knip";

export default ({ production }: { readonly production?: boolean }): KnipConfig => ({
  ignoreExportsUsedInFile: false,
  ignoreDependencies: ["@swc/core"],
  ignoreBinaries: ["ffmpeg", "ffprobe", "jj"],
  ignoreIssues: {
    "tsconfig.json": ["unlisted"],
    ...(production === true ? productionTestSeams : {}),
  },
  workspaces: {
    ".": {
      playwright: false,
      entry: [
        ".dependency-cruiser.ts!",
        "e2e/playwright.config.ts",
        "e2e/*.e2e.ts",
        "e2e/serviceRoute.ts",
        "e2e/testRuntime.ts",
        "e2e/scenarios/services.ts",
        "e2e/fakeResend.ts",
        "e2e/traceCollector.ts",
        "e2e/verify/doctor.ts",
        "e2e/verify/reporter.ts",
        "e2e/support.ts",
      ],
      project: ["**/*.{ts,tsx,mjs,cjs}", "!scripts/architectureFixture.ts!"],
    },
    infra: {
      entry: [
        "alchemy.run.ts!",
        "database.run.ts!",
        "platform.run.ts!",
        "build/run.ts!",
        "local/driver.ts!",
        "local/*.safety.test.ts",
        "local/*.container-safety.test.ts",
        "local/nodeEntry.ts!",
        "local/loopbackRelay.ts!",
      ],
      project: ["**/*.ts"],
    },
    "apps/linking-helper": {
      project: ["src/**/*.ts!"],
    },
    "apps/hosted-browser": {
      entry: ["src/main.ts!"],
      project: ["src/**/*.ts!", "deploy/**/*.ts"],
    },
    "packages/hosted-browser": {
      project: ["src/**/*.ts!"],
    },
    "apps/web": {
      ...(production === true ? { ignore: productionTestOnlyFiles } : {}),
      ignoreDependencies: [
        "@solidjs/diagnostics",
        "@solidjs/vite-plugin!",
        "@tailwindcss/vite!",
        "cloudflare",
        ...(production === true ? ["@kobalte/core"] : []),
      ],
      project: ["src/**/*.ts!", "src/**/*.tsx!", "src/**/*.css!", "!src/**/*Test.ts!"],
      entry: ["src/server/targets/*.ts!", "deploy/**/*.ts"],
      vite: {
        config: [],
      },
    },
    "packages/backend": {
      drizzle: false,
      includeEntryExports: true,
      project: ["src/**/*.ts!", "scripts/**/*.ts", "!scripts/**/*.ts!", "!src/**/*Test.ts!"],
    },
  },
});

const productionTestOnlyFiles = [
  "src/browser/navigation/UnsavedChanges.tsx",
  "src/browser/navigation/useUnsavedChanges.ts",
  "src/browser/shared-ui/ConfirmDialog.tsx",
  "src/browser/shared-ui/SearchField.tsx",
  "src/browser/timing/delay.ts",
];

const productionTestSeams: Record<string, Array<"exports" | "types">> = {
  "tools/local-stack/*.ts": ["exports", "types"],
  "packages/backend/src/**/*Test.ts": ["exports", "types"],
  "packages/backend/src/contexts/connections/internal/yahoo/YahooLineup.ts": ["exports", "types"],
  "packages/backend/src/database/dbUtilities.ts": ["exports"],
  "packages/backend/src/contexts/auth/User.ts": ["exports"],
  "packages/backend/src/runtime/ApplicationScopes.ts": ["exports"],
  "packages/backend/src/contexts/auth/AuthSession.ts": ["types"],
  "packages/backend/src/contexts/connections/Connection.ts": ["exports"],
  "apps/web/src/browser/session/authClient.ts": ["exports"],
  "apps/web/src/browser/shared-ui/icons.tsx": ["exports"],
  "apps/web/src/browser/telemetry/telemetry.ts": ["exports", "types"],
  "apps/web/src/server/mcp/mcpServer.ts": ["exports"],
  "apps/web/src/server/telemetry/telemetryServer.ts": ["exports"],
  "apps/linking-helper/src/AppTransport.ts": ["exports", "types"],
  "apps/linking-helper/src/Cli.ts": ["exports"],
  "apps/linking-helper/src/DeviceAuthorization.ts": ["exports"],
  "apps/linking-helper/src/LinkingUpload.ts": ["exports"],
  "apps/linking-helper/src/ProviderBrowser.ts": ["exports"],
  "apps/web/src/server/backendEntry.ts": ["exports"],
  "apps/hosted-browser/src/server.ts": ["types"],
  "apps/web/src/server/linking/linkingUpload.ts": ["exports"],
  "packages/backend/src/runtime/public-internet/transport/node/PublicInternetProcess.ts": [
    "exports",
  ],
};
