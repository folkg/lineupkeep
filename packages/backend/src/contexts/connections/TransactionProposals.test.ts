import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";

import { Connections } from "./Connections.ts";
import { decodeTeamId } from "./FantasyTeam.ts";
import type { FantasyTeam, TeamId } from "./FantasyTeam.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
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
} from "./Provider.ts";
import { decodeProviderKey } from "./ProviderKey.ts";
import type { PlayerRef } from "./QueryValues.ts";
import {
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
            "nhl.p.90004",
            "nhl.p.90006",
            "nhl.p.90007",
            "nhl.p.90008",
            "nhl.p.90010",
            "nhl.p.90011",
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

    const read = yield* proposals.readPendingOffers(owner, {
      team: teamId(seeded, "nhl.l.1.t.1"),
    });
    assert.strictEqual(read.status, "available");
    assert.isTrue(read.readOnly);
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

function rosterFixture(playerKeys: ReadonlyArray<string>): ProviderRoster {
  return {
    providerTeamKey: "nhl.l.1.t.1",
    providerLeagueKey: "nhl.l.1",
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
