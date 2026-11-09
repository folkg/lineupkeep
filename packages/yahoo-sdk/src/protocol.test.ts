import { assert, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";

import { Credentials, CredentialsFromSession } from "./credentials.ts";
import { Protocol, YahooProtocol } from "./protocol.ts";
import { jsonResponse, recordingClient } from "./testSupportTest.ts";

const session = { cookie: Redacted.make("T=test-session; Y=test-user") };

function layer(
  client: HttpClient.HttpClient,
): Layer.Layer<HttpClient.HttpClient | Credentials | Protocol> {
  return Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient)(client),
    CredentialsFromSession(session),
    YahooProtocol,
  );
}

it.effect("builds one exact read request with the session cookie", () => {
  const recording = recordingClient(() => jsonResponse({}));
  return Effect.gen(function* () {
    const protocol = yield* Protocol;
    const request = yield* protocol.encode({
      request: {
        host: "read",
        method: "GET",
        path: "/fantasy/v2/league/466.l.4000/settings",
      },
      write: false,
    });

    assert.strictEqual(
      request.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/settings?format=json",
    );
    assert.strictEqual(request.method, "GET");
    assert.strictEqual(request.headers["cookie"], "T=test-session; Y=test-user");
    assert.strictEqual(recording.calls.length, 0);
  }).pipe(Effect.provide(layer(recording.client)));
});

it.effect("reads a crumb before building a write request", () => {
  const recording = recordingClient(() => jsonResponse({ service: { crumb: "canary-crumb" } }));
  return Effect.gen(function* () {
    const protocol = yield* Protocol;
    const request = yield* protocol.encode({
      request: {
        host: "write",
        method: "POST",
        path: "/fantasy/v2/league/466.l.4000/transactions",
        body: "<transaction/>",
      },
      write: true,
    });

    assert.strictEqual(
      request.url,
      "https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions?format=json_f&crumb=canary-crumb",
    );
    assert.strictEqual(request.headers["content-type"], "application/xml");
    assert.strictEqual(recording.calls.length, 1);
    assert.strictEqual(
      recording.calls[0]?.url,
      "https://pub-api.fantasysports.yahoo.com/fantasy/v3/getCrumb?format=json_f",
    );
  }).pipe(Effect.provide(layer(recording.client)));
});

it.effect("reports a missing crumb as not sent", () => {
  const recording = recordingClient(() => jsonResponse({ service: { crumb: null } }));
  return Effect.gen(function* () {
    const protocol = yield* Protocol;
    const error = yield* Effect.flip(
      protocol.encode({
        request: {
          host: "write",
          method: "POST",
          path: "/fantasy/v2/league/466.l.4000/transactions",
          body: "<transaction/>",
        },
        write: true,
      }),
    );

    assert.strictEqual(error._tag, "YahooNotSent");
    if (error._tag === "YahooNotSent") {
      assert.strictEqual(error.reason, "session_incomplete");
    }
  }).pipe(Effect.provide(layer(recording.client)));
});

it.effect("refuses a path that escapes its fixed origin", () => {
  const recording = recordingClient(() => jsonResponse({}));
  return Effect.gen(function* () {
    const protocol = yield* Protocol;
    const error = yield* Effect.flip(
      protocol.encode({
        request: { host: "read", method: "GET", path: "//evil.example/x" },
        write: false,
      }),
    );

    assert.strictEqual(error._tag, "YahooParseError");
    if (error._tag === "YahooParseError") {
      assert.strictEqual(error.field, "path");
    }
  }).pipe(Effect.provide(layer(recording.client)));
});

it.effect("refuses a redirect instead of following it", () => {
  const protocolRequest = HttpClientRequest.get("https://pub-api-ro.fantasysports.yahoo.com/x");
  const response = HttpClientResponse.fromWeb(
    protocolRequest,
    new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
  );
  return Effect.gen(function* () {
    const protocol = yield* Protocol;
    const error = yield* Effect.flip(
      protocol.decode({
        operation: "read_league_settings",
        response,
        input: {},
        decode: () => Effect.succeed({}),
        write: false,
      }),
    );

    assert.strictEqual(error._tag, "YahooHttpError");
    if (error._tag === "YahooHttpError") {
      assert.strictEqual(error.status, 302);
    }
  }).pipe(Effect.provide(layer(recordingClient(() => jsonResponse({})).client)));
});

it.effect("stops a write response above its byte bound", () => {
  const protocolRequest = HttpClientRequest.get("https://pub-api-rw.fantasysports.yahoo.com/x");
  const response = HttpClientResponse.fromWeb(
    protocolRequest,
    new Response("x".repeat(300 * 1024), { status: 200 }),
  );
  return Effect.gen(function* () {
    const protocol = yield* Protocol;
    const error = yield* Effect.flip(
      protocol.decode({
        operation: "apply_transaction",
        response,
        input: {},
        decode: () => Effect.succeed({}),
        write: true,
      }),
    );

    assert.strictEqual(error._tag, "YahooWriteUnknown");
  }).pipe(Effect.provide(layer(recordingClient(() => jsonResponse({})).client)));
});
