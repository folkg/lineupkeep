import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import { decodeLeagueTeams } from "#yahoo/internal/team.ts";
import type { YahooLeagueTeam } from "#yahoo/internal/team.ts";
import { YahooLeagueKey } from "#yahoo/keys.ts";

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
