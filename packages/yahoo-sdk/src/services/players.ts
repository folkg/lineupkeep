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
import {
  YahooDate,
  YahooGameKey,
  YahooGameKeys,
  YahooLeagueKey,
  YahooPlayerKey,
  YahooWeek,
  allYahooGameKeys,
} from "#yahoo/keys.ts";

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
  "recent_rank",
]);

const RecentWindow = Schema.Literals(["last7days", "last14days", "last30days"]);

const AvailableSort = Schema.Literals([
  "name",
  "position",
  "ownership",
  "actual_rank",
  "overall_rank",
  "stat",
]);

const Availability = Schema.Literals(["all", "free_agent", "waiver"]);

const RankType = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(40)),
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_]+$/u)),
);

const CutType = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(40)),
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/u)),
);

const RankTypes = Schema.Array(RankType).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(20)),
  Schema.check(
    Schema.makeFilter((ranks: ReadonlyArray<string>) => new Set(ranks).size === ranks.length),
  ),
);

const CutTypes = Schema.Array(CutType).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(20)),
  Schema.check(
    Schema.makeFilter((cuts: ReadonlyArray<string>) => new Set(cuts).size === cuts.length),
  ),
);

const LeagueKeys = Schema.Array(YahooLeagueKey).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(20)),
  Schema.check(
    Schema.makeFilter(
      (leagueKeys: ReadonlyArray<YahooLeagueKey>) => new Set(leagueKeys).size === leagueKeys.length,
    ),
  ),
);

const Position = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(40)),
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_/+,-]+$/u)),
);

const SearchShape = Schema.Struct({
  leagueKeys: LeagueKeys,
  gameKeys: Schema.optional(YahooGameKeys),
  query: Schema.optional(Search),
  position: Schema.optional(Position),
  availability: Availability,
  sort: Sort,
  sortType: Schema.Literals(["season", "week"]),
  statId: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))),
  recentWindow: Schema.optional(RecentWindow),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
  ranks: Schema.optional(RankTypes),
  percentStartedCutTypes: Schema.optional(CutTypes),
  percentOwnedCutTypes: Schema.optional(CutTypes),
});

export const SearchRequest = SearchShape.pipe(
  Schema.check(
    Schema.makeFilter(
      (input: typeof SearchShape.Type) =>
        (input.sort !== "stat" || input.statId !== undefined) &&
        (input.sort === "recent_rank") === (input.recentWindow !== undefined),
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
    const position = input.position === undefined ? "" : `;position=${input.position}`;
    const out =
      input.sort === "stat"
        ? "ownership,percent_owned,percent_started,ranks,stats,transactions,opponent,starting_status"
        : "ownership,percent_owned,percent_started,ranks,transactions,opponent,starting_status";
    const gameKeys = input.gameKeys ?? allYahooGameKeys;
    const cuts = cutTypesQuery(input);
    return {
      host: "read",
      method: "GET",
      path: `/fantasy/v2/users;use_login=1/games;game_keys=${gameKeys.join(",")}/leagues;league_keys=${input.leagueKeys.join(",")}/players${status}${position};sort=${searchSortToken(input.sort, statId, input.recentWindow)}${sortType};count=${String(input.limit)}${search};out=${out}${rankSuffix(input.ranks)}`,
      ...(Object.keys(cuts).length === 0 ? {} : { query: cuts }),
    };
  },
  decode: (payload, input) =>
    decodePlayerSearchMany(
      payload,
      input.leagueKeys,
      input.sort === "stat" ? input.statId : undefined,
    ),
});

const AvailableShape = Schema.Struct({
  gameKey: YahooGameKey,
  availability: Availability,
  position: Schema.optional(Position),
  sort: AvailableSort,
  sortType: Schema.Literals(["season", "week"]),
  statId: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
  offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000 })),
  ranks: Schema.optional(RankTypes),
  percentStartedCutTypes: Schema.optional(CutTypes),
  percentOwnedCutTypes: Schema.optional(CutTypes),
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
    const cuts = cutTypesQuery(input);
    return {
      host: "read",
      method: "GET",
      path: `/fantasy/v2/games;game_keys=${input.gameKey}/players${status}${position};sort=${searchSortToken(input.sort, statId, undefined)}${sortType};count=${String(input.limit)};start=${String(input.offset)};out=${out}${rankSuffix(input.ranks)}`,
      ...(Object.keys(cuts).length === 0 ? {} : { query: cuts }),
    };
  },
  decode: (payload, input) =>
    decodeGamePlayers(payload, input.gameKey, input.sort === "stat" ? input.statId : undefined),
});

const DetailField = Schema.Literals([
  "stats",
  "ownership",
  "ranks",
  "percent_started",
  "percent_owned",
  "opponent",
]);
type DetailField = typeof DetailField.Type;

const defaultDetailFields: ReadonlyArray<DetailField> = ["stats", "ownership"];

const DetailsShape = Schema.Struct({
  leagueKey: YahooLeagueKey,
  playerKeys: Schema.Array(YahooPlayerKey).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(25)),
    Schema.check(
      Schema.makeFilter((keys: ReadonlyArray<string>) => new Set(keys).size === keys.length),
    ),
  ),
  stats: Schema.optional(StatQuery),
  fields: Schema.optional(
    Schema.Array(DetailField).pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(
        Schema.makeFilter(
          (fields: ReadonlyArray<DetailField>) => new Set(fields).size === fields.length,
        ),
      ),
    ),
  ),
  ranks: Schema.optional(RankTypes),
  percentStartedCutTypes: Schema.optional(CutTypes),
  percentOwnedCutTypes: Schema.optional(CutTypes),
});

export const DetailsRequest = DetailsShape.pipe(
  Schema.check(
    Schema.makeFilter((input: typeof DetailsShape.Type) => {
      const fields = detailFieldsOf(input);
      return !fields.includes("stats") || input.stats !== undefined;
    }),
  ),
);
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
  request: (input) => {
    const fields = detailFieldsOf(input);
    const stats =
      fields.includes("stats") && input.stats !== undefined ? statsQueryOf(input.stats) : {};
    const query = { ...stats, ...cutTypesQuery(input) };
    return {
      host: "read",
      method: "GET",
      path: `/fantasy/v2/league/${input.leagueKey}/players;player_keys=${input.playerKeys.join(",")};out=${fields.join(",")}${rankSuffix(input.ranks)}`,
      ...(Object.keys(query).length === 0 ? {} : { query }),
    };
  },
  decode: (payload, input) =>
    decodePlayerDetails(
      payload,
      input.leagueKey,
      detailFieldsOf(input).includes("stats") ? input.stats : undefined,
    ),
});

function detailFieldsOf(input: typeof DetailsShape.Type): ReadonlyArray<DetailField> {
  const fields: Array<DetailField> = [...(input.fields ?? defaultDetailFields)];
  const add = (field: DetailField): void => {
    if (!fields.includes(field)) {
      fields.push(field);
    }
  };
  if (input.stats !== undefined) {
    add("stats");
  }
  if (input.ranks !== undefined) {
    add("ranks");
  }
  if (input.percentStartedCutTypes !== undefined) {
    add("percent_started");
  }
  if (input.percentOwnedCutTypes !== undefined) {
    add("percent_owned");
  }
  return fields;
}

function rankSuffix(ranks: ReadonlyArray<string> | undefined): string {
  return ranks === undefined ? "" : `;ranks=${ranks.join(",")}`;
}

function cutTypesQuery(input: {
  readonly percentStartedCutTypes?: ReadonlyArray<string>;
  readonly percentOwnedCutTypes?: ReadonlyArray<string>;
}): Readonly<Record<string, string>> {
  return {
    ...(input.percentStartedCutTypes === undefined
      ? {}
      : { "percent_started.cut_types": input.percentStartedCutTypes.join(",") }),
    ...(input.percentOwnedCutTypes === undefined
      ? {}
      : { "percent_owned.cut_types": input.percentOwnedCutTypes.join(",") }),
  };
}

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
