import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, Effect, Layer, Redacted, Schema } from "effect";

import { StartLinkingInput } from "./Connection.ts";
import { Connections } from "./Connections.ts";
import { FantasyQueries } from "./FantasyQueries.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { FantasyQueriesLive } from "./internal/FantasyQueriesLive.ts";
import { FakeProviderWorld } from "./internal/ProviderFakeTest.ts";
import { ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { QueryTokens } from "./internal/QueryTokens.ts";
import { TransactionReviewsLive } from "./internal/TransactionReviewsLive.ts";
import type { ProviderLeagueSettings, ProviderRoster, ProviderTeam } from "./Provider.ts";
import { QueryTeamNotFound } from "./QueryValues.ts";
import { TransactionReviews } from "./TransactionReview.ts";

it.effect("lists owned teams with stable paging and owner-bound continuations", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [
      team("461.l.1000.t.1", "Alpha"),
      team("465.l.2000.t.9", "Gamma", "nhl"),
    ]);

    const firstPage = yield* queries.listTeams(owner, { limit: 1 });
    assert.strictEqual(firstPage.status, "ok");
    if (firstPage.status !== "ok") {
      return;
    }
    assert.strictEqual(firstPage.teams.length, 1);
    assert.strictEqual(Array.getUnsafe(firstPage.teams, 0).name, "Alpha");
    assert.strictEqual(firstPage.page.complete, false);
    assert.isString(firstPage.page.next);

    const secondPage = yield* queries.listTeams(owner, {
      limit: 1,
      cursor: firstPage.page.next,
    });
    assert.strictEqual(secondPage.status, "ok");
    if (secondPage.status !== "ok") {
      return;
    }
    assert.strictEqual(Array.getUnsafe(secondPage.teams, 0).name, "Gamma");
    assert.strictEqual(secondPage.page.complete, true);

    const filtered = yield* queries.listTeams(owner, { sport: "hockey" });
    assert.strictEqual(filtered.status, "ok");
    if (filtered.status === "ok") {
      assert.deepStrictEqual(
        filtered.teams.map((row) => row.name),
        ["Gamma"],
      );
    }

    const other = decodeUserId("other");
    const firstCursor = firstPage.page.next;
    if (firstCursor === undefined) {
      return;
    }
    const foreignCursor = yield* Effect.flip(queries.listTeams(other, { cursor: firstCursor }));
    assert.strictEqual(foreignCursor._tag, "query.cursor_invalid");
    assert.strictEqual(seeded.length, 2);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("resolves calendar periods from league settings without guessing locks", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);

    const calendar = yield* queries.getCalendar(owner, {
      team: Array.getUnsafe(seeded, 0).id,
    });

    assert.strictEqual(calendar.status, "ok");
    if (calendar.status !== "ok") {
      return;
    }
    assert.strictEqual(calendar.periods.length, 17);
    assert.deepStrictEqual(
      calendar.periods.filter((period) => period.isCurrent).map((period) => period.week),
      [3],
    );
    assert.strictEqual(calendar.window?.currentWeek, 3);
    assert.strictEqual(calendar.lockContext?.status, "unverified");
    assert.strictEqual(calendar.historical.status, "unsupported");
    assert.deepStrictEqual(calendar.dates, { start: "2026-09-03", end: "2026-12-28" });

    const other = yield* Effect.flip(
      queries.getCalendar(decodeUserId("other"), { team: Array.getUnsafe(seeded, 0).id }),
    );
    assert.instanceOf(other, QueryTeamNotFound);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("returns league scoring, roster rules, and explicit standings coverage", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);

    const league = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["overview", "roster_rules", "scoring", "standings"],
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok") {
      return;
    }
    assert.strictEqual(league.overview?.teamCount, 10);
    assert.deepStrictEqual(league.rosterRules, {
      positions: [
        { position: "QB", kind: "starter", count: 1 },
        { position: "BN", kind: "bench", count: 6 },
      ],
      starterCount: 1,
      benchCount: 6,
      reserveCount: 0,
    });
    assert.strictEqual(league.scoring.length, 2);
    assert.strictEqual(Array.getUnsafe(league.scoring, 0).points, "0.04");
    assert.strictEqual(Array.getUnsafe(league.scoring, 1).points, null);
    assert.strictEqual(league.standings?.status, "unsupported");
    assert.isTrue(
      league.coverage.some(
        (entry) => entry.resource === "standings" && entry.status === "unsupported",
      ),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reads compact and full rosters for an exact selected week", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);

    const teamId = Array.getUnsafe(seeded, 0).id;
    const compact = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
    const full = yield* queries.getRosters(owner, {
      team: teamId,
      period: { week: 3 },
      detail: "full",
    });

    assert.strictEqual(compact.status, "ok");
    assert.strictEqual(full.status, "ok");
    if (compact.status !== "ok" || full.status !== "ok") {
      return;
    }
    assert.strictEqual(compact.players.length, 2);
    assert.strictEqual(compact.period?.week, 3);
    assert.strictEqual(Array.getUnsafe(compact.players, 0).byeWeek, undefined);
    assert.strictEqual(Array.getUnsafe(full.players, 0).byeWeek, 7);
    assert.strictEqual(Array.getUnsafe(full.players, 1).injury.code, "O");
    assert.strictEqual(Array.getUnsafe(full.players, 1).injury.reported, true);
    assert.isFalse(includesText(compact, "461.l.1000"));
    assert.isFalse(includesText(compact, "461.p.10001"));
    assert.isFalse(includesText(compact, "test-session-cookie"));

    const mismatch = yield* queries.getRosters(owner, { team: teamId, period: { week: 4 } });
    assert.strictEqual(mismatch.status, "failed");
    if (mismatch.status === "failed") {
      assert.strictEqual(Array.getUnsafe(mismatch.failures, 0).code, "period_unavailable");
    }

    const outsideSeason = yield* Effect.flip(
      queries.getRosters(owner, { team: teamId, period: { week: 18 } }),
    );
    assert.strictEqual(outsideSeason._tag, "query.selection_invalid");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("searches bounded free agents and preserves zero versus missing stats", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);

    const search = yield* queries.searchPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      availability: "free_agent",
      sort: "name",
    });

    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      search.players.map((player) => player.name),
      ["Free Agent"],
    );
    assert.isFalse(includesText(search, "461.p.10003"));

    const freeAgent = Array.getUnsafe(search.players, 0);
    const hydrated = yield* queries.getPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      players: [freeAgent.player],
      groups: ["identity", "actual_stats", "projections"],
    });

    assert.strictEqual(hydrated.status, "ok");
    if (hydrated.status !== "ok") {
      return;
    }
    const hydratedPlayer = Array.getUnsafe(hydrated.players, 0);
    assert.strictEqual(hydratedPlayer.identity?.name, "Free Agent");
    assert.strictEqual(hydratedPlayer.actualStats?.status, "available");
    assert.strictEqual(hydratedPlayer.projections?.status, "available");
    if (hydratedPlayer.actualStats?.status === "available") {
      assert.strictEqual(Array.getUnsafe(hydratedPlayer.actualStats.stats, 0).value, 0);
    }
    if (hydratedPlayer.projections?.status === "available") {
      assert.strictEqual(Array.getUnsafe(hydratedPlayer.projections.stats, 0).value, null);
    }
    assert.strictEqual(hydrated.dictionary.length, 1);
    assert.strictEqual(Array.getUnsafe(hydrated.dictionary, 0).name, "Passing Yards");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("returns explicit unsupported coverage instead of empty success", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const supportedRoster = yield* queries.getRosters(owner, {
      team: teamId,
      period: { week: 3 },
    });
    assert.strictEqual(supportedRoster.status, "ok");
    if (supportedRoster.status !== "ok") {
      return;
    }
    const playerRef = Array.getUnsafe(supportedRoster.players, 0).player;
    yield* fake.unsupportedOperations([
      "read_roster",
      "search_players",
      "read_player_details",
      "read_matchups",
      "read_transactions",
    ]);

    const roster = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
    const search = yield* queries.searchPlayers(owner, { team: teamId });
    const players = yield* queries.getPlayers(owner, {
      team: teamId,
      players: [playerRef],
      groups: ["identity"],
    });
    const matchups = yield* queries.getMatchups(owner, { team: teamId, period: { week: 3 } });
    const transactions = yield* queries.getTransactions(owner, { team: teamId });

    for (const result of [roster, search, players, matchups, transactions]) {
      assert.strictEqual(result.status, "unsupported");
      if (result.status === "unsupported") {
        assert.isTrue(result.coverage.some((entry) => entry.status === "unsupported"));
      }
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("pages a large multi-byte roster inside the encoded result budget", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      roster: rosterFixture({
        count: 40,
        name: "Joueur Élite 名前",
      }),
    });

    const teamId = Array.getUnsafe(seeded, 0).id;
    const page = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });

    assert.strictEqual(page.status, "ok");
    if (page.status !== "ok") {
      return;
    }
    assert.isTrue(page.players.length < 40);
    assert.strictEqual(page.page.complete, false);
    assert.isString(page.page.next);

    const nextCursor = page.page.next;
    if (nextCursor === undefined) {
      return;
    }
    const next = yield* queries.getRosters(owner, {
      team: teamId,
      period: { week: 3 },
      cursor: nextCursor,
    });
    assert.strictEqual(next.status, "ok");
    if (next.status === "ok") {
      assert.notStrictEqual(next.players[0]?.player, page.players[0]?.player);
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("builds review-only links for add, add/drop, and drop without provider keys", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const reviews = yield* TransactionReviews;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;

    const roster = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok") {
      return;
    }
    const dropRef = Array.getUnsafe(roster.players, 0).player;
    const search = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "name",
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    const addRef = Array.getUnsafe(search.players, 0).player;

    const links = yield* reviews.generate(owner, {
      team: teamId,
      intents: [
        { kind: "add", add: addRef },
        { kind: "add_drop", add: addRef, drop: dropRef },
        { kind: "drop", drop: dropRef },
      ],
    });

    assert.strictEqual(links.status, "ok");
    if (links.status !== "ok") {
      return;
    }
    assert.strictEqual(links.links.length, 3);
    for (const link of links.links) {
      assert.strictEqual(link.status, "review_only");
      if (link.status === "review_only") {
        assert.match(link.url, /^https:\/\//u);
        assert.notInclude(link.url, "submit");
        assert.notInclude(link.url, "confirm");
        assert.include(link.humanReview, "cannot submit");
      }
    }
    assert.include(links.instruction, "cannot submit");
    assert.isFalse(includesText(links, "461.p.10003"));
    assert.isFalse(includesText(links, "test-session-cookie"));
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("builds a trade review link only for a league member counterparty", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const reviews = yield* TransactionReviews;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setLeagueTeams([
      { providerTeamKey: "461.l.1000.t.2", providerLeagueKey: "461.l.1000", name: "Beta" },
    ]);

    const roster = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
    const search = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "name",
    });
    const matchups = yield* queries.getMatchups(owner, {
      team: teamId,
      period: { week: 3 },
    });
    assert.strictEqual(roster.status, "ok");
    assert.strictEqual(search.status, "ok");
    assert.strictEqual(matchups.status, "ok");
    if (roster.status !== "ok" || search.status !== "ok" || matchups.status !== "ok") {
      return;
    }
    const send = Array.getUnsafe(roster.players, 0).player;
    const receive = Array.getUnsafe(search.players, 0).player;
    const counterparty = Array.getUnsafe(matchups.matchups, 0).away.team;

    const links = yield* reviews.generate(owner, {
      team: teamId,
      intents: [{ kind: "trade", send: [send], receive: [receive], counterparty }],
    });

    assert.strictEqual(links.status, "ok");
    if (links.status !== "ok") {
      return;
    }
    const link = Array.getUnsafe(links.links, 0);
    assert.strictEqual(link.status, "review_only");
    if (link.status === "review_only") {
      assert.strictEqual(link.counterparty, counterparty);
      assert.include(link.url, "/trade");
      assert.strictEqual(link.players.length, 2);
    }

    yield* fake.setLeagueTeams([]);
    const notMember = yield* reviews.generate(owner, {
      team: teamId,
      intents: [{ kind: "trade", send: [send], receive: [receive], counterparty }],
    });
    assert.strictEqual(notMember.status, "unsupported");
    if (notMember.status === "unsupported") {
      assert.strictEqual(Array.getUnsafe(notMember.links, 0).status, "unsupported");
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("rejects a provider review URL that reaches a submission stage", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const reviews = yield* TransactionReviews;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const search = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "name",
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    yield* fake.setReviewLinkUrl("https://review.example.test/league/461.l.1000/submit");
    const links = yield* reviews.generate(owner, {
      team: teamId,
      intents: [{ kind: "add", add: Array.getUnsafe(search.players, 0).player }],
    });

    assert.strictEqual(links.status, "unsupported");
    if (links.status !== "unsupported") {
      return;
    }
    const link = Array.getUnsafe(links.links, 0);
    assert.strictEqual(link.status, "unsupported");
    if (link.status === "unsupported") {
      assert.include(link.detail, "review-only safety check");
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("marks a drop link unsupported when the player is not on the roster", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const reviews = yield* TransactionReviews;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const search = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "name",
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    const freeAgent = Array.getUnsafe(search.players, 0).player;

    const links = yield* reviews.generate(owner, {
      team: teamId,
      intents: [{ kind: "drop", drop: freeAgent }],
    });

    assert.strictEqual(links.status, "unsupported");
    if (links.status !== "unsupported") {
      return;
    }
    const link = Array.getUnsafe(links.links, 0);
    assert.strictEqual(link.status, "unsupported");
    if (link.status === "unsupported") {
      assert.include(link.detail, "not on the selected roster");
    }

    const other = yield* Effect.flip(
      reviews.generate(decodeUserId("other"), {
        team: teamId,
        intents: [{ kind: "drop", drop: freeAgent }],
      }),
    );
    assert.instanceOf(other, QueryTeamNotFound);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

const owner = decodeUserId("owner");
const session = Redacted.make("A1=test-session-cookie");

function seed(
  fake: FakeProviderWorld["Service"],
  teams: ReadonlyArray<ProviderTeam>,
  options: {
    readonly roster?: ProviderRoster;
    readonly league?: ProviderLeagueSettings;
  } = {},
): Effect.Effect<
  ReadonlyArray<{ readonly id: import("./FantasyTeam.ts").TeamId }>,
  never,
  Connections
> {
  return Effect.gen(function* () {
    const connections = yield* Connections;
    yield* fake.setTeams(teams);
    yield* fake.setLeague(options.league ?? leagueFixture);
    yield* fake.setRoster(options.roster ?? rosterFixture({ count: 2 }));
    yield* fake.setPlayerDetails(playerDetails);
    yield* fake.setMatchups([
      {
        period: { week: 3 },
        home: { providerTeamKey: "461.l.1000.t.1", name: "Alpha", points: 101.5 },
        away: { providerTeamKey: "461.l.1000.t.2", name: "Beta", points: 98 },
        status: "final",
      },
    ]);
    yield* fake.setTransactions([
      {
        occurredAt: "2026-09-20T12:00:00.000Z",
        type: "add",
        status: "successful",
        teams: [{ providerTeamKey: "461.l.1000.t.1", name: "Alpha" }],
        players: [{ providerPlayerKey: "461.p.10003", direction: "add" }],
      },
    ]);
    const linkingInput = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
      provider: "yahoo",
      pairingCode: "ABCD2345",
    });
    const linking = Array.getUnsafe(yield* connections.startLinking(owner, [linkingInput]), 0);
    yield* connections.completeLinking(owner, [{ id: linking.id, provider: "yahoo", session }]);
    const discovered = yield* connections.discoverTeams(owner, [{ id: linking.id }]);
    return discovered.map((row) => ({ id: row.id }));
  }).pipe(Effect.orDie);
}

function team(providerTeamKey: string, name: string, league: "nfl" | "nhl" = "nfl"): ProviderTeam {
  const providerLeagueKey = providerTeamKey.slice(0, providerTeamKey.lastIndexOf(".t."));
  return {
    provider: "yahoo",
    providerTeamKey,
    providerLeagueKey,
    league,
    sport: league === "nfl" ? "football" : "hockey",
    season: 2026,
    name,
  };
}

const leagueFixture: ProviderLeagueSettings = {
  providerLeagueKey: "461.l.1000",
  name: "Alpha League",
  webUrl: "https://football.fantasysports.yahoo.com/f1/1000",
  season: 2026,
  currentWeek: 3,
  startWeek: 1,
  endWeek: 17,
  startDate: "2026-09-03",
  endDate: "2026-12-28",
  teamCount: 10,
  scoringType: "head",
  scoringLabel: "H2H",
  weeklyDeadline: undefined,
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
  draftStatus: "postdraft",
  rosterPositions: [
    { position: "QB", positionType: "O", count: 1, isStarting: true },
    { position: "BN", positionType: "B", count: 6, isStarting: false },
  ],
  statCategories: [
    {
      statId: 4,
      name: "Passing Yards",
      displayName: "Pass Yds",
      abbreviation: "PY",
      group: "passing",
      enabled: true,
      positionTypes: ["O"],
    },
    {
      statId: 20,
      name: "Rushing Yards",
      displayName: "Rush Yds",
      abbreviation: "RY",
      group: "rushing",
      enabled: true,
      positionTypes: ["O"],
    },
  ],
  statModifiers: [{ statId: 4, points: "0.04" }],
};

function rosterFixture(input: { readonly count: number; readonly name?: string }): ProviderRoster {
  return {
    providerTeamKey: "461.l.1000.t.1",
    providerLeagueKey: "461.l.1000",
    coverage: { type: "week", week: 3 },
    players: globalThis.Array.from({ length: input.count }, (_, index) => ({
      providerPlayerKey: `461.p.${String(10001 + index)}`,
      name:
        input.name === undefined ? `Synthetic ${String(index)}` : `${input.name} ${String(index)}`,
      displayPosition: "QB",
      primaryPosition: "QB",
      positionType: "O",
      eligiblePositions: ["QB"],
      slot: index === 0 ? "QB" : "BN",
      isFlex: false,
      isEditable: true,
      injuryCode: index === 1 ? "O" : undefined,
      injuryDetail: index === 1 ? "Out" : undefined,
      byeWeek: 7,
      undroppable: false,
    })),
  };
}

const playerDetails = [
  {
    providerPlayerKey: "461.p.10001",
    name: "Synthetic 0",
    primaryPosition: "QB",
    displayPosition: "QB",
    eligiblePositions: ["QB"],
    rosterStatus: "rostered" as const,
    actual: { period: { week: 3 }, stats: [{ statId: 4, value: 275 }] },
    projected: { period: { week: 3 }, stats: [{ statId: 4, value: 250 }] },
  },
  {
    providerPlayerKey: "461.p.10002",
    name: "Synthetic 1",
    primaryPosition: "QB",
    displayPosition: "QB",
    eligiblePositions: ["QB"],
    rosterStatus: "rostered" as const,
    actual: { period: { week: 3 }, stats: [{ statId: 4, value: 0 }] },
    projected: { period: { week: 3 }, stats: [{ statId: 4, value: null }] },
  },
  {
    providerPlayerKey: "461.p.10003",
    name: "Free Agent",
    primaryPosition: "RB",
    displayPosition: "RB",
    eligiblePositions: ["RB", "W/R"],
    rosterStatus: "free_agent" as const,
    actual: { period: { week: 3 }, stats: [{ statId: 4, value: 0 }] },
    projected: { period: { week: 3 }, stats: [{ statId: 4, value: null }] },
  },
];

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

const QueriesTestLayer = Layer.merge(FantasyQueriesLive, TransactionReviewsLive).pipe(
  Layer.provideMerge(ConnectionsLive),
  Layer.provideMerge(QueryRepositoryTest),
  Layer.provideMerge(ConnectionRepositoryTest),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provide(QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars")),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
