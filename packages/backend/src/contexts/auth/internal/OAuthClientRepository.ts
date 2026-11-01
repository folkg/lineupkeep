import { and, arrayContained, arrayContains, isNotNull, isNull, not } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import { AuthenticationUnavailable } from "#contexts/auth/Auth.ts";
import type { AuthorizationScope } from "#contexts/auth/AuthorizationScopes.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { oauthClient } from "./OAuthTables.ts";

export class OAuthClientRepository extends Context.Service<OAuthClientRepository>()(
  "@lineupkeep/backend/contexts/auth/internal/OAuthClientRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* AuthDatabase;

      const query = <A>(
        run: () => Promise<A>,
      ): Effect.Effect<A, AuthenticationUnavailable, never> =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => AuthenticationUnavailable.make({ cause }),
        });

      const widenDynamicRegistrations = Effect.fn(
        "OAuthClientRepository.widenDynamicRegistrations",
      )(function* (scopes: ReadonlyArray<AuthorizationScope>) {
        const advertised = scopes.map((scope) => scope.name);
        const now = DateTime.toDateUtc(yield* DateTime.now);
        const widened = yield* query(() =>
          database
            .update(oauthClient)
            .set({ scopes: advertised, updatedAt: now })
            .where(
              and(
                isNull(oauthClient.clientDiscoveryId),
                isNull(oauthClient.userId),
                isNull(oauthClient.referenceId),
                isNotNull(oauthClient.scopes),
                arrayContained(oauthClient.scopes, advertised),
                not(arrayContains(oauthClient.scopes, advertised)),
              ),
            )
            .returning({ id: oauthClient.id }),
        );
        yield* Effect.annotateCurrentSpan({ "oauth.registrations_widened": widened.length });
      });

      return { widenDynamicRegistrations } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
