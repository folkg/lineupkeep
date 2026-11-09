import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import { decodeMatchups } from "#yahoo/internal/matchup.ts";
import type { YahooMatchup } from "#yahoo/internal/matchup.ts";
import { YahooLeagueKey, YahooWeek } from "#yahoo/keys.ts";

export const WeekRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
  week: YahooWeek,
});
export type WeekRequest = typeof WeekRequest.Type;

export type WeekResponse = ReadonlyArray<YahooMatchup>;

export const week: API.OperationMethod<
  WeekRequest,
  WeekResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_matchups",
  input: WeekRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/scoreboard;week=${String(input.week)}`,
  }),
  decode: (payload, input) => decodeMatchups(payload, input.leagueKey, input.week),
});
