import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AuthServiceShape } from "@lineupkeep/backend/auth/Auth";
import {
  AuthorizationScopes,
  linkingHelperClient,
  linkingHelperScope,
} from "@lineupkeep/backend/auth/AuthorizationScopes";
import { AuthDatabase } from "@lineupkeep/backend/auth/internal/AuthDatabase";
import { AuthDatabaseTest } from "@lineupkeep/backend/auth/internal/AuthDatabaseTest";
import { AuthLive } from "@lineupkeep/backend/auth/internal/AuthLive";
import { BetterAuthAdapter } from "@lineupkeep/backend/auth/internal/BetterAuthAdapter";
import { OAuthClientRepository } from "@lineupkeep/backend/auth/internal/OAuthClientRepository";
import { deviceCode } from "@lineupkeep/backend/auth/internal/OAuthTables";
import { SignInCodeQuotaRepository } from "@lineupkeep/backend/auth/internal/SignInCodeQuotaRepository";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { connectionScopes } from "@lineupkeep/backend/connections/ConnectionScopes";
import {
  EmailDeliveryTest,
  EmailOutbox,
} from "@lineupkeep/backend/email/internal/EmailDeliveryTest";
import { BackgroundWork } from "@lineupkeep/backend/runtime/BackgroundWork";
import { PublicInternet } from "@lineupkeep/backend/runtime/PublicInternet";
import { eq } from "drizzle-orm";
import { ConfigProvider, Context, DateTime, Effect, Fiber, Layer, Redacted, Ref } from "effect";
import { TestClock } from "effect/testing";

import { AppTransport } from "./AppTransport.ts";
import { TransportFailure } from "./AppTransport.ts";
import { DeviceAuthorizationLive } from "./DeviceAuthorization.ts";
import { DeviceAuthorization } from "./DeviceAuthorization.ts";

it.effect(
  "starts the first-party pairing request and redeems an approved helper token",
  () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const device = yield* DeviceAuthorization;
      const owner = yield* signIn(auth, "device-owner@example.test");
      const grant = yield* device.start(deviceInput);

      assert.strictEqual(grant.verificationUri.href, "http://localhost:5173/connections");
      assert.isAtLeast(grant.userCode.length, 1);
      assert.isAtMost(grant.expiresInSeconds, 600);
      assert.isAtLeast(grant.intervalSeconds, 1);

      const claimed = yield* auth.claimDeviceAuthorization(
        new Headers({ cookie: owner }),
        grant.userCode,
      );
      assert.deepStrictEqual(claimed, {
        clientId: linkingHelperClient.clientId,
        scope: linkingHelperScope.name,
      });
      yield* auth.approveDeviceAuthorization(new Headers({ cookie: owner }), grant.userCode);

      const token = yield* device.awaitApproval(grant);
      const session = yield* auth.getSession(new Headers({ cookie: owner }));
      if (session === undefined) {
        return yield* Effect.die("the signed-in session exists");
      }
      assert.deepStrictEqual(
        yield* auth.resolveAccessToken(
          Redacted.value(token),
          [linkingHelperScope.name],
          linkingHelperClient.clientId,
        ),
        { status: "authenticated", userId: decodeUserId(session.user.id) },
      );
    }).pipe(Effect.provide(realAuthLayer)),
  30_000,
);

it.effect(
  "stops polling when the owner denies the approved helper request",
  () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const device = yield* DeviceAuthorization;
      const owner = yield* signIn(auth, "denied-owner@example.test");
      const grant = yield* device.start(deviceInput);
      yield* auth.claimDeviceAuthorization(new Headers({ cookie: owner }), grant.userCode);
      yield* auth.denyDeviceAuthorization(new Headers({ cookie: owner }), grant.userCode);

      const error = yield* Effect.flip(device.awaitApproval(grant));

      assert.strictEqual(error._tag, "linking_helper.device_denied");
    }).pipe(Effect.provide(realAuthLayer)),
  30_000,
);

it.effect(
  "stops polling when the device code expires in the auth layer",
  () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const device = yield* DeviceAuthorization;
      const database = yield* AuthDatabase;
      const owner = yield* signIn(auth, "expired-device-owner@example.test");
      const grant = yield* device.start(deviceInput);
      yield* auth.claimDeviceAuthorization(new Headers({ cookie: owner }), grant.userCode);
      yield* auth.approveDeviceAuthorization(new Headers({ cookie: owner }), grant.userCode);
      yield* Effect.promise(() =>
        database
          .update(deviceCode)
          .set({ expiresAt: DateTime.toDateUtc(DateTime.makeUnsafe(0)) })
          .where(eq(deviceCode.deviceCode, Redacted.value(grant.deviceCode))),
      );

      const error = yield* Effect.flip(device.awaitApproval(grant));

      assert.strictEqual(error._tag, "linking_helper.device_expired");
    }).pipe(Effect.provide(realAuthLayer)),
  30_000,
);

it.effect(
  "polls at the advertised interval and backs off after slow_down",
  () =>
    Effect.gen(function* () {
      const device = yield* DeviceAuthorization;
      const fake = yield* FakeDeviceServer;

      yield* fake.setScenario("pending");
      const grant = yield* device.start(deviceInput);
      const fiber = yield* Effect.forkChild(device.awaitApproval(grant));
      yield* waitForPoll(fake);
      yield* TestClock.adjust(5_000);
      const token = yield* Fiber.join(fiber);

      assert.strictEqual(Redacted.value(token), tokenValue);
      assert.strictEqual(pollGap(yield* Ref.get(fake.pollTimes)), 5_000);

      yield* fake.setScenario("slow");
      const slowGrant = yield* device.start(deviceInput);
      const slowFiber = yield* Effect.forkChild(device.awaitApproval(slowGrant));
      yield* waitForPoll(fake);
      yield* TestClock.adjust(10_000);

      assert.strictEqual(Redacted.value(yield* Fiber.join(slowFiber)), tokenValue);
      assert.strictEqual(pollGap(yield* Ref.get(fake.pollTimes)), 10_000);
    }).pipe(Effect.provide(fakeDeviceLayer)),
  30_000,
);

const deviceInput = {
  appUrl: new URL("http://localhost:5173"),
  clientId: linkingHelperClient.clientId,
  scope: linkingHelperScope.name,
  resource: "http://localhost:5173/mcp",
};

function signIn(auth: AuthServiceShape, email: string): Effect.Effect<string, never, EmailOutbox> {
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
    return cookieHeader(signedIn);
  }).pipe(Effect.orDie);
}

function authRequest(path: string, body: Record<string, string>): Request {
  return new Request(`http://localhost:5173/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:5173",
    },
    body: JSON.stringify(body),
  });
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

const authTransport: Layer.Layer<AppTransport, never, AuthService> = Layer.effect(
  AppTransport,
  Effect.gen(function* () {
    const auth = yield* AuthService;
    return AppTransport.of({
      send: (request) =>
        auth.handle(request).pipe(
          Effect.flatMap((response) =>
            Effect.promise(() => response.text()).pipe(
              Effect.map((body) => ({ status: response.status, body })),
            ),
          ),
          Effect.mapError(() => TransportFailure.make({})),
        ),
    });
  }),
);

const AuthLayer = AuthLive.pipe(
  Layer.provide(BetterAuthAdapter.layer),
  Layer.provide(Layer.succeed(AuthorizationScopes)(Object.values(connectionScopes))),
  Layer.provide(SignInCodeQuotaRepository.layer),
  Layer.provide(OAuthClientRepository.layer),
  Layer.provideMerge(AuthDatabaseTest),
  Layer.provideMerge(EmailDeliveryTest),
  Layer.provide(BackgroundWork.processLifetime),
  Layer.provide(
    PublicInternet.fromTransport(() =>
      Promise.reject(new Error("CIMD is not used by the first-party helper")),
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

const realAuthLayer = DeviceAuthorizationLive.pipe(
  Layer.provide(authTransport),
  Layer.provideMerge(AuthLayer),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);

type FakeScenario = "pending" | "slow";

type FakeDeviceServerShape = {
  readonly pollTimes: Ref.Ref<ReadonlyArray<number>>;
  readonly scenario: Ref.Ref<FakeScenario>;
  readonly setScenario: (scenario: FakeScenario) => Effect.Effect<void>;
};

class FakeDeviceServer extends Context.Service<FakeDeviceServer, FakeDeviceServerShape>()(
  "@lineupkeep/linking-helper/DeviceAuthorization.test/FakeDeviceServer",
) {}

const FakeDeviceServerLive = Layer.effect(
  FakeDeviceServer,
  Effect.gen(function* () {
    const pollTimes = yield* Ref.make<ReadonlyArray<number>>([]);
    const scenario = yield* Ref.make<FakeScenario>("pending");
    return {
      pollTimes,
      scenario,
      setScenario: (next) => Ref.set(scenario, next),
    };
  }),
);

const fakeDeviceLayer = DeviceAuthorizationLive.pipe(
  Layer.provide(
    Layer.effect(
      AppTransport,
      Effect.gen(function* () {
        const fake = yield* FakeDeviceServer;
        return AppTransport.of({
          send: (request) =>
            Effect.gen(function* () {
              if (new URL(request.url).pathname === "/api/auth/device/code") {
                yield* Ref.set(fake.pollTimes, []);
                return { status: 200, body: deviceCodeResponse };
              }
              const now = DateTime.toEpochMillis(yield* DateTime.now);
              const current = yield* Ref.updateAndGet(fake.pollTimes, (times) => [...times, now]);
              const currentScenario = yield* Ref.get(fake.scenario);
              if (current.length === 1) {
                return {
                  status: 400,
                  body:
                    currentScenario === "slow"
                      ? '{"error":"slow_down"}'
                      : '{"error":"authorization_pending"}',
                };
              }
              return { status: 200, body: tokenResponse };
            }),
        });
      }),
    ),
  ),
  Layer.provideMerge(FakeDeviceServerLive),
  Layer.orDie,
);

function pollGap(times: ReadonlyArray<number>): number {
  const first = times[0];
  const second = times[1];
  return first === undefined || second === undefined ? 0 : second - first;
}

function waitForPoll(fake: FakeDeviceServerShape): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((yield* Ref.get(fake.pollTimes)).length > 0) {
        return;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die("the helper did not poll");
  });
}

const deviceCodeResponse = JSON.stringify({
  device_code: "device-code-value",
  user_code: "ABCD2345",
  verification_uri: "http://localhost:5173/connections",
  verification_uri_complete: "http://localhost:5173/connections?user_code=ABCD2345",
  expires_in: 600,
  interval: 5,
});

const tokenValue = "helper-access-token";
const tokenResponse = JSON.stringify({ access_token: tokenValue, token_type: "Bearer" });
