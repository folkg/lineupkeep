import {
  assertPublicRouting,
  workerConfiguration,
} from "@lineupkeep/web/deploy/cloudflare/settings.ts";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { Effect, Layer, Redacted } from "effect";

import { buildCloudflare } from "#infra/build/cloudflare.ts";
import type { DatabaseOutputs } from "#infra/services/DatabaseDeployment.ts";
import { HostDeployment } from "#infra/services/HostDeployment.ts";
import type { HostEnvironment, LocalHostOptions } from "#infra/services/HostDeployment.ts";

export function cloudflareHost(
  database: DatabaseOutputs,
  local: boolean,
  environment: HostEnvironment,
  options: LocalHostOptions = {},
): Layer.Layer<
  HostDeployment,
  never,
  import("alchemy").Provider<import("alchemy/Command/Build").Build> | Cloudflare.Providers
> {
  return Layer.effect(HostDeployment)(
    Effect.gen(function* () {
      const origin = Output.map(database.directUrl, postgresOrigin);
      const hyperdrive = yield* Cloudflare.Hyperdrive.Connection("Database", {
        origin,
        caching: { disabled: true },
        ...(local
          ? { dev: Output.map(origin, (value) => ({ ...value, sslmode: "disable" as const })) }
          : {}),
      });
      if (options.development === true) {
        const web = yield* Cloudflare.Website.Vite("Web", {
          rootDir: new URL("../../apps/web", import.meta.url).pathname,
          compatibility: workerConfiguration("").compatibility,
          env: { ...environment, HYPERDRIVE: hyperdrive },
          dev: { host: "127.0.0.1", port: 3000, strictPort: true },
        });
        return { url: web.url, healthUrl: web.url, artifact: "vite-development" };
      }
      const build = yield* buildCloudflare(options.programs);
      const props = {
        ...workerConfiguration(
          Output.map(build.outdir, (directory) => `${directory}/server/server.js`),
        ),
        assets: { directory: Output.map(build.outdir, (directory) => `${directory}/client`) },
        env: { ...environment, HYPERDRIVE: hyperdrive },
        dev: { host: "127.0.0.1", port: 0 },
      };
      assertPublicRouting(props);
      const worker = yield* Cloudflare.Worker("Web", props);
      return {
        url: worker.url,
        healthUrl: worker.url,
        artifact: props.main,
      };
    }),
  );
}

function postgresOrigin(value: Redacted.Redacted<string>): {
  scheme: "postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  password: Redacted.Redacted<string>;
} {
  const url = new URL(Redacted.value(value));
  return {
    scheme: "postgres" as const,
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: Redacted.make(decodeURIComponent(url.password)),
  };
}
