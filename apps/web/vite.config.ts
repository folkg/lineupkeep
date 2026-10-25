import cloudflare from "@alchemy.run/cloudflare-runtime/vite";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { nitro } from "nitro/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig, type PluginOption } from "vite";

import { cloudflareCompatibility, workerConfiguration } from "./deploy/cloudflare/settings.ts";
import { clientBoundary } from "./deploy/verifyComposition.ts";
const deploymentTargets = {
  cloudflare: {
    module: "./src/server/targets/cloudflare.ts",
    beforeStart: () => [
      ...(process.env["ALCHEMY_CLOUDFLARE_VITE_INJECTED"] === "1"
        ? []
        : [
            cloudflare({
              compatibilityDate: cloudflareCompatibility.date,
              compatibilityFlags: [...cloudflareCompatibility.flags],
            }),
          ]),
      {
        name: "worker-deployment-configuration",
        applyToEnvironment: (environment) => environment.name === "ssr",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "worker-configuration.json",
            source: JSON.stringify(workerConfiguration("server.js")),
          });
        },
      },
    ],
    afterStart: () => [],
  },
  node: {
    module: "./src/server/targets/node.ts",
    beforeStart: () => [],
    afterStart: () => [nitro({ preset: "node-server" })],
  },
} satisfies Record<string, DeploymentTargetBuild>;

export default defineConfig(({ command }) => {
  const target = readDeploymentTarget(command);

  return {
    envDir: process.env["BUILD_WITHOUT_DOTENV"] === "true" ? false : "../..",
    ...(command === "serve" && process.env["DEVELOPMENT_STACK"] === "true"
      ? {
          cacheDir: "../../.artifacts/development/vite-cache",
        }
      : {}),
    ssr: {
      noExternal: ["@solidjs/signals"],
    },
    plugins: [
      ...(target?.beforeStart() ?? []),
      tanstackStart(),
      clientBoundary(),
      ...(command === "build" ? (target?.afterStart() ?? []) : []),
      tailwindcss(),
      solidPlugin({ ssr: true, observe: true }),
      Icons({
        compiler: "solid",
        iconCustomizer: (_collection, _icon, props) => {
          props["aria-hidden"] = "true";
        },
      }),
    ],
    resolve: {
      alias: {
        "solid-js/store": "solid-js",

        ...(process.env["E2E_TEST_COMPOSITION"] === "true"
          ? {
              "#backend-runtime": new URL("../../e2e/testRuntime.ts", import.meta.url).pathname,
              "#verification-route": new URL("../../e2e/serviceRoute.ts", import.meta.url).pathname,
              "#verification-programs": new URL(
                `../../${process.env["E2E_SERVICE_PROGRAMS"] ?? "e2e/scenarios/services.ts"}`,
                import.meta.url,
              ).pathname,
            }
          : {}),
        ...(target === undefined
          ? {}
          : { "#deployment-target": new URL(target.module, import.meta.url).pathname }),
      },
    },
  };
});

function readDeploymentTarget(command: "build" | "serve"): DeploymentTargetBuild | undefined {
  const name = process.env["DEPLOY_TARGET"];
  if (name === undefined || name === "") {
    if (command === "build") {
      throw new Error(`DEPLOY_TARGET is required to build: ${targetNames()}.`);
    }
    return undefined;
  }
  if (!isDeploymentTargetName(name)) {
    throw new Error(`Unknown DEPLOY_TARGET "${name}": ${targetNames()}.`);
  }
  return deploymentTargets[name];
}

function isDeploymentTargetName(name: string): name is keyof typeof deploymentTargets {
  return Object.hasOwn(deploymentTargets, name);
}

function targetNames(): string {
  return Object.keys(deploymentTargets).join(", ");
}

type DeploymentTargetBuild = {
  readonly module: string;
  readonly beforeStart: () => Array<PluginOption>;
  readonly afterStart: () => Array<PluginOption>;
};
