import { lte } from "drizzle-orm";
import { Array, Context, DateTime, Effect, Layer } from "effect";

import { AccountRetentionPersistenceFailed } from "#contexts/auth/AccountRetention.ts";
import { anyOf } from "#database/dbUtilities.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { session, verification } from "./AuthTables.ts";
import { oauthConsent } from "./OAuthTables.ts";

type AccountRetentionExpiry = {
  readonly at: DateTime.Utc;
  readonly consentsBefore: DateTime.Utc;
  readonly limit: number;
};

export class AccountRetentionRepository extends Context.Service<
  AccountRetentionRepository,
  AccountRetentionRepositoryShape
>()("@lineupkeep/backend/contexts/auth/internal/AccountRetentionRepository") {
  static readonly layer = Layer.effect(
    AccountRetentionRepository,
    Effect.gen(function* () {
      const database = yield* AuthDatabase;

      const query = <A>(
        run: () => Promise<A>,
      ): Effect.Effect<A, AccountRetentionPersistenceFailed, never> =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => AccountRetentionPersistenceFailed.make({ cause }),
        });

      const expired = Effect.fn("AccountRetentionRepository.expired")(function* (
        input: AccountRetentionExpiry,
      ) {
        const expiredSessions = yield* query(() =>
          database
            .select({ id: session.id })
            .from(session)
            .where(lte(session.expiresAt, DateTime.toDateUtc(input.at)))
            .orderBy(session.expiresAt)
            .limit(input.limit),
        );
        const sessionIds = expiredSessions.map((row) => row.id);
        const sessions = Array.isArrayNonEmpty(sessionIds)
          ? (yield* query(() =>
              database
                .delete(session)
                .where(anyOf(session.id, sessionIds))
                .returning({ id: session.id }),
            )).length
          : 0;

        const expiredVerifications = yield* query(() =>
          database
            .select({ id: verification.id })
            .from(verification)
            .where(lte(verification.expiresAt, DateTime.toDateUtc(input.at)))
            .orderBy(verification.expiresAt)
            .limit(input.limit),
        );
        const verificationIds = expiredVerifications.map((row) => row.id);
        const verifications = Array.isArrayNonEmpty(verificationIds)
          ? (yield* query(() =>
              database
                .delete(verification)
                .where(anyOf(verification.id, verificationIds))
                .returning({ id: verification.id }),
            )).length
          : 0;

        const unusedConsents = yield* query(() =>
          database
            .select({ id: oauthConsent.id })
            .from(oauthConsent)
            .where(lte(oauthConsent.updatedAt, DateTime.toDateUtc(input.consentsBefore)))
            .orderBy(oauthConsent.updatedAt)
            .limit(input.limit),
        );
        const consentIds = unusedConsents.map((row) => row.id);
        const consents = Array.isArrayNonEmpty(consentIds)
          ? (yield* query(() =>
              database
                .delete(oauthConsent)
                .where(anyOf(oauthConsent.id, consentIds))
                .returning({ id: oauthConsent.id }),
            )).length
          : 0;

        return { sessions, verifications, consents };
      });

      return { expired } as const;
    }),
  );
}

export type AccountRetentionRepositoryShape = {
  readonly expired: (
    input: AccountRetentionExpiry,
  ) => Effect.Effect<
    { readonly sessions: number; readonly verifications: number; readonly consents: number },
    AccountRetentionPersistenceFailed
  >;
};
