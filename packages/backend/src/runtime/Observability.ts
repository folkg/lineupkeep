import {
  Config,
  Console,
  Duration,
  Effect,
  Layer,
  Logger,
  Option,
  Tracer,
  Cause,
  Exit,
} from "effect";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/observability";

import { appEnvironmentConfig, type AppEnvironment } from "#config/AppEnvironment.ts";

import { telemetryHttpClientLayer } from "./GoogleCloudTelemetry.ts";
import { makePrettyConsoleTracer } from "./PrettyConsoleTracer.ts";
import { makeWideEventTracer } from "./WideEventTracer.ts";
export const safeTracerLayer = Layer.effect(
  Tracer.Tracer,
  Effect.map(Tracer.Tracer, makeSafeTracer),
);

export function makeObservabilityLive(
  options: ObservabilityOptions,
): Layer.Layer<OtlpExporter.Flusher, Config.ConfigError, never> {
  return Layer.unwrap(
    Effect.map(loadObservabilityConfig(), (config) =>
      Layer.merge(
        Logger.layer(
          options.wideEvents
            ? [Logger.tracerLogger, Logger.consolePretty({ colors: false })]
            : [Logger.tracerLogger],
        ),
        safeTracerLayer.pipe(Layer.provideMerge(innerTracerLayer(config, options))),
      ),
    ),
  );
}

function loadObservabilityConfig(): Config.Config<{
  environment: "development" | "production" | "test";
  otlpExporter: string;
  otlpProtocol: "http/json" | "http/protobuf";
  googleCloudTelemetry: boolean;
  serviceName: string;
  serviceVersion: string;
  slowSpanThreshold: Duration.Duration;
}> {
  return Config.all({
    environment: appEnvironmentConfig,
    otlpExporter: Config.String("OTEL_TRACES_EXPORTER").pipe(Config.withDefault("none")),
    otlpProtocol: Config.Literals(
      ["http/json", "http/protobuf"],
      "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
    ).pipe(
      Config.orElse(() =>
        Config.Literals(["http/json", "http/protobuf"], "OTEL_EXPORTER_OTLP_PROTOCOL"),
      ),
      Config.withDefault("http/protobuf" as const),
    ),
    googleCloudTelemetry: Config.option(
      Config.URL("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT").pipe(
        Config.orElse(() => Config.URL("OTEL_EXPORTER_OTLP_ENDPOINT")),
      ),
    ).pipe(
      Config.map(Option.exists((endpoint) => endpoint.hostname === "telemetry.googleapis.com")),
    ),
    serviceName: Config.String("OTEL_SERVICE_NAME").pipe(
      Config.orElse(() => Config.String("K_SERVICE")),
      Config.withDefault("lineupkeep-web"),
    ),
    serviceVersion: Config.String("SERVICE_VERSION").pipe(
      Config.orElse(() => Config.String("K_REVISION")),
      Config.withDefault("development"),
    ),
    slowSpanThreshold: Config.Duration("DEV_SLOW_SPAN_THRESHOLD").pipe(
      Config.withDefault(Duration.millis(100)),
    ),
  });
}

function innerTracerLayer(
  config: ObservabilityConfig,
  options: ObservabilityOptions,
): Layer.Layer<OtlpExporter.Flusher, never, never> {
  if (config.environment === "development") {
    const prettyTracer = Layer.effect(
      Tracer.Tracer,
      Effect.map(Console.Console, (console) =>
        makePrettyConsoleTracer({
          slowSpanThreshold: config.slowSpanThreshold,
          write: (line) => console.log(line),
        }),
      ),
    );
    return Layer.merge(prettyTracer, OtlpExporter.layerFlusher);
  }

  const exporter = otlpExporterLayer(config);
  if (!options.wideEvents) {
    return Layer.merge(exporter ?? Layer.empty, OtlpExporter.layerFlusher);
  }

  const wideEvents = Layer.effect(
    Tracer.Tracer,
    Effect.gen(function* () {
      const inner = yield* Tracer.Tracer;
      const console = yield* Console.Console;
      return makeWideEventTracer({
        inner,
        write: options.write ?? ((line) => console.log(line)),
      });
    }),
  );
  return Layer.merge(
    wideEvents.pipe(Layer.provideMerge(exporter ?? Layer.empty)),
    OtlpExporter.layerFlusher,
  );
}

function otlpExporterLayer(
  config: ObservabilityConfig,
): Layer.Layer<OtlpExporter.Flusher, never, never> | undefined {
  if (config.otlpExporter !== "otlp") {
    return undefined;
  }
  return OtlpTracer.layerFromConfig({
    resource: {
      attributes: {
        "deployment.environment.name": config.environment,
      },
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
    },
  }).pipe(
    Layer.provide(
      config.otlpProtocol === "http/json"
        ? OtlpSerialization.layerJson
        : OtlpSerialization.layerProtobuf,
    ),
    Layer.provide(telemetryHttpClientLayer({ googleCloud: config.googleCloudTelemetry })),
  );
}

function makeSafeTracer(tracer: Tracer.Tracer): Tracer.Tracer {
  return Tracer.make({
    context: tracer.context?.bind(tracer),
    span(options) {
      const span = tracer.span({ ...options, links: options.links.map(safeLink) });
      const attribute = span.attribute.bind(span);
      const event = span.event.bind(span);
      const addLinks = span.addLinks.bind(span);
      const end = span.end.bind(span);

      span.attribute = (key, value) => {
        if (isSuppressedAttribute(key, span.kind)) {
          return;
        }
        attribute(key, key === "effect.cause" ? "operation.failed" : value);
      };
      span.event = (name, time, attributes) =>
        event(
          name,
          time,
          name === "exception"
            ? { "exception.type": "operation.failed", "exception.message": "operation.failed" }
            : safeAttributes(attributes ?? {}, span.kind),
        );
      span.addLinks = (links) => addLinks(links.map(safeLink));
      span.end = (time, exit) => end(time, safeExit(exit));
      return span;
    },
  });
}

function safeExit(exit: Exit.Exit<unknown, unknown>): Exit.Exit<void, unknown> {
  if (Exit.isSuccess(exit)) {
    return Exit.void;
  }
  return Exit.failCause(
    Cause.fromReasons(
      exit.cause.reasons.map((reason) => {
        switch (reason._tag) {
          case "Fail":
            return Cause.makeFailReason(safeError("operation.failed"));
          case "Die":
            return Cause.makeDieReason(safeError("operation.defect"));
          case "Interrupt":
            return Cause.makeInterruptReason(reason.fiberId);
        }
      }),
    ),
  );
}

function safeError(code: string): {
  _tag: string;
  name: string;
  message: string;
  stack: string;
} {
  return { _tag: code, name: code, message: code, stack: code };
}

function safeLink(link: Tracer.SpanLink): Tracer.SpanLink {
  return { ...link, attributes: safeAttributes(link.attributes) };
}

function safeAttributes(
  attributes: Readonly<Record<string, unknown>>,
  kind?: Tracer.SpanKind,
): {
  [k: string]: unknown;
} {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([key]) => !isSuppressedAttribute(key, kind))
      .map(([key, value]) => [key, key === "effect.cause" ? "operation.failed" : value]),
  );
}

function isSuppressedAttribute(key: string, kind?: Tracer.SpanKind): boolean {
  return (
    key === "parameters" ||
    key === "error.message" ||
    key.startsWith("error.stack") ||
    key.startsWith("exception.") ||
    key === "url.full" ||
    key === "url.query" ||
    (kind === "client" && key === "url.path") ||
    key.startsWith("http.request.header.") ||
    key.startsWith("http.response.header.")
  );
}

type ObservabilityOptions = {
  readonly wideEvents: boolean;
  readonly write?: (line: string) => void;
};

type ObservabilityConfig = {
  readonly environment: AppEnvironment;
  readonly otlpExporter: string;
  readonly otlpProtocol: "http/json" | "http/protobuf";
  readonly googleCloudTelemetry: boolean;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly slowSpanThreshold: Duration.Duration;
};
