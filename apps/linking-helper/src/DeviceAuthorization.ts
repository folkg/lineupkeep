import { Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";

import { AppTransport } from "./AppTransport.ts";

export class DeviceAuthorization extends Context.Service<
  DeviceAuthorization,
  DeviceAuthorizationShape
>()("@lineupkeep/linking-helper/DeviceAuthorization") {}

export type StartDeviceAuthorization = {
  readonly appUrl: URL;
  readonly clientId: string;
  readonly scope: string;
  readonly resource: string;
};

export type DeviceGrant = {
  readonly appUrl: URL;
  readonly clientId: string;
  readonly deviceCode: Redacted.Redacted<string>;
  readonly userCode: string;
  readonly verificationUri: URL;
  readonly expiresInSeconds: number;
  readonly expiresAtMillis: number;
  readonly intervalSeconds: number;
};

export type DeviceAuthorizationShape = {
  readonly start: (
    input: StartDeviceAuthorization,
  ) => Effect.Effect<DeviceGrant, DeviceFlowFailure>;
  readonly awaitApproval: (
    grant: DeviceGrant,
  ) => Effect.Effect<Redacted.Redacted<string>, DeviceFlowFailure>;
};

export const DeviceAuthorizationLive = Layer.effect(
  DeviceAuthorization,
  Effect.gen(function* () {
    const transport = yield* AppTransport;

    const start = Effect.fn("DeviceAuthorization.start")(function* (
      input: StartDeviceAuthorization,
    ) {
      const response = yield* transport
        .send(deviceCodeRequest(input))
        .pipe(Effect.mapError(() => DeviceAuthorizationUnreachable.make({})));
      if (response.status !== 200) {
        return yield* DeviceAuthorizationRejected.make({});
      }
      const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(DeviceCodeResponse))(
        response.body,
      ).pipe(Effect.mapError(() => DeviceAuthorizationInvalidResponse.make({})));
      if (
        decoded.verification_uri.protocol !== "http:" &&
        decoded.verification_uri.protocol !== "https:"
      ) {
        return yield* DeviceAuthorizationInvalidResponse.make({});
      }
      return {
        appUrl: input.appUrl,
        clientId: input.clientId,
        deviceCode: Redacted.make(decoded.device_code),
        userCode: decoded.user_code,
        verificationUri: decoded.verification_uri,
        expiresInSeconds: decoded.expires_in,
        expiresAtMillis: DateTime.toEpochMillis(yield* DateTime.now) + decoded.expires_in * 1_000,
        intervalSeconds: decoded.interval,
      };
    });

    const awaitApproval = Effect.fn("DeviceAuthorization.awaitApproval")(function* (
      grant: DeviceGrant,
    ) {
      const deadline = grant.expiresAtMillis;
      let intervalMillis = grant.intervalSeconds * 1_000;
      let transportFailures = 0;
      let now = yield* DateTime.now;

      while (DateTime.toEpochMillis(now) < deadline) {
        const result = yield* transport.send(tokenRequest(grant)).pipe(Effect.result);
        if (result._tag === "Failure") {
          transportFailures += 1;
          if (transportFailures >= 3) {
            return yield* DeviceAuthorizationUnreachable.make({});
          }
          yield* Effect.sleep(Duration.millis(intervalMillis));
          now = yield* DateTime.now;
          continue;
        }

        transportFailures = 0;
        if (result.success.status === 200) {
          const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
            result.success.body,
          ).pipe(Effect.mapError(() => DeviceAuthorizationInvalidResponse.make({})));
          return Redacted.make(token.access_token);
        }

        const failure = Schema.decodeUnknownOption(Schema.fromJsonString(TokenErrorResponse))(
          result.success.body,
        );
        if (Option.isNone(failure)) {
          return yield* DeviceAuthorizationInvalidResponse.make({});
        }
        switch (failure.value.error) {
          case "authorization_pending":
            break;
          case "slow_down":
            intervalMillis += 5_000;
            break;
          case "access_denied":
            return yield* DeviceAuthorizationDenied.make({});
          case "expired_token":
            return yield* DeviceAuthorizationExpired.make({});
          case "invalid_grant":
            return yield* DeviceAuthorizationRejected.make({});
          default:
            return yield* DeviceAuthorizationInvalidResponse.make({});
        }
        yield* Effect.sleep(Duration.millis(intervalMillis));
        now = yield* DateTime.now;
      }

      return yield* DeviceAuthorizationExpired.make({});
    });

    return DeviceAuthorization.of({ start, awaitApproval });
  }),
);

function deviceCodeRequest(input: StartDeviceAuthorization): Request {
  return new Request(new URL("/api/auth/device/code", input.appUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: input.appUrl.origin,
    },
    body: JSON.stringify({
      client_id: input.clientId,
      scope: input.scope,
      resource: input.resource,
    }),
    redirect: "error",
  });
}

function tokenRequest(grant: DeviceGrant): Request {
  return new Request(new URL("/api/auth/oauth2/token", grant.appUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      origin: grant.appUrl.origin,
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: Redacted.value(grant.deviceCode),
      client_id: grant.clientId,
    }),
    redirect: "error",
  });
}

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.NonEmptyString,
  user_code: Schema.NonEmptyString,
  verification_uri: Schema.URLFromString,
  expires_in: Schema.Finite.pipe(Schema.check(Schema.isGreaterThan(0))),
  interval: Schema.Finite.pipe(Schema.check(Schema.isGreaterThan(0))),
});

const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  token_type: Schema.Literal("Bearer"),
});

const TokenErrorResponse = Schema.Struct({ error: Schema.String });

export class DeviceAuthorizationDenied extends Schema.TaggedError<
  DeviceAuthorizationDenied,
  { readonly brand: unique symbol }
>()("linking_helper.device_denied", {}) {}

class DeviceAuthorizationExpired extends Schema.TaggedError<
  DeviceAuthorizationExpired,
  { readonly brand: unique symbol }
>()("linking_helper.device_expired", {}) {}

class DeviceAuthorizationRejected extends Schema.TaggedError<
  DeviceAuthorizationRejected,
  { readonly brand: unique symbol }
>()("linking_helper.device_rejected", {}) {}

class DeviceAuthorizationUnreachable extends Schema.TaggedError<
  DeviceAuthorizationUnreachable,
  { readonly brand: unique symbol }
>()("linking_helper.device_unreachable", {}) {}

class DeviceAuthorizationInvalidResponse extends Schema.TaggedError<
  DeviceAuthorizationInvalidResponse,
  { readonly brand: unique symbol }
>()("linking_helper.device_invalid_response", {}) {}

export type DeviceFlowFailure =
  | DeviceAuthorizationDenied
  | DeviceAuthorizationExpired
  | DeviceAuthorizationRejected
  | DeviceAuthorizationUnreachable
  | DeviceAuthorizationInvalidResponse;
