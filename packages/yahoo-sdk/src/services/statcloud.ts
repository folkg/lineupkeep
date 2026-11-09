import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import {
  decodeDashboard,
  decodeLeagueAndTeams,
  decodeMatchupScores,
  decodeMatchups,
  decodePlayoffs,
} from "#yahoo/internal/statcloud.ts";
import type {
  YahooMobileDashboard,
  YahooStatcloudLeagueAndTeams,
  YahooStatcloudMatchupScores,
  YahooStatcloudMatchups,
  YahooStatcloudPlayoffs,
} from "#yahoo/internal/statcloud.ts";
import { YahooLeagueKey, YahooTeamKey, YahooWeek } from "#yahoo/keys.ts";

export const DashboardRequest = Schema.Struct({
  gameCode: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(16))),
  ),
  includeBestBallLeagues: Schema.optional(Schema.Boolean),
});
export type DashboardRequest = typeof DashboardRequest.Type;

export type DashboardResponse = YahooMobileDashboard;

export const dashboard: API.OperationMethod<
  DashboardRequest,
  DashboardResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_mobile_dashboard",
  input: DashboardRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "statcloud",
    method: "GET",
    path: "/mobile/fantasy/dashboard",
    query: {
      ...(input.gameCode === undefined ? {} : { game_code: input.gameCode }),
      ...(input.includeBestBallLeagues === undefined
        ? {}
        : { include_best_ball_leagues: input.includeBestBallLeagues ? "1" : "0" }),
    },
  }),
  decode: (payload) => decodeDashboard(payload),
});

export const LeagueRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
});
export type LeagueRequest = typeof LeagueRequest.Type;

export type LeagueResponse = YahooStatcloudLeagueAndTeams;

export const league: API.OperationMethod<
  LeagueRequest,
  LeagueResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_statcloud_league",
  input: LeagueRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "statcloud",
    method: "GET",
    path: "/mobile/fantasy/league_and_teams",
    query: { league_key: input.leagueKey },
  }),
  decode: (payload) => decodeLeagueAndTeams(payload),
});

export const MatchupsRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
  rosterKey: Schema.optional(YahooTeamKey),
});
export type MatchupsRequest = typeof MatchupsRequest.Type;

export type MatchupsResponse = YahooStatcloudMatchups;

export const matchups: API.OperationMethod<
  MatchupsRequest,
  MatchupsResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_statcloud_matchups",
  input: MatchupsRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "statcloud",
    method: "GET",
    path: "/mobile/fantasy/matchups_by_league_key-2",
    query: {
      league_key: input.leagueKey,
      ...(input.rosterKey === undefined ? {} : { roster_key: input.rosterKey }),
    },
  }),
  decode: (payload) => decodeMatchups(payload),
});

export const PlayoffsRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
});
export type PlayoffsRequest = typeof PlayoffsRequest.Type;

export type PlayoffsResponse = YahooStatcloudPlayoffs;

export const playoffs: API.OperationMethod<
  PlayoffsRequest,
  PlayoffsResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_statcloud_playoffs",
  input: PlayoffsRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "statcloud",
    method: "GET",
    path: "/mobile/fantasy/playoffs_by_league_key",
    query: { league_key: input.leagueKey },
  }),
  decode: (payload) => decodePlayoffs(payload),
});

export const MatchupScoresRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
  week: YahooWeek,
  teamKey: YahooTeamKey,
  includeOtherMatchups: Schema.optional(Schema.Boolean),
  sportSuffix: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+$/u)))),
});
export type MatchupScoresRequest = typeof MatchupScoresRequest.Type;

export type MatchupScoresResponse = YahooStatcloudMatchupScores;

export const matchupScores: API.OperationMethod<
  MatchupScoresRequest,
  MatchupScoresResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_statcloud_matchup_scores",
  input: MatchupScoresRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "statcloud",
    method: "GET",
    path: `/mobile/fantasy/matchup_player_scores-${input.sportSuffix ?? "6"}`,
    query: {
      league_key: input.leagueKey,
      matchup_week: String(input.week),
      team_key: input.teamKey,
      ...(input.includeOtherMatchups === undefined
        ? {}
        : { include_other_matchups: input.includeOtherMatchups ? "1" : "0" }),
    },
  }),
  decode: (payload) => decodeMatchupScores(payload),
});
