import { resolve } from "node:path";

import * as Command from "alchemy/Command";
import * as Output from "alchemy/Output";
import { Effect, Layer } from "effect";

import { buildNode } from "#infra/build/node.ts";
import { HostDeployment } from "#infra/services/HostDeployment.ts";
import type { HostEnvironment, LocalHostOptions } from "#infra/services/HostDeployment.ts";

export function localNodeHost(
  environment: HostEnvironment,
  options: LocalHostOptions = {},
): Layer.Layer<
  HostDeployment,
  never,
  import("alchemy").Provider<Command.Build> | import("alchemy").Provider<Command.Dev>
> {
  return Layer.effect(HostDeployment)(
    Effect.gen(function* () {
      if (options.development === true) {
        const web = yield* Command.Dev("Web", {
          cwd: new URL("../../apps/web", import.meta.url).pathname,
          command:
            "node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000 --strictPort --configLoader runner",
          env: {
            ...environment,
            NODE_ENV: "development",
            BUILD_WITHOUT_DOTENV: "true",
            DEVELOPMENT_STACK: "true",
            DEPLOY_TARGET: "node",
          },
        });
        return { url: web.url, healthUrl: web.url, artifact: "vite-development" };
      }
      const build = yield* buildNode(options.programs);
      const web = yield* Command.Dev("Web", {
        command:
          options.inspector === true
            ? "node --inspect=127.0.0.1:0 infra/local/nodeEntry.ts"
            : "node infra/local/nodeEntry.ts",
        cwd: new URL("../../", import.meta.url).pathname,
        env: {
          ...environment,
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          PORT: "0",
          NODE_PRODUCTION_ENTRY: Output.map(build.outdir, (directory) =>
            resolve(directory, "server/index.mjs"),
          ),
        },
      });
      return {
        url: web.url,
        healthUrl: web.url,
        artifact: build.outdir,
      };
    }),
  );
}
