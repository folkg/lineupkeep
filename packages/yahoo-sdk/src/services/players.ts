import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import {
  decodeGamePlayers,
  decodePlayerDetails,
  decodePlayerSearch,
  decodePlayerSearchMany,
} from "#yahoo/internal/player.ts";
import type {
  YahooLeaguePlayerSearch,
  YahooPlayerDetail,
  YahooPlayerSummary,
} from "#yahoo/internal/player.ts";
import { searchSortToken, statsQueryOf } from "#yahoo/internal/request.ts";
import { YahooDate, YahooGameKey, YahooLeagueKey, YahooPlayerKey, YahooWeek } from "#yahoo/keys.ts";

const StatQuery = Schema.Union([
  Schema.Struct({ type: Schema.Literal("season") }),
  Schema.Struct({ type: Schema.Literal("week"), week: YahooWeek }),
  Schema.Struct({ type: Schema.Literal("date"), date: YahooDate }),
]);

const Search = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => {
      const trimmed = value.trim();
      return trimmed.length > 0 && trimmed.length <= 80;
    }),
  ),
);

const Sort = Schema.Literals([
  "name",
  "position",
  "ownership",
  "actual_rank",
  "overall_rank",
  "stat",
]);

const Availability = Schema.Literals(["all", "free_agent", "waiver"]);

const LeagueKeys = Schema.Array(YahooLeagueKey).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(20)),
  Schema.check(
    Schema.makeFilter(
      (leagueKeys: ReadonlyArray<YahooLeagueKey>) => new Set(leagueKeys).size === leagueKeys.length,
    ),
  ),
);

const SearchShape = Schema.Struct({
  leagueKeys: LeagueKeys,
  query: Schema.optional(Search),
  availability: Availability,
  sort: Sort,
  sortType: Schema.Literals(["season", "week"]),
  statId: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
});

export const SearchRequest = SearchShape.pipe(
  Schema.check(
    Schema.makeFilter(
      (input: typeof SearchShape.Type) => input.sort !== "stat" || input.statId !== undefined,
    ),
  ),
);
export type SearchRequest = typeof SearchRequest.Type;

export type SearchResponse = ReadonlyArray<YahooLeaguePlayerSearch>;

export const search: API.OperationMethod<
  SearchRequest,
  SearchResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "search_players",
  input: SearchRequest,
  output: Schema.Unknown,
  request: (input) => {
    const statId = input.sort === "stat" ? input.statId : undefined;
    const status =
      input.availability === "all"
        ? ""
        : input.availability === "free_agent"
          ? ";status=FA"
          : ";status=W";
    const sortType = ["actual_rank", "overall_rank", "stat"].includes(input.sort)
      ? `;sort_type=${input.sortType}`
      : "";
    const query = input.query?.trim();
    const search =
      query === undefined || query.length === 0 ? "" : `;search=${encodeURIComponent(query)}`;
    const out =
      input.sort === "stat"
        ? "ownership,percent_owned,percent_started,ranks,stats,transactions,opponent,starting_status"
        : "ownership,percent_owned,percent_started,ranks,transactions,opponent,starting_status";
    return {
      host: "read",
      method: "GET",
      path: `/fantasy/v2/users;use_login=1/games;game_keys=nfl,nhl,nba,mlb/leagues;league_keys=${input.leagueKeys.join(",")}/players${status};sort=${searchSortToken(input.sort, statId)}${sortType};count=${String(input.limit)}${search};out=${out}`,
    };
  },
  decode: (payload, input) =>
    decodePlayerSearchMany(
      payload,
      input.leagueKeys,
      input.sort === "stat" ? input.statId : undefined,
    ),
});

const Position = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(40)),
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_/+,-]+$/u)),
);

const AvailableShape = Schema.Struct({
  gameKey: YahooGameKey,
  availability: Availability,
  position: Schema.optional(Position),
  sort: Sort,
  sortType: Schema.Literals(["season", "week"]),
  statId: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
  offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000 })),
});

export const AvailableRequest = AvailableShape.pipe(
  Schema.check(
    Schema.makeFilter(
      (input: typeof AvailableShape.Type) => input.sort !== "stat" || input.statId !== undefined,
    ),
  ),
);
export type AvailableRequest = typeof AvailableRequest.Type;

export type AvailableResponse = ReadonlyArray<YahooPlayerSummary>;

export const available: API.OperationMethod<
  AvailableRequest,
  AvailableResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "search_players",
  input: AvailableRequest,
  output: Schema.Unknown,
  request: (input) => {
    const statId = input.sort === "stat" ? input.statId : undefined;
    const status =
      input.availability === "all"
        ? ""
        : input.availability === "free_agent"
          ? ";status=FA"
          : ";status=W";
    const sortType = ["actual_rank", "overall_rank", "stat"].includes(input.sort)
      ? `;sort_type=${input.sortType}`
      : "";
    const position = input.position === undefined ? "" : `;position=${input.position}`;
    const out =
      input.sort === "stat"
        ? "ownership,percent_owned,percent_started,ranks,stats,transactions,opponent,starting_status"
        : "ownership,percent_owned,percent_started,ranks,transactions,opponent,starting_status";
    return {
      host: "read",
      method: "GET",
      path: `/fantasy/v2/games;game_keys=${input.gameKey}/players${status}${position};sort=${searchSortToken(input.sort, statId)}${sortType};count=${String(input.limit)};start=${String(input.offset)};out=${out}`,
    };
  },
  decode: (payload, input) =>
    decodeGamePlayers(payload, input.gameKey, input.sort === "stat" ? input.statId : undefined),
});

export const DetailsRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
  playerKeys: Schema.Array(YahooPlayerKey).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(25)),
    Schema.check(
      Schema.makeFilter((keys: ReadonlyArray<string>) => new Set(keys).size === keys.length),
    ),
  ),
  stats: StatQuery,
});
export type DetailsRequest = typeof DetailsRequest.Type;

export type DetailsResponse = ReadonlyArray<YahooPlayerDetail>;

export const details: API.OperationMethod<
  DetailsRequest,
  DetailsResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_player_details",
  input: DetailsRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/players;player_keys=${input.playerKeys.join(",")};out=stats,ownership`,
    query: statsQueryOf(input.stats),
  }),
  decode: (payload, input) => decodePlayerDetails(payload, input.leagueKey, input.stats),
});

const StartingPosition = Schema.Literals(["S_G", "S_P"]);

const StartersPageRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
  position: StartingPosition,
  offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
});

const startersPage: API.OperationMethod<
  typeof StartersPageRequest.Type,
  ReadonlyArray<YahooPlayerSummary>,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "search_players",
  input: StartersPageRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/players;position=${input.position};sort=AR;start=${String(input.offset)}`,
  }),
  decode: (payload, input) => decodePlayerSearch(payload, input.leagueKey, undefined),
});

export const StartersRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
  position: StartingPosition,
});
export type StartersRequest = typeof StartersRequest.Type;

export type StartersResponse = ReadonlyArray<YahooPlayerSummary>;

export const starters: API.OperationMethod<
  StartersRequest,
  StartersResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeCustom({ name: "search_players", input: StartersRequest }, (input) =>
  Effect.gen(function* () {
    const first = yield* startersPage({ ...input, offset: 0 });
    const second = yield* startersPage({ ...input, offset: 25 });
    const seen = new Set<string>();
    return [...first, ...second].filter((player) => {
      if (seen.has(player.playerKey)) {
        return false;
      }
      seen.add(player.playerKey);
      return true;
    });
  }),
);
