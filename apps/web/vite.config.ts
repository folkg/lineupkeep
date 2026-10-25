import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";

import cloudflare from "@alchemy.run/cloudflare-runtime/vite";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import nodeAdapter from "crossws/adapters/node";
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
    afterStart: () => [
      nitro({
        preset: "node-server",
        features: { websocket: true },
        handlers: [
          {
            route: "/api/linking/session/:sessionId/stream",
            handler: fileURLToPath(
              new URL("./src/server/hostedLinking/nitroStream.ts", import.meta.url),
            ),
          },
        ],
      }),
    ],
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
      hostedBrowserStreamPlugin(),
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

const hostedBrowserUpgradeServers = new WeakSet<object>();

function hostedBrowserStreamPlugin(): PluginOption {
  return {
    name: "lineupkeep:hosted-browser-stream",
    apply: "serve",
    configureServer(server) {
      const httpServer = server.httpServer;
      if (httpServer === null || hostedBrowserUpgradeServers.has(httpServer)) {
        return;
      }
      hostedBrowserUpgradeServers.add(httpServer);
      const adapter = nodeAdapter({
        resolve: async (request) => {
          const runner: unknown = Reflect.get(server.environments.ssr, "runner");
          if (!isRunner(runner)) {
            throw new Error("The SSR environment cannot load the hosted browser route");
          }
          const stream: unknown = await runner.import(
            "#server/hostedLinking/hostedLinkingStream.ts",
          );
          if (!isHostedLinkingStream(stream)) {
            throw new Error("The SSR environment cannot handle the hosted browser route");
          }
          const pathname = new URL(request.url).pathname;
          const sessionId = pathname.split("/")[4];
          if (sessionId === undefined) {
            return {};
          }
          const hooks: unknown = await stream.hostedLinkingHooks(request, sessionId);
          return isRecord(hooks) ? hooks : {};
        },
      });
      httpServer.on(
        "upgrade",
        (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
          const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
          if (!pathname.startsWith("/api/linking/session/") || !pathname.endsWith("/stream")) {
            return;
          }
          void adapter.handleUpgrade(request, socket, head, upgradeRequest(request));
        },
      );
    },
  };
}

type HostedLinkingStream = {
  readonly hostedLinkingHooks: (
    request: Request,
    sessionId: string,
  ) => Promise<Record<string, unknown>>;
};

type Runner = {
  readonly import: (id: string) => Promise<unknown>;
};

function isRunner(value: unknown): value is Runner {
  return isRecord(value) && typeof value["import"] === "function";
}

function isHostedLinkingStream(value: unknown): value is HostedLinkingStream {
  return isRecord(value) && typeof value["hostedLinkingHooks"] === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function upgradeRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  return new Request(new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`), {
    method: request.method ?? "GET",
    headers,
  });
}

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
