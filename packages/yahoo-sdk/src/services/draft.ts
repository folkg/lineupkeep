import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import { decodeDraftResults } from "#yahoo/internal/draft.ts";
import type { YahooDraftPick } from "#yahoo/internal/draft.ts";
import { YahooLeagueKey } from "#yahoo/keys.ts";

export const ResultsRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
});
export type ResultsRequest = typeof ResultsRequest.Type;

export type ResultsResponse = ReadonlyArray<YahooDraftPick>;

export const results: API.OperationMethod<
  ResultsRequest,
  ResultsResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_draft_results",
  input: ResultsRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/draftresults;out=players`,
  }),
  decode: (payload, input) => decodeDraftResults(payload, input.leagueKey),
});
