import * as Effect from "effect/Effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { Credentials, CredentialsFromSession } from "./credentials.ts";
import { Protocol, YahooProtocol } from "./protocol.ts";
import { Retry } from "./retry.ts";

export type RecordedCall = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Promise<string>;
};

const testSession = {
  cookie: Redacted.make("T=test-session; Y=test-user"),
};

export function recordingClient(respond: (call: Omit<RecordedCall, "body">) => Response): {
  readonly client: HttpClient.HttpClient;
  readonly calls: Array<RecordedCall>;
} {
  const calls: Array<RecordedCall> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const call = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers)),
      };
      calls.push({ ...call, body: Promise.resolve(bodyText(request.body)) });
      return HttpClientResponse.fromWeb(request, respond(call));
    }),
  );
  return { client, calls };
}

export function testLayer(
  client: HttpClient.HttpClient,
): Layer.Layer<HttpClient.HttpClient | Credentials | Protocol> {
  return Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient)(client),
    CredentialsFromSession(testSession),
    YahooProtocol,
    Layer.succeed(Retry)({ while: () => false }),
  );
}

function bodyText(body: HttpBody.HttpBody): string {
  return body instanceof HttpBody.Uint8Array
    ? (body.text ?? new TextDecoder().decode(body.body))
    : "";
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}
