import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";

import { AccountRetention } from "./AccountRetention.ts";
import { AccountRetentionLive } from "./internal/AccountRetentionLive.ts";
import { AccountRetentionRepository } from "./internal/AccountRetentionRepository.ts";
import { AuthDatabase } from "./internal/AuthDatabase.ts";
import { AuthDatabaseTest } from "./internal/AuthDatabaseTest.ts";
import { session, user, verification } from "./internal/AuthTables.ts";
import { OAuthClientRepository } from "./internal/OAuthClientRepository.ts";
import { oauthClient, oauthConsent, oauthRefreshToken } from "./internal/OAuthTables.ts";

const at = DateTime.makeUnsafe("2026-06-30T12:00:00.000Z");
const day = 86_400_000;

it.effect(
  "removes unapproved dynamic registrations after 7 whole days and keeps an authorized one at any age",
  () =>
    Effect.gen(function* () {
      const retention = yield* AccountRetention;
      const database = yield* AuthDatabase;
      yield* Effect.promise(() =>
        database
          .insert(oauthClient)
          .values([
            registration("stale", DateTime.subtractDuration(at, 8 * day)),
            registration("boundary", DateTime.subtractDuration(at, 7 * day)),
            registration("fresh", DateTime.subtractDuration(at, 6 * day)),
            registration("authorized", DateTime.subtractDuration(at, 400 * day)),
            registration("token-authorized", DateTime.subtractDuration(at, 400 * day)),
          ]),
      );
      yield* Effect.promise(() =>
        database
          .insert(oauthConsent)
          .values(consentFor("authorized", DateTime.subtractDuration(at, day))),
      );
      yield* Effect.promise(() =>
        database.insert(oauthRefreshToken).values({
          id: "refresh-token-authorized",
          token: "hashed-refresh-token",
          clientId: "client-token-authorized",
          userId: "retention-user",
          expiresAt: DateTime.toDateUtc(DateTime.subtractDuration(at, 300 * day)),
          createdAt: DateTime.toDateUtc(DateTime.subtractDuration(at, 400 * day)),
          scopes: ["fantasy:read"],
        }),
      );

      const summary = yield* retention.run(10, at);
      const remaining = yield* Effect.promise(() =>
        database.select({ clientId: oauthClient.clientId }).from(oauthClient),
      );

      assert.strictEqual(summary.registrations, 2);
      assert.deepStrictEqual(remaining.map((row) => row.clientId).sort(), [
        "client-authorized",
        "client-fresh",
        "client-token-authorized",
      ]);
    }).pipe(Effect.provide(AccountRetentionTestLayer)),
  30_000,
);

it.effect(
  "removes consents unused for 181 days and keeps one used yesterday",
  () =>
    Effect.gen(function* () {
      const retention = yield* AccountRetention;
      const database = yield* AuthDatabase;
      yield* Effect.promise(() =>
        database
          .insert(oauthConsent)
          .values([
            consentFor("stale", DateTime.subtractDuration(at, 181 * day)),
            consentFor("boundary", DateTime.subtractDuration(at, 180 * day)),
            consentFor("used", DateTime.subtractDuration(at, day)),
          ]),
      );

      const summary = yield* retention.run(10, at);
      const remaining = yield* Effect.promise(() =>
        database.select({ clientId: oauthConsent.clientId }).from(oauthConsent),
      );

      assert.strictEqual(summary.consents, 2);
      assert.deepStrictEqual(
        remaining.map((row) => row.clientId),
        ["client-used"],
      );
    }).pipe(Effect.provide(AccountRetentionTestLayer)),
  30_000,
);

it.effect(
  "removes expired sessions and verification rows",
  () =>
    Effect.gen(function* () {
      const retention = yield* AccountRetention;
      const database = yield* AuthDatabase;
      yield* Effect.promise(() =>
        database.insert(user).values({
          id: "retention-user",
          name: "Retention",
          email: "retention@example.test",
        }),
      );
      yield* Effect.promise(() =>
        database
          .insert(session)
          .values([
            signInSession("expired-session", DateTime.subtractDuration(at, 1_000)),
            signInSession("boundary-session", at),
            signInSession("live-session", DateTime.addDuration(at, 3_600_000)),
          ]),
      );
      yield* Effect.promise(() =>
        database
          .insert(verification)
          .values([
            pendingVerification("expired-code", DateTime.subtractDuration(at, 1_000)),
            pendingVerification("boundary-code", at),
            pendingVerification("live-code", DateTime.addDuration(at, 3_600_000)),
          ]),
      );

      const summary = yield* retention.run(10, at);
      const sessions = yield* Effect.promise(() =>
        database.select({ id: session.id }).from(session),
      );
      const codes = yield* Effect.promise(() =>
        database.select({ id: verification.id }).from(verification),
      );

      assert.strictEqual(summary.sessions, 2);
      assert.strictEqual(summary.verifications, 2);
      assert.deepStrictEqual(
        sessions.map((row) => row.id),
        ["live-session"],
      );
      assert.deepStrictEqual(
        codes.map((row) => row.id),
        ["live-code"],
      );
    }).pipe(Effect.provide(AccountRetentionTestLayer)),
  30_000,
);

function registration(id: string, createdAt: DateTime.Utc): typeof oauthClient.$inferInsert {
  return {
    id,
    clientId: `client-${id}`,
    redirectUris: [`https://${id}.test/callback`],
    createdAt: DateTime.toDateUtc(createdAt),
    updatedAt: DateTime.toDateUtc(createdAt),
  };
}

function consentFor(id: string, updatedAt: DateTime.Utc): typeof oauthConsent.$inferInsert {
  return {
    id: `consent-${id}`,
    clientId: `client-${id}`,
    scopes: ["fantasy:read"],
    createdAt: DateTime.toDateUtc(updatedAt),
    updatedAt: DateTime.toDateUtc(updatedAt),
  };
}

function signInSession(id: string, expiresAt: DateTime.Utc): typeof session.$inferInsert {
  return {
    id,
    token: `token-${id}`,
    userId: "retention-user",
    expiresAt: DateTime.toDateUtc(expiresAt),
    createdAt: DateTime.toDateUtc(DateTime.subtractDuration(expiresAt, day)),
    updatedAt: DateTime.toDateUtc(DateTime.subtractDuration(expiresAt, day)),
  };
}

function pendingVerification(
  id: string,
  expiresAt: DateTime.Utc,
): typeof verification.$inferInsert {
  return {
    id,
    identifier: "reader@example.test",
    value: "hashed-code",
    expiresAt: DateTime.toDateUtc(expiresAt),
    createdAt: DateTime.toDateUtc(DateTime.subtractDuration(expiresAt, day)),
    updatedAt: DateTime.toDateUtc(DateTime.subtractDuration(expiresAt, day)),
  };
}

const AccountRetentionTestLayer = AccountRetentionLive.pipe(
  Layer.provide(OAuthClientRepository.layer),
  Layer.provide(AccountRetentionRepository.layer),
  Layer.provideMerge(AuthDatabaseTest),
  Layer.orDie,
);
