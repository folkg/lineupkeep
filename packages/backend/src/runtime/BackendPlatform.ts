import { Duration, Effect } from "effect";
import type { Config, Layer } from "effect";
import * as OtlpExporter from "effect/observability/OtlpExporter";

import { DatabaseConnection } from "#database/DatabaseConnection.ts";

import { BackgroundWork } from "./BackgroundWork.ts";
import { makeObservabilityLive } from "./Observability.ts";
import { publicInternetIsolate } from "./public-internet/transport/isolate/PublicInternetIsolate.ts";
import { publicInternetProcess } from "./public-internet/transport/node/PublicInternetProcess.ts";
import type { PublicInternet } from "./PublicInternet.ts";

export type BackendPlatform = {
  readonly databaseLifetime: "process" | "invocation";
  readonly database: Layer.Layer<DatabaseConnection, Config.ConfigError>;
  readonly background: Layer.Layer<BackgroundWork>;
  readonly observability: Layer.Layer<OtlpExporter.Flusher, Config.ConfigError>;
  readonly publicInternet: Layer.Layer<PublicInternet>;
  readonly afterResponse: Effect.Effect<void, never, OtlpExporter.Flusher>;
};

export function longRunningProcess(): BackendPlatform {
  return {
    databaseLifetime: "process",
    database: DatabaseConnection.fromConfig({ idleTimeout: Duration.seconds(10) }),
    background: BackgroundWork.processLifetime,
    observability: makeObservabilityLive({ cloudLogging: true }),
    publicInternet: publicInternetProcess,
    afterResponse: Effect.void,
  };
}

export function isolate(options: {
  readonly waitUntil: WaitUntil;
  readonly connectionString: () => string;
}): BackendPlatform {
  return {
    databaseLifetime: "invocation",
    database: DatabaseConnection.fromConnectionString({
      connectionString: options.connectionString,
      prepareStatements: false,
    }),
    background: BackgroundWork.fromWaitUntil(options.waitUntil),
    observability: makeObservabilityLive({ cloudLogging: false }),
    publicInternet: publicInternetIsolate,
    afterResponse: flushTelemetry,
  };
}

const flushTelemetry = Effect.flatMap(OtlpExporter.Flusher, (flusher) => flusher.flush);

type WaitUntil = (promise: Promise<unknown>) => void;
