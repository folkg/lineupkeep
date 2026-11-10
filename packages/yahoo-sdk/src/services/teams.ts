import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import { decodeLeagueTeams, decodeTeamGamesPlayed } from "#yahoo/internal/team.ts";
import type { YahooGamesPlayed, YahooLeagueTeam } from "#yahoo/internal/team.ts";
import { YahooLeagueKey, YahooTeamKey, leagueKeyOfTeam } from "#yahoo/keys.ts";

export const ListRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
});
export type ListRequest = typeof ListRequest.Type;

export type ListResponse = ReadonlyArray<YahooLeagueTeam>;

export const list: API.OperationMethod<
  ListRequest,
  ListResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_league_teams",
  input: ListRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/teams`,
  }),
  decode: (payload, input) => decodeLeagueTeams(payload, input.leagueKey),
});

const GamesPlayedShape = Schema.Struct({
  leagueKey: YahooLeagueKey,
  teamKey: YahooTeamKey,
});

export const GamesPlayedRequest = GamesPlayedShape.pipe(
  Schema.check(
    Schema.makeFilter(
      (input: typeof GamesPlayedShape.Type) => leagueKeyOfTeam(input.teamKey) === input.leagueKey,
    ),
  ),
);
export type GamesPlayedRequest = typeof GamesPlayedRequest.Type;

export type GamesPlayedResponse = ReadonlyArray<YahooGamesPlayed>;

export const gamesPlayed: API.OperationMethod<
  GamesPlayedRequest,
  GamesPlayedResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_team_games_played",
  input: GamesPlayedRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/teams;team_keys=${input.teamKey};out=games_played`,
  }),
  decode: (payload, input) => decodeTeamGamesPlayed(payload, input.leagueKey, input.teamKey),
});
