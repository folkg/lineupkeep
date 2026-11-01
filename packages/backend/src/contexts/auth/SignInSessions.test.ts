import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { AuthDatabase } from "./internal/AuthDatabase.ts";
import { AuthDatabaseTest } from "./internal/AuthDatabaseTest.ts";
import { session, user } from "./internal/AuthTables.ts";
import { SignInSessionRepository } from "./internal/SignInSessionRepository.ts";
import { SignInSessionsLive } from "./internal/SignInSessionsLive.ts";
import { SignInSessionId, SignInSessions } from "./SignInSessions.ts";
import { decodeUserId } from "./User.ts";

const now = DateTime.makeUnsafe("2026-10-25T12:00:00.000Z");
const earlier = DateTime.toDateUtc(DateTime.makeUnsafe("2020-01-01T00:00:00.000Z"));
const hour = 60 * 60 * 1000;

const owner = decodeUserId("owner-1");
const other = decodeUserId("owner-2");

it.effect(
  "lists only the owner's active sessions, most recently used first, with a short device hint",
  () =>
    Effect.gen(function* () {
      const database = yield* AuthDatabase;
      const sessions = yield* SignInSessions;
      yield* TestClock.adjust(now.epochMilliseconds);

      yield* Effect.promise(() => database.insert(user).values([person(owner), person(other)]));
      yield* Effect.promise(() =>
        database.insert(session).values([
          signIn("session-laptop", owner, {
            createdAt: ago(3 * hour),
            updatedAt: ago(2 * hour),
            userAgent: chromeOnMac,
          }),
          signIn("session-phone", owner, {
            createdAt: ago(5 * hour),
            updatedAt: ago(hour),
            userAgent: safariOnPhone,
          }),
          signIn("session-lapsed", owner, {
            createdAt: ago(9 * hour),
            updatedAt: ago(8 * hour),
            expiresAt: earlier,
          }),
          signIn("session-stranger", other, { userAgent: chromeOnMac }),
        ]),
      );

      const listed = yield* sessions.list(owner);

      assert.deepStrictEqual(
        listed.map((entry) => ({
          id: entry.id,
          device: entry.device,
          startedAt: DateTime.formatIso(entry.startedAt),
          lastUsedAt: DateTime.formatIso(entry.lastUsedAt),
        })),
        [
          {
            id: "session-phone",
            device: "Safari on iOS",
            startedAt: "2026-10-25T07:00:00.000Z",
            lastUsedAt: "2026-10-25T11:00:00.000Z",
          },
          {
            id: "session-laptop",
            device: "Chrome on macOS",
            startedAt: "2026-10-25T09:00:00.000Z",
            lastUsedAt: "2026-10-25T10:00:00.000Z",
          },
        ],
      );
    }).pipe(Effect.provide(layer)),
  30_000,
);

it.effect(
  "ends named owned sessions and leaves every other session signed in",
  () =>
    Effect.gen(function* () {
      const database = yield* AuthDatabase;
      const sessions = yield* SignInSessions;
      yield* TestClock.adjust(now.epochMilliseconds);

      yield* Effect.promise(() => database.insert(user).values([person(owner), person(other)]));
      yield* Effect.promise(() =>
        database
          .insert(session)
          .values([
            signIn("session-laptop", owner),
            signIn("session-phone", owner),
            signIn("session-stranger", other),
          ]),
      );

      const ended = yield* sessions.end(owner, [
        SignInSessionId.make("session-laptop"),
        SignInSessionId.make("session-stranger"),
      ]);

      assert.deepStrictEqual(ended.map(String), ["session-laptop"]);
      assert.deepStrictEqual(sessionIds(yield* sessions.list(owner)), ["session-phone"]);
      assert.deepStrictEqual(sessionIds(yield* sessions.list(other)), ["session-stranger"]);
    }).pipe(Effect.provide(layer)),
  30_000,
);

it.effect(
  "ends every session except the current one",
  () =>
    Effect.gen(function* () {
      const database = yield* AuthDatabase;
      const sessions = yield* SignInSessions;
      yield* TestClock.adjust(now.epochMilliseconds);

      yield* Effect.promise(() => database.insert(user).values([person(owner), person(other)]));
      yield* Effect.promise(() =>
        database
          .insert(session)
          .values([
            signIn("session-laptop", owner),
            signIn("session-phone", owner),
            signIn("session-tablet", owner),
            signIn("session-stranger", other),
          ]),
      );

      const ended = yield* sessions.endOthers(owner, SignInSessionId.make("session-laptop"));

      assert.deepStrictEqual(ended.map(String).sort(), ["session-phone", "session-tablet"]);
      assert.deepStrictEqual(sessionIds(yield* sessions.list(owner)), ["session-laptop"]);
      assert.deepStrictEqual(sessionIds(yield* sessions.list(other)), ["session-stranger"]);
    }).pipe(Effect.provide(layer)),
  30_000,
);

const layer = SignInSessionsLive.pipe(
  Layer.provide(SignInSessionRepository.layer),
  Layer.provideMerge(AuthDatabaseTest),
);

const chromeOnMac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const safariOnPhone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

function person(id: string): typeof user.$inferInsert {
  return { id, name: id, email: `${id}@example.test` };
}

function signIn(
  id: string,
  userId: string,
  options: {
    readonly createdAt?: Date;
    readonly updatedAt?: Date;
    readonly expiresAt?: Date;
    readonly userAgent?: string;
  } = {},
): typeof session.$inferInsert {
  const startedAt = options.createdAt ?? ago(0);
  return {
    id,
    token: `token-${id}`,
    userId,
    createdAt: startedAt,
    updatedAt: options.updatedAt ?? startedAt,
    expiresAt:
      options.expiresAt ??
      DateTime.toDateUtc(DateTime.makeUnsafe(now.epochMilliseconds + 6 * 24 * hour)),
    userAgent: options.userAgent ?? chromeOnMac,
  };
}

function ago(millis: number): Date {
  return DateTime.toDateUtc(DateTime.makeUnsafe(now.epochMilliseconds - millis));
}

function sessionIds(listed: ReadonlyArray<{ readonly id: string }>): ReadonlyArray<string> {
  return listed.map((entry) => entry.id);
}
