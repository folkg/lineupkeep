import { createServer, isIP } from "node:net";

import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import * as Output from "alchemy/Output";
import { Stage } from "alchemy/Stage";
import { Effect, Layer, Redacted, Schema } from "effect";

import { buildNodeImage } from "#infra/build/node.ts";
import { localDatabaseName } from "#infra/local/Postgres.ts";
import { HostDeployment } from "#infra/services/HostDeployment.ts";
import type { HostEnvironment, LocalHostOptions } from "#infra/services/HostDeployment.ts";

export function localContainerHost(
  environment: HostEnvironment,
  options: LocalHostOptions = {},
): Layer.Layer<
  HostDeployment,
  never,
  | Docker.Docker
  | import("alchemy").Provider<Command.Build>
  | import("alchemy").Provider<Command.Dev>
  | Docker.Providers
  | Stage
> {
  return Layer.effect(HostDeployment)(
    Effect.gen(function* () {
      const docker = yield* Docker.Docker;
      const bridge = Schema.decodeUnknownSync(BridgeNetwork)(
        yield* docker.network.inspect("bridge").pipe(Effect.orDie),
      );
      const gateways = bridge.IPAM.Config.flatMap(({ Gateway }) =>
        Gateway === undefined || Gateway === "" ? [] : [Gateway],
      );
      const ownedAddresses = yield* Effect.promise(() => bindableAddresses(gateways));
      const relayNetwork = containerRelayNetwork(process.platform, gateways, ownedAddresses);
      const image = yield* buildNodeImage(options.programs);
      const containerEnvironment = { ...environment };

      for (const name of ["DATABASE_URL", "RESEND_API_BASE_URL", "OTEL_EXPORTER_OTLP_ENDPOINT"]) {
        const value = environment[name];
        if (value === undefined) {
          continue;
        }
        const endpoint = Output.map(Output.asOutput(value), (input) => {
          const url = new URL(Redacted.isRedacted(input) ? Redacted.value(input) : input);
          return {
            value: input,
            url,
            secret: Redacted.isRedacted(input),
            loopback: ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
          };
        });
        const relay = yield* Command.Dev(`Relay-${name}`, {
          cwd: new URL("../../", import.meta.url).pathname,
          command: "node infra/local/loopbackRelay.ts",
          env: {
            RELAY_HOST: Output.map(endpoint, ({ url }) => url.hostname.replace(/^\[|\]$/gu, "")),
            RELAY_BIND: Output.map(endpoint, ({ loopback }) =>
              loopback ? relayNetwork.bind : "127.0.0.1",
            ),
            RELAY_PORT: Output.map(
              endpoint,
              ({ url }) =>
                url.port ||
                (url.protocol === "postgres:" || url.protocol === "postgresql:"
                  ? "5432"
                  : url.protocol === "https:"
                    ? "443"
                    : "80"),
            ),
          },
        });
        containerEnvironment[name] = Output.map(
          Output.all(endpoint, relay.url),
          ([original, address]) => {
            if (address === undefined) {
              throw new Error("Container relay did not report an assigned port");
            }
            if (!original.loopback) {
              return original.value;
            }
            const url = new URL(original.url.href);
            url.hostname = "host.docker.internal";
            url.port = new URL(address).port;
            return original.secret ? Redacted.make(url.href) : url.href;
          },
        );
      }
      const ownership = options.ownership ?? {
        name: localDatabaseName(yield* Stage),
        lockDirectory: new URL("../.alchemy", import.meta.url).pathname,
      };
      const web = yield* Docker.Container("Web", {
        name: `${ownership.name}-web`,
        image,
        environment: {
          ...containerEnvironment,
          NODE_ENV: "production",
          HOST: "0.0.0.0",
          PORT: "3000",
        },
        ports: [
          {
            external: "127.0.0.1:",
            internal: 3000,
          },
        ],
        labels: { "lineupkeep.disposable": "test-web", "lineupkeep.lock": ownership.lockDirectory },
        networkMode: "bridge",
        extraHosts: [`host.docker.internal:${relayNetwork.host}`],
        stopTimeout: "30 seconds",
        start: true,
      });
      const url = Output.map(web.ports, (ports) => {
        const port = ports["3000/tcp"];
        if (port === undefined) {
          throw new Error("Container did not publish its application port");
        }
        return `http://127.0.0.1:${port}`;
      });
      return { url, healthUrl: url, artifact: image.imageRef };
    }),
  );
}

export function containerRelayNetwork(
  platform: NodeJS.Platform,
  gateways: ReadonlyArray<string>,
  ownedAddresses: ReadonlyArray<string>,
): { readonly bind: string; readonly host: string } {
  if (platform === "darwin") {
    return { bind: "127.0.0.1", host: "host-gateway" };
  }
  const gateway = gateways.find(
    (address) => isIP(address) === 4 && address !== "0.0.0.0" && ownedAddresses.includes(address),
  );
  if (platform !== "linux" || gateway === undefined) {
    throw new Error(
      `Cannot determine a safe Docker bridge relay address on this host; inspected bridge gateways: ${describeAddresses(gateways)}; addresses the host could bind: ${describeAddresses(ownedAddresses)}`,
    );
  }
  return { bind: gateway, host: "host-gateway" };
}

async function bindableAddresses(addresses: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
  const attempts = await Promise.all(
    addresses.map(async (address) => ((await canListenOn(address)) ? address : undefined)),
  );
  return attempts.filter((address): address is string => address !== undefined);
}

function canListenOn(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", () => resolve(false));
    server.listen(0, address, () => {
      server.close(() => resolve(true));
    });
  });
}

function describeAddresses(addresses: ReadonlyArray<string>): string {
  return addresses.length === 0 ? "none" : addresses.join(", ");
}

const BridgeNetwork = Schema.Struct({
  IPAM: Schema.Struct({
    Config: Schema.Array(Schema.Struct({ Gateway: Schema.optional(Schema.String) })),
  }),
});
