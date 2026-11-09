import { Effect, Schema } from "effect";

import {
  IntFromStringOrNumber,
  decodePayload,
  numberOrNull,
  optionalNonEmpty,
  percentOrNull,
  singleEntry,
} from "#yahoo/decode.ts";
import { YahooCoverageMismatch, YahooParseError } from "#yahoo/errors.ts";
import { YahooDate, YahooPlayerKey } from "#yahoo/keys.ts";
import type { YahooCoverage, YahooLeagueKey } from "#yahoo/keys.ts";

export function decodePlayerSearch(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
  requestedStatId: number | undefined,
): Effect.Effect<ReadonlyArray<YahooPlayerSummary>, YahooParseError | YahooCoverageMismatch> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(PlayerSearchPayload, payload, "search_players");
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "search_players",
        field: "league.league_key",
      });
    }
    return yield* summariesOf(decoded.league.players, "search_players", requestedStatId);
  });
}

export function decodePlayerSearchMany(
  payload: unknown,
  requestedLeagueKeys: ReadonlyArray<YahooLeagueKey>,
  requestedStatId: number | undefined,
): Effect.Effect<ReadonlyArray<YahooLeaguePlayerSearch>, YahooParseError | YahooCoverageMismatch> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(AggregatePlayerSearchPayload, payload, "search_players");
    const groups: Array<YahooLeaguePlayerSearch> = [];
    for (const user of decoded.users) {
      for (const game of user.games) {
        for (const entry of game.leagues) {
          const league = entry.league;
          if (!requestedLeagueKeys.includes(league.league_key)) {
            return yield* new YahooParseError({
              operation: "search_players",
              field: "league.league_key",
            });
          }
          groups.push({
            leagueKey: league.league_key,
            players: yield* summariesOf(league.players, "search_players", requestedStatId),
          });
        }
      }
    }
    return groups;
  });
}

export function decodeGamePlayers(
  payload: unknown,
  requestedGameKey: string,
  requestedStatId: number | undefined,
): Effect.Effect<ReadonlyArray<YahooPlayerSummary>, YahooParseError | YahooCoverageMismatch> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(GamePlayersPayload, payload, "search_players");
    const game = decoded.games[0];
    if (game === undefined || game.game_key !== requestedGameKey) {
      return yield* new YahooParseError({
        operation: "search_players",
        field: "games.game_key",
      });
    }
    return yield* summariesOf(game.players, "search_players", requestedStatId);
  });
}

function summariesOf(
  players: ReadonlyArray<typeof SearchPlayerPayload.Type>,
  operation: "search_players",
  requestedStatId: number | undefined,
): Effect.Effect<ReadonlyArray<YahooPlayerSummary>, YahooParseError | YahooCoverageMismatch> {
  return Effect.gen(function* () {
    const summaries: Array<YahooPlayerSummary> = [];
    for (const player of players) {
      summaries.push({
        playerKey: player.player_key,
        name: player.name.full,
        primaryPosition: player.primary_position,
        displayPosition: player.display_position,
        eligiblePositions: (player.eligible_positions ?? []).map(({ position }) => position),
        proTeamAbbreviation: optionalNonEmpty(player.editorial_team_abbr),
        ownershipType: player.ownership?.ownership_type,
        percentOwned: yield* percentOf(player.percent_owned, operation, "percent_owned"),
        percentStarted: yield* percentOf(player.percent_started, operation, "percent_started"),
        ranks: (player.player_ranks ?? []).map(({ player_rank }) => ({
          type: player_rank.rank_type,
          value: numberOrNull(player_rank.rank_value),
          season: player_rank.rank_season,
        })),
        stats:
          player.player_stats === undefined
            ? undefined
            : yield* statSeriesOf(player.player_stats, undefined, operation),
        transactionCounts: singleEntryOf(player.transactions),
        status: statusOf(player.status, player.status_full, player.injury_note),
        opponent: player.opponent,
        startingStatus: startingStatusOf(player.starting_status),
        statValue:
          requestedStatId === undefined ? null : statValueOf(player.player_stats, requestedStatId),
      });
    }
    return summaries;
  });
}

export function decodePlayerDetails(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
  query: YahooStatQuery,
): Effect.Effect<ReadonlyArray<YahooPlayerDetail>, YahooParseError | YahooCoverageMismatch> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(PlayerDetailsPayload, payload, "read_player_details");
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_player_details",
        field: "league.league_key",
      });
    }
    const details: Array<YahooPlayerDetail> = [];
    for (const player of decoded.league.players) {
      details.push({
        playerKey: player.player_key,
        name: optionalNonEmpty(player.name?.full),
        primaryPosition: optionalNonEmpty(player.primary_position),
        displayPosition: optionalNonEmpty(player.display_position),
        positionType: optionalNonEmpty(player.position_type),
        proTeamAbbreviation: optionalNonEmpty(player.editorial_team_abbr),
        eligiblePositions:
          player.eligible_positions === undefined
            ? undefined
            : player.eligible_positions.map(({ position }) => position),
        ownershipType: player.ownership?.ownership_type,
        percentOwned: yield* percentOf(
          player.percent_owned,
          "read_player_details",
          "percent_owned",
        ),
        percentStarted: yield* percentOf(
          player.percent_started,
          "read_player_details",
          "percent_started",
        ),
        ranks: (player.player_ranks ?? []).map(({ player_rank }) => ({
          type: player_rank.rank_type,
          value: numberOrNull(player_rank.rank_value),
          season: player_rank.rank_season,
        })),
        stats:
          player.player_stats === undefined
            ? undefined
            : yield* statSeriesOf(player.player_stats, query, "read_player_details"),
        status: statusOf(player.status, player.status_full, player.injury_note),
      });
    }
    return details;
  });
}

function startingStatusOf(
  status: ReadonlyArray<typeof StartingStatus.Type> | undefined,
): YahooPlayerStartingStatus | undefined {
  if (status === undefined) {
    return undefined;
  }
  const starting = status.find((entry) => entry.is_starting === 0 || entry.is_starting === 1);
  if (starting === undefined) {
    return undefined;
  }
  const coverageEntry = status.find(
    (entry) =>
      entry.coverage_type !== undefined || entry.week !== undefined || entry.date !== undefined,
  );
  const coverage =
    coverageEntry?.coverage_type === "week" && coverageEntry.week !== undefined
      ? { type: "week" as const, week: coverageEntry.week }
      : coverageEntry?.coverage_type === "date" && coverageEntry.date !== undefined
        ? { type: "date" as const, date: coverageEntry.date }
        : undefined;
  return { coverage, starting: starting.is_starting === 1 };
}

function statSeriesOf(
  stats: typeof PlayerStats.Type,
  query: YahooStatQuery | undefined,
  operation: "search_players" | "read_player_details",
): Effect.Effect<
  { readonly coverage: YahooStatCoverage; readonly values: ReadonlyArray<YahooStatValue> },
  YahooParseError | YahooCoverageMismatch
> {
  return Effect.gen(function* () {
    const entry = stats.entries[0];
    if (stats.entries.length !== 1 || entry === undefined) {
      return yield* new YahooParseError({ operation, field: "player_stats.entries" });
    }
    const coverage: YahooStatCoverage | undefined =
      entry.coverage_type === "week" && entry.week !== undefined
        ? { type: "week", week: entry.week }
        : entry.coverage_type === "date" && entry.date !== undefined
          ? { type: "date", date: entry.date }
          : entry.coverage_type === "season"
            ? { type: "season" }
            : undefined;
    if (coverage === undefined) {
      return yield* new YahooParseError({
        operation,
        field: "player_stats.entries.coverage_type",
      });
    }
    if (query !== undefined && !sameStatCoverage(statQueryCoverage(query), coverage)) {
      return yield* new YahooCoverageMismatch({
        operation,
        requested: statQueryCoverage(query),
        covered: coverage,
      });
    }
    return {
      coverage,
      values: stats.stats.map(({ stat }) => ({
        statId: stat.stat_id,
        value: numberOrNull(stat.value),
      })),
    };
  });
}

function percentOf(
  payload: typeof PercentOwned.Type | undefined,
  operation: "search_players" | "read_player_details",
  field: string,
): Effect.Effect<YahooPercent | undefined, YahooParseError> {
  return Effect.gen(function* () {
    if (payload === undefined) {
      return undefined;
    }
    return {
      coverage: yield* coverageOfPercent(payload, operation, field),
      value: yield* percentOrNull(payload.value, operation, `${field}.value`),
      delta: numberOrNull(payload.delta),
    };
  });
}

function coverageOfPercent(
  payload: typeof PercentOwned.Type,
  operation: "search_players" | "read_player_details",
  field: string,
): Effect.Effect<YahooCoverage | undefined, YahooParseError> {
  if (payload.coverage_type === undefined) {
    return Effect.succeed(undefined);
  }
  if (payload.coverage_type === "week" && payload.week !== undefined) {
    return Effect.succeed({ type: "week", week: payload.week });
  }
  if (payload.coverage_type === "date" && payload.date !== undefined) {
    return Effect.succeed({ type: "date", date: payload.date });
  }
  return Effect.fail(new YahooParseError({ operation, field: `${field}.coverage_type` }));
}

function statusOf(
  code: string | boolean | undefined,
  statusFull: string | undefined,
  injuryNote: string | undefined,
): YahooPlayerStatus | undefined {
  const detail = optionalNonEmpty(injuryNote) ?? optionalNonEmpty(statusFull);
  if (code === undefined && detail === undefined) {
    return undefined;
  }
  return { code, detail };
}

function singleEntryOf(
  value: typeof PlayerTransactions.Type | undefined,
): YahooTransactionCounts | undefined {
  return value === undefined ? undefined : singleEntry(value);
}

function statValueOf(stats: typeof PlayerStats.Type | undefined, statId: number): number | null {
  const match = stats?.stats.find(({ stat }) => stat.stat_id === statId);
  return match === undefined ? null : numberOrNull(match.stat.value);
}

function statQueryCoverage(query: YahooStatQuery): YahooStatCoverage {
  switch (query.type) {
    case "season":
      return { type: "season" };
    case "week":
      return { type: "week", week: query.week };
    case "date":
      return { type: "date", date: query.date };
  }
}

function sameStatCoverage(expected: YahooStatCoverage, covered: YahooStatCoverage): boolean {
  if (expected.type === "season" || covered.type === "season") {
    return expected.type === "season" && covered.type === "season";
  }
  return expected.type === "week" && covered.type === "week"
    ? expected.week === covered.week
    : expected.type === "date" && covered.type === "date"
      ? expected.date === covered.date
      : false;
}

export type YahooStatQuery =
  | { readonly type: "season" }
  | { readonly type: "week"; readonly week: number }
  | { readonly type: "date"; readonly date: string };

export type YahooPlayerSearchSort =
  | "name"
  | "position"
  | "ownership"
  | "actual_rank"
  | "overall_rank"
  | "stat";

export type YahooPlayerAvailability = "all" | "free_agent" | "waiver";

export type YahooPlayerSummary = {
  readonly playerKey: string;
  readonly name: string;
  readonly primaryPosition: string;
  readonly displayPosition: string;
  readonly eligiblePositions: ReadonlyArray<string>;
  readonly proTeamAbbreviation?: string;
  readonly ownershipType?: string;
  readonly percentOwned?: YahooPercent;
  readonly percentStarted?: YahooPercent;
  readonly ranks: ReadonlyArray<YahooPlayerRank>;
  readonly stats?: YahooPlayerStatSeries;
  readonly transactionCounts?: YahooTransactionCounts;
  readonly status?: YahooPlayerStatus;
  readonly opponent?: string | null;
  readonly startingStatus?: YahooPlayerStartingStatus;
  readonly statValue: number | null;
};

export type YahooLeaguePlayerSearch = {
  readonly leagueKey: string;
  readonly players: ReadonlyArray<YahooPlayerSummary>;
};

export type YahooPlayerDetail = {
  readonly playerKey: string;
  readonly name?: string;
  readonly primaryPosition?: string;
  readonly displayPosition?: string;
  readonly positionType?: string;
  readonly proTeamAbbreviation?: string;
  readonly eligiblePositions?: ReadonlyArray<string>;
  readonly ownershipType?: string;
  readonly percentOwned?: YahooPercent;
  readonly percentStarted?: YahooPercent;
  readonly ranks: ReadonlyArray<YahooPlayerRank>;
  readonly stats?: YahooPlayerStatSeries;
  readonly status?: YahooPlayerStatus;
};

export type YahooPercent = {
  readonly coverage?: YahooCoverage;
  readonly value: number | null;
  readonly delta: number | null;
};

export type YahooPlayerRank = {
  readonly type: string;
  readonly value: number | null;
  readonly season?: number;
};

export type YahooPlayerStatus = {
  readonly code?: string | boolean;
  readonly detail?: string;
};

export type YahooPlayerStartingStatus = {
  readonly coverage?: YahooCoverage;
  readonly starting: boolean;
};

export type YahooPlayerStatSeries = {
  readonly coverage: YahooStatCoverage;
  readonly values: ReadonlyArray<YahooStatValue>;
};

export type YahooStatCoverage = YahooCoverage | { readonly type: "season" };

export type YahooStatValue = {
  readonly statId: number;
  readonly value: number | null;
};

export type YahooTransactionCounts = {
  readonly adds?: number;
  readonly drops?: number;
  readonly trades?: number;
  readonly total?: number;
};

const PercentOwned = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  date: Schema.optional(YahooDate),
  value: Schema.optional(Schema.NullOr(Schema.Union([Schema.Finite, Schema.String]))),
  delta: Schema.optional(Schema.NullOr(Schema.Union([Schema.Finite, Schema.String]))),
});

const StatEntry = Schema.Struct({
  stat: Schema.Struct({
    stat_id: IntFromStringOrNumber,
    value: Schema.Union([Schema.Finite, Schema.String, Schema.Null]),
  }),
});

const StatCoverageEntry = Schema.Struct({
  coverage_type: Schema.NonEmptyString,
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
  date: Schema.optional(YahooDate),
});

const PlayerStats = Schema.Struct({
  stats: Schema.Array(StatEntry),
  entries: Schema.Array(StatCoverageEntry),
});

const PlayerRankPayload = Schema.Struct({
  player_rank: Schema.Struct({
    rank_type: Schema.NonEmptyString,
    rank_value: Schema.Union([Schema.String, Schema.Finite]),
    rank_season: Schema.optional(IntFromStringOrNumber),
  }),
});

const PlayerTransactions = Schema.Union([
  Schema.Struct({
    adds: Schema.optional(IntFromStringOrNumber),
    drops: Schema.optional(IntFromStringOrNumber),
    trades: Schema.optional(IntFromStringOrNumber),
    total: Schema.optional(IntFromStringOrNumber),
  }),
  Schema.Array(
    Schema.Struct({
      adds: Schema.optional(IntFromStringOrNumber),
      drops: Schema.optional(IntFromStringOrNumber),
      trades: Schema.optional(IntFromStringOrNumber),
      total: Schema.optional(IntFromStringOrNumber),
    }),
  ),
]);

const StatusPayload = Schema.optional(Schema.Union([Schema.String, Schema.Boolean]));

const StartingStatus = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  is_starting: Schema.optional(IntFromStringOrNumber),
});

const SearchPlayerPayload = Schema.Struct({
  player_key: YahooPlayerKey,
  name: Schema.Struct({ full: Schema.NonEmptyString }),
  primary_position: Schema.NonEmptyString,
  display_position: Schema.NonEmptyString,
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  editorial_team_abbr: Schema.optional(Schema.String),
  ownership: Schema.optional(Schema.Struct({ ownership_type: Schema.optional(Schema.String) })),
  percent_owned: Schema.optional(PercentOwned),
  percent_started: Schema.optional(PercentOwned),
  player_ranks: Schema.optional(Schema.Array(PlayerRankPayload)),
  player_stats: Schema.optional(PlayerStats),
  status: StatusPayload,
  status_full: Schema.optional(Schema.String),
  injury_note: Schema.optional(Schema.String),
  transactions: Schema.optional(PlayerTransactions),
  opponent: Schema.optional(Schema.NullOr(Schema.String)),
  starting_status: Schema.optional(Schema.Array(StartingStatus)),
});

const PlayerDetailPayload = Schema.Struct({
  player_key: YahooPlayerKey,
  name: Schema.optional(Schema.Struct({ full: Schema.optional(Schema.String) })),
  primary_position: Schema.optional(Schema.String),
  display_position: Schema.optional(Schema.String),
  position_type: Schema.optional(Schema.String),
  editorial_team_abbr: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  ownership: Schema.optional(Schema.Struct({ ownership_type: Schema.optional(Schema.String) })),
  percent_owned: Schema.optional(PercentOwned),
  percent_started: Schema.optional(PercentOwned),
  player_ranks: Schema.optional(Schema.Array(PlayerRankPayload)),
  player_stats: Schema.optional(PlayerStats),
  status: StatusPayload,
  status_full: Schema.optional(Schema.String),
  injury_note: Schema.optional(Schema.String),
});

const LeaguePlayersPayload = Schema.Struct({
  league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
  players: Schema.Array(SearchPlayerPayload),
});

const PlayerSearchPayload = Schema.Struct({
  league: LeaguePlayersPayload,
});

const AggregatePlayerSearchPayload = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      games: Schema.Array(
        Schema.Struct({
          leagues: Schema.Array(Schema.Struct({ league: LeaguePlayersPayload })),
        }),
      ),
    }),
  ),
});

const GamePlayersPayload = Schema.Struct({
  games: Schema.Array(
    Schema.Struct({
      game_key: Schema.String,
      players: Schema.Array(SearchPlayerPayload),
    }),
  ),
});

const PlayerDetailsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
    players: Schema.Array(PlayerDetailPayload),
  }),
});
