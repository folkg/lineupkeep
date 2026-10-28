import {
  DateTime,
  Effect,
  Option,
  Redacted,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from "effect";

import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import type {
  PlayerRank,
  RankType,
} from "#contexts/connections/internal/provider-scoring/types.ts";
import { communityStartRateCut } from "#contexts/connections/internal/provider-scoring/ValueSource.ts";
import {
  ProviderPeriodMismatch,
  ProviderOperationUnsupported,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderReviewLinkInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderCategoryWinner,
  ProviderGamesPlayed,
  ProviderLeagueSettings,
  ProviderLineupAssignment,
  ProviderStatBasis,
  ProviderMatchup,
  ProviderNativeTarget,
  ProviderOperation,
  ProviderScoringWeek,
  ProviderCoverageKind,
  ProviderPeriodWindow,
  ProviderScoreRequest,
  ProviderPlayerDetail,
  ProviderPlayerPeriod,
  ProviderPlayerSearchInput,
  ProviderPlayerSearchResult,
  ProviderPlayerSearchSort,
  ProviderRemainingGames,
  ProviderRoster,
  ProviderRosterCoverage,
  ProviderRosterPlayer,
  ProviderReviewIntent,
  ProviderReviewLinkInput,
  ProviderStanding,
  ProviderStandings,
  ProviderStatValue,
  ProviderTeam,
  ProviderTeamScore,
  ProviderTransaction,
  ProviderShape,
  ProviderWriteResult,
} from "#contexts/connections/Provider.ts";
import type { ProviderKey } from "#contexts/connections/ProviderKey.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { normalizeYahooJson } from "./YahooJson.ts";
import {
  yahooReadDeadlineMillis,
  yahooReadResponseLimitBytes,
  yahooWriteDeadlineMillis,
  yahooWriteResponseLimitBytes,
} from "./YahooLimits.ts";
import { scoreYahooRoster, yahooCapabilities } from "./YahooLineup.ts";
import type { YahooPlayerFacts, YahooStartRateCut, YahooStartRateSummary } from "./YahooLineup.ts";

const readOrigin = new URL("https://pub-api-ro.fantasysports.yahoo.com");
const serviceOrigin = new URL("https://pub-api.fantasysports.yahoo.com");
const writeOrigin = new URL("https://pub-api-rw.fantasysports.yahoo.com");
const supportedLeagues = ["nfl", "nhl"] as const;
const leagueSport = {
  nfl: "football",
  nhl: "hockey",
} as const;
const reviewHosts: Readonly<Record<FantasySport, string>> = {
  basketball: "basketball.fantasysports.yahoo.com",
  baseball: "baseball.fantasysports.yahoo.com",
  football: "football.fantasysports.yahoo.com",
  hockey: "hockey.fantasysports.yahoo.com",
};
const reviewLinkTemplate = { version: "yahoo-review-links-v2" } as const;
const reviewPaths = {
  add: "addplayer",
  drop: "dropplayer",
} as const;
const searchStatus = {
  free_agent: "FA",
  waiver: "W",
} as const;
const searchSort = {
  name: "NAME",
  position: "NAME",
  ownership: "R_PO",
  actual_rank: "AR",
  overall_rank: "OR",
} as const satisfies Record<Exclude<ProviderPlayerSearchSort, "stat">, string>;

function searchSortValue(sort: ProviderPlayerSearchSort, statId: number | undefined): string {
  return sort === "stat" ? String(statId) : searchSort[sort];
}
const rankedSearchSorts = new Set<ProviderPlayerSearchInput["sort"]>([
  "actual_rank",
  "overall_rank",
  "stat",
]);
const maximumSelectedPlayers = 25;
const maximumHistoryPlayers = 200;
const maximumUpstreamLimit = 50;

type ReadOperation = ProviderOperation;
type WriteOperation = "apply_native_action" | "apply_explicit_assignments";

export const yahooProvider = Effect.gen(function* () {
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
      for (const team of yield* teamsFromPayload(decoded, league)) {
        teams.push(team);
      }
    }
    yield* Effect.annotateCurrentSpan("provider.team_count", teams.length);
    return teams;
  });

  const readCrumb = Effect.fn("YahooProvider.readCrumb")(function* (
    input: ProviderSessionMaterial,
    operation: WriteOperation,
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", operation);
    yield* Effect.annotateCurrentSpan("provider.write_step", "write_token");
    const cookie = yield* sessionCookie(input, operation);
    const payload = yield* readJson(internet, {
      operation,
      origin: serviceOrigin,
      path: "/fantasy/v3/getCrumb",
      query: { format: "json_f" },
      cookie,
      normalize: false,
    });
    const decoded = yield* decodePayload(CrumbPayload, payload, operation);
    const crumb = decoded.service.crumb?.trim();
    if (crumb === undefined || crumb.length === 0) {
      return yield* YahooCrumbUnavailable.make({ operation });
    }
    return { crumb: Redacted.make(crumb) };
  });

  const readLeague = Effect.fn("YahooProvider.readLeague")(function* (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly sport: FantasySport;
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

  const readStandings = Effect.fn("YahooProvider.readStandings")(function* (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_standings");
    const cookie = yield* sessionCookie(input, "read_standings");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_standings");
    const payload = yield* readJson(internet, {
      operation: "read_standings",
      origin: readOrigin,
      path: `/fantasy/v2/league/${leagueKey}/standings`,
      query: { format: "json" },
      cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(StandingsPayload, payload, "read_standings");
    const standings = yield* standingsFromPayload(decoded, leagueKey);
    yield* Effect.annotateCurrentSpan("provider.standing_count", standings.teams.length);
    return standings;
  });

  const readRoster = Effect.fn("YahooProvider.readRoster")(function* (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly period: ProviderRosterCoverage | undefined;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_roster");
    const cookie = yield* sessionCookie(input, "read_roster");
    const teamKey = yield* ValidTeamKey(input.providerTeamKey, "read_roster");
    const week = input.period?.type === "week" ? yield* ValidWeek(input.period.week) : undefined;
    const periodSuffix = week === undefined ? "" : `;week=${String(week)}`;
    const payload = yield* readJson(internet, {
      operation: "read_roster",
      origin: readOrigin,
      path: `/fantasy/v2/team/${teamKey}/roster${periodSuffix}/players;out=opponent,starting_status`,
      query: { format: "json" },
      cookie,
      normalize: true,
    }).pipe(
      Effect.catchTag("provider.request_failed", (error) =>
        Effect.fail(
          error.status === 400 && week !== undefined
            ? ProviderPeriodMismatch.make({
                operation: "read_roster",
                requested: { type: "week", week },
                covered: null,
              })
            : error,
        ),
      ),
    );
    const decoded = yield* decodePayload(TeamRosterPayload, payload, "read_roster");
    const roster = yield* rosterFromPayload(decoded, input.providerTeamKey, input.period);
    yield* Effect.annotateCurrentSpan("provider.player_count", roster.players.length);
    return roster;
  });

  const applyNativeAction: (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly target: ProviderNativeTarget;
    },
  ) => Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid> =
    Effect.fn("YahooProvider.applyNativeAction")(function* (
      input: ProviderSessionMaterial & {
        readonly providerTeamKey: string;
        readonly target: ProviderNativeTarget;
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "apply_native_action");
      const target = yield* ValidNativeTarget(input.target, "apply_native_action");
      yield* Effect.annotateCurrentSpan("provider.native_action", "start_active_players");
      return yield* writeRoster(input, "apply_native_action", nativeStartActiveBody(target));
    });

  const applyExplicitAssignments: (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly target: ProviderNativeTarget;
      readonly assignments: ReadonlyArray<ProviderLineupAssignment>;
    },
  ) => Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid> =
    Effect.fn("YahooProvider.applyExplicitAssignments")(function* (
      input: ProviderSessionMaterial & {
        readonly providerTeamKey: string;
        readonly target: ProviderNativeTarget;
        readonly assignments: ReadonlyArray<ProviderLineupAssignment>;
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "apply_explicit_assignments");
      const target = yield* ValidNativeTarget(input.target, "apply_explicit_assignments");
      const assignments = yield* ValidAssignments(input.assignments);
      yield* Effect.annotateCurrentSpan("provider.assignment_count", assignments.length);
      return yield* writeRoster(
        input,
        "apply_explicit_assignments",
        explicitAssignmentsBody(target, assignments),
      );
    });

  const writeRoster = (
    input: ProviderSessionMaterial & { readonly providerTeamKey: string },
    operation: WriteOperation,
    body: string,
  ): Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid> =>
    Effect.gen(function* () {
      const cookie = yield* sessionCookie(input, operation);
      const teamKey = yield* ValidTeamKey(input.providerTeamKey, operation);
      const crumb = yield* Effect.result(readCrumb(input, operation));
      if (crumb._tag === "Failure") {
        if (crumb.failure._tag === "provider.session_rejected") {
          return yield* crumb.failure;
        }
        return crumb.failure._tag === "provider.crumb_unavailable"
          ? { status: "not_sent" as const, reason: "session_incomplete" as const }
          : { status: "not_sent" as const, reason: "request_failed" as const };
      }
      const url = yahooWriteUrl(
        `/fantasy/v2/team/${teamKey}/roster`,
        Redacted.value(crumb.success.crumb),
      );
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
      if (response === undefined) {
        return { status: "unknown" as const };
      }
      yield* Effect.annotateCurrentSpan("http.response.status_code", response);
      if (response === 401 || response === 403) {
        return yield* ProviderSessionRejected.make({ operation });
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

  const readPlayerPeriod = Effect.fnUntraced(function* (input: {
    readonly cookie: string;
    readonly leagueKey: string;
    readonly playerKeys: ReadonlyArray<string>;
    readonly basis: ProviderStatBasis;
    readonly operation: "read_player_details" | "read_player_history";
  }) {
    const payload = yield* readJson(internet, {
      operation: input.operation,
      origin: readOrigin,
      path: `/fantasy/v2/league/${input.leagueKey}/players;player_keys=${input.playerKeys.join(",")};out=stats,ownership`,
      query: playerDetailQuery(input.basis),
      cookie: input.cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(PlayerDetailsPayload, payload, input.operation);
    return yield* playerDetailsFromPayload(decoded, input.leagueKey, input.basis);
  });

  const readPlayerDetails = Effect.fn("YahooProvider.readPlayerDetails")(function* (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerPlayerKeys: ReadonlyArray<string>;
      readonly sport: FantasySport;
      readonly period: ProviderScoringWeek | undefined;
      readonly currentPeriod: number | undefined;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_player_details");
    const cookie = yield* sessionCookie(input, "read_player_details");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_player_details");
    const period =
      input.period === undefined ? undefined : { week: yield* ValidWeek(input.period.week) };
    const playerKeys = yield* ValidPlayerKeys(input.providerPlayerKeys, "read_player_details");
    const basis = statBasis(input.sport, period, input.currentPeriod);
    const details = yield* readPlayerPeriod({
      cookie,
      leagueKey,
      playerKeys,
      basis,
      operation: "read_player_details",
    });
    yield* Effect.annotateCurrentSpan({
      "provider.player_count": details.length,
      "provider.stat_basis": basis.type,
    });
    return details;
  });

  const readPlayerHistory = Effect.fn("YahooProvider.readPlayerHistory")(function* (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerPlayerKeys: ReadonlyArray<string>;
      readonly sport: FantasySport;
      readonly periods: ReadonlyArray<ProviderScoringWeek>;
      readonly currentPeriod: number | undefined;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_player_history");
    const cookie = yield* sessionCookie(input, "read_player_history");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_player_history");
    const playerKeys = yield* ValidBatchPlayerKeys(input.providerPlayerKeys);
    const periods = yield* ValidPlayerPeriods(input.periods);
    const history: Array<ProviderPlayerPeriod> = [];
    for (const period of periods) {
      const basis = statBasis(input.sport, period, input.currentPeriod);
      const details: Array<ProviderPlayerDetail> = [];
      for (let index = 0; index < playerKeys.length; index += maximumSelectedPlayers) {
        const chunkDetails = yield* readPlayerPeriod({
          cookie,
          leagueKey,
          playerKeys: playerKeys.slice(index, index + maximumSelectedPlayers),
          basis,
          operation: "read_player_history",
        });
        for (const detail of chunkDetails) {
          details.push(detail);
        }
      }
      history.push({ period, details });
    }
    yield* Effect.annotateCurrentSpan({
      "provider.period_count": history.length,
    });
    return history;
  });

  const readPlayerFacts = Effect.fnUntraced(function* (input: {
    readonly provider: ProviderKey;
    readonly session: Redacted.Redacted<string>;
    readonly providerLeagueKey: string;
    readonly providerPlayerKeys: ReadonlyArray<string>;
    readonly coverage: ProviderRosterCoverage;
  }) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_player_details");
    const cookie = yield* sessionCookie(input, "read_player_details");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_player_details");
    const playerKeys = yield* ValidBatchPlayerKeys(input.providerPlayerKeys);
    const payload = yield* readJson(internet, {
      operation: "read_player_details",
      origin: readOrigin,
      path:
        `/fantasy/v2/league/${leagueKey}/players;player_keys=${playerKeys.join(",")}` +
        ";out=percent_started,percent_owned,ranks",
      query: {
        format: "json",
        "percent_started.cut_types": communityStartRateCut,
        ranks:
          "last30days,last14days,projected_next7days,projected_season_remaining,last4weeks,projected_week,projected_next4weeks",
      },
      cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(PlayerDetailsPayload, payload, "read_player_details");
    const rates = yield* playerFactsFromPayload(decoded, leagueKey, input.coverage);
    yield* Effect.annotateCurrentSpan("provider.player_fact_count", rates.length);
    return rates;
  });

  const readGamesPlayed = Effect.fnUntraced(function* (input: {
    readonly provider: ProviderKey;
    readonly session: Redacted.Redacted<string>;
    readonly providerLeagueKey: string;
    readonly providerTeamKey: string;
    readonly pitcherSlot: string | undefined;
  }) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_league");
    const cookie = yield* sessionCookie(input, "read_league");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_league");
    const teamKey = yield* ValidTeamKey(input.providerTeamKey, "read_league");
    if (providerLeagueKey(teamKey) !== leagueKey) {
      return yield* ProviderResponseInvalid.make({ operation: "read_league", field: "team_key" });
    }
    const payload = yield* readJson(internet, {
      operation: "read_league",
      origin: readOrigin,
      path: `/fantasy/v2/league/${leagueKey}/teams;team_keys=${teamKey};out=games_played`,
      query: { format: "json" },
      cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(TeamGamesPlayedPayload, payload, "read_league");
    const gamesPlayed = yield* gamesPlayedFromPayload(
      decoded,
      leagueKey,
      teamKey,
      input.pitcherSlot,
    );
    yield* Effect.annotateCurrentSpan("provider.games_played_position_count", gamesPlayed.length);
    return gamesPlayed;
  });

  const searchPlayers = Effect.fn("YahooProvider.searchPlayers")(function* (
    input: ProviderPlayerSearchInput,
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "search_players");
    const cookie = yield* sessionCookie(input, "search_players");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "search_players");
    const limit = yield* ValidSearchLimit(input.limit);
    const query = yield* ValidSearchQuery(input.query);
    const statId = yield* ValidSearchStat(input.sort, input.statId);
    const search = query === undefined ? "" : `;search=${encodeURIComponent(query)}`;
    const status =
      input.availability === "all" ? "" : `;status=${searchStatus[input.availability]}`;
    const sortValue = searchSortValue(input.sort, statId);
    const sortType = rankedSearchSorts.has(input.sort) ? `;sort_type=${input.statType}` : "";
    const payload = yield* readJson(internet, {
      operation: "search_players",
      origin: readOrigin,
      path:
        `/fantasy/v2/league/${leagueKey}/players` +
        status +
        `;sort=${sortValue}${sortType}` +
        `;count=${String(limit)}${search}` +
        ";out=ownership,percent_owned,percent_started",
      query: { format: "json" },
      cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(PlayerSearchPayload, payload, "search_players");
    if (decoded.league.league_key !== leagueKey) {
      return yield* responseMismatch({ operation: "search_players", field: "league.league_key" });
    }
    const players = decoded.league.players.map(toSearchPlayer);
    yield* Effect.annotateCurrentSpan("provider.player_count", players.length);
    return { players };
  });

  const readMatchups = Effect.fn("YahooProvider.readMatchups")(function* (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly period: ProviderScoringWeek;
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
      readonly providerTeamKey: string | undefined;
      readonly limit: number;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_transactions");
    const cookie = yield* sessionCookie(input, "read_transactions");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_transactions");
    const limit = yield* ValidTransactionLimit(input.limit);
    const teamFilter = yield* ValidLeagueTeamKey(
      input.providerTeamKey,
      leagueKey,
      "read_transactions",
    );
    const payload = yield* readJson(internet, {
      operation: "read_transactions",
      origin: readOrigin,
      path: `/fantasy/v2/league/${leagueKey}/transactions;count=${String(limit)}` + teamFilter,
      query: { format: "json" },
      cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(TransactionsPayload, payload, "read_transactions");
    if (decoded.league.league_key !== leagueKey) {
      return yield* responseMismatch({
        operation: "read_transactions",
        field: "league.league_key",
      });
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
    if (
      decoded.league.league_key !== leagueKey ||
      decoded.league.teams.some((team) => providerLeagueKey(team.team_key) !== leagueKey)
    ) {
      return yield* responseMismatch({ operation: "read_league_teams" });
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
    const intent = input.intent;
    if (intent.kind === "trade") {
      return yield* ProviderReviewLinkInvalid.make({ reason: "unsupported-review-surface" });
    }
    const base = yield* Effect.try({
      try: () =>
        reviewBase(input.leagueWebUrl, input.sport, leagueIdFromKey(input.providerLeagueKey)),
      catch: () => ProviderReviewLinkInvalid.make({ reason: "unsupported-league-url" }),
    });
    const url = yield* intent.kind === "drop"
      ? dropReviewUrl(base, input.providerTeamKey, intent.drop)
      : addReviewUrl(base, intent);
    if (
      url.origin !== base.origin ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      !url.pathname.startsWith(`${base.pathname}/`) ||
      [...url.searchParams.keys()].some(
        (name) =>
          (intent.kind === "drop" && name !== "pid") ||
          (intent.kind !== "drop" && name !== "apid" && name !== "dpid"),
      )
    ) {
      return yield* ProviderReviewLinkInvalid.make({ reason: "unsupported-review-surface" });
    }
    return url.href;
  });

  return {
    key,
    capabilities: yahooCapabilities,
    reviewLinkTemplate,
    validateSession,
    discoverTeams,
    readLeague,
    readStandings,
    readRoster,
    applyNativeAction,
    applyExplicitAssignments,
    readPlayerDetails,
    readPlayerHistory,
    searchPlayers,
    readMatchups,
    readTransactions,
    readLeagueTeams,
    buildReviewLink,
    scoreRoster: (input: ProviderScoreRequest) =>
      scoreYahooRoster(input, {
        readPlayerFacts: () =>
          readPlayerFacts({
            provider: input.provider,
            session: input.session,
            providerLeagueKey: input.providerLeagueKey,
            providerPlayerKeys: input.roster.players.map(
              (player: ProviderRosterPlayer) => player.providerPlayerKey,
            ),
            coverage: input.roster.coverage,
          }),
        readGamesPlayed: () =>
          readGamesPlayed({
            provider: input.provider,
            session: input.session,
            providerLeagueKey: input.providerLeagueKey,
            providerTeamKey: input.providerTeamKey,
            pitcherSlot: pitcherSlotOf(input.league),
          }),
        readHistory: (periods) =>
          readPlayerHistory({
            provider: input.provider,
            session: input.session,
            providerLeagueKey: input.providerLeagueKey,
            providerPlayerKeys: input.roster.players.map(
              (player: ProviderRosterPlayer) => player.providerPlayerKey,
            ),
            sport: input.sport,
            periods: periods.map((period) => ({ week: period.week })),
            currentPeriod: input.league.periodWindow?.current,
          }).pipe(
            Effect.map((entries) =>
              entries.map((entry) => ({
                period: { kind: "week" as const, week: entry.period.week },
                details: entry.details,
              })),
            ),
          ),
      }),
  } satisfies ProviderShape;
});

const key = decodeProviderKey("yahoo");

class YahooCrumbUnavailable extends Schema.TaggedError<
  YahooCrumbUnavailable,
  { readonly brand: unique symbol }
>()("provider.crumb_unavailable", {
  operation: Schema.Literals(["apply_native_action", "apply_explicit_assignments"]),
}) {}

function sessionCookie(
  input: ProviderSessionMaterial,
  operation: ProviderOperation,
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
        Effect.catchTag("SchemaError", () => responseMismatch({ operation: request.operation })),
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
      (key) =>
        key !== "format" &&
        key !== "stats.type" &&
        key !== "stats.week" &&
        key !== "percent_started.cut_types" &&
        key !== "ranks",
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
  operation: ProviderOperation,
): Effect.Effect<ProviderNativeTarget, ProviderResponseInvalid> {
  if (target.type === "week") {
    return Number.isSafeInteger(target.week) && target.week >= 1
      ? Effect.succeed({ type: "week" as const, week: target.week })
      : Effect.fail(ProviderResponseInvalid.make({ operation }));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(target.date)) {
    return Effect.fail(ProviderResponseInvalid.make({ operation }));
  }
  return Effect.succeed({ type: "date" as const, date: target.date });
}

function ValidAssignments(
  assignments: ReadonlyArray<ProviderLineupAssignment>,
): Effect.Effect<ReadonlyArray<ProviderLineupAssignment>, ProviderResponseInvalid> {
  const keys = new Set(assignments.map((assignment) => assignment.providerPlayerKey));
  if (
    assignments.length === 0 ||
    keys.size !== assignments.length ||
    !assignments.every(
      (assignment) =>
        /^[0-9]+\.p\.[0-9]+$/u.test(assignment.providerPlayerKey) &&
        /^[A-Za-z0-9/+_-]{1,16}$/u.test(assignment.slot),
    )
  ) {
    return ProviderResponseInvalid.make({ operation: "apply_explicit_assignments" });
  }
  return Effect.succeed(assignments);
}

function nativeStartActiveBody(target: ProviderNativeTarget): string {
  return `<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster>${coverageBody(target)}<action>start_active_players</action></roster></fantasy_content>`;
}

function explicitAssignmentsBody(
  target: ProviderNativeTarget,
  assignments: ReadonlyArray<ProviderLineupAssignment>,
): string {
  const players = assignments
    .map(
      (assignment) =>
        `<player><player_key>${assignment.providerPlayerKey}</player_key><position>${assignment.slot}</position></player>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster>${coverageBody(target)}<players>${players}</players></roster></fantasy_content>`;
}

function coverageBody(target: ProviderNativeTarget): string {
  return target.type === "week"
    ? `<coverage_type>week</coverage_type><week>${String(target.week)}</week>`
    : `<coverage_type>date</coverage_type><date>${target.date}</date>`;
}

function decodePayload<A, E>(
  schema: Schema.Codec<A, E>,
  payload: unknown,
  operation: ProviderOperation,
): Effect.Effect<A, ProviderResponseInvalid> {
  return Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.catchTag("SchemaError", (error) =>
      responseMismatch({ operation, field: invalidField(error.issue) }),
    ),
  );
}

function responseMismatch(input: {
  readonly operation: ProviderOperation;
  readonly field?: string;
}): Effect.Effect<never, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    yield* reportSchemaMismatch(input.field);
    return yield* ProviderResponseInvalid.make(input);
  });
}

function reportSchemaMismatch(field: string | undefined): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({
      "provider.schema_mismatch": true,
      "provider.schema_field": field ?? "unreported",
    });
    yield* Effect.logWarning("A provider response did not match its decoder");
  });
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
): Effect.Effect<ReadonlyArray<ProviderTeam>, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    const teams: ProviderTeam[] = [];
    for (const user of payload.users) {
      for (const game of user.games) {
        if (game.code !== league) {
          return yield* responseMismatch({
            operation: "discover_teams",
            field: "game.code",
          });
        }
        for (const team of game.teams ?? []) {
          teams.push({
            provider: key,
            providerTeamKey: team.team_key,
            providerLeagueKey: providerLeagueKey(team.team_key),
            league,
            sport: leagueSport[league],
            season: game.season,
            name: team.name,
          });
        }
      }
    }
    return teams;
  });
}

function providerLeagueKey(teamKey: string): string {
  return teamKey.slice(0, teamKey.lastIndexOf(".t."));
}

function leagueSettings(
  payload: typeof LeaguePayload.Type,
  requestedLeagueKey: string,
  sport: FantasySport,
): Effect.Effect<ProviderLeagueSettings, ProviderResponseInvalid | ProviderOperationUnsupported> {
  return Effect.gen(function* () {
    const attributes = payload.league;
    const settings = singleEntry(attributes.settings);
    if (settings === undefined || attributes.league_key !== requestedLeagueKey) {
      return yield* responseMismatch({
        operation: "read_league",
        field: "league.league_key",
      });
    }
    const periodWindow = yield* weekWindow(attributes);
    const rosterCoverage = yield* declaredRosterCoverage(attributes);
    const webUrl = yield* Effect.try({
      try: () => reviewBase(attributes.url, sport, leagueIdFromKey(attributes.league_key)).href,
      catch: () => ProviderResponseInvalid.make({ operation: "read_league", field: "league.url" }),
    }).pipe(Effect.tapError((error) => reportSchemaMismatch(error.field)));
    return {
      providerLeagueKey: attributes.league_key,
      name: attributes.name,
      webUrl,
      season: attributes.season,
      startDate: optionalNonEmpty(attributes.start_date),
      endDate: optionalNonEmpty(attributes.end_date),
      teamCount: attributes.num_teams,
      format: leagueFormat(attributes.scoring_type, settings.stat_modifiers?.stats.length ?? 0),
      scoringType: attributes.scoring_type,
      scoringLabel: optionalNonEmpty(attributes.scoring_label),
      weeklyDeadline: optionalNonEmpty(attributes.weekly_deadline),
      waiverType: optionalNonEmpty(settings.waiver_type),
      waiverRule: optionalNonEmpty(settings.waiver_rule),
      usesFaab: settings.uses_faab,
      draftStatus: optionalNonEmpty(attributes.draft_status),
      periodWindow,
      rosterCoverage,
      maxGamesPlayed: declaredLimit(settings.max_games_played),
      maxInningsPitched: declaredLimit(settings.max_innings_pitched),
      rosterPositions: settings.roster_positions.map(({ roster_position }) => {
        const kind = rosterSlotKind(roster_position.position, roster_position.is_starting_position);
        return {
          position: roster_position.position,
          positionType: optionalNonEmpty(roster_position.position_type),
          kind,
          count: roster_position.count,
          eligibility: kind === "bench" ? [] : [roster_position.position],
        };
      }),
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

function declaredLimit(limit: number | undefined): number | undefined {
  return limit !== undefined && limit > 0 ? limit : undefined;
}

function declaredRosterCoverage(
  attributes: (typeof LeaguePayload.Type)["league"],
): Effect.Effect<ProviderCoverageKind, ProviderOperationUnsupported> {
  const deadline = attributes.weekly_deadline ?? "";
  const coverage =
    weeklyDeadlineCoverage[deadline] ?? editKeyCoverage(editKeyOf(attributes.edit_key));
  if (coverage !== undefined) {
    return Effect.succeed(coverage);
  }
  return ProviderOperationUnsupported.make({
    operation: "read_league",
    reason: `The league declares weekly deadline ${JSON.stringify(deadline)} and editable period ${JSON.stringify(attributes.edit_key ?? null)}. Neither identifies a weekly or daily roster cadence, so this league's lineup period cannot be resolved.`,
  });
}

function editKeyOf(editKey: string | number | undefined): string | undefined {
  return editKey === undefined ? undefined : String(editKey);
}

function editKeyCoverage(editKey: string | undefined): ProviderCoverageKind | undefined {
  if (editKey === undefined) {
    return undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(editKey)) {
    return "date";
  }
  return /^\d+$/u.test(editKey) ? "week" : undefined;
}

const weeklyDeadlineCoverage: Readonly<Record<string, ProviderCoverageKind>> = {
  intraday: "date",
  game: "date",
  "1": "week",
  "2": "week",
  "3": "week",
  "4": "week",
  "5": "week",
  "6": "week",
  "7": "week",
};

function leagueFormat(
  scoringType: string,
  modifierCount: number,
): "head_to_head_categories" | "head_to_head_points" | "rotisserie" | "unknown" {
  if (scoringType === "roto") {
    return "rotisserie";
  }
  if (scoringType !== "head") {
    return "unknown";
  }
  return modifierCount === 0 ? "head_to_head_categories" : "head_to_head_points";
}

function rosterSlotKind(position: string, isStarting: boolean): "starting" | "bench" | "reserve" {
  if (isStarting) {
    return "starting";
  }
  return position === "BN" ? "bench" : "reserve";
}

function weekWindow(
  attributes: (typeof LeaguePayload.Type)["league"],
): Effect.Effect<ProviderPeriodWindow | undefined, ProviderResponseInvalid> {
  const currentWeek = attributes.current_week;
  const startWeek = attributes.start_week;
  const endWeek = attributes.end_week;
  if (currentWeek !== undefined && startWeek !== undefined && endWeek !== undefined) {
    return Effect.succeed({ current: currentWeek, start: startWeek, end: endWeek });
  }
  if (currentWeek === undefined && startWeek === undefined && endWeek === undefined) {
    return Effect.as(Effect.void, undefined);
  }
  return responseMismatch({
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
  requestedPeriod: ProviderRosterCoverage | undefined,
): Effect.Effect<ProviderRoster, ProviderResponseInvalid | ProviderPeriodMismatch> {
  return Effect.gen(function* () {
    if (payload.team.team_key !== requestedTeamKey) {
      return yield* responseMismatch({
        operation: "read_roster",
        field: "team.team_key",
      });
    }
    const roster = payload.team.roster;
    const entries = isReadonlyArray(roster)
      ? roster
      : "entries" in roster
        ? roster.entries
        : [roster];
    const players = entries.flatMap((entry) => entry.players);
    if (players.length === 0) {
      return yield* responseMismatch({ operation: "read_roster" });
    }
    const declaredType = isReadonlyArray(roster) ? undefined : roster.coverage_type;
    const declaredWeek = isReadonlyArray(roster) ? undefined : roster.week;
    const declaredDate = isReadonlyArray(roster) ? undefined : roster.date;
    const coverageTypes = new Set(players.map((player) => player.selected_position.coverage_type));
    if (coverageTypes.size !== 1) {
      return yield* responseMismatch({ operation: "read_roster" });
    }
    const coverageType = [...coverageTypes][0];
    if (coverageType === undefined) {
      return yield* responseMismatch({ operation: "read_roster" });
    }
    if (declaredType !== undefined && declaredType !== coverageType) {
      return yield* responseMismatch({ operation: "read_roster" });
    }
    const leagueKey = providerLeagueKey(requestedTeamKey);
    if (coverageType === "week") {
      const weeks = new Set(
        players.flatMap((player) =>
          player.selected_position.week === undefined ? [] : [player.selected_position.week],
        ),
      );
      if (weeks.size > 1) {
        return yield* responseMismatch({ operation: "read_roster" });
      }
      const playerWeek = [...weeks][0];
      if (declaredWeek !== undefined && playerWeek !== undefined && declaredWeek !== playerWeek) {
        return yield* responseMismatch({ operation: "read_roster" });
      }
      const week = declaredWeek ?? playerWeek;
      if (week === undefined) {
        return yield* responseMismatch({ operation: "read_roster" });
      }
      const coverage = { type: "week" as const, week };
      if (
        requestedPeriod !== undefined &&
        (requestedPeriod.type !== "week" || requestedPeriod.week !== week)
      ) {
        return yield* ProviderPeriodMismatch.make({
          operation: "read_roster",
          requested: requestedPeriod,
          covered: coverage,
        });
      }
      return {
        providerTeamKey: requestedTeamKey,
        providerLeagueKey: leagueKey,
        coverage,
        players: players.map(toRosterPlayer),
      };
    }
    if (coverageType === "date") {
      const dates = new Set(
        players.flatMap((player) =>
          player.selected_position.date === undefined ? [] : [player.selected_position.date],
        ),
      );
      if (dates.size > 1) {
        return yield* responseMismatch({ operation: "read_roster" });
      }
      const playerDate = [...dates][0];
      if (declaredDate !== undefined && playerDate !== undefined && declaredDate !== playerDate) {
        return yield* responseMismatch({ operation: "read_roster" });
      }
      const date = declaredDate ?? playerDate;
      if (date === undefined) {
        return yield* responseMismatch({ operation: "read_roster" });
      }
      const coverage = { type: "date" as const, date };
      if (
        requestedPeriod !== undefined &&
        (requestedPeriod.type !== "date" || requestedPeriod.date !== date)
      ) {
        return yield* ProviderPeriodMismatch.make({
          operation: "read_roster",
          requested: requestedPeriod,
          covered: coverage,
        });
      }
      return {
        providerTeamKey: requestedTeamKey,
        providerLeagueKey: leagueKey,
        coverage,
        players: players.map(toRosterPlayer),
      };
    }
    return yield* responseMismatch({ operation: "read_roster" });
  });
}

function toRosterPlayer(player: typeof RosterPlayerPayload.Type): ProviderRosterPlayer {
  return {
    providerPlayerKey: player.player_key,
    name: player.name.full,
    displayPosition: player.display_position,
    primaryPosition: player.primary_position,
    positionType: optionalNonEmpty(player.position_type),
    proTeamAbbreviation: optionalNonEmpty(player.editorial_team_abbr ?? ""),
    eligiblePositions: (player.eligible_positions ?? []).map(({ position }) => position),
    slot: player.selected_position.position,
    isEditable: player.is_editable ?? null,
    injuryCode: optionalNonEmpty(player.status),
    injuryDetail: optionalNonEmpty(player.injury_note) ?? optionalNonEmpty(player.status_full),
    byeWeek: player.bye_weeks?.week ?? null,
    scheduled: scheduledIn(player.opponent),
    startingLineup: startingLineupIn(player.starting_status),
    undroppable: player.is_undroppable ?? null,
  };
}

function scheduledIn(opponent: string | null): boolean {
  const named = optionalNonEmpty(opponent ?? "");
  return named !== undefined && named !== "Bye";
}

function startingLineupIn(
  status: ReadonlyArray<typeof StartingStatus.Type> | undefined,
): ProviderRosterPlayer["startingLineup"] {
  if (status?.some((entry) => entry.is_starting === 1) === true) {
    return "confirmed-starting";
  }
  return status?.some((entry) => entry.is_starting === 0) === true
    ? "confirmed-not-starting"
    : "unconfirmed";
}

function pitcherSlotOf(league: ProviderLeagueSettings): string | undefined {
  return ["P", "RP", "SP"].find((name) =>
    league.rosterPositions.some(
      (position) => position.kind === "starting" && position.position === name,
    ),
  );
}

function gamesPlayedFromPayload(
  payload: typeof TeamGamesPlayedPayload.Type,
  requestedLeagueKey: string,
  requestedTeamKey: string,
  pitcherSlot: string | undefined,
): Effect.Effect<ReadonlyArray<ProviderGamesPlayed>, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    if (payload.league.league_key !== requestedLeagueKey) {
      return yield* responseMismatch({ operation: "read_league", field: "league.league_key" });
    }
    const team = payload.league.teams.find((entry) => entry.team_key === requestedTeamKey);
    if (team === undefined || team.games_played === undefined) {
      return yield* responseMismatch({ operation: "read_league", field: "team.games_played" });
    }
    const rows: Array<ProviderGamesPlayed> = [];
    for (const wrapper of team.games_played) {
      const type = wrapper.games_played_by_position_type;
      for (const entry of type.games_played ?? []) {
        const games = entry.games_played_by_position.games_played;
        rows.push({
          position: entry.games_played_by_position.position,
          played: games.played,
          max: games.max,
          projected: games.projected,
        });
      }
      const innings = type.innings_pitched;
      if (innings !== undefined && pitcherSlot !== undefined) {
        rows.push({
          position: pitcherSlot,
          played: Number(innings.pitched),
          max: Number(innings.max),
          projected: Number(innings.projected),
        });
      }
    }
    return rows;
  });
}

function playerRanksOf(
  payload: ReadonlyArray<typeof PlayerRankPayload.Type> | undefined,
): ReadonlyArray<PlayerRank> {
  const ranks: Array<PlayerRank> = [];
  for (const entry of payload ?? []) {
    const type = rankTypeMap[entry.player_rank.rank_type];
    const rank = Number(entry.player_rank.rank_value);
    if (type !== undefined && Number.isInteger(rank) && rank > 0) {
      ranks.push({ type, rank });
    }
  }
  return ranks;
}

const rankTypeMap: Readonly<Record<string, RankType>> = {
  L30: "L30",
  L14: "L14",
  PS7: "PS7",
  PSR: "PSR",
  L4W: "L4W",
  PW: "PW",
  PN4W: "PN4W",
};

function playerDetailQuery(basis: ProviderStatBasis): Record<string, string> {
  return basis.type === "week"
    ? { format: "json", "stats.type": "week", "stats.week": String(basis.week) }
    : { format: "json", "stats.type": "season" };
}

function playerDetailsFromPayload(
  payload: typeof PlayerDetailsPayload.Type,
  requestedLeagueKey: string,
  basis: ProviderStatBasis,
): Effect.Effect<
  ReadonlyArray<ProviderPlayerDetail>,
  ProviderResponseInvalid | ProviderPeriodMismatch
> {
  return Effect.gen(function* () {
    if (payload.league.league_key !== requestedLeagueKey) {
      return yield* responseMismatch({
        operation: "read_player_details",
        field: "league.league_key",
      });
    }
    const details: ProviderPlayerDetail[] = [];
    for (const player of payload.league.players) {
      const series =
        player.player_stats === undefined
          ? undefined
          : yield* statSeries(player.player_stats, basis);
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
        actual: series === undefined ? undefined : { basis, stats: series },
        projected: undefined,
      });
    }
    return details;
  });
}

function playerFactsFromPayload(
  payload: typeof PlayerDetailsPayload.Type,
  requestedLeagueKey: string,
  expected: ProviderRosterCoverage,
): Effect.Effect<
  ReadonlyArray<YahooPlayerFacts>,
  ProviderResponseInvalid | ProviderPeriodMismatch
> {
  return Effect.gen(function* () {
    if (payload.league.league_key !== requestedLeagueKey) {
      return yield* responseMismatch({
        operation: "read_player_details",
        field: "league.league_key",
      });
    }
    const rates: Array<YahooPlayerFacts> = [];
    for (const player of payload.league.players) {
      const percentStarted = yield* communityStartRateOf(
        player.percent_started,
        `league.players.${player.player_key}.percent_started`,
        expected,
      );
      if (percentStarted !== undefined) {
        rates.push({
          providerPlayerKey: player.player_key,
          ...percentStarted,
          percentOwned: yield* percentageOf(
            player.percent_owned?.value,
            `league.players.${player.player_key}.percent_owned.value`,
          ),
          percentOwnedDelta: yield* percentDeltaOf(
            player.percent_owned?.delta,
            `league.players.${player.player_key}.percent_owned.delta`,
          ),
          ranks: playerRanksOf(player.player_ranks),
        });
      }
    }
    if (rates.length === 0) {
      return yield* responseMismatch({
        operation: "read_player_details",
        field: "league.players.percent_started",
      });
    }
    return rates;
  });
}

function communityStartRateOf(
  payload: typeof PercentStartedPayload.Type | undefined,
  field: string,
  expected: ProviderRosterCoverage,
): Effect.Effect<
  YahooStartRateSummary | undefined,
  ProviderResponseInvalid | ProviderPeriodMismatch
> {
  return Effect.gen(function* () {
    if (payload === undefined) {
      return undefined;
    }
    const coverage = yield* coverageOf(payload, field);
    if (coverage !== null && !sameCoverage(coverage, expected)) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_player_details",
        requested: expected,
        covered: coverage,
      });
    }
    const cuts: Array<YahooStartRateCut> = [];
    for (const [index, entry] of (payload.percent_started_cut_types ?? []).entries()) {
      const cut = entry.percent_started_cut_type;
      cuts.push({
        cut: cut.cut_type,
        percent: yield* percentageOf(
          cut.value,
          `${field}.percent_started_cut_types.${String(index)}.value`,
        ),
      });
    }
    return {
      percent: yield* percentageOf(payload.value, `${field}.value`),
      cuts,
    };
  });
}

function coverageOf(
  payload: typeof PercentStartedPayload.Type,
  field: string,
): Effect.Effect<ProviderRosterCoverage | null, ProviderResponseInvalid> {
  const coverageType = payload.coverage_type;
  if (coverageType === undefined) {
    return Effect.succeed(null);
  }
  if (coverageType === "week" && payload.week !== undefined) {
    return Effect.succeed({ type: "week", week: payload.week });
  }
  if (coverageType === "date" && payload.date !== undefined) {
    return Effect.succeed({ type: "date", date: payload.date });
  }
  return responseMismatch({ operation: "read_player_details", field: `${field}.coverage_type` });
}

function percentageOf(
  value: number | string | null | undefined,
  field: string,
): Effect.Effect<number | null, ProviderResponseInvalid> {
  if (value === undefined || value === null) {
    return Effect.succeed(null);
  }
  const percent = parsePercent(value);
  if (percent === undefined || percent < 0 || percent > 100) {
    return responseMismatch({ operation: "read_player_details", field });
  }
  return Effect.succeed(percent);
}

function percentDeltaOf(
  value: number | string | null | undefined,
  field: string,
): Effect.Effect<number | null, ProviderResponseInvalid> {
  if (value === undefined || value === null) {
    return Effect.succeed(null);
  }
  const delta = parsePercent(value);
  if (delta === undefined) {
    return responseMismatch({ operation: "read_player_details", field });
  }
  return Effect.succeed(delta);
}

function parsePercent(value: number | string): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  return /^-?\d+(?:\.\d+)?$/u.test(value) ? Number(value) : undefined;
}

function sameCoverage(left: ProviderRosterCoverage, right: ProviderRosterCoverage): boolean {
  if (left.type === "week" && right.type === "week") {
    return left.week === right.week;
  }
  if (left.type === "date" && right.type === "date") {
    return left.date === right.date;
  }
  return false;
}

function statBasis(
  sport: FantasySport,
  period: ProviderScoringWeek | undefined,
  currentWeek: number | undefined,
): ProviderStatBasis {
  if (
    sport === "football" &&
    period !== undefined &&
    currentWeek !== undefined &&
    period.week < currentWeek
  ) {
    return { type: "week", week: period.week };
  }
  return { type: "season" };
}

function statSeries(
  stats: typeof PlayerStats.Type,
  basis: ProviderStatBasis,
): Effect.Effect<
  ReadonlyArray<{ readonly statId: number; readonly value: number | null }>,
  ProviderResponseInvalid | ProviderPeriodMismatch
> {
  return Effect.gen(function* () {
    const coverage = stats.entries[0];
    if (
      stats.entries.length !== 1 ||
      coverage === undefined ||
      coverage.coverage_type !== basis.type
    ) {
      return yield* responseMismatch({
        operation: "read_player_details",
        field: "player_stats",
      });
    }
    if (basis.type === "week" && coverage.week !== basis.week) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_player_details",
        requested: { type: "week", week: basis.week },
        covered:
          coverage.week === undefined ? null : { type: "week" as const, week: coverage.week },
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
    percentOwnedDelta:
      player.percent_owned === undefined ? null : providerNumber(player.percent_owned.delta),
    percentStarted:
      player.percent_started === undefined ? null : providerNumber(player.percent_started.value),
    percentStartedChange:
      player.percent_started === undefined ? null : providerNumber(player.percent_started.delta),
  };
}

function standingsFromPayload(
  payload: typeof StandingsPayload.Type,
  requestedLeagueKey: string,
): Effect.Effect<ProviderStandings, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    if (payload.league.league_key !== requestedLeagueKey) {
      return yield* responseMismatch({
        operation: "read_standings",
        field: "league.league_key",
      });
    }
    const teams = payload.league.standings.flatMap((group) => group.teams);
    if (teams.length === 0) {
      return yield* responseMismatch({ operation: "read_standings" });
    }
    return {
      providerLeagueKey: requestedLeagueKey,
      teams: teams.map(toStanding),
    };
  });
}

function toStanding(team: typeof StandingsTeamPayload.Type): ProviderStanding {
  const standings = team.team_standings;
  const totals = standings?.outcome_totals;
  return {
    providerTeamKey: team.team_key,
    name: team.name,
    rank: standings?.rank ?? null,
    playoffSeed: standings?.playoff_seed ?? null,
    record:
      totals === undefined
        ? undefined
        : {
            wins: totals.wins,
            losses: totals.losses,
            ties: totals.ties,
            percentage: providerNumber(totals.percentage),
          },
    gamesBack: providerNumber(standings?.games_back),
    pointsBack: providerNumber(standings?.points_back),
    points: providerNumber(team.team_points?.total),
    pointsFor: providerNumber(standings?.points_for),
    pointsAgainst: providerNumber(standings?.points_against),
    streak:
      standings?.streak === undefined
        ? undefined
        : { type: standings.streak.type, value: standings.streak.value },
    categoryTotals: (team.team_stats?.stats ?? []).map(statValue),
    categoryPoints: (team.team_points?.stats ?? []).map(statValue),
  };
}

function statValue(entry: typeof StatEntry.Type): ProviderStatValue {
  return { statId: entry.stat.stat_id, value: providerNumber(entry.stat.value) };
}

function matchupsFromPayload(
  payload: typeof MatchupsPayload.Type,
  requestedLeagueKey: string,
  period: ProviderScoringWeek,
): Effect.Effect<ReadonlyArray<ProviderMatchup>, ProviderResponseInvalid | ProviderPeriodMismatch> {
  return Effect.gen(function* () {
    const scoreboard = payload.league.scoreboard;
    if (payload.league.league_key !== requestedLeagueKey) {
      return yield* responseMismatch({ operation: "read_matchups" });
    }
    if (scoreboard.week !== period.week) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_matchups",
        requested: { type: "week", week: period.week },
        covered: { type: "week", week: scoreboard.week },
      });
    }
    const matchups: ProviderMatchup[] = [];
    for (const group of scoreboard.entries) {
      for (const matchup of group.matchups) {
        if (matchup.week !== period.week) {
          return yield* ProviderPeriodMismatch.make({
            operation: "read_matchups",
            requested: { type: "week", week: period.week },
            covered: { type: "week", week: matchup.week },
          });
        }
        const teams = matchup.entries.flatMap((entry) => entry.teams);
        if (teams.length !== 2) {
          return yield* responseMismatch({ operation: "read_matchups" });
        }
        const [home, away] = teams;
        if (home === undefined || away === undefined) {
          return yield* responseMismatch({ operation: "read_matchups" });
        }
        const homeScore = yield* teamScore(home, period);
        const awayScore = yield* teamScore(away, period);
        matchups.push({
          period,
          home: homeScore,
          away: awayScore,
          status: optionalNonEmpty(matchup.status ?? ""),
          isPlayoffs: optionalFlag(matchup.is_playoffs),
          isConsolation: optionalFlag(matchup.is_consolation),
          isTied: optionalFlag(matchup.is_tied),
          weekStart: optionalNonEmpty(matchup.week_start ?? ""),
          weekEnd: optionalNonEmpty(matchup.week_end ?? ""),
          categoryWinners: (matchup.stat_winners ?? []).map(
            ({ stat_winner }): ProviderCategoryWinner => ({
              statId: stat_winner.stat_id,
              winnerProviderTeamKey: stat_winner.winner_team_key,
              isTied: optionalFlag(stat_winner.is_tied) ?? false,
            }),
          ),
        });
      }
    }
    return matchups;
  });
}

function teamScore(
  team: typeof ScoreboardTeamPayload.Type,
  period: ProviderScoringWeek,
): Effect.Effect<ProviderTeamScore, ProviderResponseInvalid | ProviderPeriodMismatch> {
  return Effect.gen(function* () {
    const points = team.team_points;
    if (points?.week !== undefined && points.week !== period.week) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_matchups",
        requested: { type: "week", week: period.week },
        covered: { type: "week", week: points.week },
      });
    }
    const projected = team.team_projected_points;
    if (projected?.week !== undefined && projected.week !== period.week) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_matchups",
        requested: { type: "week", week: period.week },
        covered: { type: "week", week: projected.week },
      });
    }
    const remaining = remainingGames(team.team_remaining_games, period);
    if (remaining !== undefined && remaining.week !== null && remaining.week !== period.week) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_matchups",
        requested: { type: "week", week: period.week },
        covered: { type: "week", week: remaining.week },
      });
    }
    return {
      providerTeamKey: team.team_key,
      name: team.name,
      points: points === undefined ? null : providerNumber(points.total),
      projectedPoints: projected === undefined ? null : providerNumber(projected.total),
      winProbability: providerNumber(team.win_probability),
      remainingGames: remaining,
      categoryTotals: (team.team_stats?.stats ?? []).map(statValue),
    };
  });
}

function remainingGames(
  value: (typeof ScoreboardTeamPayload.Type)["team_remaining_games"],
  period: ProviderScoringWeek,
): ProviderRemainingGames | undefined {
  if (value?.total === undefined) {
    return undefined;
  }
  return {
    week: value.week ?? period.week,
    completed: value.total.completed_games,
    live: value.total.live_games,
    remaining: value.total.remaining_games,
  };
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
          name: optionalNonEmpty(player.name?.full ?? ""),
          primaryPosition: optionalNonEmpty(player.primary_position ?? ""),
          displayPosition: optionalNonEmpty(player.display_position ?? ""),
          eligiblePositions:
            player.eligible_positions === undefined
              ? undefined
              : player.eligible_positions.map(({ position }) => position),
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
    onNone: () => responseMismatch({ operation: "read_transactions" }),
    onSome: (instant) => Effect.succeed(DateTime.formatIso(instant)),
  });
}

function singleEntry<A>(value: ReadonlyArray<A> | A): A | undefined {
  return isReadonlyArray(value) ? value[0] : value;
}

function isReadonlyArray<A>(value: ReadonlyArray<A> | A): value is ReadonlyArray<A> {
  return Array.isArray(value);
}

function addReviewUrl(
  base: URL,
  intent: Extract<ProviderReviewIntent, { readonly kind: "add" | "add_drop" }>,
): Effect.Effect<URL, ProviderReviewLinkInvalid> {
  return Effect.try({
    try: () => {
      const target = new URL(base.href);
      target.pathname = `${base.pathname}/${reviewPaths.add}`;
      target.searchParams.append("apid", numericPlayerId(intent.add));
      if (intent.kind === "add_drop") {
        target.searchParams.append("dpid", numericPlayerId(intent.drop));
      }
      return target;
    },
    catch: () => ProviderReviewLinkInvalid.make({ reason: "unsupported-player-key" }),
  });
}

function dropReviewUrl(
  base: URL,
  providerTeamKey: string,
  playerKey: string,
): Effect.Effect<URL, ProviderReviewLinkInvalid> {
  return Effect.gen(function* () {
    const teamNumber = yield* Effect.try({
      try: () => numericTeamNumber(providerTeamKey),
      catch: () => ProviderReviewLinkInvalid.make({ reason: "unsupported-team-key" }),
    });
    const playerId = yield* Effect.try({
      try: () => numericPlayerId(playerKey),
      catch: () => ProviderReviewLinkInvalid.make({ reason: "unsupported-player-key" }),
    });
    const target = new URL(base.href);
    target.pathname = `${base.pathname}/${teamNumber}/${reviewPaths.drop}`;
    target.searchParams.append("pid", playerId);
    return target;
  });
}

function reviewBase(url: string, sport: FantasySport, leagueId: string): URL {
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

function numericPlayerId(playerKey: string): string {
  const match = /^[0-9]+\.p\.([0-9]+)$/u.exec(playerKey);
  if (match?.[1] === undefined) {
    throw new Error("Yahoo player key is not numeric");
  }
  return match[1];
}

function numericTeamNumber(teamKey: string): string {
  const match = /\.t\.([0-9]+)$/u.exec(teamKey);
  if (match?.[1] === undefined) {
    throw new Error("Yahoo team key has no team number");
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

function ValidPlayerPeriods(
  periods: ReadonlyArray<ProviderScoringWeek>,
): Effect.Effect<ReadonlyArray<ProviderScoringWeek>, ProviderResponseInvalid> {
  const weeks = new Set(periods.map((period) => period.week));
  if (
    periods.length === 0 ||
    weeks.size !== periods.length ||
    !periods.every((period) => Number.isSafeInteger(period.week) && period.week >= 1)
  ) {
    return ProviderResponseInvalid.make({ operation: "read_player_history" });
  }
  return Effect.succeed(periods);
}

function ValidBatchPlayerKeys(
  value: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, ProviderResponseInvalid> {
  if (
    value.length === 0 ||
    value.length > maximumHistoryPlayers ||
    !value.every((key) => /^[0-9]+\.p\.[0-9]+$/u.test(key))
  ) {
    return ProviderResponseInvalid.make({ operation: "read_player_history" });
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

function ValidSearchStat(
  sort: ProviderPlayerSearchInput["sort"],
  statId: number | undefined,
): Effect.Effect<number | undefined, ProviderResponseInvalid> {
  if (sort !== "stat") {
    return Effect.as(Effect.void, undefined);
  }
  return statId !== undefined && Number.isSafeInteger(statId) && statId >= 1 && statId <= 1_000
    ? Effect.succeed(statId)
    : ProviderResponseInvalid.make({ operation: "search_players" });
}

function ValidLeagueTeamKey(
  value: string | undefined,
  leagueKey: string,
  operation: ProviderOperation,
): Effect.Effect<string, ProviderResponseInvalid> {
  if (value === undefined) {
    return Effect.succeed("");
  }
  return /^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u.test(value) && providerLeagueKey(value) === leagueKey
    ? Effect.succeed(`;team_key=${value}`)
    : ProviderResponseInvalid.make({ operation });
}

function optionalFlag(value: boolean | number | string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "boolean"
    ? value
    : typeof value === "number"
      ? value !== 0
      : value === "1";
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
  code: Schema.NonEmptyString,
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
  edit_key: Schema.optional(Schema.Union([Schema.String, Schema.Finite])),
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
  max_games_played: Schema.optional(IntFromStringOrNumber),
  max_innings_pitched: Schema.optional(IntFromStringOrNumber),
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

const StartingStatus = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  is_starting: Schema.optional(IntFromStringOrNumber),
});

const RosterPlayerPayload = Schema.Struct({
  player_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.p\.[0-9]+$/u))),
  name: Schema.Struct({ full: Schema.NonEmptyString }),
  display_position: Schema.NonEmptyString,
  primary_position: Schema.NonEmptyString,
  position_type: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  editorial_team_abbr: Schema.optional(Schema.String),
  opponent: Schema.NullOr(Schema.String),
  starting_status: Schema.optional(Schema.Array(StartingStatus)),
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
    team_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u))),
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
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  date: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  delta: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
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

const PercentValue = Schema.optional(Schema.NullOr(Schema.Union([Schema.Finite, Schema.String])));

const PercentStartedCut = Schema.Struct({
  percent_started_cut_type: Schema.Struct({
    coverage_type: Schema.optional(Schema.String),
    week: Schema.optional(IntFromStringOrNumber),
    date: Schema.optional(Schema.String),
    cut_type: Schema.NonEmptyString,
    value: PercentValue,
  }),
});

const PercentStartedPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  date: Schema.optional(Schema.String),
  value: PercentValue,
  delta: PercentValue,
  percent_started_cut_types: Schema.optional(Schema.Array(PercentStartedCut)),
});

const PlayerRankPayload = Schema.Struct({
  player_rank: Schema.Struct({
    rank_type: Schema.NonEmptyString,
    rank_value: Schema.Union([Schema.String, Schema.Finite]),
  }),
});

const PlayerDetailPayload = Schema.Struct({
  player_key: PlayerKey,
  name: Schema.optional(Schema.Struct({ full: Schema.optional(Schema.String) })),
  primary_position: Schema.optional(Schema.String),
  display_position: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  ownership: Schema.optional(PlayerOwnership),
  percent_owned: Schema.optional(PercentOwned),
  percent_started: Schema.optional(PercentStartedPayload),
  player_ranks: Schema.optional(Schema.Array(PlayerRankPayload)),
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
  percent_started: Schema.optional(PercentOwned),
});

const PlayerSearchPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    players: Schema.Array(SearchPlayerPayload),
  }),
});

const ScoreboardPointsPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
  total: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  stats: Schema.optional(Schema.Array(StatEntry)),
});

const RemainingGamesPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  total: Schema.optional(
    Schema.Struct({
      completed_games: IntFromStringOrNumber,
      live_games: IntFromStringOrNumber,
      remaining_games: IntFromStringOrNumber,
    }),
  ),
});

const GamesPlayedPositionPayload = Schema.Struct({
  position: Schema.NonEmptyString,
  games_played: Schema.Struct({
    played: IntFromStringOrNumber,
    max: IntFromStringOrNumber,
    projected: IntFromStringOrNumber,
  }),
});

const GamesPlayedByTypePayload = Schema.Struct({
  position_type: Schema.optional(Schema.String),
  games_played: Schema.optional(
    Schema.Array(
      Schema.Struct({
        games_played_by_position: GamesPlayedPositionPayload,
      }),
    ),
  ),
  innings_pitched: Schema.optional(
    Schema.Struct({
      pitched: Schema.Union([Schema.Finite, Schema.String]),
      max: Schema.Union([Schema.Finite, Schema.String]),
      projected: Schema.Union([Schema.Finite, Schema.String]),
    }),
  ),
});

const GamesPlayedTypePayload = Schema.Struct({
  games_played_by_position_type: GamesPlayedByTypePayload,
});

const TeamGamesPlayedPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    teams: Schema.Array(
      Schema.Struct({
        team_key: TeamKey,
        games_played: Schema.optional(Schema.Array(GamesPlayedTypePayload)),
      }),
    ),
  }),
});

const TeamStatsPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
  stats: Schema.Array(StatEntry),
});

const ScoreboardTeamPayload = Schema.Struct({
  team_key: TeamKey,
  name: Schema.NonEmptyString,
  team_points: Schema.optional(ScoreboardPointsPayload),
  team_projected_points: Schema.optional(ScoreboardPointsPayload),
  team_remaining_games: Schema.optional(RemainingGamesPayload),
  team_stats: Schema.optional(TeamStatsPayload),
  win_probability: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
});

const StatWinnerPayload = Schema.Struct({
  stat_winner: Schema.Struct({
    stat_id: IntFromStringOrNumber,
    winner_team_key: Schema.optional(TeamKey),
    is_tied: Schema.optional(Flag),
  }),
});

const MatchupPayload = Schema.Struct({
  week: IntFromStringOrNumber,
  week_start: Schema.optional(Schema.String),
  week_end: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  is_playoffs: Schema.optional(Flag),
  is_consolation: Schema.optional(Flag),
  is_tied: Schema.optional(Flag),
  entries: Schema.Array(Schema.Struct({ teams: Schema.Array(ScoreboardTeamPayload) })),
  stat_winners: Schema.optional(Schema.Array(StatWinnerPayload)),
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
  name: Schema.optional(Schema.Struct({ full: Schema.optional(Schema.String) })),
  display_position: Schema.optional(Schema.String),
  primary_position: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
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

const OutcomeTotalsPayload = Schema.Struct({
  wins: IntFromStringOrNumber,
  losses: IntFromStringOrNumber,
  ties: IntFromStringOrNumber,
  percentage: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
});

const TeamStandingsPayload = Schema.Struct({
  rank: Schema.optional(IntFromStringOrNumber),
  playoff_seed: Schema.optional(IntFromStringOrNumber),
  outcome_totals: Schema.optional(OutcomeTotalsPayload),
  streak: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      value: IntFromStringOrNumber,
    }),
  ),
  games_back: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  points_for: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  points_against: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  points_back: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  points_change: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
});

const StandingsTeamPayload = Schema.Struct({
  team_key: TeamKey,
  name: Schema.NonEmptyString,
  team_points: Schema.optional(ScoreboardPointsPayload),
  team_standings: Schema.optional(TeamStandingsPayload),
  team_stats: Schema.optional(TeamStatsPayload),
});

const StandingsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    standings: Schema.Array(
      Schema.Struct({
        teams: Schema.Array(StandingsTeamPayload),
      }),
    ),
  }),
});

const LeagueTeamsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    teams: Schema.Array(TeamPayload),
  }),
});
