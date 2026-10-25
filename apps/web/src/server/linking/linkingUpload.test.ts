import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AuthServiceShape } from "@lineupkeep/backend/auth/Auth";
import {
  linkingHelperClient,
  linkingHelperScope,
} from "@lineupkeep/backend/auth/AuthorizationScopes";
import { AuthorizationScopes } from "@lineupkeep/backend/auth/AuthorizationScopes";
import { AuthDatabaseTest } from "@lineupkeep/backend/auth/internal/AuthDatabaseTest";
import { AuthLive } from "@lineupkeep/backend/auth/internal/AuthLive";
import { BetterAuthAdapter } from "@lineupkeep/backend/auth/internal/BetterAuthAdapter";
import { SignInCodeQuotaRepository } from "@lineupkeep/backend/auth/internal/SignInCodeQuotaRepository";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import type { ProviderConnection } from "@lineupkeep/backend/connections/Connection";
import { StartLinkingInput } from "@lineupkeep/backend/connections/Connection";
import { connectionLinkingWindowMillis } from "@lineupkeep/backend/connections/ConnectionLimits";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import type { ConnectionsShape } from "@lineupkeep/backend/connections/Connections";
import { connectionScopes } from "@lineupkeep/backend/connections/ConnectionScopes";
import { ConnectionCredentialEncryption } from "@lineupkeep/backend/connections/internal/ConnectionCredentialEncryption";
import { ConnectionEncryptionKey } from "@lineupkeep/backend/connections/internal/ConnectionEncryptionKey";
import { ConnectionRepository } from "@lineupkeep/backend/connections/internal/ConnectionRepository";
import { ConnectionsDatabaseTest } from "@lineupkeep/backend/connections/internal/ConnectionsDatabaseTest";
import { ConnectionsLive } from "@lineupkeep/backend/connections/internal/ConnectionsLive";
import {
  FakeProviderWorld,
  ProviderFakeTest,
} from "@lineupkeep/backend/connections/internal/ProviderFakeTest";
import {
  EmailDeliveryTest,
  EmailOutbox,
} from "@lineupkeep/backend/email/internal/EmailDeliveryTest";
import { BackgroundWork } from "@lineupkeep/backend/runtime/BackgroundWork";
import { PublicInternet } from "@lineupkeep/backend/runtime/PublicInternet";
import { Array, ConfigProvider, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import { completeLinkingHelperUpload } from "./linkingUpload.ts";

it.effect(
  "completes a linking connection from an approved first-party helper token",
  () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const connections = yield* Connections;
      const provider = yield* FakeProviderWorld;
      const owner = yield* signIn(auth, "link-owner@example.test");
      const grant = yield* startDeviceAuthorization(auth, linkingHelperClient.clientId);
      yield* approve(auth, grant.user_code, owner.cookie);
      yield* provider.setTeams([
        {
          provider: "yahoo",
          providerTeamKey: "nfl.l.123.t.1",
          providerLeagueKey: "nfl.l.123",
          league: "nfl",
          sport: "football",
          season: 2026,
          name: "Test Team",
        },
      ]);
      const linking = yield* startLinking(connections, owner.id, grant.user_code);
      const token = yield* redeem(auth, grant.device_code, linkingHelperClient.clientId);

      const { response, text } = yield* upload(token, {
        userCode: grant.user_code,
        provider: "yahoo",
        session: sessionValue,
      });
      const teams = yield* connections.discoverTeams(owner.id, [{ id: linking.id }]);
      const listed = yield* connections.list(owner.id);

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(yield* jsonOfText(text), { status: "ready", provider: "yahoo" });
      assert.notInclude(text, sessionValue);
      assert.notInclude(text, token);
      assert.strictEqual(listed[0]?.status, "ready");
      assert.strictEqual(listed[0]?.credentialGeneration, 1);
      assert.deepStrictEqual(
        teams.map((team) => team.providerTeamKey),
        ["nfl.l.123.t.1"],
      );
    }).pipe(Effect.provide(TestLayer)),
  30_000,
);

it.effect(
  "refuses unapproved and malformed helper uploads without disclosing the session",
  () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const owner = yield* signIn(auth, "refused-owner@example.test");
      const grant = yield* startDeviceAuthorization(auth, linkingHelperClient.clientId);
      yield* approve(auth, grant.user_code, owner.cookie);
      const token = yield* redeem(auth, grant.device_code, linkingHelperClient.clientId);

      const anonymous = yield* upload(undefined, {
        userCode: grant.user_code,
        provider: "yahoo",
        session: sessionValue,
      });
      const invalid = yield* upload(token, "not-json");
      const wrongCode = yield* upload(token, {
        userCode: "ZZZZ9999",
        provider: "yahoo",
        session: sessionValue,
      });

      assert.strictEqual(anonymous.response.status, 401);
      assert.strictEqual(invalid.response.status, 400);
      assert.strictEqual(wrongCode.response.status, 404);
      for (const observation of [anonymous, invalid, wrongCode]) {
        assert.notInclude(observation.text, sessionValue);
        assert.notInclude(observation.text, token);
      }
    }).pipe(Effect.provide(TestLayer)),
  30_000,
);

it.effect(
  "refuses a token issued to a client other than the first-party helper",
  () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const owner = yield* signIn(auth, "foreign-client-owner@example.test");
      const grant = yield* startDeviceAuthorization(
        auth,
        metadataClientId,
        "connections:read",
        mcpResource,
      );
      yield* approve(auth, grant.user_code, owner.cookie);
      const token = yield* redeem(auth, grant.device_code, metadataClientId);
      const { response, text } = yield* upload(token, {
        userCode: grant.user_code,
        provider: "yahoo",
        session: sessionValue,
      });

      assert.strictEqual(response.status, 401);
      assert.deepStrictEqual(yield* jsonOfText(text), { error: "unauthorized" });
      assert.notInclude(text, token);
    }).pipe(Effect.provide(TestLayer)),
  30_000,
);

it.effect(
  "refuses a helper token that lacks the linking scope",
  () =>
    Effect.gen(function* () {
      const request = new Request("http://localhost:5173/api/linking/complete", {
        method: "POST",
        headers: { authorization: "Bearer read-only", "content-type": "application/json" },
        body: '{"userCode":"ABCD2345","provider":"yahoo","session":"T=test; Y=test"}',
      });

      const response = yield* completeLinkingHelperUpload(request).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(AuthService)({
              ...authServiceFake,
              resolveAccessToken: () => Effect.succeed({ status: "insufficient_scope" as const }),
            }),
            Layer.succeed(Connections)(connectionsFake),
          ),
        ),
      );

      assert.strictEqual(response.status, 403);
      assert.deepStrictEqual(yield* responseJson(response), { error: "insufficient_scope" });
    }),
  30_000,
);

it.effect(
  "scopes completion to the owner who approved the device request",
  () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const connections = yield* Connections;
      const owner = yield* signIn(auth, "pairing-owner@example.test");
      const other = yield* signIn(auth, "other-owner@example.test");
      const ownerGrant = yield* startDeviceAuthorization(auth, linkingHelperClient.clientId);
      yield* approve(auth, ownerGrant.user_code, owner.cookie);
      yield* startLinking(connections, owner.id, ownerGrant.user_code);
      const otherGrant = yield* startDeviceAuthorization(auth, linkingHelperClient.clientId);
      yield* approve(auth, otherGrant.user_code, other.cookie);
      const otherToken = yield* redeem(auth, otherGrant.device_code, linkingHelperClient.clientId);

      const { response } = yield* upload(otherToken, {
        userCode: ownerGrant.user_code,
        provider: "yahoo",
        session: sessionValue,
      });
      const listed = yield* connections.list(owner.id);

      assert.strictEqual(response.status, 404);
      assert.strictEqual(listed[0]?.status, "linking");
    }).pipe(Effect.provide(TestLayer)),
  30_000,
);

it.effect(
  "rejects an expired or cancelled pairing instead of writing a credential",
  () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const connections = yield* Connections;
      const owner = yield* signIn(auth, "expired-owner@example.test");
      const expiredGrant = yield* startDeviceAuthorization(auth, linkingHelperClient.clientId);
      yield* approve(auth, expiredGrant.user_code, owner.cookie);
      yield* startLinking(connections, owner.id, expiredGrant.user_code);
      const expiredToken = yield* redeem(
        auth,
        expiredGrant.device_code,
        linkingHelperClient.clientId,
      );
      yield* TestClock.adjust(connectionLinkingWindowMillis + 1);

      const expiredResult = yield* upload(expiredToken, {
        userCode: expiredGrant.user_code,
        provider: "yahoo",
        session: sessionValue,
      });

      const cancelledGrant = yield* startDeviceAuthorization(auth, linkingHelperClient.clientId);
      yield* approve(auth, cancelledGrant.user_code, owner.cookie);
      const cancelled = yield* startLinking(connections, owner.id, cancelledGrant.user_code);
      const cancelledToken = yield* redeem(
        auth,
        cancelledGrant.device_code,
        linkingHelperClient.clientId,
      );
      yield* connections.cancelLinking(owner.id, [{ id: cancelled.id }]);
      const cancelledResult = yield* upload(cancelledToken, {
        userCode: cancelledGrant.user_code,
        provider: "yahoo",
        session: sessionValue,
      });

      assert.strictEqual(expiredResult.response.status, 409);
      assert.deepStrictEqual(yield* jsonOfText(expiredResult.text), { error: "link_expired" });
      assert.strictEqual(cancelledResult.response.status, 404);
      assert.notInclude(cancelledResult.text, sessionValue);
    }).pipe(Effect.provide(TestLayer)),
  30_000,
);

it.effect(
  "keeps the connection linking when the provider rejects the uploaded session",
  () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const connections = yield* Connections;
      const provider = yield* FakeProviderWorld;
      const owner = yield* signIn(auth, "provider-rejected-owner@example.test");
      const grant = yield* startDeviceAuthorization(auth, linkingHelperClient.clientId);
      yield* approve(auth, grant.user_code, owner.cookie);
      yield* startLinking(connections, owner.id, grant.user_code);
      const token = yield* redeem(auth, grant.device_code, linkingHelperClient.clientId);
      yield* provider.rejectSession(true);

      const { response, text } = yield* upload(token, {
        userCode: grant.user_code,
        provider: "yahoo",
        session: sessionValue,
      });
      const listed = yield* connections.list(owner.id);

      assert.strictEqual(response.status, 422);
      assert.deepStrictEqual(yield* jsonOfText(text), { error: "provider_session_rejected" });
      assert.notInclude(text, sessionValue);
      assert.strictEqual(listed[0]?.status, "linking");
    }).pipe(Effect.provide(TestLayer)),
  30_000,
);

const requestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";
const sessionValue = "T=test-session-token; Y=test-user-token";
const mcpResource = "http://localhost:5173/mcp";
const metadataClientId = "https://linking-upload-client.test/client.json";

const EncryptionTestLayer = ConnectionCredentialEncryption.forKey(
  ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
    keyVersion: 1,
  }),
).pipe(Layer.provide(NodeCrypto.layer));

const clientMetadata = PublicInternet.fromTransport((request) =>
  Promise.resolve(
    Response.json({
      client_id: request.url,
      client_name: "Linking upload test client",
      redirect_uris: ["http://127.0.0.1:19999/callback"],
      grant_types: ["urn:ietf:params:oauth:grant-type:device_code"],
      response_types: [],
      token_endpoint_auth_method: "none",
    }),
  ),
);

const testConfig = {
  DATABASE_URL: "postgres://test:test@localhost:1/lineupkeep_test",
  BETTER_AUTH_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
  APP_ENV: "test",
  AUTH_CLIENT_IP_HEADERS: "x-forwarded-for",
};

const AuthLayer = AuthLive.pipe(
  Layer.provide(BetterAuthAdapter.layer),
  Layer.provide(Layer.succeed(AuthorizationScopes)(Object.values(connectionScopes))),
  Layer.provide(SignInCodeQuotaRepository.layer),
  Layer.provide(AuthDatabaseTest),
  Layer.provideMerge(EmailDeliveryTest),
  Layer.provide(BackgroundWork.processLifetime),
  Layer.provide(clientMetadata),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(testConfig))),
);

const ConnectionsLayer = ConnectionsLive.pipe(
  Layer.provide(ConnectionRepository.layer),
  Layer.provideMerge(ConnectionsDatabaseTest),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.orDie,
);

const TestLayer = ConnectionsLayer.pipe(
  Layer.provideMerge(AuthLayer),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);

const authServiceFake: AuthServiceShape = {
  signInMethods: { google: false },
  oauthResource: "http://localhost:5173/mcp",
  resolveAccessToken: () => Effect.succeed({ status: "invalid" as const }),
  getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
  consent: () => Effect.succeed("http://localhost:5173/connections"),
  handle: () => Effect.succeed(new Response()),
  getSession: () => Effect.void.pipe(Effect.as(undefined)),
  claimDeviceAuthorization: () => Effect.succeed({ clientId: "helper", scope: "connections:link" }),
  approveDeviceAuthorization: () => Effect.void,
  denyDeviceAuthorization: () => Effect.void,
};

const connectionsFake: ConnectionsShape = {
  list: () => Effect.succeed([]),
  startLinking: () => Effect.succeed([]),
  startReconnect: () => Effect.succeed([]),
  cancelLinking: () => Effect.succeed([]),
  completeLinking: () => Effect.succeed([]),
  completeReconnect: () => Effect.succeed([]),
  reconnect: () => Effect.succeed([]),
  disconnect: () => Effect.succeed([]),
  discoverTeams: () => Effect.succeed([]),
  listTeams: () => Effect.succeed([]),
};

function signIn(
  auth: AuthHandler,
  email: string,
): Effect.Effect<
  { readonly id: import("@lineupkeep/backend/auth/User").UserId; readonly cookie: string },
  never,
  EmailOutbox
> {
  return Effect.gen(function* () {
    const requested = yield* auth.handle(
      authRequest("/email-otp/send-verification-otp", { email, type: "sign-in" }),
    );
    assert.strictEqual(requested.status, 200);
    const outbox = yield* EmailOutbox;
    const code = /\b(\d{6})\b/u.exec(
      (yield* outbox.messages).findLast((message) => message.to === email)?.text ?? "",
    )?.[1];
    if (code === undefined) {
      return yield* Effect.die("the delivered email contains a sign-in code");
    }
    const signedIn = yield* auth.handle(authRequest("/sign-in/email-otp", { email, otp: code }));
    assert.strictEqual(signedIn.status, 200);
    const cookie = cookieHeader(signedIn);
    const session = yield* auth.getSession(new Headers({ cookie }));
    if (session === undefined) {
      return yield* Effect.die("the signed-in session exists");
    }
    return { id: decodeUserId(session.user.id), cookie };
  }).pipe(Effect.orDie);
}

function startDeviceAuthorization(
  auth: AuthHandler,
  clientId: string,
  scope: string = linkingHelperScope.name,
  resource: string = mcpResource,
): Effect.Effect<DeviceGrant> {
  return Effect.gen(function* () {
    const response = yield* auth.handle(
      authRequest("/device/code", {
        client_id: clientId,
        scope,
        resource,
      }),
    );
    assert.strictEqual(response.status, 200, yield* Effect.promise(() => response.clone().text()));
    return yield* jsonOf(
      response,
      Schema.Struct({
        device_code: Schema.String,
        user_code: Schema.String,
      }),
    );
  }).pipe(Effect.orDie);
}

function approve(auth: AuthHandler, userCode: string, cookie: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const claimed = yield* auth.handle(
      new Request(
        `http://localhost:5173/api/auth/device?user_code=${encodeURIComponent(userCode)}`,
        { headers: { cookie } },
      ),
    );
    assert.strictEqual(claimed.status, 200);
    const approved = yield* auth.handle(authRequest("/device/approve", { userCode }, { cookie }));
    assert.strictEqual(approved.status, 200);
  }).pipe(Effect.orDie);
}

function redeem(auth: AuthHandler, deviceCode: string, clientId: string): Effect.Effect<string> {
  return Effect.gen(function* () {
    const response = yield* auth.handle(
      new Request("http://localhost:5173/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: clientId,
        }),
      }),
    );
    assert.strictEqual(response.status, 200);
    return (yield* jsonOf(response, Schema.Struct({ access_token: Schema.String }))).access_token;
  }).pipe(Effect.orDie);
}

function startLinking(
  connections: ConnectionsShape,
  userId: import("@lineupkeep/backend/auth/User").UserId,
  pairingCode: string,
): Effect.Effect<ProviderConnection> {
  const input = Schema.decodeSync(StartLinkingInput)({
    requestId,
    provider: "yahoo",
    pairingCode,
  });
  return connections.startLinking(userId, [input]).pipe(
    Effect.map((created) => Array.getUnsafe(created, 0)),
    Effect.orDie,
  );
}

function upload(
  token: string | undefined,
  body: unknown,
): Effect.Effect<UploadObservation, never, AuthService | Connections> {
  const request = new Request("http://localhost:5173/api/linking/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:5173",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body:
      typeof body === "string"
        ? body
        : Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(body),
  });
  return completeLinkingHelperUpload(request).pipe(
    Effect.flatMap((response) =>
      Effect.promise(() => response.text()).pipe(Effect.map((text) => ({ response, text }))),
    ),
    Effect.orDie,
  );
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

function responseJson(response: Response): Effect.Effect<unknown> {
  return Effect.promise(() => response.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Unknown)),
    Effect.orDie,
  );
}

function jsonOfText(text: string): Effect.Effect<unknown> {
  return Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(Effect.orDie);
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

type AuthHandler = Pick<AuthServiceShape, "handle" | "getSession">;

type DeviceGrant = {
  readonly device_code: string;
  readonly user_code: string;
};

type UploadObservation = {
  readonly response: Response;
  readonly text: string;
};
