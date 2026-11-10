import { DateTime, Effect, Option, Schema } from "effect";

import { IntFromStringOrNumber, decodePayload, numberOrNull } from "#yahoo/decode.ts";
import { YahooParseError } from "#yahoo/errors.ts";
import type { YahooLeagueKey } from "#yahoo/keys.ts";

import type { YahooStatValue } from "./player.ts";

export function decodeStandings(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<YahooStandings, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(StandingsPayload, payload, "read_standings");
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_standings",
        field: "league.league_key",
      });
    }
    const teams = decoded.league.standings.flatMap((group) => group.teams);
    if (teams.length === 0) {
      return yield* new YahooParseError({ operation: "read_standings" });
    }
    return {
      leagueKey: requestedLeagueKey,
      teams: teams.map(standingOf),
    };
  });
}

function standingOf(team: typeof StandingsTeamPayload.Type): YahooStanding {
  const standings = team.team_standings;
  const totals = standings?.outcome_totals;
  return {
    teamKey: team.team_key,
    name: team.name,
    rank: standings?.rank,
    playoffSeed: standings?.playoff_seed,
    record:
      totals === undefined
        ? undefined
        : {
            wins: totals.wins,
            losses: totals.losses,
            ties: totals.ties,
            percentage: numberOrNull(totals.percentage),
          },
    gamesBack: numberOrNull(standings?.games_back),
    pointsBack: numberOrNull(standings?.points_back),
    points: numberOrNull(team.team_points?.total),
    pointsFor: numberOrNull(standings?.points_for),
    pointsAgainst: numberOrNull(standings?.points_against),
    streak:
      standings?.streak === undefined
        ? undefined
        : { type: standings.streak.type, value: standings.streak.value },
    acquisitionUsage: acquisitionUsageOf(team.number_of_moves, team.roster_adds),
    categoryTotals: (team.team_stats?.stats ?? []).map(statValueOf),
    categoryPoints: (team.team_points?.stats ?? []).map(statValueOf),
  };
}

function acquisitionUsageOf(
  seasonMoves: number | string | undefined,
  rosterAdds: typeof AcquisitionPayload.Type | undefined,
): YahooStandingAcquisitionUsage {
  return {
    seasonMoves: numberOrNull(seasonMoves) ?? undefined,
    weeklyAdds: rosterAdds === undefined ? undefined : weeklyAddsOf(rosterAdds),
  };
}

function weeklyAddsOf(
  rosterAdds: typeof AcquisitionPayload.Type,
): YahooStandingAcquisitionUsage["weeklyAdds"] {
  const used = numberOrNull(rosterAdds.value);
  if (used === null) {
    return undefined;
  }
  if (rosterAdds.coverage_type === "date") {
    return typeof rosterAdds.coverage_value === "string" &&
      isCalendarDate(rosterAdds.coverage_value)
      ? { used, coverage: { type: "date", date: rosterAdds.coverage_value } }
      : undefined;
  }
  const week = numberOrNull(rosterAdds.coverage_value);
  return week !== null && Number.isInteger(week) && week >= 1 && week <= 99
    ? { used, coverage: { type: "week", week } }
    : undefined;
}

function statValueOf(entry: typeof StatEntry.Type): YahooStatValue {
  return { statId: entry.stat.stat_id, value: numberOrNull(entry.stat.value) };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const instant = DateTime.make(`${value}T00:00:00.000Z`);
  return Option.isSome(instant) && DateTime.formatIsoDate(instant.value) === value;
}

export type YahooStanding = {
  readonly teamKey: string;
  readonly name: string;
  readonly rank?: number;
  readonly playoffSeed?: number;
  readonly record?: YahooStandingRecord;
  readonly gamesBack: number | null;
  readonly pointsBack: number | null;
  readonly points: number | null;
  readonly pointsFor: number | null;
  readonly pointsAgainst: number | null;
  readonly streak?: YahooStandingStreak;
  readonly acquisitionUsage: YahooStandingAcquisitionUsage;
  readonly categoryTotals: ReadonlyArray<YahooStatValue>;
  readonly categoryPoints: ReadonlyArray<YahooStatValue>;
};

export type YahooStandings = {
  readonly leagueKey: string;
  readonly teams: ReadonlyArray<YahooStanding>;
};

export type YahooStandingRecord = {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly percentage: number | null;
};

export type YahooStandingStreak = {
  readonly type: string;
  readonly value: number;
};

export type YahooStandingAcquisitionUsage = {
  readonly seasonMoves?: number;
  readonly weeklyAdds?: {
    readonly used: number;
    readonly coverage:
      | { readonly type: "week"; readonly week: number }
      | { readonly type: "date"; readonly date: string };
  };
};

const StatEntry = Schema.Struct({
  stat: Schema.Struct({
    stat_id: IntFromStringOrNumber,
    value: Schema.Union([Schema.Finite, Schema.String, Schema.Null]),
  }),
});

const AcquisitionPayload = Schema.Struct({
  coverage_type: Schema.Literals(["week", "date"]),
  coverage_value: Schema.Union([Schema.Finite, Schema.String]),
  value: Schema.Union([Schema.Finite, Schema.String]),
});

const OutcomeTotalsPayload = Schema.Struct({
  wins: IntFromStringOrNumber,
  losses: IntFromStringOrNumber,
  ties: IntFromStringOrNumber,
  percentage: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
});

const TeamStandingsPayload = Schema.Struct({
  rank: Schema.optional(IntFromStringOrNumber),
  playoff_seed: Schema.optional(IntFromStringOrNumber),
  outcome_totals: Schema.optional(OutcomeTotalsPayload),
  streak: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      value: IntFromStringOrNumber,
    }),
  ),
  games_back: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  points_for: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  points_against: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  points_back: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  points_change: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
});

const TeamStatsPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
  stats: Schema.Array(StatEntry),
});

const ScoreboardPointsPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
  total: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  stats: Schema.optional(Schema.Array(StatEntry)),
});

const StandingsTeamPayload = Schema.Struct({
  team_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u))),
  name: Schema.NonEmptyString,
  number_of_moves: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  roster_adds: Schema.optional(AcquisitionPayload),
  team_points: Schema.optional(ScoreboardPointsPayload),
  team_standings: Schema.optional(TeamStandingsPayload),
  team_stats: Schema.optional(TeamStatsPayload),
});

const StandingsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
    standings: Schema.Array(
      Schema.Struct({
        teams: Schema.Array(StandingsTeamPayload),
      }),
    ),
  }),
});
