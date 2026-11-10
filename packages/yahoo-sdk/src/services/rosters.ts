import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import { coverageSuffix } from "#yahoo/internal/request.ts";
import {
  decodeLeagueRosters,
  decodeLeagueRostersMany,
  decodeRoster,
} from "#yahoo/internal/roster.ts";
import type { YahooLeagueRoster, YahooLeagueRosters, YahooRoster } from "#yahoo/internal/roster.ts";
import {
  YahooCoverage,
  YahooGameKeys,
  YahooLeagueKey,
  YahooTeamKey,
  allYahooGameKeys,
} from "#yahoo/keys.ts";
import { maximumReadLimitBytes } from "#yahoo/protocol.ts";

export const ForTeamRequest = Schema.Struct({
  teamKey: YahooTeamKey,
  coverage: Schema.optional(YahooCoverage),
});
export type ForTeamRequest = typeof ForTeamRequest.Type;

export type ForTeamResponse = YahooRoster;

export const forTeam: API.OperationMethod<
  ForTeamRequest,
  ForTeamResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_roster",
  input: ForTeamRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/team/${input.teamKey}/roster${coverageSuffix(input.coverage)}/players;out=opponent,starting_status,transactions`,
  }),
  decode: (payload, input) => decodeRoster(payload, input.teamKey, input.coverage),
});

export const ForLeagueRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
});
export type ForLeagueRequest = typeof ForLeagueRequest.Type;

export type ForLeagueResponse = YahooLeagueRosters;

export const forLeague: API.OperationMethod<
  ForLeagueRequest,
  ForLeagueResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_league_rosters",
  input: ForLeagueRequest,
  output: Schema.Unknown,
  responseLimitBytes: maximumReadLimitBytes,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/teams;out=roster`,
  }),
  decode: (payload, input) => decodeLeagueRosters(payload, input.leagueKey),
});

const LeagueKeys = Schema.Array(YahooLeagueKey).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(20)),
  Schema.check(
    Schema.makeFilter(
      (leagueKeys: ReadonlyArray<YahooLeagueKey>) => new Set(leagueKeys).size === leagueKeys.length,
    ),
  ),
);

export const ForLeaguesRequest = Schema.Struct({
  leagueKeys: LeagueKeys,
  gameKeys: Schema.optional(YahooGameKeys),
  coverage: Schema.optional(YahooCoverage),
});
export type ForLeaguesRequest = typeof ForLeaguesRequest.Type;

export type ForLeaguesResponse = ReadonlyArray<YahooLeagueRoster>;

export const forLeagues: API.OperationMethod<
  ForLeaguesRequest,
  ForLeaguesResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_league_rosters",
  input: ForLeaguesRequest,
  output: Schema.Unknown,
  request: (input) => {
    const gameKeys = input.gameKeys ?? allYahooGameKeys;
    return {
      host: "read",
      method: "GET",
      path: `/fantasy/v2/users;use_login=1/games;game_keys=${gameKeys.join(",")}/leagues;league_keys=${input.leagueKeys.join(",")};out=settings/teams;out=transactions,games_played;transactions.types=waiver,pending_trade/roster${coverageSuffix(input.coverage)}/players;out=opponent,starting_status,transactions`,
    };
  },
  decode: (payload, input) => decodeLeagueRostersMany(payload, input.leagueKeys),
});
