import solidPlugin from "@solidjs/vite-plugin";
import { playwright } from "@vitest/browser-playwright";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vitest/config";

const solidWebRuntime = new URL("./node_modules/@solidjs/web/dist/server.js", import.meta.url)
  .pathname;

const maxWorkers = "70%";

const hangGuardTimeoutMs = 30_000;

const chromiumTests = [
  "apps/hosted-browser/src/server.test.ts",
  "apps/web/src/server/hostedLinking/playwrightHostedBrowser.test.ts",
  "apps/linking-helper/src/ProviderBrowser.test.ts",
];

const nodeProject = {
  mode: "production",
  ssr: {
    noExternal: ["@tanstack/solid-query"],
  },
  resolve: {
    conditions: ["import", "module", "node"],
    alias: {
      "solid-js/web": solidWebRuntime,
      "solid-js/store": "solid-js",
      "solid-js/html": "@solidjs/web",
      "solid-js/h": "@solidjs/web",
    },
  },
  test: {
    deps: {
      optimizer: {
        ssr: { enabled: false },
      },
    },
  },
};

export default defineConfig({
  test: {
    projects: [
      ...(process.env["INFRA_SAFETY_MANIFEST"] === undefined
        ? []
        : [
            {
              test: {
                name: "safety-node",
                include: ["infra/local/*.safety.test.ts"],
                fileParallelism: false,
                maxWorkers: 1,
                testTimeout: 180_000,
                hookTimeout: 120_000,
              },
            },
            {
              test: {
                name: "safety-container",
                include: ["infra/local/*.container-safety.test.ts"],
                fileParallelism: false,
                maxWorkers: 1,
                testTimeout: 180_000,
                hookTimeout: 120_000,
              },
            },
          ]),
      {
        ...nodeProject,
        test: {
          ...nodeProject.test,
          name: "node",
          maxWorkers,
          testTimeout: hangGuardTimeoutMs,
          hookTimeout: hangGuardTimeoutMs,
          sequence: { groupOrder: 0 },
          include: [
            "apps/**/*.test.ts",
            "apps/**/*.test.tsx",
            "packages/**/*.test.ts",
            "packages/**/*.test.tsx",
            "scripts/**/*.test.ts",
            "infra/**/*.test.ts",
          ],
          exclude: [
            "infra/local/*.safety.test.ts",
            "infra/local/*.container-safety.test.ts",
            "node_modules/**",
            "**/node_modules/**",
            "**/dist/**",
            "**/*.browser.test.ts",
            "**/*.browser.test.tsx",
            ...chromiumTests,
          ],
        },
      },
      {
        ...nodeProject,
        test: {
          ...nodeProject.test,
          name: "chromium",
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
          include: chromiumTests,
          exclude: ["node_modules/**", "**/node_modules/**", "**/dist/**"],
        },
      },
      {
        plugins: [
          solidPlugin({
            dev: false,
            hot: false,
            observe: true,
            solid: { moduleName: "@solidjs/web" },
          }),
          Icons({
            compiler: "solid",
            iconCustomizer: (_collection, _icon, props) => {
              props["aria-hidden"] = "true";
            },
          }),
        ],
        resolve: {
          tsconfigPaths: true,
          alias: {
            "solid-js/web": "@solidjs/web",
            "solid-js/store": "solid-js",
            "solid-js/html": "@solidjs/web",
            "solid-js/h": "@solidjs/web",
          },
        },
        test: {
          name: "browser",
          maxWorkers,
          testTimeout: hangGuardTimeoutMs,
          hookTimeout: hangGuardTimeoutMs,
          sequence: { groupOrder: 0 },
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
          include: [
            "apps/**/*.browser.test.ts",
            "apps/**/*.browser.test.tsx",
            "packages/**/*.browser.test.ts",
            "packages/**/*.browser.test.tsx",
          ],
          exclude: ["node_modules/**", "**/node_modules/**", "**/dist/**"],
        },
      },
    ],
  },
});
