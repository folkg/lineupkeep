import { assert, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Schema } from "effect";

import { AppTransport } from "./AppTransport.ts";
import type { AppResponse } from "./AppTransport.ts";
import { TransportFailure } from "./AppTransport.ts";
import { LinkingUpload, LinkingUploadLive } from "./LinkingUpload.ts";
import type { LinkingUploadFailure } from "./LinkingUpload.ts";

it.effect(
  "uploads the bearer-authorized session to the app's linking endpoint",
  () =>
    Effect.gen(function* () {
      const requests: Array<Request> = [];
      yield* Effect.gen(function* () {
        const upload = yield* LinkingUpload;
        return yield* upload.upload(input);
      }).pipe(
        Effect.provide(
          LinkingUploadLive.pipe(
            Layer.provide(
              Layer.succeed(AppTransport)({
                send: (request) =>
                  Effect.sync(() => {
                    requests.push(request);
                  }).pipe(Effect.as(successResponse)),
              }),
            ),
          ),
        ),
      );

      const request = requests[0];
      if (request === undefined) {
        return yield* Effect.die("the helper sends one upload request");
      }
      const body = yield* Schema.decodeEffect(
        Schema.fromJsonString(
          Schema.Struct({
            userCode: Schema.String,
            provider: Schema.String,
            session: Schema.String,
          }),
        ),
      )(yield* Effect.promise(() => request.text())).pipe(Effect.orDie);

      assert.strictEqual(request.url, "http://localhost:5173/api/linking/complete");
      assert.strictEqual(request.method, "POST");
      assert.strictEqual(request.headers.get("authorization"), `Bearer ${tokenValue}`);
      assert.deepStrictEqual(body, {
        userCode: "ABCD2345",
        provider: "yahoo",
        session: sessionValue,
      });
    }),
  30_000,
);

it.effect(
  "maps each upload refusal to an actionable failure",
  () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [number, string, LinkingUploadFailure["_tag"]]> = [
        [401, '{"error":"unauthorized"}', "linking_helper.upload_unauthorized"],
        [403, '{"error":"insufficient_scope"}', "linking_helper.upload_unauthorized"],
        [404, '{"error":"connection_not_found"}', "linking_helper.upload_pairing_not_found"],
        [409, '{"error":"link_expired"}', "linking_helper.upload_expired"],
        [409, '{"error":"link_cancelled"}', "linking_helper.upload_rejected"],
        [409, '{"error":"link_rejected"}', "linking_helper.upload_rejected"],
        [422, '{"error":"provider_session_rejected"}', "linking_helper.upload_provider_rejected"],
        [503, '{"error":"provider_unavailable"}', "linking_helper.upload_provider_unavailable"],
        [503, '{"error":"temporarily_unavailable"}', "linking_helper.upload_unavailable"],
        [400, '{"error":"invalid_request"}', "linking_helper.upload_invalid_response"],
        [200, "not-json", "linking_helper.upload_invalid_response"],
      ];

      for (const [status, body, tag] of cases) {
        const error = yield* Effect.flip(uploadWith(Effect.succeed({ status, body })));
        assert.strictEqual(error._tag, tag);
        assert.notInclude(error.message, tokenValue);
        assert.notInclude(error.message, sessionValue);
      }

      const unreachable = yield* Effect.flip(uploadWith(Effect.fail(TransportFailure.make({}))));
      assert.strictEqual(unreachable._tag, "linking_helper.upload_unreachable");
    }),
  30_000,
);

function uploadWith(
  response: Effect.Effect<AppResponse, TransportFailure>,
): Effect.Effect<void, LinkingUploadFailure> {
  return Effect.gen(function* () {
    const upload = yield* LinkingUpload;
    return yield* upload.upload(input);
  }).pipe(Effect.provide(AppTransportLayerFor(response)));
}

function AppTransportLayerFor(
  response: Effect.Effect<AppResponse, TransportFailure>,
): Layer.Layer<LinkingUpload> {
  return LinkingUploadLive.pipe(
    Layer.provide(
      Layer.succeed(AppTransport)({
        send: () => response,
      }),
    ),
  );
}

const tokenValue = "token-canary-value";
const sessionValue = "T=session-canary; Y=user-canary";

const input = {
  appUrl: new URL("http://localhost:5173"),
  token: Redacted.make(tokenValue),
  userCode: "ABCD2345",
  provider: "yahoo" as const,
  session: Redacted.make(sessionValue),
};

const successResponse = { status: 200, body: '{"status":"ready","provider":"yahoo"}' };
