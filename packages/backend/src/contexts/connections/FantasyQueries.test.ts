import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, DateTime, Effect, Layer, Redacted, Schema } from "effect";

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
import type {
  ProviderLeagueSettings,
  ProviderTransaction,
  ProviderPlayerDetail,
  ProviderRoster,
  ProviderTeam,
} from "./Provider.ts";
import { ProviderPeriodMismatch, ProviderResponseInvalid } from "./Provider.ts";
import { RosterResult, TeamSummaryResult } from "./QueryResults.ts";
import { StatRef } from "./QueryValues.ts";
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

it.effect("keeps roster, calendar, and matchup reads with degraded league coverage", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.failLeague(
      ProviderResponseInvalid.make({ operation: "read_league", field: "league.num_teams" }),
    );

    const roster = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
    const matchups = yield* queries.getMatchups(owner, { team: teamId, period: { week: 3 } });
    const calendar = yield* queries.getCalendar(owner, { team: teamId });

    assert.strictEqual(roster.status, "ok");
    if (roster.status === "ok") {
      assert.strictEqual(roster.players.length, 2);
      assert.strictEqual(roster.period?.week, 3);
      const league = roster.coverage.find((entry) => entry.resource === "league");
      assert.strictEqual(league?.status, "degraded");
      assert.include(league?.detail, "league.num_teams");
      assert.deepStrictEqual(
        roster.failures.map((failure) => [failure.code, failure.resource]),
        [["provider_invalid_response", "league"]],
      );
    }

    assert.strictEqual(matchups.status, "ok");
    if (matchups.status === "ok") {
      assert.strictEqual(matchups.matchups.length, 1);
      assert.strictEqual(
        matchups.coverage.find((entry) => entry.resource === "league")?.status,
        "degraded",
      );
    }

    assert.strictEqual(calendar.status, "failed");
    if (calendar.status === "failed") {
      assert.isTrue(
        calendar.coverage.some(
          (entry) => entry.resource === "league" && entry.status === "degraded",
        ),
      );
      assert.include(Array.getUnsafe(calendar.failures, 0).message, "league.num_teams");
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("keeps the league failure when the roster read also fails", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.failLeague(
      ProviderResponseInvalid.make({ operation: "read_league", field: "league.num_teams" }),
    );

    const roster = yield* queries.getRosters(owner, { team: teamId, period: { week: 9 } });

    assert.strictEqual(roster.status, "failed");
    if (roster.status !== "failed") {
      return;
    }
    assert.deepStrictEqual(
      roster.failures.map((failure) => failure.code),
      ["provider_invalid_response", "period_unavailable"],
    );
    assert.strictEqual(
      roster.coverage.find((entry) => entry.resource === "league")?.status,
      "degraded",
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports a league without a scoring-week window instead of inventing periods", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl")], {
      league: {
        ...leagueFixture,
        providerLeagueKey: "465.l.2000",
        webUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
        periodWindow: undefined,
      },
      roster: rosterFixture({
        count: 2,
        coverage: { type: "date", date: "2026-10-25" },
        providerTeamKey: "465.l.2000.t.9",
        providerLeagueKey: "465.l.2000",
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;

    const calendar = yield* queries.getCalendar(owner, { team: teamId });
    const league = yield* queries.getLeague(owner, { team: teamId, groups: ["overview"] });
    const roster = yield* queries.getRosters(owner, { team: teamId });

    assert.strictEqual(calendar.status, "unsupported");
    if (calendar.status === "unsupported") {
      assert.deepStrictEqual(calendar.periods, []);
      assert.strictEqual(calendar.window, undefined);
      assert.isTrue(
        calendar.coverage.some(
          (entry) =>
            entry.resource === "calendar" &&
            entry.status === "unsupported" &&
            entry.detail?.includes("no scoring-week window") === true,
        ),
      );
      assert.deepStrictEqual(calendar.failures, []);
    }

    assert.strictEqual(league.status, "ok");
    if (league.status === "ok") {
      assert.strictEqual(league.overview?.currentWeek, undefined);
      assert.strictEqual(league.overview?.scoringType, "head");
    }

    assert.strictEqual(roster.status, "ok");
    if (roster.status === "ok") {
      assert.strictEqual(roster.players.length, 2);
      assert.strictEqual(roster.period, undefined);
    }
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
    assert.strictEqual(compact.playerSchedule.status, "unsupported");
    assert.include(compact.playerSchedule.detail, "per-player games-remaining");
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

it.effect("rejects a blank player search query with the remedy instead of a generic failure", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;

    for (const query of ["", "   "]) {
      const rejected = yield* Effect.flip(queries.searchPlayers(owner, { team: teamId, query }));

      assert.strictEqual(rejected._tag, "query.selection_invalid");
      if (rejected._tag === "query.selection_invalid") {
        assert.include(rejected.detail, "Omit the query");
      }
    }

    const listed = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
    });
    assert.strictEqual(listed.status, "ok");
    if (listed.status === "ok") {
      assert.strictEqual(listed.players.length, 1);
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("resolves a dropped player's identity from transaction history", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setTransactions([
      {
        occurredAt: "2026-09-20T12:00:00.000Z",
        type: "add_drop",
        status: "successful",
        teams: [{ providerTeamKey: "461.l.1000.t.1", name: "Alpha" }],
        players: [
          transactionPlayer("461.p.10003", "add", "Synthetic Addition"),
          transactionPlayer("461.p.10004", "drop", "Dropped Veteran"),
        ],
      },
    ]);

    const transactions = yield* queries.getTransactions(owner, { team: teamId });
    assert.strictEqual(transactions.status, "ok");
    if (transactions.status !== "ok") {
      return;
    }
    const dropped = Array.getUnsafe(Array.getUnsafe(transactions.transactions, 0).players, 1);
    assert.strictEqual(dropped.direction, "drop");

    const hydrated = yield* queries.getPlayers(owner, {
      team: teamId,
      players: [dropped.player],
      groups: ["identity", "eligibility"],
    });

    assert.strictEqual(hydrated.status, "ok");
    if (hydrated.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(Array.getUnsafe(hydrated.players, 0).identity, {
      name: "Dropped Veteran",
      displayPosition: "WR",
    });
    assert.deepStrictEqual(hydrated.failures, []);
    assert.isTrue(
      hydrated.coverage.some(
        (entry) => entry.resource === "players" && entry.source === "transactions",
      ),
    );
    assert.isFalse(includesText(hydrated, "461.p.10004"));
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
    if (hydratedPlayer.actualStats?.status === "available") {
      assert.strictEqual(hydratedPlayer.actualStats.basis, "week");
      assert.deepStrictEqual(hydratedPlayer.actualStats.period, { week: 3 });
      assert.strictEqual(Array.getUnsafe(hydratedPlayer.actualStats.stats, 0).value, 0);
    }
    assert.deepStrictEqual(hydratedPlayer.projections, {
      status: "unsupported",
      detail: "This provider does not expose projected player statistics.",
    });
    assert.deepStrictEqual(hydrated.failures, []);
    assert.deepStrictEqual(hydrated.period, { week: 3 });
    assert.strictEqual(hydrated.dictionary.length, 1);
    assert.strictEqual(Array.getUnsafe(hydrated.dictionary, 0).name, "Passing Yards");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "states the season basis hockey uses and rejects projections without a period failure",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const seeded = yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl")], {
        league: {
          ...leagueFixture,
          providerLeagueKey: "465.l.2000",
          webUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
        },
        roster: rosterFixture({
          count: 1,
          coverage: { type: "date", date: "2026-10-25" },
          providerTeamKey: "465.l.2000.t.9",
          providerLeagueKey: "465.l.2000",
        }),
        playerDetails: [
          {
            providerPlayerKey: "461.p.10001",
            name: "Synthetic 0",
            primaryPosition: "QB",
            displayPosition: "QB",
            eligiblePositions: ["QB"],
            rosterStatus: "rostered",
            actual: { basis: { type: "season" }, stats: [{ statId: 11, value: 4 }] },
            projected: undefined,
          },
        ],
      });
      const teamId = Array.getUnsafe(seeded, 0).id;
      const roster = yield* queries.getRosters(owner, { team: teamId });
      assert.strictEqual(roster.status, "ok");
      if (roster.status !== "ok") {
        return;
      }

      const hydrated = yield* queries.getPlayers(owner, {
        team: teamId,
        players: [Array.getUnsafe(roster.players, 0).player],
        groups: ["actual_stats", "projections"],
      });

      assert.strictEqual(hydrated.status, "ok");
      if (hydrated.status !== "ok") {
        return;
      }
      const player = Array.getUnsafe(hydrated.players, 0);
      assert.strictEqual(player.actualStats?.status, "available");
      if (player.actualStats?.status === "available") {
        assert.strictEqual(player.actualStats.basis, "season");
        assert.strictEqual(player.actualStats.period, undefined);
        assert.strictEqual(Array.getUnsafe(player.actualStats.stats, 0).value, 4);
      }
      assert.strictEqual(player.projections?.status, "unsupported");
      assert.strictEqual(hydrated.period, undefined);
      assert.deepStrictEqual(hydrated.failures, []);
      assert.isTrue(
        hydrated.coverage.some(
          (entry) =>
            entry.resource === "players" &&
            entry.detail === "Actual statistics use the season basis.",
        ),
      );
    }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("never pairs an unsupported stat group with a period failure", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const roster = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok") {
      return;
    }
    const ref = Array.getUnsafe(roster.players, 0).player;
    yield* fake.failPlayerDetails(
      ProviderPeriodMismatch.make({
        operation: "read_player_details",
        requestedWeek: 3,
        coveredWeek: null,
      }),
    );

    const hydrated = yield* queries.getPlayers(owner, {
      team: teamId,
      players: [ref],
      period: { week: 3 },
      groups: ["actual_stats", "projections"],
    });

    assert.strictEqual(hydrated.status, "ok");
    if (hydrated.status !== "ok") {
      return;
    }
    const player = Array.getUnsafe(hydrated.players, 0);
    assert.strictEqual(player.actualStats?.status, "unsupported");
    if (player.actualStats?.status === "unsupported") {
      assert.include(player.actualStats.detail, "did not report a weekly period");
    }
    assert.strictEqual(player.projections?.status, "unsupported");
    assert.deepStrictEqual(hydrated.failures, []);
    const detailsCoverage = hydrated.coverage.find(
      (entry) => entry.resource === "players" && entry.status === "degraded",
    );
    assert.include(detailsCoverage?.detail, "did not report a weekly period");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reads a date-scoped roster without inventing a week", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      roster: rosterFixture({ count: 2, coverage: { type: "date", date: "2026-10-25" } }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;

    const roster = yield* queries.getRosters(owner, { team: teamId });

    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok") {
      return;
    }
    assert.strictEqual(roster.period, undefined);
    assert.strictEqual(roster.players.length, 2);
    assert.isTrue(
      roster.coverage.some((entry) => entry.resource === "roster" && entry.status === "available"),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports add/drop transactions without inventing execution", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setTransactions([
      {
        occurredAt: "2026-09-20T12:00:00.000Z",
        type: "add_drop",
        status: "successful",
        teams: [
          { providerTeamKey: "461.l.1000.t.1", name: "Alpha" },
          { providerTeamKey: "461.l.1000.t.2", name: "Beta" },
        ],
        players: [
          transactionPlayer("461.p.10003", "add", "Synthetic Addition"),
          transactionPlayer("461.p.10001", "drop", "Synthetic Drop"),
        ],
      },
    ]);

    const transactions = yield* queries.getTransactions(owner, {
      team: Array.getUnsafe(seeded, 0).id,
    });

    assert.strictEqual(transactions.status, "ok");
    if (transactions.status !== "ok") {
      return;
    }
    assert.strictEqual(transactions.transactions.length, 1);
    const transaction = Array.getUnsafe(transactions.transactions, 0);
    assert.strictEqual(transaction.type, "add_drop");
    assert.strictEqual(transaction.teams.length, 2);
    assert.strictEqual(transaction.players.length, 2);
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

it.effect("fits both representations a client receives inside the hard byte limit", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      roster: rosterFixture({
        count: 40,
        name: '"Joueur Élite 名前"',
      }),
    });

    const teamId = Array.getUnsafe(seeded, 0).id;
    const page = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });

    assert.strictEqual(page.status, "ok");
    if (page.status !== "ok") {
      return;
    }
    assert.isAtMost(receivedToolResultBytes(page), page.budget.hardLimitBytes);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

function summarySectionBytes(summary: TeamSummaryResult): number {
  const structuredContent = Schema.encodeSync(Schema.toCodecJson(TeamSummaryResult))(summary);
  const received = JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: false,
  });
  return new TextEncoder().encode(received).length;
}

function receivedToolResultBytes(page: RosterResult): number {
  const structuredContent = Schema.encodeSync(Schema.toCodecJson(RosterResult))(page);
  const received = JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: false,
  });
  return new TextEncoder().encode(received).length;
}

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

it.effect("reads standings with category totals and marks the linked team", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setStandings({
      providerLeagueKey: "461.l.1000",
      teams: [
        {
          providerTeamKey: "461.l.1000.t.1",
          name: "Alpha",
          rank: 1,
          playoffSeed: 2,
          record: { wins: 8, losses: 3, ties: 0, percentage: 0.727 },
          gamesBack: null,
          pointsBack: null,
          points: 1234.5,
          pointsFor: 1234.5,
          pointsAgainst: 1100,
          streak: { type: "win", value: 3 },
          categoryTotals: [
            { statId: 4, value: 3120 },
            { statId: 20, value: 980 },
          ],
          categoryPoints: [],
        },
        {
          providerTeamKey: "461.l.1000.t.2",
          name: "Beta",
          rank: 2,
          playoffSeed: null,
          record: { wins: 5, losses: 6, ties: 0, percentage: 0.455 },
          gamesBack: null,
          pointsBack: null,
          points: 1090.25,
          pointsFor: 1090.25,
          pointsAgainst: 1142,
          streak: undefined,
          categoryTotals: [{ statId: 4, value: 2800 }],
          categoryPoints: [],
        },
      ],
    });

    const league = yield* queries.getLeague(owner, {
      team: teamId,
      groups: ["standings"],
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok" || league.standings?.status !== "available") {
      assert.fail("expected available standings");
      return;
    }
    assert.strictEqual(league.standings.format, "head_to_head_points");
    assert.strictEqual(league.standings.teams.length, 2);
    assert.isTrue(Array.getUnsafe(league.standings.teams, 0).current);
    assert.isFalse(Array.getUnsafe(league.standings.teams, 1).current);
    assert.strictEqual(Array.getUnsafe(league.standings.teams, 0).rank, 1);
    assert.deepStrictEqual(Array.getUnsafe(league.standings.teams, 0).record, {
      wins: 8,
      losses: 3,
      ties: 0,
      percentage: 0.727,
    });
    assert.strictEqual(Array.getUnsafe(league.standings.teams, 0).categories.length, 2);
    assert.strictEqual(league.standings.categoryTotals.status, "available");
    assert.strictEqual(league.standings.categoryPoints.status, "unsupported");
    assert.strictEqual(league.page.complete, true);
    assert.isTrue(
      league.coverage.some(
        (entry) => entry.resource === "standings" && entry.status === "available",
      ),
    );
    assert.isFalse(includesText(league, "461.l.1000"));
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports rotisserie standings without inventing a record or weekly matchup", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Roto", "nhl")], {
      league: rotoLeagueFixture,
      roster: rosterFixture({
        count: 2,
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
        coverage: { type: "date", date: "2026-10-20" },
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setStandings({
      providerLeagueKey: "465.l.2000",
      teams: [
        {
          providerTeamKey: "465.l.2000.t.1",
          name: "Roto",
          rank: 1,
          playoffSeed: null,
          record: undefined,
          gamesBack: null,
          pointsBack: 0,
          points: 86.5,
          pointsFor: 86.5,
          pointsAgainst: null,
          streak: undefined,
          categoryTotals: [{ statId: 1, value: 37 }],
          categoryPoints: [{ statId: 1, value: 12 }],
        },
      ],
    });

    const league = yield* queries.getLeague(owner, { team: teamId, groups: ["standings"] });
    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok" || league.standings?.status !== "available") {
      assert.fail("expected available rotisserie standings");
      return;
    }
    assert.strictEqual(league.standings.format, "rotisserie");
    assert.isUndefined(Array.getUnsafe(league.standings.teams, 0).record);
    assert.strictEqual(Array.getUnsafe(league.standings.teams, 0).pointsBack, 0);
    assert.strictEqual(Array.getUnsafe(league.standings.teams, 0).categoryPoints.length, 1);

    const matchups = yield* queries.getMatchups(owner, { team: teamId, period: { week: 4 } });
    assert.strictEqual(matchups.status, "unsupported");
    if (matchups.status === "unsupported") {
      assert.isTrue(
        matchups.coverage.some(
          (entry) => entry.resource === "matchups" && entry.status === "unsupported",
        ),
      );
    }

    const summary = yield* queries.getTeamSummary(owner, { team: teamId });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(summary.league.status, "available");
    assert.strictEqual(summary.standing.status, "available");
    assert.strictEqual(summary.record.status, "unsupported");
    assert.strictEqual(summary.categoryPoints.status, "available");
    assert.strictEqual(summary.matchup.status, "unsupported");
    assert.isTrue(summary.roster.length > 0);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("degrades one team summary section without failing the snapshot", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.failStandings(
      ProviderResponseInvalid.make({ operation: "read_standings", field: "league.standings" }),
    );

    const summary = yield* queries.getTeamSummary(owner, { team: teamId });

    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(summary.league.status, "available");
    assert.strictEqual(summary.standings.status, "unsupported");
    assert.strictEqual(summary.standing.status, "unsupported");
    assert.strictEqual(summary.matchup.status, "available");
    assert.strictEqual(summary.roster.length, 2);
    assert.isTrue(
      summary.coverage.some(
        (entry) => entry.resource === "standings" && entry.status === "degraded",
      ),
    );
    assert.isTrue(summary.failures.some((failure) => failure.code === "provider_invalid_response"));
    assert.strictEqual(summary.schedule.status, "unsupported");
    if (summary.schedule.status === "unsupported") {
      assert.include(summary.schedule.detail, "bye week");
    }
    assert.strictEqual(summary.probableStarters.status, "unsupported");
    assert.include(summary.probableStarters.detail, "probable-starter");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("filters transactions by scope and date inside the bounded provider window", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setTransactions([
      {
        occurredAt: "2026-09-24T12:00:00.000Z",
        type: "add",
        status: "successful",
        teams: [{ providerTeamKey: "461.l.1000.t.1", name: "Alpha" }],
        players: [transactionPlayer("461.p.10003", "add", "Synthetic Addition")],
      },
      {
        occurredAt: "2026-09-20T12:00:00.000Z",
        type: "drop",
        status: "successful",
        teams: [{ providerTeamKey: "461.l.1000.t.2", name: "Beta" }],
        players: [transactionPlayer("461.p.10004", "drop", "Synthetic Rival Drop")],
      },
      {
        occurredAt: "2026-09-10T12:00:00.000Z",
        type: "add",
        status: "successful",
        teams: [{ providerTeamKey: "461.l.1000.t.1", name: "Alpha" }],
        players: [transactionPlayer("461.p.10005", "add", "Synthetic Older Add")],
      },
    ]);

    const own = yield* queries.getTransactions(owner, { team: teamId, scope: "team" });
    assert.strictEqual(own.status, "ok");
    if (own.status !== "ok") {
      return;
    }
    assert.strictEqual(own.transactions.length, 2);
    assert.strictEqual(own.window.fetched, 2);
    assert.isFalse(own.window.truncated);

    const ranged = yield* queries.getTransactions(owner, {
      team: teamId,
      since: DateTime.makeUnsafe("2026-09-15T00:00:00.000Z"),
    });
    assert.strictEqual(ranged.status, "ok");
    if (ranged.status !== "ok") {
      return;
    }
    assert.strictEqual(ranged.transactions.length, 2);
    assert.strictEqual(ranged.window.fetched, 3);

    const invalid = yield* Effect.flip(
      queries.getTransactions(owner, {
        team: teamId,
        since: DateTime.makeUnsafe("2026-09-25T00:00:00.000Z"),
        until: DateTime.makeUnsafe("2026-09-01T00:00:00.000Z"),
      }),
    );
    assert.strictEqual(invalid._tag, "query.selection_invalid");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports a truncated transaction window instead of silently narrowing a date range", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setTransactions(
      globalThis.Array.from({ length: 50 }, (_, index) => ({
        occurredAt: DateTime.formatIso(
          DateTime.makeUnsafe("2026-09-25T12:00:00.000Z").pipe(DateTime.subtract({ hours: index })),
        ),
        type: "add" as const,
        status: "successful",
        teams: [{ providerTeamKey: "461.l.1000.t.1", name: "Alpha" }],
        players: [transactionPlayer("461.p.10003", "add" as const, "Synthetic Addition")],
      })),
    );

    const ranged = yield* queries.getTransactions(owner, {
      team: teamId,
      since: DateTime.makeUnsafe("2026-08-01T00:00:00.000Z"),
    });
    assert.strictEqual(ranged.status, "ok");
    if (ranged.status !== "ok") {
      return;
    }
    assert.isTrue(ranged.window.truncated);
    assert.isTrue(
      ranged.coverage.some(
        (entry) => entry.resource === "transactions" && entry.status === "degraded",
      ),
    );
    assert.isTrue(
      ranged.failures.some((failure) => failure.code === "transaction_window_truncated"),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("resolves a league stat reference for a stat-ordered player search", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const league = yield* queries.getLeague(owner, { team: teamId, groups: ["scoring"] });
    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok") {
      return;
    }
    const stat = Array.getUnsafe(league.scoring, 0).stat;

    const ordered = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "stat",
      stat,
    });
    assert.strictEqual(ordered.status, "ok");

    const unknown = yield* Effect.flip(
      queries.searchPlayers(owner, {
        team: teamId,
        sort: "stat",
        stat: unknownStatRef,
      }),
    );
    assert.strictEqual(unknown._tag, "query.selection_invalid");

    const missing = yield* Effect.flip(
      queries.searchPlayers(owner, { team: teamId, sort: "stat" }),
    );
    assert.strictEqual(missing._tag, "query.selection_invalid");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("refuses a weekly player sort for hockey instead of forwarding a rejected request", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
      league: hockeyLeagueFixture,
      roster: rosterFixture({
        count: 2,
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
        coverage: { type: "date", date: "2026-10-20" },
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;

    const rejected = yield* Effect.flip(
      queries.searchPlayers(owner, {
        team: teamId,
        availability: "free_agent",
        sort: "actual_rank",
        statPeriod: "week",
      }),
    );
    assert.strictEqual(rejected._tag, "query.selection_invalid");
    if (rejected._tag === "query.selection_invalid") {
      assert.include(rejected.detail, "weekly player sorts for hockey");
    }

    const season = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "actual_rank",
      statPeriod: "season",
    });
    assert.strictEqual(season.status, "ok");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("carries the professional team on every compact roster entry", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;

    const roster = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok") {
      return;
    }
    assert.strictEqual(roster.players[0]?.proTeam, "SYN");
    assert.isNull(roster.players[1]?.proTeam);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports this week's and next week's remaining player-games for hockey", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
      league: hockeyLeagueFixture,
      roster: rosterFixture({
        count: 2,
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
        coverage: { type: "date", date: "2026-10-20" },
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setMatchups([
      matchupFixture({
        period: 3,
        remaining: {
          home: { week: 3, completed: 51, live: 3, remaining: 0 },
          away: { week: 3, completed: 48, live: 2, remaining: 4 },
        },
      }),
      matchupFixture({
        period: 4,
        remaining: {
          home: { week: 4, completed: 0, live: 0, remaining: 46 },
          away: { week: 4, completed: 0, live: 0, remaining: 49 },
        },
      }),
    ]);

    const matchups = yield* queries.getMatchups(owner, { team: teamId, period: { week: 3 } });
    assert.strictEqual(matchups.status, "ok");
    if (matchups.status === "ok") {
      assert.strictEqual(matchups.schedule.status, "available");
      if (matchups.schedule.status === "available") {
        assert.strictEqual(matchups.schedule.unit, "fantasy_team_player_games");
      }
    }

    const summary = yield* queries.getTeamSummary(owner, { team: teamId });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(summary.schedule.status, "available");
    if (summary.schedule.status !== "available") {
      return;
    }
    assert.strictEqual(summary.schedule.unit, "fantasy_team_player_games");
    assert.strictEqual(summary.schedule.weeks.length, 2);
    assert.deepStrictEqual(Array.getUnsafe(summary.schedule.weeks, 0), {
      period: { week: 3 },
      current: true,
      completed: 51,
      live: 3,
      remaining: 0,
    });
    assert.deepStrictEqual(Array.getUnsafe(summary.schedule.weeks, 1), {
      period: { week: 4 },
      current: false,
      completed: 0,
      live: 0,
      remaining: 46,
    });
    assert.isTrue(
      summary.coverage.some(
        (entry) => entry.resource === "schedule" && entry.status === "available",
      ),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("fits a multi-section team summary inside the result budget", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      roster: rosterFixture({ count: 40 }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setStandings({
      providerLeagueKey: "461.l.1000",
      teams: globalThis.Array.from({ length: 14 }, (_, index) => ({
        providerTeamKey: `461.l.1000.t.${String(index + 1)}`,
        name: `Synthetic Team ${String(index)}`,
        rank: index + 1,
        playoffSeed: null,
        record: { wins: 8, losses: 3, ties: 0, percentage: 0.727 },
        gamesBack: null,
        pointsBack: null,
        points: 1234.5,
        pointsFor: 1234.5,
        pointsAgainst: 1100,
        streak: undefined,
        categoryTotals: [
          { statId: 4, value: 3120 },
          { statId: 20, value: 980 },
        ],
        categoryPoints: [],
      })),
    });

    const summary = yield* queries.getTeamSummary(owner, { team: teamId });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.isFalse(summary.page.complete);
    assert.isString(summary.page.next);
    assert.isTrue(summary.page.returned < 40);
    assert.isTrue(summarySectionBytes(summary) <= 16_384);
    assert.strictEqual(summary.standings.status, "available");
    if (summary.standings.status === "available") {
      assert.strictEqual(summary.standings.teams.length, 14);
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

function transactionPlayer(
  providerPlayerKey: string,
  direction: "add" | "drop" | "incoming" | "outgoing",
  name: string,
): ProviderTransaction["players"][number] {
  return {
    providerPlayerKey,
    direction,
    name,
    primaryPosition: undefined,
    displayPosition: "WR",
    eligiblePositions: undefined,
  };
}

const unknownStatRef = Schema.decodeSync(StatRef)("s1.unknown");

const owner = decodeUserId("owner");
const session = Redacted.make("A1=test-session-cookie");

function seed(
  fake: FakeProviderWorld["Service"],
  teams: ReadonlyArray<ProviderTeam>,
  options: {
    readonly roster?: ProviderRoster;
    readonly league?: ProviderLeagueSettings;
    readonly playerDetails?: ReadonlyArray<ProviderPlayerDetail>;
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
    yield* fake.setPlayerDetails(options.playerDetails ?? playerDetails);
    yield* fake.setMatchups([
      {
        period: { week: 3 },
        home: {
          providerTeamKey: "461.l.1000.t.1",
          name: "Alpha",
          points: 101.5,
          projectedPoints: null,
          winProbability: null,
          remainingGames: undefined,
          categoryTotals: [],
        },
        away: {
          providerTeamKey: "461.l.1000.t.2",
          name: "Beta",
          points: 98,
          projectedPoints: null,
          winProbability: null,
          remainingGames: undefined,
          categoryTotals: [],
        },
        status: "final",
        isPlayoffs: undefined,
        isConsolation: undefined,
        isTied: undefined,
        weekStart: undefined,
        weekEnd: undefined,
        categoryWinners: [],
      },
    ]);
    yield* fake.setTransactions([
      {
        occurredAt: "2026-09-20T12:00:00.000Z",
        type: "add",
        status: "successful",
        teams: [{ providerTeamKey: "461.l.1000.t.1", name: "Alpha" }],
        players: [transactionPlayer("461.p.10003", "add", "Synthetic Addition")],
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

function matchupFixture(input: {
  readonly period: number;
  readonly remaining?: {
    readonly home?: {
      readonly week: number;
      readonly completed: number;
      readonly live: number;
      readonly remaining: number;
    };
    readonly away?: {
      readonly week: number;
      readonly completed: number;
      readonly live: number;
      readonly remaining: number;
    };
  };
  readonly categories?: boolean;
}): import("./Provider.ts").ProviderMatchup {
  const side = (
    key: string,
    name: string,
    remaining:
      | {
          readonly week: number;
          readonly completed: number;
          readonly live: number;
          readonly remaining: number;
        }
      | undefined,
  ): import("./Provider.ts").ProviderTeamScore => ({
    providerTeamKey: key,
    name,
    points: 10,
    projectedPoints: null,
    winProbability: null,
    remainingGames: remaining,
    categoryTotals: input.categories === true ? [{ statId: 1, value: 3 }] : [],
  });
  return {
    period: { week: input.period },
    home: side("465.l.2000.t.1", "Hockey", input.remaining?.home),
    away: side("465.l.2000.t.2", "Rival", input.remaining?.away),
    status: "midevent",
    isPlayoffs: false,
    isConsolation: false,
    isTied: false,
    weekStart: "2026-10-19",
    weekEnd: "2026-10-25",
    categoryWinners: [],
  };
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

const hockeyLeagueFixture: ProviderLeagueSettings = {
  providerLeagueKey: "465.l.2000",
  name: "Hockey League",
  webUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
  season: 2026,
  periodWindow: { currentWeek: 3, startWeek: 1, endWeek: 24 },
  startDate: "2026-10-01",
  endDate: "2027-04-10",
  teamCount: 10,
  scoringType: "head",
  scoringLabel: "H2H",
  weeklyDeadline: "daily",
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
  draftStatus: "postdraft",
  rosterPositions: [
    { position: "C", positionType: "P", count: 2, isStarting: true },
    { position: "BN", positionType: "B", count: 4, isStarting: false },
  ],
  statCategories: [
    {
      statId: 1,
      name: "Goals",
      displayName: "G",
      abbreviation: "G",
      group: "offense",
      enabled: true,
      positionTypes: ["P"],
    },
  ],
  statModifiers: [],
};

const rotoLeagueFixture: ProviderLeagueSettings = {
  providerLeagueKey: "465.l.2000",
  name: "Roto League",
  webUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
  season: 2026,
  periodWindow: undefined,
  startDate: "2026-10-01",
  endDate: "2027-04-10",
  teamCount: 10,
  scoringType: "roto",
  scoringLabel: "Roto",
  weeklyDeadline: undefined,
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
  draftStatus: "postdraft",
  rosterPositions: [
    {
      position: "C",
      positionType: "P",
      count: 2,
      isStarting: true,
    },
    {
      position: "BN",
      positionType: "B",
      count: 4,
      isStarting: false,
    },
  ],
  statCategories: [
    {
      statId: 1,
      name: "Goals",
      displayName: "G",
      abbreviation: "G",
      group: "offense",
      enabled: true,
      positionTypes: ["P"],
    },
  ],
  statModifiers: [],
};

const leagueFixture: ProviderLeagueSettings = {
  providerLeagueKey: "461.l.1000",
  name: "Alpha League",
  webUrl: "https://football.fantasysports.yahoo.com/f1/1000",
  season: 2026,
  periodWindow: { currentWeek: 3, startWeek: 1, endWeek: 17 },
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

function rosterFixture(input: {
  readonly count: number;
  readonly name?: string;
  readonly coverage?: ProviderRoster["coverage"];
  readonly providerTeamKey?: string;
  readonly providerLeagueKey?: string;
}): ProviderRoster {
  return {
    providerTeamKey: input.providerTeamKey ?? "461.l.1000.t.1",
    providerLeagueKey: input.providerLeagueKey ?? "461.l.1000",
    coverage: input.coverage ?? { type: "week", week: 3 },
    players: globalThis.Array.from({ length: input.count }, (_, index) => ({
      providerPlayerKey: `461.p.${String(10001 + index)}`,
      name:
        input.name === undefined ? `Synthetic ${String(index)}` : `${input.name} ${String(index)}`,
      displayPosition: "QB",
      primaryPosition: "QB",
      positionType: "O",
      proTeamAbbreviation: index === 0 ? "SYN" : undefined,
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
    actual: { basis: { type: "week" as const, week: 3 }, stats: [{ statId: 4, value: 275 }] },
    projected: undefined,
  },
  {
    providerPlayerKey: "461.p.10002",
    name: "Synthetic 1",
    primaryPosition: "QB",
    displayPosition: "QB",
    eligiblePositions: ["QB"],
    rosterStatus: "rostered" as const,
    actual: { basis: { type: "week" as const, week: 3 }, stats: [{ statId: 4, value: 0 }] },
    projected: undefined,
  },
  {
    providerPlayerKey: "461.p.10003",
    name: "Free Agent",
    primaryPosition: "RB",
    displayPosition: "RB",
    eligiblePositions: ["RB", "W/R"],
    rosterStatus: "free_agent" as const,
    actual: { basis: { type: "week" as const, week: 3 }, stats: [{ statId: 4, value: 0 }] },
    projected: undefined,
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
