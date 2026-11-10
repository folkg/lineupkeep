import * as Yahoo from "@lineupkeep/yahoo-sdk";
import { Context, Effect, Layer, Option, Schema, Tracer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  ProviderPeriodMismatch,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderRosterCoverage,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  PlayerWeekOpponent,
  ProviderFailure,
  ProviderLeagueTeam,
  ProviderOperation,
  ProviderPlayerDetail,
  ProviderPlayerSearchInput,
  ProviderPlayerSearchResult,
  ProviderPlayerSearchSort,
  ProviderPlayerStatus,
  ProviderReadFailure,
  ProviderRoster,
  ProviderRosterPlayer,
  ProviderRosterSlot,
  ProviderSchedulePlayer,
  ProviderStartingLineup,
  ProviderStatBasis,
  ProviderTransactionTrend,
} from "#contexts/connections/Provider.ts";
import type { PublicInternet } from "#runtime/PublicInternet.ts";

import { yahooReadDeadlineMillis, yahooReadResponseLimitBytes } from "./YahooLimits.ts";
import { yahooPlayerStatus } from "./YahooLineup.ts";

export type {
  YahooDraftPick,
  YahooLeagueSettings,
  YahooMatchup,
  YahooPendingTrade,
  YahooTransaction,
  YahooTransactionPick,
  YahooTransactionPlayer,
  YahooTransactionTeam,
} from "@lineupkeep/yahoo-sdk";

export const yahooHostOrigin = Yahoo.hostOrigin;

export const yahooSdkContext = (
  internet: PublicInternet["Service"],
): Effect.Effect<Context.Context<HttpClient.HttpClient | Yahoo.Protocol>, never> =>
  Effect.scoped(
    Layer.build(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient)(yahooSdkHttpClient(internet)),
        Yahoo.YahooProtocol,
      ),
    ),
  ).pipe(Effect.orDie);

export const readLeagueThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  leagueKey: string,
): Effect.Effect<Yahoo.YahooLeagueSettings, ProviderReadFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    return yield* Yahoo.leagues.settings({ leagueKey }).pipe(
      Yahoo.Retry.none,
      Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
      Effect.provideService(Tracer.DisablePropagation, true),
      Effect.mapError((error) => providerReadFailureOf(operation, error)),
    );
  });

export const readMatchupsThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  leagueKey: string,
  week: number,
): Effect.Effect<ReadonlyArray<Yahoo.YahooMatchup>, ProviderReadFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    return yield* Yahoo.matchups.week({ leagueKey, week }).pipe(
      Yahoo.Retry.none,
      Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
      Effect.provideService(Tracer.DisablePropagation, true),
      Effect.mapError((error) => providerReadFailureOf(operation, error)),
    );
  });

export const readTransactionsThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  input: {
    readonly leagueKey: string;
    readonly teamKey: string | undefined;
    readonly limit: number;
    readonly offset: number;
  },
): Effect.Effect<ReadonlyArray<Yahoo.YahooTransaction>, ProviderReadFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    return yield* Yahoo.transactions
      .list({
        leagueKey: input.leagueKey,
        limit: input.limit,
        ...(input.teamKey === undefined ? {} : { teamKey: input.teamKey }),
        ...(input.offset === 0 ? {} : { offset: input.offset }),
      })
      .pipe(
        Yahoo.Retry.none,
        Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
        Effect.provideService(Tracer.DisablePropagation, true),
        Effect.mapError((error) => providerReadFailureOf(operation, error)),
      );
  });

export const readPendingTradesThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  leagueKey: string,
  teamKey: string,
): Effect.Effect<ReadonlyArray<Yahoo.YahooPendingTrade>, ProviderReadFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    return yield* Yahoo.transactions.pendingTrades({ leagueKey, teamKey }).pipe(
      Yahoo.Retry.none,
      Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
      Effect.provideService(Tracer.DisablePropagation, true),
      Effect.mapError((error) => providerReadFailureOf(operation, error)),
    );
  });

export const readDraftResultsThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  leagueKey: string,
): Effect.Effect<ReadonlyArray<Yahoo.YahooDraftPick>, ProviderReadFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    return yield* Yahoo.draft.results({ leagueKey }).pipe(
      Yahoo.Retry.none,
      Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
      Effect.provideService(Tracer.DisablePropagation, true),
      Effect.mapError((error) => providerReadFailureOf(operation, error)),
    );
  });

export const readLeagueTeamsThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  leagueKey: string,
): Effect.Effect<ReadonlyArray<ProviderLeagueTeam>, ProviderReadFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    const teams = yield* Yahoo.teams.list({ leagueKey }).pipe(
      Yahoo.Retry.none,
      Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
      Effect.provideService(Tracer.DisablePropagation, true),
      Effect.mapError((error) => providerReadFailureOf(operation, error)),
    );
    return teams.map(providerLeagueTeamOf);
  });

export const readRosterThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  teamKey: string,
  coverage: ProviderRosterCoverage | undefined,
): Effect.Effect<ProviderRoster, ProviderReadFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    const roster = yield* Yahoo.rosters
      .forTeam({ teamKey, ...(coverage === undefined ? {} : { coverage }) })
      .pipe(
        Yahoo.Retry.none,
        Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
        Effect.provideService(Tracer.DisablePropagation, true),
        Effect.mapError((error) => rosterFailureOf(operation, coverage, error)),
      );
    return providerRosterOf(teamKey, roster);
  });

export const readRosterScheduleThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  teamKey: string,
  coverage: ProviderRosterCoverage,
): Effect.Effect<ReadonlyArray<ProviderSchedulePlayer>, ProviderReadFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    const roster = yield* Yahoo.rosters.forTeam({ teamKey, coverage }).pipe(
      Yahoo.Retry.none,
      Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
      Effect.provideService(Tracer.DisablePropagation, true),
      Effect.mapError((error) => providerReadFailureOf(operation, error)),
    );
    return roster.players.map((player) => providerSchedulePlayerOf(player, coverage));
  });

function providerSchedulePlayerOf(
  player: Yahoo.YahooRosterPlayer,
  coverage: ProviderRosterCoverage,
): ProviderSchedulePlayer {
  const opponent = scheduledOpponent(player.opponent);
  return {
    providerPlayerKey: player.playerKey,
    name: player.name,
    proTeamKey: player.proTeamKey,
    proTeamAbbreviation: player.proTeamAbbreviation,
    games:
      opponent === undefined
        ? []
        : [{ date: coverage.type === "date" ? coverage.date : undefined, ...opponent }],
  };
}

export const readPlayerDetailsThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  input: {
    readonly leagueKey: string;
    readonly playerKeys: ReadonlyArray<string>;
    readonly stats: Yahoo.YahooStatQuery;
  },
): Effect.Effect<ReadonlyArray<ProviderPlayerDetail>, ProviderReadFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    const details = yield* Yahoo.players
      .details({ leagueKey: input.leagueKey, playerKeys: input.playerKeys, stats: input.stats })
      .pipe(
        Yahoo.Retry.none,
        Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
        Effect.provideService(Tracer.DisablePropagation, true),
        Effect.mapError((error) => providerReadFailureOf(operation, error)),
      );
    return details.map((player) => providerPlayerDetailOf(player, input.stats));
  });

export const validateSessionThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
): Effect.Effect<void, ProviderFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    yield* Yahoo.session.validate({}).pipe(
      Yahoo.Retry.none,
      Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
      Effect.provideService(Tracer.DisablePropagation, true),
      Effect.mapError((error) => providerFailureOf(operation, error)),
    );
  });

export const discoverLeaguesThroughSdk = <GameKey extends Yahoo.YahooGameKey>(
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  gameKeys: ReadonlyArray<GameKey>,
): Effect.Effect<ReadonlyArray<DiscoveredLeague<GameKey>>, ProviderFailure> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    const leagues = yield* Yahoo.leagues.discover({ gameKeys }).pipe(
      Yahoo.Retry.none,
      Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
      Effect.provideService(Tracer.DisablePropagation, true),
      Effect.mapError((error) => providerFailureOf(operation, error)),
    );
    return leagues.map((league) => ({
      ...league,
      gameKey: requestedGameKeyOf(league, gameKeys),
    }));
  });

function requestedGameKeyOf<GameKey extends Yahoo.YahooGameKey>(
  league: Yahoo.YahooDiscoveredLeague,
  gameKeys: ReadonlyArray<GameKey>,
): GameKey {
  const gameKey = gameKeys.find((key) => key === league.gameKey);
  if (gameKey === undefined) {
    throw new Error("Yahoo discovered a game key that was not requested.");
  }
  return gameKey;
}

type DiscoveredLeague<GameKey extends Yahoo.YahooGameKey> = Omit<
  Yahoo.YahooDiscoveredLeague,
  "gameKey"
> & { readonly gameKey: GameKey };

type ProviderPlayerSearchRead = {
  readonly leagueKey: string;
  readonly season: number;
  readonly query: string | undefined;
  readonly availability: ProviderPlayerSearchInput["availability"];
  readonly sort: ProviderPlayerSearchSort;
  readonly statType: "season";
  readonly statId: number | undefined;
  readonly limit: number;
};

export const searchPlayersThroughSdk = (
  context: Context.Context<HttpClient.HttpClient | Yahoo.Protocol>,
  operation: ProviderOperation,
  cookie: string,
  input: ProviderPlayerSearchRead,
): Effect.Effect<
  ReadonlyArray<ProviderPlayerSearchResult["players"][number]>,
  ProviderReadFailure
> =>
  Effect.gen(function* () {
    const session = yield* Yahoo.makeSession(cookie).pipe(
      Effect.mapError(() => ProviderSessionRejected.make({ operation })),
    );
    const groups = yield* Yahoo.players
      .search({
        leagueKeys: [input.leagueKey],
        availability: input.availability,
        sort: input.sort,
        sortType: input.statType,
        limit: input.limit,
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.statId === undefined ? {} : { statId: input.statId }),
      })
      .pipe(
        Yahoo.Retry.none,
        Effect.provideContext(Context.add(context, Yahoo.Credentials, Effect.succeed(session))),
        Effect.provideService(Tracer.DisablePropagation, true),
        Effect.mapError((error) => providerReadFailureOf(operation, error)),
      );
    const players = groups.find((group) => group.leagueKey === input.leagueKey)?.players;
    if (players === undefined) {
      return yield* ProviderResponseInvalid.make({ operation, field: "league.league_key" });
    }
    return players.map((player) => providerSearchPlayerOf(player, input.season));
  });

function providerSearchPlayerOf(
  player: Yahoo.YahooPlayerSummary,
  season: number,
): ProviderPlayerSearchResult["players"][number] {
  return {
    providerPlayerKey: player.playerKey,
    name: player.name,
    primaryPosition: player.primaryPosition,
    displayPosition: player.displayPosition,
    eligiblePositions: player.eligiblePositions,
    availability: providerAvailabilityOf(player.ownershipType),
    proTeam: player.proTeamAbbreviation,
    ...(player.proTeamKey === undefined ? {} : { proTeamKey: player.proTeamKey }),
    status: searchPlayerStatusOf(player.status),
    percentOwned: player.percentOwned?.value ?? null,
    percentOwnedDelta: player.percentOwned?.delta ?? null,
    percentStarted: player.percentStarted?.value ?? null,
    percentStartedChange: player.percentStarted?.delta ?? null,
    actualRank: searchRankOf(player.ranks, "S", season),
    overallRank: searchRankOf(player.ranks, "OR", season),
    statValue: player.statValue,
    transactionTrend: transactionTrendOf(player.transactionCounts),
  };
}

function searchPlayerStatusOf(status: Yahoo.YahooPlayerStatus | undefined): {
  readonly value: ProviderPlayerStatus;
  readonly code: string | undefined;
  readonly detail: string | undefined;
} {
  const raw = status?.code;
  if (typeof raw === "boolean") {
    return {
      value: raw ? "unknown" : "healthy",
      code: undefined,
      detail: status?.detail,
    };
  }
  const code = raw === undefined || raw.trim().length === 0 ? undefined : raw;
  return { value: yahooPlayerStatus(code), code, detail: status?.detail };
}

function searchRankOf(
  ranks: ReadonlyArray<Yahoo.YahooPlayerRank>,
  type: "OR" | "S",
  season: number,
): number | null {
  for (const rank of ranks) {
    if (rank.type !== type) {
      continue;
    }
    if (type === "S" && rank.season !== season) {
      continue;
    }
    if (rank.value !== null && Number.isInteger(rank.value) && rank.value >= 1) {
      return rank.value;
    }
  }
  return null;
}

function providerPlayerDetailOf(
  player: Yahoo.YahooPlayerDetail,
  query: Yahoo.YahooStatQuery,
): ProviderPlayerDetail {
  return {
    providerPlayerKey: player.playerKey,
    name: player.name,
    primaryPosition: player.primaryPosition,
    displayPosition: player.displayPosition,
    proTeam: player.proTeamAbbreviation,
    availabilityDetail: player.status?.detail,
    eligiblePositions: player.eligiblePositions,
    rosterStatus: providerAvailabilityOf(player.ownershipType),
    actual:
      player.stats === undefined
        ? undefined
        : {
            basis: statBasisOf(query),
            stats: player.stats.values,
            notAggregated: [],
          },
    projected: undefined,
  };
}

function statBasisOf(query: Yahoo.YahooStatQuery): ProviderStatBasis {
  switch (query.type) {
    case "season":
      return { type: "season" };
    case "week":
      return { type: "week", week: query.week };
    case "date":
      return { type: "date_range", start: query.date, end: query.date, days: 1 };
  }
}

function providerAvailabilityOf(
  ownershipType: string | undefined,
): ProviderPlayerDetail["rosterStatus"] {
  switch (ownershipType) {
    case "team":
      return "rostered";
    case "freeagents":
      return "free_agent";
    case "waivers":
      return "waiver";
    case undefined:
      return "unknown";
    default:
      return "unknown";
  }
}

function providerLeagueTeamOf(team: Yahoo.YahooLeagueTeam): ProviderLeagueTeam {
  return {
    providerTeamKey: team.teamKey,
    providerLeagueKey: team.leagueKey,
    name: team.name,
    acquisitionUsage: {
      seasonMoves: team.numberOfMoves,
      weeklyAdds:
        team.rosterAdds === undefined
          ? undefined
          : { used: team.rosterAdds.value, coverage: team.rosterAdds.coverage },
    },
    ...(team.faabBalance === undefined ? {} : { remainingBudget: team.faabBalance }),
  };
}

function providerRosterOf(teamKey: string, roster: Yahoo.YahooRoster): ProviderRoster {
  return {
    providerTeamKey: teamKey,
    providerLeagueKey: roster.leagueKey,
    coverage: roster.coverage,
    players: roster.players.map(providerRosterPlayerOf),
  };
}

function providerRosterPlayerOf(player: Yahoo.YahooRosterPlayer): ProviderRosterPlayer {
  const opponent = scheduledOpponent(player.opponent);
  return {
    providerPlayerKey: player.playerKey,
    name: player.name,
    displayPosition: player.displayPosition,
    primaryPosition: player.primaryPosition,
    positionType: player.positionType,
    proTeamAbbreviation: player.proTeamAbbreviation,
    eligiblePositions: player.eligiblePositions,
    slot: rosterSlotOf(player.selectedPosition.position),
    isEditable: player.editable ?? null,
    injuryCode: player.statusCode,
    injuryDetail: player.statusDetail,
    status: yahooPlayerStatus(player.statusCode),
    byeWeek: player.byeWeek ?? null,
    scheduled: opponent !== undefined,
    opponent,
    startingLineup: startingLineupOf(player.startingStatus?.starting),
    undroppable: player.undroppable ?? null,
    transactionTrend: transactionTrendOf(player.transactions),
  };
}

export function rosterSlotOf(rawValue: string): ProviderRosterSlot {
  return rawValue === ""
    ? {
        status: "unverified",
        rawValue,
        reason:
          "Your league published an empty lineup slot for this player, so the slot and the position eligibility it would establish are unverified.",
      }
    : { status: "verified", slot: rawValue };
}

export function scheduledOpponent(
  opponent: string | null | undefined,
): PlayerWeekOpponent | undefined {
  const named =
    opponent === undefined || opponent === null || opponent.trim() === "" ? undefined : opponent;
  if (named === undefined || named === "Bye") {
    return undefined;
  }
  return named.startsWith("@")
    ? { opponent: named.slice(1), home: false }
    : { opponent: named, home: true };
}

export function startingLineupOf(starting: boolean | undefined): ProviderStartingLineup {
  return starting === undefined
    ? "unconfirmed"
    : starting
      ? "confirmed-starting"
      : "confirmed-not-starting";
}

type TransactionCounts = {
  readonly adds?: number;
  readonly drops?: number;
};

function isReadonlyArray<A>(value: ReadonlyArray<A> | A): value is ReadonlyArray<A> {
  return Array.isArray(value);
}

export function transactionTrendOf(
  value: TransactionCounts | ReadonlyArray<TransactionCounts> | undefined,
): ProviderTransactionTrend {
  const counts = isReadonlyArray(value) ? value[0] : value;
  if (counts?.adds === undefined || counts.drops === undefined) {
    return {
      status: "not_published",
      reason: "Your league published no add and drop counts for this player.",
    };
  }
  return {
    status: "published",
    adds: counts.adds,
    drops: counts.drops,
    window: "provider_current_day",
  };
}

function yahooSdkHttpClient(internet: PublicInternet["Service"]): HttpClient.HttpClient {
  return HttpClient.make((request, _url, signal) =>
    Effect.gen(function* () {
      const webRequest = yield* HttpClientRequest.toWeb(request, { signal });
      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const received = yield* internet.request(webRequest, {
            timeoutMs: yahooReadDeadlineMillis,
            maxResponseBytes: yahooReadResponseLimitBytes,
          });
          const body = yield* Effect.tryPromise({
            try: () => received.arrayBuffer(),
            catch: () => "body_unavailable" as const,
          });
          return new Response(body.byteLength === 0 ? null : body, {
            status: received.status,
            statusText: received.statusText,
            headers: received.headers,
          });
        }),
      );
      return HttpClientResponse.fromWeb(request, response);
    }).pipe(
      Effect.mapError(
        (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
      ),
    ),
  );
}

function rosterFailureOf(
  operation: ProviderOperation,
  coverage: ProviderRosterCoverage | undefined,
  error: Yahoo.YahooReadError,
): ProviderReadFailure {
  const failure = providerReadFailureOf(operation, error);
  if (
    failure._tag !== "provider.request_failed" ||
    failure.status !== 400 ||
    coverage === undefined
  ) {
    return failure;
  }
  return ProviderPeriodMismatch.make({ operation, requested: coverage, covered: null });
}

function providerFailureOf(
  operation: ProviderOperation,
  error: Yahoo.YahooReadError,
): ProviderFailure {
  switch (error._tag) {
    case "ConfigError":
      return ProviderSessionRejected.make({ operation });
    case "Unauthorized":
    case "Forbidden":
      return ProviderSessionRejected.make({
        operation,
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.structured ? { detail: error.message } : {}),
      });
    case "YahooRequestInvalid":
    case "YahooParseError":
    case "YahooCoverageMismatch":
      return ProviderResponseInvalid.make({
        operation,
        ...("field" in error && error.field !== undefined ? { field: error.field } : {}),
      });
    case "YahooHttpError":
      return ProviderRequestFailed.make({ operation, status: error.status });
    case "YahooWriteUnknown":
      return ProviderRequestFailed.make({
        operation,
        ...(error.status === undefined ? {} : { status: error.status }),
      });
    case "HttpClientError":
      return ProviderRequestFailed.make({ operation });
    case "GatewayTimeout":
    case "BadRequest":
    case "NotFound":
    case "Conflict":
    case "UnprocessableEntity":
    case "Locked":
    case "TooManyRequests":
    case "InternalServerError":
    case "BadGateway":
    case "ServiceUnavailable":
      return ProviderRequestFailed.make({
        operation,
        ...(error.status === undefined ? {} : { status: error.status }),
      });
  }
}

function providerReadFailureOf(
  operation: ProviderOperation,
  error: Yahoo.YahooReadError,
): ProviderReadFailure {
  return error._tag === "YahooCoverageMismatch"
    ? periodMismatchOf(operation, error)
    : providerFailureOf(operation, error);
}

function periodMismatchOf(
  operation: ProviderOperation,
  error: Yahoo.YahooCoverageMismatch,
): ProviderReadFailure {
  const requested = Schema.decodeUnknownOption(ProviderRosterCoverage)(error.requested);
  if (Option.isNone(requested)) {
    return ProviderResponseInvalid.make({ operation, field: "requested" });
  }
  const covered = Schema.decodeUnknownOption(ProviderRosterCoverage)(error.covered);
  return ProviderPeriodMismatch.make({
    operation,
    requested: requested.value,
    covered: Option.getOrNull(covered),
  });
}
