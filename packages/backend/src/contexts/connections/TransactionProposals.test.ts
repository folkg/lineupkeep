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
import { providerTeamAgentNotes, providerTeams } from "./internal/ConnectionTables.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { QueryTokens } from "./internal/QueryTokens.ts";
import { declaredRosterConstraints } from "./internal/RosterConstraintsTest.ts";
import { TransactionProposalRepository } from "./internal/TransactionProposalRepository.ts";
import { TransactionProposalsLive } from "./internal/TransactionProposalsLive.ts";
import {
  transactionProposalItems,
  transactionProposalSets,
} from "./internal/TransactionProposalTables.ts";
import type {
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderPendingTrade,
  ProviderPlayerDetail,
  ProviderRoster,
  ProviderRosterPosition,
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
  ProposalItemsNotWithdrawable,
  ProposalNothingIncluded,
  ProposalSetAlreadySubmitted,
  ProposalSetExpired,
  ProposalSetNotFound,
  ProposalSetReview,
  TransactionProposals,
  proposalSetLifetimeMillis,
} from "./TransactionProposals.ts";

const lineupgradeUlid = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

it.effect("stores an owner-scoped proposal set after checking it against current state", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(
      fake,
      [
        team("nhl.l.1.t.1", "Red Line"),
        team("nhl.l.1.t.2", "Blue Line"),
        team("nhl.l.1.t.3", "Grid"),
      ],
      { playerDetails },
    );

    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: teamId(seeded, "nhl.l.1.t.1"),
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Cover the light night at center.",
        },
      ],
    });

    assert.isTrue(result.created);
    assert.isFalse(result.extended);
    assert.strictEqual(result.set.expired, false);
    assert.strictEqual(result.set.proposedBy.kind, "agent");
    assert.strictEqual(result.set.proposedBy.surface, "mcp");
    assert.isTrue(lineupgradeUlid.test(result.set.id));
    assert.strictEqual(result.set.reviewPath, `/transactions/${result.set.id}`);
    assert.deepStrictEqual(result.refused, []);
    assert.strictEqual(result.items.length, 1);
    const first = result.items[0];
    assert.strictEqual(first?.position, 1);
    assert.strictEqual(first?.outcome, "accepted");
    if (first !== undefined) {
      assert.strictEqual(first.item.state, "proposed");
      assert.strictEqual(first.item.staleness.status, "current");
      assert.isDefined(first.item.staleness.checkedAt);
      assert.strictEqual(first.item.bid, undefined);
      assert.strictEqual(first.item.adds[0]?.name, "Pool Forward");
    }

    assert.deepStrictEqual(yield* fake.rosterPeriods, [{ type: "date", date: "2026-10-31" }]);
    assert.strictEqual(yield* fake.nativeCallCount, 0);
    assert.strictEqual(yield* fake.explicitCallCount, 0);

    const review = yield* proposals.read(owner, { set: result.set.id });
    assert.deepStrictEqual(
      Object.fromEntries(review.teams.map((entry) => [entry.team.name, entry.items.length])),
      { Grid: 0, "Blue Line": 0, "Red Line": 1 },
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
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], { playerDetails });
    const add = yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]);

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
        nothing.refusals.map((refusal) => [refusal.position, refusal.refusal]),
        [
          [1, "team_not_owned"],
          [2, "team_not_owned"],
        ],
      );
      assert.include(nothing.refusals[0]?.reason, "Item 1");
      assert.isNotEmpty(nothing.refusals[0]?.fix ?? "");
    }
    const database = yield* ConnectionsDatabase;
    assert.strictEqual(
      (yield* database.select({ id: transactionProposalSets.id }).from(transactionProposalSets))
        .length,
      0,
    );
    assert.strictEqual(
      (yield* database.select({ id: transactionProposalItems.id }).from(transactionProposalItems))
        .length,
      0,
    );

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
    assert.isFalse(repeated.extended);
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
    assert.strictEqual(duplicated.items.length, 1);
    const refused = duplicated.refused[0];
    assert.strictEqual(refused?.position, 2);
    assert.strictEqual(refused?.refusal, "duplicate_item");
    assert.include(refused?.reason, "item 1");
    assert.isNotEmpty(refused?.fix ?? "");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "stores the valid item and refuses the impossible ones with a position, reason, and fix",
  () =>
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

      assert.deepStrictEqual(
        result.items.map((item) => [item.position, item.item.reason]),
        [[1, "Swap one center for another."]],
      );
      assert.deepStrictEqual(
        result.refused.map((refusal) => [refusal.position, refusal.refusal]),
        [
          [2, "player_unavailable"],
          [3, "drop_not_rostered"],
          [4, "roster_full"],
          [5, "bid_exceeds_budget"],
        ],
      );
      for (const refusal of result.refused) {
        assert.isNotEmpty(refusal.reason);
        assert.isNotEmpty(refusal.fix);
        assert.notInclude(refusal.reason, "undefined");
      }

      const database = yield* ConnectionsDatabase;
      const rows = yield* database
        .select({ id: transactionProposalItems.id })
        .from(transactionProposalItems);
      assert.strictEqual(rows.length, 1);

      const review = yield* proposals.read(owner, { set: result.set.id });
      const stored = itemsOf(review);
      assert.deepStrictEqual(
        stored.map((item) => item.reason),
        ["Swap one center for another."],
      );
      const first = Array.getUnsafe(stored, 0);
      assert.strictEqual(first.state, "proposed");
      assert.strictEqual(first.staleness.status, "current");
      assert.isDefined(first.staleness.checkedAt);
      assert.strictEqual(first.adds[0]?.name, "Pool Forward");
      assert.strictEqual(first.adds[0]?.position, "C");
      assert.strictEqual(first.adds[0]?.proTeam, "SYN");
      assert.strictEqual(first.adds[0]?.availability, "Free agent");
      assert.strictEqual(first.drops[0]?.name, "Roster One");
      assert.strictEqual(first.drops[0]?.position, "C");
      assert.strictEqual(first.drops[0]?.proTeam, "SYN");
      assert.strictEqual(first.drops[0]?.availability, undefined);
      assert.deepStrictEqual(yield* fake.rosterPeriods, [{ type: "date", date: "2026-10-31" }]);
    }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "refuses a drop that leaves an illegal reserve slot and names the player and the choice",
  () =>
    Effect.gen(function* () {
      const proposals = yield* TransactionProposals;
      const fake = yield* FakeProviderWorld;
      const tokens = yield* QueryTokens;
      const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
        league: noBenchReserveLeague,
        roster: rosterWithSlots("nhl.l.1.t.1", [
          { slot: "C", eligible: ["C"] },
          { slot: "IR", eligible: ["LW"] },
        ]),
        playerDetails,
      });
      const redLine = teamId(seeded, "nhl.l.1.t.1");
      const refused = yield* Effect.flip(
        proposals.propose(owner, proposer, {
          items: [
            {
              team: redLine,
              kind: "drop",
              adds: [],
              drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
              reason: "Drop the center.",
            },
          ],
        }),
      );
      assert.strictEqual(refused._tag, "proposal.nothing_accepted");
      if (refused._tag === "proposal.nothing_accepted") {
        const refusal = Array.getUnsafe(refused.refusals, 0);
        assert.strictEqual(refusal.position, 1);
        assert.strictEqual(refusal.refusal, "slot_illegal");
        assert.include(refusal.reason, "Roster Two");
        assert.include(refusal.reason, "IR");
        assert.include(refusal.reason, "Choosing which player to drop is yours");
        assert.isNotEmpty(refusal.fix);
      }
      assert.deepStrictEqual(yield* fake.transactionRequests, []);
      assert.deepStrictEqual(yield* fake.reserveRequests, []);
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a drop that leaves an illegal starting slot and names the slot", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: noBenchWingLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "LW", eligible: ["RW"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        items: [
          {
            team: redLine,
            kind: "drop",
            adds: [],
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
            reason: "Drop the center.",
          },
        ],
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      const refusal = Array.getUnsafe(refused.refusals, 0);
      assert.strictEqual(refusal.refusal, "slot_illegal");
      assert.include(refusal.reason, "Roster Two");
      assert.include(refusal.reason, "LW");
      assert.include(refusal.reason, "does not accept their positions");
      assert.isNotEmpty(refusal.fix);
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses a drop that leaves an illegal slot named IL+", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: noBenchIlPlusLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "IL+", eligible: ["RW"] },
      ]),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        items: [
          {
            team: redLine,
            kind: "drop",
            adds: [],
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
            reason: "Drop the center.",
          },
        ],
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      const refusal = Array.getUnsafe(refused.refusals, 0);
      assert.strictEqual(refusal.refusal, "slot_illegal");
      assert.include(refusal.reason, "Roster Two");
      assert.include(refusal.reason, "IL+");
    }
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

    const item = Array.getUnsafe(result.items, 0);
    assert.strictEqual(item.item.staleness.status, "current");
    assert.strictEqual(item.item.reserveMove?.player.name, "Roster Two");
    assert.strictEqual(item.item.reserveMove?.fromSlot, "IR");
    assert.strictEqual(item.item.reserveMove?.toSlot, "BN");

    const read = yield* proposals.read(owner, { set: result.set.id });
    const readItem = Array.getUnsafe(itemsOf(read), 0);
    assert.strictEqual(readItem.reserveMove?.player.name, "Roster Two");
    assert.strictEqual(readItem.reserveMove?.fromSlot, "IR");
    assert.strictEqual(readItem.reserveMove?.toSlot, "BN");

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [readItem.id],
    });
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
    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        items: [
          {
            team: redLine,
            kind: "free_agent_add",
            adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
            reason: "Swap a bench center for a better one.",
          },
        ],
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      const refusal = Array.getUnsafe(refused.refusals, 0);
      assert.strictEqual(refusal.refusal, "slot_illegal");
      assert.include(refusal.reason, "Choosing which player to drop is yours");
      assert.isNotEmpty(refusal.fix);
    }
    assert.deepStrictEqual(yield* fake.reserveRequests, []);
    assert.deepStrictEqual(yield* fake.transactionRequests, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("keeps a valid proposal current until the pool changes under it", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({}),
      roster: rosterFixture(["nhl.p.90001", "nhl.p.90002"]),
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
          reason: "Add a center from the pool.",
        },
      ],
    });
    assert.strictEqual(Array.getUnsafe(result.items, 0).item.staleness.status, "current");

    yield* fake.setPlayerDetails(
      playerDetails.filter((entry) => entry.providerPlayerKey !== "nhl.p.90004"),
    );

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

it.effect("refuses a closed period, a missing budget, and an unreadable team per item", () =>
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
    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
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
      }),
    );

    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      assert.deepStrictEqual(
        refused.refusals.map((refusal) => [refusal.position, refusal.refusal]),
        [
          [1, "period_closed"],
          [2, "state_unavailable"],
        ],
      );
      const closed = Array.getUnsafe(refused.refusals, 0);
      assert.include(closed.reason, "period ended");
      assert.include(closed.reason, "does not use a FAAB waiver budget");
      assert.include(closed.fix, "next period");
      const unreadable = Array.getUnsafe(refused.refusals, 1);
      assert.include(unreadable.reason, "provider read failed");
      assert.isNotEmpty(unreadable.fix);
      assert.include(refused.detail, "no set was stored");
    }
    assert.deepStrictEqual(yield* fake.transactionRequests, []);
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

    const reads = (yield* fake.rosterPeriods).length;
    yield* TestClock.adjust(proposalSetLifetimeMillis);
    const expired = yield* Effect.flip(proposals.revalidate(owner, { set: result.set.id }));
    assert.instanceOf(expired, ProposalSetExpired);
    assert.strictEqual((yield* fake.rosterPeriods).length, reads);

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
    const redLine = seeded.find((entry) => entry.providerTeamKey === "nhl.l.1.t.1");
    if (redLine === undefined) {
      throw new Error("The seeded Red Line team is missing");
    }
    yield* database
      .update(providerTeams)
      .set({ ownerNote: note, ownerNoteUpdatedAt: DateTime.toDateUtc(writtenAt) })
      .where(eq(providerTeams.id, redLine.id));
    const noteWrittenAt = DateTime.makeUnsafe("2026-10-31T09:00:00.000Z");
    yield* database.insert(providerTeamAgentNotes).values({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      teamId: redLine.id,
      connectionId: redLine.connectionId,
      userId: owner,
      body: "The manager wants to move a goalie before the deadline.",
      authorName: "Trade Agent",
      authorClientId: "client-trade-agent",
      writtenAt: DateTime.toDateUtc(noteWrittenAt),
    });

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
    assert.deepStrictEqual(read.agentNotes, [
      {
        author: { clientId: "client-trade-agent", name: "Trade Agent" },
        body: "The manager wants to move a goalie before the deadline.",
        writtenAt: noteWrittenAt,
      },
    ]);
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
    assert.strictEqual(unsupported.agentNotes.length, 1);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("reports only the pending offers this team is a party to", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [
      team("nhl.l.1.t.1", "Red Line"),
      team("nhl.l.1.t.2", "Blue Line"),
    ]);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    yield* fake.setPendingTrades([pendingTrade, foreignPendingTrade]);

    const read = yield* proposals.readPendingOffers(owner, { team: redLine });
    assert.strictEqual(read.status, "available");
    assert.deepStrictEqual(
      read.offers.map((offer) => offer.proposingTeam?.name),
      ["Blue Line"],
    );
    assert.isFalse(includesText(read, "Third Line"));

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
    assert.deepStrictEqual(
      Object.fromEntries(
        review.teams.map((entry) => [entry.team.name, entry.pendingOffers.length]),
      ),
      { "Red Line": 1, "Blue Line": 1 },
    );
    assert.isFalse(
      review.teams.some((entry) =>
        entry.pendingOffers.some((offer) => offer.proposingTeam?.name === "Third Line"),
      ),
    );
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
          "Left out by the person.": "proposed",
          "This other team still submits.": "executed",
        },
      );
      assert.strictEqual(submitted.set.submissions.length, 1);
      assert.strictEqual(submitted.set.submissions[0]?.completedAt !== undefined, true);
      assert.strictEqual(submitted.set.settled, false);
      const staleItem = submittedItems.find((item) => item.id === stale);
      assert.include(staleItem?.execution?.detail ?? "", "already rostered in this league");
      const excludedItem = submittedItems.find((item) => item.id === excluded);
      assert.isUndefined(excludedItem?.execution);
      assert.isFalse(excludedItem?.settled);
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
      assert.strictEqual(read.set.submissions[0]?.completedAt !== undefined, true);
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
          "Left out by the person.": "proposed",
          "This other team still submits.": "executed",
        },
      );
      assert.strictEqual((yield* fake.rosterPeriods).length, readsBeforeRevalidate + 1);
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

it.effect("replaces a failed move in the same set and sends only the replacement next", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(
      fake,
      [team("nhl.l.1.t.1", "Red Line"), team("nhl.l.1.t.2", "Blue Line")],
      {
        playerDetails,
        roster: rosterFixture(["nhl.p.90001", "nhl.p.90002"], "nhl.l.1.t.1"),
      },
    );
    yield* fake.setTeamRoster(
      "nhl.l.1.t.2",
      rosterFixture(["nhl.p.90003", "nhl.p.90004"], "nhl.l.1.t.2"),
    );
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const blueLine = teamId(seeded, "nhl.l.1.t.2");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Drop the first center.",
        },
        {
          team: blueLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "Drop their first center.",
        },
      ],
    });
    const preview = yield* proposals.revalidate(owner, { set: result.set.id });
    const firstId = itemByReason(preview, "Drop the first center.").id;
    const failedId = itemByReason(preview, "Drop their first center.").id;

    yield* fake.setTeamTransactionAction("nhl.l.1.t.2", "reject");
    yield* fake.setTransactionAction("accept", "That player is locked for this week.");
    const first = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [firstId, failedId],
    });
    const firstItems = itemsOf(first);
    assert.strictEqual(firstItems.find((item) => item.id === firstId)?.state, "executed");
    const failed = firstItems.find((item) => item.id === failedId);
    assert.strictEqual(failed?.state, "failed");
    assert.strictEqual(failed?.settled, false);
    assert.include(failed?.execution?.detail ?? "", "That player is locked for this week.");
    assert.strictEqual(first.set.settled, false);
    assert.strictEqual((yield* fake.transactionRequests).length, 2);

    yield* TestClock.adjust(60_000);
    yield* fake.setTeamTransactionAction("nhl.l.1.t.2", "accept");
    const extended = yield* proposals.propose(owner, proposer, {
      set: result.set.id,
      items: [
        {
          team: blueLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "Drop their first center once it is unlocked.",
        },
      ],
    });
    assert.isTrue(extended.extended);
    assert.deepStrictEqual(extended.refused, []);
    const replacement = Array.getUnsafe(extended.items, 0).item;
    assert.strictEqual(replacement.state, "proposed");
    assert.strictEqual(replacement.settled, false);

    const foreign = yield* Effect.flip(
      proposals.submit(other, { set: result.set.id, include: [replacement.id] }),
    );
    assert.instanceOf(foreign, ProposalSetNotFound);
    assert.strictEqual((yield* fake.transactionRequests).length, 2);

    const refusedWithdrawal = yield* Effect.flip(
      proposals.withdrawItems(owner, { set: result.set.id, items: [failedId] }),
    );
    assert.instanceOf(refusedWithdrawal, ProposalItemsNotWithdrawable);
    assert.strictEqual(Array.getUnsafe(refusedWithdrawal.items, 0).state, "failed");
    assert.include(Array.getUnsafe(refusedWithdrawal.items, 0).detail, "attempted and failed");

    const second = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [replacement.id],
    });
    assert.strictEqual((yield* fake.transactionRequests).length, 3);
    const lastRequest = Array.getUnsafe(yield* fake.transactionRequests, 2);
    assert.strictEqual(lastRequest.providerTeamKey, "nhl.l.1.t.2");
    assert.deepStrictEqual(lastRequest.drops, ["nhl.p.90003"]);
    assert.strictEqual(second.set.submissions.length, 2);
    const firstSubmission = Array.getUnsafe(second.set.submissions, 0);
    const secondSubmission = Array.getUnsafe(second.set.submissions, 1);
    assert.isDefined(firstSubmission.completedAt);
    assert.isDefined(secondSubmission.completedAt);
    assert.isTrue(
      DateTime.toEpochMillis(secondSubmission.submittedAt) >
        DateTime.toEpochMillis(firstSubmission.submittedAt),
    );
    assert.strictEqual(second.set.settled, false);

    const read = yield* proposals.read(owner, { set: result.set.id });
    assert.deepStrictEqual(
      itemsOf(read).map((item) => [item.reason, item.state, item.settled]),
      [
        ["Drop their first center.", "failed", false],
        ["Drop their first center once it is unlocked.", "executed", true],
        ["Drop the first center.", "executed", true],
      ],
    );
    assert.deepStrictEqual(
      itemsOf(read).map((item) => item.execution?.outcome),
      ["failed", "executed", "executed"],
    );
    assert.include(
      itemsOf(read).find((item) => item.reason === "Drop their first center.")?.execution?.detail ??
        "",
      "That player is locked for this week.",
    );
    assert.strictEqual(read.set.submissions.length, 2);

    const temporary = yield* proposals.propose(owner, proposer, {
      set: result.set.id,
      items: [
        {
          team: blueLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          reason: "A temporary move to withdraw.",
        },
      ],
    });
    const temporaryId = Array.getUnsafe(temporary.items, 0).item.id;
    const withdrawn = yield* proposals.withdrawItems(owner, {
      set: result.set.id,
      items: [temporaryId],
    });
    assert.deepStrictEqual(
      itemsOf(withdrawn).map((item) => item.reason),
      [
        "Drop their first center.",
        "Drop their first center once it is unlocked.",
        "Drop the first center.",
      ],
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses new items once every move in a set has settled", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seedTwoTeams(fake);
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const created = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
          reason: "Drop the first center.",
        },
      ],
    });
    const item = Array.getUnsafe(itemsOf(yield* proposals.read(owner, { set: created.set.id })), 0);
    const submitted = yield* proposals.submit(owner, {
      set: created.set.id,
      include: [item.id],
    });
    assert.strictEqual(submitted.set.settled, true);
    assert.strictEqual(Array.getUnsafe(itemsOf(submitted), 0).settled, true);

    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        set: created.set.id,
        items: [
          {
            team: redLine,
            kind: "drop",
            adds: [],
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
            reason: "A new move after the set settled.",
          },
        ],
      }),
    );
    assert.instanceOf(refused, ProposalSetAlreadySubmitted);
    assert.isTrue(
      DateTime.toEpochMillis(refused.submittedAt) ===
        DateTime.toEpochMillis(Array.getUnsafe(submitted.set.submissions, 0).submittedAt),
    );
    assert.strictEqual(itemsOf(yield* proposals.read(owner, { set: created.set.id })).length, 1);
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
    assert.strictEqual(reserveMove.order, "before");
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

it.effect("sends the roster move after the transaction that frees its destination", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({
        rosterPositions: [
          { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
          { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: [] },
          { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
        ],
      }),
      roster: swapRoster("nhl.l.1.t.1"),
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
          reason: "Add a center and drop the reserve one.",
        },
      ],
    });
    const preview = yield* proposals.revalidate(owner, { set: result.set.id });
    const item = Array.getUnsafe(itemsOf(preview), 0);
    assert.strictEqual(item.reserveMove?.player.name, "Roster Two");
    assert.strictEqual(item.reserveMove?.fromSlot, "BN");
    assert.strictEqual(item.reserveMove?.toSlot, "IR");
    assert.strictEqual(item.reserveMove?.order, "after");

    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    const executed = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(executed.state, "executed");
    assert.deepStrictEqual(
      executed.execution?.steps.map((step) => [step.kind, step.outcome]),
      [
        ["add", "executed"],
        ["drop", "executed"],
        ["reserve_move", "executed"],
      ],
    );
    assert.deepStrictEqual(yield* fake.writeSequence, ["transaction", "reserve_move"]);
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

it.effect("keeps the executed movements when the roster move after them fails", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({
        rosterPositions: [
          { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
          { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: [] },
          { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
        ],
      }),
      roster: swapRoster("nhl.l.1.t.1"),
      playerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    yield* fake.setReserveAction("reject", "That position has already been filled.");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90003"]),
          reason: "Add a center and drop the reserve one.",
        },
      ],
    });
    const item = Array.getUnsafe(
      itemsOf(yield* proposals.revalidate(owner, { set: result.set.id })),
      0,
    );
    assert.strictEqual(item.reserveMove?.order, "after");
    const submitted = yield* proposals.submit(owner, { set: result.set.id, include: [item.id] });
    const executed = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(executed.state, "failed");
    assert.deepStrictEqual(
      executed.execution?.steps.map((step) => [step.kind, step.outcome]),
      [
        ["add", "executed"],
        ["drop", "executed"],
        ["reserve_move", "failed"],
      ],
    );
    assert.deepStrictEqual(yield* fake.writeSequence, ["transaction", "reserve_move"]);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("accepts a declared slot move and reads back its destination slot", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: openBenchLeague,
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
    assert.strictEqual(accepted.item.kind, "slot_move");
    assert.strictEqual(accepted.item.slotMove?.player.name, "Roster Three");
    assert.isString(accepted.item.slotMove?.player.ref);
    assert.strictEqual(accepted.item.slotMove?.fromSlot, "IR");
    assert.strictEqual(accepted.item.slotMove?.toSlot, "BN");

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

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    assert.strictEqual(Array.getUnsafe(itemsOf(review), 0).staleness.status, "current");

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [accepted.item.id],
    });
    const item = Array.getUnsafe(itemsOf(submitted), 0);
    assert.strictEqual(item.state, "skipped");
    assert.strictEqual(item.settled, true);
    assert.strictEqual(submitted.set.settled, true);
    assert.include(item.execution?.detail ?? "", "at most 1 add and 1 drop");

    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        set: result.set.id,
        items: [
          {
            team: redLine,
            kind: "drop",
            adds: [],
            drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]),
            reason: "A move after the unreachable one settled.",
          },
        ],
      }),
    );
    assert.instanceOf(refused, ProposalSetAlreadySubmitted);
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

it.effect("stores the two reserve cures and refuses an add with no place", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: twoReserveLeague,
      roster: twoReserveRoster("nhl.l.1.t.1"),
      playerDetails: twoReservePlayerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const cures = [
      {
        team: redLine,
        kind: "drop" as const,
        adds: [],
        drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90022"]),
        reason: "Drop a bench center.",
      },
      {
        team: redLine,
        kind: "drop" as const,
        adds: [],
        drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90027"]),
        reason: "Drop the reserve-plus center.",
      },
      {
        team: redLine,
        kind: "slot_move" as const,
        adds: [],
        drops: [],
        slotMove: {
          player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90026"]), 0),
          toSlot: "BN",
        },
        reason: "Activate the reserve center onto the bench.",
      },
    ];
    const result = yield* proposals.propose(owner, proposer, { items: cures });
    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(
      result.items.map((item) => item.item.reason),
      [
        "Drop a bench center.",
        "Drop the reserve-plus center.",
        "Activate the reserve center onto the bench.",
      ],
    );

    const read = yield* proposals.read(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(read.teams, 0);
    const benchDrop = itemByReason(read, "Drop a bench center.");
    const reserveDrop = itemByReason(read, "Drop the reserve-plus center.");
    const moveItem = itemByReason(read, "Activate the reserve center onto the bench.");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.item),
        [benchDrop.id, moveItem.id, reserveDrop.id],
      );
    }

    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        set: result.set.id,
        items: [
          {
            team: redLine,
            kind: "free_agent_add",
            adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
            drops: [],
            reason: "Add a pool forward.",
          },
        ],
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      assert.deepStrictEqual(refused.withdraw, []);
      const refusal = Array.getUnsafe(refused.refusals, 0);
      assert.strictEqual(refusal.position, 1);
      assert.strictEqual(refusal.refusal, "roster_full");
      assert.include(refusal.reason, "Add Pool Forward");
      assert.include(refusal.reason, "allows 5");
      assert.notInclude(refusal.reason, "Add a drop item");
      assert.notInclude(refusal.reason, "add a slot move");
      assert.isNotEmpty(refusal.fix);
    }
    const unchanged = yield* proposals.read(owner, { set: result.set.id });
    assert.strictEqual(itemsOf(unchanged).length, 3);
    assert.deepStrictEqual(yield* fake.writeSequence, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("puts an add after the reserve cures that make room for it", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: twoReserveLeague,
      roster: twoReserveRoster("nhl.l.1.t.1"),
      playerDetails: twoReservePlayerDetails,
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const result = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: [],
          reason: "Use the place the cures free.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90022"]),
          reason: "Drop the first bench center.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90023"]),
          reason: "Drop the second bench center.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90027"]),
          reason: "Drop the reserve-plus center.",
        },
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90026"]), 0),
            toSlot: "BN",
          },
          reason: "Activate the reserve center onto the bench.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    assert.deepStrictEqual(
      itemsOf(review).map((item) => item.staleness.status),
      ["current", "current", "current", "current", "current"],
    );
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      const order = teamReview.order.steps.map((step) => step.item);
      const addItem = itemByReason(review, "Use the place the cures free.");
      assert.deepStrictEqual(order.at(-1), addItem.id);
      for (const reason of [
        "Drop the first bench center.",
        "Drop the second bench center.",
        "Drop the reserve-plus center.",
        "Activate the reserve center onto the bench.",
      ]) {
        assert.isBelow(order.indexOf(itemByReason(review, reason).id), order.indexOf(addItem.id));
      }
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("orders an add before a slot move that the add's drop makes room for", () =>
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
          { position: "C", positionType: "O", count: 2, kind: "starting", eligibility: ["C"] },
          { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: [] },
          { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
        ],
        rosterConstraints: {
          rosterMaximum: 3,
          benchCapacity: "per_slot",
          startingSlotsMayStandEmpty: true,
          reserveEligibility: { kind: "published_positions" },
        },
      }),
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "BN", eligible: ["C"] },
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
          kind: "free_agent_add",
          adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Add a center and drop the bench center.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const moveItem = itemByReason(review, "Move the reserve center to the bench.");
    const addItem = itemByReason(review, "Add a center and drop the bench center.");
    assert.strictEqual(moveItem.staleness.status, "current");
    assert.strictEqual(addItem.staleness.status, "current");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.item),
        [addItem.id, moveItem.id],
      );
    }

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [moveItem.id, addItem.id],
    });
    assert.deepStrictEqual(
      itemsOf(submitted).map((item) => [item.reason, item.state, item.execution?.position]),
      [
        ["Move the reserve center to the bench.", "executed", 1],
        ["Add a center and drop the bench center.", "executed", 0],
      ],
    );
    assert.deepStrictEqual(yield* fake.writeSequence, ["transaction", "reserve_move"]);
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
    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        items: [
          {
            team: redLine,
            kind: "free_agent_add",
            adds: yield* refs(tokens, "nhl.l.1", ["nhl.p.90004"]),
            drops: [],
            reason: "Add with no place for him.",
          },
        ],
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      const refusal = Array.getUnsafe(refused.refusals, 0);
      assert.strictEqual(refusal.refusal, "roster_full");
      assert.include(refusal.reason, "This set frees 0 places and consumes 1 place");
      assert.include(refusal.reason, "dropping a player or moving a reserve-eligible player");
      assert.isNotEmpty(refusal.fix);
      assert.include(refused.detail, "no set was stored");
    }
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

it.effect("accepts a move onto a bench that already holds its declared count", () =>
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
          {
            position: "UTIL",
            positionType: "U",
            count: 1,
            kind: "starting",
            eligibility: ["UTIL"],
          },
          { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: [] },
          { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
        ],
      }),
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

    assert.deepStrictEqual(result.refused, []);
    const accepted = Array.getUnsafe(result.items, 0);
    assert.strictEqual(accepted.item.staleness.status, "current");
    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(teamReview.order.rosterPlaces, {
        maximum: 3,
        occupied: 2,
        net: -1,
      });
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => [step.item, step.rosterPlace]),
        [[accepted.item.id, "consumes"]],
      );
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("reads a slot move's player name and the place accounting from the stored set", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: openBenchLeague,
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["C"] },
        { slot: "IR", eligible: ["C", "IR"] },
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
            toSlot: "BN",
          },
          reason: "Activate the reserve center.",
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
    assert.deepStrictEqual(result.refused, []);

    const read = yield* proposals.read(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(read.teams, 0);
    const move = itemByReason(read, "Activate the reserve center.");
    const spare = itemByReason(read, "Drop the bench center.");
    assert.strictEqual(move.slotMove?.player.name, "Roster Two");
    assert.strictEqual(move.slotMove?.toSlot, "BN");
    assert.isUndefined(move.slotMove?.fromSlot);
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(teamReview.order.rosterPlaces, {
        maximum: 4,
        occupied: 2,
        net: 0,
      });
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => [step.item, step.rosterPlace]),
        [
          [move.id, "consumes"],
          [spare.id, "frees"],
        ],
      );
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("reads the roster on the date a next-day league applies its moves", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({
        currentDate: "2026-10-31",
        rosterChange: {
          rule: "next_day",
          source: ["league_settings"],
          detail: "The league applies roster changes the day after its current date.",
        },
      }),
      roster: {
        ...rosterFixture(["nhl.p.90001", "nhl.p.90002"]),
        coverage: { type: "date", date: "2026-11-01" },
      },
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
          reason: "Drop the second center.",
        },
      ],
    });
    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(yield* fake.rosterPeriods, [{ type: "date", date: "2026-11-01" }]);
    const teamReview = Array.getUnsafe(
      (yield* proposals.read(owner, { set: result.set.id })).teams,
      0,
    );
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.strictEqual(teamReview.order.timing, "next_day");
      assert.strictEqual(teamReview.order.effectiveDate, "2026-11-01");
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("reads the scoring week a weekly-locking league applies its moves in", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({
        rosterCoverage: "week",
        periodWindow: { current: 5, start: 1, end: 20 },
        rosterChange: {
          rule: "weekly_lock",
          source: ["league_settings"],
          detail: "The league locks its roster for the scoring week.",
        },
      }),
      roster: {
        ...rosterFixture(["nhl.p.90001", "nhl.p.90002"]),
        coverage: { type: "week", week: 5 },
      },
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
          reason: "Drop the second center.",
        },
      ],
    });
    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(yield* fake.rosterPeriods, [{ type: "week", week: 5 }]);
    const teamReview = Array.getUnsafe(
      (yield* proposals.read(owner, { set: result.set.id })).teams,
      0,
    );
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.strictEqual(teamReview.order.timing, "weekly_lock");
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses only the move whose drop frees a different slot than it needs", () =>
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
            toSlot: "C",
          },
          reason: "Move the reserve center to center.",
        },
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Drop the bench center.",
        },
      ],
    });

    assert.deepStrictEqual(
      result.items.map((item) => [item.position, item.item.reason]),
      [[2, "Drop the bench center."]],
    );
    const refusal = Array.getUnsafe(result.refused, 0);
    assert.strictEqual(refusal.position, 1);
    assert.strictEqual(refusal.refusal, "slot_illegal");
    assert.include(
      refusal.reason,
      "Moving Roster Three to the C starting slot is refused because Roster One already holds it.",
    );
    assert.isNotEmpty(refusal.fix);

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const dropItem = Array.getUnsafe(itemsOf(review), 0);
    assert.strictEqual(dropItem.reason, "Drop the bench center.");
    assert.strictEqual(dropItem.staleness.status, "current");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.item),
        [dropItem.id],
      );
    }

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [dropItem.id],
    });
    assert.deepStrictEqual(
      itemsOf(submitted).map((item) => item.state),
      ["executed"],
    );
    assert.deepStrictEqual(yield* fake.reserveRequests, []);
    assert.deepStrictEqual(
      (yield* fake.transactionRequests).map((request) => request.drops),
      [["nhl.p.90002"]],
    );
    assert.deepStrictEqual(yield* fake.writeSequence, ["transaction"]);
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

it.effect("refuses the move that cannot reach its slot and keeps the others", () =>
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

    assert.deepStrictEqual(
      result.items.map((item) => [item.position, item.item.reason]),
      [
        [1, "Stash the first center."],
        [3, "Drop the spare wing."],
      ],
    );
    const secondRefusal = Array.getUnsafe(result.refused, 0);
    assert.strictEqual(secondRefusal.position, 2);
    assert.strictEqual(secondRefusal.refusal, "slot_illegal");
    assert.include(
      secondRefusal.reason,
      "Moving Roster Three to the IR reserve list is refused because Roster Two already holds it.",
    );
    assert.isNotEmpty(secondRefusal.fix);

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const firstMove = itemByReason(review, "Stash the first center.");
    const spare = itemByReason(review, "Drop the spare wing.");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.item),
        [firstMove.id, spare.id],
      );
    }
    assert.deepStrictEqual(
      [firstMove, spare].map((item) => item.staleness.status),
      ["current", "current"],
    );

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: itemsOf(review).map((item) => item.id),
    });
    assert.deepStrictEqual(
      itemsOf(submitted).map((item) => item.state),
      ["executed", "executed"],
    );
    assert.deepStrictEqual(yield* fake.writeSequence, ["reserve_move", "transaction"]);
    assert.deepStrictEqual(
      (yield* fake.reserveRequests).map((request) => [request.providerPlayerKey, request.slot]),
      [["nhl.p.90002", "IR"]],
    );
    assert.deepStrictEqual(
      (yield* fake.transactionRequests).map((request) => request.drops),
      [["nhl.p.90005"]],
    );
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
      const refusal = Array.getUnsafe(refused.refusals, 0);
      assert.strictEqual(
        refusal.reason,
        "The fake provider's trade proposal request names players only and publishes no element for a draft pick.",
      );
      assert.include(refusal.fix, "players only");
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
    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
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
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      assert.deepStrictEqual(
        refused.refusals.map((refusal) => [refusal.position, refusal.refusal]),
        [
          [1, "slot_illegal"],
          [2, "move_slot_unknown"],
        ],
      );
      assert.include(Array.getUnsafe(refused.refusals, 0).reason, "does not accept");
      assert.include(Array.getUnsafe(refused.refusals, 1).reason, "BENCH");
      for (const refusal of refused.refusals) {
        assert.isNotEmpty(refusal.fix);
      }
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("marks a declared move stale when its player leaves the roster", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: openBenchLeague,
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
    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
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
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      const refusal = Array.getUnsafe(refused.refusals, 0);
      assert.strictEqual(refusal.refusal, "slot_illegal");
      assert.include(refusal.reason, "Roster Two is locked");
      assert.include(refusal.reason, "2026-10-31");
      assert.isNotEmpty(refusal.fix);
    }
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

it.effect("holds one player on a bench slot before it executes two slot moves that swap", () =>
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
          { position: "HOLD", positionType: "B", count: 1, kind: "bench", eligibility: [] },
        ],
        rosterConstraints: {
          rosterMaximum: 3,
          benchCapacity: "per_slot",
          startingSlotsMayStandEmpty: true,
          reserveEligibility: { kind: "published_positions" },
        },
      }),
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
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]), 0),
            toSlot: "BN",
          },
          reason: "Move the center to the bench.",
        },
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]), 0),
            toSlot: "C",
          },
          reason: "Move the bench center to center.",
        },
      ],
    });

    const review = yield* proposals.revalidate(owner, { set: result.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const first = itemByReason(review, "Move the center to the bench.");
    const second = itemByReason(review, "Move the bench center to center.");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => [step.item, step.position]),
        [
          [second.id, 0],
          [first.id, 1],
        ],
      );
    }

    const submitted = yield* proposals.submit(owner, {
      set: result.set.id,
      include: [first.id, second.id],
    });
    const submittedSecond = itemByReason(submitted, "Move the bench center to center.");
    assert.strictEqual(submittedSecond.state, "executed");
    assert.strictEqual(submittedSecond.execution?.position, 0);
    assert.deepStrictEqual(
      submittedSecond.execution?.steps.map((step) => [step.kind, step.fromSlot, step.toSlot]),
      [
        ["reserve_move", "C", "HOLD"],
        ["slot_move", "BN", "C"],
      ],
    );
    assert.deepStrictEqual(
      (yield* fake.reserveRequests).map((request) => [request.providerPlayerKey, request.slot]),
      [
        ["nhl.p.90001", "HOLD"],
        ["nhl.p.90002", "C"],
        ["nhl.p.90001", "BN"],
      ],
    );
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
      assert.include(Array.getUnsafe(closedRefusals.refusals, 0).reason, "Item 1");
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
    assert.include(Array.getUnsafe(rosterRefusals.refusals, 0).reason, "Item 1");
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
    assert.instanceOf(repeated, ProposalNothingIncluded);
    assert.include(repeated.detail, "already been attempted");
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

it.effect("extends a set, appends the new move, and recomputes the whole order", () =>
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
    const first = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Free the bench slot.",
        },
      ],
    });
    assert.isTrue(first.created);
    assert.isFalse(first.extended);

    const extended = yield* proposals.propose(owner, proposer, {
      set: first.set.id,
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
    assert.isFalse(extended.created);
    assert.isTrue(extended.extended);
    assert.strictEqual(extended.set.id, first.set.id);
    assert.deepStrictEqual(extended.refused, []);
    assert.deepStrictEqual(
      extended.items.map((item) => [item.position, item.item.reason]),
      [[1, "Move the reserve center to the bench."]],
    );

    const review = yield* proposals.read(owner, { set: first.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    assert.deepStrictEqual(
      itemsOf(review).map((item) => item.reason),
      ["Free the bench slot.", "Move the reserve center to the bench."],
    );
    const dropItem = itemByReason(review, "Free the bench slot.");
    const moveItem = itemByReason(review, "Move the reserve center to the bench.");
    assert.strictEqual(dropItem.staleness.status, "current");
    assert.strictEqual(moveItem.staleness.status, "current");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => [step.item, step.position]),
        [
          [dropItem.id, 0],
          [moveItem.id, 1],
        ],
      );
    }

    const submitted = yield* proposals.submit(owner, {
      set: first.set.id,
      include: [dropItem.id, moveItem.id],
    });
    assert.deepStrictEqual(
      itemsOf(submitted).map((item) => [item.reason, item.state, item.execution?.position]),
      [
        ["Free the bench slot.", "executed", 0],
        ["Move the reserve center to the bench.", "executed", 1],
      ],
    );
    assert.deepStrictEqual(yield* fake.writeSequence, ["transaction", "reserve_move"]);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses an extension that breaks an existing move and names the move to withdraw", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const seeded = yield* seed(fake, [team("nhl.l.1.t.1", "Red Line")], {
      league: leagueFixture({
        rosterPositions: [
          { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
          { position: "LW", positionType: "O", count: 1, kind: "starting", eligibility: ["LW"] },
          { position: "RW", positionType: "O", count: 1, kind: "starting", eligibility: ["RW"] },
        ],
      }),
      roster: rosterWithSlots("nhl.l.1.t.1", [
        { slot: "C", eligible: ["LW", "RW"] },
        { slot: "LW", eligible: ["LW", "RW"] },
      ]),
      playerDetails: playerDetails.filter(
        (entry) =>
          entry.providerPlayerKey === "nhl.p.90001" || entry.providerPlayerKey === "nhl.p.90002",
      ),
    });
    const redLine = teamId(seeded, "nhl.l.1.t.1");
    const first = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]), 0),
            toSlot: "RW",
          },
          reason: "Move the second center to the right wing.",
        },
        {
          team: redLine,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: {
            player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]), 0),
            toSlot: "LW",
          },
          reason: "Move the illegal center to the left wing.",
        },
      ],
    });
    assert.isTrue(first.created);
    assert.strictEqual(first.items.length, 2);
    const existingIds = itemsOf(yield* proposals.read(owner, { set: first.set.id })).map(
      (item) => item.id,
    );

    const refused = yield* Effect.flip(
      proposals.propose(owner, proposer, {
        set: first.set.id,
        items: [
          {
            team: redLine,
            kind: "slot_move",
            adds: [],
            drops: [],
            slotMove: {
              player: Array.getUnsafe(yield* refs(tokens, "nhl.l.1", ["nhl.p.90001"]), 0),
              toSlot: "RW",
            },
            reason: "Move the illegal center to the right wing.",
          },
        ],
      }),
    );
    assert.strictEqual(refused._tag, "proposal.nothing_accepted");
    if (refused._tag === "proposal.nothing_accepted") {
      const refusal = Array.getUnsafe(refused.refusals, 0);
      assert.strictEqual(refusal.position, 1);
      assert.strictEqual(refusal.refusal, "order_conflict");
      assert.include(refusal.reason, "No order of this team's moves keeps the lineup legal");
      assert.isNotEmpty(refusal.fix);
      assert.deepStrictEqual(
        refused.withdraw.map((entry) => entry.item),
        existingIds,
      );
      for (const entry of refused.withdraw) {
        assert.isNotEmpty(entry.label);
        assert.include(entry.detail, "Neither operation can go first");
      }
      assert.include(refused.detail, "Nothing was stored");
      assert.include(refused.detail, "withdraw_transaction_proposal_items");
    }

    const review = yield* proposals.read(owner, { set: first.set.id });
    assert.strictEqual(itemsOf(review).length, 2);
    assert.deepStrictEqual(yield* fake.writeSequence, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("withdraws a move, revalidates the rest, and returns the new order", () =>
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
    const created = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Free the bench slot.",
        },
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
    const before = yield* proposals.read(owner, { set: created.set.id });
    const dropItem = itemByReason(before, "Free the bench slot.");
    const moveItem = itemByReason(before, "Move the reserve center to the bench.");

    const after = yield* proposals.withdrawItems(owner, {
      set: created.set.id,
      items: [moveItem.id],
    });
    const teamReview = Array.getUnsafe(after.teams, 0);
    assert.deepStrictEqual(
      itemsOf(after).map((item) => [item.reason, item.staleness.status]),
      [["Free the bench slot.", "current"]],
    );
    assert.isDefined(teamReview.items[0]?.staleness.checkedAt);
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => [step.item, step.position]),
        [[dropItem.id, 0]],
      );
    }

    const read = yield* proposals.read(owner, { set: created.set.id });
    assert.deepStrictEqual(
      itemsOf(read).map((item) => item.reason),
      ["Free the bench slot."],
    );

    const empty = yield* proposals.withdrawItems(owner, {
      set: created.set.id,
      items: [dropItem.id],
    });
    assert.deepStrictEqual(itemsOf(empty), []);
    assert.isUndefined(Array.getUnsafe(empty.teams, 0).order);

    const reproposed = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Free the bench slot.",
        },
      ],
    });
    assert.isTrue(reproposed.created);
    assert.notStrictEqual(reproposed.set.id, created.set.id);
    assert.deepStrictEqual(yield* fake.writeSequence, []);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses to withdraw a move that already ran", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* QueryTokens;
    const database = yield* ConnectionsDatabase;
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
    const created = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Drop the bench center.",
        },
      ],
    });
    const item = Array.getUnsafe(itemsOf(yield* proposals.read(owner, { set: created.set.id })), 0);
    yield* database
      .update(transactionProposalItems)
      .set({ state: "executed" })
      .where(eq(transactionProposalItems.id, item.id));

    const refused = yield* Effect.flip(
      proposals.withdrawItems(owner, { set: created.set.id, items: [item.id] }),
    );
    assert.instanceOf(refused, ProposalItemsNotWithdrawable);
    const entry = Array.getUnsafe(refused.items, 0);
    assert.strictEqual(entry.item, item.id);
    assert.strictEqual(entry.state, "executed");
    assert.include(entry.detail, "already run");
    assert.include(refused.detail, "Nothing was withdrawn");
    assert.strictEqual(itemsOf(yield* proposals.read(owner, { set: created.set.id })).length, 1);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("refuses to withdraw a move that already ran from a submitted set", () =>
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
    const created = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: redLine,
          kind: "drop",
          adds: [],
          drops: yield* refs(tokens, "nhl.l.1", ["nhl.p.90002"]),
          reason: "Drop the bench center.",
        },
      ],
    });
    const item = Array.getUnsafe(itemsOf(yield* proposals.read(owner, { set: created.set.id })), 0);
    yield* proposals.submit(owner, { set: created.set.id, include: [item.id] });
    const writes = (yield* fake.transactionRequests).length;

    const refused = yield* Effect.flip(
      proposals.withdrawItems(owner, { set: created.set.id, items: [item.id] }),
    );
    assert.instanceOf(refused, ProposalItemsNotWithdrawable);
    assert.strictEqual(Array.getUnsafe(refused.items, 0).state, "executed");
    assert.include(Array.getUnsafe(refused.items, 0).detail, "already run");
    assert.strictEqual((yield* fake.transactionRequests).length, writes);
    assert.strictEqual(itemsOf(yield* proposals.read(owner, { set: created.set.id })).length, 1);
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
  const positions: ReadonlyArray<ProviderRosterPosition> = overrides.rosterPositions ?? [
    { position: "C", positionType: "O", count: 2, kind: "starting", eligibility: ["C"] },
    { position: "BN", positionType: "B", count: 6, kind: "bench", eligibility: [] },
  ];
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
    rosterPositions: positions,
    rosterConstraints: overrides.rosterConstraints ?? declaredRosterConstraints(positions),
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

function swapRoster(teamKey: string): ProviderRoster {
  const roster = rosterFixture(["nhl.p.90001", "nhl.p.90002", "nhl.p.90003"], teamKey);
  return {
    ...roster,
    players: roster.players.map((player, index) => ({
      ...player,
      slot: {
        status: "verified" as const,
        slot: index === 0 ? "C" : index === 1 ? "BN" : "IR",
      },
      eligiblePositions: index === 0 ? ["C"] : ["C", "IR"],
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

const twoReserveLeague = leagueFixture({
  rosterChange: {
    rule: "same_day",
    source: ["weekly_deadline"],
    detail: "The provider's weekly_deadline is intraday.",
  },
  rosterPositions: [
    { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
    { position: "BN", positionType: "B", count: 4, kind: "bench", eligibility: [] },
    { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
    { position: "IR+", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR+"] },
  ],
});

const twoReserveRosterKeys = [
  "nhl.p.90021",
  "nhl.p.90022",
  "nhl.p.90023",
  "nhl.p.90024",
  "nhl.p.90025",
  "nhl.p.90026",
  "nhl.p.90027",
];

function twoReserveRoster(teamKey: string): ProviderRoster {
  const roster = rosterFixture(twoReserveRosterKeys, teamKey);
  const slots = ["C", "BN", "BN", "BN", "BN", "IR", "IR+"];
  return {
    ...roster,
    players: roster.players.map((player, index) => ({
      ...player,
      slot: { status: "verified" as const, slot: slots[index] ?? "BN" },
      eligiblePositions: ["C"],
    })),
  };
}

const noBenchReserveLeague = leagueFixture({
  rosterPositions: [
    { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
    { position: "IR", positionType: "I", count: 1, kind: "reserve", eligibility: ["IR"] },
  ],
});

const noBenchWingLeague = leagueFixture({
  rosterPositions: [
    { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
    { position: "LW", positionType: "O", count: 1, kind: "starting", eligibility: ["LW"] },
  ],
});

const noBenchIlPlusLeague = leagueFixture({
  rosterPositions: [
    { position: "C", positionType: "O", count: 1, kind: "starting", eligibility: ["C"] },
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

const twoReservePlayerDetails: ReadonlyArray<ProviderPlayerDetail> = [
  ...playerDetails,
  detail("nhl.p.90021", "Roster Twenty-One", "rostered"),
  detail("nhl.p.90022", "Roster Twenty-Two", "rostered"),
  detail("nhl.p.90023", "Roster Twenty-Three", "rostered"),
  detail("nhl.p.90024", "Roster Twenty-Four", "rostered"),
  detail("nhl.p.90025", "Roster Twenty-Five", "rostered"),
  detail("nhl.p.90026", "Roster Twenty-Six", "rostered"),
  detail("nhl.p.90027", "Roster Twenty-Seven", "rostered"),
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

const foreignPendingTrade: ProviderPendingTrade = {
  transactionKey: "nhl.l.1.pt.10",
  proposedAt: "2026-10-30T19:00:00.000Z",
  note: undefined,
  canRespond: false,
  proposer: { providerTeamKey: "nhl.l.1.t.3", name: "Third Line" },
  receiver: { providerTeamKey: "nhl.l.1.t.4", name: "Fourth Line" },
  unusedRosterSpots: undefined,
  players: [],
  picks: [],
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
