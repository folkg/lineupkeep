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
  ProviderFailure,
  ProviderLeagueTeam,
  ProviderOperation,
  ProviderReadFailure,
} from "#contexts/connections/Provider.ts";
import type { PublicInternet } from "#runtime/PublicInternet.ts";

import { yahooReadDeadlineMillis, yahooReadResponseLimitBytes } from "./YahooLimits.ts";

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
