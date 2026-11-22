import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array as EffectArray, DateTime, Effect, Schema } from "effect";

import { PlayerRef } from "#contexts/connections/QueryValues.ts";

import { QueryTokens } from "./QueryTokens.ts";

const owner = decodeUserId("owner");
const otherOwner = decodeUserId("other-owner");
const at = DateTime.makeUnsafe("2026-11-22T12:00:00.000Z");
const TestLayer = QueryTokens.fromSecret("query-token-test-secret-at-least-32-chars");

it.effect("seals a deterministic cursor and rejects another request", () =>
  Effect.gen(function* () {
    const tokens = yield* QueryTokens;
    const input = { userId: owner, fingerprint: "request", offset: 12, now: at };
    const cursor = yield* tokens.sealCursor(input);

    const repeated = yield* tokens.sealCursor(input);
    assert.strictEqual(repeated, cursor);

    const opened = yield* tokens.openCursor({ ...input, cursor });
    assert.strictEqual(opened, 12);

    const mismatch = yield* tokens
      .openCursor({ ...input, fingerprint: "other", cursor })
      .pipe(Effect.flip);
    assert.strictEqual(mismatch.reason, "mismatch");

    const expired = yield* tokens
      .openCursor({ ...input, now: DateTime.add(at, { minutes: 16 }), cursor })
      .pipe(Effect.flip);
    assert.strictEqual(expired.reason, "expired");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("round trips owner-scoped player and counterparty references", () =>
  Effect.gen(function* () {
    const tokens = yield* QueryTokens;
    const player = yield* tokens.sealPlayerRef({
      userId: owner,
      leagueKey: "461.l.1000",
      playerKey: "p1",
    });
    const counterparty = yield* tokens.sealCounterpartyRef({
      userId: owner,
      leagueKey: "461.l.1000",
      teamKey: "t1",
    });

    const openedPlayer = yield* tokens.openPlayerRef({
      userId: owner,
      leagueKey: "461.l.1000",
      ref: player,
    });
    assert.strictEqual(openedPlayer, "p1");

    const openedCounterparty = yield* tokens.openCounterpartyRef({
      userId: owner,
      leagueKey: "461.l.1000",
      ref: counterparty,
    });
    assert.strictEqual(openedCounterparty, "t1");

    const wrongOwner = yield* tokens
      .openPlayerRef({
        userId: otherOwner,
        leagueKey: "461.l.1000",
        ref: player,
      })
      .pipe(Effect.flip);
    assert.strictEqual(wrongOwner.reason, "invalid");

    const wrongLeague = yield* tokens
      .openCounterpartyRef({
        userId: owner,
        leagueKey: "461.l.2000",
        ref: counterparty,
      })
      .pipe(Effect.flip);
    assert.strictEqual(wrongLeague.reason, "invalid");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("seals grouped references in order and leaves invalid entries undefined", () =>
  Effect.gen(function* () {
    const tokens = yield* QueryTokens;
    const groups = yield* tokens.sealPlayerRefGroups({
      userId: owner,
      groups: [
        { leagueKey: "461.l.1000", playerKeys: ["p1", "p2"] },
        { leagueKey: "465.l.2000", playerKeys: ["p3"] },
      ],
    });

    const lengths = EffectArray.map(groups, (group) => group.length);
    assert.deepStrictEqual(lengths, [2, 1]);

    const opened = yield* tokens.openPlayerRefGroups({
      userId: owner,
      groups: [
        { leagueKey: "461.l.1000", refs: groups[0] ?? [] },
        { leagueKey: "465.l.2000", refs: groups[1] ?? [] },
      ],
    });
    assert.deepStrictEqual(opened, [["p1", "p2"], ["p3"]]);

    const first = groups[0]?.[0];
    assert.isDefined(first);
    const valid = yield* playerRef(first);
    const invalid = yield* playerRef(`${first}x`);
    const openedRefs = yield* tokens.openPlayerRefs({
      userId: owner,
      leagueKey: "461.l.1000",
      refs: [valid, invalid],
    });
    assert.deepStrictEqual(openedRefs, ["p1", undefined]);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("seals trade offer references without opening them", () =>
  Effect.gen(function* () {
    const tokens = yield* QueryTokens;
    const groups = yield* tokens.sealTradeOfferRefGroups({
      userId: owner,
      groups: [{ leagueKey: "461.l.1000", transactionKeys: ["offer-1", "offer-2"] }],
    });
    const refs = groups[0] ?? [];

    assert.strictEqual(refs.length, 2);
    assert.notStrictEqual(refs[0], refs[1]);
    assert.match(refs[0] ?? "", /^r1\./u);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("derives one stable statistic reference for a league and stat", () =>
  Effect.gen(function* () {
    const tokens = yield* QueryTokens;
    const input = { leagueKey: "461.l.1000", statId: 12 };
    const first = yield* tokens.statRef(input);
    const repeated = yield* tokens.statRef(input);

    assert.strictEqual(repeated, first);
    assert.match(first, /^s1\./u);
  }).pipe(Effect.provide(TestLayer)),
);

function playerRef(value: string): Effect.Effect<PlayerRef> {
  return Schema.decodeEffect(PlayerRef)(value).pipe(Effect.orDie);
}
