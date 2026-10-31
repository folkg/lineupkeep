import { assert, it } from "@effect/vitest";
import { Effect, Exit, Layer, Schema, Tracer } from "effect";

import { makeCloudLoggingTracer } from "./CloudLoggingTracer.ts";
import { safeTracerLayer } from "./Observability.ts";

it.effect("writes one bounded structured entry for a completed span", () =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    const layer = safeTracerLayer.pipe(
      Layer.provide(
        Layer.succeed(Tracer.Tracer)(
          makeCloudLoggingTracer({
            serviceName: "lineupkeep-test",
            serviceVersion: "test",
            write: (line) => lines.push(line),
          }),
        ),
      ),
    );

    const exit = yield* Effect.gen(function* () {
      const span = yield* Effect.currentSpan;
      span.attribute("team.id", "team-1");
      span.attribute("lineup.run", "run-1");
      span.attribute("provider.operation", "read_roster");
      span.attribute("note.body", "private-note");
      span.attribute("session.cookie", "private-cookie");
      span.attribute("player.list", { players: ["private-player"] });
      span.attribute("authorization", "private-token");
      span.attribute("orders.changed_count", 3);
      return yield* Effect.fail("private-failure");
    }).pipe(Effect.withSpan("LineupWorker.run"), Effect.exit, Effect.provide(layer));

    assert.isTrue(Exit.isFailure(exit));
    assert.strictEqual(lines.length, 1);
    const entry = yield* Schema.decodeEffect(Schema.fromJsonString(Entry))(lines[0] ?? "");
    assert.strictEqual(entry.severity, "ERROR");
    assert.include(entry.message, "LineupWorker.run failed");
    assert.match(entry["logging.googleapis.com/trace"], /^[0-9a-f]{32}$/u);
    assert.match(entry["logging.googleapis.com/spanId"], /^[0-9a-f]{16}$/u);
    assert.isTrue(entry["logging.googleapis.com/trace_sampled"]);
    assert.strictEqual(entry.span.kind, "internal");
    assert.strictEqual(entry.span.outcome, "failed");
    assert.strictEqual(entry.span.service, "lineupkeep-test");
    assert.strictEqual(entry.span.attributes["team.id"], "team-1");
    assert.strictEqual(entry.span.attributes["lineup.run"], "run-1");
    assert.strictEqual(entry.span.attributes["provider.operation"], "read_roster");
    assert.strictEqual(entry.span.attributes["orders.changed_count"], 3);
    assert.notProperty(entry.span.attributes, "note.body");
    assert.notProperty(entry.span.attributes, "session.cookie");
    assert.notProperty(entry.span.attributes, "player.list");
    assert.notProperty(entry.span.attributes, "authorization");
    assert.notInclude(lines.join(""), "private-");
  }),
);

it.effect("never fails the operation when the log writer is unavailable", () =>
  Effect.gen(function* () {
    const layer = Layer.succeed(Tracer.Tracer)(
      makeCloudLoggingTracer({
        serviceName: "lineupkeep-test",
        serviceVersion: "test",
        write: () => {
          throw new Error("private-stdout-failure");
        },
      }),
    );

    const result = yield* Effect.succeed("ok").pipe(
      Effect.withSpan("LineupWorker.run"),
      Effect.provide(layer),
    );

    assert.strictEqual(result, "ok");
  }),
);

const Entry = Schema.Struct({
  severity: Schema.String,
  message: Schema.String,
  "logging.googleapis.com/trace": Schema.String,
  "logging.googleapis.com/spanId": Schema.String,
  "logging.googleapis.com/trace_sampled": Schema.Boolean,
  span: Schema.Struct({
    kind: Schema.String,
    outcome: Schema.String,
    service: Schema.String,
    attributes: Schema.Record(Schema.String, Schema.Unknown),
  }),
});
