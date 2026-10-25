import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { OtlpSerialization, OtlpTracer } from "effect/observability";

import { safeTracerLayer } from "#runtime/Observability.ts";
export function makeTelemetryTest(): {
  layer: Layer.Layer<never, never, never>;
  read: () => {
    payloads: string[];
    spans: {
      readonly name: string;
      readonly spanId: string;
      readonly parentSpanId?: string | undefined;
      readonly status: {
        readonly code: number;
        readonly message?: string | undefined;
      };
      readonly attributes: readonly {
        readonly key: string;
        readonly value: unknown;
      }[];
      readonly events: readonly {
        readonly name: string;
        readonly attributes: readonly {
          readonly key: string;
          readonly value: unknown;
        }[];
      }[];
    }[];
  };
} {
  const payloads: Array<string> = [];
  const sink = HttpClient.make((request) => {
    if (request.body._tag !== "Uint8Array") {
      return Effect.die("Expected serialized OTLP bytes");
    }
    payloads.push(new TextDecoder().decode(request.body.body));
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 200 })));
  });
  const exporter = OtlpTracer.layer({
    url: "https://collector.test/v1/traces",
    resource: { serviceName: "privacy-test" },
  }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(Layer.succeed(HttpClient.HttpClient)(sink)),
  );

  return {
    layer: safeTracerLayer.pipe(Layer.provide(exporter)),
    read: () => ({
      payloads,
      spans: payloads.flatMap((payload) =>
        Schema.decodeSync(Schema.fromJsonString(TracePayload))(payload).resourceSpans.flatMap(
          (resource) => resource.scopeSpans.flatMap((scope) => scope.spans),
        ),
      ),
    }),
  };
}

const TracePayload = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      scopeSpans: Schema.Array(
        Schema.Struct({
          spans: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              spanId: Schema.String,
              parentSpanId: Schema.optional(Schema.String),
              status: Schema.Struct({
                code: Schema.Finite,
                message: Schema.optional(Schema.String),
              }),
              attributes: Schema.Array(
                Schema.Struct({ key: Schema.String, value: Schema.Unknown }),
              ),
              events: Schema.Array(
                Schema.Struct({
                  name: Schema.String,
                  attributes: Schema.Array(
                    Schema.Struct({ key: Schema.String, value: Schema.Unknown }),
                  ),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});
