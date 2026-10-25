import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { Schema } from "effect";

const endpoint = new URL(readRequired("OTEL_EXPORTER_OTLP_ENDPOINT"));
const evidence = join(readRequired("VERIFICATION_DIR"), "server-spans.jsonl");
const spans: Array<CollectedSpan> = [];
const seen = new Set<string>();

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", endpoint);
  if (request.method === "POST" && url.pathname === "/v1/traces") {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const received = collectSpans(
        Schema.decodeUnknownSync(ExportJson)(Buffer.concat(chunks).toString("utf8")),
      ).filter((span) => !seen.has(`${span.traceId}/${span.spanId}`));
      for (const span of received) {
        seen.add(`${span.traceId}/${span.spanId}`);
      }
      for (const span of received) {
        spans.push(span);
      }
      appendFileSync(evidence, received.map((span) => `${JSON.stringify(span)}\n`).join(""));
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/spans") {
    const trace = url.searchParams.get("trace");
    const inTrace = spans.filter((span) => span.traceId === trace);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(inTrace));
    return;
  }
  response.writeHead(request.method === "GET" && url.pathname === "/" ? 200 : 404).end();
});
server.listen(Number(endpoint.port), endpoint.hostname, () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Trace collector has no assigned address");
  }
  console.log(`Trace collector ready: http://127.0.0.1:${address.port}`);
});

function collectSpans(body: typeof ExportJson.Type): Array<CollectedSpan> {
  return body.resourceSpans.flatMap((resource) =>
    resource.scopeSpans.flatMap((scope) =>
      scope.spans.map((span) => {
        const startMs = nanosToMillis(span.startTimeUnixNano);
        const endMs = nanosToMillis(span.endTimeUnixNano);
        return {
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId === "" ? undefined : span.parentSpanId,
          name: span.name,
          startMs,
          endMs,
          durationMs: Math.round((endMs - startMs) * 10) / 10,
          attributes: attributesOf(span.attributes),
          events: (span.events ?? []).map((event) => ({
            name: event.name,
            timeMs: nanosToMillis(event.timeUnixNano),
            attributes: attributesOf(event.attributes),
          })),
          ...(span.status?.code === 2
            ? {
                error:
                  span.status.message === undefined || span.status.message === ""
                    ? "error"
                    : span.status.message,
              }
            : {}),
        };
      }),
    ),
  );
}

function attributesOf(
  attributes:
    | ReadonlyArray<{ readonly key: string; readonly value: Readonly<Record<string, unknown>> }>
    | undefined,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    (attributes ?? []).map((attribute) => [attribute.key, Object.values(attribute.value)[0]]),
  );
}

function nanosToMillis(value: string | number): number {
  return Number(BigInt(value) / 1000n) / 1000;
}

function readRequired(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is required; the browser verification harness starts this collector.`);
  }
  return value;
}

const Attribute = Schema.Struct({
  key: Schema.String,
  value: Schema.Record(Schema.String, Schema.Unknown),
});

const ExportJson = Schema.fromJsonString(
  Schema.Struct({
    resourceSpans: Schema.Array(
      Schema.Struct({
        scopeSpans: Schema.Array(
          Schema.Struct({
            spans: Schema.Array(
              Schema.Struct({
                traceId: Schema.String,
                spanId: Schema.String,
                parentSpanId: Schema.optional(Schema.String),
                name: Schema.String,
                startTimeUnixNano: Schema.Union([Schema.String, Schema.Number]),
                endTimeUnixNano: Schema.Union([Schema.String, Schema.Number]),
                attributes: Schema.optional(Schema.Array(Attribute)),
                events: Schema.optional(
                  Schema.Array(
                    Schema.Struct({
                      name: Schema.String,
                      timeUnixNano: Schema.Union([Schema.String, Schema.Number]),
                      attributes: Schema.optional(Schema.Array(Attribute)),
                    }),
                  ),
                ),
                status: Schema.optional(
                  Schema.Struct({
                    code: Schema.optional(Schema.Number),
                    message: Schema.optional(Schema.String),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
);

type CollectedSpan = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly events: ReadonlyArray<{
    readonly name: string;
    readonly timeMs: number;
    readonly attributes: Readonly<Record<string, unknown>>;
  }>;
  readonly error?: string;
};
