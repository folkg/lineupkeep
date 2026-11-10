import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import { decodeFelo, decodeTeamAnalysis, decodeTradePartners } from "#yahoo/internal/analysis.ts";
import type { YahooFelo, YahooTeamAnalysis, YahooTradePartner } from "#yahoo/internal/analysis.ts";
import { decodeLeagueSettings } from "#yahoo/internal/league.ts";
import type { YahooLeagueSettings } from "#yahoo/internal/league.ts";
import { decodeStandings } from "#yahoo/internal/standings.ts";
import type { YahooStandings } from "#yahoo/internal/standings.ts";
import { decodeDiscoveredLeagues } from "#yahoo/internal/team.ts";
import type { YahooDiscoveredLeague } from "#yahoo/internal/team.ts";
import {
  YahooGameKeys,
  YahooLeagueKey,
  YahooTeamKey,
  allYahooGameKeys,
  leagueKeyOfTeam,
} from "#yahoo/keys.ts";

export const SettingsRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
});
export type SettingsRequest = typeof SettingsRequest.Type;

export type SettingsResponse = YahooLeagueSettings;

export const settings: API.OperationMethod<
  SettingsRequest,
  SettingsResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_league_settings",
  input: SettingsRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/settings`,
  }),
  decode: (payload, input) => decodeLeagueSettings(payload, input.leagueKey),
});

export const StandingsRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
});
export type StandingsRequest = typeof StandingsRequest.Type;

export type StandingsResponse = YahooStandings;

export const standings: API.OperationMethod<
  StandingsRequest,
  StandingsResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_standings",
  input: StandingsRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/standings`,
  }),
  decode: (payload, input) => decodeStandings(payload, input.leagueKey),
});

const DiscoverShape = Schema.Struct({
  gameKeys: Schema.optional(YahooGameKeys),
});

export const DiscoverRequest = DiscoverShape;
export type DiscoverRequest = typeof DiscoverRequest.Type;

export type DiscoverResponse = ReadonlyArray<YahooDiscoveredLeague>;

export const discover: API.OperationMethod<
  DiscoverRequest,
  DiscoverResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "discover_leagues",
  input: DiscoverRequest,
  output: Schema.Unknown,
  request: (input) => {
    const gameKeys = input.gameKeys ?? allYahooGameKeys;
    return {
      host: "read",
      method: "GET",
      path: `/fantasy/v2/users;use_login=1/games;game_keys=${gameKeys.join(",")}/leagues;out=settings/teams;out=standings`,
    };
  },
  decode: (payload, input) => decodeDiscoveredLeagues(payload, input.gameKeys ?? allYahooGameKeys),
});

export const FeloRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
});
export type FeloRequest = typeof FeloRequest.Type;

export type FeloResponse = YahooFelo;

export const felo: API.OperationMethod<
  FeloRequest,
  FeloResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_felo",
  input: FeloRequest,
  output: Schema.Unknown,
  request: (input) => {
    const [gameKey, leagueId] = input.leagueKey.split(".l.");
    return {
      host: "service",
      method: "GET",
      path: `/fantasy/v3/game/${gameKey}/league/${leagueId}/felo`,
    };
  },
  decode: (payload, input) => decodeFelo(payload, input.leagueKey),
});

export const TradePartnersRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
});
export type TradePartnersRequest = typeof TradePartnersRequest.Type;

export type TradePartnersResponse = ReadonlyArray<YahooTradePartner>;

export const tradePartners: API.OperationMethod<
  TradePartnersRequest,
  TradePartnersResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_trade_partners",
  input: TradePartnersRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey};out=settings/teams;out=players,standings,recommended_trade_partners,positional_ranks;positional_ranks.starters_only=0`,
  }),
  decode: (payload, input) => decodeTradePartners(payload, input.leagueKey),
});

const TeamAnalysisShape = Schema.Struct({
  leagueKey: YahooLeagueKey,
  teamKeys: Schema.Array(YahooTeamKey).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(12)),
    Schema.check(
      Schema.makeFilter((keys: ReadonlyArray<string>) => new Set(keys).size === keys.length),
    ),
  ),
});

export const TeamAnalysisRequest = TeamAnalysisShape.pipe(
  Schema.check(
    Schema.makeFilter((input: typeof TeamAnalysisShape.Type) =>
      input.teamKeys.every((key) => leagueKeyOfTeam(key) === input.leagueKey),
    ),
  ),
);
export type TeamAnalysisRequest = typeof TeamAnalysisRequest.Type;

export type TeamAnalysisResponse = ReadonlyArray<YahooTeamAnalysis>;

export const teamAnalysis: API.OperationMethod<
  TeamAnalysisRequest,
  TeamAnalysisResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_team_analysis",
  input: TeamAnalysisRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/teams;team_keys=${input.teamKeys.join(",")};out=available_draft_picks,positional_ranks,standings;positional_ranks.starters_only=1`,
  }),
  decode: (payload, input) => decodeTeamAnalysis(payload, input.leagueKey),
});
