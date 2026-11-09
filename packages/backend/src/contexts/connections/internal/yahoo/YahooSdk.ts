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
  ProviderReadFailure,
  ProviderRoster,
  ProviderRosterPlayer,
  ProviderRosterSlot,
  ProviderStartingLineup,
  ProviderTransactionTrend,
} from "#contexts/connections/Provider.ts";
import type { PublicInternet } from "#runtime/PublicInternet.ts";

import { yahooReadDeadlineMillis, yahooReadResponseLimitBytes } from "./YahooLimits.ts";
import { yahooPlayerStatus } from "./YahooLineup.ts";

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
      Effect.mapError((error) => sessionFailureOf(operation, error)),
    );
  });

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

function sessionFailureOf(
  operation: ProviderOperation,
  error: Yahoo.YahooReadError,
): ProviderFailure {
  const failure = providerReadFailureOf(operation, error);
  switch (failure._tag) {
    case "provider.session_rejected":
    case "provider.request_failed":
    case "provider.response_invalid":
      return failure;
    case "provider.operation_unsupported":
    case "provider.period_mismatch":
    case "provider.period_unsupported":
      return ProviderResponseInvalid.make({ operation });
  }
}

function providerReadFailureOf(
  operation: ProviderOperation,
  error: Yahoo.YahooReadError,
): ProviderReadFailure {
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
      return ProviderResponseInvalid.make({
        operation,
        ...(error.field === undefined ? {} : { field: error.field }),
      });
    case "YahooCoverageMismatch":
      return periodMismatchOf(operation, error);
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
