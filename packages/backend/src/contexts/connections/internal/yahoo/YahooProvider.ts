import {
  DateTime,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from "effect";

import {
  ProviderCrumbUnavailable,
  ProviderGateway,
  ProviderOperationUnsupported,
  ProviderPeriodMismatch,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderReviewLinkInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderLeagueSettings,
  ProviderMatchup,
  ProviderNativeActionResult,
  ProviderNativeTarget,
  ProviderOperation,
  ProviderPeriod,
  ProviderPeriodWindow,
  ProviderPlayerDetail,
  ProviderPlayerSearchInput,
  ProviderPlayerSearchResult,
  ProviderRoster,
  ProviderRosterPlayer,
  ProviderReviewLinkInput,
  ProviderTeam,
  ProviderTeamScore,
  ProviderTransaction,
} from "#contexts/connections/Provider.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { normalizeYahooJson } from "./YahooJson.ts";
import {
  yahooReadDeadlineMillis,
  yahooReadResponseLimitBytes,
  yahooWriteDeadlineMillis,
  yahooWriteResponseLimitBytes,
} from "./YahooLimits.ts";

const readOrigin = new URL("https://pub-api-ro.fantasysports.yahoo.com");
const serviceOrigin = new URL("https://pub-api.fantasysports.yahoo.com");
const writeOrigin = new URL("https://pub-api-rw.fantasysports.yahoo.com");
const supportedLeagues = ["nfl", "nhl"] as const;
const leagueSport = {
  nfl: "football",
  nhl: "hockey",
} as const;
const reviewHosts = {
  football: "football.fantasysports.yahoo.com",
  hockey: "hockey.fantasysports.yahoo.com",
} as const;
const searchStatus = {
  free_agent: "FA",
  waiver: "W",
} as const;
const searchSort = {
  name: "NAME",
  position: "NAME",
  ownership: "R_PO",
} as const;
const maximumSelectedPlayers = 25;
const maximumUpstreamLimit = 50;

type ReadOperation =
  | "validate_session"
  | "discover_teams"
  | "read_crumb"
  | "read_league"
  | "read_roster"
  | "read_player_details"
  | "search_players"
  | "read_matchups"
  | "read_transactions"
  | "read_league_teams"
  | "apply_native_start_active";

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

    const readLeague = Effect.fn("YahooProvider.readLeague")(function* (
      input: ProviderSessionMaterial & {
        readonly providerLeagueKey: string;
        readonly sport: "football" | "hockey";
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_league");
      const cookie = yield* sessionCookie(input, "read_league");
      const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_league");
      const payload = yield* readJson(internet, {
        operation: "read_league",
        origin: readOrigin,
        path: `/fantasy/v2/league/${leagueKey}/settings`,
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const decoded = yield* decodePayload(LeaguePayload, payload, "read_league");
      const settings = yield* leagueSettings(decoded, input.providerLeagueKey, input.sport);
      yield* Effect.annotateCurrentSpan({
        "provider.stat_category_count": settings.statCategories.length,
        "provider.roster_position_count": settings.rosterPositions.length,
      });
      return settings;
    });

    const readRoster = Effect.fn("YahooProvider.readRoster")(function* (
      input: ProviderSessionMaterial & {
        readonly providerTeamKey: string;
        readonly period: ProviderPeriod | undefined;
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_roster");
      const cookie = yield* sessionCookie(input, "read_roster");
      const teamKey = yield* ValidTeamKey(input.providerTeamKey, "read_roster");
      const week = input.period === undefined ? undefined : yield* ValidWeek(input.period.week);
      const periodSuffix = week === undefined ? "" : `;week=${String(week)}`;
      const payload = yield* readJson(internet, {
        operation: "read_roster",
        origin: readOrigin,
        path: `/fantasy/v2/team/${teamKey}/roster${periodSuffix}`,
        query: { format: "json" },
        cookie,
        normalize: true,
      }).pipe(
        Effect.catchIf(
          (error): error is ProviderRequestFailed =>
            error._tag === "provider.request_failed" && error.status === 400 && week !== undefined,
          () =>
            ProviderPeriodMismatch.make({
              operation: "read_roster",
              requestedWeek: week ?? 1,
              coveredWeek: null,
            }),
        ),
      );
      const decoded = yield* decodePayload(TeamRosterPayload, payload, "read_roster");
      const roster = yield* rosterFromPayload(decoded, input.providerTeamKey, input.period);
      yield* Effect.annotateCurrentSpan("provider.player_count", roster.players.length);
      return roster;
    });

    const applyNativeStartActive: (
      input: ProviderSessionMaterial & {
        readonly providerTeamKey: string;
        readonly target: ProviderNativeTarget;
      },
    ) => Effect.Effect<
      ProviderNativeActionResult,
      ProviderSessionRejected | ProviderResponseInvalid
    > = Effect.fn("YahooProvider.applyNativeStartActive")(function* (
      input: ProviderSessionMaterial & {
        readonly providerTeamKey: string;
        readonly target: ProviderNativeTarget;
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "apply_native_start_active");
      const cookie = yield* sessionCookie(input, "apply_native_start_active");
      const teamKey = yield* ValidTeamKey(input.providerTeamKey, "apply_native_start_active");
      const target = yield* ValidNativeTarget(input.target);
      const crumb = yield* Effect.result(readCrumb(input));
      if (crumb._tag === "Failure") {
        if (crumb.failure._tag === "provider.session_rejected") {
          return yield* crumb.failure;
        }
        return crumb.failure._tag === "provider.crumb_unavailable"
          ? { status: "not_sent" as const, reason: "crumb_unavailable" as const }
          : { status: "not_sent" as const, reason: "request_failed" as const };
      }
      const url = yahooWriteUrl(
        `/fantasy/v2/team/${teamKey}/roster`,
        Redacted.value(crumb.success.crumb),
      );
      const body = nativeStartActiveBody(target);
      const response = yield* Effect.scoped(
        internet
          .request(
            new Request(url, {
              method: "PUT",
              headers: {
                accept: "application/json",
                "content-type": "application/xml",
                cookie,
              },
              body,
            }),
            {
              timeoutMs: yahooWriteDeadlineMillis,
              maxResponseBytes: yahooWriteResponseLimitBytes,
            },
          )
          .pipe(
            Effect.flatMap((result) => discardBody(result).pipe(Effect.as(result.status))),
            Effect.catchTag("PublicInternetUnavailable", () => Effect.void),
          ),
      );
      yield* Effect.annotateCurrentSpan("provider.native_action", "start_active_players");
      if (response === undefined) {
        return { status: "unknown" as const };
      }
      yield* Effect.annotateCurrentSpan("http.response.status_code", response);
      if (response === 401 || response === 403) {
        return yield* ProviderSessionRejected.make({ operation: "apply_native_start_active" });
      }
      if (response === 404) {
        return { status: "rejected" as const, reason: "not_found" as const };
      }
      if (response === 408 || response === 429) {
        return { status: "not_sent" as const, reason: "request_failed" as const };
      }
      if (response >= 500) {
        return { status: "unknown" as const };
      }
      if (response >= 400) {
        return { status: "rejected" as const, reason: "invalid_request" as const };
      }
      return { status: "accepted" as const };
    });

    const unsupported = (
      operation: ProviderOperation,
      reason: string,
    ): Effect.Effect<never, ProviderOperationUnsupported> =>
      ProviderOperationUnsupported.make({ operation, reason });

    const readPlayerDetails = Effect.fn("YahooProvider.readPlayerDetails")(function* (
      input: ProviderSessionMaterial & {
        readonly providerLeagueKey: string;
        readonly providerPlayerKeys: ReadonlyArray<string>;
        readonly period: ProviderPeriod | undefined;
        readonly currentWeek: number | undefined;
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_player_details");
      const cookie = yield* sessionCookie(input, "read_player_details");
      const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_player_details");
      if (input.period === undefined) {
        return yield* unsupported(
          "read_player_details",
          "This provider reports player statistics by week; no week was requested.",
        );
      }
      const week = yield* ValidWeek(input.period.week);
      const playerKeys = yield* ValidPlayerKeys(input.providerPlayerKeys, "read_player_details");
      const payload = yield* readJson(internet, {
        operation: "read_player_details",
        origin: readOrigin,
        path: `/fantasy/v2/league/${leagueKey}/players;player_keys=${playerKeys.join(",")};out=stats,ownership`,
        query: { format: "json", "stats.type": "week", "stats.week": String(week) },
        cookie,
        normalize: true,
      });
      const decoded = yield* decodePayload(PlayerDetailsPayload, payload, "read_player_details");
      const details = yield* playerDetailsFromPayload(decoded, leagueKey, week, input.currentWeek);
      yield* Effect.annotateCurrentSpan("provider.player_count", details.length);
      return details;
    });

    const searchPlayers = Effect.fn("YahooProvider.searchPlayers")(function* (
      input: ProviderPlayerSearchInput,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "search_players");
      const cookie = yield* sessionCookie(input, "search_players");
      const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "search_players");
      const limit = yield* ValidSearchLimit(input.limit);
      const query = yield* ValidSearchQuery(input.query);
      const search = query === undefined ? "" : `;search=${encodeURIComponent(query)}`;
      const status =
        input.availability === "all" ? "" : `;status=${searchStatus[input.availability]}`;
      const payload = yield* readJson(internet, {
        operation: "search_players",
        origin: readOrigin,
        path:
          `/fantasy/v2/league/${leagueKey}/players` +
          status +
          `;sort=${searchSort[input.sort]}` +
          `;count=${String(limit)}${search}` +
          ";out=ownership,percent_owned",
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const decoded = yield* decodePayload(PlayerSearchPayload, payload, "search_players");
      if (decoded.league.league_key !== leagueKey) {
        return yield* ProviderResponseInvalid.make({ operation: "search_players" });
      }
      const players = decoded.league.players.map(toSearchPlayer);
      yield* Effect.annotateCurrentSpan("provider.player_count", players.length);
      return { players };
    });

    const readMatchups = Effect.fn("YahooProvider.readMatchups")(function* (
      input: ProviderSessionMaterial & {
        readonly providerLeagueKey: string;
        readonly period: ProviderPeriod;
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_matchups");
      const cookie = yield* sessionCookie(input, "read_matchups");
      const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_matchups");
      const week = yield* ValidWeek(input.period.week);
      const payload = yield* readJson(internet, {
        operation: "read_matchups",
        origin: readOrigin,
        path: `/fantasy/v2/league/${leagueKey}/scoreboard;week=${String(week)}`,
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const decoded = yield* decodePayload(MatchupsPayload, payload, "read_matchups");
      const matchups = yield* matchupsFromPayload(decoded, leagueKey, input.period);
      yield* Effect.annotateCurrentSpan("provider.matchup_count", matchups.length);
      return matchups;
    });

    const readTransactions = Effect.fn("YahooProvider.readTransactions")(function* (
      input: ProviderSessionMaterial & {
        readonly providerLeagueKey: string;
        readonly limit: number;
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_transactions");
      const cookie = yield* sessionCookie(input, "read_transactions");
      const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_transactions");
      const limit = yield* ValidTransactionLimit(input.limit);
      const payload = yield* readJson(internet, {
        operation: "read_transactions",
        origin: readOrigin,
        path: `/fantasy/v2/league/${leagueKey}/transactions;count=${String(limit)}`,
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const decoded = yield* decodePayload(TransactionsPayload, payload, "read_transactions");
      if (decoded.league.league_key !== leagueKey) {
        return yield* ProviderResponseInvalid.make({ operation: "read_transactions" });
      }
      const transactions = yield* decodeTransactions(decoded.league.transactions);
      yield* Effect.annotateCurrentSpan("provider.transaction_count", transactions.length);
      return transactions;
    });

    const readLeagueTeams = Effect.fn("YahooProvider.readLeagueTeams")(function* (
      input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_league_teams");
      const cookie = yield* sessionCookie(input, "read_league_teams");
      const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_league_teams");
      const payload = yield* readJson(internet, {
        operation: "read_league_teams",
        origin: readOrigin,
        path: `/fantasy/v2/league/${leagueKey}/teams`,
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const decoded = yield* decodePayload(LeagueTeamsPayload, payload, "read_league_teams");
      if (decoded.league.league_key !== leagueKey) {
        return yield* ProviderResponseInvalid.make({ operation: "read_league_teams" });
      }
      return decoded.league.teams.map((team) => ({
        providerTeamKey: team.team_key,
        providerLeagueKey: leagueKey,
        name: team.name,
      }));
    });

    const buildReviewLink = Effect.fn("YahooProvider.buildReviewLink")(function* (
      input: ProviderReviewLinkInput,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "build_review_link");
      const base = yield* Effect.try({
        try: () =>
          reviewBase(input.leagueWebUrl, input.sport, leagueIdFromKey(input.providerLeagueKey)),
        catch: () => ProviderReviewLinkInvalid.make({ reason: "unsupported-league-url" }),
      });
      const url = yield* Effect.try({
        try: () => reviewUrl(base, input.intent),
        catch: () => ProviderReviewLinkInvalid.make({ reason: "unsupported-player-key" }),
      });
      if (
        url.origin !== base.origin ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== "" ||
        !url.pathname.startsWith(`${base.pathname}/`) ||
        [...url.searchParams.keys()].some((name) => name !== "apid" && name !== "dpid")
      ) {
        return yield* ProviderReviewLinkInvalid.make({ reason: "unsupported-review-surface" });
      }
      return url.href;
    });

    return ProviderGateway.of({
      validateSession,
      discoverTeams,
      readCrumb,
      readLeague,
      readRoster,
      applyNativeStartActive,
      readPlayerDetails,
      searchPlayers,
      readMatchups,
      readTransactions,
      readLeagueTeams,
      buildReviewLink,
    });
  }),
);

function sessionCookie(
  input: ProviderSessionMaterial,
  operation: ReadOperation,
): Effect.Effect<string, ProviderSessionRejected> {
  return Schema.decodeEffect(ProviderSessionMaterial)(input).pipe(
    Effect.flatMap((material) =>
      Schema.decodeEffect(SessionCookie)(Redacted.value(material.session)),
    ),
    Effect.mapError(() => ProviderSessionRejected.make({ operation })),
  );
}

type ReadRequest = {
  readonly operation: ReadOperation;
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
        return yield* ProviderRequestFailed.make({
          operation: request.operation,
          status: response.status,
        });
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
  if (
    [...url.searchParams.keys()].some(
      (key) => key !== "format" && key !== "stats.type" && key !== "stats.week",
    )
  ) {
    throw new Error("Yahoo request contains an unsupported query field");
  }
  return url;
}

function yahooWriteUrl(path: string, crumb: string): URL {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("Yahoo write path must be a relative path without query or fragment");
  }
  const url = new URL(path, writeOrigin);
  if (
    url.origin !== writeOrigin.origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== path
  ) {
    throw new Error("Yahoo write request escaped its fixed origin");
  }
  url.searchParams.set("format", "json_f");
  url.searchParams.set("crumb", crumb);
  if ([...url.searchParams.keys()].some((key) => key !== "format" && key !== "crumb")) {
    throw new Error("Yahoo write request contains an unsupported query field");
  }
  return url;
}

function ValidNativeTarget(
  target: ProviderNativeTarget,
): Effect.Effect<ProviderNativeTarget, ProviderResponseInvalid> {
  if (target.type === "week") {
    return Effect.map(ValidWeek(target.week), (week) => ({ type: "week" as const, week }));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(target.date)) {
    return Effect.fail(ProviderResponseInvalid.make({ operation: "apply_native_start_active" }));
  }
  return Effect.succeed({ type: "date" as const, date: target.date });
}

function nativeStartActiveBody(target: ProviderNativeTarget): string {
  const coverage =
    target.type === "week"
      ? `<coverage_type>week</coverage_type><week>${String(target.week)}</week>`
      : `<coverage_type>date</coverage_type><date>${target.date}</date>`;
  return `<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster>${coverage}<action>start_active_players</action></roster></fantasy_content>`;
}

function decodePayload<A, E>(
  schema: Schema.Codec<A, E>,
  payload: unknown,
  operation: ProviderOperation,
): Effect.Effect<A, ProviderResponseInvalid> {
  return Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.mapError((error) =>
      ProviderResponseInvalid.make({ operation, field: invalidField(error.issue) }),
    ),
  );
}

function invalidField(issue: SchemaIssue.Issue): string | undefined {
  const path = issuePath(issue);
  return path.length === 0 ? undefined : path.map(String).join(".");
}

function issuePath(root: SchemaIssue.Issue): ReadonlyArray<PropertyKey> {
  const path: Array<PropertyKey> = [];
  const pending: Array<SchemaIssue.Issue> = [root];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    switch (current._tag) {
      case "Pointer":
        for (const segment of current.path) {
          path.push(segment);
        }
        pending.push(current.issue);
        break;
      case "Filter":
      case "Encoding":
        pending.push(current.issue);
        break;
      case "Composite":
      case "AnyOf": {
        const first = current.issues.at(0);
        if (first !== undefined) {
          pending.push(first);
        }
        break;
      }
      case "Forbidden":
      case "InvalidType":
      case "InvalidValue":
      case "MissingKey":
      case "OneOf":
      case "UnexpectedKey":
        break;
    }
  }
  return path;
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

function leagueSettings(
  payload: typeof LeaguePayload.Type,
  requestedLeagueKey: string,
  sport: "football" | "hockey",
): Effect.Effect<ProviderLeagueSettings, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    const attributes = payload.league;
    const settings = singleEntry(attributes.settings);
    if (settings === undefined || attributes.league_key !== requestedLeagueKey) {
      return yield* ProviderResponseInvalid.make({
        operation: "read_league",
        field: "league.league_key",
      });
    }
    const periodWindow = yield* weekWindow(attributes);
    const webUrl = yield* Effect.try({
      try: () => reviewBase(attributes.url, sport, leagueIdFromKey(attributes.league_key)).href,
      catch: () => ProviderResponseInvalid.make({ operation: "read_league", field: "league.url" }),
    });
    return {
      providerLeagueKey: attributes.league_key,
      name: attributes.name,
      webUrl,
      season: attributes.season,
      startDate: optionalNonEmpty(attributes.start_date),
      endDate: optionalNonEmpty(attributes.end_date),
      teamCount: attributes.num_teams,
      scoringType: attributes.scoring_type,
      scoringLabel: optionalNonEmpty(attributes.scoring_label),
      weeklyDeadline: optionalNonEmpty(attributes.weekly_deadline),
      waiverType: optionalNonEmpty(settings.waiver_type),
      waiverRule: optionalNonEmpty(settings.waiver_rule),
      usesFaab: settings.uses_faab,
      draftStatus: optionalNonEmpty(attributes.draft_status),
      periodWindow,
      rosterPositions: settings.roster_positions.map(({ roster_position }) => ({
        position: roster_position.position,
        positionType: optionalNonEmpty(roster_position.position_type),
        count: roster_position.count,
        isStarting: roster_position.is_starting_position,
      })),
      statCategories: settings.stat_categories.stats.map(({ stat }) => ({
        statId: stat.stat_id,
        name: stat.name,
        displayName: stat.display_name,
        abbreviation: stat.abbr,
        group: stat.group,
        enabled: stat.enabled,
        positionTypes: (stat.stat_position_types ?? []).flatMap(({ stat_position_type }) =>
          stat_position_type.position_type === undefined ? [] : [stat_position_type.position_type],
        ),
      })),
      statModifiers: (settings.stat_modifiers?.stats ?? []).map(({ stat }) => ({
        statId: stat.stat_id,
        points: String(stat.value),
      })),
    };
  });
}

function weekWindow(
  attributes: (typeof LeaguePayload.Type)["league"],
): Effect.Effect<ProviderPeriodWindow | undefined, ProviderResponseInvalid> {
  const currentWeek = attributes.current_week;
  const startWeek = attributes.start_week;
  const endWeek = attributes.end_week;
  if (currentWeek !== undefined && startWeek !== undefined && endWeek !== undefined) {
    return Effect.succeed({ currentWeek, startWeek, endWeek });
  }
  if (currentWeek === undefined && startWeek === undefined && endWeek === undefined) {
    return Effect.as(Effect.void, undefined);
  }
  return ProviderResponseInvalid.make({
    operation: "read_league",
    field:
      currentWeek === undefined
        ? "league.current_week"
        : startWeek === undefined
          ? "league.start_week"
          : "league.end_week",
  });
}

function rosterFromPayload(
  payload: typeof TeamRosterPayload.Type,
  requestedTeamKey: string,
  requestedPeriod: ProviderPeriod | undefined,
): Effect.Effect<ProviderRoster, ProviderResponseInvalid | ProviderPeriodMismatch> {
  return Effect.gen(function* () {
    const roster = payload.team.roster;
    const entries = isReadonlyArray(roster)
      ? roster
      : "entries" in roster
        ? roster.entries
        : [roster];
    const players = entries.flatMap((entry) => entry.players);
    if (players.length === 0) {
      return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
    }
    const declaredType = isReadonlyArray(roster) ? undefined : roster.coverage_type;
    const declaredWeek = isReadonlyArray(roster) ? undefined : roster.week;
    const declaredDate = isReadonlyArray(roster) ? undefined : roster.date;
    const coverageTypes = new Set(players.map((player) => player.selected_position.coverage_type));
    if (coverageTypes.size !== 1) {
      return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
    }
    const coverageType = [...coverageTypes][0];
    if (coverageType === undefined) {
      return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
    }
    if (declaredType !== undefined && declaredType !== coverageType) {
      return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
    }
    const leagueKey = providerLeagueKey(requestedTeamKey);
    if (coverageType === "week") {
      const weeks = new Set(
        players.flatMap((player) =>
          player.selected_position.week === undefined ? [] : [player.selected_position.week],
        ),
      );
      if (weeks.size > 1) {
        return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
      }
      const playerWeek = [...weeks][0];
      if (declaredWeek !== undefined && playerWeek !== undefined && declaredWeek !== playerWeek) {
        return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
      }
      const week = declaredWeek ?? playerWeek;
      if (week === undefined) {
        return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
      }
      if (requestedPeriod !== undefined && requestedPeriod.week !== week) {
        return yield* ProviderPeriodMismatch.make({
          operation: "read_roster",
          requestedWeek: requestedPeriod.week,
          coveredWeek: week,
        });
      }
      return {
        providerTeamKey: requestedTeamKey,
        providerLeagueKey: leagueKey,
        coverage: { type: "week" as const, week },
        players: players.map(toRosterPlayer),
      };
    }
    if (coverageType === "date") {
      if (requestedPeriod !== undefined) {
        return yield* ProviderPeriodMismatch.make({
          operation: "read_roster",
          requestedWeek: requestedPeriod.week,
          coveredWeek: null,
        });
      }
      const dates = new Set(
        players.flatMap((player) =>
          player.selected_position.date === undefined ? [] : [player.selected_position.date],
        ),
      );
      if (dates.size > 1) {
        return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
      }
      const playerDate = [...dates][0];
      if (declaredDate !== undefined && playerDate !== undefined && declaredDate !== playerDate) {
        return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
      }
      const date = declaredDate ?? playerDate;
      if (date === undefined) {
        return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
      }
      return {
        providerTeamKey: requestedTeamKey,
        providerLeagueKey: leagueKey,
        coverage: { type: "date" as const, date },
        players: players.map(toRosterPlayer),
      };
    }
    return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
  });
}

function toRosterPlayer(player: typeof RosterPlayerPayload.Type): ProviderRosterPlayer {
  return {
    providerPlayerKey: player.player_key,
    name: player.name.full,
    displayPosition: player.display_position,
    primaryPosition: player.primary_position,
    positionType: optionalNonEmpty(player.position_type),
    eligiblePositions: (player.eligible_positions ?? []).map(({ position }) => position),
    slot: player.selected_position.position,
    isFlex: player.selected_position.is_flex ?? null,
    isEditable: player.is_editable ?? null,
    injuryCode: optionalNonEmpty(player.status),
    injuryDetail: optionalNonEmpty(player.injury_note) ?? optionalNonEmpty(player.status_full),
    byeWeek: player.bye_weeks?.week ?? null,
    undroppable: player.is_undroppable ?? null,
  };
}

function playerDetailsFromPayload(
  payload: typeof PlayerDetailsPayload.Type,
  requestedLeagueKey: string,
  requestedWeek: number,
  currentWeek: number | undefined,
): Effect.Effect<
  ReadonlyArray<ProviderPlayerDetail>,
  ProviderResponseInvalid | ProviderPeriodMismatch
> {
  return Effect.gen(function* () {
    if (payload.league.league_key !== requestedLeagueKey) {
      return yield* ProviderResponseInvalid.make({ operation: "read_player_details" });
    }
    const completed = currentWeek !== undefined && requestedWeek < currentWeek;
    const details: ProviderPlayerDetail[] = [];
    for (const player of payload.league.players) {
      const series =
        player.player_stats === undefined
          ? undefined
          : yield* statSeries(player.player_stats, requestedWeek);
      details.push({
        providerPlayerKey: player.player_key,
        name: optionalNonEmpty(player.name?.full ?? ""),
        primaryPosition: optionalNonEmpty(player.primary_position ?? ""),
        displayPosition: optionalNonEmpty(player.display_position ?? ""),
        eligiblePositions:
          player.eligible_positions === undefined
            ? undefined
            : player.eligible_positions.map(({ position }) => position),
        rosterStatus: rosterStatusOf(player.ownership?.ownership_type),
        actual:
          completed && series !== undefined
            ? { period: { week: requestedWeek }, stats: series }
            : undefined,
        projected: undefined,
      });
    }
    return details;
  });
}

function statSeries(
  stats: typeof PlayerStats.Type,
  requestedWeek: number,
): Effect.Effect<
  ReadonlyArray<{ readonly statId: number; readonly value: number | null }>,
  ProviderResponseInvalid | ProviderPeriodMismatch
> {
  return Effect.gen(function* () {
    const coverage = stats.entries[0];
    if (
      stats.entries.length !== 1 ||
      coverage === undefined ||
      coverage.coverage_type !== "week" ||
      coverage.week === undefined
    ) {
      return yield* ProviderResponseInvalid.make({ operation: "read_player_details" });
    }
    if (coverage.week !== requestedWeek) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_player_details",
        requestedWeek,
        coveredWeek: coverage.week,
      });
    }
    return stats.stats.map(({ stat }) => ({
      statId: stat.stat_id,
      value: providerNumber(stat.value),
    }));
  });
}

function toSearchPlayer(
  player: typeof SearchPlayerPayload.Type,
): ProviderPlayerSearchResult["players"][number] {
  return {
    providerPlayerKey: player.player_key,
    name: player.name.full,
    primaryPosition: player.primary_position,
    displayPosition: player.display_position,
    eligiblePositions: (player.eligible_positions ?? []).map(({ position }) => position),
    availability: availabilityOf(player.ownership?.ownership_type),
    percentOwned:
      player.percent_owned === undefined ? null : providerNumber(player.percent_owned.value),
  };
}

function matchupsFromPayload(
  payload: typeof MatchupsPayload.Type,
  requestedLeagueKey: string,
  period: ProviderPeriod,
): Effect.Effect<ReadonlyArray<ProviderMatchup>, ProviderResponseInvalid | ProviderPeriodMismatch> {
  return Effect.gen(function* () {
    const scoreboard = payload.league.scoreboard;
    if (payload.league.league_key !== requestedLeagueKey) {
      return yield* ProviderResponseInvalid.make({ operation: "read_matchups" });
    }
    if (scoreboard.week !== period.week) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_matchups",
        requestedWeek: period.week,
        coveredWeek: scoreboard.week,
      });
    }
    const matchups: ProviderMatchup[] = [];
    for (const group of scoreboard.entries) {
      for (const matchup of group.matchups) {
        if (matchup.week !== period.week) {
          return yield* ProviderPeriodMismatch.make({
            operation: "read_matchups",
            requestedWeek: period.week,
            coveredWeek: matchup.week,
          });
        }
        const teams = matchup.entries.flatMap((entry) => entry.teams);
        if (teams.length !== 2) {
          return yield* ProviderResponseInvalid.make({ operation: "read_matchups" });
        }
        const [home, away] = teams;
        if (home === undefined || away === undefined) {
          return yield* ProviderResponseInvalid.make({ operation: "read_matchups" });
        }
        const homeScore = yield* teamScore(home, period);
        const awayScore = yield* teamScore(away, period);
        matchups.push({
          period,
          home: homeScore,
          away: awayScore,
          status: optionalNonEmpty(matchup.status ?? ""),
        });
      }
    }
    return matchups;
  });
}

function teamScore(
  team: typeof ScoreboardTeamPayload.Type,
  period: ProviderPeriod,
): Effect.Effect<ProviderTeamScore, ProviderResponseInvalid | ProviderPeriodMismatch> {
  return Effect.gen(function* () {
    const points = team.team_points;
    if (points?.week !== undefined && points.week !== period.week) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_matchups",
        requestedWeek: period.week,
        coveredWeek: points.week,
      });
    }
    return {
      providerTeamKey: team.team_key,
      name: team.name,
      points: points === undefined ? null : providerNumber(points.total),
    };
  });
}

function decodeTransactions(
  transactions: ReadonlyArray<typeof TransactionPayload.Type>,
): Effect.Effect<ReadonlyArray<ProviderTransaction>, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    const decoded: ProviderTransaction[] = [];
    for (const transaction of transactions) {
      const occurredAt = yield* providerInstant(transaction.timestamp);
      const players = transaction.players ?? [];
      const teams = new Map<string, ProviderTransaction["teams"][number]>();
      for (const player of players) {
        const data = player.transaction_data;
        if (data.source_team_key !== undefined && data.source_team_name !== undefined) {
          teams.set(data.source_team_key, {
            providerTeamKey: data.source_team_key,
            name: data.source_team_name,
          });
        }
        if (data.destination_team_key !== undefined && data.destination_team_name !== undefined) {
          teams.set(data.destination_team_key, {
            providerTeamKey: data.destination_team_key,
            name: data.destination_team_name,
          });
        }
      }
      decoded.push({
        occurredAt,
        type: transactionType(transaction.type),
        status: optionalNonEmpty(transaction.status ?? ""),
        teams: [...teams.values()],
        players: players.map((player) => ({
          providerPlayerKey: player.player_key,
          direction: playerDirection(player.transaction_data),
        })),
      });
    }
    return decoded;
  });
}

function transactionType(type: string): ProviderTransaction["type"] {
  switch (type) {
    case "add":
      return "add";
    case "drop":
      return "drop";
    case "add/drop":
      return "add_drop";
    case "trade":
      return "trade";
    default:
      return type.startsWith("commish") ? "commissioner" : "other";
  }
}

function playerDirection(
  data: (typeof TransactionPlayerPayload.Type)["transaction_data"],
): ProviderTransaction["players"][number]["direction"] {
  switch (data.type) {
    case "add":
      return "add";
    case "drop":
      return "drop";
    default:
      return data.destination_team_key === undefined ? "outgoing" : "incoming";
  }
}

function rosterStatusOf(ownershipType: string | undefined): ProviderPlayerDetail["rosterStatus"] {
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

function availabilityOf(
  ownershipType: string | undefined,
): "rostered" | "free_agent" | "waiver" | "unknown" {
  return rosterStatusOf(ownershipType);
}

function providerNumber(value: number | string | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value === undefined || value.trim() === "" || value.trim() === "-") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function providerInstant(timestamp: number): Effect.Effect<string, ProviderResponseInvalid> {
  return Option.match(DateTime.make(timestamp * 1_000), {
    onNone: () => ProviderResponseInvalid.make({ operation: "read_transactions" }),
    onSome: (instant) => Effect.succeed(DateTime.formatIso(instant)),
  });
}

function singleEntry<A>(value: ReadonlyArray<A> | A): A | undefined {
  return isReadonlyArray(value) ? value[0] : value;
}

function isReadonlyArray<A>(value: ReadonlyArray<A> | A): value is ReadonlyArray<A> {
  return Array.isArray(value);
}

function reviewUrl(base: URL, intent: ProviderReviewLinkInput["intent"]): URL {
  const target = new URL(intent.kind === "trade" ? "trade" : "add", withTrailingSlash(base));
  const append = (name: "apid" | "dpid", key: string): void => {
    target.searchParams.append(name, numericPlayerId(key));
  };
  switch (intent.kind) {
    case "add":
      append("apid", intent.add);
      break;
    case "add_drop":
      append("apid", intent.add);
      append("dpid", intent.drop);
      break;
    case "drop":
      append("dpid", intent.drop);
      break;
    case "trade":
      for (const key of intent.send) {
        append("apid", key);
      }
      for (const key of intent.receive) {
        append("dpid", key);
      }
      break;
  }
  return target;
}

function reviewBase(url: string, sport: "football" | "hockey", leagueId: string): URL {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== reviewHosts[sport] ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("Yahoo review base escaped its fixed host");
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
  if (
    segments.length !== 2 ||
    segments[1] !== leagueId ||
    !/^[a-z0-9]{1,8}$/u.test(segments[0] ?? "")
  ) {
    throw new Error("Yahoo review base escaped its league page");
  }
  return parsed;
}

function withTrailingSlash(url: URL): URL {
  const copy = new URL(url.href);
  if (!copy.pathname.endsWith("/")) {
    copy.pathname = `${copy.pathname}/`;
  }
  return copy;
}

function numericPlayerId(playerKey: string): string {
  const match = /^[0-9]+\.p\.([0-9]+)$/u.exec(playerKey);
  if (match?.[1] === undefined) {
    throw new Error("Yahoo player key is not numeric");
  }
  return match[1];
}

function leagueIdFromKey(leagueKey: string): string {
  const match = /^[0-9]+\.l\.([0-9]+)$/u.exec(leagueKey);
  if (match?.[1] === undefined) {
    throw new Error("Yahoo league key is not numeric");
  }
  return match[1];
}

function ValidLeagueKey(
  value: string,
  operation: ProviderOperation,
): Effect.Effect<string, ProviderResponseInvalid> {
  return /^[0-9]+\.l\.[0-9]+$/u.test(value)
    ? Effect.succeed(value)
    : ProviderResponseInvalid.make({ operation });
}

function ValidTeamKey(
  value: string,
  operation: ProviderOperation,
): Effect.Effect<string, ProviderResponseInvalid> {
  return /^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u.test(value)
    ? Effect.succeed(value)
    : ProviderResponseInvalid.make({ operation });
}

function ValidPlayerKeys(
  value: ReadonlyArray<string>,
  operation: ProviderOperation,
): Effect.Effect<ReadonlyArray<string>, ProviderResponseInvalid> {
  if (
    value.length === 0 ||
    value.length > maximumSelectedPlayers ||
    !value.every((key) => /^[0-9]+\.p\.[0-9]+$/u.test(key))
  ) {
    return ProviderResponseInvalid.make({ operation });
  }
  return Effect.succeed(value);
}

function ValidLimit(
  value: number,
  operation: ProviderOperation,
): Effect.Effect<number, ProviderResponseInvalid> {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximumUpstreamLimit
    ? Effect.succeed(value)
    : ProviderResponseInvalid.make({ operation });
}

function ValidSearchLimit(value: number): Effect.Effect<number, ProviderResponseInvalid> {
  return ValidLimit(value, "search_players");
}

function ValidTransactionLimit(value: number): Effect.Effect<number, ProviderResponseInvalid> {
  return ValidLimit(value, "read_transactions");
}

function ValidSearchQuery(
  value: string | undefined,
): Effect.Effect<string | undefined, ProviderResponseInvalid> {
  if (value === undefined) {
    return Effect.as(Effect.void, undefined);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > 80
    ? ProviderResponseInvalid.make({ operation: "search_players" })
    : Effect.succeed(trimmed);
}

function ValidWeek(value: number): Effect.Effect<number, ProviderResponseInvalid> {
  return Number.isSafeInteger(value) && value >= 1
    ? Effect.succeed(value)
    : ProviderResponseInvalid.make({ operation: "read_roster" });
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
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

const IntFromStringOrNumber: Schema.Codec<number, number | string> = Schema.Union([
  Schema.Finite,
  Schema.String,
]).pipe(
  Schema.decodeTo(
    Schema.Int,
    SchemaTransformation.transform({
      decode: (value) => (typeof value === "number" ? value : Number(value)),
      encode: (value) => value,
    }),
  ),
);

const Flag: Schema.Codec<boolean, boolean | number | string> = Schema.Union([
  Schema.Boolean,
  Schema.Finite,
  Schema.String,
]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) =>
        typeof value === "boolean"
          ? value
          : typeof value === "number"
            ? value !== 0
            : value === "1",
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

const LeagueAttributes = Schema.Struct({
  league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
  name: Schema.NonEmptyString,
  url: Schema.String,
  num_teams: IntFromStringOrNumber,
  current_week: Schema.optional(IntFromStringOrNumber),
  start_week: Schema.optional(IntFromStringOrNumber),
  end_week: Schema.optional(IntFromStringOrNumber),
  start_date: Schema.optional(Schema.String),
  end_date: Schema.optional(Schema.String),
  scoring_type: Schema.NonEmptyString,
  scoring_label: Schema.optional(Schema.String),
  weekly_deadline: Schema.optional(Schema.String),
  season: Season,
  draft_status: Schema.optional(Schema.String),
});

const RosterPositionAttributes = Schema.Struct({
  position: Schema.NonEmptyString,
  position_type: Schema.optional(Schema.String),
  count: IntFromStringOrNumber,
  is_starting_position: Flag,
});

const StatPositionTypeAttributes = Schema.Struct({
  stat_position_type: Schema.Struct({
    position_type: Schema.optional(Schema.String),
  }),
});
const StatCategoryAttributes = Schema.Struct({
  stat_id: IntFromStringOrNumber,
  name: Schema.NonEmptyString,
  display_name: Schema.NonEmptyString,
  group: Schema.NonEmptyString,
  abbr: Schema.NonEmptyString,
  enabled: Flag,
  stat_position_types: Schema.optional(Schema.Array(StatPositionTypeAttributes)),
});

const StatModifierAttributes = Schema.Struct({
  stat_id: IntFromStringOrNumber,
  value: Schema.Union([Schema.String, Schema.Finite]),
});

const LeagueSettingsAttributes = Schema.Struct({
  roster_type: Schema.optional(Schema.String),
  waiver_type: Schema.optional(Schema.String),
  waiver_rule: Schema.optional(Schema.String),
  uses_faab: Schema.optional(Flag),
  roster_positions: Schema.Array(
    Schema.Struct({
      roster_position: RosterPositionAttributes,
    }),
  ),
  stat_categories: Schema.Struct({
    stats: Schema.Array(Schema.Struct({ stat: StatCategoryAttributes })),
  }),
  stat_modifiers: Schema.optional(
    Schema.Struct({
      stats: Schema.Array(Schema.Struct({ stat: StatModifierAttributes })),
    }),
  ),
});

const LeaguePayload = Schema.Struct({
  league: Schema.Struct({
    ...LeagueAttributes.fields,
    settings: Schema.Union([Schema.Array(LeagueSettingsAttributes), LeagueSettingsAttributes]),
  }),
});

const RosterPlayerPayload = Schema.Struct({
  player_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.p\.[0-9]+$/u))),
  name: Schema.Struct({ full: Schema.NonEmptyString }),
  display_position: Schema.NonEmptyString,
  primary_position: Schema.NonEmptyString,
  position_type: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  selected_position: Schema.Struct({
    coverage_type: Schema.NonEmptyString,
    week: Schema.optional(IntFromStringOrNumber),
    date: Schema.optional(Schema.String),
    position: Schema.NonEmptyString,
    is_flex: Schema.optional(Flag),
  }),
  is_editable: Schema.optional(Flag),
  status: Schema.optional(Schema.String),
  status_full: Schema.optional(Schema.String),
  injury_note: Schema.optional(Schema.String),
  bye_weeks: Schema.optional(Schema.Struct({ week: IntFromStringOrNumber })),
  is_undroppable: Schema.optional(Flag),
});

const RosterCoverage = Schema.Struct({
  coverage_type: Schema.optional(Schema.NonEmptyString),
  week: Schema.optional(IntFromStringOrNumber),
  date: Schema.optional(Schema.String),
});

const RosterEntry = Schema.Struct({
  ...RosterCoverage.fields,
  players: Schema.Array(RosterPlayerPayload),
});

const TeamRosterPayload = Schema.Struct({
  team: Schema.Struct({
    roster: Schema.Union([
      Schema.Array(RosterEntry),
      Schema.Struct({ ...RosterCoverage.fields, entries: Schema.Array(RosterEntry) }),
      RosterEntry,
    ]),
  }),
});

const LeagueKey = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u)));
const TeamKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u)),
);
const PlayerKey = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.p\.[0-9]+$/u)));

const PlayerOwnership = Schema.Struct({
  ownership_type: Schema.optional(Schema.String),
});

const PercentOwned = Schema.Struct({
  value: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
});

const StatEntry = Schema.Struct({
  stat: Schema.Struct({
    stat_id: IntFromStringOrNumber,
    value: Schema.Union([Schema.Finite, Schema.String]),
  }),
});

const StatCoverageEntry = Schema.Struct({
  coverage_type: Schema.NonEmptyString,
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
});

const PlayerStats = Schema.Struct({
  stats: Schema.Array(StatEntry),
  entries: Schema.Array(StatCoverageEntry),
});

const PlayerDetailPayload = Schema.Struct({
  player_key: PlayerKey,
  name: Schema.optional(Schema.Struct({ full: Schema.optional(Schema.String) })),
  primary_position: Schema.optional(Schema.String),
  display_position: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  ownership: Schema.optional(PlayerOwnership),
  percent_owned: Schema.optional(PercentOwned),
  player_stats: Schema.optional(PlayerStats),
});

const PlayerDetailsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    players: Schema.Array(PlayerDetailPayload),
  }),
});

const SearchPlayerPayload = Schema.Struct({
  player_key: PlayerKey,
  name: Schema.Struct({ full: Schema.NonEmptyString }),
  primary_position: Schema.NonEmptyString,
  display_position: Schema.NonEmptyString,
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  ownership: Schema.optional(PlayerOwnership),
  percent_owned: Schema.optional(PercentOwned),
});

const PlayerSearchPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    players: Schema.Array(SearchPlayerPayload),
  }),
});

const ScoreboardTeamPayload = Schema.Struct({
  team_key: TeamKey,
  name: Schema.NonEmptyString,
  team_points: Schema.optional(
    Schema.Struct({
      coverage_type: Schema.optional(Schema.String),
      week: Schema.optional(IntFromStringOrNumber),
      total: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
    }),
  ),
});

const MatchupPayload = Schema.Struct({
  week: IntFromStringOrNumber,
  status: Schema.optional(Schema.String),
  entries: Schema.Array(Schema.Struct({ teams: Schema.Array(ScoreboardTeamPayload) })),
});

const MatchupsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    scoreboard: Schema.Struct({
      week: IntFromStringOrNumber,
      entries: Schema.Array(Schema.Struct({ matchups: Schema.Array(MatchupPayload) })),
    }),
  }),
});

const TransactionPlayerPayload = Schema.Struct({
  player_key: PlayerKey,
  transaction_data: Schema.Struct({
    type: Schema.NonEmptyString,
    source_type: Schema.optional(Schema.String),
    source_team_key: Schema.optional(TeamKey),
    source_team_name: Schema.optional(Schema.String),
    destination_type: Schema.optional(Schema.String),
    destination_team_key: Schema.optional(TeamKey),
    destination_team_name: Schema.optional(Schema.String),
  }),
});

const TransactionPayload = Schema.Struct({
  type: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  timestamp: IntFromStringOrNumber,
  players: Schema.optional(Schema.Array(TransactionPlayerPayload)),
});

const TransactionsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    transactions: Schema.Array(TransactionPayload),
  }),
});

const LeagueTeamsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    teams: Schema.Array(TeamPayload),
  }),
});
