import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { ConfigProvider, DateTime, Effect, Layer, Schema } from "effect";

import { AuthorizationScopes } from "#contexts/auth/AuthorizationScopes.ts";
import { EmailDeliveryTest, EmailOutbox } from "#email/internal/EmailDeliveryTest.ts";
import { BackgroundWork } from "#runtime/BackgroundWork.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { AuthDatabaseTest } from "./AuthDatabaseTest.ts";
import { BetterAuthAdapter } from "./BetterAuthAdapter.ts";
import { deviceCode } from "./OAuthTables.ts";
import { SignInCodeQuotaRepository } from "./SignInCodeQuotaRepository.ts";

it.effect(
  "pairs a local helper through device authorization and consumes the grant once",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const database = yield* AuthDatabase;
      const owner = yield* signIn(adapter, "owner@example.test");
      const other = yield* signIn(adapter, "other@example.test");
      const grant = yield* startDeviceAuthorization(adapter);

      const claimed = yield* adapter.handle(deviceVerificationRequest(grant.user_code, owner));
      const review = yield* jsonOf(
        claimed,
        Schema.Struct({
          user_code: Schema.String,
          status: Schema.Literal("pending"),
          client_id: Schema.String,
          scope: Schema.String,
        }),
      );
      assert.strictEqual(claimed.status, 200);
      assert.strictEqual(review.user_code, grant.user_code);
      assert.strictEqual(review.client_id, helperClientId);
      assert.strictEqual(review.scope, "connections:read");

      const forbidden = yield* adapter.handle(deviceApprovalRequest(grant.user_code, other));
      assert.strictEqual(forbidden.status, 403);
      assert.strictEqual(
        (yield* jsonOf(forbidden, Schema.Struct({ error: Schema.String }))).error,
        "access_denied",
      );

      const approved = yield* adapter.handle(deviceApprovalRequest(grant.user_code, owner));
      assert.strictEqual(approved.status, 200);
      assert.deepStrictEqual(yield* jsonOf(approved, Schema.Struct({ success: Schema.Boolean })), {
        success: true,
      });

      const exchanged = yield* adapter.handle(
        deviceTokenRequest(grant.device_code, helperClientId),
      );
      const credentials = yield* jsonOf(
        exchanged,
        Schema.Struct({
          access_token: Schema.String,
          token_type: Schema.Literal("Bearer"),
          expires_in: Schema.Finite,
          scope: Schema.String,
        }),
      );
      assert.strictEqual(exchanged.status, 200);
      assert.include(credentials.scope, "connections:read");
      assert.isAtMost(credentials.expires_in, 300);
      assert.isAbove(credentials.access_token.length, 0);

      const replay = yield* adapter.handle(deviceTokenRequest(grant.device_code, helperClientId));
      assert.strictEqual(replay.status, 400);
      assert.strictEqual(
        (yield* jsonOf(replay, Schema.Struct({ error: Schema.String }))).error,
        "invalid_grant",
      );

      const expired = yield* startDeviceAuthorization(adapter);
      yield* Effect.promise(() =>
        database
          .update(deviceCode)
          .set({ expiresAt: DateTime.toDateUtc(DateTime.makeUnsafe(0)) })
          .where(eq(deviceCode.deviceCode, expired.device_code)),
      );
      const rejected = yield* adapter.handle(
        deviceTokenRequest(expired.device_code, helperClientId),
      );
      assert.strictEqual(rejected.status, 400);
      assert.strictEqual(
        (yield* jsonOf(rejected, Schema.Struct({ error: Schema.String }))).error,
        "expired_token",
      );
    }).pipe(Effect.provide(adapterLayer())),
  30_000,
);

const helperClientId = "https://connections-client.test/client.json";

type AuthHandler = {
  readonly handle: (
    request: Request,
  ) => Effect.Effect<Response, import("#contexts/auth/Auth.ts").AuthenticationUnavailable>;
};

const adapterLayer = (): Layer.Layer<
  | AuthDatabase
  | BetterAuthAdapter
  | import("effect/Crypto").Crypto
  | EmailOutbox
  | BackgroundWork
  | PublicInternet
  | SignInCodeQuotaRepository,
  import("effect/Config").ConfigError,
  never
> =>
  BetterAuthAdapter.layer.pipe(
    Layer.provideMerge(SignInCodeQuotaRepository.layer),
    Layer.provide(
      Layer.succeed(AuthorizationScopes)([
        { name: "connections:read", description: "Read connection metadata." },
        { name: "connections:write", description: "Change connection metadata." },
      ]),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        AuthDatabaseTest,
        BackgroundWork.processLifetime,
        EmailDeliveryTest,
        NodeCrypto.layer,
        deviceMetadata,
      ),
    ),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          DATABASE_URL: "postgres://test:test@localhost:1/lineupkeep_test",
          BETTER_AUTH_URL: "http://localhost:5173",
          BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
          APP_ENV: "test",
          AUTH_CLIENT_IP_HEADERS: "x-forwarded-for",
        }),
      ),
    ),
  );

const deviceMetadata = PublicInternet.fromTransport((request) =>
  Promise.resolve(
    Response.json({
      client_id: request.url,
      client_name: "Lineupkeep local helper",
      redirect_uris: ["http://127.0.0.1:19999/callback"],
      grant_types: ["urn:ietf:params:oauth:grant-type:device_code"],
      response_types: [],
      token_endpoint_auth_method: "none",
    }),
  ),
);

function startDeviceAuthorization(adapter: AuthHandler): Effect.Effect<
  {
    readonly device_code: string;
    readonly user_code: string;
    readonly expires_in: number;
    readonly interval: number;
  },
  import("#contexts/auth/Auth.ts").AuthenticationUnavailable,
  never
> {
  return Effect.gen(function* () {
    const response = yield* adapter.handle(
      authRequest("/device/code", {
        client_id: helperClientId,
        scope: "connections:read",
      }),
    );
    assert.strictEqual(response.status, 200);
    return yield* jsonOf(
      response,
      Schema.Struct({
        device_code: Schema.String,
        user_code: Schema.String,
        verification_uri: Schema.String,
        verification_uri_complete: Schema.String,
        expires_in: Schema.Finite,
        interval: Schema.Finite,
      }),
    );
  });
}

function signIn(
  adapter: AuthHandler,
  email: string,
): Effect.Effect<string, import("#contexts/auth/Auth.ts").AuthenticationUnavailable, EmailOutbox> {
  return Effect.gen(function* () {
    const requested = yield* adapter.handle(
      authRequest("/email-otp/send-verification-otp", { email, type: "sign-in" }),
    );
    assert.strictEqual(requested.status, 200);
    const outbox = yield* EmailOutbox;
    const messages = yield* outbox.messages;
    const code = /\b(\d{6})\b/u.exec(
      messages.findLast((message) => message.to === email)?.text ?? "",
    )?.[1];
    if (code === undefined) {
      return yield* Effect.die("the delivered email contains a sign-in code");
    }
    const signedIn = yield* adapter.handle(authRequest("/sign-in/email-otp", { email, otp: code }));
    assert.strictEqual(signedIn.status, 200);
    return cookieHeader(signedIn);
  });
}

function deviceVerificationRequest(userCode: string, cookie: string): Request {
  return new Request(
    `http://localhost:5173/api/auth/device?user_code=${encodeURIComponent(userCode)}`,
    { headers: { cookie } },
  );
}

function deviceApprovalRequest(userCode: string, cookie: string): Request {
  return authRequest("/device/approve", { userCode }, { cookie });
}

function deviceTokenRequest(deviceCodeValue: string, clientId: string): Request {
  return new Request("http://localhost:5173/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCodeValue,
      client_id: clientId,
    }),
  });
}

function authRequest(
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost:5173/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173", ...headers },
    body: JSON.stringify(body),
  });
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function jsonOf<S extends Schema.Top & { readonly DecodingServices: never }>(
  response: Response,
  schema: S,
): Effect.Effect<S["Type"], never, S["DecodingServices"]> {
  return Effect.promise(() => response.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.orDie,
  );
}

it.effect(
  "claims and approves a device request through the auth service methods",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const owner = yield* signIn(adapter, "service-owner@example.test");
      const grant = yield* startDeviceAuthorization(adapter);

      const review = yield* adapter.claimDeviceAuthorization(
        new Headers({ cookie: owner }),
        grant.user_code,
      );
      assert.deepStrictEqual(review, { clientId: helperClientId, scope: "connections:read" });

      yield* adapter.approveDeviceAuthorization(new Headers({ cookie: owner }), grant.user_code);

      const redeemed = yield* adapter.handle(deviceTokenRequest(grant.device_code, helperClientId));
      assert.strictEqual(redeemed.status, 200);
    }).pipe(Effect.provide(adapterLayer())),
  30_000,
);
