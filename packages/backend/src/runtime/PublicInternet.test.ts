import { assert, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option, Tracer } from "effect";
import { TestClock } from "effect/testing";

import { publicInternetIsolate } from "./public-internet/transport/isolate/PublicInternetIsolate.ts";
import { publicInternetProcess } from "./public-internet/transport/node/PublicInternetProcess.ts";
import { PublicInternet } from "./PublicInternet.ts";

for (const [name, layer] of [
  ["process", publicInternetProcess],
  ["isolate", publicInternetIsolate],
] as const) {
  it.effect(`rejects non-HTTPS and special-use destinations on ${name}`, () =>
    Effect.gen(function* () {
      const internet = yield* PublicInternet;
      for (const url of [
        "http://example.com/",
        "https://127.0.0.1/",
        "https://10.0.0.1/",
        "https://[::1]/",
        "https://169.254.169.254/",
        "https://192.0.2.1/",
        "https://[::ffff:127.0.0.1]/",
        "https://100.64.0.1/",
        "https://198.18.0.1/",
        "https://224.0.0.1/",
        "https://localhost/",
      ]) {
        const result = yield* Effect.exit(internet.request(new Request(url)));

        assert.isTrue(Exit.isFailure(result), url);
      }
    }).pipe(Effect.provide(layer)),
  );

  it.effect(`cancels before any connection on ${name}`, () =>
    Effect.gen(function* () {
      const internet = yield* PublicInternet;
      const request = new Request("https://example.com/", { signal: AbortSignal.abort() });

      const result = yield* Effect.exit(internet.request(request));

      assert.isTrue(Exit.isFailure(result));
    }).pipe(Effect.provide(layer)),
  );
}

it.effect(
  "records method, host and status without exporting private request or response data",
  () => {
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const layer = PublicInternet.fromTransport((request) =>
      request.url.includes("failure")
        ? Promise.reject(new Error("private-query private-body private-header"))
        : Promise.resolve(
            new Response("private-response", {
              status: 201,
              headers: { "x-private": "private-response-header" },
            }),
          ),
    );
    return Effect.gen(function* () {
      const internet = yield* PublicInternet;

      const response = yield* internet.request(
        new Request("https://client.test/private-path?key=private-query", {
          method: "POST",
          headers: { authorization: "private-header" },
          body: "private-body",
        }),
      );
      yield* Effect.promise(() => response.text());
      yield* Effect.exit(
        internet.request(new Request("https://client.test/failure?key=private-query")),
      );

      const successful = spans.find(
        (span) => span.attributes.get("http.response.status_code") === 201,
      );
      const parent = spans.find((span) => span.name === "provider.send");
      assert.isDefined(successful);
      assert.strictEqual(successful.name, "PublicInternet.request");
      assert.strictEqual(successful.kind, "client");
      assert.strictEqual(successful.attributes.get("http.request.method"), "POST");
      assert.strictEqual(successful.attributes.get("server.address"), "client.test");
      assert.strictEqual(Option.getOrUndefined(successful.parent)?.spanId, parent?.spanId);
      assert.deepEqual([...successful.attributes.keys()].sort(), [
        "http.request.method",
        "http.response.status_code",
        "server.address",
      ]);

      const exported = spans
        .flatMap((span) => [
          span.name,
          ...[...span.attributes].flat().map(String),
          span.status._tag === "Ended" && Exit.isFailure(span.status.exit)
            ? Cause.pretty(span.status.exit.cause)
            : "",
        ])
        .join("\n");
      for (const secret of [
        "private-path",
        "private-query",
        "private-header",
        "private-body",
        "private-response",
      ]) {
        assert.notInclude(exported, secret);
      }
    }).pipe(Effect.provide(layer), Effect.withSpan("provider.send"), Effect.withTracer(tracer));
  },
);

it.effect("refuses a redirect and says why it refused", () => {
  const layer = PublicInternet.fromTransport(() =>
    Promise.resolve(
      new Response(null, { status: 307, headers: { location: "https://elsewhere.test/next" } }),
    ),
  );
  return Effect.gen(function* () {
    const internet = yield* PublicInternet;

    const error = yield* Effect.flip(internet.request(new Request("https://client.test/move")));

    assert.strictEqual(error.reason, "blocked_redirect");
  }).pipe(Effect.provide(layer));
});

it.effect("scrubs streamed failures before callers can export their causes", () =>
  Effect.gen(function* () {
    const internet = yield* PublicInternet;

    const response = yield* internet.request(new Request("https://client.test/body"));
    const error = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => String(cause),
    }).pipe(Effect.flip);

    assert.include(error, "PublicInternetUnavailable");
    assert.notInclude(error, "private-body");
  }).pipe(
    Effect.provide(
      PublicInternet.fromTransport(() =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(new Error("private-body private-query private-header"));
              },
            }),
          ),
        ),
      ),
    ),
  ),
);

it.effect("uses a 15-second deadline when the caller omits one", () => {
  const started = Promise.withResolvers<void>();
  const layer = PublicInternet.fromTransport(() => {
    started.resolve();
    return Promise.withResolvers<Response>().promise;
  });
  return Effect.gen(function* () {
    const internet = yield* PublicInternet;

    const pending = yield* internet
      .request(new Request("https://client.test/slow"))
      .pipe(Effect.forkChild);
    yield* Effect.promise(() => started.promise);
    yield* TestClock.adjust(15_000);
    const result = yield* Effect.exit(Fiber.join(pending));

    assert.isTrue(Exit.isFailure(result));
  }).pipe(Effect.provide(layer));
});

it.effect("allows only empty responses with a zero-byte cap", () =>
  Effect.gen(function* () {
    const internet = yield* PublicInternet;

    const empty = yield* internet.request(new Request("https://client.test/empty"), {
      maxResponseBytes: 0,
    });
    const text = yield* Effect.promise(() => empty.text());
    const nonempty = yield* internet.request(new Request("https://client.test/bytes"), {
      maxResponseBytes: 0,
    });
    const result = yield* Effect.exit(Effect.tryPromise(() => nonempty.text()));

    assert.strictEqual(text, "");
    assert.isTrue(Exit.isFailure(result));
  }).pipe(
    Effect.provide(
      PublicInternet.fromTransport((request) =>
        Promise.resolve(new Response(request.url.endsWith("/empty") ? "" : "x")),
      ),
    ),
  ),
);

it.effect("rejects invalid limits before invoking a transport", () => {
  let connected = false;
  const layer = PublicInternet.fromTransport(() => {
    connected = true;
    return Promise.resolve(new Response());
  });
  return Effect.gen(function* () {
    const internet = yield* PublicInternet;
    for (const options of [
      { timeoutMs: 0 },
      { timeoutMs: Number.NaN },
      { timeoutMs: Number.POSITIVE_INFINITY },
      { maxResponseBytes: -1 },
      { maxResponseBytes: 1.5 },
      { maxResponseBytes: Number.POSITIVE_INFINITY },
    ]) {
      const result = yield* Effect.exit(
        internet.request(new Request("https://client.test/"), options),
      );

      assert.isTrue(Exit.isFailure(result));
      assert.isFalse(connected);
    }
  }).pipe(Effect.provide(layer));
});
