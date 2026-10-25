import { Effect, Layer, Redacted, Schema, SchemaTransformation } from "effect";

import {
  ProviderCrumbUnavailable,
  ProviderGateway,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type { ProviderTeam } from "#contexts/connections/Provider.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { normalizeYahooJson } from "./YahooJson.ts";
import { yahooReadDeadlineMillis, yahooReadResponseLimitBytes } from "./YahooLimits.ts";

const readOrigin = new URL("https://pub-api-ro.fantasysports.yahoo.com");
const serviceOrigin = new URL("https://pub-api.fantasysports.yahoo.com");
const supportedLeagues = ["nfl", "nhl"] as const;
const leagueSport = {
  nfl: "football",
  nhl: "hockey",
} as const;

export const YahooProvider = Layer.effect(
  ProviderGateway,
  Effect.gen(function* () {
    const internet = yield* PublicInternet;

    const validateSession = Effect.fn("YahooProvider.validateSession")(function* (
      input: ProviderSessionMaterial,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "validate_session");
      const cookie = yield* sessionCookie(input, "validate_session");
      const payload = yield* readJson(internet, {
        operation: "validate_session",
        origin: readOrigin,
        path: "/fantasy/v2/users;use_login=1",
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const session = yield* decodePayload(SessionPayload, payload, "validate_session");
      if (session.users.length === 0) {
        return yield* ProviderSessionRejected.make({ operation: "validate_session" });
      }
    });

    const discoverTeams = Effect.fn("YahooProvider.discoverTeams")(function* (
      input: ProviderSessionMaterial,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "discover_teams");
      const cookie = yield* sessionCookie(input, "discover_teams");
      const teams: ProviderTeam[] = [];
      for (const league of supportedLeagues) {
        const payload = yield* readJson(internet, {
          operation: "discover_teams",
          origin: readOrigin,
          path: `/fantasy/v2/users;use_login=1/games;game_keys=${league}/teams`,
          query: { format: "json" },
          cookie,
          normalize: true,
        });
        const decoded = yield* decodePayload(TeamsPayload, payload, "discover_teams");
        if (decoded.users.length === 0) {
          return yield* ProviderSessionRejected.make({ operation: "discover_teams" });
        }
        for (const team of teamsFromPayload(decoded, league)) {
          teams.push(team);
        }
      }
      yield* Effect.annotateCurrentSpan("provider.team_count", teams.length);
      return teams;
    });

    const readCrumb = Effect.fn("YahooProvider.readCrumb")(function* (
      input: ProviderSessionMaterial,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_crumb");
      const cookie = yield* sessionCookie(input, "read_crumb");
      const payload = yield* readJson(internet, {
        operation: "read_crumb",
        origin: serviceOrigin,
        path: "/fantasy/v3/getCrumb",
        query: { format: "json_f" },
        cookie,
        normalize: false,
      });
      const decoded = yield* decodePayload(CrumbPayload, payload, "read_crumb");
      const crumb = decoded.service.crumb?.trim();
      if (crumb === undefined || crumb.length === 0) {
        return yield* ProviderCrumbUnavailable.make({ operation: "read_crumb" });
      }
      return { crumb: Redacted.make(crumb) };
    });

    return ProviderGateway.of({ validateSession, discoverTeams, readCrumb });
  }),
);

function sessionCookie(
  input: ProviderSessionMaterial,
  operation: "validate_session" | "discover_teams" | "read_crumb",
): Effect.Effect<string, ProviderSessionRejected> {
  return Schema.decodeEffect(ProviderSessionMaterial)(input).pipe(
    Effect.flatMap((material) =>
      Schema.decodeEffect(SessionCookie)(Redacted.value(material.session)),
    ),
    Effect.mapError(() => ProviderSessionRejected.make({ operation })),
  );
}

type ReadRequest = {
  readonly operation: "validate_session" | "discover_teams" | "read_crumb";
  readonly origin: URL;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly cookie: string;
  readonly normalize: boolean;
};

function readJson(
  internet: PublicInternet["Service"],
  request: ReadRequest,
): Effect.Effect<
  unknown,
  ProviderRequestFailed | ProviderResponseInvalid | ProviderSessionRejected
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const url = yield* Effect.try({
        try: () => yahooUrl(request.origin, request.path, request.query),
        catch: () => ProviderResponseInvalid.make({ operation: request.operation }),
      });
      const response = yield* internet
        .request(
          new Request(url, {
            method: "GET",
            headers: {
              accept: "application/json",
              cookie: request.cookie,
            },
          }),
          {
            timeoutMs: yahooReadDeadlineMillis,
            maxResponseBytes: yahooReadResponseLimitBytes,
          },
        )
        .pipe(Effect.mapError(() => ProviderRequestFailed.make({ operation: request.operation })));

      if (response.status === 401 || response.status === 403) {
        yield* discardBody(response);
        return yield* ProviderSessionRejected.make({ operation: request.operation });
      }
      if (!response.ok) {
        yield* discardBody(response);
        return yield* ProviderRequestFailed.make({ operation: request.operation });
      }

      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => ProviderRequestFailed.make({ operation: request.operation }),
      });
      const payload = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
        Effect.mapError(() => ProviderResponseInvalid.make({ operation: request.operation })),
      );
      return request.normalize ? normalizeYahooJson(payload) : payload;
    }),
  );
}

function discardBody(response: Response): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => response.body?.cancel() ?? Promise.resolve(),
    catch: () => "discard_failed" as const,
  }).pipe(Effect.ignore);
}

function yahooUrl(origin: URL, path: string, query: Readonly<Record<string, string>>): URL {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("Yahoo path must be a relative path without query or fragment");
  }
  const url = new URL(path, origin);
  if (
    url.origin !== origin.origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== path
  ) {
    throw new Error("Yahoo request escaped its fixed origin");
  }
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  if ([...url.searchParams.keys()].some((key) => key !== "format")) {
    throw new Error("Yahoo request contains an unsupported query field");
  }
  return url;
}

function decodePayload<A>(
  schema: Schema.Codec<A, unknown>,
  payload: unknown,
  operation: "validate_session" | "discover_teams" | "read_crumb",
): Effect.Effect<A, ProviderResponseInvalid> {
  return Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.mapError(() => ProviderResponseInvalid.make({ operation })),
  );
}

function teamsFromPayload(
  payload: typeof TeamsPayload.Type,
  league: (typeof supportedLeagues)[number],
): ReadonlyArray<ProviderTeam> {
  return payload.users.flatMap((user) =>
    user.games.flatMap((game) => {
      const season = game.season;
      const teams = game.teams ?? [];
      return teams.map((team) => {
        const leagueKey = providerLeagueKey(team.team_key);
        return {
          provider: "yahoo" as const,
          providerTeamKey: team.team_key,
          providerLeagueKey: leagueKey,
          league,
          sport: leagueSport[league],
          season,
          name: team.name,
        };
      });
    }),
  );
}

function providerLeagueKey(teamKey: string): string {
  return teamKey.slice(0, teamKey.lastIndexOf(".t."));
}

const SessionCookie = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(8_192)),
  Schema.check(Schema.isPattern(/^[\x20-\x7e]+$/u)),
  Schema.check(Schema.isPattern(/=/u)),
);

const Season = Schema.Union([Schema.String, Schema.Finite]).pipe(
  Schema.decodeTo(
    Schema.Int.check(Schema.isGreaterThan(1900)),
    SchemaTransformation.transform({
      decode: (value) => (typeof value === "number" ? value : Number(value)),
      encode: (value) => value,
    }),
  ),
);

const SessionPayload = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      guid: Schema.Union([Schema.String, Schema.Finite]),
    }),
  ),
});

const TeamPayload = Schema.Struct({
  team_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[^.]+\.l\.[^.]+\.t\.[^.]+$/u))),
  name: Schema.NonEmptyString,
});

const GamePayload = Schema.Struct({
  season: Season,
  teams: Schema.optional(Schema.Array(TeamPayload)),
});

const TeamsPayload = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      games: Schema.Array(GamePayload),
    }),
  ),
});

const CrumbPayload = Schema.Struct({
  service: Schema.Struct({
    crumb: Schema.NullOr(Schema.String),
  }),
});
