import { assert, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { googleCloudTelemetryClient } from "./GoogleCloudTelemetry.ts";

it.effect("mints one runtime service account token and reuses it for exports", () =>
  Effect.gen(function* () {
    const requests: Array<{ readonly url: string; readonly authorization: string | undefined }> =
      [];
    const client = yield* googleCloudTelemetryClient(responder(requests));

    yield* client.post("https://telemetry.googleapis.com/v1/traces");
    yield* client.post("https://telemetry.googleapis.com/v1/traces");

    assert.deepStrictEqual(
      requests.map(({ url, authorization }) => [url, authorization]),
      [
        [
          "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
          undefined,
        ],
        ["https://telemetry.googleapis.com/v1/traces", "Bearer private-runtime-token"],
        ["https://telemetry.googleapis.com/v1/traces", "Bearer private-runtime-token"],
      ],
    );
  }),
);

it.effect("fails the export instead of the caller when the metadata server is unavailable", () =>
  Effect.gen(function* () {
    const requests: Array<{ readonly url: string; readonly authorization: string | undefined }> =
      [];
    const client = yield* googleCloudTelemetryClient(
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response("unavailable", { status: 503 })),
        ),
      ),
    );

    const exit = yield* Effect.exit(client.post("https://telemetry.googleapis.com/v1/traces"));

    assert.isTrue(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) {
      assert.isFalse(exit.cause.reasons.some((reason) => reason._tag === "Die"));
    }
    assert.deepStrictEqual(requests, []);
  }),
);

function responder(
  requests: Array<{ readonly url: string; readonly authorization: string | undefined }>,
): HttpClient.HttpClient {
  return HttpClient.make((request, url) => {
    requests.push({ url: url.href, authorization: request.headers["authorization"] });
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        url.hostname === "metadata.google.internal"
          ? Response.json({ access_token: "private-runtime-token", expires_in: 3600 })
          : new Response(null, { status: 200 }),
      ),
    );
  });
}
