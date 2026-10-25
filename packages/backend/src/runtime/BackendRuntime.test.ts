import { rejects } from "node:assert/strict";

import { assert, it } from "@effect/vitest";
import { Data, Effect, Option, Tracer } from "effect";

import { BackendRuntime } from "./BackendRuntime.ts";
import { RequestContext } from "./RequestContext.ts";

it.effect("runs a backend program with context derived from its request", () =>
  withTestRuntime((runtime) =>
    Effect.gen(function* () {
      const request = new Request("http://localhost/notes", {
        headers: { "x-request-id": "request-1" },
      });

      const result = yield* Effect.promise(() =>
        runtime.run(readRequestId(), request, "notes.list"),
      );

      assert.strictEqual(result, "request-1");
    }),
  ),
);

it.effect("creates an operation span with request context", () =>
  withTestRuntime((runtime) =>
    Effect.gen(function* () {
      const request = new Request("http://localhost/notes", {
        method: "POST",
        headers: {
          traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          "x-request-id": "request-1",
        },
      });

      const span = yield* Effect.promise(() =>
        runtime.run(Effect.currentSpan, request, "notes.update"),
      );

      assert.strictEqual(span.name, "notes.update");
      assert.strictEqual(span.kind, "server");
      assert.strictEqual(span.traceId, "0af7651916cd43dd8448eb211c80319c");
      assert.strictEqual(Option.getOrThrow(span.parent).spanId, "b7ad6b7169203331");
      assert.strictEqual(span.attributes.get("request.id"), "request-1");
      assert.strictEqual(span.attributes.get("app.operation"), "notes.update");
      assert.strictEqual(span.attributes.get("app.outcome"), "success");
      assert.isFalse(span.attributes.has("http.request.method"));
      assert.isFalse(span.attributes.has("url.path"));
      assert.strictEqual(span.status._tag, "Ended");
    }),
  ),
);

it.effect("parents backend operations to the enclosing HTTP request span", () =>
  withTestRuntime((runtime) =>
    Effect.gen(function* () {
      const request = new Request("http://localhost/notes");
      let operationSpan: Tracer.Span | undefined;

      const response = yield* Effect.promise(() =>
        runtime.runHttpHandler(request, async (tracedRequest) => {
          operationSpan = await runtime.run(Effect.currentSpan, tracedRequest, "notes.list");
          return new Response(undefined, { status: 204 });
        }),
      );

      assert.strictEqual(response.status, 204);
      assert.isDefined(operationSpan);
      assert.strictEqual(
        operationSpan.parent.pipe(Option.getOrThrow).traceId,
        operationSpan.traceId,
      );
    }),
  ),
);

it.effect("rejects the promise when the backend program fails", () =>
  withTestRuntime((runtime) =>
    Effect.gen(function* () {
      const request = new Request("http://localhost/notes");
      const program = Effect.fail(new BackendRuntimeTestError());

      const assertion = rejects(
        runtime.run(program, request, "notes.list"),
        BackendRuntimeTestError,
      );

      yield* Effect.promise(() => assertion);
    }),
  ),
);

it.effect("hands after-response work to the platform once the response is ready", () =>
  Effect.gen(function* () {
    const extended: Array<Promise<unknown>> = [];
    const completed: Array<string> = [];
    const request = new Request("http://localhost/notes");

    const response = yield* withTestRuntime(
      (runtime) =>
        Effect.promise(async () => {
          const response = await runtime.runHttpHandler(request, () => {
            completed.push("response");
            return Promise.resolve(new Response("ok"));
          });
          await Promise.all(extended);
          return response;
        }),
      {
        waitUntil: (promise) => extended.push(promise),
        afterResponse: Effect.sync(() => completed.push("after response")),
      },
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(extended.length, 1);
    assert.deepStrictEqual(completed, ["response", "after response"]);
  }),
);

it.effect("finishes in-flight requests before releasing resources on dispose", () =>
  Effect.gen(function* () {
    const events: Array<string> = [];
    const handler = Promise.withResolvers<Response>();
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() => BackendRuntime.makeTest()),
      (runtime) =>
        Effect.promise(async () => {
          handler.resolve(new Response("ok"));
          await runtime.dispose();
        }),
    );
    const request = new Request("http://localhost/notes");
    const response = runtime.runHttpHandler(request, () => handler.promise);

    const disposed = runtime.dispose().then(() => events.push("disposed"));
    events.push("response sent");
    handler.resolve(new Response("ok"));
    yield* Effect.promise(() => Promise.all([response, disposed]));

    assert.deepStrictEqual(events, ["response sent", "disposed"]);
  }),
);

it.effect("extends platform lifetime for reports and drains them before disposal", () =>
  Effect.gen(function* () {
    const extended: Array<Promise<unknown>> = [];
    const events: Array<string> = [];
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() =>
        BackendRuntime.makeTest({
          waitUntil: (work) => extended.push(work),
          afterResponse: Effect.sync(() => events.push("flushed")),
        }),
      ),
      (runtime) =>
        Effect.promise(async () => {
          finish.resolve();
          await runtime.dispose();
          await Promise.all(extended);
        }),
    );
    runtime.runBackground(
      Effect.gen(function* () {
        started.resolve();
        yield* Effect.promise(() => finish.promise);
        events.push("reported");
      }),
      new Request("https://example.test/"),
      "telemetry.server_error",
    );

    yield* Effect.promise(() => started.promise);
    const disposed = runtime.dispose().then(() => events.push("disposed"));
    assert.strictEqual(extended.length, 1);
    assert.deepStrictEqual(events, []);

    finish.resolve();
    yield* Effect.promise(() => Promise.all([disposed, ...extended]));

    assert.deepStrictEqual(events, ["reported", "flushed", "disposed"]);
  }),
);

it.effect("owns a failed background report without rejecting platform work", () =>
  Effect.gen(function* () {
    const extended: Array<Promise<unknown>> = [];
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() => BackendRuntime.makeTest({ waitUntil: (work) => extended.push(work) })),
      (runtime) =>
        Effect.promise(async () => {
          await runtime.dispose();
          await Promise.all(extended);
        }),
    );
    runtime.runBackground(
      Effect.fail(new BackendRuntimeTestError()),
      new Request("https://example.test/"),
      "telemetry.server_error",
    );

    yield* Effect.promise(() => runtime.dispose());
    yield* Effect.promise(() => Promise.all(extended));

    assert.strictEqual(extended.length, 1);
  }),
);

function withTestRuntime<A, E>(
  use: (runtime: BackendRuntime<never>) => Effect.Effect<A, E>,
  options?: Parameters<typeof BackendRuntime.makeTest>[0],
): Effect.Effect<A, E> {
  return Effect.acquireUseRelease(
    Effect.sync(() => BackendRuntime.makeTest(options)),
    use,
    (runtime) => Effect.promise(() => runtime.dispose()),
  );
}

function readRequestId(): Effect.Effect<string, never, RequestContext> {
  return Effect.gen(function* () {
    const requestContext = yield* RequestContext;

    return requestContext.requestId;
  });
}

class BackendRuntimeTestError extends Data.TaggedError("BackendRuntimeTestError") {}
