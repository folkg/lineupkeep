import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  correlateRequestEffect,
  makeRequestContext,
  withRequestHeaders,
} from "./RequestContext.ts";
import type { RequestParts } from "./RequestContext.ts";

it.effect(
  "establishes correlation once before constructing context for an uncorrelated request",
  () =>
    Effect.gen(function* () {
      const request = new Request("http://localhost/connections");

      const entry = yield* correlateRequestEffect(request);
      const nested = yield* correlateRequestEffect(entry.request);
      const context = yield* makeRequestContext(nested.request);

      assert.match(entry.requestId, /^[0-9A-HJKMNP-TV-Z]{26}$/u);
      assert.strictEqual(context.requestId, entry.requestId);
      assert.strictEqual(nested.requestId, entry.requestId);
      assert.strictEqual(entry.request.headers.get("x-request-id"), entry.requestId);
      assert.strictEqual(request.headers.get("x-request-id"), null);
    }),
);

it.effect("retains an entry-correlated request after an adapter consumes its body", () =>
  Effect.gen(function* () {
    const request = new Request("http://localhost/connections", {
      method: "POST",
      body: "adapter input",
      headers: { "x-request-id": "entry-id" },
    });
    yield* Effect.promise(() => request.text());

    const correlated = yield* correlateRequestEffect(request);
    const context = yield* makeRequestContext(correlated.request);

    assert.strictEqual(correlated.request, request);
    assert.strictEqual(context.request, request);
    assert.strictEqual(context.requestId, "entry-id");
  }),
);

it.effect("rebuilds a request with added headers from its parts", () =>
  Effect.gen(function* () {
    const original = new Request("http://localhost/connections", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "request body",
    });
    const parts: RequestParts = {
      url: original.url,
      method: original.method,
      headers: original.headers,
      body: original.body,
      signal: original.signal,
    };

    const rebuilt = withRequestHeaders(parts, { "x-request-id": "request-1" });

    assert.strictEqual(rebuilt.method, "POST");
    assert.strictEqual(rebuilt.url, "http://localhost/connections");
    assert.strictEqual(rebuilt.headers.get("content-type"), "text/plain");
    assert.strictEqual(rebuilt.headers.get("x-request-id"), "request-1");
    assert.strictEqual(original.headers.get("x-request-id"), null);
    assert.strictEqual(yield* Effect.promise(() => rebuilt.text()), "request body");
  }),
);
