import { assert, it } from "@effect/vitest";
import { AuthService } from "@lineupkeep/backend/auth/Auth";
import {
  ConnectionCreateFailed,
  ConnectionNotFound,
  ConnectionPersistenceFailed,
  ProviderConnection,
  decodeConnectionId,
  type ConnectionError,
} from "@lineupkeep/backend/connections/Connection";
import { decodeProviderKey } from "@lineupkeep/backend/connections/ProviderKey";
import {
  makeRequestContext,
  requestContextLayer,
} from "@lineupkeep/backend/runtime/RequestContext";
import { Effect, Layer, Schema, DateTime, Cause, Exit } from "effect";

import type { ConnectionMutationError } from "#contracts/connections/connectionContract.ts";

import { authenticatedUseCase } from "./backendEntry.ts";
import {
  ConnectionInputInvalid,
  mapConnectionError,
  toConnectionView,
} from "./connections/connectionPresentation";

it.effect("rejects anonymous invalid input before reporting validation failure", () =>
  Effect.gen(function* () {
    const result = yield* execute(false);

    assert.deepStrictEqual(result, { type: "error", error: { type: "auth.required" } });
  }),
);

it.effect("preserves defects instead of classifying them as expected rejections", () =>
  Effect.gen(function* () {
    const program = authenticatedUseCase(() => Effect.die("private defect"), mapConnectionError);
    const exit = yield* program.pipe(Effect.provide(yield* authentication(true)), Effect.exit);

    assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
  }),
);

it.effect("returns ownership-free ISO dates through the authenticated result", () =>
  Effect.gen(function* () {
    const timestamp = DateTime.makeUnsafe("2026-01-02T03:04:05Z");
    const connection = yield* Schema.decodeEffect(ProviderConnection)({
      id: "0fbcaf9b-f3bd-4b27-952b-d80ad6383b99",
      userId: "signed-in-user",
      provider: decodeProviderKey("yahoo"),
      status: "linking",
      linkingExpiresAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const result = yield* authenticatedUseCase(
      () => Effect.succeed(toConnectionView(connection, 3)),
      mapConnectionError,
    ).pipe(Effect.provide(yield* authentication(true)));

    assert.deepStrictEqual(result, {
      type: "success",
      data: {
        id: connection.id,
        provider: decodeProviderKey("yahoo"),
        status: "linking",
        teamCount: 3,
        linkingExpiresAt: "2026-01-02T03:04:05.000Z",
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:05.000Z",
      },
    });
  }),
);

it.effect("projects every expected connection failure to a safe code and business outcome", () =>
  Effect.gen(function* () {
    const id = decodeConnectionId("0fbcaf9b-f3bd-4b27-952b-d80ad6383b99");
    const failures: ReadonlyArray<
      readonly [ConnectionError | ConnectionInputInvalid, ConnectionMutationError["type"], string]
    > = [
      [ConnectionInputInvalid.make({}), "connection.input_invalid", "rejected"],
      [ConnectionNotFound.make({ id }), "connection.not_found", "rejected"],
      [ConnectionCreateFailed.make({}), "connection.create_failed", "failure"],
      [
        ConnectionPersistenceFailed.make({ cause: "private database failure" }),
        "connection.persistence_failed",
        "failure",
      ],
    ];
    const layer = yield* authentication(true);
    for (const [error, code, outcome] of failures) {
      const observation = yield* authenticatedUseCase(
        () => Effect.fail(error),
        mapConnectionError,
      ).pipe(
        Effect.flatMap((result) =>
          Effect.map(Effect.currentSpan, (span) => ({
            result,
            outcome: span.attributes.get("app.outcome"),
            status: span.attributes.get("http.response.status_code"),
          })),
        ),
        Effect.withSpan("test.expected_failure"),
        Effect.provide(layer),
      );

      assert.deepStrictEqual(observation, {
        result: { type: "error", error: { type: code } },
        outcome,
        status: 200,
      });
    }
  }),
);

function execute(signedIn: boolean): Effect.Effect<
  | import("#contracts/auth/authContract.ts").AuthenticationFailureResult
  | {
      type: "error";
      error: {
        type: ConnectionMutationError["type"];
      };
    }
  | {
      type: "success";
      data: string;
    },
  | import("@lineupkeep/backend/auth/Auth").AuthenticationInvalidResponse
  | import("@lineupkeep/backend/auth/Auth").AuthenticationUnavailable,
  never
> {
  const decoded = Schema.decodeUnknownResult(Schema.String)(42);
  return authenticatedUseCase(
    () => Effect.fromResult(decoded).pipe(Effect.mapError(() => ConnectionInputInvalid.make({}))),
    mapConnectionError,
  ).pipe(Effect.provide(authentication(signedIn).pipe(Layer.unwrap)));
}

function authentication(
  signedIn: boolean,
): Effect.Effect<
  Layer.Layer<
    AuthService | import("@lineupkeep/backend/runtime/RequestContext").RequestContext,
    never,
    never
  >,
  never,
  never
> {
  return Effect.gen(function* () {
    const context = yield* makeRequestContext(
      new Request("https://example.test/connections", {
        headers: { "x-request-id": "use-case-test" },
      }),
    );
    return Layer.merge(
      requestContextLayer(context),
      Layer.succeed(AuthService)(
        AuthService.of({
          signInMethods: { google: false },
          oauthResource: "https://example.test/mcp",
          onboardingScopes: [{ name: "connections:read", description: "Read connections." }],
          resolveAccessToken: () => Effect.succeed({ status: "invalid" as const }),
          getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
          consent: () => Effect.succeed("https://client.test/callback"),
          handle: () => Effect.succeed(new Response()),
          claimDeviceAuthorization: () =>
            Effect.succeed({ clientId: "helper", scope: "connections:read" }),
          approveDeviceAuthorization: () => Effect.void,
          denyDeviceAuthorization: () => Effect.void,
          getSession: () =>
            Effect.succeed(
              signedIn
                ? {
                    user: { id: "signed-in-user", email: "person@example.test", name: "Person" },
                  }
                : undefined,
            ),
        }),
      ),
    );
  });
}
