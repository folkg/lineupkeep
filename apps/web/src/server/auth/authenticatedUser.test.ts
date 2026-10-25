import { assert, it } from "@effect/vitest";
import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AuthenticationSession } from "@lineupkeep/backend/auth/Auth";
import {
  makeRequestContext,
  requestContextLayer,
} from "@lineupkeep/backend/runtime/RequestContext";
import { Effect, Layer, Ref } from "effect";

import { withAuthenticatedUser } from "./authenticatedUser";

it.effect("rejects an expired session before running the use case", () =>
  Effect.gen(function* () {
    const owners = yield* Ref.make<ReadonlyArray<string>>([]);
    const context = yield* makeRequestContext(
      new Request("http://localhost/connections", { headers: { "x-request-id": "test-entry" } }),
    );
    const authentication = authenticationLayer(undefined);

    const result = yield* withAuthenticatedUser((owner) =>
      Ref.update(owners, (values) => [...values, owner]).pipe(Effect.as("saved")),
    ).pipe(Effect.provide(Layer.merge(authentication, requestContextLayer(context))));

    assert.deepStrictEqual(result, { type: "error", error: { type: "auth.required" } });
    assert.deepStrictEqual(yield* Ref.get(owners), []);
  }),
);

it.effect("runs the use case for the authenticated user", () =>
  Effect.gen(function* () {
    const owners = yield* Ref.make<ReadonlyArray<string>>([]);
    const context = yield* makeRequestContext(
      new Request("http://localhost/connections", { headers: { "x-request-id": "test-entry" } }),
    );
    const authentication = authenticationLayer({
      user: { id: "signed-in-user", email: "person@example.test", name: "Person" },
    });

    const result = yield* withAuthenticatedUser((owner) =>
      Ref.update(owners, (values) => [...values, owner]).pipe(Effect.as("saved")),
    ).pipe(Effect.provide(Layer.merge(authentication, requestContextLayer(context))));

    assert.strictEqual(result, "saved");
    assert.deepStrictEqual(yield* Ref.get(owners), ["signed-in-user"]);
  }),
);

function authenticationLayer(
  session: AuthenticationSession | undefined,
): Layer.Layer<AuthService, never, never> {
  return Layer.succeed(AuthService)(
    AuthService.of({
      signInMethods: { google: false },
      oauthResource: "https://example.com/mcp",
      advertisedScopes: [{ name: "connections:read", description: "Read connections." }],
      resolveAccessToken: () => Effect.succeed({ status: "invalid" as const }),
      getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
      consent: () => Effect.succeed("https://client.test/callback"),
      handle: () => Effect.succeed(new Response()),
      claimDeviceAuthorization: () =>
        Effect.succeed({ clientId: "helper", scope: "connections:read" }),
      approveDeviceAuthorization: () => Effect.void,
      denyDeviceAuthorization: () => Effect.void,
      getSession: () => Effect.succeed(session),
    }),
  );
}
