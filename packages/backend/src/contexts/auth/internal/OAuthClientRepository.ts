import {
  and,
  arrayContained,
  arrayContains,
  asc,
  count,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  not,
  notExists,
} from "drizzle-orm";
import { Array, Context, DateTime, Effect, Layer } from "effect";

import { AuthenticationUnavailable } from "#contexts/auth/Auth.ts";
import type { AuthorizationScope } from "#contexts/auth/AuthorizationScopes.ts";
import { anyOf } from "#database/dbUtilities.ts";
import { retentionPolicy } from "#retention/RetentionPolicy.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "./OAuthTables.ts";

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

      const dynamicRegistration = and(
        isNull(oauthClient.clientDiscoveryId),
        isNull(oauthClient.userId),
        isNull(oauthClient.referenceId),
      );

      const withoutCompletedAuthorization = and(
        notExists(
          database
            .select({ id: oauthConsent.id })
            .from(oauthConsent)
            .where(eq(oauthConsent.clientId, oauthClient.clientId)),
        ),
        notExists(
          database
            .select({ id: oauthAccessToken.id })
            .from(oauthAccessToken)
            .where(eq(oauthAccessToken.clientId, oauthClient.clientId)),
        ),
        notExists(
          database
            .select({ id: oauthRefreshToken.id })
            .from(oauthRefreshToken)
            .where(eq(oauthRefreshToken.clientId, oauthClient.clientId)),
        ),
      );

      const unapprovedRegistration = and(dynamicRegistration, withoutCompletedAuthorization);

      const liveUnapprovedCount = Effect.fn("OAuthClientRepository.liveUnapprovedCount")(function* (
        at: DateTime.Utc,
      ) {
        const liveAfter = DateTime.toDateUtc(
          DateTime.subtractDuration(at, retentionPolicy.unapprovedRegistration.millis),
        );
        const rows = yield* query(() =>
          database
            .select({ value: count() })
            .from(oauthClient)
            .where(and(unapprovedRegistration, gt(oauthClient.createdAt, liveAfter))),
        );
        return rows[0]?.value ?? 0;
      });

      const expireUnapproved = Effect.fn("OAuthClientRepository.expireUnapproved")(function* (
        at: DateTime.Utc,
        limit: number,
      ) {
        const registeredBefore = DateTime.toDateUtc(
          DateTime.subtractDuration(at, retentionPolicy.unapprovedRegistration.millis),
        );
        const candidates = yield* query(() =>
          database
            .select({ id: oauthClient.id })
            .from(oauthClient)
            .where(and(unapprovedRegistration, lte(oauthClient.createdAt, registeredBefore)))
            .orderBy(asc(oauthClient.createdAt))
            .limit(limit),
        );
        const ids = candidates.map((row) => row.id);
        if (!Array.isArrayNonEmpty(ids)) {
          return 0;
        }
        const deleted = yield* query(() =>
          database
            .delete(oauthClient)
            .where(
              and(
                anyOf(oauthClient.id, ids),
                unapprovedRegistration,
                lte(oauthClient.createdAt, registeredBefore),
              ),
            )
            .returning({ id: oauthClient.id }),
        );
        return deleted.length;
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
                dynamicRegistration,
                isNotNull(oauthClient.scopes),
                arrayContained(oauthClient.scopes, advertised),
                not(arrayContains(oauthClient.scopes, advertised)),
              ),
            )
            .returning({ id: oauthClient.id }),
        );
        yield* Effect.annotateCurrentSpan({ "oauth.registrations_widened": widened.length });
      });

      return { widenDynamicRegistrations, liveUnapprovedCount, expireUnapproved } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
