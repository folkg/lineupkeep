import { and, isNotNull, isNull } from "drizzle-orm";
import { Array, Context, DateTime, Effect, Layer } from "effect";

import { AuthenticationUnavailable } from "#contexts/auth/Auth.ts";
import type { AuthorizationScope } from "#contexts/auth/AuthorizationScopes.ts";
import { anyOf } from "#database/dbUtilities.ts";

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
        const registered = yield* query(() =>
          database
            .select({ id: oauthClient.id, scopes: oauthClient.scopes })
            .from(oauthClient)
            .where(
              and(
                isNull(oauthClient.clientDiscoveryId),
                isNull(oauthClient.userId),
                isNull(oauthClient.referenceId),
                isNotNull(oauthClient.scopes),
              ),
            )
            .then((rows) => rows),
        );
        const stale: Array<string> = [];
        for (const client of registered) {
          const held = client.scopes;
          if (
            held !== null &&
            held.every((scope) => advertised.includes(scope)) &&
            advertised.some((scope) => !held.includes(scope))
          ) {
            stale.push(client.id);
          }
        }
        if (!Array.isArrayNonEmpty(stale)) {
          return;
        }
        const now = DateTime.toDateUtc(yield* DateTime.now);
        yield* query(() =>
          database
            .update(oauthClient)
            .set({ scopes: advertised, updatedAt: now })
            .where(anyOf(oauthClient.id, stale))
            .then(() => undefined),
        );
      });

      return { widenDynamicRegistrations } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
