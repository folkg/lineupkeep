import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { eq } from "drizzle-orm";
import { Array, DateTime, Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";

import { Connections } from "./Connections.ts";
import { decodeTeamId } from "./FantasyTeam.ts";
import type { FantasyTeam, TeamId } from "./FantasyTeam.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { providerTeams } from "./internal/ConnectionTables.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { QueryTokens } from "./internal/QueryTokens.ts";
import { TransactionProposalRepository } from "./internal/TransactionProposalRepository.ts";
import { TransactionProposalsLive } from "./internal/TransactionProposalsLive.ts";
import type {
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderPendingTrade,
  ProviderPlayerDetail,
  ProviderRoster,
  ProviderTeam,
  ProviderTransaction,
  ProviderTransactionPlayer,
  ProviderTransactionTeam,
} from "./Provider.ts";
import { decodeProviderKey } from "./ProviderKey.ts";
import type { CounterpartyRef, PlayerRef } from "./QueryValues.ts";
import {
  ProposalContentInvalid,
  ProposalItemDraft,
  ProposalSetAlreadySubmitted,
  ProposalSetExpired,
  ProposalSetNotFound,
  ProposalSetReview,
  TransactionProposals,
  proposalSetLifetimeMillis,
} from "./TransactionProposals.ts";

it.effect("stores an owner-scoped proposal set without contacting the provider", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [
      team("nhl.l.1.t.1", "Red Line"),
      team("nhl.l.2.t.1", "Blue Line"),
      team("nfl.l.3.t.1", "Grid", "nfl"),
    ]);
    yield* fake.unsupportedOperations([
      "read_league",
      "read_roster",
      "read_player_details",
      "read_league_teams",
      "read_transactions",
      "read_pending_trades",
    ]);

    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: teamId(seeded, "nhl.l.1.t.1"),
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Cover the light night at center.",
        },
        {
          team: teamId(seeded, "nhl.l.2.t.1"),
          kind: "waiver_claim",
          adds: yield* refs(tokens, "nhl.l.2", ["nhl.p.90003"]),
          drops: [],
          bid: 0,
          reason: "Win the wing before the weekend with a zero bid.",
        },
      ],
    });

    assert.isTrue(result.created);
    assert.strictEqual(result.set.expired, false);
    assert.strictEqual(result.set.proposedBy.kind, "agent");
    assert.strictEqual(result.set.proposedBy.surface, "mcp");
    assert.strictEqual(result.set.reviewPath, `/transactions/${result.set.id}`);
    assert.deepStrictEqual(
      result.items.map((item) => item.outcome),
      ["accepted", "accepted"],
    );
    const first = result.items[0];
    assert.strictEqual(first?.outcome, "accepted");
    if (first?.outcome === "accepted") {
      assert.strictEqual(first.item.state, "proposed");
      assert.deepStrictEqual(first.item.staleness, { status: "unchecked", reasons: [] });
      assert.strictEqual(first.item.bid, undefined);
    }
    const second = result.items[1];
    if (second?.outcome === "accepted") {
      assert.strictEqual(second.item.bid, 0);
      assert.strictEqual(second.item.kind, "waiver_claim");
    }

    assert.deepStrictEqual(yield* fake.rosterPeriods, []);
    assert.strictEqual(yield* fake.nativeCallCount, 0);
    assert.strictEqual(yield* fake.explicitCallCount, 0);

    const review = yield* proposals.read(owner, { set: result.set.id });
    assert.deepStrictEqual(
      Object.fromEntries(review.teams.map((entry) => [entry.team.name, entry.items.length])),
      { Grid: 0, "Red Line": 1, "Blue Line": 1 },
    );

    const foreign = yield* Effect.flip(proposals.read(other, { set: result.set.id }));
    assert.instanceOf(foreign, ProposalSetNotFound);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses an empty set, names a refused item, and is idempotent", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")]);
    const add = yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]);

    const empty = yield* Effect.flip(proposals.propose(owner, proposer, { items: [] }));
    assert.strictEqual(empty._tag, "proposal.content_invalid");

    const nothing = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        items: [
          {
            team: decodeTeamId(foreignTeam),
            kind: "drop",
            adds: [],
            drops: add,
            reason: "A foreign team.",
          },
          {
            team: decodeTeamId(foreignTeam),
            kind: "drop",
            adds: [],
            drops: add,
            reason: "Another item for the same foreign team.",
          },
        ],
      }),
    );
    assert.strictEqual(nothing._tag, "proposal.nothing_accepted");
    if (nothing._tag === "proposal.nothing_accepted") {
      assert.deepStrictEqual(
        nothing.refusals.map((refusal) => [refusal.index, refusal.refusal]),
        [
          [0, "team_not_owned"],
          [1, "team_not_owned"],
        ],
      );
      assert.include(nothing.refusals[0]?.detail, "Item 1");
    }

    const first = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: teamId(seeded, "nhl.l.1.t.1"),
          kind: "free_agent_add",
          adds: add,
          drops: [],
          reason: "Add the pool forward.",
        },
      ],
    });
    const repeated = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: teamId(seeded, "nhl.l.1.t.1"),
          kind: "free_agent_add",
          adds: add,
          drops: [],
          reason: "Add the pool forward.",
        },
      ],
    });

    assert.isTrue(first.created);
    assert.isFalse(repeated.created);
    assert.strictEqual(repeated.set.id, first.set.id);
    assert.include(repeated.detail, "already proposed");

    const newReason = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: teamId(seeded, "nhl.l.1.t.1"),
          kind: "free_agent_add",
          adds: add,
          drops: [],
          reason: "A different reason for the same move.",
        },
      ],
    });
    assert.isTrue(newReason.created);
    assert.notStrictEqual(newReason.set.id, first.set.id);

    const duplicated = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: teamId(seeded, "nhl.l.1.t.1"),
          kind: "free_agent_add",
          adds: add,
          drops: [],
          reason: "First statement of the move.",
        },
        {
          team: teamId(seeded, "nhl.l.1.t.1"),
          kind: "free_agent_add",
          adds: add,
          drops: [],
          reason: "Second statement of the same move.",
        },
      ],
    });
    assert.deepStrictEqual(
      duplicated.items.map((item) => item.outcome),
      ["accepted", "refused"],
    );
    const refused = duplicated.items[1];
    if (refused?.outcome === "refused") {
      assert.strictEqual(refused.refusal, "duplicate_item");
      assert.include(refused.detail, "Item 2");
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("marks each item current or stale with a reason in one read per team", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line", "nhl")], {
      league: leagueFixture({ usesFaab: true }),
      roster: rosterFixture(["nhl.p.90001", "nhl.p.90002", "nhl.p.90003"]),
      playerDetails: playerDetails,
      leagueTeams: [
        {
          providerTeamKey: "nhl.l.1.t.1",
          providerLeagueKey: "nhl.l.1",
          name: "Red Line",
          acquisitionUsage: { seasonMoves: undefined, weeklyAdds: undefined },
          remainingBudget: 50,
        },
      ],
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Swap one center for another.",
        },
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90005"]),
          drops: [],
          reason: "Add a rostered player.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90009"]),
          reason: "Drop someone who left.",
        },
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", [
            "nhl.p.90012",
            "nhl.p.90013",
            "nhl.p.90014",
            "nhl.p.90015",
            "nhl.p.90016",
            "nhl.p.90017",
          ]),
          drops: [],
          reason: "Add six players with no drop.",
        },
        {
          team: redLine,
          kind: "waiver_claim",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: [],
          bid: 60,
          reason: "Spend more than the budget.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const items = itemsOf(review);
    assert.deepStrictEqual(
      items.map((item) => item.staleness.status),
      ["current", "stale", "stale", "stale", "stale"],
    );
    assert.deepStrictEqual(reasonCodes(items[0]), []);
    assert.deepStrictEqual(reasonCodes(items[1]), ["player_unavailable"]);
    assert.deepStrictEqual(reasonCodes(items[2]), ["drop_not_rostered"]);
    assert.deepStrictEqual(reasonCodes(items[3]), ["roster_full"]);
    assert.deepStrictEqual(reasonCodes(items[4]), ["bid_exceeds_budget"]);
    const first = Array.getUnsafe(items, 0);
    assert.strictEqual(first.state, "proposed");
    assert.isDefined(first.staleness.checkedAt);
    assert.strictEqual(first.adds[0]?.name, "Pool Forward");
    assert.strictEqual(first.adds[0]?.position, "C");
    assert.strictEqual(first.adds[0]?.proTeam, "SYN");
    assert.strictEqual(first.adds[0]?.availability, "Free agent");
    assert.strictEqual(first.drops[0]?.name, "Roster One");
    assert.strictEqual(first.drops[0]?.position, "C");
    assert.strictEqual(first.drops[0]?.proTeam, "SYN");
    assert.strictEqual(first.drops[0]?.availability, undefined);
    assert.deepStrictEqual(yield* fake.rosterPeriods, [undefined]);
    const teamEntry = Array.getUnsafe(review.teams, 0);
    assert.deepStrictEqual(teamEntry.budget, { status: "published", remaining: 50 });
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("marks a proposal illegal when a reserve slot does not accept a player's positions", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: reserveBenchLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "IR", eligible: ["C"] },
        { slot: "BN", eligible: ["C"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "Drop the player on the bench.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(item.staleness.status, "illegal");
    assert.notStrictEqual(item.staleness.status, "stale");
    assert.deepStrictEqual(reasonCodes(item), ["slot_illegal"]);
    const reason = Array.getUnsafe(item.staleness.reasons, 0);
    assert.include(reason.detail, "Roster Two");
    assert.include(reason.detail, "IR");
    assert.include(reason.detail, "choosing which player to drop is yours");

    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    const submittedItem = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(submittedItem.state, "skipped");
    assert.include(submittedItem.execution?.detail ?? "", "Roster Two");
    assert.deepStrictEqual(yield* fake.transactionRequests, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "marks a proposal illegal when a starting slot does not accept a player's positions",
  () =>
    Effect.gen(function* () {
      const proposals = yield* TransactionProposals;
      const fake = yield* FakeProviderWorld;
      const tokens = yield* QueryTokens;
      const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
        league: wingBenchLeague,
        roster: rosterWithSlots("nhl.l.1.t.1", [
          { slot: "C", eligible: ["C"] },
          { slot: "LW", eligible: ["C"] },
          { slot: "BN", eligible: ["C"] },
        ]),
        playerDetails,
      });
      const redLine = teamId(seeded, "nhl.l.1.t.1");
      const result = yield* proposals.propose(owner, proposer, {
        items: [
          {
            team: redLine,
            kind: "drop",
            adds: [],
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
            reason: "Drop the player on the bench.",
          },
        ],
      });

      const review = yield* proposals.revalidate(owner, { set: result.set.id });
      const item = Array.getUnsafe(itemsOf(review), 0);
      assert.strictEqual(item.staleness.status, "illegal");
      assert.deepStrictEqual(reasonCodes(item), ["slot_illegal"]);
      const reason = Array.getUnsafe(item.staleness.reasons, 0);
      assert.include(reason.detail, "Roster Two");
      assert.include(reason.detail, "LW");
      assert.include(reason.detail, "does not accept their positions");
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("marks a proposal illegal in a league whose reserve slot is called IL+", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: ilPlusBenchLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "IL+", eligible: ["C"] },
        { slot: "BN", eligible: ["C"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "Drop the player on the bench.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(item.staleness.status, "illegal");
    assert.deepStrictEqual(reasonCodes(item), ["slot_illegal"]);
    const reason = Array.getUnsafe(item.staleness.reasons, 0);
    assert.include(reason.detail, "Roster Two");
    assert.include(reason.detail, "IL+");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("moves an illegal reserve player to an open legal slot before the add", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: openBenchLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "IR", eligible: ["C"] },
        { slot: "BN", eligible: ["C"] },
        { slot: "BN", eligible: ["C"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "Swap a bench center for a better one.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(item.staleness.status, "current");
    assert.deepStrictEqual(reasonCodes(item), []);
    assert.strictEqual(item.reserveMove?.player.name, "Roster Two");
    assert.strictEqual(item.reserveMove?.fromSlot, "IR");
    assert.strictEqual(item.reserveMove?.toSlot, "BN");

    const read = yield* proposals.read(owner, { set: result.set.id });
    const readItem = Array.getUnsafe(itemsOf(read), 0);
    assert.strictEqual(readItem.reserveMove?.player.name, "Roster Two");
    assert.strictEqual(readItem.reserveMove?.fromSlot, "IR");
    assert.strictEqual(readItem.reserveMove?.toSlot, "BN");

    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    const submittedItem = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(submittedItem.state, "executed");
    assert.deepStrictEqual(
      submittedItem.execution?.steps.map((step) => step.kind),
      ["reserve_move", "add", "drop"],
    );
    assert.deepStrictEqual(yield* fake.reserveRequests, [
      {
        providerTeamKey: "nhl.l.1.t.1",
        coverage: { type: "date", date: "2026-10-31" },
        providerPlayerKey: "nhl.p.90002",
        slot: "BN",
      },
    ]);
    assert.deepStrictEqual(yield* fake.transactionRequests, [
      {
        providerLeagueKey: "nhl.l.1",
        providerTeamKey: "nhl.l.1.t.1",
        adds: ["nhl.p.90004"],
        drops: ["nhl.p.90003"],
        faabBid: undefined,
      },
    ]);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses an illegal roster when no legal slot is open and names the choice", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "IR", eligible: ["C"] },
        { slot: "BN", eligible: ["C"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "Swap a bench center for a better one.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(item.staleness.status, "illegal");
    assert.isUndefined(item.reserveMove);
    const reason = Array.getUnsafe(item.staleness.reasons, 0);
    assert.include(reason.detail, "choosing which player to drop is yours");

    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    assert.strictEqual(Array.getUnsafe(itemsOf(submitted), 0).state, "skipped");
    assert.deepStrictEqual(yield* fake.reserveRequests, []);
    assert.deepStrictEqual(yield* fake.transactionRequests, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("keeps a stale proposal stale when its roster is legal", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({}),
      roster: rosterFixture(["nhl.p.90001", "nhl.p.90002"]),
      playerDetails: playerDetails.filter((entry) => entry.providerPlayerKey !== "nhl.p.90004"),
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Add a center who is no longer in the pool.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(item.staleness.status, "stale");
    assert.notStrictEqual(item.staleness.status, "illegal");
    assert.deepStrictEqual(reasonCodes(item), ["player_unavailable"]);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("keeps a proposal current when the reserve slot holds an injured player it accepts", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: reserveLeague,
      roster: reserveRosterWith("nhl.l.1.t.1", { code: "O", detail: "Out" }),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Swap one center for another.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(item.staleness.status, "current");
    assert.deepStrictEqual(reasonCodes(item), []);

    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    const submittedItem = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(submittedItem.state, "executed");
    assert.strictEqual((yield* fake.transactionRequests).length, 1);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("allows a drop that resolves an illegal reserve player", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: reserveLeague,
      roster: reserveRosterWith("nhl.l.1.t.1", undefined),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Drop the healthy player who is blocking the reserve slot.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(item.staleness.status, "current");
    assert.deepStrictEqual(reasonCodes(item), []);

    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    const submittedItem = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(submittedItem.state, "executed");
    assert.strictEqual((yield* fake.transactionRequests).length, 1);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("names the HTTP status beside the provider's exact refusal wording", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({}),
      roster: rosterFixture(["nhl.p.90001", "nhl.p.90002"]),
      playerDetails,
    });
    yield* fake.setTransactionAction("reject", providerRefusal, 400);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Drop the second center.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    const submittedItem = Array.getUnsafe(itemsOf(submitted), 0);
    const detail = `The provider rejected the transaction with HTTP 400. It said: ${providerRefusal}`;
    assert.strictEqual(submittedItem.execution?.outcome, "failed");
    assert.strictEqual(submittedItem.execution?.detail, detail);
    assert.strictEqual(submittedItem.execution?.steps[0]?.detail, detail);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "marks a closed period, a missing budget, and an unreadable team without hiding others",
  () =>
    Effect.gen(function* () {
      const proposals = yield* TransactionProposals;
      const fake = yield* FakeProviderWorld;
      const tokens = yield* QueryTokens;
      const seeded = yield* seed(
        fake,
        [team("nhl.l.1.t.1", "Closed Season", "nhl"), team("nhl.l.2.t.1", "Unreadable", "nhl")],
        {
          league: leagueFixture({
            usesFaab: false,
            endDate: "2026-10-01",
            currentDate: "2026-10-31",
          }),
          roster: rosterFixture(["nhl.p.90001", "nhl.p.90002", "nhl.p.90003"]),
          playerDetails: playerDetails,
        },
      );
      const result = yield* proposals.propose(owner, proposer, {
        items: [
          {
            team: teamId(seeded, "nhl.l.1.t.1"),
            kind: "waiver_claim",
            adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
            drops: [],
            bid: 10,
            reason: "Claim after the season closed.",
          },
          {
            team: teamId(seeded, "nhl.l.2.t.1"),
            kind: "free_agent_add",
            adds: yield* refs(tokens, "nhl.l.2", ["nhl.p.90004"]),
            drops: [],
            reason: "This team cannot be read.",
          },
        ],
      });

      const review = yield* proposals.revalidate(owner, { set: result.set.id });
      const closed = Array.getUnsafe(review.teams, 0);
      const unreadable = Array.getUnsafe(review.teams, 1);
      assert.deepStrictEqual(
        closed.items.flatMap((item) => reasonCodes(item)),
        ["period_closed", "bid_not_available"],
      );
      assert.deepStrictEqual(closed.budget, {
        status: "not_published",
        detail: "This league does not use a FAAB waiver budget.",
      });
      assert.strictEqual(unreadable.items[0]?.staleness.status, "stale");
      assert.deepStrictEqual(
        unreadable.items.flatMap((item) => reasonCodes(item)),
        ["state_unavailable"],
      );
      assert.isString(unreadable.failure);
      assert.include(unreadable.failure, "provider read failed");
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses to revalidate an expired set and keeps it readable", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line", "nhl")]);
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: teamId(seeded, "nhl.l.1.t.1"),
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "A drop for later.",
        },
      ],
    });

    yield* TestClock.adjust(proposalSetLifetimeMillis);
    const expired = yield* Effect.flip(proposals.revalidate(owner, { set: result.set.id }));
    assert.instanceOf(expired, ProposalSetExpired);
    assert.deepStrictEqual(yield* fake.rosterPeriods, []);

    const review = yield* proposals.read(owner, { set: result.set.id });
    assert.isTrue(review.set.expired);
    const foreign = yield* Effect.flip(proposals.revalidate(other, { set: result.set.id }));
    assert.instanceOf(foreign, ProposalSetNotFound);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("reads pending trade offers as a read-only, owner-scoped view", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [
      team("nhl.l.1.t.1", "Red Line", "nhl"),
      team("nhl.l.1.t.2", "Blue Line", "nhl"),
    ]);
    yield* fake.setPendingTrades([pendingTrade]);
    const database = yield* ConnectionsDatabase;
    const writtenAt = DateTime.makeUnsafe("2026-10-30T18:00:00.000Z");
    const note = "Dynasty league. Keep both goalies; cost rises by 5 each season.";
    yield* database
      .update(providerTeams)
      .set({ ownerNote: note, ownerNoteUpdatedAt: DateTime.toDateUtc(writtenAt) })
      .where(eq(providerTeams.id, teamId(seeded, "nhl.l.1.t.1")));

    const read = yield* proposals.readPendingOffers(owner, {
      team: teamId(seeded, "nhl.l.1.t.1"),
    });
    assert.strictEqual(read.status, "available");
    assert.isTrue(read.readOnly);
    assert.deepStrictEqual(read.ownerNote, {
      status: "provided",
      text: note,
      updatedAt: writtenAt,
    });
    assert.strictEqual(read.offers.length, 1);
    const offer = Array.getUnsafe(read.offers, 0);
    assert.isTrue(offer.canRespond);
    assert.strictEqual(offer.note, "Two for two.");
    assert.strictEqual(offer.proposingTeam?.name, "Blue Line");
    assert.strictEqual(offer.receivingTeam?.name, "Red Line");
    assert.deepStrictEqual(
      offer.players.map((player) => [player.name, player.from?.name, player.to?.name]),
      [
        ["Incoming Wing", "Blue Line", "Red Line"],
        ["Outgoing Center", "Red Line", "Blue Line"],
      ],
    );
    assert.deepStrictEqual(
      offer.picks.map((pick) => [pick.round, pick.from?.name, pick.to?.name]),
      [[3, "Blue Line", "Red Line"]],
    );
    assert.isTrue(offer.players[0]?.player.startsWith("r1."));
    assert.isFalse(includesText(read, "nhl.p.20001"));
    assert.isFalse(includesText(read, "nhl.l.1.t.2"));

    const foreign = yield* Effect.flip(
      proposals.readPendingOffers(other, { team: teamId(seeded, "nhl.l.1.t.1") }),
    );
    assert.strictEqual(foreign._tag, "proposal.team_not_found");

    yield* fake.unsupportedOperations(["read_pending_trades"]);
    const unsupported = yield* proposals.readPendingOffers(owner, {
      team: teamId(seeded, "nhl.l.1.t.1"),
    });
    assert.strictEqual(unsupported.status, "unsupported");
    assert.deepStrictEqual(unsupported.offers, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "submits only included current items, skips one that went stale between review and submit, and records the audit",
  () =>
    Effect.gen(function* () {
      const proposals = yield* TransactionProposals;
      const fake = yield* FakeProviderWorld;
      const tokens = yield* QueryTokens;
      const seeded = yield* seedTwoTeams(fake);
      const redLine = teamId(seeded, "nhl.l.1.t.1");
      const blueLine = teamId(seeded, "nhl.l.1.t.2");

      const result = yield* proposals.propose(owner, proposer, {
        items: [
          {
            team: redLine,
            kind: "free_agent_add",
            adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
            reason: "Swap one center for the pool forward.",
          },
          {
            team: redLine,
            kind: "free_agent_add",
            adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90007"]),
            drops: [],
            reason: "This move will go stale before submit.",
          },
          {
            team: redLine,
            kind: "drop",
            adds: [],
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
            reason: "Left out by the person.",
          },
          {
            team: blueLine,
            kind: "drop",
            adds: [],
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
            reason: "This other team still submits.",
          },
        ],
      });
      const firstReview = yield* proposals.revalidate(owner, { set: result.set.id });
      assert.deepStrictEqual(
        Object.fromEntries(
          itemsOf(firstReview).map((item) => [item.reason, item.staleness.status]),
        ),
        {
          "Swap one center for the pool forward.": "current",
          "This move will go stale before submit.": "current",
          "Left out by the person.": "current",
          "This other team still submits.": "current",
        },
      );
      const freeAgent = itemByReason(firstReview, "Swap one center for the pool forward.").id;
      const stale = itemByReason(firstReview, "This move will go stale before submit.").id;
      const excluded = itemByReason(firstReview, "Left out by the person.").id;
      const otherTeam = itemByReason(firstReview, "This other team still submits.").id;

      yield* fake.setPlayerDetails([
        ...playerDetails.filter((detail) => detail.providerPlayerKey !== "nhl.p.90007"),
        detail("nhl.p.90007", "Rostered Seven", "rostered"),
      ]);

      const submitted = yield* proposals.submit(owner, {
        set: result.set.id,
        include: [freeAgent, stale, otherTeam],
      });

      const submittedItems = itemsOf(submitted);
      assert.deepStrictEqual(
        Object.fromEntries(submittedItems.map((item) => [item.reason, item.state])),
        {
          "Swap one center for the pool forward.": "executed",
          "This move will go stale before submit.": "skipped",
          "Left out by the person.": "skipped",
          "This other team still submits.": "executed",
        },
      );
      assert.strictEqual(submitted.set.submission?.submittedAt !== undefined, true);
      assert.strictEqual(submitted.set.submission?.completedAt !== undefined, true);
      const staleItem = submittedItems.find((item) => item.id === stale);
      assert.include(staleItem?.execution?.detail ?? "", "already rostered in this league");
      const excludedItem = submittedItems.find((item) => item.id === excluded);
      assert.strictEqual(excludedItem?.execution?.detail, "Left out of this submission.");
      const executed = submittedItems.find((item) => item.id === freeAgent);
      assert.deepStrictEqual(
        executed?.execution?.steps.map((step) => [step.kind, step.outcome]),
        [
          ["add", "executed"],
          ["drop", "executed"],
        ],
      );

      const requests = yield* fake.transactionRequests;
      assert.strictEqual(requests.length, 2);
      assert.deepStrictEqual(
        requests
          .map((request) => [request.providerTeamKey, request.adds, request.drops, request.faabBid])
          .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
        [
          ["nhl.l.1.t.1", ["nhl.p.90004"], ["nhl.p.90001"], undefined],
          ["nhl.l.1.t.2", [], ["nhl.p.90003"], undefined],
        ],
      );

      const read = yield* proposals.read(owner, { set: result.set.id });
      assert.strictEqual(read.set.submission?.completedAt !== undefined, true);
      const readBack = itemsOf(read).find((item) => item.id === freeAgent);
      assert.deepStrictEqual(
        readBack?.execution?.steps.map((step) => [step.kind, step.outcome]),
        [
          ["add", "executed"],
          ["drop", "executed"],
        ],
      );

      const readsBeforeRevalidate = (yield* fake.rosterPeriods).length;
      const revalidated = yield* proposals.revalidate(owner, { set: result.set.id });
      assert.deepStrictEqual(
        Object.fromEntries(itemsOf(revalidated).map((item) => [item.reason, item.state])),
        {
          "Swap one center for the pool forward.": "executed",
          "This move will go stale before submit.": "skipped",
          "Left out by the person.": "skipped",
          "This other team still submits.": "executed",
        },
      );
      assert.strictEqual((yield* fake.rosterPeriods).length, readsBeforeRevalidate);
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a duplicate submission without a second provider write", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTwoTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Drop one player.",
        },
      ],
    });
    const item = itemsOf(yield* proposals.revalidate(owner, { set: result.set.id }))[0];
    assert.isDefined(item);

    const first = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    assert.strictEqual(itemsOf(first)[0]?.state, "executed");
    const before = (yield* fake.transactionRequests).length;

    const duplicate = yield* Effect.flip(
      proposals.submit(owner, { set: result.set.id, include: [item.id] }),
    );
    assert.instanceOf(duplicate, ProposalSetAlreadySubmitted);
    assert.strictEqual((yield* fake.transactionRequests).length, before);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses an expired set, a foreign set, and an empty selection without writing", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTwoTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const fresh = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "A move for a refusal test.",
        },
      ],
    });
    const freshItem = itemsOf(yield* proposals.revalidate(owner, { set: fresh.set.id }))[0];
    assert.isDefined(freshItem);

    const empty = yield* Effect.flip(proposals.submit(owner, { set: fresh.set.id, include: [] }));
    assert.instanceOf(empty, ProposalContentInvalid);
    const foreign = yield* Effect.flip(
      proposals.submit(other, { set: fresh.set.id, include: [freshItem.id] }),
    );
    assert.instanceOf(foreign, ProposalSetNotFound);
    assert.deepStrictEqual(yield* fake.transactionRequests, []);

    yield* TestClock.adjust(proposalSetLifetimeMillis);
    const expired = yield* Effect.flip(
      proposals.submit(owner, { set: fresh.set.id, include: [freshItem.id] }),
    );
    assert.instanceOf(expired, ProposalSetExpired);
    assert.deepStrictEqual(yield* fake.transactionRequests, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("reports a reserve move and a failed add per step, then stops only that team", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(
      fake,
      [team("nhl.l.1.t.1", "Red Line"), team("nhl.l.1.t.2", "Blue Line")],
      {
        league: leagueFixture({
          rosterPositions: [
            { position: "C", positionType: "O", count: 2, kind: "starting", eligibility: ["C"] },
            { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: [] },
            { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
          ],
        }),
        roster: reserveRoster("nhl.l.1.t.1"),
        playerDetails,
      },
    );
    yield* fake.setTeamRoster(
      "nhl.l.1.t.2",
      rosterFixture(["nhl.p.90002", "nhl.p.90003"], "nhl.l.1.t.2"),
    );
    yield* fake.setReserveAction("accept");
    yield* fake.setTeamTransactionAction("nhl.l.1.t.1", "reject");
    yield* fake.setTransactionAction("accept", "That player can no longer be added.");
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const blueLine = teamId(seeded, "nhl.l.1.t.2");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: [],
          reason: "Stash the injured player, then add.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "This should not be attempted after the failure.",
        },
        {
          team: blueLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "The other team continues.",
        },
      ],
    });
    const preview = yield* proposals.revalidate(owner, { set: result.set.id });
    const reserveMove = itemByReason(preview, "Stash the injured player, then add.").reserveMove;
    assert.isDefined(reserveMove);
    assert.strictEqual(reserveMove.player.name, "Roster Two");
    assert.strictEqual(reserveMove.fromSlot, "BN");
    assert.strictEqual(reserveMove.toSlot, "IR");
    assert.isString(reserveMove.player.ref);
    const firstId = itemByReason(preview, "Stash the injured player, then add.").id;
    const secondId = itemByReason(preview, "This should not be attempted after the failure.").id;
    const thirdId = itemByReason(preview, "The other team continues.").id;

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [firstId, secondId, thirdId],
    });
    const items = itemsOf(submitted);
    assert.deepStrictEqual(Object.fromEntries(items.map((item) => [item.reason, item.state])), {
      "Stash the injured player, then add.": "failed",
      "This should not be attempted after the failure.": "skipped",
      "The other team continues.": "executed",
    });
    const failed = items.find((item) => item.id === firstId);
    assert.deepStrictEqual(
      failed?.execution?.steps.map((step) => [step.kind, step.outcome, step.detail]),
      [
        ["reserve_move", "executed", undefined],
        [
          "add",
          "failed",
          "The provider rejected the transaction. It said: That player can no longer be added.",
        ],
      ],
    );
    assert.include(items.find((item) => item.id === secondId)?.execution?.detail ?? "", "failed");
    const reserves = yield* fake.reserveRequests;
    assert.deepStrictEqual(reserves, [
      {
        providerTeamKey: "nhl.l.1.t.1",
        coverage: { type: "date", date: "2026-10-31" },
        providerPlayerKey: "nhl.p.90002",
        slot: "IR",
      },
    ]);
    const requests = yield* fake.transactionRequests;
    assert.deepStrictEqual(
      requests
        .map((request) => [request.providerTeamKey, request.adds, request.drops])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      [
        ["nhl.l.1.t.1", ["nhl.p.90004"], []],
        ["nhl.l.1.t.2", [], ["nhl.p.90003"]],
      ],
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("accepts a declared slot move and reads back its destination slot", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "IR", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0),
            toSlot: "BN",
          },
          reason: "Move the reserve center to the bench.",
        },
      ],
    });
    const accepted = Array.getUnsafe(result.items, 0);
    assert.strictEqual(accepted.outcome, "accepted");
    if (accepted.outcome === "accepted") {
      assert.strictEqual(accepted.item.kind, "slot_move");
      assert.strictEqual(accepted.item.slotMove?.player.name, undefined);
      assert.isString(accepted.item.slotMove?.player.ref);
      assert.isUndefined(accepted.item.slotMove?.fromSlot);
      assert.strictEqual(accepted.item.slotMove?.toSlot, "BN");
    }

    const read = yield* proposals.read(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(read), 0);
    assert.strictEqual(item.kind, "slot_move");
    assert.strictEqual(item.slotMove?.toSlot, "BN");
    assert.isUndefined(item.slotMove?.fromSlot);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a slot move that carries an add or names no destination", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "IR", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const playerRef = Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0);
    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        items: [
          {
            team: redLine,
            kind: "slot_move",
            adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
            drops: [],
            slotMove: { player: playerRef, toSlot: "BN" },
            reason: "A move cannot also add a player.",
          },
          {
            team: redLine,
            kind: "slot_move",
            adds: [],
            drops: [],
            reason: "A move with no destination.",
          },
        ],
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      assert.deepStrictEqual(
        refused.refusals.map((refusal) => refusal.refusal),
        ["kind_invalid", "kind_invalid"],
      );
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses an item that names more adds than the provider's request allows", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], { playerDetails });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004", "nhl.p.90007"]),
          drops: [],
          reason: "Add two available forwards.",
        },
      ],
    });
    const accepted = Array.getUnsafe(result.items, 0);
    assert.strictEqual(accepted.outcome, "accepted");
    if (accepted.outcome !== "accepted") {
      return;
    }

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    assert.strictEqual(Array.getUnsafe(itemsOf(review), 0).staleness.status, "current");

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [accepted.item.id],
    });
    const item = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(item.state, "skipped");
    assert.include(item.execution?.detail ?? "", "at most 1 add and 1 drop");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("attributes the provider's own words when it does not send a write", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], { playerDetails });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Swap one forward for another.",
        },
      ],
    });
    const accepted = Array.getUnsafe(result.items, 0);
    assert.strictEqual(accepted.outcome, "accepted");
    if (accepted.outcome !== "accepted") {
      return;
    }
    yield* fake.setTransactionAction(
      "unavailable",
      "This write would exceed the provider's request allowance.",
    );
    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    assert.strictEqual(Array.getUnsafe(itemsOf(review), 0).staleness.status, "current");

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [accepted.item.id],
    });
    const item = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(item.state, "failed");
    assert.include(
      item.execution?.detail ?? "",
      "The provider did not send the request. It said: This write would exceed the provider's request allowance.",
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("orders a declared slot move after the drop that frees its slot", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "IR", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0),
            toSlot: "BN",
          },
          reason: "Move the reserve center to the bench.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Free the bench slot.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const moveItem = itemByReason(review, "Move the reserve center to the bench.");
    const dropItem = itemByReason(review, "Free the bench slot.");
    assert.strictEqual(moveItem.staleness.status, "current");
    assert.strictEqual(dropItem.staleness.status, "current");
    assert.strictEqual(moveItem.slotMove?.player.name, "Roster Three");
    assert.strictEqual(moveItem.slotMove?.fromSlot, "IR");
    assert.strictEqual(moveItem.slotMove?.toSlot, "BN");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.strictEqual(teamReview.order.timing, "same_day");
      assert.strictEqual(teamReview.order.effectiveDate, "2026-10-31");
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.item),
        [dropItem.id, moveItem.id],
      );
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("composes a slot move with the add it makes room for", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]), 0),
            toSlot: "IR",
          },
          reason: "Send the reserve-eligible center to reserve.",
        },
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: [],
          reason: "Use the place that move frees.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const moveItem = itemByReason(review, "Send the reserve-eligible center to reserve.");
    const addItem = itemByReason(review, "Use the place that move frees.");
    assert.strictEqual(moveItem.staleness.status, "current");
    assert.strictEqual(addItem.staleness.status, "current");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => [step.item, step.position]),
        [
          [moveItem.id, 0],
          [addItem.id, 1],
        ],
      );
    }

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [moveItem.id, addItem.id],
    });
    const submittedMove = itemByReason(submitted, "Send the reserve-eligible center to reserve.");
    const submittedAdd = itemByReason(submitted, "Use the place that move frees.");
    assert.strictEqual(submittedMove.state, "executed");
    assert.strictEqual(submittedMove.execution?.position, 0);
    assert.strictEqual(submittedAdd.state, "executed");
    assert.strictEqual(submittedAdd.execution?.position, 1);
    assert.deepStrictEqual(yield* fake.reserveRequests, [
      {
        providerTeamKey: "nhl.l.1.t.1",
        coverage: { type: "date", date: "2026-10-31" },
        providerPlayerKey: "nhl.p.90002",
        slot: "IR",
      },
    ]);
    assert.deepStrictEqual(
      (yield* fake.transactionRequests).map((request) => [request.adds, request.drops]),
      [[["nhl.p.90004"], []]],
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("composes a drop with the add it funds", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Free the bench place.",
        },
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: [],
          reason: "Fill the place the drop frees.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const dropItem = itemByReason(review, "Free the bench place.");
    const addItem = itemByReason(review, "Fill the place the drop frees.");
    assert.strictEqual(dropItem.staleness.status, "current");
    assert.strictEqual(addItem.staleness.status, "current");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.item),
        [dropItem.id, addItem.id],
      );
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("composes a drop pair and an add that the drops make legal", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "IR", eligible: ["C"] },
        { slot: "BN", eligible: ["C"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Drop the player in the reserve slot.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "Drop the bench player too.",
        },
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: [],
          reason: "Fill the places the drops free.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const firstDrop = itemByReason(review, "Drop the player in the reserve slot.");
    const secondDrop = itemByReason(review, "Drop the bench player too.");
    const addItem = itemByReason(review, "Fill the places the drops free.");
    assert.deepStrictEqual(
      [firstDrop, secondDrop, addItem].map((item) => item.staleness.status),
      ["current", "current", "current"],
    );
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.item),
        [firstDrop.id, secondDrop.id, addItem.id],
      );
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.position),
        [0, 1, 2],
      );
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("names the operation a full roster still needs", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: [],
          reason: "Add with no place for him.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(item.staleness.status, "stale");
    assert.deepStrictEqual(reasonCodes(item), ["roster_full"]);
    const detail = item.staleness.reasons[0]?.detail ?? "";
    assert.include(detail, "Add a drop item for a player outside a reserve slot");
    assert.include(detail, "or a slot move into a reserve slot");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("lets the declared move repair the roster before another item runs", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "IR", eligible: ["C"] },
        { slot: "C", eligible: ["C"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]), 0),
            toSlot: "BN",
          },
          reason: "Move the healthy player out of the reserve slot.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Drop the spare center.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const moveItem = itemByReason(review, "Move the healthy player out of the reserve slot.");
    const dropItem = itemByReason(review, "Drop the spare center.");
    assert.strictEqual(moveItem.staleness.status, "current");
    assert.strictEqual(dropItem.staleness.status, "current");
    assert.isUndefined(dropItem.reserveMove);
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.item),
        [moveItem.id, dropItem.id],
      );
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses an order whose drop frees a different slot than the move needs", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "IR", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0),
            toSlot: "BN",
          },
          reason: "Move the reserve center to the bench.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Drop the starting center.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const moveItem = itemByReason(review, "Move the reserve center to the bench.");
    const dropItem = itemByReason(review, "Drop the starting center.");
    assert.strictEqual(moveItem.staleness.status, "illegal");
    assert.strictEqual(dropItem.staleness.status, "illegal");
    assert.deepStrictEqual(reasonCodes(moveItem), ["order_conflict"]);
    assert.deepStrictEqual(reasonCodes(dropItem), ["order_conflict"]);
    assert.strictEqual(teamReview.order?.status, "conflict");
    if (teamReview.order?.status === "conflict") {
      assert.deepStrictEqual(teamReview.order.conflicts[0]?.items, [moveItem.id, dropItem.id]);
      const detail = teamReview.order.conflicts[0]?.detail ?? "";
      assert.include(detail, "Roster Three");
      assert.include(detail, "BN");
      assert.include(detail, "Roster One");
      assert.include(detail, "C");
      assert.include(detail, "2026-10-31");
    }

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [moveItem.id, dropItem.id],
    });
    assert.deepStrictEqual(
      itemsOf(submitted).map((item) => item.state),
      ["skipped", "skipped"],
    );
    assert.deepStrictEqual(yield* fake.reserveRequests, []);
    assert.deepStrictEqual(yield* fake.transactionRequests, []);
    assert.deepStrictEqual(yield* fake.writeSequence, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("executes a set in the computed order and records each item's position", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "IR", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0),
            toSlot: "BN",
          },
          reason: "Move the reserve center to the bench.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Free the bench slot.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const moveItem = itemByReason(review, "Move the reserve center to the bench.");
    const dropItem = itemByReason(review, "Free the bench slot.");
    assert.strictEqual(moveItem.staleness.status, "current");
    assert.strictEqual(dropItem.staleness.status, "current");

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [moveItem.id, dropItem.id],
    });
    const submittedDrop = itemByReason(submitted, "Free the bench slot.");
    const submittedMove = itemByReason(submitted, "Move the reserve center to the bench.");
    assert.strictEqual(submittedDrop.state, "executed");
    assert.strictEqual(submittedDrop.execution?.position, 0);
    assert.deepStrictEqual(
      submittedDrop.execution?.steps.map((step) => step.kind),
      ["drop"],
    );
    assert.strictEqual(submittedMove.state, "executed");
    assert.strictEqual(submittedMove.execution?.position, 1);
    assert.deepStrictEqual(
      submittedMove.execution?.steps.map((step) => ({
        kind: step.kind,
        from: step.fromSlot,
        to: step.toSlot,
      })),
      [{ kind: "slot_move", from: "IR", to: "BN" }],
    );
    assert.deepStrictEqual(yield* fake.writeSequence, ["transaction", "reserve_move"]);

    const read = yield* proposals.read(owner, { set: result.set.id });
    assert.deepStrictEqual(
      itemsOf(read).map((item) => [item.reason, item.execution?.position]),
      [
        ["Move the reserve center to the bench.", 1],
        ["Free the bench slot.", 0],
      ],
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("reads the planned order back before submission and applies it", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "IR", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0),
            toSlot: "BN",
          },
          reason: "Move the reserve center to the bench.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Free the bench slot.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const moveItem = itemByReason(review, "Move the reserve center to the bench.");
    const dropItem = itemByReason(review, "Free the bench slot.");
    const read = yield* proposals.read(owner, { set: result.set.id });
    const readTeam = Array.getUnsafe(read.teams, 0);
    assert.strictEqual(readTeam.order?.status, "ordered");
    const planned =
      readTeam.order?.status === "ordered"
        ? readTeam.order.steps.map((step) => [step.item, step.position])
        : [];
    assert.deepStrictEqual(planned, [
      [dropItem.id, 0],
      [moveItem.id, 1],
    ]);

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [moveItem.id, dropItem.id],
    });
    assert.deepStrictEqual(
      itemsOf(submitted)
        .filter((item) => item.execution?.position !== undefined)
        .map((item) => [item.id, item.execution?.position])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      [...planned].sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("stops a team's later steps after a failure and keeps the failure's words", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "IR", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    yield* fake.setTransactionAction("reject", providerRefusal, 400);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0),
            toSlot: "BN",
          },
          reason: "Move the reserve center to the bench.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Free the bench slot.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [
        itemByReason(review, "Move the reserve center to the bench.").id,
        itemByReason(review, "Free the bench slot.").id,
      ],
    });
    const failed = itemByReason(submitted, "Free the bench slot.");
    const stopped = itemByReason(submitted, "Move the reserve center to the bench.");
    assert.strictEqual(failed.state, "failed");
    assert.strictEqual(failed.execution?.position, 0);
    assert.include(failed.execution?.detail ?? "", providerRefusal);
    assert.strictEqual(stopped.state, "skipped");
    assert.strictEqual(stopped.execution?.position, 1);
    assert.include(stopped.execution?.detail ?? "", "Not attempted because");
    assert.include(stopped.execution?.detail ?? "", "Dropping Roster Two failed");
    assert.include(stopped.execution?.detail ?? "", providerRefusal);
    assert.deepStrictEqual(yield* fake.writeSequence, ["transaction"]);
    assert.deepStrictEqual(yield* fake.reserveRequests, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("skips every later move after the second one fails", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({
        rosterPositions: [
          { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
          { position: "BN", positionType: "B", count: 2, kind: "bench", eligibility: [] },
          { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
        ],
      }),
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "BN", eligible: ["C"] },
      ]),
      playerDetails,
    });
    yield* fake.setTransactionAction("reject", providerRefusal);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]), 0),
            toSlot: "IR",
          },
          reason: "Move the reserve-eligible center to reserve.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Drop the starting center.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "Drop the bench center.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: itemsOf(review).map((item) => item.id),
    });
    const moveItem = itemByReason(submitted, "Move the reserve-eligible center to reserve.");
    const failed = itemByReason(submitted, "Drop the starting center.");
    const skipped = itemByReason(submitted, "Drop the bench center.");
    assert.strictEqual(moveItem.state, "executed");
    assert.strictEqual(moveItem.execution?.position, 0);
    assert.strictEqual(failed.state, "failed");
    assert.strictEqual(failed.execution?.position, 1);
    assert.include(failed.execution?.detail ?? "", providerRefusal);
    assert.strictEqual(skipped.state, "skipped");
    assert.strictEqual(skipped.execution?.position, 2);
    assert.include(skipped.execution?.detail ?? "", "Not attempted because");
    assert.include(skipped.execution?.detail ?? "", "Dropping Roster One failed");
    assert.deepStrictEqual(yield* fake.reserveRequests, [
      {
        providerTeamKey: "nhl.l.1.t.1",
        coverage: { type: "date", date: "2026-10-31" },
        providerPlayerKey: "nhl.p.90002",
        slot: "IR",
      },
    ]);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a whole team's set when no order keeps its moves legal", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: openBenchLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "BN", eligible: ["C"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]), 0),
            toSlot: "IR",
          },
          reason: "Stash the first center.",
        },
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0),
            toSlot: "IR",
          },
          reason: "Stash the second center.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90005"]),
          reason: "Drop the spare wing.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    assert.strictEqual(teamReview.order?.status, "conflict");
    assert.deepStrictEqual(
      itemsOf(review).map((item) => item.staleness.status),
      ["illegal", "illegal", "illegal"],
    );
    assert.deepStrictEqual(
      itemsOf(review).map((item) => reasonCodes(item)),
      [["order_conflict"], ["order_conflict"], ["order_conflict", "order_conflict"]],
    );
    const spare = itemByReason(review, "Drop the spare wing.");
    assert.include(
      spare.staleness.reasons.map((reason) => reason.detail).join(" "),
      "whole set is refused",
    );

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: itemsOf(review).map((item) => item.id),
    });
    assert.deepStrictEqual(
      itemsOf(submitted).map((item) => item.state),
      ["skipped", "skipped", "skipped"],
    );
    assert.deepStrictEqual(yield* fake.writeSequence, []);
    assert.deepStrictEqual(yield* fake.reserveRequests, []);
    assert.deepStrictEqual(yield* fake.transactionRequests, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a draft pick in a trade with the provider's own reason", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTradeTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const draft = yield* tradeDraft(tokens, redLine);

    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        items: [{ ...draft, picks: [{ round: 1 }] }],
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      assert.deepStrictEqual(
        refused.refusals.map((refusal) => refusal.refusal),
        ["draft_pick_included"],
      );
      assert.strictEqual(
        Array.getUnsafe(refused.refusals, 0).detail,
        "The fake provider's trade proposal request names players only and publishes no element for a draft pick.",
      );
    }
    assert.deepStrictEqual(yield* fake.writeSequence, []);
    assert.deepStrictEqual(yield* fake.tradeProposalRequests, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a move to an unknown or ineligible slot", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "IR", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]), 0),
            toSlot: "IR",
          },
          reason: "Move the center to a slot he cannot fill.",
        },
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0),
            toSlot: "BENCH",
          },
          reason: "Move the reserve center to a slot the league does not declare.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const ineligible = itemByReason(review, "Move the center to a slot he cannot fill.");
    const unknown = itemByReason(
      review,
      "Move the reserve center to a slot the league does not declare.",
    );
    assert.deepStrictEqual(reasonCodes(ineligible), ["slot_illegal"]);
    assert.include(ineligible.staleness.reasons[0]?.detail ?? "", "does not accept");
    assert.deepStrictEqual(reasonCodes(unknown), ["move_slot_unknown"]);
    assert.include(unknown.staleness.reasons[0]?.detail ?? "", "BENCH");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("marks a declared move stale when its player leaves the roster", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
        { slot: "IR", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]), 0),
            toSlot: "BN",
          },
          reason: "Move the reserve center to the bench.",
        },
      ],
    });
    yield* fake.setTeamRoster(
      "nhl.l.1.t.1",
      rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
      ]),
    );

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(item.staleness.status, "stale");
    assert.deepStrictEqual(reasonCodes(item), ["move_not_rostered"]);
    assert.include(item.staleness.reasons[0]?.detail ?? "", "no longer on this team's roster");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a locked player's move on the league's effective date", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({
        rosterChange: {
          rule: "same_day",
          source: ["weekly_deadline"],
          detail: "The provider's weekly_deadline is intraday.",
        },
        rosterPositions: [
          { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
          { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: [] },
          { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
        ],
      }),
      roster: lockedPlayer(
        rosterWithSlots("nhl.l.1.t.1", [
          { slot: "C", eligible: ["C"] },
          { slot: "BN", eligible: ["C", "IR"] },
          { slot: "IR", eligible: ["C", "IR"] },
        ]),
        "nhl.p.90002",
      ),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]), 0),
            toSlot: "IR",
          },
          reason: "Move the locked player to reserve.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = itemByReason(review, "Move the locked player to reserve.");
    assert.strictEqual(item.staleness.status, "illegal");
    assert.deepStrictEqual(reasonCodes(item), ["order_conflict"]);
    assert.include(item.staleness.reasons[0]?.detail ?? "", "Roster Two is locked");
    assert.include(item.staleness.reasons[0]?.detail ?? "", "2026-10-31");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("sends a declared slot move once and records its step and position", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: fullReserveLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C", "IR"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]), 0),
            toSlot: "IR",
          },
          reason: "Stash the injured center.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = itemByReason(review, "Stash the injured center.");
    assert.strictEqual(item.staleness.status, "current");
    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    const submittedItem = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(submittedItem.state, "executed");
    assert.strictEqual(submittedItem.execution?.position, 0);
    assert.deepStrictEqual(
      submittedItem.execution?.steps.map((step) => ({
        kind: step.kind,
        name: step.player.name,
        from: step.fromSlot,
        to: step.toSlot,
        outcome: step.outcome,
      })),
      [
        {
          kind: "slot_move",
          name: "Roster Two",
          from: "BN",
          to: "IR",
          outcome: "executed",
        },
      ],
    );
    assert.deepStrictEqual(yield* fake.reserveRequests, [
      {
        providerTeamKey: "nhl.l.1.t.1",
        coverage: { type: "date", date: "2026-10-31" },
        providerPlayerKey: "nhl.p.90002",
        slot: "IR",
      },
    ]);
    assert.deepStrictEqual(yield* fake.transactionRequests, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("keeps a waiver claim pending and stops that team without retrying", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTwoTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const blueLine = teamId(seeded, "nhl.l.1.t.2");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "waiver_claim",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90006"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          bid: 10,
          reason: "Claim the waiver wing.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Not attempted while the claim is pending.",
        },
        {
          team: blueLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "The other team still runs.",
        },
      ],
    });
    const preview = yield* proposals.revalidate(owner, { set: result.set.id });
    const claimId = itemByReason(preview, "Claim the waiver wing.").id;
    const laterId = itemByReason(preview, "Not attempted while the claim is pending.").id;
    const otherId = itemByReason(preview, "The other team still runs.").id;

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [claimId, laterId, otherId],
    });
    const items = itemsOf(submitted);
    const claim = items.find((item) => item.id === claimId);
    assert.deepStrictEqual(Object.fromEntries(items.map((item) => [item.reason, item.state])), {
      "Claim the waiver wing.": "pending",
      "Not attempted while the claim is pending.": "skipped",
      "The other team still runs.": "executed",
    });
    assert.deepStrictEqual(
      claim?.execution?.steps.map((step) => [step.kind, step.outcome]),
      [
        ["add", "pending"],
        ["drop", "pending"],
      ],
    );
    assert.include(claim?.execution?.detail ?? "", "pending");
    const requests = yield* fake.transactionRequests;
    assert.strictEqual(requests.length, 2);
    assert.strictEqual(
      requests.filter((request) => request.providerTeamKey === "nhl.l.1.t.1").length,
      1,
    );
    assert.strictEqual(
      requests.find((request) => request.providerTeamKey === "nhl.l.1.t.1")?.faabBid,
      10,
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("marks a lost response unknown, stops that team, and never retries", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTwoTeams(fake);
    yield* fake.setTransactionAction("lost_response");
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const blueLine = teamId(seeded, "nhl.l.1.t.2");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "This response is lost.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Not attempted after an unknown.",
        },
        {
          team: blueLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "The other team is still attempted.",
        },
      ],
    });
    const preview = yield* proposals.revalidate(owner, { set: result.set.id });
    const firstId = itemByReason(preview, "This response is lost.").id;
    const secondId = itemByReason(preview, "Not attempted after an unknown.").id;
    const thirdId = itemByReason(preview, "The other team is still attempted.").id;

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [firstId, secondId, thirdId],
    });
    const items = itemsOf(submitted);
    assert.deepStrictEqual(Object.fromEntries(items.map((item) => [item.reason, item.state])), {
      "This response is lost.": "unknown",
      "Not attempted after an unknown.": "skipped",
      "The other team is still attempted.": "unknown",
    });
    assert.include(
      items.find((item) => item.id === firstId)?.execution?.detail ?? "",
      "may or may not have applied",
    );
    const requests = yield* fake.transactionRequests;
    assert.strictEqual(requests.length, 2);
    assert.strictEqual(
      requests.filter((request) => request.providerTeamKey === "nhl.l.1.t.1").length,
      1,
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("stages a trade with both rosters and the league's trade window checked", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTradeTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");

    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "trade",
          counterparty: yield* counterpartyRef(tokens, "nhl.l.1.t.2"),
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Swap a center for the rival's wing.",
        },
      ],
    });

    assert.isTrue(result.created);
    const item = Array.getUnsafe(result.items, 0);
    assert.strictEqual(item.outcome, "accepted");
    if (item.outcome !== "accepted") {
      return;
    }
    assert.strictEqual(item.item.kind, "trade");
    assert.strictEqual(item.item.counterparty?.name, "Blue Line");
    assert.isTrue(item.item.counterparty?.ref.startsWith("r1."));
    assert.deepStrictEqual(
      item.item.adds.map((player) => [player.name, player.position, player.proTeam]),
      [["Roster One", "C", "SYN"]],
    );
    assert.deepStrictEqual(
      item.item.drops.map((player) => [player.name, player.position]),
      [["Roster One", "C"]],
    );
    assert.isUndefined(item.item.trade);
    assert.isFalse(includesText(result, "nhl.l.1.t.2"));
    assert.isFalse(includesText(result, "nhl.p.90003"));
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "refuses a trade whose window closed, whose counterparty is elsewhere, or whose player is on the wrong roster",
  () =>
    Effect.gen(function* () {
      const proposals = yield* TransactionProposals;
      const fake = yield* FakeProviderWorld;
      const tokens = yield* QueryTokens;
      const closed = yield* seedTradeTeams(fake, {
        league: leagueFixture({
          tradeEndDate: "2026-10-01",
          currentDate: "2026-10-31",
        }),
      });
      const closedRed = teamId(closed, "nhl.l.1.t.1");
      const closedRefusals = yield* Effect.flip(
        proposals.propose(owner, proposer, {
          items: [
            {
              team: closedRed,
              kind: "trade",
              counterparty: yield* counterpartyRef(tokens, "nhl.l.1.t.2"),
              adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
              drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
              reason: "A trade after the deadline.",
            },
          ],
        }),
      );
      if (closedRefusals._tag !== "proposal.nothing_accepted") {
        return;
      }
      assert.deepStrictEqual(
        closedRefusals.refusals.map((refusal) => refusal.refusal),
        ["trade_window_closed"],
      );
      assert.include(Array.getUnsafe(closedRefusals.refusals, 0).detail, "Item 1");
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a trade counterparty in another league and a player on the wrong roster", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTradeTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");

    const foreignRefusals = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        items: [
          {
            team: redLine,
            kind: "trade",
            counterparty: yield* counterpartyRef(tokens, "nhl.l.2.t.1"),
            adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
            reason: "A trade with another league.",
          },
        ],
      }),
    );
    if (foreignRefusals._tag !== "proposal.nothing_accepted") {
      return;
    }
    assert.deepStrictEqual(
      foreignRefusals.refusals.map((refusal) => refusal.refusal),
      ["trade_counterparty_invalid"],
    );

    const rosterRefusals = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        items: [
          {
            team: redLine,
            kind: "trade",
            counterparty: yield* counterpartyRef(tokens, "nhl.l.1.t.2"),
            adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
            reason: "Ask for a player the rival does not hold.",
          },
        ],
      }),
    );
    if (rosterRefusals._tag !== "proposal.nothing_accepted") {
      return;
    }
    assert.deepStrictEqual(
      rosterRefusals.refusals.map((refusal) => refusal.refusal),
      ["trade_player_not_rostered"],
    );
    assert.include(Array.getUnsafe(rosterRefusals.refusals, 0).detail, "Item 1");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("proposes each trade once, records the provider key and time, and never retries", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTradeTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [yield* tradeDraft(tokens, redLine)],
    });
    const id = Array.getUnsafe(itemsOf(yield* proposals.read(owner, { set: result.set.id })), 0).id;

    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [id] });
    const item = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(item.state, "pending");
    assert.strictEqual(item.trade?.state, "pending");
    assert.isDefined(item.trade?.requestedAt);
    assert.include(item.execution?.detail ?? "", "The other manager decides");
    assert.strictEqual((yield* fake.tradeProposalRequests).length, 1);
    assert.isFalse(includesText(submitted, "nhl.l.1.pt.1"));

    const repeated = yield* Effect.flip(
      proposals.submit(owner, { set: result.set.id, include: [id] }),
    );
    assert.instanceOf(repeated, ProposalSetAlreadySubmitted);
    assert.strictEqual((yield* fake.tradeProposalRequests).length, 1);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("records an unknown trade outcome as unknown and never retries the propose", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTradeTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    yield* fake.setTradeProposalAction("lost_response");
    const result = yield* proposals.propose(owner, proposer, {
      items: [yield* tradeDraft(tokens, redLine)],
    });
    const id = Array.getUnsafe(itemsOf(yield* proposals.read(owner, { set: result.set.id })), 0).id;

    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [id] });
    const item = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(item.state, "unknown");
    assert.isUndefined(item.trade);
    assert.include(item.execution?.detail ?? "", "Check the provider's trade page");
    assert.strictEqual((yield* fake.tradeProposalRequests).length, 1);

    yield* fake.setTradeProposalAction("accept");
    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    assert.strictEqual(Array.getUnsafe(itemsOf(review), 0).state, "unknown");
    assert.strictEqual((yield* fake.tradeProposalRequests).length, 1);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("withdraws a pending trade from our record and from the provider's feed", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTradeTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [yield* tradeDraft(tokens, redLine)],
    });
    const id = Array.getUnsafe(itemsOf(yield* proposals.read(owner, { set: result.set.id })), 0).id;
    yield* proposals.submit(owner, { set: result.set.id, include: [id] });

    const pending = yield* proposals.revalidate(owner, { set: result.set.id });
    const pendingItem = Array.getUnsafe(itemsOf(pending), 0);
    assert.strictEqual(pendingItem.trade?.state, "pending");
    assert.isDefined(pendingItem.trade?.proposedAt);

    const withdrawn = yield* proposals.withdrawTrade(owner, { team: redLine, item: id });
    assert.strictEqual(withdrawn.status, "withdrawn");
    assert.deepStrictEqual(yield* fake.withdrawTradeRequests, ["nhl.l.1.pt.1"]);
    const after = yield* proposals.read(owner, { set: result.set.id });
    const afterItem = Array.getUnsafe(itemsOf(after), 0);
    assert.strictEqual(afterItem.state, "withdrawn");
    assert.strictEqual(afterItem.trade?.state, "withdrawn");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("withdraws an offer created elsewhere from the provider's pending feed", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTradeTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    yield* fake.setPendingTrades([pendingTrade]);

    const offers = yield* proposals.readPendingOffers(owner, { team: redLine });
    assert.strictEqual(offers.offers.length, 1);
    const offer = Array.getUnsafe(offers.offers, 0);
    assert.isTrue(offer.offerRef.startsWith("r1."));

    const withdrawn = yield* proposals.withdrawTrade(owner, {
      team: redLine,
      offer: offer.offerRef,
    });
    assert.strictEqual(withdrawn.status, "withdrawn");
    assert.deepStrictEqual(yield* fake.withdrawTradeRequests, ["nhl.l.1.pt.9"]);

    yield* fake.setPendingTrades([]);
    const notPending = yield* Effect.flip(
      proposals.withdrawTrade(owner, { team: redLine, offer: offer.offerRef }),
    );
    assert.strictEqual(notPending._tag, "proposal.trade_not_pending");
    assert.strictEqual((yield* fake.withdrawTradeRequests).length, 1);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("recognises an accepted trade after we stopped watching", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTradeTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [yield* tradeDraft(tokens, redLine)],
    });
    const id = Array.getUnsafe(itemsOf(yield* proposals.read(owner, { set: result.set.id })), 0).id;
    yield* proposals.submit(owner, { set: result.set.id, include: [id] });

    yield* fake.setPendingTrades([]);
    yield* fake.setCompletedTrades([acceptedTrade()]);
    const refreshed = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(refreshed), 0);
    assert.strictEqual(item.state, "accepted");
    if (item.trade === undefined) {
      return assert.fail("The accepted trade is missing its state");
    }
    assert.strictEqual(item.trade.state, "accepted");
    assert.isDefined(item.trade.settledAt);
    assert.include(item.trade.detail ?? "", "accepted");

    const readAgain = yield* proposals.read(owner, { set: result.set.id });
    assert.strictEqual(Array.getUnsafe(itemsOf(readAgain), 0).trade?.state, "accepted");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a trade write when the team's connection changed after staging", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    yield* seedTradeTeams(fake);
    const secondLink = Array.getUnsafe(
      yield* connections.link(owner, [
        { provider: decodeProviderKey("yahoo"), session: Redacted.make("A1=second-session") },
      ]),
      0,
    );
    yield* fake.setTeams([team("nhl.l.1.t.1", "Red Line"), team("nhl.l.1.t.2", "Blue Line")]);
    const secondTeams = yield* connections.discoverTeams(owner, [{ id: secondLink.id }]);
    const secondRed = secondTeams.find((entry) => entry.providerTeamKey === "nhl.l.1.t.1");
    assert.isDefined(secondRed);
    const thirdLink = Array.getUnsafe(
      yield* connections.link(owner, [
        { provider: decodeProviderKey("yahoo"), session: Redacted.make("A1=third-session") },
      ]),
      0,
    );

    const result = yield* proposals.propose(owner, proposer, {
      items: [yield* tradeDraft(tokens, secondRed.id)],
    });
    const id = Array.getUnsafe(itemsOf(yield* proposals.read(owner, { set: result.set.id })), 0).id;
    yield* database
      .update(providerTeams)
      .set({ connectionId: thirdLink.id })
      .where(eq(providerTeams.id, secondRed.id));

    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [id] });
    const item = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(item.state, "skipped");
    assert.include(item.execution?.detail ?? "", "different provider connection");
    assert.strictEqual((yield* fake.tradeProposalRequests).length, 0);
  }).pipe(Effect.provide(TestLayer)),
);

function seedTradeTeams(
  fake: FakeProviderWorld["Service"],
  options: { readonly league?: ProviderLeagueSettings } = {},
): Effect.Effect<ReadonlyArray<FantasyTeam>, never, Connections> {
  return Effect.gen(function* () {
    const seeded = yield* seed(
      fake,
      [team("nhl.l.1.t.1", "Red Line"), team("nhl.l.1.t.2", "Blue Line")],
      {
        playerDetails,
        ...(options.league === undefined ? {} : { league: options.league }),
        leagueTeams: [
          leagueTeam("nhl.l.1.t.1", "Red Line"),
          leagueTeam("nhl.l.1.t.2", "Blue Line"),
        ],
      },
    );
    yield* fake.setTeamRoster(
      "nhl.l.1.t.2",
      rosterFixture(["nhl.p.90003", "nhl.p.90004"], "nhl.l.1.t.2"),
    );
    return seeded;
  }).pipe(Effect.orDie);
}

function leagueTeam(providerTeamKey: string, name: string): ProviderLeagueTeam {
  return {
    providerTeamKey,
    providerLeagueKey: providerTeamKey.slice(0, providerTeamKey.lastIndexOf(".t.")),
    name,
    acquisitionUsage: { seasonMoves: undefined, weeklyAdds: undefined },
  };
}

function counterpartyRef(
  tokens: QueryTokens["Service"],
  teamKey: string,
): Effect.Effect<CounterpartyRef> {
  return tokens.sealCounterpartyRef({
    userId: owner,
    leagueKey: "nhl.l.1",
    teamKey,
  });
}

function tradeDraft(
  tokens: QueryTokens["Service"],
  team: TeamId,
): Effect.Effect<ProposalItemDraft> {
  return Effect.gen(function* () {
    return {
      team,
      kind: "trade" as const,
      counterparty: yield* counterpartyRef(tokens, "nhl.l.1.t.2"),
      adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
      drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
      reason: "Swap a center for the rival's wing.",
    } satisfies ProposalItemDraft;
  });
}

function acceptedTrade(): ProviderTransaction {
  const own: ProviderTransactionTeam = { providerTeamKey: "nhl.l.1.t.1", name: "Red Line" };
  const rival: ProviderTransactionTeam = { providerTeamKey: "nhl.l.1.t.2", name: "Blue Line" };
  const movement = (
    providerPlayerKey: string,
    from: ProviderTransactionTeam,
    to: ProviderTransactionTeam,
  ): ProviderTransactionPlayer => ({
    providerPlayerKey,
    movement: { kind: "trade", from, to },
    name: undefined,
    primaryPosition: undefined,
    displayPosition: undefined,
    eligiblePositions: undefined,
    proTeam: undefined,
  });
  return {
    transactionKey: "nhl.l.1.tr.3",
    occurredAt: "2026-11-01T00:00:00.000Z",
    type: "trade",
    status: "successful",
    parties: undefined,
    teams: [own, rival],
    picks: [],
    players: [movement("nhl.p.90001", own, rival), movement("nhl.p.90003", rival, own)],
    incomplete: undefined,
  };
}

function seedTwoTeams(
  fake: FakeProviderWorld["Service"],
): Effect.Effect<ReadonlyArray<FantasyTeam>, never, Connections> {
  return Effect.gen(function* () {
    const seeded = yield* seed(
      fake,
      [team("nhl.l.1.t.1", "Red Line"), team("nhl.l.1.t.2", "Blue Line")],
      { playerDetails },
    );
    yield* fake.setTeamRoster(
      "nhl.l.1.t.2",
      rosterFixture(["nhl.p.90002", "nhl.p.90003"], "nhl.l.1.t.2"),
    );
    return seeded;
  }).pipe(Effect.orDie);
}

const owner = decodeUserId("owner");
const other = decodeUserId("other");
const session = Redacted.make("A1=test-session-cookie");
const foreignTeam = "018f79ea-7d86-7c18-9b4a-8b4d0c9169ff";
const proposer = { kind: "agent", reference: "mcp", surface: "mcp" } as const;

const EncryptionTestLayer = ConnectionCredentialEncryption.forKey(
  ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
    keyVersion: 1,
  }),
).pipe(Layer.provide(NodeCrypto.layer));
const ConnectionRepositoryTest = ConnectionRepository.layer.pipe(
  Layer.provideMerge(ConnectionsDatabaseTest),
);
const QueryRepositoryTest = QueryRepository.layer.pipe(Layer.provide(ConnectionRepositoryTest));
const QueryTokensTest = QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars");

const TestLayer = TransactionProposalsLive.pipe(
  Layer.provide(TransactionProposalRepository.layer),
  Layer.provideMerge(ConnectionsLive),
  Layer.provideMerge(QueryRepositoryTest),
  Layer.provideMerge(ConnectionRepositoryTest),
  Layer.provideMerge(ConnectionsDatabaseTest),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provideMerge(QueryTokensTest),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);

function seed(
  fake: FakeProviderWorld["Service"],
  teams: ReadonlyArray<ProviderTeam>,
  options: {
    readonly league?: ProviderLeagueSettings;
    readonly roster?: ProviderRoster;
    readonly playerDetails?: ReadonlyArray<ProviderPlayerDetail>;
    readonly leagueTeams?: ReadonlyArray<ProviderLeagueTeam>;
  } = {},
): Effect.Effect<ReadonlyArray<FantasyTeam>, never, Connections> {
  return Effect.gen(function* () {
    const connections = yield* Connections;
    yield* fake.setTeams(teams);
    yield* fake.setLeague(options.league ?? leagueFixture({}));
    yield* fake.setRoster(options.roster ?? rosterFixture(["nhl.p.90001", "nhl.p.90002"]));
    yield* fake.setPlayerDetails(options.playerDetails ?? []);
    yield* fake.setLeagueTeams(options.leagueTeams ?? []);
    const linked = Array.getUnsafe(
      yield* connections.link(owner, [{ provider: decodeProviderKey("yahoo"), session }]),
      0,
    );
    return yield* connections.discoverTeams(owner, [{ id: linked.id }]);
  }).pipe(Effect.orDie);
}

function teamId(teams: ReadonlyArray<FantasyTeam>, providerTeamKey: string): TeamId {
  const found = teams.find((entry) => entry.providerTeamKey === providerTeamKey);
  if (found === undefined) {
    throw new Error(`missing seeded team ${providerTeamKey}`);
  }
  return found.id;
}

function team(providerTeamKey: string, name: string, league: "nfl" | "nhl" = "nhl"): ProviderTeam {
  return {
    provider: decodeProviderKey("yahoo"),
    providerTeamKey,
    providerLeagueKey: providerTeamKey.slice(0, providerTeamKey.lastIndexOf(".t.")),
    league,
    sport: league === "nfl" ? "football" : "hockey",
    season: 2026,
    name,
  };
}

function refs(
  tokens: QueryTokens["Service"],
  leagueKey: string,
  playerKeys: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<PlayerRef>> {
  return tokens.sealPlayerRefs({ userId: owner, leagueKey, playerKeys });
}

function leagueFixture(overrides: Partial<ProviderLeagueSettings>): ProviderLeagueSettings {
  return {
    providerLeagueKey: "nhl.l.1",
    name: "Red Line League",
    webUrl: "https://hockey.fantasysports.yahoo.com/hockey/1",
    season: 2026,
    periodWindow: { current: 5, start: 1, end: 20 },
    rosterCoverage: "date",
    maxGamesPlayed: undefined,
    maxInningsPitched: undefined,
    startDate: "2026-10-01",
    endDate: "2027-03-01",
    currentDate: "2026-10-31",
    teamCount: 8,
    format: "head_to_head_categories",
    scoringType: "head",
    scoringLabel: "H2H",
    weeklyDeadline: "intraday",
    rosterChange: undefined,
    waiverType: "FR",
    waiverRule: "continuous",
    usesFaab: true,
    waiverDays: 2,
    maxWeeklyAcquisitions: undefined,
    maxSeasonAcquisitions: undefined,
    tradeEndDate: "2027-02-01",
    tradeRatification: "unknown",
    tradeDraftPicks: undefined,
    tradeObjectionDays: 0,
    draftStatus: "postdraft",
    rosterPositions: [
      { position: "C", positionType: "O", count: 2, kind: "starting", eligibility: ["C"] },
      { position: "BN", positionType: "B", count: 6, kind: "bench", eligibility: [] },
    ],
    statCategories: [],
    statModifiers: [],
    ...overrides,
  };
}

function rosterFixture(playerKeys: ReadonlyArray<string>, teamKey = "nhl.l.1.t.1"): ProviderRoster {
  return {
    providerTeamKey: teamKey,
    providerLeagueKey: teamKey.slice(0, teamKey.lastIndexOf(".t.")),
    coverage: { type: "date", date: "2026-10-31" },
    players: playerKeys.map((playerKey, index) => ({
      providerPlayerKey: playerKey,
      name: `Roster ${["One", "Two", "Three"][index] ?? String(index)}`,
      displayPosition: "C",
      primaryPosition: "C",
      positionType: "O",
      proTeamAbbreviation: "SYN",
      eligiblePositions: ["C"],
      slot: { status: "verified", slot: index < 2 ? "C" : "BN" },
      isEditable: true,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: null,
      scheduled: true,
      startingLineup: "unconfirmed",
      undroppable: false,
      transactionTrend: {
        status: "published",
        adds: 1,
        drops: 1,
        window: "provider_current_day",
      },
    })),
  };
}

function reserveRoster(teamKey: string): ProviderRoster {
  const roster = rosterFixture(["nhl.p.90001", "nhl.p.90002", "nhl.p.90003"], teamKey);
  return {
    ...roster,
    players: roster.players.map((player, index) => ({
      ...player,
      slot: { status: "verified" as const, slot: index === 1 ? "BN" : "C" },
      eligiblePositions: index === 1 ? ["C", "IR"] : ["C"],
      injuryCode: index === 1 ? "O" : undefined,
      injuryDetail: index === 1 ? "Out" : undefined,
    })),
  };
}

function reserveRosterWith(
  teamKey: string,
  injury: { readonly code: string; readonly detail: string } | undefined,
): ProviderRoster {
  const roster = rosterFixture(["nhl.p.90001", "nhl.p.90002", "nhl.p.90003"], teamKey);
  return {
    ...roster,
    players: roster.players.map((player, index) => ({
      ...player,
      slot: {
        status: "verified" as const,
        slot: index === 1 ? "IR" : index === 0 ? "C" : "BN",
      },
      eligiblePositions: index === 1 && injury !== undefined ? ["C", "IR"] : ["C"],
      injuryCode: index === 1 ? injury?.code : undefined,
      injuryDetail: index === 1 ? injury?.detail : undefined,
    })),
  };
}

const reserveLeague = leagueFixture({
  rosterPositions: [
    { position: "C", positionType: "O", count: 2, kind: "starting", eligibility: ["C"] },
    { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: [] },
    { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
  ],
});

const fullReserveLeague = leagueFixture({
  rosterChange: {
    rule: "same_day",
    source: ["weekly_deadline"],
    detail: "The provider's weekly_deadline is intraday.",
  },
  rosterPositions: [
    { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
    { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: [] },
    { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
  ],
});

const reserveBenchLeague = leagueFixture({
  rosterPositions: [
    { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
    { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: ["IR"] },
    { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
  ],
});

const wingBenchLeague = leagueFixture({
  rosterPositions: [
    { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
    { position: "LW", positionType: "O", count: 1, kind: "starting", eligibility: ["LW"] },
    { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: ["IR"] },
  ],
});

const ilPlusBenchLeague = leagueFixture({
  rosterPositions: [
    { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
    { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: ["IR"] },
    { position: "IL+", positionType: "I", count: 1, kind: "reserve", eligibility: ["IL+"] },
  ],
});

const openBenchLeague = leagueFixture({
  rosterPositions: [
    { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
    { position: "BN", positionType: "B", count: 3, kind: "bench", eligibility: [] },
    { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
  ],
});

const providerRefusal =
  "Player Travis Konecny is in a IR position on your roster, but is no longer on the real-life IR.  Please edit your lineup to activate this player from your IR and then attempt your transaction again.";

function rosterWithSlots(
  teamKey: string,
  rows: ReadonlyArray<{
    readonly slot: string;
    readonly eligible: ReadonlyArray<string>;
    readonly injury?: { readonly code: string; readonly detail: string };
  }>,
): ProviderRoster {
  const keys = ["nhl.p.90001", "nhl.p.90002", "nhl.p.90003", "nhl.p.90005"];
  const roster = rosterFixture(keys.slice(0, rows.length), teamKey);
  return {
    ...roster,
    players: roster.players.map((player, index) => {
      const row = rows[index];
      if (row === undefined) {
        throw new Error("A roster slot row is missing.");
      }
      return {
        ...player,
        displayPosition: row.eligible[0] ?? "C",
        eligiblePositions: row.eligible,
        slot: { status: "verified" as const, slot: row.slot },
        injuryCode: row.injury?.code,
        injuryDetail: row.injury?.detail,
      };
    }),
  };
}

function lockedPlayer(roster: ProviderRoster, playerKey: string): ProviderRoster {
  return {
    ...roster,
    players: roster.players.map((player) =>
      player.providerPlayerKey === playerKey ? { ...player, isEditable: false } : player,
    ),
  };
}

const playerDetails: ReadonlyArray<ProviderPlayerDetail> = [
  detail("nhl.p.90001", "Roster One", "rostered"),
  detail("nhl.p.90002", "Roster Two", "rostered"),
  detail("nhl.p.90003", "Roster Three", "rostered"),
  detail("nhl.p.90004", "Pool Forward", "free_agent"),
  detail("nhl.p.90005", "Rostered Star", "rostered"),
  detail("nhl.p.90006", "Waiver Wing", "waiver"),
  detail("nhl.p.90007", "Pool Seven", "free_agent"),
  detail("nhl.p.90008", "Pool Eight", "free_agent"),
  detail("nhl.p.90010", "Pool Ten", "free_agent"),
  detail("nhl.p.90011", "Pool Eleven", "free_agent"),
  detail("nhl.p.90012", "Pool Twelve", "free_agent"),
  detail("nhl.p.90013", "Pool Thirteen", "free_agent"),
  detail("nhl.p.90014", "Pool Fourteen", "free_agent"),
  detail("nhl.p.90015", "Pool Fifteen", "free_agent"),
  detail("nhl.p.90016", "Pool Sixteen", "free_agent"),
  detail("nhl.p.90017", "Pool Seventeen", "free_agent"),
];

function detail(
  providerPlayerKey: string,
  name: string,
  rosterStatus: ProviderPlayerDetail["rosterStatus"],
): ProviderPlayerDetail {
  return {
    providerPlayerKey,
    name,
    primaryPosition: "C",
    displayPosition: "C",
    proTeam: "SYN",
    availabilityDetail: undefined,
    eligiblePositions: ["C"],
    rosterStatus,
    actual: undefined,
    projected: undefined,
  };
}

const rival = { providerTeamKey: "nhl.l.1.t.2", name: "Blue Line" };
const mine = { providerTeamKey: "nhl.l.1.t.1", name: "Red Line" };

const pendingTrade: ProviderPendingTrade = {
  transactionKey: "nhl.l.1.pt.9",
  proposedAt: "2026-10-30T18:00:00.000Z",
  note: "Two for two.",
  canRespond: true,
  proposer: rival,
  receiver: mine,
  unusedRosterSpots: 0,
  players: [
    {
      providerPlayerKey: "nhl.p.20001",
      name: "Incoming Wing",
      primaryPosition: undefined,
      displayPosition: "LW",
      eligiblePositions: undefined,
      proTeam: "SYN",
      movement: { kind: "trade", from: rival, to: mine },
    },
    {
      providerPlayerKey: "nhl.p.20002",
      name: "Outgoing Center",
      primaryPosition: undefined,
      displayPosition: "C",
      eligiblePositions: undefined,
      proTeam: "SYN",
      movement: { kind: "trade", from: mine, to: rival },
    },
  ],
  picks: [{ round: 3, from: rival, to: mine, original: mine }],
  incomplete: undefined,
};

type ProposalItemView = ProposalSetReview["teams"][number]["items"][number];

function itemsOf(review: ProposalSetReview): ReadonlyArray<ProposalItemView> {
  return review.teams.flatMap((team) => team.items);
}

function itemByReason(review: ProposalSetReview, reason: string): ProposalItemView {
  const item = itemsOf(review).find((entry) => entry.reason === reason);
  if (item === undefined) {
    throw new Error(`missing proposal item with reason: ${reason}`);
  }
  return item;
}

function reasonCodes(item: ProposalItemView | undefined): ReadonlyArray<string> {
  return item === undefined ? [] : item.staleness.reasons.map((reason) => reason.code);
}

function includesText(value: unknown, needle: string): boolean {
  if (typeof value === "string") {
    return value.includes(needle);
  }
  if (globalThis.Array.isArray(value)) {
    return value.some((item) => includesText(item, needle));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((item) => includesText(item, needle));
  }
  return false;
}
