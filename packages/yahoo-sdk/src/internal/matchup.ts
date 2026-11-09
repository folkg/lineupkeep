import { Effect, Schema } from "effect";

import {
  Flag,
  IntFromStringOrNumber,
  NumberFromStringOrNumber,
  decodePayload,
  numberOrNull,
  optionalNonEmpty,
} from "#yahoo/decode.ts";
import { YahooCoverageMismatch, YahooParseError } from "#yahoo/errors.ts";
import type { YahooLeagueKey } from "#yahoo/keys.ts";

import type { YahooStatValue } from "./player.ts";

export function decodeMatchups(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
  requestedWeek: number,
): Effect.Effect<ReadonlyArray<YahooMatchup>, YahooParseError | YahooCoverageMismatch> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(MatchupsPayload, payload, "read_matchups");
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_matchups",
        field: "league.league_key",
      });
    }
    const scoreboard = decoded.league.scoreboard;
    if (scoreboard.week !== requestedWeek) {
      return yield* new YahooCoverageMismatch({
        operation: "read_matchups",
        requested: { type: "week", week: requestedWeek },
        covered: { type: "week", week: scoreboard.week },
      });
    }
    const matchups: Array<YahooMatchup> = [];
    for (const group of scoreboard.entries) {
      for (const matchup of group.matchups) {
        if (matchup.week !== requestedWeek) {
          return yield* new YahooCoverageMismatch({
            operation: "read_matchups",
            requested: { type: "week", week: requestedWeek },
            covered: { type: "week", week: matchup.week },
          });
        }
        const teams = matchup.entries.flatMap((entry) => entry.teams);
        const home = teams[0];
        const away = teams[1];
        if (teams.length !== 2 || home === undefined || away === undefined) {
          return yield* new YahooParseError({
            operation: "read_matchups",
            field: "matchup.entries.teams",
          });
        }
        matchups.push({
          week: requestedWeek,
          weekStart: optionalNonEmpty(matchup.week_start),
          weekEnd: optionalNonEmpty(matchup.week_end),
          status: optionalNonEmpty(matchup.status),
          isPlayoffs: matchup.is_playoffs,
          isConsolation: matchup.is_consolation,
          isTied: matchup.is_tied,
          home: yield* teamScoreOf(home, requestedWeek),
          away: yield* teamScoreOf(away, requestedWeek),
          categoryWinners: (matchup.stat_winners ?? []).map(({ stat_winner }) => ({
            statId: stat_winner.stat_id,
            winnerTeamKey: stat_winner.winner_team_key,
            isTied: stat_winner.is_tied ?? false,
          })),
        });
      }
    }
    return matchups;
  });
}

function teamScoreOf(
  team: typeof ScoreboardTeamPayload.Type,
  requestedWeek: number,
): Effect.Effect<YahooMatchupTeam, YahooParseError | YahooCoverageMismatch> {
  return Effect.gen(function* () {
    const points = team.team_points;
    if (points?.week !== undefined && points.week !== requestedWeek) {
      return yield* new YahooCoverageMismatch({
        operation: "read_matchups",
        requested: { type: "week", week: requestedWeek },
        covered: { type: "week", week: points.week },
      });
    }
    const projected = team.team_projected_points;
    if (projected?.week !== undefined && projected.week !== requestedWeek) {
      return yield* new YahooCoverageMismatch({
        operation: "read_matchups",
        requested: { type: "week", week: requestedWeek },
        covered: { type: "week", week: projected.week },
      });
    }
    const remaining = team.team_remaining_games?.total;
    if (
      team.team_remaining_games?.week !== undefined &&
      team.team_remaining_games.week !== requestedWeek
    ) {
      return yield* new YahooCoverageMismatch({
        operation: "read_matchups",
        requested: { type: "week", week: requestedWeek },
        covered: { type: "week", week: team.team_remaining_games.week },
      });
    }
    return {
      teamKey: team.team_key,
      name: team.name,
      points: points === undefined ? null : numberOrNull(points.total),
      projectedPoints: projected === undefined ? null : numberOrNull(projected.total),
      winProbability: numberOrNull(team.win_probability),
      remainingGames:
        remaining === undefined
          ? undefined
          : {
              week: team.team_remaining_games?.week ?? requestedWeek,
              completed: remaining.completed_games,
              live: remaining.live_games,
              remaining: remaining.remaining_games,
            },
      stats: (team.team_stats?.stats ?? []).map(({ stat }) => ({
        statId: stat.stat_id,
        value: numberOrNull(stat.value),
      })),
    };
  });
}

export type YahooMatchup = {
  readonly week: number;
  readonly weekStart?: string;
  readonly weekEnd?: string;
  readonly status?: string;
  readonly isPlayoffs?: boolean;
  readonly isConsolation?: boolean;
  readonly isTied?: boolean;
  readonly home: YahooMatchupTeam;
  readonly away: YahooMatchupTeam;
  readonly categoryWinners: ReadonlyArray<YahooCategoryWinner>;
};

export type YahooMatchupTeam = {
  readonly teamKey: string;
  readonly name: string;
  readonly points: number | null;
  readonly projectedPoints: number | null;
  readonly winProbability: number | null;
  readonly remainingGames?: YahooRemainingGames;
  readonly stats: ReadonlyArray<YahooStatValue>;
};

export type YahooRemainingGames = {
  readonly week: number;
  readonly completed: number;
  readonly live: number;
  readonly remaining: number;
};

export type YahooCategoryWinner = {
  readonly statId: number;
  readonly winnerTeamKey?: string;
  readonly isTied: boolean;
};

const StatEntry = Schema.Struct({
  stat: Schema.Struct({
    stat_id: IntFromStringOrNumber,
    value: Schema.Union([Schema.Finite, Schema.String, Schema.Null]),
  }),
});

const ScoreboardPointsPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
  total: Schema.optional(NumberFromStringOrNumber),
  stats: Schema.optional(Schema.Array(StatEntry)),
});

const RemainingGamesPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  total: Schema.optional(
    Schema.Struct({
      completed_games: IntFromStringOrNumber,
      live_games: IntFromStringOrNumber,
      remaining_games: IntFromStringOrNumber,
    }),
  ),
});

const TeamStatsPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
  stats: Schema.Array(StatEntry),
});

const ScoreboardTeamPayload = Schema.Struct({
  team_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u))),
  name: Schema.NonEmptyString,
  team_points: Schema.optional(ScoreboardPointsPayload),
  team_projected_points: Schema.optional(ScoreboardPointsPayload),
  team_remaining_games: Schema.optional(RemainingGamesPayload),
  team_stats: Schema.optional(TeamStatsPayload),
  win_probability: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
});

const StatWinnerPayload = Schema.Struct({
  stat_winner: Schema.Struct({
    stat_id: IntFromStringOrNumber,
    winner_team_key: Schema.optional(
      Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u))),
    ),
    is_tied: Schema.optional(Flag),
  }),
});

const MatchupPayload = Schema.Struct({
  week: IntFromStringOrNumber,
  week_start: Schema.optional(Schema.String),
  week_end: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  is_playoffs: Schema.optional(Flag),
  is_consolation: Schema.optional(Flag),
  is_tied: Schema.optional(Flag),
  entries: Schema.Array(Schema.Struct({ teams: Schema.Array(ScoreboardTeamPayload) })),
  stat_winners: Schema.optional(Schema.Array(StatWinnerPayload)),
});

const MatchupsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
    scoreboard: Schema.Struct({
      week: IntFromStringOrNumber,
      entries: Schema.Array(Schema.Struct({ matchups: Schema.Array(MatchupPayload) })),
    }),
  }),
});
