import { assert, it } from "@effect/vitest";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import {
  Cause,
  ConfigProvider,
  Console,
  Effect,
  Exit,
  Layer,
  Schema,
  Stream,
  Tracer,
} from "effect";
import { Tool, Toolkit } from "effect/ai";
import { HttpClient, HttpClientError } from "effect/http";

import { NotePersistenceFailed } from "#contexts/notes/Note.ts";

import { makeTelemetryTest } from "./internal/TelemetryTest.ts";
import { ObservabilityLive } from "./Observability.ts";

it.effect("exports failed SQL children without bind values or nested causes", () =>
  Effect.gen(function* () {
    const error = EffectDrizzleQueryError.make({
      query: "insert into notes (title, body) values ($1, $2)",
      params: ["private-sql-title", "private-sql-body"],
      cause: new Error("private-database-cause"),
    });
    const program = Effect.fail(error).pipe(
      Effect.withSpan("sql.execute"),
      Effect.mapError((cause) => NotePersistenceFailed.make({ cause })),
      Effect.withSpan("notes.create"),
    );

    const telemetry = makeTelemetryTest();
    const exit = yield* Effect.exit(program).pipe(Effect.provide(telemetry.layer));
    const { payloads, spans } = telemetry.read();

    assert.isTrue(Exit.isFailure(exit));
    assert.strictEqual(spans.length, 2);
    assert.strictEqual(spans[0]?.parentSpanId, spans[1]?.spanId);
    assert.strictEqual(spans[0]?.status.message, "operation.failed");
    assert.strictEqual(spans[0]?.events[0]?.name, "exception");
    assert.notInclude(payloads.join(""), "private-");
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause);
      assert.isTrue(failure._tag === "Some");
      if (failure._tag === "Some") {
        assert.strictEqual(failure.value.cause, error);
      }
    }
  }),
);

it.effect("exports real Toolkit calls without raw MCP parameters", () =>
  Effect.gen(function* () {
    const toolkit = Toolkit.make(
      Tool.make("create_note", {
        parameters: Schema.Struct({ title: Schema.String, body: Schema.String }),
        success: Schema.Void,
      }),
    );
    const program = Effect.gen(function* () {
      const ready = yield* toolkit;
      const output = yield* ready.handle("create_note", {
        title: "private-tool-title",
        body: "private-tool-body",
      });
      yield* Stream.runDrain(output);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        toolkit.toLayer({ create_note: () => Effect.void.pipe(Effect.withSpan("mcp.tool")) }),
      ),
      Effect.withSpan("mcp.request"),
    );

    const telemetry = makeTelemetryTest();
    const exit = yield* Effect.exit(program).pipe(Effect.provide(telemetry.layer));
    const { payloads, spans } = telemetry.read();

    assert.isTrue(Exit.isSuccess(exit));
    assert.isAtLeast(spans.length, 2);
    assert.include(payloads.join(""), "create_note");
    assert.notInclude(payloads.join(""), "parameters");
    assert.notInclude(payloads.join(""), "private-");
  }),
);

it.effect("exports failed automatic HTTP children without provider causes or URL payloads", () =>
  Effect.gen(function* () {
    const provider = HttpClient.make((request) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            cause: new Error("private-provider-response", {
              cause: new Error("private-provider-token"),
            }),
          }),
        }),
      ),
    );
    const program = Effect.flatMap(HttpClient.HttpClient, (client) =>
      client.get("https://provider.test/private-path?customer=private-query"),
    ).pipe(
      Effect.provide(Layer.succeed(HttpClient.HttpClient)(provider)),
      Effect.withSpan("email.send"),
    );

    const telemetry = makeTelemetryTest();
    const exit = yield* Effect.exit(program).pipe(Effect.provide(telemetry.layer));
    const { payloads, spans } = telemetry.read();

    assert.isTrue(Exit.isFailure(exit));
    assert.strictEqual(spans.length, 2);
    assert.strictEqual(spans[0]?.name, "GET");
    assert.strictEqual(spans[0]?.status.code, 2);
    assert.strictEqual(spans[0]?.status.message, "operation.failed");
    assert.include(payloads.join(""), "provider.test");
    assert.notInclude(payloads.join(""), "private-");
  }),
);

it.effect("exports defects and interruptions without changing their control semantics", () =>
  Effect.gen(function* () {
    const defect = new Error("private-defect-message");
    defect.name = "private-defect-name";
    defect.stack = "private-defect-stack";
    const mixedCause = Cause.fromReasons([
      Cause.makeFailReason("private-failure"),
      Cause.makeDieReason(defect),
      Cause.makeInterruptReason(42),
    ]);
    const program = Effect.gen(function* () {
      yield* Effect.failCause(mixedCause).pipe(Effect.withSpan("mixed"), Effect.exit);
      yield* Effect.failCause(Cause.interrupt(42)).pipe(
        Effect.withSpan("interrupted"),
        Effect.exit,
      );
    });

    const telemetry = makeTelemetryTest();
    yield* program.pipe(Effect.provide(telemetry.layer));
    const { payloads, spans } = telemetry.read();

    assert.strictEqual(spans.length, 2);
    assert.strictEqual(spans[0]?.status.code, 2);
    assert.strictEqual(spans[1]?.status.code, 0);
    assert.deepStrictEqual(spans[1]?.attributes, [
      { key: "effect.fiber.interrupted", value: { boolValue: true } },
    ]);
    assert.include(payloads.join(""), "operation.defect");
    assert.notInclude(payloads.join(""), "private-");
  }),
);

it.effect(
  "suppresses diagnostic payloads in attributes events and links while retaining safe context",
  () =>
    Effect.gen(function* () {
      const program = Effect.gen(function* () {
        const span = yield* Effect.currentSpan;
        span.attribute("parameters", { body: "private-parameters" });
        span.attribute("error.message", "private-message");
        span.attribute("http.request.header.authorization", "private-header");
        span.attribute("orders.changed_count", 3);
        span.event("retry", 0n, {
          attempt: 2,
          "effect.cause": "private-logged-cause",
          parameters: "private-event",
        });
        span.event("exception", 0n, {
          "exception.message": "private-exception",
          arbitrary: "private-extra",
        });
        span.addLinks([
          {
            span: Tracer.externalSpan({ traceId: "a", spanId: "b" }),
            attributes: { parameters: "private-link", "link.type": "retry" },
          },
        ]);
      }).pipe(
        Effect.withSpan("orders.import", {
          links: [
            {
              span: Tracer.externalSpan({ traceId: "c", spanId: "d" }),
              attributes: { parameters: "private-initial-link" },
            },
          ],
        }),
      );

      const telemetry = makeTelemetryTest();
      yield* program.pipe(Effect.provide(telemetry.layer));
      const { payloads, spans } = telemetry.read();

      assert.strictEqual(spans.length, 1);
      assert.include(payloads.join(""), "orders.changed_count");
      assert.include(payloads.join(""), "attempt");
      assert.include(payloads.join(""), "link.type");
      assert.include(payloads.join(""), "operation.failed");
      assert.notInclude(payloads.join(""), "private-");
    }),
);

it.effect("composes development output behind the safety boundary", () =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    const console = yield* Console.Console;
    const layer = ObservabilityLive.pipe(
      Layer.provide([
        ConfigProvider.layer(ConfigProvider.fromUnknown({ APP_ENV: "development" })),
        Layer.succeed(Console.Console)({
          assert: console.assert.bind(console),
          clear: console.clear.bind(console),
          count: console.count.bind(console),
          countReset: console.countReset.bind(console),
          debug: console.debug.bind(console),
          dir: console.dir.bind(console),
          dirxml: console.dirxml.bind(console),
          error: console.error.bind(console),
          group: console.group.bind(console),
          groupCollapsed: console.groupCollapsed.bind(console),
          groupEnd: console.groupEnd.bind(console),
          info: console.info.bind(console),
          table: console.table.bind(console),
          time: console.time.bind(console),
          timeEnd: console.timeEnd.bind(console),
          timeLog: console.timeLog.bind(console),
          trace: console.trace.bind(console),
          warn: console.warn.bind(console),
          log: (...values) => {
            lines.push(values.join(" "));
          },
        }),
      ]),
    );

    yield* Effect.fail("private-development-error").pipe(
      Effect.tapCause((cause) => Effect.logError("dependency failed", cause)),
      Effect.withSpan("orders.import"),
      Effect.exit,
      Effect.provide(layer),
    );

    assert.include(lines.join(""), "operation.failed");
    assert.include(lines.join(""), 'dependency failed effect.cause="operation.failed"');
    assert.notInclude(lines.join(""), "private-");
  }),
);
