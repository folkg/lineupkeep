import { assert, it } from "@effect/vitest";
import { Effect, Exit, Layer, Redacted, Schema, Tracer } from "effect";

import { safeTracerLayer } from "./Observability.ts";
import { makeWideEventTracer } from "./WideEventTracer.ts";

it.effect("writes one wide event for a request and one for each lineup run inside it", () =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    const exit = yield* Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        "request.id": "request-1",
        "user.id": "user-1",
        "app.operation": "lineup.submit",
        "app.outcome": "success",
        "lineup.run_count": 1,
      });
      yield* Effect.void.pipe(
        Effect.withSpan("LineupWorker.run", {
          attributes: {
            "lineup.run": "run-1",
            "lineup.request": "request-1",
            "team.id": "team-1",
            "connection.id": "connection-1",
            "lineup.outcome": "changed",
            "app.outcome": "success",
            "provider.operation": "read_roster",
            "provider.player_count": 13,
          },
        }),
      );
    }).pipe(
      Effect.withSpan("lineup.submit"),
      Effect.withSpan("http.server.request", {
        attributes: { "http.request.method": "POST", "url.path": "/api/lineup" },
        kind: "server",
      }),
      Effect.exit,
      Effect.provide(wideEventLayer(lines)),
    );

    assert.isTrue(Exit.isSuccess(exit));
    assert.strictEqual(lines.length, 2);
    const [run, request] = yield* decodeEntries(lines);

    assert.strictEqual(run?.event.kind, "lineup_run");
    assert.strictEqual(run?.event.run_id, "run-1");
    assert.strictEqual(run?.event.lineup_request, "request-1");
    assert.strictEqual(run?.event.team_id, "team-1");
    assert.strictEqual(run?.event.connection_id, "connection-1");
    assert.strictEqual(run?.event.operation, "LineupWorker.run");
    assert.strictEqual(run?.event.outcome, "ok");
    assert.strictEqual(run?.event.span_count, 1);
    assert.strictEqual(run?.event.attributes["provider.player_count"], 13);
    assert.strictEqual(run?.severity, "INFO");
    assert.match(run?.message ?? "", /^lineup run run-1 ok \d+\.\dms$/u);

    assert.strictEqual(request?.event.kind, "http_request");
    assert.strictEqual(request?.event.operation, "lineup.submit");
    assert.strictEqual(request?.event.route, "POST /api/lineup");
    assert.strictEqual(request?.event.request_id, "request-1");
    assert.strictEqual(request?.event.actor, "user-1");
    assert.strictEqual(request?.event.team_id, "team-1");
    assert.strictEqual(request?.event.outcome, "ok");
    assert.strictEqual(request?.event.status_code, undefined);
    assert.strictEqual(request?.event.span_count, 3);
    assert.deepStrictEqual(request?.event.spans.map((span) => span.name).sort(), [
      "LineupWorker.run",
      "lineup.submit",
    ]);
    assert.deepStrictEqual(
      request?.event.spans.map((span) => span.count),
      [1, 1],
    );
    assert.strictEqual(
      request?.["logging.googleapis.com/trace"],
      run?.["logging.googleapis.com/trace"],
    );
    assert.match(request?.["logging.googleapis.com/trace"] ?? "", /^[0-9a-f]{32}$/u);
    assert.notStrictEqual(
      request?.["logging.googleapis.com/spanId"],
      run?.["logging.googleapis.com/spanId"],
    );
    assert.isTrue(request?.["logging.googleapis.com/trace_sampled"] ?? false);
  }),
);

it.effect("never carries a token, cookie, crumb, note, address or provider payload", () =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    yield* Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      span.attribute("authorization", "private-token");
      span.attribute("session.cookie", "private-cookie");
      span.attribute("provider.crumb", "private-crumb");
      span.attribute("note.body", "private-note");
      span.attribute("recipient.email", "private-email");
      span.attribute("provider.payload", { players: ["private-player"] });
      span.attribute("parameters", { body: "private-parameters" });
      span.attribute("secret.credential", Redacted.make("private-secret"));
      span.attribute("orders.changed_count", 3);
    }).pipe(
      Effect.withSpan("http.server.request", {
        attributes: { "http.request.method": "GET", "url.path": "/connections" },
        kind: "server",
      }),
      Effect.provide(wideEventLayer(lines)),
    );

    assert.strictEqual(lines.length, 1);
    const entry = yield* decodeEntry(lines[0] ?? "");
    assert.strictEqual(entry.event.attributes["orders.changed_count"], 3);
    assert.notProperty(entry.event.attributes, "authorization");
    assert.notProperty(entry.event.attributes, "session.cookie");
    assert.notProperty(entry.event.attributes, "provider.crumb");
    assert.notProperty(entry.event.attributes, "note.body");
    assert.notProperty(entry.event.attributes, "recipient.email");
    assert.notProperty(entry.event.attributes, "provider.payload");
    assert.notProperty(entry.event.attributes, "parameters");
    assert.strictEqual(entry.event.attributes["secret.credential"], "[REDACTED]");
    assert.notInclude(lines.join(""), "private-");
  }),
);

it.effect("names the MCP tool a request served", () =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    yield* Effect.void.pipe(
      Effect.withSpan("mcp.request", {
        attributes: {
          "app.operation": "mcp.request",
          "app.outcome": "success",
          tool: "search_players",
          parameters: { query: "private-query" },
        },
      }),
      Effect.withSpan("http.server.request", {
        attributes: { "http.request.method": "POST", "url.path": "/api/mcp" },
        kind: "server",
      }),
      Effect.provide(wideEventLayer(lines)),
    );

    assert.strictEqual(lines.length, 1);
    const entry = yield* decodeEntry(lines[0] ?? "");
    assert.strictEqual(entry.event.operation, "mcp.request");
    assert.strictEqual(entry.event.tool, "search_players");
    assert.strictEqual(entry.event.route, "POST /api/mcp");
    assert.notInclude(lines.join(""), "private-");
  }),
);

it.effect("carries business attributes without repeating transport statement detail", () =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    yield* Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan("team.id", "team-1");
      yield* Effect.void.pipe(
        Effect.withSpan("postgres", {
          attributes: {
            "db.query.text": 'select * from "private_table"',
            "db.system.name": "postgresql",
            "server.address": "localhost",
            "server.port": 5432,
          },
        }),
      );
    }).pipe(
      Effect.withSpan("http.server.request", {
        attributes: { "http.request.method": "GET", "url.path": "/teams" },
        kind: "server",
      }),
      Effect.provide(wideEventLayer(lines)),
    );

    assert.strictEqual(lines.length, 1);
    const entry = yield* decodeEntry(lines[0] ?? "");
    assert.match(entry.message, /^GET \/teams ok /u);
    assert.strictEqual(entry.event.route, "GET /teams");
    assert.strictEqual(entry.event.attributes["team.id"], "team-1");
    assert.notProperty(entry.event.attributes, "db.query.text");
    assert.notProperty(entry.event.attributes, "db.system.name");
    assert.notProperty(entry.event.attributes, "server.address");
    assert.notProperty(entry.event.attributes, "server.port");
    assert.deepStrictEqual(
      entry.event.spans.map((span) => span.name),
      ["postgres"],
    );
  }),
);

it.effect(
  "keeps a failed run as its own error entry and reads the failure from its own spans",
  () =>
    Effect.gen(function* () {
      const lines: Array<string> = [];
      yield* Effect.fail("private-failure").pipe(
        Effect.withSpan("LineupWorker.run", {
          attributes: {
            "lineup.run": "run-1",
            "lineup.outcome": "failed",
            "lineup.failure_reason": "provider_rejected",
            "error.type": "provider.request_failed",
            "app.outcome": "failure",
          },
        }),
        Effect.exit,
        Effect.withSpan("http.server.request", {
          attributes: { "http.request.method": "POST", "url.path": "/api/internal/lineup-worker" },
          kind: "server",
        }),
        Effect.exit,
        Effect.provide(wideEventLayer(lines)),
      );

      assert.strictEqual(lines.length, 2);
      const [run, request] = yield* decodeEntries(lines);
      assert.strictEqual(run?.event.outcome, "failed");
      assert.strictEqual(run?.severity, "ERROR");
      assert.strictEqual(run?.event.attributes["lineup.failure_reason"], "provider_rejected");
      assert.strictEqual(request?.event.outcome, "failed");
      assert.strictEqual(request?.event.kind, "http_request");
      assert.notInclude(lines.join(""), "private-");
    }),
);

it.effect("records a rejected operation as a warning without widening privacy", () =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    yield* Effect.void.pipe(
      Effect.withSpan("teams.list", {
        attributes: { "app.operation": "teams.list", "app.outcome": "rejected" },
      }),
      Effect.withSpan("http.server.request", {
        attributes: { "http.request.method": "GET", "url.path": "/teams" },
        kind: "server",
      }),
      Effect.provide(wideEventLayer(lines)),
    );

    assert.strictEqual(lines.length, 1);
    const entry = yield* decodeEntry(lines[0] ?? "");
    assert.strictEqual(entry.event.outcome, "rejected");
    assert.strictEqual(entry.severity, "WARNING");
    assert.strictEqual(entry.event.operation, "teams.list");
  }),
);

it.effect("passes every span to the exporter unchanged", () =>
  Effect.gen(function* () {
    const exported: Array<string> = [];
    const inner = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (time, exit) => {
          end(time, exit);
          exported.push(`${span.name}:${String(span.attributes.get("team.id"))}`);
        };
        return span;
      },
    });
    const layer = safeTracerLayer.pipe(
      Layer.provideMerge(
        Layer.succeed(Tracer.Tracer)(makeWideEventTracer({ inner, write: () => undefined })),
      ),
    );

    yield* Effect.void.pipe(
      Effect.withSpan("LineupWorker.run", { attributes: { "team.id": "team-1" } }),
      Effect.withSpan("http.server.request", {
        attributes: { "http.request.method": "GET", "url.path": "/teams" },
        kind: "server",
      }),
      Effect.provide(layer),
    );

    assert.deepStrictEqual(exported, ["LineupWorker.run:team-1", "http.server.request:undefined"]);
  }),
);

it.effect("never fails the operation when the log writer is unavailable", () =>
  Effect.gen(function* () {
    const result = yield* Effect.succeed("ok").pipe(
      Effect.withSpan("http.server.request", {
        attributes: { "http.request.method": "GET", "url.path": "/" },
        kind: "server",
      }),
      Effect.provide(
        safeTracerLayer.pipe(
          Layer.provideMerge(
            Layer.succeed(Tracer.Tracer)(
              makeWideEventTracer({
                inner: Tracer.nativeTracer,
                write: () => {
                  throw new Error("private-stdout-failure");
                },
              }),
            ),
          ),
        ),
      ),
    );

    assert.strictEqual(result, "ok");
  }),
);

function wideEventLayer(lines: Array<string>): Layer.Layer<never> {
  return safeTracerLayer.pipe(
    Layer.provideMerge(
      Layer.succeed(Tracer.Tracer)(
        makeWideEventTracer({ inner: Tracer.nativeTracer, write: (line) => lines.push(line) }),
      ),
    ),
  );
}

function decodeEntries(
  lines: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Entry>, Schema.SchemaError> {
  return Effect.forEach(lines, decodeEntry);
}

function decodeEntry(line: string): Effect.Effect<Entry, Schema.SchemaError> {
  return Schema.decodeEffect(Schema.fromJsonString(Entry))(line);
}

const Entry = Schema.Struct({
  severity: Schema.Literals(["INFO", "WARNING", "ERROR"]),
  message: Schema.String,
  "logging.googleapis.com/trace": Schema.String,
  "logging.googleapis.com/spanId": Schema.String,
  "logging.googleapis.com/trace_sampled": Schema.Boolean,
  event: Schema.Struct({
    kind: Schema.Literals(["http_request", "lineup_run"]),
    operation: Schema.String,
    route: Schema.optional(Schema.String),
    tool: Schema.optional(Schema.String),
    request_id: Schema.optional(Schema.String),
    lineup_request: Schema.optional(Schema.String),
    run_id: Schema.optional(Schema.String),
    actor: Schema.optional(Schema.String),
    connection_id: Schema.optional(Schema.String),
    team_id: Schema.optional(Schema.String),
    outcome: Schema.String,
    status_code: Schema.optional(Schema.Finite),
    duration_ms: Schema.Finite,
    span_count: Schema.Finite,
    spans: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        count: Schema.Finite,
        total_ms: Schema.Finite,
        max_ms: Schema.Finite,
      }),
    ),
    attributes: Schema.Record(Schema.String, Schema.Unknown),
  }),
});

type Entry = typeof Entry.Type;
