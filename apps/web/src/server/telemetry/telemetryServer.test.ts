import { assert, it } from "@effect/vitest";
import { makeTelemetryTest } from "@lineupkeep/backend/runtime/internal/TelemetryTest";
import {
  type RequestContext,
  requestContextLayer,
} from "@lineupkeep/backend/runtime/RequestContext";
import { Effect, Exit, Tracer, Logger } from "effect";
import { TestClock } from "effect/testing";

import {
  recordClientReport,
  recordServerFailure,
  recordSlowBoundary,
  isExpectedHttpOutcome,
  makeReportBudget,
} from "./telemetryServer.ts";
const request = new Request("http://localhost/telemetry", {
  method: "POST",
  headers: { "x-request-id": "request-telemetry-1" },
});

function provideTestContext<A, E>(
  program: Effect.Effect<A, E, RequestContext>,
): Effect.Effect<A, E, never> {
  return program.pipe(
    Effect.provide(requestContextLayer({ request, requestId: "request-telemetry-1" })),
    Effect.withSpan("telemetry-test"),
    Effect.scoped,
  );
}

function readAttribute(span: Tracer.Span, key: string): unknown {
  return span.attributes.get(key);
}

it.effect("accepts a client error report with the request id as ref", () =>
  Effect.gen(function* () {
    const budget = yield* makeReportBudget({ limit: 10, windowMs: 60_000 });

    const { result, span } = yield* recordClientReport(
      {
        kind: "client_error",
        message: "Cannot read properties of undefined",
        thrownIn: "<App> › <NotesPage> › <NoteList>",
        caughtBy: "<App> › <NotesPage> › <Errored>",
        pathname: "/notes",
        clientTraceId: "0af7651916cd43dd8448eb211c80319c",
      },
      budget,
    ).pipe(
      Effect.flatMap((result) => Effect.map(Effect.currentSpan, (span) => ({ result, span }))),
      provideTestContext,
    );

    assert.deepStrictEqual(result, { ref: "request-telemetry-1" });
    assert.strictEqual(readAttribute(span, "app.outcome"), "failure");
    assert.strictEqual(readAttribute(span, "error.type"), "ui.boundary_caught");
    assert.isUndefined(readAttribute(span, "error.message"));
    assert.isUndefined(readAttribute(span, "ui.thrown_in"));
    assert.isUndefined(readAttribute(span, "ui.pathname"));
    assert.strictEqual(readAttribute(span, "client.trace_id"), "0af7651916cd43dd8448eb211c80319c");
  }),
);

it.effect("sheds reports past the budget without logging", () =>
  Effect.gen(function* () {
    const budget = yield* makeReportBudget({ limit: 1, windowMs: 60_000 });
    const input = { kind: "client_error", message: "First", pathname: "/" };
    yield* recordClientReport(input, budget).pipe(Effect.asVoid, provideTestContext, Effect.ignore);

    const { result, span } = yield* recordClientReport(input, budget).pipe(
      Effect.flatMap((result) => Effect.map(Effect.currentSpan, (span) => ({ result, span }))),
      provideTestContext,
    );

    assert.deepStrictEqual(result, { ref: "request-telemetry-1" });
    assert.strictEqual(readAttribute(span, "telemetry.report"), "dropped");
  }),
);

it.effect("records server errors with site and paths", () =>
  Effect.gen(function* () {
    const budget = yield* makeReportBudget({ limit: 10, windowMs: 60_000 });

    const { result, span } = yield* recordServerFailure(
      {
        kind: "render",
        handling: "fallback",
        ownerPath: "<App> › <NotesPage>",
        boundaryPath: "<App> › <Errored>",
      },
      budget,
    ).pipe(
      Effect.flatMap((result) => Effect.map(Effect.currentSpan, (span) => ({ result, span }))),
      provideTestContext,
    );

    assert.deepStrictEqual(result, { ref: "request-telemetry-1" });
    assert.strictEqual(readAttribute(span, "error.type"), "ui.server_render");
    assert.strictEqual(readAttribute(span, "ui.site"), "render/fallback");
    assert.strictEqual(readAttribute(span, "ui.caught_by"), "<App> › <Errored>");
  }),
);

it.effect("records slow SSR boundaries with wait facts", () =>
  Effect.gen(function* () {
    const { result, span } = yield* recordSlowBoundary({
      ownerPath: "<App> › <NotesPage> › <Loading>",
      durationMs: 640.4,
      outcome: "settled",
      passes: 2,
    }).pipe(
      Effect.flatMap((result) => Effect.map(Effect.currentSpan, (span) => ({ result, span }))),
      provideTestContext,
    );

    assert.deepStrictEqual(result, { ref: "request-telemetry-1" });
    assert.strictEqual(readAttribute(span, "app.outcome"), "success");
    assert.strictEqual(readAttribute(span, "ui.wait_ms"), 640);
    assert.strictEqual(readAttribute(span, "ui.render_passes"), 2);
  }),
);

it("treats expected HTTP outcomes as non-failures", () => {
  const notFound = new Response("Not Found", { status: 404 });
  const serverError = new Response("Failure", { status: 500 });

  const expected = isExpectedHttpOutcome(notFound);
  const unexpected = isExpectedHttpOutcome(serverError);
  const thrown = isExpectedHttpOutcome(new Error("Failure"));

  assert.isTrue(expected);
  assert.isFalse(unexpected);
  assert.isFalse(thrown);
});

it.effect("exports client reports without any caller-controlled text", () =>
  Effect.gen(function* () {
    const budget = yield* makeReportBudget({ limit: 10, windowMs: 60_000 });
    const reports = [
      {
        kind: "client_error",
        message: "private-exception",
        thrownIn: "private-owner",
        caughtBy: "private-boundary",
        pathname: "/private-path",
        clientTraceId: "private-trace",
      },
      {
        kind: "slow_interaction",
        name: "private-interaction",
        target: "private-target",
        settledMs: 500,
        holds: [{ blockers: "private-blocker", holdMs: 400, acknowledged: false }],
      },
      {
        kind: "slow_call",
        id: "private-function",
        durationMs: 1000,
        method: "POST",
        outcome: "error",
        status: 503,
      },
    ];
    const program = Effect.forEach(reports, (report) =>
      recordClientReport(report, budget).pipe(Effect.withSpan("telemetry.client_report")),
    ).pipe(
      Effect.provide([
        requestContextLayer({
          request: new Request("https://app.test/api/telemetry"),
          requestId: "client-report-test",
        }),
        Logger.layer([Logger.tracerLogger]),
      ]),
    );

    const telemetry = makeTelemetryTest();
    const exit = yield* Effect.exit(program).pipe(Effect.provide(telemetry.layer));
    const { payloads, spans } = telemetry.read();

    assert.isTrue(Exit.isSuccess(exit));
    assert.strictEqual(spans.length, 3);
    assert.include(payloads.join(""), "ui.boundary_caught");
    assert.include(payloads.join(""), "ui.slow_interaction");
    assert.include(payloads.join(""), "ui.slow_call");
    assert.include(payloads.join(""), "ui.wait_ms");
    assert.notInclude(payloads.join(""), "private-");
  }),
);

it.effect("allows reports up to the limit within the window", () =>
  Effect.gen(function* () {
    const budget = yield* makeReportBudget({ limit: 2, windowMs: 60_000 });

    const first = yield* budget.check;
    const second = yield* budget.check;
    const third = yield* budget.check;

    assert.isTrue(first);
    assert.isTrue(second);
    assert.isFalse(third);
  }),
);

it.effect("resets the allowance after the window passes", () =>
  Effect.gen(function* () {
    const budget = yield* makeReportBudget({ limit: 1, windowMs: 60_000 });
    assert.isTrue(yield* budget.check);
    assert.isFalse(yield* budget.check);

    yield* TestClock.adjust(60_001);
    const afterWindow = yield* budget.check;

    assert.isTrue(afterWindow);
  }),
);
