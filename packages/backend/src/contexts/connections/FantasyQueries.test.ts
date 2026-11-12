import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { eq } from "drizzle-orm";
import { Array, Cause, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { providerSessionReconnectDetail } from "#contexts/connections/Connection.ts";
import { GameSourceRegistry, gameSourceRegistryOf } from "#contexts/connections/GameSource.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

import { Connections } from "./Connections.ts";
import { FantasyQueries } from "./FantasyQueries.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { providerTeamAgentNotes, providerTeams } from "./internal/ConnectionTables.ts";
import {
  FakeGameSourceWorld,
  fakeGame,
  fakeGameSourceLayer,
} from "./internal/FakeGameSourceTest.ts";
import { FantasyQueriesLive } from "./internal/FantasyQueriesLive.ts";
import { ProfessionalCalendarLive } from "./internal/ProfessionalCalendarLive.ts";
import { FakeProviderWorld } from "./internal/ProviderFakeTest.ts";
import { ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { QueryTokens } from "./internal/QueryTokens.ts";
import { declaredRosterConstraints } from "./internal/RosterConstraintsTest.ts";
import { ScheduleObservationRepository } from "./internal/ScheduleObservationRepository.ts";
import { ProfessionalCalendar } from "./ProfessionalCalendar.ts";
import type {
  ProviderAcquisitionUsage,
  ProviderSchedulePeriod,
  ProviderLeaguePlayerSearch,
  ProviderLeagueRoster,
  ProviderLeagueSettings,
  ProviderTransaction,
  ProviderTransactionMovement,
  ProviderTransactionTeam,
  ProviderTransactionTrend,
  ProviderPlayerDetail,
  ProviderPlayerSearchResult,
  ProviderRoster,
  ProviderRosterPosition,
  ProviderStandings,
  ProviderTeam,
} from "./Provider.ts";
import { ProviderPeriodMismatch, ProviderResponseInvalid } from "./Provider.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";
import {
  type PlayerDraft,
  RosterResult,
  TeamSummaryData,
  TeamSummaryResult,
} from "./QueryResults.ts";
import { StatRef } from "./QueryValues.ts";
import { type QueryError, QuerySelectionInvalid, QueryTeamNotFound } from "./QueryValues.ts";

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
    assert.deepStrictEqual(calendar.week, {
      status: "available",
      current: 3,
      start: 1,
      end: 17,
    });
    assert.isUndefined(calendar.games);
    assert.notInclude(encodedKeys(calendar), "lockContext");
    assert.notInclude(encodedKeys(calendar), "historical");
    assert.deepStrictEqual(calendar.dates, { start: "2026-09-03", end: "2026-12-28" });

    const other = yield* Effect.flip(
      queries.getCalendar(decodeUserId("other"), { team: Array.getUnsafe(seeded, 0).id }),
    );
    assert.instanceOf(other, QueryTeamNotFound);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("answers which professional teams play in a requested period", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setSchedule(
      scheduleFixture({
        providerTeamKey: "461.l.1000.t.1",
        dates: ["2026-09-20"],
        players: [
          {
            key: "461.p.10001",
            name: "Synthetic 0",
            proTeamAbbreviation: "SEA",
            games: [{ date: undefined, opponent: "PIT", home: true }],
          },
          {
            key: "461.p.10002",
            name: "Synthetic 1",
            proTeamAbbreviation: "SEA",
            games: [{ date: undefined, opponent: "PIT", home: true }],
          },
          {
            key: "461.p.10003",
            name: "Synthetic 2",
            proTeamAbbreviation: "PIT",
            games: [],
          },
        ],
      }),
    );

    const calendar = yield* queries.getCalendar(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      period: { week: 3 },
      proTeams: ["SEA", "PIT", "MISSING"],
    });

    assert.strictEqual(calendar.status, "ok");
    if (calendar.status !== "ok") {
      return;
    }
    const games = calendar.games;
    assert.strictEqual(games?.status, "available");
    if (games?.status !== "available") {
      return;
    }
    assert.deepStrictEqual(games.period, { week: 3 });
    assert.isTrue(DateTime.isDateTime(games.observedAt));
    assert.deepStrictEqual(games.teams, [
      {
        proTeam: "SEA",
        plays: true,
        games: [{ opponent: "PIT", home: true }],
      },
      { proTeam: "PIT", plays: false, games: [] },
    ]);
    assert.deepStrictEqual(games.notCovered, ["MISSING"]);
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
    assert.deepStrictEqual(league.week, {
      status: "available",
      current: 3,
      start: 1,
      end: 17,
    });
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
    assert.strictEqual(league.scoring?.length, 2);
    assert.strictEqual(Array.getUnsafe(league.scoring ?? [], 0).points, "0.04");
    assert.strictEqual(Array.getUnsafe(league.scoring ?? [], 1).points, null);
    assert.strictEqual(league.standings?.status, "unsupported");
    assert.isTrue(
      league.coverage.some(
        (entry) => entry.resource === "standings" && entry.status === "unsupported",
      ),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "publishes every transaction rule the league declares, including the caps that apply",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
        league: {
          ...leagueFixture,
          waiverDays: 2,
          maxWeeklyAcquisitions: 7,
          maxSeasonAcquisitions: 30,
          tradeEndDate: "2026-11-20",
          tradeRatification: "commissioner",
          tradeDraftPicks: undefined,
          tradeObjectionDays: 2,
          maxGamesPlayed: 48,
          maxInningsPitched: undefined,
        },
      });

      const league = yield* queries.getLeague(owner, {
        team: Array.getUnsafe(seeded, 0).id,
        groups: ["overview"],
      });

      assert.strictEqual(league.status, "ok");
      if (league.status !== "ok") {
        return;
      }
      const rules = league.overview?.transactionRules;
      assert.deepStrictEqual(rules?.waiver, {
        type: { status: "published", value: "FR" },
        rule: { status: "published", value: "continuous" },
        usesFaab: { status: "published", value: false },
      });
      assert.deepStrictEqual(rules?.timing.weeklyDeadline, { status: "not_set" });
      assert.strictEqual(rules?.timing.rosterChange?.status, "not_published");
      assert.deepStrictEqual(rules?.timing.waiverDays, { status: "published", value: 2 });
      assert.deepStrictEqual(rules?.acquisitionLimits, {
        weekly: { status: "published", value: 7 },
        season: { status: "published", value: 30 },
      });
      assert.deepStrictEqual(rules?.trades, {
        endDate: { status: "published", value: "2026-11-20" },
        ratification: { status: "published", value: "commissioner" },
        objectionDays: { status: "published", value: 2 },
        draftPicks: { status: "not_set" },
      });
      assert.deepStrictEqual(rules?.gamesCaps, {
        gamesPlayed: { status: "published", value: 48 },
        inningsPitched: { status: "not_set" },
      });
    }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("keeps the raw deadline and publishes its decoded roster-change rule", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const detail =
      "Your league's weekly_deadline is empty and its edit_key is 2026-10-26, the day after your league's current_date 2026-10-25, so a roster move takes effect the next day.";
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      league: {
        ...leagueFixture,
        weeklyDeadline: "",
        rosterChange: {
          rule: "next_day",
          source: ["weekly_deadline", "edit_key"],
          detail,
        },
      },
    });

    const league = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["overview"],
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok") {
      return;
    }
    const timing = league.overview?.transactionRules.timing;
    assert.deepStrictEqual(timing?.weeklyDeadline, { status: "published", value: "" });
    assert.deepStrictEqual(timing?.rosterChange, {
      status: "published",
      value: "next_day",
      source: ["weekly_deadline", "edit_key"],
      detail,
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports a league's unset transaction rules as not set rather than zero", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);

    const league = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["overview"],
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok") {
      return;
    }
    const rules = league.overview?.transactionRules;
    assert.deepStrictEqual(rules?.acquisitionLimits, {
      weekly: { status: "not_set" },
      season: { status: "not_set" },
    });
    assert.deepStrictEqual(rules?.timing.waiverDays, { status: "not_set" });
    assert.deepStrictEqual(rules?.gamesCaps, {
      gamesPlayed: { status: "not_set" },
      inningsPitched: { status: "not_set" },
    });
    assert.notProperty(rules, "acquisitionUsage");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("publishes each team's acquisition usage beside the league limits", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      league: { ...leagueFixture, maxWeeklyAcquisitions: 7, maxSeasonAcquisitions: 30 },
    });
    yield* fake.setStandings({
      providerLeagueKey: "461.l.1000",
      teams: [
        standingWithUsage("461.l.1000.t.1", "Alpha", 1, {
          seasonMoves: 12,
          weeklyAdds: { used: 3, coverage: { type: "week", week: 3 } },
        }),
        standingWithUsage("461.l.1000.t.2", "Beta", 2, {
          seasonMoves: 24,
          weeklyAdds: { used: 7, coverage: { type: "week", week: 3 } },
        }),
      ],
    });

    const league = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["standings"],
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok" || league.standings?.status !== "available") {
      assert.fail("expected available standings");
      return;
    }
    assert.deepStrictEqual(league.standings.acquisitionLimits, {
      weekly: { status: "published", value: 7 },
      season: { status: "published", value: 30 },
    });
    const [own, rival] = league.standings.teams;
    assert.deepStrictEqual(own?.acquisitionUsage, {
      status: "published",
      seasonMovesUsed: 12,
      weeklyAddsUsed: 3,
      coverage: { week: 3 },
      seasonMovesRemaining: 18,
      weeklyAddsRemaining: 4,
    });
    assert.deepStrictEqual(rival?.acquisitionUsage, {
      status: "published",
      seasonMovesUsed: 24,
      weeklyAddsUsed: 7,
      coverage: { week: 3 },
      seasonMovesRemaining: 6,
      weeklyAddsRemaining: 0,
    });
    assert.include(league.standings.detailNote, "No per-team games-played count");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("publishes usage without a remaining count when the league sets no limit", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setStandings({
      providerLeagueKey: "461.l.1000",
      teams: [
        standingWithUsage("461.l.1000.t.1", "Alpha", 1, {
          seasonMoves: 4,
          weeklyAdds: { used: 0, coverage: { type: "week", week: 3 } },
        }),
      ],
    });

    const league = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["standings"],
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok" || league.standings?.status !== "available") {
      assert.fail("expected available standings");
      return;
    }
    assert.deepStrictEqual(league.standings.acquisitionLimits, {
      weekly: { status: "not_set" },
      season: { status: "not_set" },
    });
    assert.deepStrictEqual(Array.getUnsafe(league.standings.teams, 0).acquisitionUsage, {
      status: "published",
      seasonMovesUsed: 4,
      weeklyAddsUsed: 0,
      coverage: { week: 3 },
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports a team with no published counters as not published rather than zero", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setStandings({
      providerLeagueKey: "461.l.1000",
      teams: [
        standingWithUsage("461.l.1000.t.1", "Alpha", 1, {
          seasonMoves: undefined,
          weeklyAdds: undefined,
        }),
      ],
    });

    const league = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["standings"],
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok" || league.standings?.status !== "available") {
      assert.fail("expected available standings");
      return;
    }
    assert.deepStrictEqual(Array.getUnsafe(league.standings.teams, 0).acquisitionUsage, {
      status: "not_published",
      detail:
        "Your league published neither a season move count nor a weekly adds count for this team.",
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("carries the owning team's acquisition usage on the team summary", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      league: { ...leagueFixture, maxWeeklyAcquisitions: 7, maxSeasonAcquisitions: 30 },
    });
    yield* fake.setStandings({
      providerLeagueKey: "461.l.1000",
      teams: [
        standingWithUsage("461.l.1000.t.1", "Alpha", 1, {
          seasonMoves: 12,
          weeklyAdds: { used: 3, coverage: { type: "week", week: 3 } },
        }),
        standingWithUsage("461.l.1000.t.2", "Beta", 2, {
          seasonMoves: 24,
          weeklyAdds: { used: 7, coverage: { type: "week", week: 3 } },
        }),
      ],
    });

    const summary = yield* queries.getTeamSummary(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["standings"],
    });

    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok" || summary.acquisitionUsage?.status !== "available") {
      assert.fail("expected the summary's acquisition usage");
      return;
    }
    assert.deepStrictEqual(summary.acquisitionUsage.limits, {
      weekly: { status: "published", value: 7 },
      season: { status: "published", value: 30 },
    });
    assert.deepStrictEqual(summary.acquisitionUsage.usage, {
      status: "published",
      seasonMovesUsed: 12,
      weeklyAddsUsed: 3,
      coverage: { week: 3 },
      seasonMovesRemaining: 18,
      weeklyAddsRemaining: 4,
    });
    assert.strictEqual(summary.acquisitionUsage.gamesPlayedUsage.status, "not_published");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("publishes an innings cap only for a league that declares one", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
      league: { ...hockeyLeagueFixture, maxInningsPitched: 1400 },
    });

    const league = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["overview"],
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(league.overview?.transactionRules.gamesCaps, {
      gamesPlayed: { status: "not_set" },
      inningsPitched: { status: "published", value: 1400 },
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("marks your league category the league does not score as informational", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      league: {
        ...leagueFixture,
        statCategories: [
          {
            statId: 1,
            name: "Goals",
            displayName: "Goals",
            abbreviation: "G",
            group: "offense",
            enabled: true,
            displayOnly: false,
            positionTypes: ["P"],
          },
          {
            statId: 25,
            name: "Saves",
            displayName: "Saves",
            abbreviation: "SV",
            group: "goaltending",
            enabled: true,
            displayOnly: true,
            positionTypes: ["P"],
          },
        ],
      },
    });

    const league = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["scoring"],
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok") {
      return;
    }
    const scoring = league.scoring ?? [];
    assert.deepStrictEqual(
      scoring.map((category) => ({
        abbreviation: category.abbreviation,
        scoring: category.scoring,
        detail: category.detail,
      })),
      [
        { abbreviation: "G", scoring: "scoring", detail: undefined },
        {
          abbreviation: "SV",
          scoring: "informational",
          detail:
            "Your league marks this stat display-only for this league, so it appears for information and does not score.",
        },
      ],
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
    if (roster.status === "ok" && roster.scope === "team") {
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
        rosterCoverage: "date",
        maxGamesPlayed: undefined,
        maxInningsPitched: undefined,
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
      assert.deepStrictEqual(calendar.week, { status: "unsupported", reason: "not_published" });
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
      assert.deepStrictEqual(league.week, { status: "unsupported", reason: "not_published" });
      assert.strictEqual(league.overview?.scoringType, "head");
    }

    assert.strictEqual(roster.status, "ok");
    if (roster.status === "ok" && roster.scope === "team") {
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
    if (
      compact.status !== "ok" ||
      compact.scope !== "team" ||
      full.status !== "ok" ||
      full.scope !== "team"
    ) {
      return;
    }
    assert.strictEqual(compact.scope, "team");
    assert.strictEqual(compact.players.length, 2);
    assert.strictEqual(compact.period?.week, 3);
    assert.notInclude(encodedKeys(compact), "playerSchedule");
    const week = {
      period: { week: 3 },
      playsThisWeek: true,
      opponent: null,
      home: null,
      byeWeek: 7,
      projectedRank: null,
    };
    assert.deepStrictEqual(Array.getUnsafe(compact.players, 0).week, week);
    assert.deepStrictEqual(Array.getUnsafe(full.players, 0).week, week);
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

it.effect("publishes the site's starting status on team roster rows and the summary roster", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const roster = rosterFixture({ count: 3 });
    const statuses = ["confirmed-starting", "confirmed-not-starting", "unconfirmed"] as const;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      roster: {
        ...roster,
        players: roster.players.map((player, index) => ({
          ...player,
          startingLineup: statuses[index] ?? "unconfirmed",
        })),
      },
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setLeagueRosters([leagueRosterFixture("461.l.1000.t.1", "Alpha", 3, 10001)]);

    const teamRoster = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
    assert.strictEqual(yield* fake.readCount("read_roster"), 1);
    assert.strictEqual(teamRoster.status, "ok");
    if (teamRoster.status !== "ok" || teamRoster.scope !== "team") {
      return;
    }
    assert.deepStrictEqual(
      teamRoster.players.map((player) => player.startingStatus),
      ["confirmed_starting", "confirmed_not_starting", "unconfirmed"],
    );

    const summary = yield* queries.getTeamSummary(owner, { team: teamId, groups: ["roster"] });
    assert.strictEqual(yield* fake.readCount("read_roster"), 2);
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      summary.roster?.map((player) => player.startingStatus),
      ["confirmed_starting", "confirmed_not_starting", "unconfirmed"],
    );

    const leagueRoster = yield* queries.getRosters(owner, { team: teamId, scope: "league" });
    assert.strictEqual(yield* fake.readCount("read_league_rosters"), 1);
    assert.strictEqual(yield* fake.readCount("read_roster"), 2);
    assert.strictEqual(leagueRoster.status, "ok");
    if (leagueRoster.status !== "ok" || leagueRoster.scope !== "league") {
      return;
    }
    assert.deepStrictEqual(
      leagueRoster.teams.flatMap((entry) => entry.players.map((player) => player.startingStatus)),
      ["not_requested", "not_requested", "not_requested"],
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reads every team's roster in the linked league with team identity on each row", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const tokens = yield* Effect.provide(
      QueryTokens,
      QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars"),
    );
    const seeded = yield* seed(fake, [
      team("461.l.1000.t.1", "Alpha"),
      team("461.l.1000.t.3", "Gamma"),
    ]);
    const betaRoster = leagueRosterFixture("461.l.1000.t.2", "Beta", 3, 20001);
    yield* fake.setLeagueRosters([
      leagueRosterFixture("461.l.1000.t.1", "Alpha", 2, 10001),
      {
        ...betaRoster,
        players: betaRoster.players.map((player, index) =>
          index === 0 ? { ...player, scheduled: false, opponent: undefined, byeWeek: 3 } : player,
        ),
      },
      leagueRosterFixture("461.l.1000.t.3", "Gamma", 1, 30001),
    ]);
    yield* fake.setPlayerWeeks([
      {
        providerPlayerKey: "461.p.20001",
        week: 3,
        plays: false,
        opponent: undefined,
        projectedRank: 4,
      },
    ]);

    const before = yield* fake.providerReads;
    const read = yield* queries.getRosters(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      scope: "league",
    });

    assert.strictEqual((yield* fake.providerReads) - before, 2);
    assert.strictEqual(read.status, "ok");
    if (read.status !== "ok" || read.scope !== "league") {
      return;
    }
    assert.deepStrictEqual(read.period, { week: 3 });
    assert.deepStrictEqual(
      read.teams.map((row) => [row.name, row.owned, row.players.length]),
      [
        ["Alpha", true, 2],
        ["Beta", false, 3],
        ["Gamma", true, 1],
      ],
    );
    assert.deepStrictEqual(read.page, {
      returned: 3,
      complete: true,
      remaining: 0,
      size: 3,
      total: 3,
    });
    assert.deepStrictEqual(
      read.coverage.map((entry) => [entry.resource, entry.source, entry.status, entry.period]),
      [["roster", "league_rosters", "available", { week: 3 }]],
    );

    const opened = yield* tokens.openCounterpartyRefGroups({
      userId: owner,
      groups: read.teams.map((row) => ({ leagueKey: "461.l.1000", refs: [row.team] })),
    });
    assert.deepStrictEqual(
      opened.map((group) => group[0]),
      ["461.l.1000.t.1", "461.l.1000.t.2", "461.l.1000.t.3"],
    );
    assert.strictEqual(
      Array.getUnsafe(read.teams, 1)
        .players.map((player) => player.name)
        .join(","),
      "Beta Player 0,Beta Player 1,Beta Player 2",
    );
    assert.deepStrictEqual(Array.getUnsafe(Array.getUnsafe(read.teams, 1).players, 0).week, {
      period: { week: 3 },
      playsThisWeek: false,
      opponent: null,
      home: null,
      byeWeek: 3,
      projectedRank: 4,
    });
    assert.strictEqual(
      Array.getUnsafe(Array.getUnsafe(read.teams, 0).players, 0).week?.projectedRank,
      null,
    );
    assert.strictEqual(
      Array.getUnsafe(Array.getUnsafe(read.teams, 1).players, 1).injury.reported,
      true,
    );
    assert.isFalse(includesText(read, "461.l.1000.t.2"));
    assert.isFalse(includesText(read, "461.p.20001"));
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("pages league rosters by whole teams with a cursor", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setLeagueRosters([
      leagueRosterFixture("461.l.1000.t.1", "Alpha", 2, 10001),
      leagueRosterFixture("461.l.1000.t.2", "Beta", 3, 20001),
      leagueRosterFixture("461.l.1000.t.3", "Gamma", 1, 30001),
    ]);

    const teamId = Array.getUnsafe(seeded, 0).id;
    const before = yield* fake.providerReads;
    const first = yield* queries.getRosters(owner, { team: teamId, scope: "league", limit: 2 });

    assert.strictEqual((yield* fake.providerReads) - before, 2);
    assert.strictEqual(first.status, "ok");
    if (first.status !== "ok" || first.scope !== "league") {
      return;
    }
    assert.deepStrictEqual(
      first.teams.map((row) => [row.name, row.players.length]),
      [
        ["Alpha", 2],
        ["Beta", 3],
      ],
    );
    assert.deepStrictEqual(first.page, {
      returned: 2,
      complete: false,
      remaining: 1,
      next: first.page.next,
      size: 2,
      total: 3,
    });
    assert.isString(first.page.next);
    if (first.page.next === undefined) {
      return;
    }

    const moreReads = yield* fake.providerReads;
    const second = yield* queries.getRosters(owner, {
      team: teamId,
      scope: "league",
      limit: 2,
      cursor: first.page.next,
    });
    assert.strictEqual((yield* fake.providerReads) - moreReads, 2);
    assert.strictEqual(second.status, "ok");
    if (second.status !== "ok" || second.scope !== "league") {
      return;
    }
    assert.deepStrictEqual(
      second.teams.map((row) => [row.name, row.players.map((player) => player.name)]),
      [["Gamma", ["Gamma Player 0"]]],
    );
    assert.deepStrictEqual(second.page, {
      returned: 1,
      complete: true,
      remaining: 0,
      size: 1,
      total: 3,
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("refuses a league roster read for a team the account does not own", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setLeagueRosters([
      leagueRosterFixture("461.l.1000.t.1", "Alpha", 2, 10001),
      leagueRosterFixture("461.l.1000.t.2", "Beta", 3, 20001),
    ]);

    const before = yield* fake.providerReads;
    const refused = yield* Effect.flip(
      queries.getRosters(decodeUserId("other"), {
        team: Array.getUnsafe(seeded, 0).id,
        scope: "league",
      }),
    );

    assert.instanceOf(refused, QueryTeamNotFound);
    assert.strictEqual((yield* fake.providerReads) - before, 0);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("resolves an unowned player reference from a league roster read in get_players", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setLeagueRosters([
      leagueRosterFixture("461.l.1000.t.1", "Alpha", 2, 10001),
      leagueRosterFixture("461.l.1000.t.2", "Beta", 3, 20001),
    ]);
    yield* fake.setPlayerDetails([
      {
        providerPlayerKey: "461.p.20001",
        name: "Rival Player",
        primaryPosition: "QB",
        displayPosition: "QB",
        proTeam: "SYN",
        availabilityDetail: undefined,
        eligiblePositions: ["QB"],
        rosterStatus: "rostered",
        actual: undefined,
        projected: undefined,
      },
    ]);

    const league = yield* queries.getRosters(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      scope: "league",
    });
    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok" || league.scope !== "league") {
      return;
    }
    const rival = Array.getUnsafe(league.teams, 1);
    const rivalRef = Array.getUnsafe(rival.players, 0).player;

    const resolved = yield* queries.getPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      players: [rivalRef],
    });
    assert.strictEqual(resolved.status, "ok");
    if (resolved.status !== "ok") {
      return;
    }
    const player = Array.getUnsafe(resolved.players, 0);
    assert.strictEqual(player.player, rivalRef);
    assert.strictEqual(player.identity?.name, "Rival Player");
    assert.strictEqual(player.availability?.rosterStatus, "rostered");
    assert.deepStrictEqual(resolved.failures, []);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports a refused league roster read instead of an empty roster", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.unsupportedOperations(["read_league_rosters"]);

    const read = yield* queries.getRosters(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      scope: "league",
    });

    assert.strictEqual(read.status, "unsupported");
    if (read.status !== "unsupported" || read.scope !== "league") {
      return;
    }
    assert.deepStrictEqual(read.teams, []);
    assert.deepStrictEqual(
      read.coverage.map((entry) => [entry.resource, entry.source, entry.status]),
      [["roster", "league_rosters", "unsupported"]],
    );
    assert.deepStrictEqual(read.failures, []);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("refuses an exact period for a league roster read", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setLeagueRosters([leagueRosterFixture("461.l.1000.t.1", "Alpha", 2, 10001)]);

    const before = yield* fake.providerReads;
    const refused = yield* Effect.flip(
      queries.getRosters(owner, {
        team: Array.getUnsafe(seeded, 0).id,
        scope: "league",
        period: { week: 3 },
      }),
    );

    assert.strictEqual(refused._tag, "query.selection_invalid");
    assert.strictEqual((yield* fake.providerReads) - before, 0);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "publishes an unverified roster slot with its raw value in roster and summary reads",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const base = rosterFixture({ count: 2 });
      const unverified = {
        status: "unverified" as const,
        rawValue: "",
        reason:
          "Your league published an empty lineup slot for this player, so the slot and the position eligibility it would establish are unverified.",
      };
      const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
        roster: {
          ...base,
          players: base.players.map((player, index) =>
            index === 0 ? { ...player, slot: unverified } : player,
          ),
        },
      });
      const teamId = Array.getUnsafe(seeded, 0).id;

      const read = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
      assert.strictEqual(read.status, "ok");
      if (read.status !== "ok" || read.scope !== "team") {
        return;
      }
      assert.deepStrictEqual(read.players[0]?.slot, unverified);
      assert.deepStrictEqual(read.players[1]?.slot, { status: "verified", slot: "BN" });

      const summary = yield* queries.getTeamSummary(owner, { team: teamId, groups: ["roster"] });
      assert.strictEqual(summary.status, "ok");
      if (summary.status !== "ok") {
        return;
      }
      assert.deepStrictEqual(summary.roster?.[0]?.slot, unverified);
      assert.deepStrictEqual(summary.roster?.[1]?.slot, { status: "verified", slot: "BN" });
    }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "names a player whose eligible positions do not include the slot the league gave them",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const positions = [
        ...leagueFixture.rosterPositions,
        { position: "IR", positionType: "R", count: 1, kind: "reserve", eligibility: ["IR"] },
      ] satisfies ReadonlyArray<ProviderRosterPosition>;
      const league: ProviderLeagueSettings = {
        ...leagueFixture,
        rosterPositions: positions,
        rosterConstraints: declaredRosterConstraints(positions),
      };
      const base = rosterFixture({ count: 2 });
      const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
        league,
        roster: {
          ...base,
          players: base.players.map((player, index) =>
            index === 0
              ? { ...player, slot: { status: "verified", slot: "IR" }, eligiblePositions: ["QB"] }
              : player,
          ),
        },
      });

      const summary = yield* queries.getTeamSummary(owner, {
        team: Array.getUnsafe(seeded, 0).id,
        groups: ["roster"],
      });

      assert.strictEqual(summary.status, "ok");
      if (summary.status !== "ok") {
        return;
      }
      assert.deepStrictEqual(
        summary.illegalSlots?.map((entry) => ({
          name: entry.name,
          slot: entry.slot,
          eligiblePositions: entry.eligiblePositions,
          detail: entry.detail,
        })),
        [
          {
            name: "Synthetic 0",
            slot: "IR",
            eligiblePositions: ["QB"],
            detail:
              "Synthetic 0 is on the IR reserve list, but it does not accept their positions (QB).",
          },
        ],
      );

      const eligible = yield* seed(fake, [team("461.l.1001.t.1", "Beta")], {
        league,
        roster: {
          ...base,
          providerTeamKey: "461.l.1001.t.1",
          providerLeagueKey: "461.l.1001",
          players: base.players.map((player, index) =>
            index === 0
              ? {
                  ...player,
                  slot: { status: "verified", slot: "IR" },
                  eligiblePositions: ["QB", "IR"],
                }
              : player,
          ),
        },
      });
      const eligibleSummary = yield* queries.getTeamSummary(owner, {
        team: Array.getUnsafe(eligible, 0).id,
        groups: ["roster"],
      });
      assert.deepStrictEqual(
        eligibleSummary.status === "ok" ? eligibleSummary.illegalSlots : "not ok",
        [],
      );
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
      transaction({
        occurredAt: "2026-09-20T12:00:00.000Z",
        type: "add_drop",
        teams: [alphaTeam],
        players: [
          transactionPlayer(
            "461.p.10003",
            movement("add", undefined, alphaTeam),
            "Synthetic Addition",
          ),
          transactionPlayer(
            "461.p.10004",
            movement("drop", alphaTeam, undefined),
            "Dropped Veteran",
          ),
        ],
      }),
    ]);

    const transactions = yield* queries.getTransactions(owner, { team: teamId });
    assert.strictEqual(transactions.status, "ok");
    if (transactions.status !== "ok") {
      return;
    }
    const dropped = Array.getUnsafe(Array.getUnsafe(transactions.transactions, 0).players, 1);
    assert.strictEqual(dropped.movement.kind, "drop");
    assert.strictEqual(dropped.movement.to, null);

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
      draft: { status: "not_published" },
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

it.effect("hydrates a free agent's availability without the actual_stats group", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;

    const search = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    const freeAgent = Array.getUnsafe(search.players, 0);
    assert.strictEqual(freeAgent.name, "Free Agent");
    assert.strictEqual(freeAgent.availability, "free_agent");

    const hydrated = yield* queries.getPlayers(owner, {
      team: teamId,
      players: [freeAgent.player],
      groups: ["identity", "availability"],
    });

    assert.strictEqual(hydrated.status, "ok");
    if (hydrated.status !== "ok") {
      return;
    }
    const player = Array.getUnsafe(hydrated.players, 0);
    assert.isDefined(player.identity);
    assert.deepStrictEqual(player.availability, {
      rosterStatus: "free_agent",
      injury: { reported: false },
    });
    assert.deepStrictEqual(hydrated.failures, []);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("publishes an off-roster player's injury note instead of reporting none", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      playerDetails: playerDetails.map((detail) =>
        detail.providerPlayerKey === "461.p.10003"
          ? { ...detail, availabilityDetail: "Out indefinitely with a foot injury" }
          : detail,
      ),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;

    const search = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    const freeAgent = Array.getUnsafe(search.players, 0);
    const hydrated = yield* queries.getPlayers(owner, {
      team: teamId,
      players: [freeAgent.player],
      groups: ["identity", "availability"],
    });
    assert.strictEqual(hydrated.status, "ok");
    if (hydrated.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(Array.getUnsafe(hydrated.players, 0).availability, {
      rosterStatus: "free_agent",
      injury: { reported: true, detail: "Out indefinitely with a foot injury" },
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("names the input position of a player reference that does not open", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const roster = yield* queries.getRosters(owner, { team: teamId });
    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok" || roster.scope !== "team") {
      return;
    }
    const rosterRef = Array.getUnsafe(roster.players, 0).player;
    const foreignRef = yield* Effect.provide(
      Effect.flatMap(QueryTokens, (tokens) =>
        tokens.sealPlayerRef({
          userId: owner,
          leagueKey: "999.l.9999",
          playerKey: "461.p.10003",
        }),
      ),
      QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars"),
    );

    const hydrated = yield* queries.getPlayers(owner, {
      team: teamId,
      players: [rosterRef, foreignRef],
      groups: ["identity"],
    });

    assert.strictEqual(hydrated.status, "ok");
    if (hydrated.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      hydrated.players.map((row) => row.player),
      [rosterRef],
    );
    assert.strictEqual(hydrated.failures.length, 1);
    const [failure] = hydrated.failures;
    assert.strictEqual(failure?.code, "invalid_player_reference");
    assert.strictEqual(failure?.resource, foreignRef);
    assert.include(failure?.message, "input position 2");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports a requested availability your league does not publish", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const ref = yield* Effect.provide(
      Effect.flatMap(QueryTokens, (tokens) =>
        tokens.sealPlayerRef({
          userId: owner,
          leagueKey: "461.l.1000",
          playerKey: "461.p.99999",
        }),
      ),
      QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars"),
    );

    const hydrated = yield* queries.getPlayers(owner, {
      team: teamId,
      players: [ref],
      groups: ["identity", "availability"],
    });

    assert.strictEqual(hydrated.status, "unsupported");
    if (hydrated.status === "unsupported") {
      assert.isTrue(
        hydrated.failures.some((failure) => failure.code === "player_availability_unavailable"),
      );
    }
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
      assert.strictEqual(hydratedPlayer.actualStats.basis, "season");
      assert.strictEqual(hydratedPlayer.actualStats.period, undefined);
      assert.strictEqual(Array.getUnsafe(hydratedPlayer.actualStats.stats, 0).value, 0);
    }
    assert.deepStrictEqual(hydratedPlayer.projections, {
      status: "available",
      basis: "week",
      period: { week: 3 },
      rank: null,
    });
    assert.deepStrictEqual(hydrated.failures, []);
    assert.deepStrictEqual(hydrated.period, { kind: "season" });
    assert.strictEqual(hydrated.dictionary.length, 1);
    assert.strictEqual(Array.getUnsafe(hydrated.dictionary, 0).name, "Passing Yards");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("states each pool row's week, opponent, and projected rank", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "461.p.20001",
        name: "Playing Receiver",
        availability: "free_agent",
        actualRank: 4,
        overallRank: 4,
        statValue: null,
        percentOwned: 22,
        percentOwnedDelta: 3,
        percentStarted: 10,
        percentStartedChange: 1,
        proTeam: "SEA",
      }),
      searchFixture({
        providerPlayerKey: "461.p.20002",
        name: "Bye Receiver",
        availability: "free_agent",
        actualRank: 5,
        overallRank: 5,
        statValue: null,
        percentOwned: 71,
        percentOwnedDelta: -22,
        percentStarted: 21,
        percentStartedChange: -69,
        proTeam: "PIT",
      }),
    ]);
    yield* fake.setPlayerWeeks([
      {
        providerPlayerKey: "461.p.20001",
        week: 3,
        plays: true,
        opponent: { opponent: "SEA", home: false },
        projectedRank: 9,
      },
      {
        providerPlayerKey: "461.p.20002",
        week: 3,
        plays: false,
        opponent: undefined,
        projectedRank: undefined,
      },
    ]);

    const search = yield* queries.searchPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      sort: "name",
    });

    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      search.players.map((player) => [player.name, player.week]),
      [
        [
          "Bye Receiver",
          {
            period: { week: 3 },
            playsThisWeek: false,
            opponent: null,
            home: null,
            projectedRank: null,
          },
        ],
        [
          "Playing Receiver",
          {
            period: { week: 3 },
            playsThisWeek: true,
            opponent: "SEA",
            home: false,
            projectedRank: 9,
          },
        ],
      ],
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reads a pool's games by scoring week over several weeks", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "461.p.20001",
        name: "Playing Receiver",
        availability: "free_agent",
        actualRank: 4,
        overallRank: 4,
        statValue: null,
        percentOwned: 22,
        percentOwnedDelta: 3,
        percentStarted: 10,
        percentStartedChange: 1,
        proTeam: "SEA",
      }),
      searchFixture({
        providerPlayerKey: "461.p.20002",
        name: "Bye Receiver",
        availability: "free_agent",
        actualRank: 5,
        overallRank: 5,
        statValue: null,
        percentOwned: 71,
        percentOwnedDelta: -22,
        percentStarted: 21,
        percentStartedChange: -69,
        proTeam: "PIT",
      }),
    ]);
    yield* fake.setPlayerWeeks([
      {
        providerPlayerKey: "461.p.20001",
        week: 3,
        plays: true,
        opponent: { opponent: "SEA", home: false },
        projectedRank: 9,
      },
      {
        providerPlayerKey: "461.p.20002",
        week: 3,
        plays: false,
        opponent: undefined,
        projectedRank: undefined,
      },
      {
        providerPlayerKey: "461.p.20001",
        week: 4,
        plays: true,
        opponent: { opponent: "LA", home: true },
        projectedRank: undefined,
      },
      {
        providerPlayerKey: "461.p.20002",
        week: 4,
        plays: true,
        opponent: { opponent: "CIN", home: true },
        projectedRank: undefined,
      },
    ]);

    const current = yield* queries.searchPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      sort: "name",
      gamesWindow: { kind: "current" },
    });
    assert.strictEqual(current.status, "ok");
    if (current.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      current.players.map((player) => [player.name, player.gameWeeks]),
      [
        ["Bye Receiver", { status: "available", weeks: [] }],
        [
          "Playing Receiver",
          { status: "available", weeks: [{ week: 3, opponent: "SEA", home: false }] },
        ],
      ],
    );

    const search = yield* queries.searchPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      sort: "name",
      gamesWindow: { kind: "next_weeks", weeks: 2 },
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    assert.strictEqual(search.gamesWindow?.status, "available");
    if (search.gamesWindow?.status === "available" && search.gamesWindow.basis === "week") {
      assert.deepStrictEqual(search.gamesWindow.weeks, { first: 3, last: 4 });
      assert.isTrue(DateTime.isDateTime(search.gamesWindow.observedAt));
    }
    assert.deepStrictEqual(
      search.players.map((player) => [player.name, player.gameWeeks]),
      [
        [
          "Bye Receiver",
          { status: "available", weeks: [{ week: 4, opponent: "CIN", home: true }] },
        ],
        [
          "Playing Receiver",
          {
            status: "available",
            weeks: [
              { week: 3, opponent: "SEA", home: false },
              { week: 4, opponent: "LA", home: true },
            ],
          },
        ],
      ],
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("orders the pool by a recent window and states each row's rank", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl")], {
      league: hockeyLeagueFixture,
    });
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "465.p.30001",
        name: "Cold Goalie",
        availability: "free_agent",
        actualRank: 41,
        overallRank: 88,
        statValue: null,
        percentOwned: 6,
        percentOwnedDelta: 0,
        percentStarted: 3,
        percentStartedChange: 0,
        proTeam: "BOS",
        primaryPosition: "G",
        displayPosition: "G",
        recentRank: { window: { kind: "last_days", days: 14 }, rank: 193 },
      }),
      searchFixture({
        providerPlayerKey: "465.p.30002",
        name: "In Form Goalie",
        availability: "free_agent",
        actualRank: 99,
        overallRank: 120,
        statValue: null,
        percentOwned: 22,
        percentOwnedDelta: 11,
        percentStarted: 14,
        percentStartedChange: 4,
        proTeam: "TOR",
        primaryPosition: "G",
        displayPosition: "G",
        recentRank: { window: { kind: "last_days", days: 14 }, rank: 29 },
      }),
      searchFixture({
        providerPlayerKey: "465.p.30003",
        name: "Season Leader",
        availability: "free_agent",
        actualRank: 12,
        overallRank: 70,
        statValue: null,
        percentOwned: 35,
        percentOwnedDelta: 1,
        percentStarted: 20,
        percentStartedChange: 0,
        proTeam: "NYR",
        primaryPosition: "G",
        displayPosition: "G",
        recentRank: { window: { kind: "last_days", days: 14 }, rank: 16 },
      }),
      searchFixture({
        providerPlayerKey: "465.p.30004",
        name: "Unranked Goalie",
        availability: "free_agent",
        actualRank: 20,
        overallRank: 90,
        statValue: null,
        percentOwned: 2,
        percentOwnedDelta: 0,
        percentStarted: 0,
        percentStartedChange: 0,
        proTeam: "SEA",
        primaryPosition: "G",
        displayPosition: "G",
        recentRank: { window: { kind: "last_days", days: 14 }, rank: null },
      }),
    ]);

    const search = yield* queries.searchPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      positions: ["G"],
      availability: "free_agent",
      sort: "recent_rank",
      window: { kind: "last_days", days: 14 },
    });

    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      search.players.map((player) => [player.name, player.recentRank]),
      [
        ["Season Leader", { window: { kind: "last_days", days: 14 }, rank: 16 }],
        ["In Form Goalie", { window: { kind: "last_days", days: 14 }, rank: 29 }],
        ["Cold Goalie", { window: { kind: "last_days", days: 14 }, rank: 193 }],
        ["Unranked Goalie", { window: { kind: "last_days", days: 14 }, rank: null }],
      ],
    );
    assert.isTrue(
      search.players.every((player) => player.statValue === undefined),
      "a recent-rank ordering carries no season stat value",
    );
    assert.deepStrictEqual(search.failures, []);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "answers one neutral recent-form question in the same row shape for hockey and football",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl"), team("461.l.1000.t.1", "Alpha")], {
        league: hockeyLeagueFixture,
      });
      const listed = yield* queries.listTeams(owner, {});
      assert.strictEqual(listed.status, "ok");
      if (listed.status !== "ok") {
        return;
      }
      const hockeyTeam = listed.teams.find((entry) => entry.name === "Gamma")?.team;
      const footballTeam = listed.teams.find((entry) => entry.name === "Alpha")?.team;
      assert.isDefined(hockeyTeam);
      assert.isDefined(footballTeam);

      yield* fake.setSearchPlayers([
        searchFixture({
          providerPlayerKey: "465.p.30001",
          name: "Hockey Second",
          availability: "free_agent",
          actualRank: 20,
          overallRank: 40,
          statValue: null,
          percentOwned: 10,
          percentOwnedDelta: 0,
          percentStarted: 5,
          percentStartedChange: 0,
          primaryPosition: "G",
          displayPosition: "G",
          recentRank: { window: { kind: "last_days", days: 14 }, rank: 29 },
        }),
        searchFixture({
          providerPlayerKey: "465.p.30002",
          name: "Hockey First",
          availability: "free_agent",
          actualRank: 12,
          overallRank: 70,
          statValue: null,
          percentOwned: 35,
          percentOwnedDelta: 1,
          percentStarted: 20,
          percentStartedChange: 0,
          primaryPosition: "G",
          displayPosition: "G",
          recentRank: { window: { kind: "last_days", days: 14 }, rank: 16 },
        }),
      ]);
      const hockey = yield* queries.searchPlayers(owner, {
        team: hockeyTeam,
        availability: "free_agent",
        sort: "recent_rank",
        window: { kind: "last_days", days: 14 },
      });
      assert.strictEqual(hockey.status, "ok");
      if (hockey.status !== "ok") {
        return;
      }
      assert.deepStrictEqual(
        hockey.players.map((player) => [player.name, player.recentRank]),
        [
          ["Hockey First", { window: { kind: "last_days", days: 14 }, rank: 16 }],
          ["Hockey Second", { window: { kind: "last_days", days: 14 }, rank: 29 }],
        ],
      );

      yield* fake.setLeague(leagueFixture);
      yield* fake.setSearchPlayers([
        searchFixture({
          providerPlayerKey: "461.p.50001",
          name: "Football Second",
          availability: "free_agent",
          actualRank: 30,
          overallRank: 60,
          statValue: null,
          percentOwned: 12,
          percentOwnedDelta: 0,
          percentStarted: 8,
          percentStartedChange: 0,
          recentRank: { window: { kind: "last_weeks", weeks: 4 }, rank: 66 },
        }),
        searchFixture({
          providerPlayerKey: "461.p.50002",
          name: "Football First",
          availability: "free_agent",
          actualRank: 5,
          overallRank: 20,
          statValue: null,
          percentOwned: 40,
          percentOwnedDelta: 2,
          percentStarted: 21,
          percentStartedChange: 1,
          recentRank: { window: { kind: "last_weeks", weeks: 4 }, rank: 25 },
        }),
      ]);
      const football = yield* queries.searchPlayers(owner, {
        team: footballTeam,
        availability: "free_agent",
        sort: "recent_rank",
        window: { kind: "last_weeks", weeks: 4 },
      });
      assert.strictEqual(football.status, "ok");
      if (football.status !== "ok") {
        return;
      }
      assert.deepStrictEqual(
        football.players.map((player) => [player.name, player.recentRank]),
        [
          ["Football First", { window: { kind: "last_weeks", weeks: 4 }, rank: 25 }],
          ["Football Second", { window: { kind: "last_weeks", weeks: 4 }, rank: 66 }],
        ],
      );

      for (const search of [hockey, football]) {
        assert.isTrue(
          search.players.every(
            (player) => player.recentRank !== undefined && player.statValue === undefined,
          ),
          "both sports publish the same row shape and the value that ordered it",
        );
      }
    }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("refuses a recent window a season order cannot answer with", () =>
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
    const stat = Array.getUnsafe(league.scoring ?? [], 0).stat;
    assert.deepStrictEqual(league.playerSearch, {
      status: "published",
      sorts: [
        "name",
        "position",
        "ownership",
        "actual_rank",
        "overall_rank",
        "stat",
        "recent_rank",
      ],
      windows: [{ kind: "last_weeks", weeks: 4 }],
      games: {
        status: "scoring_week",
        detail:
          'This league counts games by scoring week. Ask `search_players` with `gamesWindow: {kind: "current"}` or `{kind: "next_weeks", weeks: N}`; it refuses a date window.',
      },
      detail: "This league publishes a recent-form player rank for the last 4 weeks.",
    });

    const seasonStat = yield* Effect.flip(
      queries.searchPlayers(owner, {
        team: teamId,
        sort: "stat",
        stat,
        window: { kind: "last_days", days: 14 },
      }),
    );
    assert.instanceOf(seasonStat, QuerySelectionInvalid);
    assert.include(seasonStat.detail, "recent rank");

    const noWindow = yield* Effect.flip(
      queries.searchPlayers(owner, { team: teamId, sort: "recent_rank" }),
    );
    assert.instanceOf(noWindow, QuerySelectionInvalid);
    assert.include(noWindow.detail, "the last 4 weeks");

    const weekWindow = yield* Effect.flip(
      queries.searchPlayers(owner, {
        team: teamId,
        sort: "recent_rank",
        window: { kind: "week", week: 2 },
      }),
    );
    assert.instanceOf(weekWindow, QuerySelectionInvalid);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("refuses a recent window the league does not publish and names the nearest", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);

    const error = yield* Effect.flip(
      queries.searchPlayers(owner, {
        team: Array.getUnsafe(seeded, 0).id,
        sort: "recent_rank",
        window: { kind: "last_days", days: 7 },
      }),
    );

    assert.instanceOf(error, QuerySelectionInvalid);
    assert.include(error.detail, "the last 4 weeks");
    assert.include(error.detail, "nearest window");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("does not offer a recent-form ordering a league publishes no rank for", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      league: {
        ...leagueFixture,
        playerSearch: {
          status: "published",
          sorts: ["name", "position", "ownership", "actual_rank", "overall_rank", "stat"],
          windows: [],
          detail:
            "This league publishes no recent-form player rank, so its pool cannot be ordered by recent form.",
        },
      },
    });
    const teamId = Array.getUnsafe(seeded, 0).id;

    const league = yield* queries.getLeague(owner, { team: teamId });
    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(league.playerSearch?.windows, []);
    assert.notInclude(league.playerSearch?.sorts ?? [], "recent_rank");

    const error = yield* Effect.flip(
      queries.searchPlayers(owner, {
        team: teamId,
        sort: "recent_rank",
        window: { kind: "last_weeks", weeks: 4 },
      }),
    );

    assert.instanceOf(error, QuerySelectionInvalid);
    assert.include(error.detail, "no recent-form player rank");
    assert.include(error.detail, "Order the pool by ownership");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("stops a summary at its first refused read and names the layer to reconnect", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);

    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-08T14:11:29.000Z")),
    );
    const healthy = yield* queries.getTeamSummary(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["league"],
    });
    assert.strictEqual(healthy.status, "ok");
    const proven = Array.getUnsafe(yield* connections.list(owner), 0);
    assert.deepStrictEqual(
      proven.session.provenAt,
      DateTime.makeUnsafe("2026-11-08T14:11:29.000Z"),
    );

    yield* fake.rejectSession(true);

    const before = yield* fake.providerReads;
    const summary = yield* queries.getTeamSummary(owner, {
      team: Array.getUnsafe(seeded, 0).id,
    });

    assert.strictEqual((yield* fake.providerReads) - before, 1);
    assert.strictEqual(summary.status, "failed");
    if (!("failures" in summary)) {
      assert.fail("expected the summary to report its failures");
      return;
    }
    assert.deepStrictEqual(
      [...new Set(summary.failures.map((failure) => failure.code))],
      ["provider_session_rejected"],
    );
    assert.deepStrictEqual(
      [...new Set(summary.failures.map((failure) => failure.message))],
      [providerSessionReconnectDetail],
    );

    const connection = Array.getUnsafe(yield* connections.list(owner), 0);
    assert.strictEqual(connection.status, "reconnect-required");
    assert.strictEqual(connection.session.action, "reconnect-provider-connection");
    assert.deepStrictEqual(
      connection.session.provenAt,
      DateTime.makeUnsafe("2026-11-08T14:11:29.000Z"),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("publishes the football projected week rank as the player's projection", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setPlayerWeeks([
      {
        providerPlayerKey: "461.p.10001",
        week: 3,
        plays: true,
        opponent: { opponent: "SEA", home: true },
        projectedRank: 14,
      },
    ]);
    const roster = yield* queries.getRosters(owner, { team: Array.getUnsafe(seeded, 0).id });
    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok" || roster.scope !== "team") {
      return;
    }
    const row = Array.getUnsafe(roster.players, 0);
    assert.strictEqual(row.week?.projectedRank, 14);

    const hydrated = yield* queries.getPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      players: [row.player],
      groups: ["projections"],
    });
    assert.strictEqual(hydrated.status, "ok");
    if (hydrated.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(Array.getUnsafe(hydrated.players, 0).projections, {
      status: "available",
      basis: "week",
      period: { week: 3 },
      rank: 14,
    });

    const summary = yield* queries.getTeamSummary(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["roster"],
    });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(Array.getUnsafe(summary.roster ?? [], 0).week?.projectedRank, 14);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("returns every explicitly requested player reference in one response", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const categories = globalThis.Array.from({ length: 36 }, (_, index) => ({
      statId: 100 + index,
      name: `Synthetic Category ${String(index)}`,
      displayName: `SC${String(index)}`,
      abbreviation: `S${String(index)}`,
      group: "synthetic",
      enabled: true,
      displayOnly: false,
      positionTypes: ["O"],
    }));
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      league: { ...leagueFixture, statCategories: categories },
      roster: rosterFixture({ count: 25 }),
      playerDetails: globalThis.Array.from({ length: 25 }, (_, index) => ({
        providerPlayerKey: `461.p.${String(10001 + index)}`,
        name: `Synthetic ${String(index)}`,
        primaryPosition: "QB",
        displayPosition: "QB",
        proTeam: undefined,
        availabilityDetail: undefined,
        eligiblePositions: ["QB"],
        rosterStatus: "rostered" as const,
        actual: {
          basis: { type: "week" as const, week: 3 },
          stats: categories.map((category) => ({ statId: category.statId, value: index })),
          notAggregated: [],
        },
        projected: undefined,
      })),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    const players = yield* Effect.provide(
      Effect.flatMap(QueryTokens, (tokens) =>
        tokens.sealPlayerRefs({
          userId: owner,
          leagueKey: "461.l.1000",
          playerKeys: globalThis.Array.from(
            { length: 25 },
            (_, index) => `461.p.${String(10001 + index)}`,
          ),
        }),
      ),
      QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars"),
    );

    const hydrated = yield* queries.getPlayers(owner, {
      team: teamId,
      players,
      groups: ["identity", "availability", "eligibility", "actual_stats", "scoring_context"],
    });

    assert.strictEqual(hydrated.status, "ok");
    if (hydrated.status !== "ok") {
      return;
    }
    assert.strictEqual(hydrated.players.length, 25);
    assert.deepStrictEqual(hydrated.page, { returned: 25, complete: true, remaining: 0 });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "reads a pool player's game days from its professional team key without a roster row",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const games = yield* FakeGameSourceWorld;
      const store = yield* ScheduleObservationRepository;
      const seeded = yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl")], {
        league: hockeyLeagueFixture,
      });
      const teamId = Array.getUnsafe(seeded, 0).id;
      yield* fake.setMatchups([matchupFixture({ period: 3 })]);
      const provider = decodeProviderKey("yahoo");
      const observedAt = DateTime.makeUnsafe("2026-10-19T12:00:00.000Z");
      yield* store.recordTeamIdentities([
        {
          sport: "hockey",
          source: provider,
          sourceTeamIdentifier: "TOR",
          provider,
          providerTeamKey: "nhl.t.21",
          observedAt,
        },
        {
          sport: "hockey",
          source: provider,
          sourceTeamIdentifier: "BOS",
          provider,
          providerTeamKey: "nhl.t.1",
          observedAt,
        },
      ]);
      yield* fake.setSearchPlayers([
        searchFixture({
          providerPlayerKey: "465.p.1",
          name: "Keyed Skater",
          availability: "free_agent",
          actualRank: 1,
          overallRank: 1,
          statValue: null,
          percentOwned: 1,
          percentOwnedDelta: 0,
          percentStarted: 0,
          percentStartedChange: 0,
          proTeam: "TOR",
          proTeamKey: "nhl.t.21",
        }),
        searchFixture({
          providerPlayerKey: "465.p.2",
          name: "Pair Skater",
          availability: "free_agent",
          actualRank: 2,
          overallRank: 2,
          statValue: null,
          percentOwned: 1,
          percentOwnedDelta: 0,
          percentStarted: 0,
          percentStartedChange: 0,
          proTeam: "BOS",
        }),
        searchFixture({
          providerPlayerKey: "465.p.3",
          name: "Unmapped Skater",
          availability: "free_agent",
          actualRank: 3,
          overallRank: 3,
          statValue: null,
          percentOwned: 1,
          percentOwnedDelta: 0,
          percentStarted: 0,
          percentStartedChange: 0,
          proTeam: "ZZZ",
        }),
        searchFixture({
          providerPlayerKey: "465.p.4",
          name: "Keyed Unresolved Skater",
          availability: "free_agent",
          actualRank: 4,
          overallRank: 4,
          statValue: null,
          percentOwned: 1,
          percentOwnedDelta: 0,
          percentStarted: 0,
          percentStartedChange: 0,
          proTeam: "ZZZ",
          proTeamKey: "nhl.t.13",
        }),
      ]);
      yield* games.setGames([
        calendarGame("g1", "2026-10-19", "TOR", "BOS"),
        calendarGame("g2", "2026-10-21", "TOR", "LA"),
        calendarGame("g3", "2026-10-22", "ZZZ", "BOS"),
      ]);

      const before = yield* fake.providerReads;
      const plain = yield* queries.searchPlayers(owner, { team: teamId });
      assert.strictEqual(plain.status, "ok");
      if (plain.status !== "ok") {
        return;
      }
      assert.isUndefined(plain.gamesWindow);
      assert.strictEqual((yield* fake.providerReads) - before, 3);

      const search = yield* queries.searchPlayers(owner, {
        team: teamId,
        gamesWindow: { kind: "current" },
      });
      assert.strictEqual(search.status, "ok");
      if (search.status !== "ok") {
        return;
      }
      assert.strictEqual(search.gamesWindow?.status, "available");
      if (search.gamesWindow?.status === "available" && search.gamesWindow.basis === "date") {
        assert.deepStrictEqual(search.gamesWindow.window, {
          start: "2026-10-19",
          end: "2026-10-25",
          source: "period",
        });
        assert.isTrue(DateTime.isDateTime(search.gamesWindow.observedAt));
      }
      assert.deepStrictEqual(
        search.players.map((player) => [player.name, player.gameDays]),
        [
          ["Keyed Skater", { status: "available", dates: ["2026-10-19", "2026-10-21"] }],
          [
            "Keyed Unresolved Skater",
            {
              status: "unavailable",
              detail:
                "The league's professional games include a team with no key, so this player's team cannot be placed on a date without guessing.",
            },
          ],
          ["Pair Skater", { status: "available", dates: ["2026-10-19", "2026-10-22"] }],
          [
            "Unmapped Skater",
            {
              status: "unavailable",
              detail:
                "This row's professional team could not be resolved to a key, so its game days cannot be joined without guessing from an abbreviation.",
            },
          ],
        ],
      );
    }).pipe(Effect.provide(queriesTestLayerWithGames(6))),
);

it.effect("counts a pool window's game days instead of the scoring window", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const games = yield* FakeGameSourceWorld;
    const store = yield* ScheduleObservationRepository;
    const seeded = yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl")], {
      league: hockeyLeagueFixture,
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    const observedAt = DateTime.makeUnsafe("2026-10-19T12:00:00.000Z");
    const provider = decodeProviderKey("yahoo");
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));
    yield* store.recordTeamIdentities([
      {
        sport: "hockey",
        source: provider,
        sourceTeamIdentifier: "TOR",
        provider,
        providerTeamKey: "nhl.t.21",
        observedAt,
      },
      {
        sport: "hockey",
        source: provider,
        sourceTeamIdentifier: "BOS",
        provider,
        providerTeamKey: "nhl.t.1",
        observedAt,
      },
    ]);
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "465.p.1",
        name: "Keyed Skater",
        availability: "free_agent",
        actualRank: 1,
        overallRank: 1,
        statValue: null,
        percentOwned: 1,
        percentOwnedDelta: 0,
        percentStarted: 0,
        percentStartedChange: 0,
        proTeam: "TOR",
        proTeamKey: "nhl.t.21",
      }),
      searchFixture({
        providerPlayerKey: "465.p.2",
        name: "Keyless Skater",
        availability: "free_agent",
        actualRank: 2,
        overallRank: 2,
        statValue: null,
        percentOwned: 1,
        percentOwnedDelta: 0,
        percentStarted: 0,
        percentStartedChange: 0,
        proTeam: "BOS",
      }),
      searchFixture({
        providerPlayerKey: "465.p.3",
        name: "Unmapped Skater",
        availability: "free_agent",
        actualRank: 3,
        overallRank: 3,
        statValue: null,
        percentOwned: 1,
        percentOwnedDelta: 0,
        percentStarted: 0,
        percentStartedChange: 0,
        proTeam: "ZZZ",
      }),
    ]);
    yield* games.setGames([
      calendarGame("g1", "2026-10-19", "TOR", "BOS"),
      calendarGame("g2", "2026-10-22", "TOR", "BOS"),
    ]);

    const search = yield* queries.searchPlayers(owner, {
      team: teamId,
      gamesWindow: { start: "2026-10-19", end: "2026-10-22" },
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    assert.strictEqual(search.gamesWindow?.status, "available");
    if (search.gamesWindow?.status === "available" && search.gamesWindow.basis === "date") {
      assert.deepStrictEqual(search.gamesWindow.window, {
        start: "2026-10-19",
        end: "2026-10-22",
        source: "requested",
      });
      assert.isTrue(DateTime.isDateTime(search.gamesWindow.observedAt));
    }
    assert.deepStrictEqual(
      search.players.map((player) => [player.name, player.gameDays]),
      [
        ["Keyed Skater", { status: "available", dates: ["2026-10-19", "2026-10-22"] }],
        ["Keyless Skater", { status: "available", dates: ["2026-10-19", "2026-10-22"] }],
        [
          "Unmapped Skater",
          {
            status: "unavailable",
            detail:
              "This row's professional team could not be resolved to a key, so its game days cannot be joined without guessing from an abbreviation.",
          },
        ],
      ],
    );
  }).pipe(Effect.provide(queriesTestLayerWithGames(6))),
);

it.effect("reads a season's worth of game days from the league's weekly schedule ranges", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const games = yield* FakeGameSourceWorld;
    const calendar = yield* ProfessionalCalendar;
    const seeded = yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl")], {
      league: hockeyLeagueFixture,
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    const firstReadAt = DateTime.makeUnsafe("2026-10-01T12:00:00.000Z");
    yield* TestClock.setTime(DateTime.toEpochMillis(firstReadAt));
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "465.p.1",
        name: "Keyed Skater",
        availability: "free_agent",
        actualRank: 1,
        overallRank: 1,
        statValue: null,
        percentOwned: 1,
        percentOwnedDelta: 0,
        percentStarted: 0,
        percentStartedChange: 0,
        proTeam: "TOR",
        proTeamKey: "nhl.t.21",
      }),
    ]);
    yield* games.setGames([
      calendarGame("g1", "2026-10-01", "TOR", "BOS"),
      calendarGame("g2", "2026-10-15", "TOR", "BOS"),
      calendarGame("g3", "2026-11-01", "TOR", "BOS"),
      calendarGame("g4", "2026-12-29", "TOR", "BOS"),
      calendarGame("g5", "2026-12-30", "TOR", "BOS"),
    ]);
    yield* calendar.readGames({
      league: "nhl",
      from: "2026-10-01",
      to: "2026-10-07",
      freshness: "calendar",
    });
    const readsBeforeWindow = (yield* games.calls).length;

    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.add(firstReadAt, { hours: 2 })));
    const search = yield* queries.searchPlayers(owner, {
      team: teamId,
      gamesWindow: { start: "2026-10-01", end: "2026-12-29" },
    });

    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    assert.strictEqual((yield* games.calls).length - readsBeforeWindow, 12);
    assert.strictEqual(search.gamesWindow?.status, "available");
    if (search.gamesWindow?.status === "available" && search.gamesWindow.basis === "date") {
      assert.deepStrictEqual(search.gamesWindow.window, {
        start: "2026-10-01",
        end: "2026-12-29",
        source: "requested",
      });
      assert.strictEqual(
        DateTime.formatIso(search.gamesWindow.observedAt),
        "2026-10-01T12:00:00.000Z",
      );
    }
    const gameDays = Array.getUnsafe(search.players, 0).gameDays;
    assert.deepStrictEqual(gameDays, {
      status: "available",
      dates: ["2026-10-01", "2026-10-15", "2026-11-01", "2026-12-29"],
    });
    const league = yield* queries.getLeague(owner, { team: teamId });
    assert.strictEqual(league.status, "ok");
    if (league.status === "ok") {
      assert.deepStrictEqual(league.playerSearch?.games, {
        status: "date_window",
        detail:
          'This league has a dated professional schedule. Ask `search_players` with `gamesWindow: {kind: "current"}` or `{start, end}` dates; it refuses a week window.',
      });
    }
  }).pipe(Effect.provide(queriesTestLayerWithGames(6))),
);

it.effect("refuses a game window longer than one season", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl")], {
      league: hockeyLeagueFixture,
    });
    const teamId = Array.getUnsafe(seeded, 0).id;

    const error = yield* Effect.flip(
      queries.searchPlayers(owner, {
        team: teamId,
        gamesWindow: { start: "2026-01-01", end: "2027-01-02" },
      }),
    );

    assert.instanceOf(error, QuerySelectionInvalid);
    assert.include(error.detail, "367 dates");
    assert.include(error.detail, "one season (366 dates)");
  }).pipe(Effect.provide(queriesTestLayerWithGames(6))),
);

it.effect("refuses a game window for a league that counts games by scoring week", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;

    const error = yield* Effect.flip(
      queries.searchPlayers(owner, {
        team: teamId,
        gamesWindow: { start: "2026-10-19", end: "2026-10-22" },
      }),
    );

    assert.instanceOf(error, QuerySelectionInvalid);
    assert.include(error.detail, "counts games by scoring week");
    assert.include(error.detail, "a date window cannot answer for it");
    assert.include(error.detail, 'gamesWindow: {kind: "next_weeks", weeks: 4}');
  }).pipe(Effect.provide(queriesTestLayerWithGames(6))),
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
            proTeam: undefined,
            availabilityDetail: undefined,
            eligiblePositions: ["QB"],
            rosterStatus: "rostered",
            actual: {
              basis: { type: "season" },
              stats: [{ statId: 11, value: 4 }],
              notAggregated: [],
            },
            projected: undefined,
          },
        ],
      });
      const teamId = Array.getUnsafe(seeded, 0).id;
      const roster = yield* queries.getRosters(owner, { team: teamId });
      assert.strictEqual(roster.status, "ok");
      if (roster.status !== "ok" || roster.scope !== "team") {
        return;
      }
      assert.isUndefined(Array.getUnsafe(roster.players, 0).week);

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
      assert.deepStrictEqual(player.projections, {
        status: "unsupported",
        reason: "not_published",
      });
      assert.deepStrictEqual(hydrated.period, { kind: "season" });
      assert.strictEqual(
        player.actualStats?.status === "available" && player.actualStats.notAggregated.length,
        0,
      );
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

it.effect("carries a screening status and its observation time on every search row", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setSearchPlayers([
      {
        ...searchFixture({
          providerPlayerKey: "461.p.10011",
          name: "Available Skater",
          availability: "free_agent",
          actualRank: 12,
          overallRank: 20,
          statValue: null,
          percentOwned: 12,
          percentOwnedDelta: 1,
          percentStarted: 10,
          percentStartedChange: 1,
        }),
        status: { value: "healthy", code: undefined, detail: undefined },
      },
      {
        ...searchFixture({
          providerPlayerKey: "461.p.10012",
          name: "Reserve Goaltender",
          availability: "free_agent",
          actualRank: 44,
          overallRank: 51,
          statValue: null,
          percentOwned: 30,
          percentOwnedDelta: 2,
          percentStarted: null,
          percentStartedChange: null,
        }),
        status: {
          value: "injured_reserve",
          code: "IR-LT",
          detail: "Out for the season after surgery.",
        },
      },
      {
        ...searchFixture({
          providerPlayerKey: "461.p.10013",
          name: "Uncoded Player",
          availability: "waiver",
          actualRank: 88,
          overallRank: 90,
          statValue: null,
          percentOwned: 4,
          percentOwnedDelta: 0,
          percentStarted: null,
          percentStartedChange: null,
        }),
        status: { value: "unknown", code: "PUP-2027", detail: undefined },
      },
    ]);

    const search = yield* queries.searchPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      sort: "name",
    });

    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    const observedAt = DateTime.toEpochMillis(Array.getUnsafe(search.coverage, 0).fetchedAt);
    assert.deepStrictEqual(
      search.players.map((player) => ({
        name: player.name,
        value: player.status.value,
        code: player.status.code,
        detail: player.status.detail,
        observedAt: DateTime.toEpochMillis(player.status.observedAt),
      })),
      [
        {
          name: "Available Skater",
          value: "healthy",
          code: undefined,
          detail: undefined,
          observedAt,
        },
        {
          name: "Reserve Goaltender",
          value: "injured_reserve",
          code: "IR-LT",
          detail: "Out for the season after surgery.",
          observedAt,
        },
        {
          name: "Uncoded Player",
          value: "unknown",
          code: "PUP-2027",
          detail: undefined,
          observedAt,
        },
      ],
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("publishes the professional team on search rows", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "461.p.10011",
        name: "Available Skater",
        availability: "free_agent",
        actualRank: 12,
        overallRank: 20,
        statValue: null,
        percentOwned: 12,
        percentOwnedDelta: 1,
        percentStarted: 10,
        percentStartedChange: 1,
        proTeam: "SYN",
      }),
      searchFixture({
        providerPlayerKey: "461.p.10012",
        name: "Unsigned Skater",
        availability: "waiver",
        actualRank: 44,
        overallRank: 51,
        statValue: null,
        percentOwned: 30,
        percentOwnedDelta: 2,
        percentStarted: null,
        percentStartedChange: null,
      }),
    ]);

    const search = yield* queries.searchPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      sort: "name",
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      search.players.map((player) => [player.name, player.proTeam]),
      [
        ["Available Skater", "SYN"],
        ["Unsigned Skater", null],
      ],
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("returns distinct free-agent, waiver, and all pools with all as their union", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "461.p.10011",
        name: "Rostered Player",
        availability: "rostered",
        actualRank: 1,
        overallRank: 1,
        statValue: null,
        percentOwned: 90,
        percentOwnedDelta: 0,
        percentStarted: 80,
        percentStartedChange: 0,
      }),
      searchFixture({
        providerPlayerKey: "461.p.10012",
        name: "Free Agent",
        availability: "free_agent",
        actualRank: 20,
        overallRank: 30,
        statValue: null,
        percentOwned: 25,
        percentOwnedDelta: 1,
        percentStarted: 10,
        percentStartedChange: 1,
      }),
      searchFixture({
        providerPlayerKey: "461.p.10013",
        name: "Waiver Player",
        availability: "waiver",
        actualRank: 40,
        overallRank: 50,
        statValue: null,
        percentOwned: 5,
        percentOwnedDelta: -1,
        percentStarted: 2,
        percentStartedChange: 0,
      }),
    ]);

    const pool = (
      availability: "all" | "free_agent" | "waiver",
    ): Effect.Effect<ReadonlyArray<string>, QueryError> =>
      queries.searchPlayers(owner, { team: teamId, availability, sort: "name" }).pipe(
        Effect.map((result) => {
          assert.strictEqual(result.status, "ok");
          return result.status === "ok" ? result.players.map((player) => player.name) : [];
        }),
      );

    const freeAgents = yield* pool("free_agent");
    const waivers = yield* pool("waiver");
    const all = yield* pool("all");

    assert.deepStrictEqual(freeAgents, ["Free Agent"]);
    assert.deepStrictEqual(waivers, ["Waiver Player"]);
    assert.deepStrictEqual(all, ["Free Agent", "Waiver Player"]);
    assert.deepStrictEqual(all, [...freeAgents, ...waivers].sort());
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("answers a league with no waiver players honestly", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "461.p.10011",
        name: "Free Agent",
        availability: "free_agent",
        actualRank: 20,
        overallRank: 30,
        statValue: null,
        percentOwned: 25,
        percentOwnedDelta: 1,
        percentStarted: 10,
        percentStartedChange: 1,
      }),
    ]);

    const empty = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "waiver",
      sort: "name",
    });

    assert.strictEqual(empty.status, "ok");
    if (empty.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(empty.players, []);
    assert.deepStrictEqual(empty.page, { returned: 0, complete: true, remaining: 0 });
    assert.deepStrictEqual(empty.failures, []);
    assert.isTrue(
      empty.coverage.some((entry) => entry.resource === "players" && entry.status === "available"),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("carries your league's day-window transaction counts on search rows", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "461.p.10011",
        name: "Moving Skater",
        availability: "free_agent",
        actualRank: null,
        overallRank: null,
        statValue: null,
        percentOwned: 40,
        percentOwnedDelta: 4,
        percentStarted: null,
        percentStartedChange: null,
        transactionTrend: {
          status: "published",
          adds: 37,
          drops: 3,
          window: "provider_current_day",
        },
      }),
      searchFixture({
        providerPlayerKey: "461.p.10012",
        name: "Uncounted Skater",
        availability: "waiver",
        actualRank: null,
        overallRank: null,
        statValue: null,
        percentOwned: null,
        percentOwnedDelta: null,
        percentStarted: null,
        percentStartedChange: null,
        transactionTrend: { status: "not_published", reason: "Synthetic absence." },
      }),
    ]);

    const search = yield* queries.searchPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      sort: "name",
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      search.players.map((player) => [player.name, player.transactionTrend]),
      [
        [
          "Moving Skater",
          { status: "published", adds: 37, drops: 3, window: "provider_current_day" },
        ],
        ["Uncounted Skater", { status: "not_published", reason: "Synthetic absence." }],
      ],
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("carries the transaction counts on roster rows", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      roster: {
        ...rosterFixture({ count: 2 }),
        players: rosterFixture({ count: 2 }).players.map((player, index) => ({
          ...player,
          transactionTrend:
            index === 0
              ? {
                  status: "published" as const,
                  adds: 12,
                  drops: 1,
                  window: "provider_current_day" as const,
                }
              : { status: "not_published" as const, reason: "Synthetic absence." },
        })),
      },
    });

    const roster = yield* queries.getRosters(owner, { team: Array.getUnsafe(seeded, 0).id });
    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok" || roster.scope !== "team") {
      return;
    }
    assert.deepStrictEqual(
      roster.players.map((player) => [player.name, player.transactionTrend]),
      [
        [
          "Synthetic 0",
          { status: "published", adds: 12, drops: 1, window: "provider_current_day" },
        ],
        ["Synthetic 1", { status: "not_published", reason: "Synthetic absence." }],
      ],
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("refuses a period your league cannot honour instead of ignoring it", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl"), team("461.l.1000.t.1", "Alpha")], {
      league: { ...hockeyLeagueFixture, providerLeagueKey: "465.l.2000" },
      roster: rosterFixture({
        count: 1,
        coverage: { type: "date", date: "2026-10-25" },
        providerTeamKey: "465.l.2000.t.9",
        providerLeagueKey: "465.l.2000",
      }),
    });
    const listed = yield* queries.listTeams(owner, {});
    assert.strictEqual(listed.status, "ok");
    if (listed.status !== "ok") {
      return;
    }
    const hockeyId = listed.teams.find((entry) => entry.name === "Gamma")?.team;
    const footballId = listed.teams.find((entry) => entry.name === "Alpha")?.team;
    assert.isDefined(hockeyId);
    assert.isDefined(footballId);
    const roster = yield* queries.getRosters(owner, { team: hockeyId });
    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok" || roster.scope !== "team") {
      return;
    }

    const noWeeklySeries = yield* Effect.flip(
      queries.getPlayers(owner, {
        team: hockeyId,
        players: [Array.getUnsafe(roster.players, 0).player],
        period: { week: 2 },
        groups: ["actual_stats"],
      }),
    );
    assert.strictEqual(noWeeklySeries._tag, "query.selection_invalid");
    if (noWeeklySeries._tag === "query.selection_invalid") {
      assert.include(noWeeklySeries.detail, "kind `week`");
      assert.include(noWeeklySeries.detail, "no weekly player series");
      assert.include(noWeeklySeries.detail, "last_days");
      assert.include(noWeeklySeries.detail, "at most 31 days");
    }

    yield* fake.setLeague(leagueFixture);
    const search = yield* queries.searchPlayers(owner, {
      team: footballId,
      availability: "free_agent",
      sort: "name",
    });
    assert.strictEqual(search.status, "ok");
    if (search.status !== "ok") {
      return;
    }

    const currentWeek = yield* Effect.flip(
      queries.getPlayers(owner, {
        team: footballId,
        players: [Array.getUnsafe(search.players, 0).player],
        period: { week: 3 },
        groups: ["actual_stats"],
      }),
    );
    assert.strictEqual(currentWeek._tag, "query.selection_invalid");
    if (currentWeek._tag === "query.selection_invalid") {
      assert.include(currentWeek.detail, "kind `week`");
      assert.include(currentWeek.detail, "week 3 is the current or upcoming week");
      assert.include(currentWeek.detail, "completed scoring week");
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "serves a hockey recent window through your league and states its aggregation basis",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const seeded = yield* seed(fake, [team("465.l.2000.t.9", "Gamma", "nhl")], {
        league: { ...hockeyLeagueFixture, providerLeagueKey: "465.l.2000" },
        roster: rosterFixture({
          count: 1,
          coverage: { type: "date", date: "2026-10-26" },
          providerTeamKey: "465.l.2000.t.9",
          providerLeagueKey: "465.l.2000",
        }),
        playerDetails: [
          {
            providerPlayerKey: "461.p.10001",
            name: "Synthetic Skater",
            primaryPosition: "C",
            displayPosition: "C",
            proTeam: undefined,
            availabilityDetail: undefined,
            eligiblePositions: ["C"],
            rosterStatus: "rostered",
            actual: {
              basis: { type: "season" },
              stats: [{ statId: 11, value: 4 }],
              notAggregated: [],
            },
            projected: undefined,
          },
        ],
      });
      const teamId = Array.getUnsafe(seeded, 0).id;
      const roster = yield* queries.getRosters(owner, { team: teamId });
      assert.strictEqual(roster.status, "ok");
      if (roster.status !== "ok" || roster.scope !== "team") {
        return;
      }

      const hydrated = yield* queries.getPlayers(owner, {
        team: teamId,
        players: [Array.getUnsafe(roster.players, 0).player],
        period: { kind: "last_days", days: 7 },
        groups: ["actual_stats"],
      });

      assert.strictEqual(hydrated.status, "ok");
      if (hydrated.status !== "ok") {
        return;
      }
      assert.deepStrictEqual(hydrated.period, { kind: "last_days", days: 7 });
      assert.deepStrictEqual(hydrated.periodSupport.kinds, {
        season: "native",
        week: "unsupported",
        last_days: "aggregated",
        last_weeks: "aggregated",
        range: "aggregated",
      });
      assert.strictEqual(hydrated.periodSupport.maximumWindowDays, 31);
      assert.strictEqual(hydrated.periodSupport.sport, "hockey");

      const stats = Array.getUnsafe(hydrated.players, 0).actualStats;
      assert.strictEqual(stats?.status, "available");
      if (stats?.status !== "available") {
        return;
      }
      assert.strictEqual(stats.basis, "date_range");
      assert.deepStrictEqual(stats.range, {
        start: "2026-10-20",
        end: "2026-10-26",
        days: 7,
      });
      assert.strictEqual(stats.aggregation?.method, "daily_sum");
      assert.include(stats.aggregation?.detail, "7 daily reads");
      assert.include(stats.aggregation?.detail, "notAggregated");
      assert.isTrue(
        hydrated.coverage.some(
          (entry) =>
            entry.resource === "players" &&
            entry.detail ===
              "Actual statistics use the date_range basis: 7 daily reads summed from 2026-10-20 to 2026-10-26.",
        ),
      );
    }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("never pairs an unsupported stat group with a period failure", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      league: { ...leagueFixture, periodWindow: { current: 4, start: 1, end: 17 } },
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    const roster = yield* queries.getRosters(owner, { team: teamId, period: { week: 3 } });
    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok" || roster.scope !== "team") {
      return;
    }
    const ref = Array.getUnsafe(roster.players, 0).player;
    yield* fake.failPlayerDetails(
      ProviderPeriodMismatch.make({
        operation: "read_player_details",
        requested: { type: "week", week: 3 },
        covered: null,
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
      assert.include(player.actualStats.detail, "did not report the requested week 3");
    }
    assert.deepStrictEqual(player.projections, {
      status: "available",
      basis: "week",
      period: { week: 4 },
      rank: null,
    });
    assert.deepStrictEqual(hydrated.failures, []);
    const detailsCoverage = hydrated.coverage.find(
      (entry) => entry.resource === "players" && entry.status === "degraded",
    );
    assert.include(detailsCoverage?.detail, "did not report the requested week 3");
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
    if (roster.status !== "ok" || roster.scope !== "team") {
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
      transaction({
        occurredAt: "2026-09-20T12:00:00.000Z",
        type: "add_drop",
        teams: [alphaTeam, betaTeam],
        players: [
          transactionPlayer(
            "461.p.10003",
            movement("add", undefined, alphaTeam),
            "Synthetic Addition",
          ),
          transactionPlayer(
            "461.p.10001",
            movement("drop", alphaTeam, undefined),
            "Synthetic Drop",
          ),
        ],
      }),
    ]);

    const transactions = yield* queries.getTransactions(owner, {
      team: Array.getUnsafe(seeded, 0).id,
    });

    assert.strictEqual(transactions.status, "ok");
    if (transactions.status !== "ok") {
      return;
    }
    assert.strictEqual(transactions.transactions.length, 1);
    const addDrop = Array.getUnsafe(transactions.transactions, 0);
    assert.strictEqual(addDrop.type, "add_drop");
    assert.strictEqual(addDrop.teams.length, 2);
    assert.strictEqual(addDrop.players.length, 2);
    assert.deepStrictEqual(addDrop.completeness, { status: "complete" });
    const added = Array.getUnsafe(addDrop.players, 0);
    assert.strictEqual(added.movement.kind, "add");
    assert.strictEqual(added.movement.from, null);
    assert.strictEqual(added.movement.to?.name, "Alpha");
    const removed = Array.getUnsafe(addDrop.players, 1);
    assert.strictEqual(removed.movement.kind, "drop");
    assert.strictEqual(removed.movement.from?.name, "Alpha");
    assert.strictEqual(removed.movement.to, null);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports both sides of a trade with the team each player left and joined", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setTransactions([
      transaction({
        occurredAt: "2026-09-22T12:00:00.000Z",
        type: "trade",
        teams: [alphaTeam, betaTeam],
        parties: {
          source: "provider",
          entries: [
            { role: "proposer", team: alphaTeam },
            { role: "receiver", team: betaTeam },
          ],
        },
        players: [
          transactionPlayer(
            "461.p.10003",
            movement("trade", alphaTeam, betaTeam),
            "Synthetic Sender",
          ),
          transactionPlayer(
            "461.p.10004",
            movement("trade", betaTeam, alphaTeam),
            "Synthetic Return",
          ),
        ],
      }),
    ]);

    const transactions = yield* queries.getTransactions(owner, {
      team: Array.getUnsafe(seeded, 0).id,
    });

    assert.strictEqual(transactions.status, "ok");
    if (transactions.status !== "ok") {
      return;
    }
    const trade = Array.getUnsafe(transactions.transactions, 0);
    assert.strictEqual(trade.type, "trade");
    assert.deepStrictEqual(trade.completeness, { status: "complete" });
    assert.deepStrictEqual(
      trade.parties?.entries.map((party) => [party.role, party.name]),
      [
        ["proposer", "Alpha"],
        ["receiver", "Beta"],
      ],
    );
    assert.strictEqual(trade.parties?.source, "provider");
    assert.strictEqual(trade.teams.length, 2);

    const sent = Array.getUnsafe(trade.players, 0);
    assert.strictEqual(sent.movement.kind, "trade");
    assert.strictEqual(sent.movement.from?.name, "Alpha");
    assert.strictEqual(sent.movement.to?.name, "Beta");
    assert.isString(sent.movement.from?.team);
    assert.notStrictEqual(sent.movement.from?.team, sent.movement.to?.team);

    const returned = Array.getUnsafe(trade.players, 1);
    assert.strictEqual(returned.movement.from?.name, "Beta");
    assert.strictEqual(returned.movement.to?.name, "Alpha");
    assert.strictEqual(returned.movement.from?.team, sent.movement.to?.team);
    assert.strictEqual(returned.movement.to?.team, sent.movement.from?.team);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("flags a transaction with no player movements incomplete instead of an empty trade", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setTransactions([
      transaction({
        occurredAt: "2026-09-22T12:00:00.000Z",
        type: "trade",
        teams: [alphaTeam, betaTeam],
        parties: {
          source: "provider",
          entries: [
            { role: "proposer", team: alphaTeam },
            { role: "receiver", team: betaTeam },
          ],
        },
        players: [],
        incomplete: {
          code: "no_movements",
          detail: "Your league published this transaction with no player movements.",
        },
      }),
    ]);

    const transactions = yield* queries.getTransactions(owner, {
      team: Array.getUnsafe(seeded, 0).id,
    });

    assert.strictEqual(transactions.status, "ok");
    if (transactions.status !== "ok") {
      return;
    }
    const trade = Array.getUnsafe(transactions.transactions, 0);
    assert.strictEqual(trade.type, "trade");
    assert.deepStrictEqual(trade.players, []);
    assert.deepStrictEqual(trade.completeness, {
      status: "incomplete",
      code: "no_movements",
      detail: "Your league published this transaction with no player movements.",
    });
    assert.strictEqual(trade.completeness.status, "incomplete");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports a pick-only trade with both sides and no players", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.setTransactions([
      transaction({
        occurredAt: "2026-09-22T12:00:00.000Z",
        type: "trade",
        teams: [alphaTeam, betaTeam],
        parties: {
          source: "provider",
          entries: [
            { role: "proposer", team: alphaTeam },
            { role: "receiver", team: betaTeam },
          ],
        },
        picks: [
          { round: 2, from: alphaTeam, to: betaTeam, original: alphaTeam },
          { round: 12, from: betaTeam, to: alphaTeam, original: betaTeam },
        ],
        players: [],
      }),
    ]);

    const transactions = yield* queries.getTransactions(owner, {
      team: Array.getUnsafe(seeded, 0).id,
    });

    assert.strictEqual(transactions.status, "ok");
    if (transactions.status !== "ok") {
      return;
    }
    const trade = Array.getUnsafe(transactions.transactions, 0);
    assert.deepStrictEqual(trade.completeness, { status: "complete" });
    assert.deepStrictEqual(trade.players, []);
    assert.deepStrictEqual(
      trade.picks.map((pick) => [pick.round, pick.from?.name, pick.to?.name, pick.original?.name]),
      [
        [2, "Alpha", "Beta", "Alpha"],
        [12, "Beta", "Alpha", "Beta"],
      ],
    );
    assert.strictEqual(trade.teams.length, 2);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("returns draft history with round, pick, team, and player for the league", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setLeagueTeams([
      {
        providerTeamKey: "461.l.1000.t.1",
        providerLeagueKey: "461.l.1000",
        name: "Alpha",
        acquisitionUsage: { seasonMoves: undefined, weeklyAdds: undefined },
      },
      {
        providerTeamKey: "461.l.1000.t.2",
        providerLeagueKey: "461.l.1000",
        name: "Beta",
        acquisitionUsage: { seasonMoves: undefined, weeklyAdds: undefined },
      },
    ]);
    yield* fake.setDraftResults([
      {
        round: 1,
        pick: 1,
        providerTeamKey: "461.l.1000.t.1",
        providerPlayerKey: "461.p.10001",
        name: "Synthetic 0",
      },
      {
        round: 1,
        pick: 2,
        providerTeamKey: "461.l.1000.t.2",
        providerPlayerKey: "461.p.10002",
      },
    ]);

    const league = yield* queries.getLeague(owner, { team: teamId, groups: ["draft_history"] });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok") {
      return;
    }
    const draft = league.draftHistory;
    assert.strictEqual(draft?.status, "available");
    if (draft?.status !== "available") {
      return;
    }
    assert.include(draft.detailNote, "not current or future pick ownership");
    assert.strictEqual(draft.draftStatus, "postdraft");
    assert.strictEqual(draft.picks.length, 2);
    const first = Array.getUnsafe(draft.picks, 0);
    assert.strictEqual(first.round, 1);
    assert.strictEqual(first.pick, 1);
    assert.strictEqual(first.teamName, "Alpha");
    assert.strictEqual(first.name, "Synthetic 0");
    assert.isUndefined(Array.getUnsafe(draft.picks, 1).name);
    assert.isTrue(
      league.coverage.some(
        (entry) => entry.resource === "draft_history" && entry.status === "available",
      ),
    );

    const hydrated = yield* queries.getPlayers(owner, {
      team: teamId,
      players: [first.player],
      groups: ["identity"],
    });
    assert.strictEqual(hydrated.status, "ok");
    if (hydrated.status !== "ok") {
      return;
    }
    const draftedIdentity = Array.getUnsafe(hydrated.players, 0).identity;
    assert.strictEqual(draftedIdentity?.name, "Synthetic 0");
    assert.strictEqual(draftedIdentity?.draft.status, "drafted");
    if (draftedIdentity?.draft.status === "drafted") {
      assert.strictEqual(draftedIdentity.draft.draftRound, 1);
      assert.strictEqual(draftedIdentity.draft.overallPick, 1);
      assert.strictEqual(draftedIdentity.draft.draftSeason, 2026);
      assert.match(draftedIdentity.draft.draftedBy.team, /^r1\./u);
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "publishes each drafted player's round, overall pick, team, and season wherever his identity appears",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
      const teamId = Array.getUnsafe(seeded, 0).id;
      yield* fake.setDraftResults([
        {
          round: 3,
          pick: 32,
          providerTeamKey: "461.l.1000.t.2",
          providerPlayerKey: "461.p.10002",
          name: "Synthetic 1",
        },
      ]);
      yield* fake.setSearchPlayers([
        searchFixture({
          providerPlayerKey: "461.p.10002",
          name: "Synthetic 1",
          availability: "free_agent",
          actualRank: 3,
          overallRank: 3,
          statValue: null,
          percentOwned: 50,
          percentOwnedDelta: 1,
          percentStarted: 40,
          percentStartedChange: 1,
        }),
        searchFixture({
          providerPlayerKey: "461.p.20001",
          name: "Undrafted",
          availability: "free_agent",
          actualRank: 9,
          overallRank: 9,
          statValue: null,
          percentOwned: 1,
          percentOwnedDelta: 0,
          percentStarted: 0,
          percentStartedChange: 0,
        }),
      ]);

      yield* fake.setLeagueTeams([
        {
          providerTeamKey: "461.l.1000.t.1",
          providerLeagueKey: "461.l.1000",
          name: "Alpha",
          acquisitionUsage: { seasonMoves: undefined, weeklyAdds: undefined },
        },
        {
          providerTeamKey: "461.l.1000.t.2",
          providerLeagueKey: "461.l.1000",
          name: "Beta",
          acquisitionUsage: { seasonMoves: undefined, weeklyAdds: undefined },
        },
      ]);

      const summary = yield* queries.getTeamSummary(owner, { team: teamId, groups: ["roster"] });
      assert.strictEqual(summary.status, "ok");
      if (summary.status !== "ok") {
        return;
      }
      const rosterRow = summary.roster?.find((row) => row.name === "Synthetic 1");
      assertDrafted(rosterRow?.draft);

      assert.isDefined(rosterRow);
      const hydrated = yield* queries.getPlayers(owner, {
        team: teamId,
        players: [rosterRow.player],
        groups: ["identity"],
      });
      assert.strictEqual(hydrated.status, "ok");
      if (hydrated.status !== "ok") {
        return;
      }
      assertDrafted(Array.getUnsafe(hydrated.players, 0).identity?.draft);

      const search = yield* queries.searchPlayers(owner, { team: teamId });
      assert.strictEqual(search.status, "ok");
      if (search.status !== "ok") {
        return;
      }
      assertDrafted(search.players.find((row) => row.name === "Synthetic 1")?.draft);
      assert.deepStrictEqual(search.players.find((row) => row.name === "Undrafted")?.draft, {
        status: "undrafted",
      });
    }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "states that a league published no draft picks instead of calling every player undrafted",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);

      const summary = yield* queries.getTeamSummary(owner, {
        team: Array.getUnsafe(seeded, 0).id,
        groups: ["roster"],
      });
      assert.strictEqual(summary.status, "ok");
      if (summary.status !== "ok") {
        return;
      }
      assert.isTrue(summary.roster?.every((row) => row.draft.status === "not_published"));
      const coverage = summary.coverage.find(
        (entry) => entry.resource === "roster" && entry.source === "draft_results",
      );
      assert.strictEqual(coverage?.status, "unsupported");
      assert.include(coverage?.detail ?? "", "published no draft picks");
    }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("states that draft history was unreadable instead of calling players undrafted", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    yield* fake.unsupportedOperations(["read_draft_results"]);

    const summary = yield* queries.getTeamSummary(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["roster"],
    });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.isTrue(summary.roster?.every((row) => row.draft.status === "not_published"));
    const coverage = summary.coverage.find(
      (entry) => entry.resource === "roster" && entry.source === "draft_results",
    );
    assert.strictEqual(coverage?.status, "unsupported");
    assert.include(coverage?.detail ?? "", "does not support read_draft_results");
    assert.deepStrictEqual(summary.failures, []);

    const roster = yield* queries.getRosters(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      period: { week: 3 },
    });
    assert.strictEqual(roster.status, "ok");
    if (roster.status !== "ok" || roster.scope !== "team") {
      return;
    }
    const players = yield* queries.getPlayers(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      players: [Array.getUnsafe(roster.players, 0).player],
      groups: ["identity"],
    });
    assert.strictEqual(players.status, "ok");
    if (players.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(Array.getUnsafe(players.players, 0).identity?.draft, {
      status: "not_published",
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reads one draft history for the whole response, not one read per player", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      roster: rosterFixture({ count: 5 }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setDraftResults([
      {
        round: 1,
        pick: 1,
        providerTeamKey: "461.l.1000.t.1",
        providerPlayerKey: "461.p.10001",
      },
    ]);

    const beforeSummary = yield* fake.readCount("read_draft_results");
    const summary = yield* queries.getTeamSummary(owner, { team: teamId, groups: ["roster"] });
    assert.strictEqual(yield* fake.readCount("read_roster"), 1);
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(summary.roster?.length, 5);
    assert.strictEqual((yield* fake.readCount("read_draft_results")) - beforeSummary, 1);
    const rosterCoverage = summary.coverage.find(
      (entry) => entry.resource === "roster" && entry.source === "draft_results",
    );
    assert.include(rosterCoverage?.detail ?? "", "not one read per player");

    const refs = (summary.roster ?? []).map((row) => row.player);
    const beforePlayers = yield* fake.readCount("read_draft_results");
    const hydrated = yield* queries.getPlayers(owner, {
      team: teamId,
      players: refs,
      groups: ["identity"],
    });
    assert.strictEqual(hydrated.status, "ok");
    assert.strictEqual((yield* fake.readCount("read_draft_results")) - beforePlayers, 1);

    yield* fake.setSearchPlayers(
      refs.map((_, index) =>
        searchFixture({
          providerPlayerKey: `461.p.${String(10001 + index)}`,
          name: `Pool ${String(index)}`,
          availability: "free_agent",
          actualRank: index + 1,
          overallRank: index + 1,
          statValue: null,
          percentOwned: 0,
          percentOwnedDelta: 0,
          percentStarted: 0,
          percentStartedChange: 0,
        }),
      ),
    );
    const beforeSearch = yield* fake.readCount("read_draft_results");
    const search = yield* queries.searchPlayers(owner, { team: teamId });
    assert.strictEqual(search.status, "ok");
    assert.strictEqual((yield* fake.readCount("read_draft_results")) - beforeSearch, 1);
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
    if (supportedRoster.status !== "ok" || supportedRoster.scope !== "team") {
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
    if (page.status !== "ok" || page.scope !== "team") {
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
    if (next.status === "ok" && next.scope === "team") {
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
    if (page.status !== "ok" || page.scope !== "team") {
      return;
    }
    assert.isAtMost(receivedToolResultBytes(page), page.budget.hardLimitBytes);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

function encodedKeys(value: unknown): ReadonlyArray<string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

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

const thirteenTeamStandings = (providerLeagueKey: string): ProviderStandings => ({
  providerLeagueKey,
  teams: globalThis.Array.from({ length: 13 }, (_, index) => ({
    providerTeamKey: `${providerLeagueKey}.t.${String(index + 1)}`,
    name: `Synthetic Fantasy Squad ${String(index + 1)}`,
    rank: index + 1,
    playoffSeed: null,
    record: undefined,
    gamesBack: null,
    pointsBack: index,
    points: 120 - index,
    pointsFor: 120 - index,
    pointsAgainst: null,
    streak: undefined,
    acquisitionUsage: {
      seasonMoves: index,
      weeklyAdds: { used: index % 7, coverage: { type: "week", week: 5 } },
    },
    categoryTotals: [1, 2, 3, 8, 14, 31, 32, 19, 22, 23, 25, 24, 26].map((statId) => ({
      statId,
      value: 100 - index,
    })),
    categoryPoints: [1, 2, 3, 8, 14, 31, 32, 19, 22, 23, 25, 24, 26].map((statId) => ({
      statId,
      value: 13 - index,
    })),
  })),
});

it.effect("returns a thirteen-team compact standings table in one result", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Alpha", "nhl")], {
      league: { ...rotoLeagueFixture, providerLeagueKey: "465.l.2000" },
      roster: rosterFixture({
        count: 1,
        coverage: { type: "date", date: "2026-10-26" },
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
      }),
    });
    yield* fake.setStandings(thirteenTeamStandings("465.l.2000"));

    const compact = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["standings"],
    });

    assert.strictEqual(compact.status, "ok");
    if (compact.status !== "ok" || compact.standings?.status !== "available") {
      assert.fail("expected available compact standings");
      return;
    }
    assert.strictEqual(compact.standings.presentation, "compact");
    assert.strictEqual(compact.standings.teams.length, 13);
    assert.strictEqual(compact.page.complete, true);
    assert.isUndefined(compact.page.next);
    assert.deepStrictEqual(
      compact.standings.teams.map((row) => row.rank),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    );
    assert.isTrue(
      compact.standings.teams.every(
        (row) =>
          row.categories === undefined &&
          row.categoryPoints === undefined &&
          row.points !== null &&
          row.pointsBack !== null,
      ),
      "the compact form carries rank, points, and record only",
    );
    assert.isTrue(compact.standings.teams.some((row) => row.current));

    const detailed = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["standings"],
      standingsDetail: "detailed",
    });
    assert.strictEqual(detailed.status, "ok");
    if (detailed.status !== "ok" || detailed.standings?.status !== "available") {
      assert.fail("expected available detailed standings");
      return;
    }
    assert.strictEqual(detailed.standings.presentation, "detailed");
    assert.strictEqual(detailed.page.complete, false);
    assert.isString(detailed.page.next);
    assert.isAbove(detailed.standings.teams.length, 0);
    assert.isBelow(detailed.standings.teams.length, 13);

    const mismatched = yield* Effect.flip(
      queries.getLeague(owner, {
        team: Array.getUnsafe(seeded, 0).id,
        groups: ["overview"],
        standingsDetail: "compact",
      }),
    );
    assert.strictEqual(mismatched._tag, "query.selection_invalid");
    if (mismatched._tag === "query.selection_invalid") {
      assert.include(
        mismatched.detail,
        "`standingsDetail` applies only when the `standings` group",
      );
    }
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
          acquisitionUsage: {
            seasonMoves: 4,
            weeklyAdds: { used: 2, coverage: { type: "week", week: 3 } },
          },
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
          acquisitionUsage: {
            seasonMoves: 0,
            weeklyAdds: { used: 0, coverage: { type: "week", week: 3 } },
          },
          categoryTotals: [{ statId: 4, value: 2800 }],
          categoryPoints: [],
        },
      ],
    });

    const league = yield* queries.getLeague(owner, {
      team: teamId,
      groups: ["standings"],
      standingsDetail: "detailed",
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok" || league.standings?.status !== "available") {
      assert.fail("expected available standings");
      return;
    }
    assert.strictEqual(league.standings.format, "head_to_head_points");
    assert.strictEqual(league.standings.presentation, "detailed");
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
    assert.strictEqual(Array.getUnsafe(league.standings.teams, 0).categories?.length, 2);
    assert.strictEqual(league.standings.categoryTotals?.status, "available");
    assert.strictEqual(league.standings.categoryPoints?.status, "unsupported");
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
        rotoStanding({
          providerTeamKey: "465.l.2000.t.1",
          name: "Roto",
          rank: 1,
          points: {
            1: 12,
            2: 8.5,
            3: 10,
            8: 11,
            14: 9,
            31: 13,
            32: 6.5,
            19: 4,
            23: 7,
            26: 11,
            29: 162,
            30: 15,
          },
          totals: {
            1: 37,
            2: 54,
            3: 91,
            8: 22,
            14: 120,
            31: 88,
            32: 64,
            19: 5,
            22: 51,
            23: 2.63,
            24: 437,
            25: 386,
            26: 0.883,
            29: 162,
            30: 15,
          },
        }),
      ],
    });

    const compact = yield* queries.getLeague(owner, { team: teamId, groups: ["standings"] });
    assert.strictEqual(compact.status, "ok");
    if (compact.status !== "ok" || compact.standings?.status !== "available") {
      assert.fail("expected available rotisserie standings");
      return;
    }
    assert.strictEqual(compact.standings.presentation, "compact");
    assert.strictEqual(compact.standings.teams.length, 1);
    const compactRow = Array.getUnsafe(compact.standings.teams, 0);
    assert.isUndefined(compactRow.categories);
    assert.isUndefined(compactRow.categoryPoints);
    assert.strictEqual(compactRow.rank, 1);
    assert.strictEqual(compactRow.points, 92);
    assert.isUndefined(compactRow.record);
    assert.include(compact.standings.detailNote, "standingsDetail: detailed");

    const dictionary = yield* queries.getLeague(owner, { team: teamId, groups: ["scoring"] });
    assert.strictEqual(dictionary.status, "ok");
    const league = yield* queries.getLeague(owner, {
      team: teamId,
      groups: ["standings"],
      standingsDetail: "detailed",
    });
    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok" || league.standings?.status !== "available") {
      assert.fail("expected available rotisserie standings");
      return;
    }
    assert.strictEqual(league.standings.format, "rotisserie");
    assert.strictEqual(league.standings.presentation, "detailed");
    const row = Array.getUnsafe(league.standings.teams, 0);
    assert.isUndefined(row.record);
    assert.strictEqual(row.pointsBack, 0);
    assert.strictEqual(row.categoryPoints?.length, 13);
    assert.strictEqual(row.categories?.length, 13);
    assert.strictEqual(league.standings.categoryPoints?.status, "available");
    assert.strictEqual(league.standings.omittedCategories?.count, 2);

    const scoring = dictionary.status === "ok" ? (dictionary.scoring ?? []) : [];
    const scoringRefs = new Set(scoring.map((category) => category.stat));
    const named = [...(row.categories ?? []), ...(row.categoryPoints ?? [])];
    assert.isTrue(named.every((entry) => scoringRefs.has(entry.stat)));
    assert.isTrue(
      named.every((entry) => entry.name.length > 0),
      "every category value carries the league's name for the stat",
    );

    const pointStats = new Map((row.categoryPoints ?? []).map((entry) => [entry.stat, entry]));
    const totalStats = new Map((row.categories ?? []).map((entry) => [entry.stat, entry]));
    const gaaRef = Array.getUnsafe(
      scoring.filter((category) => category.abbreviation === "GAA"),
      0,
    ).stat;
    const gaRef = Array.getUnsafe(
      scoring.filter((category) => category.abbreviation === "GA"),
      0,
    ).stat;
    const savesRef = Array.getUnsafe(
      scoring.filter((category) => category.abbreviation === "SV"),
      0,
    ).stat;
    assert.deepStrictEqual(pointStats.get(gaaRef), {
      stat: gaaRef,
      name: "Goals Against Average",
      value: 7,
    });
    for (const stat of [gaRef, savesRef]) {
      const entry = pointStats.get(stat);
      assert.strictEqual(entry?.value, null);
      if (entry?.value === null) {
        assert.include(entry.detail ?? "", "no rotisserie points");
      }
    }
    assert.deepStrictEqual(totalStats.get(gaRef), {
      stat: gaRef,
      name: "Goals Against",
      value: 51,
    });
    assert.strictEqual(
      (row.categoryPoints ?? []).filter((entry) => entry.value !== null).length,
      10,
    );

    const matchups = yield* queries.getMatchups(owner, { team: teamId, period: { week: 4 } });
    assert.strictEqual(matchups.status, "unsupported");
    if (matchups.status === "unsupported") {
      assert.isTrue(
        matchups.coverage.some(
          (entry) => entry.resource === "matchups" && entry.status === "unsupported",
        ),
      );
    }

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league", "standings", "categories", "matchup", "roster"],
    });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(summary.league?.status, "available");
    assert.strictEqual(summary.standing?.status, "available");
    assert.strictEqual(summary.record?.status, "unsupported");
    assert.strictEqual(summary.categoryPoints?.status, "available");
    if (summary.categoryPoints?.status === "available") {
      assert.strictEqual(summary.categoryPoints.values.length, 13);
      assert.strictEqual(summary.categoryPoints.omittedCategories.count, 2);
      assert.isTrue(
        summary.categoryPoints.values.every(
          (entry) => entry.name.length > 0 && entry.name !== entry.stat,
        ),
        "category totals carry the league's stat name beside the reference",
      );
    }
    assert.strictEqual(summary.categoryTotals?.status, "available");
    if (summary.categoryTotals?.status === "available") {
      const gaa = summary.categoryTotals.values.find(
        (entry) => entry.name === "Goals Against Average",
      );
      assert.strictEqual(
        gaa?.value,
        2.63,
        "the season total is inlined beside the league's name for the category",
      );
      assert.isTrue(
        summary.categoryTotals.values.some(
          (entry) => entry.name === "Save Percentage" && entry.value !== null,
        ),
      );
    }
    assert.strictEqual(summary.matchup?.status, "unsupported");
    assert.isTrue((summary.roster ?? []).length > 0);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("states the rotisserie categories whose points your league does not publish", () =>
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
    const standing = rotoStanding({
      providerTeamKey: "465.l.2000.t.1",
      name: "Roto",
      rank: 1,
      points: { 1: 12, 2: 8.5, 3: 10, 14: 9, 31: 13, 26: 11 },
      totals: { 1: 37, 2: 54, 3: 91, 14: 120, 31: 88, 26: 0.883 },
    });
    yield* fake.setStandings({
      providerLeagueKey: "465.l.2000",
      teams: [
        {
          ...standing,
          categoryPoints: standing.categoryPoints.filter((entry) => entry.statId !== 26),
        },
      ],
    });

    const league = yield* queries.getLeague(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["standings"],
      standingsDetail: "detailed",
    });

    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok" || league.standings?.status !== "available") {
      assert.fail("expected available rotisserie standings");
      return;
    }
    const row = Array.getUnsafe(league.standings.teams, 0);
    const savePercentage = Array.getUnsafe(
      (row.categoryPoints ?? []).filter((entry) => entry.name === "Save Percentage"),
      0,
    ).stat;
    const points = new Map((row.categoryPoints ?? []).map((entry) => [entry.stat, entry]));

    assert.strictEqual(row.categoryPoints?.length, 13);
    assert.deepStrictEqual(points.get(savePercentage), {
      stat: savePercentage,
      name: "Save Percentage",
      value: null,
      detail: "Your league published no rotisserie points for this category.",
    });
    assert.strictEqual(points.get(savePercentage)?.value, null);
    assert.isTrue(
      (row.categoryPoints ?? []).every(
        (entry) => entry.value !== null || (entry.detail?.length ?? 0) > 0,
      ),
      "every unpublished category states why instead of returning a bare null",
    );
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
    assert.strictEqual(summary.league?.status, "available");
    assert.strictEqual(summary.standings?.status, "unsupported");
    assert.strictEqual(summary.standing?.status, "unsupported");
    assert.strictEqual(summary.matchup?.status, "available");
    assert.strictEqual(summary.roster?.length, 2);
    assert.deepStrictEqual(summary.roster?.[0]?.week, {
      period: { week: 3 },
      playsThisWeek: true,
      opponent: null,
      home: null,
      byeWeek: 7,
    });
    assert.isTrue(
      summary.coverage.some(
        (entry) => entry.resource === "standings" && entry.status === "degraded",
      ),
    );
    assert.isTrue(summary.failures.some((failure) => failure.code === "provider_invalid_response"));
    assert.strictEqual(summary.remainingPlayerGames?.status, "unsupported");
    if (summary.remainingPlayerGames?.status === "unsupported") {
      assert.include(summary.remainingPlayerGames.detail, "bye week");
    }
    assert.notInclude(encodedKeys(summary), "probableStarters");
    assert.deepStrictEqual(summary.ownerNote, { status: "not_set" });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("returns the owner note as owner context in a team summary", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const writtenAt = DateTime.makeUnsafe("2026-10-30T18:00:00.000Z");
    yield* database
      .update(providerTeams)
      .set({
        ownerNote: "Dynasty league. Keep both goalies; cost rises by 5 each season.",
        ownerNoteUpdatedAt: DateTime.toDateUtc(writtenAt),
      })
      .where(eq(providerTeams.id, teamId));

    const summary = yield* queries.getTeamSummary(owner, { team: teamId });

    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(summary.ownerNote, {
      status: "provided",
      text: "Dynasty league. Keep both goalies; cost rises by 5 each season.",
      updatedAt: writtenAt,
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("returns recent agent notes newest first and bounds them beside the owner note", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const writtenAt = DateTime.makeUnsafe("2026-10-30T18:00:00.000Z");
    yield* database
      .update(providerTeams)
      .set({
        ownerNote: "The owner's instruction.",
        ownerNoteUpdatedAt: DateTime.toDateUtc(writtenAt),
      })
      .where(eq(providerTeams.id, teamId));
    const stored = yield* database
      .select({ connectionId: providerTeams.connectionId })
      .from(providerTeams)
      .where(eq(providerTeams.id, teamId))
      .limit(1);
    const connectionId = stored[0]?.connectionId;
    if (connectionId === undefined) {
      throw new Error("The seeded team has no connection");
    }
    yield* database.insert(providerTeamAgentNotes).values(
      Array.makeBy(25, (index) => ({
        id: noteId(index),
        teamId,
        connectionId,
        userId: owner,
        body: `Agent memory ${String(index)}`,
        authorName: index % 2 === 0 ? "Agent One" : null,
        authorClientId: index % 2 === 0 ? "client-one" : "client-two",
        writtenAt: DateTime.toDateUtc(DateTime.makeUnsafe(1_800_000_000_000 + index * 1_000)),
      })),
    );

    const summary = yield* queries.getTeamSummary(owner, { team: teamId });

    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(summary.agentNotes.length, 20);
    assert.strictEqual(summary.agentNotes[0]?.body, "Agent memory 24");
    assert.strictEqual(summary.agentNotes.at(-1)?.body, "Agent memory 5");
    assert.deepStrictEqual(summary.agentNotes[0]?.author, {
      clientId: "client-one",
      name: "Agent One",
    });
    assert.strictEqual(summary.agentNotes[1]?.author.name, null);
    assert.strictEqual(summary.ownerNote.status, "provided");
    assert.strictEqual(
      summary.ownerNote.status === "provided" ? summary.ownerNote.text : undefined,
      "The owner's instruction.",
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("returns an explicitly empty agent-note list when the team has none", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);

    const summary = yield* queries.getTeamSummary(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["league"],
    });

    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(summary.agentNotes, []);
    assert.deepStrictEqual(summary.ownerNote, { status: "not_set" });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("carries the owner note on the full roster read", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [
      team("461.l.1000.t.1", "Alpha"),
      team("461.l.1000.t.2", "Beta"),
    ]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const writtenAt = DateTime.makeUnsafe("2026-10-30T18:00:00.000Z");
    const note = "Dynasty league. Keep both goalies; cost rises by 5 each season.";
    yield* database
      .update(providerTeams)
      .set({ ownerNote: note, ownerNoteUpdatedAt: DateTime.toDateUtc(writtenAt) })
      .where(eq(providerTeams.id, teamId));

    const compact = yield* queries.getRosters(owner, { team: teamId });
    assert.strictEqual(compact.status, "ok");
    if (compact.status !== "ok") {
      return;
    }
    assert.isFalse("ownerNote" in compact);

    const full = yield* queries.getRosters(owner, { team: teamId, detail: "full" });
    assert.strictEqual(full.status, "ok");
    if (full.status !== "ok" || full.scope !== "team") {
      return;
    }
    assert.deepStrictEqual(full.ownerNote, {
      status: "provided",
      text: note,
      updatedAt: writtenAt,
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("filters transactions by scope and date inside the bounded provider window", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setTransactions([
      transaction({
        occurredAt: "2026-09-24T12:00:00.000Z",
        type: "add",
        teams: [alphaTeam],
        players: [
          transactionPlayer(
            "461.p.10003",
            movement("add", undefined, alphaTeam),
            "Synthetic Addition",
          ),
        ],
      }),
      transaction({
        occurredAt: "2026-09-20T12:00:00.000Z",
        type: "drop",
        teams: [betaTeam],
        players: [
          transactionPlayer(
            "461.p.10004",
            movement("drop", betaTeam, undefined),
            "Synthetic Rival Drop",
          ),
        ],
      }),
      transaction({
        occurredAt: "2026-09-10T12:00:00.000Z",
        type: "add",
        teams: [alphaTeam],
        players: [
          transactionPlayer(
            "461.p.10005",
            movement("add", undefined, alphaTeam),
            "Synthetic Older Add",
          ),
        ],
      }),
    ]);

    const own = yield* queries.getTransactions(owner, { team: teamId, scope: "team" });
    assert.strictEqual(own.status, "ok");
    if (own.status !== "ok") {
      return;
    }
    assert.strictEqual(own.transactions.length, 2);
    assert.strictEqual(own.window.fetched, 2);
    assert.isFalse(own.window.truncated);
    const firstMove = Array.getUnsafe(Array.getUnsafe(own.transactions, 0).players, 0);
    assert.strictEqual(firstMove.name, "Synthetic Addition");
    assert.strictEqual(firstMove.primaryPosition, undefined);
    assert.strictEqual(firstMove.displayPosition, "WR");
    assert.strictEqual(firstMove.proTeam, "SYN");

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

it.effect("reports a transaction range that starts before your league's history", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setTransactions(
      globalThis.Array.from({ length: 50 }, (_, index) =>
        transaction({
          occurredAt: DateTime.formatIso(
            DateTime.makeUnsafe("2026-09-25T12:00:00.000Z").pipe(
              DateTime.subtract({ hours: index }),
            ),
          ),
          type: "add",
          teams: [alphaTeam],
          players: [
            transactionPlayer(
              "461.p.10003",
              movement("add", undefined, alphaTeam),
              "Synthetic Addition",
            ),
          ],
        }),
      ),
    );

    const ranged = yield* queries.getTransactions(owner, {
      team: teamId,
      since: DateTime.makeUnsafe("2026-08-01T00:00:00.000Z"),
    });
    assert.strictEqual(ranged.status, "ok");
    if (ranged.status !== "ok") {
      return;
    }
    assert.isFalse(ranged.window.truncated);
    assert.strictEqual(ranged.window.fetched, 50);
    assert.isTrue(
      ranged.coverage.some(
        (entry) => entry.resource === "transactions" && entry.status === "degraded",
      ),
    );
    assert.isTrue(
      ranged.failures.some((failure) => failure.code === "transaction_history_starts_after_range"),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("pages back to a transaction range older than the newest provider page", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    const base = DateTime.makeUnsafe("2026-09-25T12:00:00.000Z");
    const occurredAt = (hours: number): string =>
      DateTime.formatIso(base.pipe(DateTime.subtract({ hours })));
    yield* fake.setTransactions(
      globalThis.Array.from({ length: 120 }, (_, index) =>
        transaction({
          occurredAt: occurredAt(index),
          type: "add",
          teams: [alphaTeam],
          players: [
            transactionPlayer(
              "461.p.10003",
              movement("add", undefined, alphaTeam),
              "Synthetic Addition",
            ),
          ],
        }),
      ),
    );

    const input = {
      team: teamId,
      since: DateTime.makeUnsafe(occurredAt(106)),
      until: DateTime.makeUnsafe(occurredAt(94)),
    };
    const occurred: string[] = [];
    let cursor: string | undefined;
    let window: { fetched: number; truncated: boolean } | undefined;
    do {
      const page = yield* queries.getTransactions(owner, {
        ...input,
        ...(cursor === undefined ? {} : { cursor }),
      });
      assert.strictEqual(page.status, "ok");
      if (page.status !== "ok") {
        return;
      }
      window = page.window;
      assert.deepStrictEqual(page.failures, []);
      for (const transaction of page.transactions) {
        occurred.push(transaction.occurredAt);
      }
      cursor = page.page.next;
    } while (cursor !== undefined);

    assert.strictEqual(window.fetched, 120);
    assert.isFalse(window.truncated);
    assert.strictEqual(occurred.length, 13);
    assert.strictEqual(occurred[0], occurredAt(94));
    assert.strictEqual(occurred[12], occurredAt(106));
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports truncation when the transaction read reaches its page cap", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setTransactions(
      globalThis.Array.from({ length: 501 }, (_, index) =>
        transaction({
          occurredAt: DateTime.formatIso(
            DateTime.makeUnsafe("2026-09-25T12:00:00.000Z").pipe(
              DateTime.subtract({ hours: index }),
            ),
          ),
          type: "add",
          teams: [alphaTeam],
          players: [
            transactionPlayer(
              "461.p.10003",
              movement("add", undefined, alphaTeam),
              "Synthetic Addition",
            ),
          ],
        }),
      ),
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
    assert.strictEqual(ranged.window.fetched, 500);
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
    const stat = Array.getUnsafe(league.scoring ?? [], 0).stat;

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

it.effect("refuses a weekly player sort the rows cannot explain", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;

    const rejected = yield* Effect.flip(
      queries.searchPlayers(owner, {
        team: teamId,
        availability: "free_agent",
        sort: "actual_rank",
        window: { kind: "week", week: 2 },
      }),
    );
    assert.strictEqual(rejected._tag, "query.selection_invalid");
    if (rejected._tag === "query.selection_invalid") {
      assert.include(rejected.detail, "weekly ordering cannot be shown");
    }

    const season = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "actual_rank",
      window: { kind: "season" },
    });
    assert.strictEqual(season.status, "ok");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("surfaces the rank and stat values that each provider-ordered sort uses", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setSearchPlayers([
      searchFixture({
        providerPlayerKey: "461.p.10021",
        name: "Higher Rank",
        availability: "free_agent",
        actualRank: 4,
        overallRank: 9,
        statValue: 120,
        percentOwned: 61,
        percentOwnedDelta: 2,
        percentStarted: 40,
        percentStartedChange: null,
      }),
      searchFixture({
        providerPlayerKey: "461.p.10022",
        name: "Lower Rank",
        availability: "free_agent",
        actualRank: 11,
        overallRank: 3,
        statValue: 240,
        percentOwned: 22,
        percentOwnedDelta: 0,
        percentStarted: 12,
        percentStartedChange: 1,
      }),
    ]);

    const byActualRank = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "actual_rank",
    });
    assert.strictEqual(byActualRank.status, "ok");
    if (byActualRank.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      byActualRank.players.map((player) => player.actualRank),
      [4, 11],
    );
    assert.deepStrictEqual(
      byActualRank.players.map((player) => player.percentOwnedDelta),
      [2, 0],
    );
    assert.isTrue(
      byActualRank.players.every(
        (player) =>
          !Object.hasOwn(player, "percentOwnedChange") &&
          Object.hasOwn(player, "percentOwnedDelta"),
      ),
      "the ownership change is reported once, under the field that carries your league delta",
    );
    assert.deepStrictEqual(
      byActualRank.players.map((player) => player.percentStartedChange),
      [null, 1],
      "a started change your league did not publish stays null instead of being invented",
    );
    assert.isTrue(byActualRank.players.every((player) => player.statValue === undefined));

    const byOverallRank = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "overall_rank",
    });
    assert.strictEqual(byOverallRank.status, "ok");
    if (byOverallRank.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      byOverallRank.players.map((player) => player.overallRank),
      [3, 9],
    );

    const league = yield* queries.getLeague(owner, { team: teamId, groups: ["scoring"] });
    assert.strictEqual(league.status, "ok");
    if (league.status !== "ok") {
      return;
    }
    const stat = Array.getUnsafe(league.scoring ?? [], 0).stat;
    const byStat = yield* queries.searchPlayers(owner, {
      team: teamId,
      availability: "free_agent",
      sort: "stat",
      stat,
    });
    assert.strictEqual(byStat.status, "ok");
    if (byStat.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(
      byStat.players.map((player) => player.statValue),
      [240, 120],
    );
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
    if (roster.status !== "ok" || roster.scope !== "team") {
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
    const schedule = summary.remainingPlayerGames;
    assert.strictEqual(schedule?.status, "available");
    if (schedule?.status !== "available") {
      return;
    }
    assert.strictEqual(schedule.unit, "fantasy_team_player_games");
    assert.strictEqual(schedule.weeks.length, 2);
    assert.deepStrictEqual(Array.getUnsafe(schedule.weeks, 0), {
      period: { week: 3 },
      current: true,
      completed: 51,
      live: 3,
      remaining: 0,
    });
    assert.deepStrictEqual(Array.getUnsafe(schedule.weeks, 1), {
      period: { week: 4 },
      current: false,
      completed: 0,
      live: 0,
      remaining: 46,
    });
    assert.isTrue(
      summary.coverage.some(
        (entry) => entry.resource === "remaining_player_games" && entry.status === "available",
      ),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports each rostered player's scheduled games and the roster count per date", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
      league: hockeyLeagueFixture,
      roster: rosterFixture({
        count: 4,
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
        coverage: { type: "date", date: "2026-10-20" },
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setMatchups([matchupFixture({ period: 3 })]);
    yield* fake.setSchedule(
      scheduleFixture({
        providerTeamKey: "465.l.2000.t.1",
        dates: [
          "2026-10-19",
          "2026-10-20",
          "2026-10-21",
          "2026-10-22",
          "2026-10-23",
          "2026-10-24",
          "2026-10-25",
        ],
        players: [
          {
            key: "461.p.10001",
            name: "Synthetic Two Games",
            games: [
              { date: "2026-10-19", opponent: "TOR", home: true },
              { date: "2026-10-21", opponent: "LA", home: false },
            ],
          },
          {
            key: "461.p.10002",
            name: "Synthetic One Game",
            games: [{ date: "2026-10-20", opponent: "BOS", home: true }],
          },
          { key: "461.p.10003", name: "Synthetic No Games", games: [] },
          {
            key: "461.p.10004",
            name: "Synthetic Away Game",
            games: [{ date: "2026-10-19", opponent: "WPG", home: false }],
          },
        ],
      }),
    );

    const summary = yield* queries.getTeamSummary(owner, { team: teamId, groups: ["schedule"] });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(yield* fake.schedulePeriods, [
      { type: "date", start: "2026-10-19", end: "2026-10-25" },
    ]);
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "available");
    if (schedule?.status !== "available") {
      return;
    }
    assert.strictEqual(schedule.coverage, "date");
    assert.deepStrictEqual(schedule.period, { week: 3 });
    assert.deepStrictEqual(schedule.window, {
      start: "2026-10-19",
      end: "2026-10-25",
      source: "period",
    });
    assert.isTrue(DateTime.isDateTime(schedule.observedAt));
    assert.deepStrictEqual(schedule.dates, [
      { date: "2026-10-19", rosterGames: 2 },
      { date: "2026-10-20", rosterGames: 1 },
      { date: "2026-10-21", rosterGames: 1 },
      { date: "2026-10-22", rosterGames: 0 },
      { date: "2026-10-23", rosterGames: 0 },
      { date: "2026-10-24", rosterGames: 0 },
      { date: "2026-10-25", rosterGames: 0 },
    ]);
    assert.deepStrictEqual(
      schedule.players.map((player) => [
        player.name,
        player.status,
        player.gameCount,
        player.games,
      ]),
      [
        [
          "Synthetic Two Games",
          "scheduled",
          2,
          [
            { date: "2026-10-19", opponent: "TOR", home: true },
            { date: "2026-10-21", opponent: "LA", home: false },
          ],
        ],
        [
          "Synthetic One Game",
          "scheduled",
          1,
          [{ date: "2026-10-20", opponent: "BOS", home: true }],
        ],
        ["Synthetic No Games", "no_games", 0, []],
        [
          "Synthetic Away Game",
          "scheduled",
          1,
          [{ date: "2026-10-19", opponent: "WPG", home: false }],
        ],
      ],
    );
    assert.include(schedule.detail, "2026-10-19 to 2026-10-25");
    assert.include(schedule.detail, "no start time");
    assert.isTrue(
      summary.coverage.some(
        (entry) => entry.resource === "schedule" && entry.status === "available",
      ),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect(
  "lists each rostered player's opponents from the league's professional schedule over a requested window",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const games = yield* FakeGameSourceWorld;
      const store = yield* ScheduleObservationRepository;
      const baseRoster = rosterFixture({
        count: 4,
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
        coverage: { type: "date", date: "2026-10-20" },
      });
      const roster: ProviderRoster = {
        ...baseRoster,
        players: baseRoster.players.map((player, index) => ({
          ...player,
          proTeamAbbreviation: ["TOR", "BOS", "NYR", "ZZZ"][index],
          ...(index === 0 ? { proTeamKey: "nhl.t.21" } : {}),
        })),
      };
      const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
        league: hockeyLeagueFixture,
        roster,
      });
      const teamId = Array.getUnsafe(seeded, 0).id;
      const provider = decodeProviderKey("yahoo");
      const observedAt = DateTime.makeUnsafe("2026-10-19T12:00:00.000Z");
      yield* store.recordTeamIdentities([
        {
          sport: "hockey",
          source: provider,
          sourceTeamIdentifier: "BOS",
          provider,
          providerTeamKey: "nhl.t.1",
          observedAt,
        },
        {
          sport: "hockey",
          source: provider,
          sourceTeamIdentifier: "NYR",
          provider,
          providerTeamKey: "nhl.t.13",
          observedAt,
        },
      ]);
      yield* fake.setMatchups([matchupFixture({ period: 3 })]);
      yield* games.setGames([
        calendarGame("g1", "2026-10-19", "TOR", "BOS"),
        calendarGame("g2", "2026-10-19", "NYR", "LA"),
        calendarGame("g3", "2026-10-20", "BOS", "NYR"),
        calendarGame("g4", "2026-10-21", "TOR", "LA"),
        calendarGame("g5", "2026-10-22", "NYR", "TOR"),
      ]);

      const summary = yield* queries.getTeamSummary(owner, {
        team: teamId,
        groups: ["schedule"],
        window: { start: "2026-10-19", end: "2026-10-22" },
      });

      assert.strictEqual(summary.status, "ok");
      if (summary.status !== "ok") {
        return;
      }
      assert.deepStrictEqual(yield* fake.schedulePeriods, []);
      const schedule = summary.schedule;
      assert.strictEqual(schedule?.status, "available");
      if (schedule?.status !== "available") {
        return;
      }
      assert.strictEqual(schedule.coverage, "date");
      assert.deepStrictEqual(schedule.window, {
        start: "2026-10-19",
        end: "2026-10-22",
        source: "requested",
      });
      assert.deepStrictEqual(schedule.dates, [
        { date: "2026-10-19", rosterGames: 3, leagueGames: 2, teamsPlaying: 4, offNight: false },
        { date: "2026-10-20", rosterGames: 2, leagueGames: 1, teamsPlaying: 2, offNight: true },
        { date: "2026-10-21", rosterGames: 1, leagueGames: 1, teamsPlaying: 2, offNight: true },
        { date: "2026-10-22", rosterGames: 2, leagueGames: 1, teamsPlaying: 2, offNight: true },
      ]);
      assert.deepStrictEqual(
        schedule.players.map((player) => [
          player.name,
          player.proTeam,
          player.status,
          player.gameCount,
          player.games,
          player.gamesRemaining,
        ]),
        [
          [
            "Synthetic 0",
            "TOR",
            "scheduled",
            3,
            [
              { date: "2026-10-19", opponent: "BOS", home: true, offNight: false },
              { date: "2026-10-21", opponent: "LA", home: true, offNight: true },
              { date: "2026-10-22", opponent: "NYR", home: false, offNight: true },
            ],
            { status: "available", count: 3, source: "professional_games" },
          ],
          [
            "Synthetic 1",
            "BOS",
            "scheduled",
            2,
            [
              { date: "2026-10-19", opponent: "TOR", home: false, offNight: false },
              { date: "2026-10-20", opponent: "NYR", home: true, offNight: true },
            ],
            { status: "available", count: 2, source: "professional_games" },
          ],
          [
            "Synthetic 2",
            "NYR",
            "scheduled",
            3,
            [
              { date: "2026-10-19", opponent: "LA", home: true, offNight: false },
              { date: "2026-10-20", opponent: "BOS", home: false, offNight: true },
              { date: "2026-10-22", opponent: "TOR", home: true, offNight: true },
            ],
            { status: "available", count: 3, source: "professional_games" },
          ],
          [
            "Synthetic 3",
            "ZZZ",
            "unknown",
            0,
            [],
            {
              status: "unavailable",
              detail:
                "This player's professional team could not be identified, so the league's games cannot be joined to this row.",
            },
          ],
        ],
      );
      assert.strictEqual(schedule.gamesRemaining.status, "available");
      if (schedule.gamesRemaining.status === "available") {
        assert.deepStrictEqual(schedule.gamesRemaining.sources, ["professional_games"]);
        assert.deepStrictEqual(schedule.gamesRemaining.window, {
          start: "2026-10-19",
          end: "2026-10-22",
          source: "requested",
        });
        assert.include(schedule.gamesRemaining.detail ?? "", "could not be identified");
      }
      assert.include(schedule.detail, "from your league's professional games");
      assert.include(
        schedule.detail,
        "1 roster row has no professional team that could be identified, so its games are unknown.",
      );
      assert.isTrue(
        summary.coverage.some(
          (entry) => entry.resource === "schedule" && entry.source === "professional_games",
        ),
      );
    }).pipe(Effect.provide(queriesTestLayerWithGames(6))),
);

it.effect(
  "takes a requested date window for a week-scoped league with a professional schedule",
  () =>
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const fake = yield* FakeProviderWorld;
      const games = yield* FakeGameSourceWorld;
      const roster = rosterFixture({
        count: 1,
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
        coverage: { type: "week", week: 3 },
      });
      const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
        league: { ...hockeyLeagueFixture, rosterCoverage: "week" },
        roster: {
          ...roster,
          players: roster.players.map((player) => ({
            ...player,
            proTeamKey: "nhl.t.21",
            proTeamAbbreviation: "TOR",
          })),
        },
      });
      const teamId = Array.getUnsafe(seeded, 0).id;
      yield* fake.setMatchups([matchupFixture({ period: 3 })]);
      yield* games.setGames([calendarGame("g1", "2026-10-20", "TOR", "BOS")]);

      const summary = yield* queries.getTeamSummary(owner, {
        team: teamId,
        groups: ["schedule"],
        window: { start: "2026-10-19", end: "2026-10-21" },
      });

      assert.strictEqual(summary.status, "ok");
      if (summary.status !== "ok") {
        return;
      }
      assert.deepStrictEqual(yield* fake.schedulePeriods, []);
      const schedule = summary.schedule;
      assert.strictEqual(schedule?.status, "available");
      if (schedule?.status !== "available") {
        return;
      }
      assert.strictEqual(schedule.coverage, "date");
      assert.deepStrictEqual(schedule.window, {
        start: "2026-10-19",
        end: "2026-10-21",
        source: "requested",
      });
      assert.deepStrictEqual(schedule.dates, [
        { date: "2026-10-19", rosterGames: 0, leagueGames: 0, teamsPlaying: 0, offNight: true },
        { date: "2026-10-20", rosterGames: 1, leagueGames: 1, teamsPlaying: 2, offNight: true },
        { date: "2026-10-21", rosterGames: 0, leagueGames: 0, teamsPlaying: 0, offNight: true },
      ]);
      assert.deepStrictEqual(Array.getUnsafe(schedule.players, 0).games, [
        { date: "2026-10-20", opponent: "BOS", home: true, offNight: true },
      ]);
    }).pipe(Effect.provide(queriesTestLayerWithGames(6))),
);

it.effect("reports the league's professional games instead of reading the provider schedule", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const games = yield* FakeGameSourceWorld;
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
    yield* fake.setMatchups([matchupFixture({ period: 3 })]);
    yield* fake.setSchedule(
      scheduleFixture({
        providerTeamKey: "465.l.2000.t.1",
        dates: ["2026-10-19"],
        players: [
          {
            key: "461.p.10001",
            name: "Synthetic 0",
            proTeamKey: "nhl.t.21",
            proTeamAbbreviation: "TOR",
            games: [{ date: "2026-10-19", opponent: "BOS", home: true }],
          },
        ],
      }),
    );
    yield* games.setFailure("unavailable");

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
    });

    assert.strictEqual(summary.status, "unsupported");
    if (summary.status === "unsupported") {
      assert.strictEqual(summary.schedule?.status, "unsupported");
      if (summary.schedule?.status === "unsupported") {
        assert.include(summary.schedule.detail, "professional-game source could not be reached");
      }
    }
    assert.deepStrictEqual(yield* fake.schedulePeriods, []);
  }).pipe(Effect.provide(queriesTestLayerWithGames(6))),
);

it.effect("serve your league's opponent fact with off nights absent for a football league", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setSchedule({
      providerTeamKey: "461.l.1000.t.1",
      period: { type: "week", week: 3 },
      dates: [],
      players: [
        {
          providerPlayerKey: "461.p.10001",
          name: "Weekly Starter",
          proTeamKey: undefined,
          proTeamAbbreviation: undefined,
          games: [{ date: undefined, opponent: "BOS", home: true }],
        },
      ],
    });

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
    });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "available");
    if (schedule?.status !== "available") {
      return;
    }
    assert.strictEqual(schedule.coverage, "week");
    assert.isUndefined(schedule.dates);
    assert.strictEqual(schedule.offNights.status, "unsupported");
    if (schedule.offNights.status === "unsupported") {
      assert.include(schedule.offNights.detail, "scoring-week");
    }
    assert.deepStrictEqual(Array.getUnsafe(schedule.players, 0).gamesRemaining, {
      status: "available",
      count: 1,
      source: "provider_opponent",
    });
    assert.isUndefined(Array.getUnsafe(Array.getUnsafe(schedule.players, 0).games, 0).offNight);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("serves a repeated schedule window from stored opponent facts", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedOpponentTeams(fake, ["465.l.2000.t.1"]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-19T12:00:00.000Z")),
    );

    const first = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: opponentWindow,
    });
    const second = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: opponentWindow,
    });

    assert.deepStrictEqual(yield* fake.schedulePeriods, [
      { type: "date", start: "2026-10-19", end: "2026-10-21" },
    ]);
    assert.strictEqual(second.status, "ok");
    if (first.status !== "ok" || second.status !== "ok") {
      return;
    }
    const firstSchedule = first.schedule;
    const secondSchedule = second.schedule;
    assert.strictEqual(secondSchedule?.status, "available");
    if (firstSchedule?.status !== "available" || secondSchedule?.status !== "available") {
      return;
    }
    assert.strictEqual(DateTime.formatIso(secondSchedule.observedAt), "2026-10-19T12:00:00.000Z");
    assert.deepStrictEqual(
      secondSchedule.players.map((player) => [player.name, player.gameCount, player.games]),
      firstSchedule.players.map((player) => [player.name, player.gameCount, player.games]),
    );
    assert.deepStrictEqual(secondSchedule.dates, firstSchedule.dates);

    const store = yield* ScheduleObservationRepository;
    const identities = yield* store.readSourceTeamIdentities({
      sport: "hockey",
      source: "yahoo",
    });
    assert.deepStrictEqual(
      identities.map((identity) => [identity.sourceTeamIdentifier, identity.providerTeamKey]),
      [
        ["BOS", "fixture.t.2"],
        ["TOR", "fixture.t.1"],
      ],
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("re-reads only the date past its fantasy-day boundary", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedOpponentTeams(fake, ["465.l.2000.t.1"]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-19T12:00:00.000Z")),
    );
    yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: opponentWindow,
    });

    yield* TestClock.adjust(2 * 3_600_000);
    const insideTheDay = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: opponentWindow,
    });
    if (insideTheDay.status !== "ok") {
      return;
    }
    assert.strictEqual(insideTheDay.schedule?.status, "available");
    if (insideTheDay.schedule?.status === "available") {
      assert.strictEqual(
        DateTime.formatIso(insideTheDay.schedule.observedAt),
        "2026-10-19T12:00:00.000Z",
      );
    }
    assert.deepStrictEqual(yield* fake.schedulePeriods, [
      { type: "date", start: "2026-10-19", end: "2026-10-21" },
    ]);

    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-20T08:00:00.000Z")),
    );
    const afterTheBoundary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: opponentWindow,
    });

    assert.deepStrictEqual(yield* fake.schedulePeriods, [
      { type: "date", start: "2026-10-19", end: "2026-10-21" },
      { type: "date", start: "2026-10-19", end: "2026-10-19" },
    ]);
    if (afterTheBoundary.status !== "ok") {
      return;
    }
    assert.strictEqual(afterTheBoundary.schedule?.status, "available");
    if (afterTheBoundary.schedule?.status === "available") {
      assert.deepStrictEqual(afterTheBoundary.schedule.dates, [
        { date: "2026-10-19", rosterGames: 1 },
        { date: "2026-10-20", rosterGames: 1 },
        { date: "2026-10-21", rosterGames: 1 },
      ]);
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("keeps a stale opponent's previous observation when the re-read fails", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedOpponentTeams(fake, ["465.l.2000.t.1"]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-19T12:00:00.000Z")),
    );
    const first = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: opponentWindow,
    });
    if (first.status !== "ok") {
      return;
    }
    assert.strictEqual(first.schedule?.status, "available");

    yield* fake.failSchedule("unavailable");
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-20T08:00:00.000Z")),
    );
    const refused = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: opponentWindow,
    });
    assert.strictEqual(refused.status, "failed");
    if (refused.status === "narrowing_required") {
      return;
    }
    assert.deepStrictEqual(
      refused.failures.map((failure) => failure.code),
      ["schedule_fact_stale"],
    );
    assert.strictEqual(refused.schedule?.status, "unsupported");
    if (refused.schedule?.status !== "unsupported") {
      return;
    }
    assert.include(refused.schedule.detail, "2026-10-19");
    assert.include(refused.schedule.detail, "past their maximum age");
    assert.include(refused.schedule.detail, "2026-10-19T12:00:00.000Z");
    assert.include(refused.schedule.detail, "could not be reached");

    yield* TestClock.adjust(3_600_000);
    const refusedAgain = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: opponentWindow,
    });
    if (refusedAgain.status === "narrowing_required") {
      return;
    }
    assert.strictEqual(refusedAgain.schedule?.status, "unsupported");
    if (refusedAgain.schedule?.status === "unsupported") {
      assert.include(refusedAgain.schedule.detail, "2026-10-19T12:00:00.000Z");
      assert.notInclude(refusedAgain.schedule.detail, "2026-10-20T09:00:00.000Z");
    }

    yield* fake.failSchedule(undefined);
    const recovered = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: { start: "2026-10-19", end: "2026-10-19" },
    });
    if (recovered.status !== "ok") {
      return;
    }
    assert.strictEqual(recovered.schedule?.status, "available");
    if (recovered.schedule?.status === "available") {
      assert.strictEqual(
        DateTime.formatIso(recovered.schedule.observedAt),
        "2026-10-20T09:00:00.000Z",
      );
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("lets two workers record the same date without conflicting", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedOpponentTeams(fake, ["465.l.2000.t.1"]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-19T12:00:00.000Z")),
    );

    const [left, right] = yield* Effect.all(
      [
        queries.getTeamSummary(owner, {
          team: teamId,
          groups: ["schedule"],
          window: opponentWindow,
        }),
        queries.getTeamSummary(owner, {
          team: teamId,
          groups: ["schedule"],
          window: opponentWindow,
        }),
      ],
      { concurrency: 2 },
    );
    assert.strictEqual(left.status, "ok");
    assert.strictEqual(right.status, "ok");

    const readsByWorkers = (yield* fake.schedulePeriods).length;
    const settled = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: opponentWindow,
    });
    if (settled.status !== "ok") {
      return;
    }
    assert.strictEqual(settled.schedule?.status, "available");
    assert.strictEqual((yield* fake.schedulePeriods).length, readsByWorkers);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("measures a day of uncached hourly schedule sweeps", () =>
  Effect.gen(function* () {
    const fake = yield* FakeProviderWorld;
    const registry = yield* ProviderRegistry;
    const provider = yield* registry.requireProvider(decodeProviderKey("yahoo"));
    for (const teamKey of ownerTeamKeys) {
      yield* fake.setTeamSchedule(teamKey, opponentSchedule(teamKey));
    }

    const periods: Array<ProviderSchedulePeriod> = [];
    for (let hour = 0; hour < 24; hour += 1) {
      for (const providerTeamKey of ownerTeamKeys) {
        const schedule = yield* provider.readRosterSchedule({
          provider: decodeProviderKey("yahoo"),
          session,
          providerTeamKey,
          period: { type: "date", ...opponentWindow },
        });
        periods.push(schedule.period);
      }
    }

    assert.strictEqual(periods.length, 120);
    assert.strictEqual(scheduleDateReads(periods), 360);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("serves a day of hourly sweeps with one newly covered date per team", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedOpponentTeams(fake, ownerTeamKeys, { periodWindow: undefined });
    const teamIds = seeded.map((row) => row.id);
    const tickReads: Array<number> = [];
    const dailyReads: Array<number> = [];

    for (let day = 0; day < 3; day += 1) {
      const firstTick = DateTime.add(DateTime.makeUnsafe("2026-10-19T07:00:00.000Z"), {
        days: day,
      });
      const window = {
        start: DateTime.formatIsoDate(firstTick),
        end: DateTime.formatIsoDate(DateTime.add(firstTick, { days: 2 })),
      };
      let dayReads = 0;
      for (let hour = 0; hour < 24; hour += 1) {
        yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.add(firstTick, { hours: hour })));
        const before = (yield* fake.schedulePeriods).length;
        for (const teamId of teamIds) {
          const summary = yield* queries.getTeamSummary(owner, {
            team: teamId,
            groups: ["schedule"],
            window,
          });
          assert.strictEqual(summary.status, "ok");
          if (summary.status !== "ok") {
            return;
          }
        }
        const reads = scheduleDateReads((yield* fake.schedulePeriods).slice(before));
        tickReads.push(reads);
        dayReads += reads;
      }
      dailyReads.push(dayReads);
    }

    assert.deepStrictEqual(dailyReads, [15, 5, 5]);
    assert.deepStrictEqual(tickReads.slice(0, 3), [15, 0, 0]);
    assert.deepStrictEqual(tickReads.slice(24, 27), [5, 0, 0]);
    assert.strictEqual(
      tickReads.slice(48, 51).reduce((total, reads) => total + reads, 0),
      5,
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("uses the scoring week's opponent for a league whose coverage is a week", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setSchedule({
      providerTeamKey: "461.l.1000.t.1",
      period: { type: "week", week: 3 },
      dates: [],
      players: [
        {
          providerPlayerKey: "461.p.10001",
          name: "Synthetic 0",
          proTeamKey: undefined,
          proTeamAbbreviation: "SYN",
          games: [{ date: undefined, opponent: "SEA", home: true }],
        },
        {
          providerPlayerKey: "461.p.10002",
          name: "Synthetic 1",
          proTeamKey: undefined,
          proTeamAbbreviation: "SYN",
          games: [],
        },
      ],
    });

    const summary = yield* queries.getTeamSummary(owner, { team: teamId, groups: ["schedule"] });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(yield* fake.schedulePeriods, [{ type: "week", week: 3 }]);
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "available");
    if (schedule?.status !== "available") {
      return;
    }
    assert.strictEqual(schedule.coverage, "week");
    assert.isUndefined(schedule.dates);
    assert.deepStrictEqual(
      schedule.players.map((player) => [player.status, player.gameCount, player.games]),
      [
        ["scheduled", 1, [{ opponent: "SEA", home: true }]],
        ["no_games", 0, []],
      ],
    );
    assert.include(schedule.detail, "Scoring week 3");
    assert.include(schedule.detail, "no per-week game count");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("refuses a date window it cannot establish instead of inventing one", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
      league: rotoLeagueFixture,
      roster: rosterFixture({
        count: 2,
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
        coverage: { type: "date", date: "2026-10-20" },
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;

    const summary = yield* queries.getTeamSummary(owner, { team: teamId, groups: ["schedule"] });
    assert.strictEqual(summary.status, "unsupported");
    if (summary.status === "narrowing_required") {
      return;
    }
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "unsupported");
    if (schedule?.status !== "unsupported") {
      return;
    }
    assert.include(schedule.detail, "neither a scoring period nor a current date");
    assert.include(schedule.detail, "`window`");
    assert.include(schedule.detail, "`days`");
    assert.deepStrictEqual(yield* fake.schedulePeriods, []);
    assert.isTrue(
      summary.coverage.some(
        (entry) => entry.resource === "schedule" && entry.status === "unsupported",
      ),
    );
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reads the rest of your league's week for a league with no scoring period", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("477.l.31027.t.1", "Roto", "nhl")], {
      league: {
        ...rotoLeagueFixture,
        providerLeagueKey: "477.l.31027",
        currentDate: "2026-10-30",
      },
      roster: rosterFixture({
        count: 3,
        providerTeamKey: "477.l.31027.t.1",
        providerLeagueKey: "477.l.31027",
        coverage: { type: "date", date: "2026-10-30" },
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setSchedule(
      scheduleFixture({
        providerTeamKey: "477.l.31027.t.1",
        dates: ["2026-10-30", "2026-10-31", "2026-11-01"],
        players: [
          {
            key: "461.p.10001",
            name: "Synthetic Tonight",
            games: [{ date: "2026-10-30", opponent: "TOR", home: true }],
          },
          {
            key: "461.p.10002",
            name: "Synthetic Back To Back",
            games: [
              { date: "2026-10-30", opponent: "TOR", home: true },
              { date: "2026-10-31", opponent: "BOS", home: false },
            ],
          },
          { key: "461.p.10003", name: "Synthetic Resting", games: [] },
        ],
      }),
    );

    const summary = yield* queries.getTeamSummary(owner, { team: teamId, groups: ["schedule"] });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(yield* fake.schedulePeriods, [
      { type: "date", start: "2026-10-30", end: "2026-11-01" },
    ]);
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "available");
    if (schedule?.status !== "available") {
      return;
    }
    assert.strictEqual(schedule.coverage, "date");
    assert.isUndefined(schedule.period);
    assert.deepStrictEqual(schedule.window, {
      start: "2026-10-30",
      end: "2026-11-01",
      source: "rest_of_week",
    });
    assert.isTrue(DateTime.isDateTime(schedule.observedAt));
    assert.deepStrictEqual(schedule.dates, [
      { date: "2026-10-30", rosterGames: 2 },
      { date: "2026-10-31", rosterGames: 1 },
      { date: "2026-11-01", rosterGames: 0 },
    ]);
    assert.deepStrictEqual(
      schedule.players.map((player) => [player.name, player.status, player.gameCount]),
      [
        ["Synthetic Tonight", "scheduled", 1],
        ["Synthetic Back To Back", "scheduled", 2],
        ["Synthetic Resting", "no_games", 0],
      ],
    );
    assert.include(schedule.detail, "rest of your league's current week");
    assert.include(schedule.detail, "2026-10-30 to 2026-11-01");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("counts a requested day window from your league's current date", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("477.l.31027.t.1", "Roto", "nhl")], {
      league: {
        ...rotoLeagueFixture,
        providerLeagueKey: "477.l.31027",
        currentDate: "2026-10-30",
      },
      roster: rosterFixture({
        count: 2,
        providerTeamKey: "477.l.31027.t.1",
        providerLeagueKey: "477.l.31027",
        coverage: { type: "date", date: "2026-10-30" },
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setSchedule(
      scheduleFixture({
        providerTeamKey: "477.l.31027.t.1",
        dates: ["2026-10-30", "2026-10-31"],
        players: [
          {
            key: "461.p.10001",
            name: "Synthetic Tonight",
            games: [{ date: "2026-10-30", opponent: "TOR", home: true }],
          },
        ],
      }),
    );

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      days: 2,
    });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(yield* fake.schedulePeriods, [
      { type: "date", start: "2026-10-30", end: "2026-10-31" },
    ]);
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "available");
    if (schedule?.status !== "available") {
      return;
    }
    assert.deepStrictEqual(schedule.window, {
      start: "2026-10-30",
      end: "2026-10-31",
      source: "requested",
    });
    assert.include(schedule.detail, "requested window");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("uses a requested window instead of the league's scoring period", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
      league: hockeyLeagueFixture,
      roster: rosterFixture({
        count: 2,
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
        coverage: { type: "date", date: "2026-10-26" },
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setMatchups([matchupFixture({ period: 3 })]);
    yield* fake.setSchedule(
      scheduleFixture({
        providerTeamKey: "465.l.2000.t.1",
        dates: ["2026-10-26", "2026-10-27", "2026-10-28"],
        players: [
          {
            key: "461.p.10001",
            name: "Synthetic 0",
            games: [{ date: "2026-10-27", opponent: "TOR", home: true }],
          },
        ],
      }),
    );

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: { start: "2026-10-26", end: "2026-10-28" },
    });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.deepStrictEqual(yield* fake.schedulePeriods, [
      { type: "date", start: "2026-10-26", end: "2026-10-28" },
    ]);
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "available");
    if (schedule?.status !== "available") {
      return;
    }
    assert.deepStrictEqual(schedule.period, { week: 3 });
    assert.deepStrictEqual(schedule.window, {
      start: "2026-10-26",
      end: "2026-10-28",
      source: "requested",
    });
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("refuses a date window for a league whose coverage is a scoring week", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      window: { start: "2026-10-20", end: "2026-10-22" },
    });
    assert.strictEqual(summary.status, "unsupported");
    if (summary.status === "narrowing_required") {
      return;
    }
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "unsupported");
    if (schedule?.status !== "unsupported") {
      return;
    }
    assert.include(schedule.detail, "scoring week");
    assert.include(schedule.detail, "Omit `window` and `days`");
    assert.deepStrictEqual(yield* fake.schedulePeriods, []);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("reports your league refusal for the schedule as unsupported with its reason", () =>
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
    yield* fake.setMatchups([matchupFixture({ period: 3 })]);
    yield* fake.unsupportedOperations(["read_roster_schedule"]);

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league", "schedule"],
    });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "unsupported");
    if (schedule?.status !== "unsupported") {
      return;
    }
    assert.include(schedule.detail, "does not support read_roster_schedule");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("pages a full roster's schedule through the roster page and one cursor", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const dates = [
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ];
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
      league: hockeyLeagueFixture,
      roster: rosterFixture({
        count: 22,
        providerTeamKey: "465.l.2000.t.1",
        providerLeagueKey: "465.l.2000",
        coverage: { type: "date", date: "2026-10-20" },
      }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setMatchups([matchupFixture({ period: 3 })]);
    yield* fake.setSchedule(
      scheduleFixture({
        providerTeamKey: "465.l.2000.t.1",
        dates,
        players: globalThis.Array.from({ length: 22 }, (_, index) => ({
          key: `461.p.${String(10001 + index)}`,
          name: `Synthetic ${String(index)}`,
          games: [
            { date: "2026-10-19", opponent: "TOR", home: true },
            { date: "2026-10-21", opponent: "LA", home: index % 2 === 0 },
            { date: "2026-10-24", opponent: "BOS", home: index % 3 === 0 },
          ],
        })),
      }),
    );

    const first = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["schedule"],
      limit: 5,
    });
    assert.strictEqual(first.status, "ok");
    if (first.status !== "ok") {
      return;
    }
    assert.isAtMost(summarySectionBytes(first), first.budget.hardLimitBytes);
    assert.isFalse(first.page.complete);
    assert.isString(first.page.next);
    const schedule = first.schedule;
    assert.strictEqual(schedule?.status, "available");
    if (schedule?.status !== "available") {
      return;
    }
    assert.deepStrictEqual(schedule.dates, [
      { date: "2026-10-19", rosterGames: 22 },
      { date: "2026-10-20", rosterGames: 0 },
      { date: "2026-10-21", rosterGames: 22 },
      { date: "2026-10-22", rosterGames: 0 },
      { date: "2026-10-23", rosterGames: 0 },
      { date: "2026-10-24", rosterGames: 22 },
      { date: "2026-10-25", rosterGames: 0 },
    ]);

    const players = new Map<string, number>();
    const refs = new Set<string>();
    const collect = (page: typeof first): void => {
      const section = page.schedule;
      if (section?.status !== "available") {
        return;
      }
      for (const player of section.players) {
        players.set(player.name, player.gameCount);
        refs.add(player.player);
      }
    };
    collect(first);
    let pages = 1;
    let next = first.page.next;
    while (next !== undefined) {
      pages += 1;
      const page = yield* queries.getTeamSummary(owner, {
        team: teamId,
        groups: ["schedule"],
        cursor: next,
      });
      assert.strictEqual(page.status, "ok");
      if (page.status !== "ok") {
        return;
      }
      assert.isAtMost(summarySectionBytes(page), page.budget.hardLimitBytes);
      assert.strictEqual(page.schedule?.status, "available");
      collect(page);
      next = page.page.next;
    }
    assert.isAtMost(pages, 5);
    assert.strictEqual(players.size, 22);
    assert.deepStrictEqual(
      [...players.values()],
      globalThis.Array.from({ length: 22 }, () => 3),
    );
    assert.strictEqual(refs.size, 22);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("shares one player reference between the roster and schedule sections", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;
    yield* fake.setSchedule({
      providerTeamKey: "461.l.1000.t.1",
      period: { type: "week", week: 3 },
      dates: [],
      players: [
        {
          providerPlayerKey: "461.p.10001",
          name: "Synthetic 0",
          proTeamKey: undefined,
          proTeamAbbreviation: "SYN",
          games: [{ date: undefined, opponent: "SEA", home: true }],
        },
        {
          providerPlayerKey: "461.p.10002",
          name: "Synthetic 1",
          proTeamKey: undefined,
          proTeamAbbreviation: "SYN",
          games: [],
        },
      ],
    });

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league", "standings", "matchup", "schedule", "roster"],
    });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    const schedule = summary.schedule;
    assert.strictEqual(schedule?.status, "available");
    if (schedule?.status !== "available") {
      return;
    }
    assert.deepStrictEqual(
      schedule.players.map((player) => player.player),
      summary.roster?.map((player) => player.player),
    );
    assert.deepStrictEqual(
      schedule.players.map((player) => player.name),
      summary.roster?.map((player) => player.name),
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
        acquisitionUsage: {
          seasonMoves: index,
          weeklyAdds: { used: index % 7, coverage: { type: "week", week: 3 } },
        },
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
    assert.isDefined(summary.league);
    assert.isDefined(summary.standing);
    assert.isDefined(summary.record);
    assert.isDefined(summary.matchup);
    assert.notInclude(encodedKeys(summary), "probableStarters");
    assert.isUndefined(summary.categoryTotals);
    assert.isUndefined(summary.categoryPoints);
    assert.isFalse(summary.page.complete);
    assert.isString(summary.page.next);
    assert.isTrue(summary.page.returned < 40);
    assert.isAtMost(summarySectionBytes(summary), summary.budget.hardLimitBytes);
    assert.strictEqual(summary.standings?.status, "available");
    if (summary.standings?.status === "available") {
      assert.strictEqual(summary.standings.teams.length, 14);
    }

    const names = new Set((summary.roster ?? []).map((player) => player.name));
    let next = summary.page.next;
    while (next !== undefined) {
      const page = yield* queries.getTeamSummary(owner, { team: teamId, cursor: next });
      assert.strictEqual(page.status, "ok");
      if (page.status !== "ok") {
        return;
      }
      assert.isAtMost(summarySectionBytes(page), page.budget.hardLimitBytes);
      for (const player of page.roster ?? []) {
        names.add(player.name);
      }
      next = page.page.next;
    }
    assert.strictEqual(names.size, 40);

    const allGroups = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league", "standings", "categories", "matchup", "roster"],
    });
    assert.strictEqual(allGroups.status, "ok");
    if (allGroups.status === "ok") {
      assert.isDefined(allGroups.categoryTotals);
      assert.isAtLeast(allGroups.page.returned, 1);
      assert.isAtMost(summarySectionBytes(allGroups), allGroups.budget.hardLimitBytes);
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

function thirteenTeamRotoLeague(): {
  readonly league: ProviderLeagueSettings;
  readonly standings: ProviderStandings;
} {
  const leagueKey = "477.l.31027";
  const displayOnly = [
    { statId: 29, name: "Saves Percentage", displayName: "SV%", abbreviation: "SV%" },
    { statId: 30, name: "Minutes Played", displayName: "MIN", abbreviation: "MIN" },
  ].map((category) => ({
    ...category,
    group: "goaltending",
    enabled: true,
    displayOnly: true,
    positionTypes: ["P", "G"],
  }));
  const statIds = [1, 2, 3, 8, 14, 31, 32, 19, 22, 23, 25, 24, 26, 29, 30];
  return {
    league: {
      ...rotoLeagueFixture,
      providerLeagueKey: leagueKey,
      name: "Elite League 25",
      teamCount: 13,
      currentDate: "2026-10-30",
      maxSeasonAcquisitions: 70,
      statCategories: [...rotoLeagueFixture.statCategories, ...displayOnly],
    },
    standings: {
      providerLeagueKey: leagueKey,
      teams: globalThis.Array.from({ length: 13 }, (_, index) =>
        rotoStanding({
          providerTeamKey: `${leagueKey}.t.${String(index + 1)}`,
          name: `Synthetic Fantasy Squad ${String(index + 1)}`,
          rank: index + 1,
          points: Object.fromEntries(statIds.map((statId) => [statId, 15 - index])),
          totals: Object.fromEntries(statIds.map((statId) => [statId, 320 - index])),
        }),
      ),
    },
  };
}

it.effect("names the sections that consume the budget for the client's exact group set", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const fixture = thirteenTeamRotoLeague();
    const seeded = yield* seed(fake, [team("477.l.31027.t.1", "Roto", "nhl")], {
      league: fixture.league,
      roster: rosterFixture({
        count: 21,
        providerTeamKey: "477.l.31027.t.1",
        providerLeagueKey: "477.l.31027",
        coverage: { type: "date", date: "2026-10-30" },
      }),
    });
    yield* fake.setStandings(fixture.standings);

    const summary = yield* queries.getTeamSummary(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["league", "standings", "categories", "matchup", "roster"],
    });
    if (summary.status === "narrowing_required") {
      assert.strictEqual(summary.resource, "team_summary.roster");
      assert.include(summary.detail, "largest sections are");
      assert.match(
        summary.detail,
        /`standings`|`categoryTotals`|`categoryPoints`/u,
        "the refusal names the sections that consumed the budget",
      );
      return;
    }
    assert.strictEqual(summary.status, "ok");
    assert.isAtMost(summarySectionBytes(summary), summary.budget.hardLimitBytes);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("pairs the matchup's category values in one row per category", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("465.l.2000.t.1", "Hockey", "nhl")], {
      league: hockeyLeagueFixture,
    });
    yield* fake.setMatchups([matchupFixture({ period: 3, categories: true })]);

    const summary = yield* queries.getTeamSummary(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["categories", "matchup"],
    });

    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(summary.matchup?.status, "available");
    if (summary.matchup?.status !== "available") {
      return;
    }
    assert.notProperty(summary.matchup, "opponentCategories");
    assert.isAtLeast(summary.matchup.categories?.length ?? 0, 1);
    const first = Array.getUnsafe(summary.matchup.categories ?? [], 0);
    assert.strictEqual(first.own, 3);
    assert.strictEqual(first.opponent, 3);
    assert.isUndefined(first.detail);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("fits the ordinary six-group summary for a thirteen-team league", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const fixture = thirteenTeamRotoLeague();
    const dates = ["2026-10-30", "2026-10-31", "2026-11-01"];
    const seeded = yield* seed(fake, [team("477.l.31027.t.1", "Roto", "nhl")], {
      league: fixture.league,
      roster: rosterFixture({
        count: 21,
        providerTeamKey: "477.l.31027.t.1",
        providerLeagueKey: "477.l.31027",
        coverage: { type: "date", date: "2026-10-30" },
      }),
    });
    yield* fake.setStandings(fixture.standings);
    yield* fake.setSchedule(
      scheduleFixture({
        providerTeamKey: "477.l.31027.t.1",
        dates,
        players: globalThis.Array.from({ length: 21 }, (_, index) => ({
          key: `461.p.${String(10001 + index)}`,
          name: `Synthetic ${String(index)}`,
          games: [{ date: dates[0] ?? "", opponent: "TOR", home: true }],
        })),
      }),
    );

    const summary = yield* queries.getTeamSummary(owner, {
      team: Array.getUnsafe(seeded, 0).id,
      groups: ["league", "standings", "categories", "matchup", "schedule", "roster"],
    });

    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(summary.budget.hardLimitBytes, 28 * 1024);
    assert.isAtLeast(summary.page.returned, 1);
    assert.strictEqual(summary.standings?.status, "available");
    if (summary.standings?.status === "available") {
      assert.strictEqual(summary.standings.teams.length, 13);
    }
    assert.isAtLeast(summary.roster?.length ?? 0, 1);
    assert.strictEqual(summary.schedule?.status, "available");
    assert.isDefined(summary.matchup);
    assert.notProperty(summary.matchup ?? {}, "opponentCategories");
    assert.strictEqual(summary.categoryTotals?.status, "available");
    if (summary.categoryTotals?.status === "available") {
      for (const category of summary.categoryTotals.values) {
        assert.isNumber(category.value);
        assert.isUndefined(category.detail);
      }
    }
    assert.isAtMost(summarySectionBytes(summary), summary.budget.hardLimitBytes);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("omits the roster page from a summary that did not request the roster group", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league", "standings", "categories", "matchup"],
    });

    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.isUndefined(summary.roster);
    assert.deepStrictEqual(summary.page, { returned: 0, complete: true, remaining: 0 });
    assert.notInclude(encodedKeys(summary), "probableStarters");
    const encodedSummary = yield* Schema.encodeEffect(Schema.toCodecJson(TeamSummaryData))(summary);
    assert.notInclude(encodedKeys(encodedSummary), "roster");

    const leagueOnly = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league"],
    });
    assert.strictEqual(leagueOnly.status, "ok");
    if (leagueOnly.status !== "ok") {
      return;
    }
    const encodedLeagueOnly = yield* Schema.encodeEffect(Schema.toCodecJson(TeamSummaryData))(
      leagueOnly,
    );
    assert.notInclude(encodedKeys(encodedLeagueOnly), "roster");
    assert.notInclude(encodedKeys(encodedLeagueOnly), "schedule");

    const withRoster = yield* queries.getTeamSummary(owner, { team: teamId });
    assert.strictEqual(withRoster.status, "ok");
    if (withRoster.status !== "ok") {
      return;
    }
    assert.strictEqual(withRoster.roster?.length, 2);
    assert.strictEqual(withRoster.page.returned, 2);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("names the selected sections when a summary without a roster page cannot fit", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      league: { ...leagueFixture, name: "L".repeat(20_000) },
    });
    const teamId = Array.getUnsafe(seeded, 0).id;

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league", "standings", "matchup"],
    });

    assert.strictEqual(summary.status, "narrowing_required");
    if (summary.status !== "narrowing_required") {
      return;
    }
    assert.strictEqual(summary.resource, "team_summary");
    assert.include(summary.detail, "No roster page was requested");
    assert.include(summary.detail, "league, standings, matchup");
    assert.include(summary.detail, "largest sections are `league`");
    assert.notInclude(summary.detail, "roster page fits");
    assert.isUndefined(summary.record);

    const withRoster = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league", "standings", "matchup", "roster"],
    });
    assert.strictEqual(withRoster.status, "narrowing_required");
    if (withRoster.status !== "narrowing_required") {
      return;
    }
    assert.strictEqual(withRoster.resource, "team_summary.roster");
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("refuses a continuation cursor issued for different request arguments", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")]);
    const teamId = Array.getUnsafe(seeded, 0).id;

    const first = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league", "roster"],
      limit: 1,
    });
    assert.strictEqual(first.status, "ok");
    if (first.status !== "ok") {
      return;
    }
    const cursor = first.page.next;
    assert.isDefined(cursor);

    const reused = yield* Effect.exit(
      queries.getTeamSummary(owner, {
        team: teamId,
        groups: ["league", "standings", "roster"],
        limit: 1,
        cursor,
      }),
    );

    assert.isTrue(reused._tag === "Failure");
    if (reused._tag === "Failure") {
      const failure = Cause.findErrorOption(reused.cause);
      assert.isTrue(Option.isSome(failure));
      if (Option.isSome(failure) && failure.value._tag === "query.cursor_invalid") {
        assert.strictEqual(
          failure.value.reason,
          "mismatch",
          "a cursor bound to other arguments reports a mismatch, not an expiry",
        );
      } else {
        assert.fail("expected a cursor-invalid failure");
      }
    }
  }).pipe(Effect.provide(QueriesTestLayer)),
);

it.effect("documents how to narrow a summary that cannot fit a single record", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [team("461.l.1000.t.1", "Alpha")], {
      roster: rosterFixture({ count: 1, name: "A".repeat(20_000) }),
    });
    const teamId = Array.getUnsafe(seeded, 0).id;

    const summary = yield* queries.getTeamSummary(owner, { team: teamId });

    assert.strictEqual(summary.status, "narrowing_required");
    if (summary.status !== "narrowing_required") {
      return;
    }
    assert.deepStrictEqual(summary.groups, [
      "league",
      "standings",
      "categories",
      "matchup",
      "schedule",
      "roster",
    ]);
    assert.include(summary.detail, "Request fewer summary groups");
    assert.isUndefined(summary.record);
  }).pipe(Effect.provide(QueriesTestLayer)),
);

function transactionPlayer(
  providerPlayerKey: string,
  playerMovement: ProviderTransactionMovement,
  name: string,
): ProviderTransaction["players"][number] {
  return {
    providerPlayerKey,
    movement: playerMovement,
    name,
    primaryPosition: undefined,
    displayPosition: "WR",
    eligiblePositions: undefined,
    proTeam: "SYN",
  };
}

function movement(
  kind: ProviderTransactionMovement["kind"],
  from: ProviderTransactionTeam | undefined,
  to: ProviderTransactionTeam | undefined,
): ProviderTransactionMovement {
  return { kind, from, to };
}

function transaction(fields: {
  readonly occurredAt: string;
  readonly type: ProviderTransaction["type"];
  readonly players: ReadonlyArray<ProviderTransaction["players"][number]>;
  readonly picks?: ReadonlyArray<ProviderTransaction["picks"][number]>;
  readonly teams?: ReadonlyArray<ProviderTransactionTeam>;
  readonly parties?: ProviderTransaction["parties"];
  readonly incomplete?: ProviderTransaction["incomplete"];
}): ProviderTransaction {
  return {
    transactionKey: undefined,
    occurredAt: fields.occurredAt,
    type: fields.type,
    status: "successful",
    parties: fields.parties,
    teams: fields.teams ?? [],
    picks: fields.picks ?? [],
    players: fields.players,
    incomplete: fields.incomplete,
  };
}

const alphaTeam: ProviderTransactionTeam = { providerTeamKey: "461.l.1000.t.1", name: "Alpha" };
const betaTeam: ProviderTransactionTeam = { providerTeamKey: "461.l.1000.t.2", name: "Beta" };

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
      transaction({
        occurredAt: "2026-09-20T12:00:00.000Z",
        type: "add",
        teams: [alphaTeam],
        players: [
          transactionPlayer(
            "461.p.10003",
            movement("add", undefined, alphaTeam),
            "Synthetic Addition",
          ),
        ],
      }),
    ]);
    const linked = Array.getUnsafe(
      yield* connections.link(owner, [{ provider: decodeProviderKey("yahoo"), session }]),
      0,
    );
    const discovered = yield* connections.discoverTeams(owner, [{ id: linked.id }]);
    return discovered.map((row) => ({ id: row.id }));
  }).pipe(Effect.orDie);
}

const ownerTeamKeys = [
  "465.l.2000.t.1",
  "465.l.2000.t.2",
  "465.l.2000.t.3",
  "465.l.2000.t.4",
  "465.l.2000.t.5",
] as const;

const opponentWindow = { start: "2026-10-19", end: "2026-10-21" };

function seedOpponentTeams(
  fake: FakeProviderWorld["Service"],
  teamKeys: ReadonlyArray<string>,
  options: { readonly periodWindow?: ProviderLeagueSettings["periodWindow"] } = {},
): Effect.Effect<
  ReadonlyArray<{ readonly id: import("./FantasyTeam.ts").TeamId }>,
  never,
  Connections
> {
  return Effect.gen(function* () {
    const seeded = yield* seed(
      fake,
      teamKeys.map((key, index) => team(key, `Hockey ${String(index + 1)}`, "nhl")),
      {
        league: { ...hockeyLeagueFixture, periodWindow: options.periodWindow },
        roster: rosterFixture({
          count: 2,
          providerTeamKey: Array.getUnsafe(teamKeys, 0),
          providerLeagueKey: "465.l.2000",
          coverage: { type: "date", date: "2026-10-19" },
        }),
      },
    );
    for (const teamKey of teamKeys) {
      yield* fake.setTeamSchedule(teamKey, opponentSchedule(teamKey));
    }
    return seeded;
  });
}

function opponentSchedule(providerTeamKey: string): import("./Provider.ts").ProviderRosterSchedule {
  const teamNumber = providerTeamKey.slice(providerTeamKey.lastIndexOf(".t.") + 3);
  return scheduleFixture({
    providerTeamKey,
    dates: ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"],
    players: [
      {
        key: `465.p.${teamNumber}001`,
        name: "Synthetic Skater",
        proTeamKey: "fixture.t.1",
        proTeamAbbreviation: "TOR",
        games: [
          { date: "2026-10-19", opponent: "TOR", home: true },
          { date: "2026-10-21", opponent: "LA", home: false },
          { date: "2026-10-23", opponent: "WPG", home: true },
        ],
      },
      {
        key: `465.p.${teamNumber}002`,
        name: "Synthetic Goalie",
        proTeamKey: "fixture.t.2",
        proTeamAbbreviation: "BOS",
        games: [
          { date: "2026-10-20", opponent: "BOS", home: true },
          { date: "2026-10-22", opponent: "SEA", home: false },
        ],
      },
    ],
  });
}

function scheduleDateReads(periods: ReadonlyArray<ProviderSchedulePeriod>): number {
  return periods.reduce((total, period) => {
    if (period.type === "week") {
      return total;
    }
    return (
      total +
      Math.round(
        (Date.parse(`${period.end}T00:00:00.000Z`) - Date.parse(`${period.start}T00:00:00.000Z`)) /
          86_400_000,
      ) +
      1
    );
  }, 0);
}

function scheduleFixture(input: {
  readonly providerTeamKey: string;
  readonly dates: ReadonlyArray<string>;
  readonly players: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly proTeamKey?: string;
    readonly proTeamAbbreviation?: string;
    readonly games: ReadonlyArray<{
      readonly date: string | undefined;
      readonly opponent: string;
      readonly home: boolean;
    }>;
  }>;
}): import("./Provider.ts").ProviderRosterSchedule {
  return {
    providerTeamKey: input.providerTeamKey,
    period: { type: "date", start: input.dates[0] ?? "", end: input.dates.at(-1) ?? "" },
    dates: input.dates,
    players: input.players.map((player) => ({
      providerPlayerKey: player.key,
      name: player.name,
      proTeamKey: player.proTeamKey,
      proTeamAbbreviation: player.proTeamAbbreviation ?? "SYN",
      games: player.games,
    })),
  };
}

function calendarGame(
  id: string,
  date: string,
  home: string,
  away: string,
): ReturnType<typeof fakeGame> {
  return fakeGame({
    id,
    date,
    startTime: `${date}T23:00:00.000Z`,
    home: leagueClub(home),
    away: leagueClub(away),
  });
}

function leagueClub(abbreviation: string): {
  identifier: string;
  abbreviation: string;
  name: string;
} {
  const club = hockeyClubs[abbreviation];
  return club === undefined
    ? { identifier: "999", abbreviation, name: abbreviation }
    : { identifier: club.identifier, abbreviation, name: club.name };
}

const hockeyClubs: Readonly<Record<string, { identifier: string; name: string }>> = {
  BOS: { identifier: "6", name: "Boston Bruins" },
  LA: { identifier: "26", name: "Los Angeles Kings" },
  NYR: { identifier: "3", name: "New York Rangers" },
  TOR: { identifier: "10", name: "Toronto Maple Leafs" },
};

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
    provider: decodeProviderKey("yahoo"),
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
  periodWindow: { current: 3, start: 1, end: 24 },
  rosterCoverage: "date",
  maxGamesPlayed: undefined,
  maxInningsPitched: undefined,
  startDate: "2026-10-01",
  endDate: "2027-04-10",
  currentDate: undefined,
  teamCount: 10,
  format: "head_to_head_categories",
  scoringType: "head",
  scoringLabel: "H2H",
  weeklyDeadline: "daily",
  rosterChange: undefined,
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
  waiverDays: undefined,
  maxWeeklyAcquisitions: undefined,
  maxSeasonAcquisitions: undefined,
  tradeEndDate: undefined,
  tradeRatification: undefined,
  tradeDraftPicks: undefined,
  tradeObjectionDays: undefined,
  draftStatus: "postdraft",
  rosterPositions: [
    { position: "C", positionType: "P", count: 2, kind: "starting", eligibility: ["C"] },
    { position: "BN", positionType: "B", count: 4, kind: "bench", eligibility: [] },
  ],
  rosterConstraints: {
    rosterMaximum: 6,
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
  },
  statCategories: [
    {
      statId: 1,
      name: "Goals",
      displayName: "G",
      abbreviation: "G",
      group: "offense",
      enabled: true,
      displayOnly: false,
      positionTypes: ["P"],
    },
  ],
  statModifiers: [],
  playerSearch: playerSearchWith([
    { kind: "last_days", days: 7 },
    { kind: "last_days", days: 14 },
    { kind: "last_days", days: 30 },
  ]),
};

const rotoLeagueFixture: ProviderLeagueSettings = {
  providerLeagueKey: "465.l.2000",
  name: "Roto League",
  webUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
  season: 2026,
  periodWindow: undefined,
  rosterCoverage: "date",
  maxGamesPlayed: undefined,
  maxInningsPitched: undefined,
  startDate: "2026-10-01",
  endDate: "2027-04-10",
  currentDate: undefined,
  teamCount: 10,
  format: "rotisserie",
  scoringType: "roto",
  scoringLabel: "Roto",
  weeklyDeadline: undefined,
  rosterChange: undefined,
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
  waiverDays: undefined,
  maxWeeklyAcquisitions: undefined,
  maxSeasonAcquisitions: undefined,
  tradeEndDate: undefined,
  tradeRatification: undefined,
  tradeDraftPicks: undefined,
  tradeObjectionDays: undefined,
  draftStatus: "postdraft",
  rosterPositions: [
    {
      position: "C",
      positionType: "P",
      count: 2,
      kind: "starting",
      eligibility: ["C"],
    },
    {
      position: "BN",
      positionType: "B",
      count: 4,
      kind: "bench",
      eligibility: [],
    },
  ],
  rosterConstraints: {
    rosterMaximum: 6,
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
  },
  statCategories: [
    { statId: 1, name: "Goals", displayName: "Goals", abbreviation: "G" },
    { statId: 2, name: "Assists", displayName: "Assists", abbreviation: "A" },
    { statId: 3, name: "Points", displayName: "Points", abbreviation: "P" },
    {
      statId: 8,
      name: "Powerplay Points",
      displayName: "Powerplay Points",
      abbreviation: "PPP",
    },
    { statId: 14, name: "Shots on Goal", displayName: "Shots on Goal", abbreviation: "SOG" },
    { statId: 31, name: "Hits", displayName: "Hits", abbreviation: "HIT" },
    { statId: 32, name: "Blocks", displayName: "Blocks", abbreviation: "BLK" },
    { statId: 19, name: "Wins", displayName: "Wins", abbreviation: "W" },
    { statId: 22, name: "Goals Against", displayName: "Goals Against", abbreviation: "GA" },
    {
      statId: 23,
      name: "Goals Against Average",
      displayName: "Goals Against Average",
      abbreviation: "GAA",
    },
    { statId: 25, name: "Saves", displayName: "Saves", abbreviation: "SV" },
    { statId: 24, name: "Shots Against", displayName: "Shots Against", abbreviation: "SA" },
    {
      statId: 26,
      name: "Save Percentage",
      displayName: "Save Percentage",
      abbreviation: "SV%",
    },
  ].map((category) => ({
    ...category,
    group: "offense",
    enabled: true,
    displayOnly: false,
    positionTypes: ["P"],
  })),
  statModifiers: [],
};

const rotoStanding = (values: {
  readonly providerTeamKey: string;
  readonly name: string;
  readonly rank: number;
  readonly points: Readonly<Record<number, number>>;
  readonly totals: Readonly<Record<number, number>>;
}): ProviderStandings["teams"][number] => ({
  providerTeamKey: values.providerTeamKey,
  name: values.name,
  rank: values.rank,
  playoffSeed: null,
  record: undefined,
  gamesBack: null,
  pointsBack: 0,
  points: 92,
  pointsFor: 92,
  pointsAgainst: null,
  streak: undefined,
  acquisitionUsage: {
    seasonMoves: 6,
    weeklyAdds: { used: 1, coverage: { type: "week", week: 5 } },
  },
  categoryTotals: [1, 2, 3, 8, 14, 31, 32, 19, 22, 23, 25, 24, 26, 29, 30].map((statId) => ({
    statId,
    value: values.totals[statId] ?? null,
  })),
  categoryPoints: [1, 2, 3, 8, 14, 31, 32, 19, 22, 23, 25, 24, 26, 29, 30].map((statId) => ({
    statId,
    value: values.points[statId] ?? null,
  })),
});

const leagueFixture: ProviderLeagueSettings = {
  providerLeagueKey: "461.l.1000",
  name: "Alpha League",
  webUrl: "https://football.fantasysports.yahoo.com/f1/1000",
  season: 2026,
  periodWindow: { current: 3, start: 1, end: 17 },
  rosterCoverage: "week",
  maxGamesPlayed: undefined,
  maxInningsPitched: undefined,
  startDate: "2026-09-03",
  endDate: "2026-12-28",
  currentDate: undefined,
  teamCount: 10,
  format: "head_to_head_points",
  scoringType: "head",
  scoringLabel: "H2H",
  weeklyDeadline: undefined,
  rosterChange: undefined,
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
  waiverDays: undefined,
  maxWeeklyAcquisitions: undefined,
  maxSeasonAcquisitions: undefined,
  tradeEndDate: undefined,
  tradeRatification: undefined,
  tradeDraftPicks: undefined,
  tradeObjectionDays: undefined,
  draftStatus: "postdraft",
  rosterPositions: [
    { position: "QB", positionType: "O", count: 1, kind: "starting", eligibility: ["QB"] },
    { position: "BN", positionType: "B", count: 6, kind: "bench", eligibility: [] },
  ],
  rosterConstraints: {
    rosterMaximum: 7,
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
  },
  statCategories: [
    {
      statId: 4,
      name: "Passing Yards",
      displayName: "Pass Yds",
      abbreviation: "PY",
      group: "passing",
      enabled: true,
      displayOnly: false,
      positionTypes: ["O"],
    },
    {
      statId: 20,
      name: "Rushing Yards",
      displayName: "Rush Yds",
      abbreviation: "RY",
      group: "rushing",
      enabled: true,
      displayOnly: false,
      positionTypes: ["O"],
    },
  ],
  statModifiers: [{ statId: 4, points: "0.04" }],
  playerSearch: playerSearchWith([{ kind: "last_weeks", weeks: 4 }]),
};

function playerSearchWith(
  windows: ReadonlyArray<ProviderLeaguePlayerSearch["windows"][number]>,
): ProviderLeaguePlayerSearch {
  return {
    status: "published",
    sorts: ["name", "position", "ownership", "actual_rank", "overall_rank", "stat", "recent_rank"],
    windows,
    detail:
      windows.length === 0
        ? "This league publishes no recent-form player rank, so its pool cannot be ordered by recent form."
        : `This league publishes a recent-form player rank for ${windows
            .map((window) =>
              window.kind === "last_days"
                ? `the last ${String(window.days)} days`
                : `the last ${String(window.weeks)} weeks`,
            )
            .join(", ")}.`,
  };
}

function assertDrafted(draft: PlayerDraft | undefined): void {
  assert.strictEqual(draft?.status, "drafted");
  if (draft?.status !== "drafted") {
    return;
  }
  assert.strictEqual(draft.draftRound, 3);
  assert.strictEqual(draft.overallPick, 32);
  assert.strictEqual(draft.draftSeason, 2026);
  assert.match(draft.draftedBy.team, /^r1\./u);
  assert.strictEqual(draft.draftedBy.name, "Beta");
}

function standingWithUsage(
  providerTeamKey: string,
  name: string,
  rank: number,
  acquisitionUsage: ProviderAcquisitionUsage,
): ProviderStandings["teams"][number] {
  return {
    providerTeamKey,
    name,
    rank,
    playoffSeed: null,
    record: undefined,
    gamesBack: null,
    pointsBack: null,
    points: 10,
    pointsFor: 10,
    pointsAgainst: null,
    streak: undefined,
    acquisitionUsage,
    categoryTotals: [],
    categoryPoints: [],
  };
}

function searchFixture(input: {
  readonly providerPlayerKey: string;
  readonly name: string;
  readonly availability: "free_agent" | "waiver" | "rostered";
  readonly actualRank: number | null;
  readonly overallRank: number | null;
  readonly recentRank?: ProviderPlayerSearchResult["players"][number]["recentRank"];
  readonly statValue: number | null;
  readonly percentOwned: number | null;
  readonly percentOwnedDelta: number | null;
  readonly percentStarted: number | null;
  readonly percentStartedChange: number | null;
  readonly proTeam?: string;
  readonly proTeamKey?: string;
  readonly primaryPosition?: string;
  readonly displayPosition?: string;
  readonly transactionTrend?: ProviderTransactionTrend;
}): ProviderPlayerSearchResult["players"][number] {
  return {
    ...input,
    proTeam: input.proTeam,
    proTeamKey: input.proTeamKey,
    primaryPosition: input.primaryPosition ?? "QB",
    displayPosition: input.displayPosition ?? "QB",
    eligiblePositions: [input.primaryPosition ?? "QB"],
    status: { value: "healthy", code: undefined, detail: undefined },
    transactionTrend: input.transactionTrend ?? {
      status: "published",
      adds: 10,
      drops: 2,
      window: "provider_current_day",
    },
  };
}

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
      slot: { status: "verified", slot: index === 0 ? "QB" : "BN" },
      isEditable: true,
      injuryCode: index === 1 ? "O" : undefined,
      injuryDetail: index === 1 ? "Out" : undefined,
      byeWeek: 7,
      scheduled: true,
      startingLineup: "unconfirmed",
      undroppable: false,
      transactionTrend: {
        status: "published" as const,
        adds: 10 + index,
        drops: 2,
        window: "provider_current_day" as const,
      },
    })),
  };
}

function leagueRosterFixture(
  providerTeamKey: string,
  name: string,
  count: number,
  playerKeyStart: number,
): ProviderLeagueRoster {
  const roster = rosterFixture({
    count,
    providerTeamKey,
    providerLeagueKey: "461.l.1000",
  });
  return {
    ...roster,
    name,
    players: roster.players.map((player, index) => ({
      ...player,
      providerPlayerKey: `461.p.${String(playerKeyStart + index)}`,
      name: `${name} Player ${String(index)}`,
    })),
  };
}

const playerDetails = [
  {
    providerPlayerKey: "461.p.10001",
    name: "Synthetic 0",
    primaryPosition: "QB",
    displayPosition: "QB",
    proTeam: undefined,
    availabilityDetail: undefined,
    eligiblePositions: ["QB"],
    rosterStatus: "rostered" as const,
    actual: {
      basis: { type: "week" as const, week: 3 },
      stats: [{ statId: 4, value: 275 }],
      notAggregated: [],
    },
    projected: undefined,
    communityStartRate: undefined,
  },
  {
    providerPlayerKey: "461.p.10002",
    name: "Synthetic 1",
    primaryPosition: "QB",
    displayPosition: "QB",
    proTeam: undefined,
    availabilityDetail: undefined,
    eligiblePositions: ["QB"],
    rosterStatus: "rostered" as const,
    actual: {
      basis: { type: "week" as const, week: 3 },
      stats: [{ statId: 4, value: 0 }],
      notAggregated: [],
    },
    projected: undefined,
    communityStartRate: undefined,
  },
  {
    providerPlayerKey: "461.p.10003",
    name: "Free Agent",
    primaryPosition: "RB",
    displayPosition: "RB",
    proTeam: undefined,
    availabilityDetail: undefined,
    eligiblePositions: ["RB", "W/R"],
    rosterStatus: "free_agent" as const,
    actual: {
      basis: { type: "week" as const, week: 3 },
      stats: [{ statId: 4, value: 0 }],
      notAggregated: [],
    },
    projected: undefined,
    communityStartRate: undefined,
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
const ScheduleObservationRepositoryTest = ScheduleObservationRepository.layer.pipe(
  Layer.provide(ConnectionsDatabaseTest),
);
const EmptyGameSourceTest = Layer.succeed(GameSourceRegistry)(gameSourceRegistryOf([]));

const queriesTestLayer = (
  gameSource: Layer.Layer<GameSourceRegistry>,
): Layer.Layer<
  | FantasyQueries
  | Connections
  | QueryRepository
  | ConnectionRepository
  | ProviderRegistry
  | FakeProviderWorld
  | ScheduleObservationRepository
  | GameSourceRegistry
  | ProfessionalCalendar
  | ConnectionsDatabase
> => {
  const calendar = ProfessionalCalendarLive.pipe(
    Layer.provideMerge(ScheduleObservationRepositoryTest),
    Layer.provide(gameSource),
  );
  return FantasyQueriesLive.pipe(
    Layer.provideMerge(ConnectionsLive),
    Layer.provideMerge(QueryRepositoryTest),
    Layer.provideMerge(ConnectionRepositoryTest),
    Layer.provideMerge(ProviderFakeTest),
    Layer.provideMerge(ScheduleObservationRepositoryTest),
    Layer.provideMerge(gameSource),
    Layer.provideMerge(calendar),
    Layer.provide(EncryptionTestLayer),
    Layer.provide(QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars")),
    Layer.provide(NodeCrypto.layer),
    Layer.orDie,
  );
};

const queriesTestLayerWithGames = (
  teamCount: number,
): Layer.Layer<
  | FantasyQueries
  | Connections
  | QueryRepository
  | ConnectionRepository
  | ProviderRegistry
  | FakeProviderWorld
  | ScheduleObservationRepository
  | GameSourceRegistry
  | ProfessionalCalendar
  | FakeGameSourceWorld
  | ConnectionsDatabase
> => {
  const gameSource = fakeGameSourceLayer(teamCount);
  return Layer.merge(queriesTestLayer(gameSource), gameSource);
};

const QueriesTestLayer = queriesTestLayer(EmptyGameSourceTest);

function noteId(index: number): string {
  const crockfordBase32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return `01ARZ3NDEKTSV4RRFFQ69G5${crockfordBase32.charAt(
    Math.floor(index / 32),
  )}${crockfordBase32.charAt(index % 32)}`;
}
