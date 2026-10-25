import { assert, expect, it } from "@effect/vitest";
import {
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Redacted,
  Tracer,
} from "effect";

import { safeTracerLayer } from "./Observability.ts";
import { makePrettyConsoleTracer } from "./PrettyConsoleTracer.ts";

it("streams operation repository and placeholder SQL children in completion order", () => {
  const f = fixture();
  const operation = f.span("orders.import");
  const repository = f.span("OrderRepository.insert", { parent: Option.some(operation) });
  const sql = f.span("sql.execute", { parent: Option.some(repository), kind: "client" });
  sql.attribute("db.query.text", "insert into orders (id) values ($1)");

  sql.end(3_000_000n, Exit.void);
  repository.end(5_000_000n, Exit.void);
  operation.end(8_000_000n, Exit.void);

  expect(f.output()).toMatchInlineSnapshot(`
    "    ✓ [trace-a/span-3 parent=span-2] sql.execute kind=client 3.0ms db.query.text="insert into orders (id) values ($1)"
      ✓ [trace-a/span-2 parent=span-1] OrderRepository.insert kind=internal 5.0ms
    ✓ [trace-a/span-1] orders.import kind=internal 8.0ms"
  `);
});

it("renders slow SQL without overriding its successful operation outcome", () => {
  const f = fixture();
  const operation = f.span("orders.import");
  const sql = f.span("sql.execute", { parent: Option.some(operation) });
  sql.attribute("db.query.text", ` SELECT\n id FROM orders WHERE id IN (${"$1, ".repeat(80)}$2) `);
  sql.end(100_000_000n, Exit.void);
  operation.attribute("app.outcome", "success");

  operation.end(110_000_000n, Exit.void);

  expect(f.output()).toMatchInlineSnapshot(`
    "  ⚠ [trace-a/span-2 parent=span-1] sql.execute kind=internal 100.0ms db.query.text="SELECT id FROM orders WHERE id IN ($1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1, $1,…
    ⚠ [trace-a/span-1] orders.import kind=internal 110.0ms app.outcome="success""
  `);
});

it("distinguishes business rejection from successful HTTP transport", () => {
  const f = fixture();
  const http = f.span("http.server.request", { kind: "server" });
  const operation = f.span("orders.cancel", { parent: Option.some(http) });
  operation.attribute("app.outcome", "not_found");
  operation.attribute("error.type", "order.not_found");
  operation.end(2_000_000n, Exit.void);
  http.attribute("http.response.status_code", 200);

  http.end(3_000_000n, Exit.void);
  const failed = f.span("orders.unavailable");
  failed.attribute("app.outcome", "failure");
  failed.end(200_000_000n, Exit.void);

  expect(f.output()).toMatchInlineSnapshot(`
    "  ↩ [trace-a/span-2 parent=span-1] orders.cancel kind=internal 2.0ms app.outcome="not_found" error.type="order.not_found"
    ✓ [trace-a/span-1] http.server.request kind=server 3.0ms http.response.status_code=200
    ✗ [trace-a/span-3] orders.unavailable kind=internal 200.0ms app.outcome="failure""
  `);
});

it("renders typed infrastructure failure by stable classification even when slow", () => {
  const f = fixture();
  const span = f.span("warehouse.reserve");
  span.attribute("error.type", "warehouse.unavailable");

  span.end(200_000_000n, Exit.fail({ _tag: "PrivateProviderError", message: "private-error" }));

  assert.notInclude(f.output(), "private-");
  expect(f.output()).toMatchInlineSnapshot(
    `"✗ operation.failed [trace-a/span-1] warehouse.reserve kind=internal 200.0ms error.type="warehouse.unavailable""`,
  );
});

it.effect("distinguishes defects interruptions mixed causes and finalizer failure", () =>
  Effect.gen(function* () {
    const f = fixture();

    f.span("defect").end(1n, Exit.die(new Error("private-defect")));
    f.span("interrupted").end(1n, Exit.failCause(Cause.interrupt(42)));
    f.span("mixed").end(
      1n,
      Exit.failCause(
        Cause.fromReasons([
          Cause.makeFailReason("private-failure"),
          Cause.makeDieReason(new Error("private-defect")),
          Cause.makeInterruptReason(42),
        ]),
      ),
    );
    yield* Effect.void.pipe(
      Effect.ensuring(Effect.die("private-finalizer")),
      Effect.withSpan("finalizer"),
      Effect.withTracerTiming(false),
      Effect.exit,
      Effect.provide(f.layer),
    );

    assert.notInclude(f.output(), "private-");
    expect(f.output()).toMatchInlineSnapshot(`
    "✗ operation.defect [trace-a/span-1] defect kind=internal 0.0ms
    ⊘ interrupted [trace-a/span-2] interrupted kind=internal 0.0ms
    ✗ operation.failed+operation.defect+interrupted [trace-a/span-3] mixed kind=internal 0.0ms
    ✗ operation.defect [trace-a/span-4] finalizer kind=internal 0.0ms"
  `);
  }),
);

it.effect("renders structured events and escapes controls in stable key order", () =>
  Effect.gen(function* () {
    const f = fixture();
    const span = f.span("orders.import");
    span.event("retry\n\u001b[31m", 1n, {
      z: [true, 2],
      a: { z: "line\nend\u009b\u2028", a: false },
    });
    span.event("checkpoint", 2n, { "effect.fiberId": 1, "effect.logLevel": "INFO", count: 3 });
    yield* Effect.logInfo("checkpoint").pipe(
      Effect.withSpan("logged"),
      Effect.withTracerTiming(false),
      Effect.provide(Layer.merge(Logger.layer([Logger.tracerLogger]), f.layer)),
    );

    span.end(3_000_000n, Exit.void);

    expect(f.output()).toMatchInlineSnapshot(`
      "✓ [trace-a/span-2] logged kind=internal 0.0ms
        · checkpoint
      ✓ [trace-a/span-1] orders.import kind=internal 3.0ms
        · retry\\u000a\\u001b[31m a={"a":false,"z":"line\\nend\\u009b\\u2028"} z=[true,2]
        · checkpoint count=3"
    `);
  }),
);

it.effect("keeps interleaved requests and concurrent siblings attributable", () =>
  Effect.gen(function* () {
    const f = fixture();
    const first = f.span("orders.import");
    const second = f.span("inventory.check", {
      parent: Option.some(Tracer.externalSpan({ traceId: "trace-b", spanId: "remote" })),
    });
    const left = f.span("warehouse.left", { parent: Option.some(first) });
    const right = f.span("warehouse.right", { parent: Option.some(first) });

    right.end(2_000_000n, Exit.void);
    second.end(3_000_000n, Exit.void);
    left.end(4_000_000n, Exit.void);
    first.end(5_000_000n, Exit.void);
    yield* Effect.all(
      [
        Effect.yieldNow.pipe(Effect.withSpan("warehouse.parallel-left")),
        Effect.void.pipe(Effect.withSpan("warehouse.parallel-right")),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.withSpan("orders.parallel"),
      Effect.withTracerTiming(false),
      Effect.provide(f.layer),
    );

    expect(f.output()).toMatchInlineSnapshot(`
    "  ✓ [trace-a/span-4 parent=span-1] warehouse.right kind=internal 2.0ms
    ✓ [trace-b/span-2 parent=remote] inventory.check kind=internal 3.0ms
      ✓ [trace-a/span-3 parent=span-1] warehouse.left kind=internal 4.0ms
    ✓ [trace-a/span-1] orders.import kind=internal 5.0ms
      ✓ [trace-a/span-7 parent=span-5] warehouse.parallel-right kind=internal 0.0ms
      ✓ [trace-a/span-6 parent=span-5] warehouse.parallel-left kind=internal 0.0ms
    ✓ [trace-a/span-5] orders.parallel kind=internal 0.0ms"
  `);
  }),
);

it("renders external parents explicit roots and span links", () => {
  const f = fixture();
  const external = Tracer.externalSpan({ traceId: "upstream", spanId: "remote" });
  const child = f.span("orders.consume", {
    parent: Option.some(external),
    links: [{ span: external, attributes: { "link.type": "retry" } }],
  });
  const root = f.span("orders.reconcile", { root: true });
  root.addLinks([{ span: child, attributes: { count: 2 } }]);

  child.end(1_000_000n, Exit.void);
  root.end(2_000_000n, Exit.void);

  expect(f.output()).toMatchInlineSnapshot(`
    "✓ [upstream/span-1 parent=remote] orders.consume kind=internal 1.0ms
      ↗ [upstream/remote] link.type="retry"
    ✓ [trace-a/span-2] orders.reconcile kind=internal 2.0ms
      ↗ [upstream/span-1] count=2"
  `);
});

it("bounds nesting and discards a deep secret-bearing error stack", () => {
  const f = fixture();
  let span = f.span("level-0");
  for (let depth = 1; depth <= 1000; depth += 1) {
    span = f.span(`level-${depth}`, { parent: Option.some(span) });
  }
  const error = new Error("private-message");
  error.stack = "private-stack\n".repeat(10_000);

  span.end(1_000_000n, Exit.die(error));

  assert.isBelow(f.output().length, 300);
  assert.notInclude(f.output(), "private-");
  expect(f.output()).toMatchInlineSnapshot(
    `"            … ✗ operation.defect [trace-a/span-1001 parent=span-1000] level-1000 kind=internal 1.0ms"`,
  );
});

it("respects sampling and renders zero submillisecond and threshold durations", () => {
  const f = fixture();

  f.span("unsampled", { sampled: false }).end(1n, Exit.void);
  f.span("zero").end(0n, Exit.void);
  f.span("tiny").end(50_000n, Exit.void);
  f.span("threshold").end(100_000_000n, Exit.void);

  assert.notInclude(f.output(), "unsampled");
  expect(f.output()).toMatchInlineSnapshot(`
    "✓ [trace-a/span-2] zero kind=internal 0.0ms
    ✓ [trace-a/span-3] tiny kind=internal 0.1ms
    ⚠ [trace-a/span-4] threshold kind=internal 100.0ms"
  `);
});

it("bounds safe values arrays records events and unsupported objects without coercion", () => {
  const f = fixture();
  const span = f.span("orders.import");
  const hostile = {
    toString() {
      throw new Error("coerced");
    },
    toJSON() {
      throw new Error("serialized");
    },
    get secret() {
      throw new Error("read getter");
    },
  };
  const cycle: Record<string, unknown> = {};
  cycle["self"] = cycle;
  span.attribute("a.values", [
    0,
    true,
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    7n,
    undefined,
    8,
  ]);
  span.attribute("b.secret", Redacted.make("private-redacted"));
  span.attribute("c.object", hostile);
  span.attribute("d.error", new Error("private-error"));
  span.attribute("e.cycle", cycle);
  span.attribute("f.long", "x".repeat(300));
  span.attribute("g.deep", { one: { two: { three: { four: true } } } });
  for (let index = 0; index < 16; index += 1) {
    span.attribute(`z${index.toString().padStart(2, "0")}`, index);
    span.event(`event-${index}`, 1n);
  }

  span.end(1_000_000n, Exit.void);

  assert.notInclude(f.output(), "private-");
  expect(f.output()).toMatchInlineSnapshot(`
    "✓ [trace-a/span-1] orders.import kind=internal 1.0ms a.values=[0,true,null,NaN,Infinity,7,… 2 more] b.secret=[Redacted] c.object={"secret":[unsupported],"toJSON":[unsupported],"toString":[unsupported]} d.error=[unsupported] e.cycle={"self":{"self":{"self":…}}} f.long="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx… g.deep={"one":{"two":{"three":…}}} z00=0 z01=1 z02=2 z03=3 z04=4 … 11 more attributes
      · event-0
      · event-1
      · event-2
      · event-3
      · event-4
      · event-5
      · event-6
      · event-7
      · event-8
      · event-9
      · event-10
      · event-11
      … 4 more events"
  `);
});

it("suppresses credentials binds Toolkit payloads and nested causes before rendering", () => {
  const f = fixture();
  const span = f.span("orders.import", {
    kind: "client",
    links: [
      {
        span: Tracer.externalSpan({ traceId: "linked", spanId: "remote" }),
        attributes: { parameters: { body: "private-link" } },
      },
    ],
  });
  span.attribute("parameters", {
    title: "private-title",
    body: "private-body",
    password: "private-password",
  });
  span.attribute("http.request.header.authorization", "Bearer private-token");
  span.attribute("http.response.header.set-cookie", "private-cookie");
  span.attribute("url.full", "https://provider.test/?token=private-query");
  span.attribute("url.path", "/private-path");
  span.attribute("error.message", "private-message");
  span.attribute("db.query.text", "insert into orders (body) values ($1)");
  span.event("exception", 1n, {
    "exception.stacktrace": "private-stack",
    parameters: "private-event",
  });

  span.end(
    1_000_000n,
    Exit.fail({
      _tag: "PersistenceFailed",
      cause: new Error("private-bind", { cause: new Error("private-nested") }),
    }),
  );

  assert.notInclude(f.output(), "private-");
  expect(f.output()).toMatchInlineSnapshot(`
    "✗ operation.failed [trace-a/span-1] orders.import kind=client 1.0ms db.query.text="insert into orders (body) values ($1)"
      · exception exception.message="operation.failed" exception.type="operation.failed"
      ↗ [linked/remote]"
  `);
});

function fixture(): {
  lines: string[];
  span: (name: string, options?: Partial<Parameters<Tracer.Tracer["span"]>[0]>) => Tracer.Span;
  layer: Layer.Layer<never, never, never>;
  output: () => string;
} {
  const lines: Array<string> = [];
  let index = 0;
  const renderer = makePrettyConsoleTracer({
    slowSpanThreshold: Duration.millis(100),
    write: (line) => lines.push(line),
  });
  const deterministic = Tracer.make({
    span(options) {
      const span = renderer.span({ ...options, startTime: 0n });
      index += 1;
      Object.defineProperties(span, {
        traceId: { value: Option.getOrUndefined(options.parent)?.traceId ?? "trace-a" },
        spanId: { value: `span-${index}` },
      });
      return span;
    },
  });
  const layer = safeTracerLayer.pipe(Layer.provide(Layer.succeed(Tracer.Tracer)(deterministic)));
  const tracer = Effect.runSync(Effect.scoped(Effect.provide(Tracer.Tracer, layer)));
  const span = (
    name: string,
    options: Partial<Parameters<Tracer.Tracer["span"]>[0]> = {},
  ): Tracer.Span =>
    tracer.span({
      name,
      annotations: Context.empty(),
      kind: "internal",
      links: [],
      parent: Option.none(),
      root: true,
      sampled: true,
      startTime: 0n,
      ...options,
    });
  return { lines, span, layer, output: () => lines.join("\n") };
}
