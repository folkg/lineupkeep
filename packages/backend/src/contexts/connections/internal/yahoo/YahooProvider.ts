import {
  DateTime,
  Effect,
  Option,
  Redacted,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from "effect";

import { fantasyDayLabel } from "#contexts/connections/FantasyDay.ts";
import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import type {
  PlayerRank,
  RankType,
} from "#contexts/connections/internal/provider-scoring/types.ts";
import { communityStartRateCut } from "#contexts/connections/internal/provider-scoring/ValueSource.ts";
import {
  ProviderPeriodMismatch,
  ProviderPeriodUnsupported,
  ProviderOperationUnsupported,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderAcquisitionUsage,
  ProviderCategoryWinner,
  ProviderDraftPick,
  ProviderFantasyDay,
  ProviderGamesPlayed,
  ProviderLeagueSettings,
  ProviderLeagueRoster,
  ProviderLineupAssignment,
  ProviderPeriodSupport,
  ProviderStatBasis,
  ProviderStatOmission,
  ProviderStatPeriod,
  ProviderMatchup,
  ProviderNativeTarget,
  ProviderOperation,
  ProviderScoringWeek,
  ProviderCoverageKind,
  ProviderPeriodWindow,
  ProviderPendingTrade,
  ProviderScoreRequest,
  ProviderTradeRatification,
  ProviderPlayerDetail,
  ProviderPlayerPeriod,
  ProviderPlayerSearchInput,
  ProviderPlayerWeekFact,
  ProviderReadFailure,
  ProviderRosterChange,
  ProviderRosterConstraints,
  ProviderRosterCoverage,
  ProviderRosterPlayer,
  ProviderRosterPosition,
  ProviderSchedulePeriod,
  ProviderSchedulePlayer,
  ProviderScheduledGame,
  ProviderStanding,
  ProviderStandings,
  ProviderStatValue,
  ProviderTeam,
  ProviderTeamScore,
  ProviderTransaction,
  ProviderTransactionIncomplete,
  ProviderTransactionMovement,
  ProviderTransactionParties,
  ProviderTransactionParty,
  ProviderTransactionPlayer,
  ProviderTransactionTeam,
  ProviderTradePick,
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
import { scoreYahooRoster, yahooCapabilities, yahooPlayerStatus } from "./YahooLineup.ts";
import type { YahooPlayerFacts, YahooStartRateCut, YahooStartRateSummary } from "./YahooLineup.ts";
import type {
  YahooDraftPick,
  YahooLeagueSettings,
  YahooMatchup,
  YahooPendingTrade,
  YahooTransaction,
  YahooTransactionPick,
  YahooTransactionPlayer,
  YahooTransactionTeam,
} from "./YahooSdk.ts";
import {
  discoverLeaguesThroughSdk,
  readDraftResultsThroughSdk,
  readLeagueTeamsThroughSdk,
  readLeagueThroughSdk,
  readMatchupsThroughSdk,
  readPendingTradesThroughSdk,
  readRosterThroughSdk,
  readTransactionsThroughSdk,
  rosterSlotOf,
  scheduledOpponent,
  searchPlayersThroughSdk,
  startingLineupOf,
  transactionTrendOf,
  validateSessionThroughSdk,
  yahooHostOrigin,
  yahooSdkContext,
} from "./YahooSdk.ts";

const readOrigin = new URL("https://pub-api-ro.fantasysports.yahoo.com");
const androidReadOrigin = new URL("https://pub-api-android-ro.fantasysports.yahoo.com");
const serviceOrigin = new URL("https://pub-api.fantasysports.yahoo.com");
const writeOrigin = new URL(yahooHostOrigin("write"));
const androidWriteOrigin = new URL(yahooHostOrigin("androidWrite"));
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
const goalsAgainstAverageStatId = 23;
const savePercentageStatId = 26;
const maximumSelectedPlayers = 25;
const maximumDraftPickTeams = 50;
const playerRankTypes = [
  "last30days",
  "last14days",
  "projected_next7days",
  "projected_season_remaining",
  "last4weeks",
  "projected_week",
  "projected_next4weeks",
] as const;
const maximumHistoryPlayers = 200;
const maximumUpstreamLimit = 50;

type ReadOperation = ProviderOperation;
type WriteOperation =
  | "apply_native_action"
  | "apply_explicit_assignments"
  | "apply_transaction"
  | "apply_reserve_move"
  | "propose_trade"
  | "withdraw_trade";

export const yahooProvider = Effect.gen(function* () {
  const internet = yield* PublicInternet;
  const sdk = yield* yahooSdkContext(internet);

  const validateSession = Effect.fn("YahooProvider.validateSession")(function* (
    input: ProviderSessionMaterial,
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "validate_session");
    const cookie = yield* sessionCookie(input, "validate_session");
    yield* validateSessionThroughSdk(sdk, "validate_session", cookie);
  });

  const discoverTeams = Effect.fn("YahooProvider.discoverTeams")(function* (
    input: ProviderSessionMaterial,
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "discover_teams");
    const cookie = yield* sessionCookie(input, "discover_teams");
    const leagues = yield* discoverLeaguesThroughSdk(
      sdk,
      "discover_teams",
      cookie,
      supportedLeagues,
    );
    const teams = [...leagues]
      .sort(
        (left, right) =>
          supportedLeagues.indexOf(left.gameKey) - supportedLeagues.indexOf(right.gameKey),
      )
      .flatMap((league) =>
        league.teams.map((team): ProviderTeam => {
          const providerUrl = teamProviderUrl(team, league.gameKey);
          return {
            provider: key,
            providerTeamKey: team.teamKey,
            providerLeagueKey: team.leagueKey,
            league: league.gameKey,
            sport: leagueSport[league.gameKey],
            season: league.season,
            name: team.name,
            leagueName: league.name,
            ...(providerUrl === undefined ? {} : { providerUrl }),
          };
        }),
      );
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
    const payload = yield* readLeagueThroughSdk(sdk, "read_league", cookie, leagueKey);
    const settings = yield* leagueSettings(payload, input.sport);
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
    const period =
      input.period?.type === "week"
        ? { type: "week" as const, week: yield* ValidWeek(input.period.week) }
        : input.period;
    const roster = yield* readRosterThroughSdk(sdk, "read_roster", cookie, teamKey, period);
    yield* Effect.annotateCurrentSpan("provider.player_count", roster.players.length);
    return roster;
  });

  const readLeagueRosters = Effect.fn("YahooProvider.readLeagueRosters")(function* (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_league_rosters");
    const cookie = yield* sessionCookie(input, "read_league_rosters");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_league_rosters");
    const payload = yield* readJson(internet, {
      operation: "read_league_rosters",
      origin: readOrigin,
      path: `/fantasy/v2/league/${leagueKey}/teams;out=roster`,
      query: { format: "json" },
      cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(LeagueRostersPayload, payload, "read_league_rosters");
    if (decoded.league.league_key !== leagueKey) {
      return yield* responseMismatch({
        operation: "read_league_rosters",
        field: "league.league_key",
      });
    }
    const seen = new Set<string>();
    const rosters: ProviderLeagueRoster[] = [];
    for (const team of decoded.league.teams) {
      if (seen.has(team.team_key)) {
        return yield* responseMismatch({
          operation: "read_league_rosters",
          field: "league.teams.team_key",
        });
      }
      seen.add(team.team_key);
      rosters.push(yield* leagueRosterFromPayload(team, leagueKey));
    }
    if (rosters.length === 0) {
      return yield* responseMismatch({ operation: "read_league_rosters", field: "league.teams" });
    }
    const coverage = rosters[0]?.coverage;
    if (
      coverage === undefined ||
      rosters.some((roster) => !sameRosterCoverage(roster.coverage, coverage))
    ) {
      return yield* responseMismatch({
        operation: "read_league_rosters",
        field: "league.teams.roster.coverage",
      });
    }
    yield* Effect.annotateCurrentSpan({
      "provider.team_count": rosters.length,
      "provider.player_count": rosters.reduce((total, roster) => total + roster.players.length, 0),
    });
    return rosters.toSorted((left, right) =>
      left.providerTeamKey < right.providerTeamKey
        ? -1
        : left.providerTeamKey > right.providerTeamKey
          ? 1
          : 0,
    );
  });

  const readRosterSchedule = Effect.fn("YahooProvider.readRosterSchedule")(function* (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly period: ProviderSchedulePeriod;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_roster_schedule");
    const cookie = yield* sessionCookie(input, "read_roster_schedule");
    const teamKey = yield* ValidTeamKey(input.providerTeamKey, "read_roster_schedule");
    if (input.period.type === "week") {
      const week = yield* ValidWeek(input.period.week);
      const requested = { type: "week" as const, week };
      const payload = yield* readJson(internet, {
        operation: "read_roster_schedule",
        origin: readOrigin,
        path: `/fantasy/v2/team/${teamKey}/roster;week=${String(week)}/players;out=opponent`,
        query: { format: "json" },
        cookie,
        normalize: true,
      }).pipe(
        Effect.catchTag("provider.request_failed", (error) =>
          Effect.fail(
            error.status === 400
              ? ProviderPeriodMismatch.make({
                  operation: "read_roster_schedule",
                  requested,
                  covered: null,
                })
              : error,
          ),
        ),
      );
      const decoded = yield* decodePayload(TeamRosterPayload, payload, "read_roster_schedule");
      const players = yield* scheduleFromPayload(decoded, teamKey, requested);
      return { providerTeamKey: teamKey, period: input.period, dates: [], players };
    }
    const dates = yield* scheduleDates(input.period);
    const daily = yield* Effect.forEach(
      dates,
      (date) =>
        Effect.gen(function* () {
          const payload = yield* readJson(internet, {
            operation: "read_roster_schedule",
            origin: readOrigin,
            path: `/fantasy/v2/team/${teamKey}/roster;date=${date}/players;out=opponent`,
            query: { format: "json" },
            cookie,
            normalize: true,
          });
          const decoded = yield* decodePayload(TeamRosterPayload, payload, "read_roster_schedule");
          return yield* scheduleFromPayload(decoded, teamKey, { type: "date", date });
        }),
      { concurrency: maximumDayReadConcurrency },
    );
    yield* Effect.annotateCurrentSpan("provider.date_count", dates.length);
    return {
      providerTeamKey: teamKey,
      period: input.period,
      dates,
      players: mergeDailySchedules(daily),
    };
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

  const applyTransaction: ProviderShape["applyTransaction"] = Effect.fn(
    "YahooProvider.applyTransaction",
  )(function* (input) {
    yield* Effect.annotateCurrentSpan("provider.operation", "apply_transaction");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "apply_transaction");
    yield* ValidTeamKey(input.providerTeamKey, "apply_transaction");
    const adds = yield* ValidTransactionPlayerKeys(input.adds);
    const drops = yield* ValidTransactionPlayerKeys(input.drops);
    if (adds.length + drops.length === 0 || adds.length + drops.length > 2) {
      return yield* ProviderResponseInvalid.make({ operation: "apply_transaction" });
    }
    yield* Effect.annotateCurrentSpan({
      "provider.add_count": adds.length,
      "provider.drop_count": drops.length,
      "provider.faab_bid": input.faabBid === undefined ? "not_sent" : "sent",
    });
    return yield* writeToProvider(
      input,
      "apply_transaction",
      "POST",
      `/fantasy/v2/league/${leagueKey}/transactions`,
      transactionBody({
        providerTeamKey: input.providerTeamKey,
        adds,
        drops,
        faabBid: input.faabBid,
      }),
    );
  });

  const proposeTrade: ProviderShape["proposeTrade"] = Effect.fn("YahooProvider.proposeTrade")(
    function* (input) {
      yield* Effect.annotateCurrentSpan("provider.operation", "propose_trade");
      const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "propose_trade");
      yield* ValidTeamKey(input.providerTeamKey, "propose_trade");
      yield* ValidLeagueTeamKey(input.counterpartyTeamKey, leagueKey, "propose_trade");
      if (input.counterpartyTeamKey === input.providerTeamKey) {
        return yield* ProviderResponseInvalid.make({ operation: "propose_trade" });
      }
      const send = yield* ValidTradePlayerKeys(input.send);
      const receive = yield* ValidTradePlayerKeys(input.receive);
      const picks = yield* ValidTradePicks(
        input.picks,
        input.providerTeamKey,
        input.counterpartyTeamKey,
      );
      if (send.length + receive.length + picks.length === 0) {
        return yield* ProviderResponseInvalid.make({ operation: "propose_trade" });
      }
      yield* Effect.annotateCurrentSpan({
        "provider.send_count": send.length,
        "provider.receive_count": receive.length,
        "provider.pick_count": picks.length,
      });
      const cookie = yield* sessionCookie(input, "propose_trade");
      const crumb = yield* Effect.result(readCrumb(input, "propose_trade"));
      if (crumb._tag === "Failure") {
        if (crumb.failure._tag === "provider.session_rejected") {
          yield* Effect.annotateCurrentSpan("provider.outcome", "session_rejected");
          return yield* crumb.failure;
        }
        yield* Effect.annotateCurrentSpan("provider.outcome", "not_sent");
        return crumb.failure._tag === "provider.crumb_unavailable"
          ? { status: "not_sent" as const, reason: "session_incomplete" as const }
          : { status: "not_sent" as const, reason: "request_failed" as const };
      }
      const url = yahooWriteUrl(
        `/fantasy/v2/league/${leagueKey}/transactions`,
        Redacted.value(crumb.success.crumb),
        picks.length > 0 ? androidWriteOrigin : writeOrigin,
      );
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const response = yield* internet
            .request(
              new Request(url, {
                method: "POST",
                headers: {
                  accept: "application/json",
                  "content-type": "application/xml",
                  cookie,
                },
                body: tradeProposalBody({
                  providerTeamKey: input.providerTeamKey,
                  counterpartyTeamKey: input.counterpartyTeamKey,
                  send,
                  receive,
                  picks,
                  note: input.note,
                }),
              }),
              {
                timeoutMs: yahooWriteDeadlineMillis,
                maxResponseBytes: yahooWriteResponseLimitBytes,
              },
            )
            .pipe(Effect.catchTag("PublicInternetUnavailable", () => Effect.void));
          if (response === undefined) {
            yield* Effect.annotateCurrentSpan("provider.outcome", "unknown");
            return { status: "unknown" as const };
          }
          yield* Effect.annotateCurrentSpan("http.response.status_code", response.status);
          if (response.status === 401 || response.status === 403) {
            yield* Effect.annotateCurrentSpan({
              "provider.outcome": "session_rejected",
              "provider.refusal.status": response.status,
            });
            return yield* ProviderSessionRejected.make({
              operation: "propose_trade",
              status: response.status,
              ...(yield* providerRefusalDetail(response)),
            });
          }
          if (!response.ok) {
            const failure = yield* writeFailureOf(response);
            return failure.status === "accepted" ? { status: "unknown" as const } : failure;
          }
          const text = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: () => ProviderResponseInvalid.make({ operation: "propose_trade" }),
          });
          const transactionKey = pendingTradeKeyOf(text);
          if (transactionKey === undefined) {
            yield* Effect.annotateCurrentSpan("provider.outcome", "unknown");
            return { status: "unknown" as const };
          }
          yield* Effect.annotateCurrentSpan("provider.outcome", "accepted");
          return { status: "accepted" as const, transactionKey };
        }),
      );
    },
  );

  const withdrawTrade: ProviderShape["withdrawTrade"] = Effect.fn("YahooProvider.withdrawTrade")(
    function* (input) {
      yield* Effect.annotateCurrentSpan("provider.operation", "withdraw_trade");
      const transactionKey = yield* ValidTradeTransactionKey(
        input.transactionKey,
        "withdraw_trade",
      );
      return yield* writeToProvider(
        input,
        "withdraw_trade",
        "DELETE",
        `/fantasy/v2/transaction/${transactionKey}`,
        undefined,
      );
    },
  );

  const applyReserveMove: ProviderShape["applyReserveMove"] = Effect.fn(
    "YahooProvider.applyReserveMove",
  )(function* (input) {
    yield* Effect.annotateCurrentSpan("provider.operation", "apply_reserve_move");
    const teamKey = yield* ValidTeamKey(input.providerTeamKey, "apply_reserve_move");
    const target = yield* ValidNativeTarget(input.coverage, "apply_reserve_move");
    const playerKey = yield* ValidTransactionPlayerKey(
      input.providerPlayerKey,
      "apply_reserve_move",
    );
    const slot = yield* ValidSlot(input.slot);
    yield* Effect.annotateCurrentSpan("provider.reserve_slot", slot);
    return yield* writeToProvider(
      input,
      "apply_reserve_move",
      "PUT",
      `/fantasy/v2/team/${teamKey}/roster`,
      reserveMoveBody(target, playerKey, slot),
    );
  });

  const writeRoster = (
    input: ProviderSessionMaterial & { readonly providerTeamKey: string },
    operation: WriteOperation,
    body: string,
  ): Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid> =>
    Effect.gen(function* () {
      const teamKey = yield* ValidTeamKey(input.providerTeamKey, operation);
      return yield* writeToProvider(
        input,
        operation,
        "PUT",
        `/fantasy/v2/team/${teamKey}/roster`,
        body,
      );
    });

  const writeToProvider = (
    input: ProviderSessionMaterial,
    operation: WriteOperation,
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body: string | undefined,
  ): Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid> =>
    Effect.gen(function* () {
      const cookie = yield* sessionCookie(input, operation);
      const crumb = yield* Effect.result(readCrumb(input, operation));
      if (crumb._tag === "Failure") {
        if (crumb.failure._tag === "provider.session_rejected") {
          yield* Effect.annotateCurrentSpan("provider.outcome", "session_rejected");
          return yield* crumb.failure;
        }
        yield* Effect.annotateCurrentSpan("provider.outcome", "not_sent");
        return crumb.failure._tag === "provider.crumb_unavailable"
          ? { status: "not_sent" as const, reason: "session_incomplete" as const }
          : { status: "not_sent" as const, reason: "request_failed" as const };
      }
      const url = yahooWriteUrl(path, Redacted.value(crumb.success.crumb), writeOrigin);
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const response = yield* internet
            .request(
              new Request(url, {
                method,
                headers: {
                  accept: "application/json",
                  ...(body === undefined ? {} : { "content-type": "application/xml" }),
                  cookie,
                },
                ...(body === undefined ? {} : { body }),
              }),
              {
                timeoutMs: yahooWriteDeadlineMillis,
                maxResponseBytes: yahooWriteResponseLimitBytes,
              },
            )
            .pipe(Effect.catchTag("PublicInternetUnavailable", () => Effect.void));
          if (response === undefined) {
            yield* Effect.annotateCurrentSpan("provider.outcome", "unknown");
            return { status: "unknown" as const };
          }
          yield* Effect.annotateCurrentSpan("http.response.status_code", response.status);
          if (response.status === 401 || response.status === 403) {
            yield* Effect.annotateCurrentSpan({
              "provider.outcome": "session_rejected",
              "provider.refusal.status": response.status,
            });
            return yield* ProviderSessionRejected.make({
              operation,
              status: response.status,
              ...(yield* providerRefusalDetail(response)),
            });
          }
          if (response.ok) {
            yield* discardBody(response);
            yield* Effect.annotateCurrentSpan("provider.outcome", "accepted");
            return { status: "accepted" as const };
          }
          return yield* writeFailureOf(response);
        }),
      );
    });

  const writeFailureOf = (
    response: Response,
  ): Effect.Effect<ProviderWriteResult, ProviderResponseInvalid> =>
    Effect.gen(function* () {
      const detail = yield* providerErrorDetail(response);
      if (response.status === 404) {
        yield* Effect.annotateCurrentSpan("provider.outcome", "rejected");
        return {
          status: "rejected" as const,
          reason: "not_found" as const,
          httpStatus: response.status,
          ...detail,
        };
      }
      if (response.status === 408 || response.status === 429) {
        yield* Effect.annotateCurrentSpan("provider.outcome", "not_sent");
        return {
          status: "not_sent" as const,
          reason: "request_failed" as const,
          httpStatus: response.status,
          ...detail,
        };
      }
      if (response.status >= 500) {
        yield* discardBody(response);
        yield* Effect.annotateCurrentSpan("provider.outcome", "unknown");
        return { status: "unknown" as const };
      }
      yield* Effect.annotateCurrentSpan("provider.outcome", "rejected");
      return {
        status: "rejected" as const,
        reason: /premium/iu.test(detail.detail ?? "")
          ? ("premium_required" as const)
          : ("invalid_request" as const),
        httpStatus: response.status,
        ...detail,
      };
    });

  const readPlayerPeriod = Effect.fnUntraced(function* (input: {
    readonly cookie: string;
    readonly leagueKey: string;
    readonly playerKeys: ReadonlyArray<string>;
    readonly query: PlayerStatQuery;
    readonly ownership: boolean;
    readonly operation: "read_player_details" | "read_player_history";
  }) {
    const payload = yield* readJson(internet, {
      operation: input.operation,
      origin: readOrigin,
      path:
        `/fantasy/v2/league/${input.leagueKey}/players;player_keys=${input.playerKeys.join(",")}` +
        `;out=${input.ownership ? "stats,ownership" : "stats"}`,
      query: playerDetailQuery(input.query),
      cookie: input.cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(PlayerDetailsPayload, payload, input.operation);
    return yield* playerDetailsFromPayload(decoded, input.leagueKey, input.query);
  });

  const readPlayerDetails = Effect.fn("YahooProvider.readPlayerDetails")(function* (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerPlayerKeys: ReadonlyArray<string>;
      readonly sport: FantasySport;
      readonly period: ProviderStatPeriod;
      readonly currentPeriod: number | undefined;
      readonly seasonStart: string | undefined;
      readonly seasonEnd: string | undefined;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_player_details");
    const cookie = yield* sessionCookie(input, "read_player_details");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_player_details");
    const playerKeys = yield* ValidPlayerKeys(input.providerPlayerKeys, "read_player_details");
    const resolution = yield* resolvePlayerPeriod({
      operation: "read_player_details",
      period: input.period,
      support: yahooCapabilities.statPeriods[input.sport],
      currentPeriod: input.currentPeriod,
      seasonStart: input.seasonStart,
      seasonEnd: input.seasonEnd,
      fantasyDay: yahooCapabilities.fantasyDay,
      now: yield* DateTime.now,
    });
    if (resolution.kind === "single") {
      const details = yield* readPlayerPeriod({
        cookie,
        leagueKey,
        playerKeys,
        query: resolution.query,
        ownership: true,
        operation: "read_player_details",
      });
      yield* Effect.annotateCurrentSpan({
        "provider.player_count": details.length,
        "provider.stat_basis": resolution.query.type,
      });
      return details;
    }
    const daily = yield* Effect.forEach(
      resolution.days,
      (date) =>
        readPlayerPeriod({
          cookie,
          leagueKey,
          playerKeys,
          query: { type: "date", date },
          ownership: date === resolution.days[resolution.days.length - 1],
          operation: "read_player_details",
        }).pipe(Effect.map((details) => ({ date, details }))),
      { concurrency: maximumDayReadConcurrency },
    );
    const details = aggregateDailyDetails(
      daily,
      resolution.start,
      resolution.end,
      resolution.days.length,
      input.sport,
    );
    yield* Effect.annotateCurrentSpan({
      "provider.player_count": details.length,
      "provider.stat_basis": "date_range",
      "provider.day_count": resolution.days.length,
    });
    return details;
  });

  const readPlayerWeeks = Effect.fn("YahooProvider.readPlayerWeeks")(function* (input: {
    readonly provider: ProviderKey;
    readonly session: Redacted.Redacted<string>;
    readonly providerLeagueKey: string;
    readonly providerPlayerKeys: ReadonlyArray<string>;
    readonly week: ProviderScoringWeek;
  }) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_player_weeks");
    const cookie = yield* sessionCookie(input, "read_player_weeks");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_player_weeks");
    const playerKeys = yield* ValidBatchPlayerKeys(input.providerPlayerKeys);
    const weeks: Array<ProviderPlayerWeekFact> = [];
    for (let index = 0; index < playerKeys.length; index += maximumSelectedPlayers) {
      const chunk = playerKeys.slice(index, index + maximumSelectedPlayers);
      const payload = yield* readJson(internet, {
        operation: "read_player_weeks",
        origin: readOrigin,
        path:
          `/fantasy/v2/league/${leagueKey}/players;player_keys=${chunk.join(",")}` +
          ";out=ranks,opponent;ranks=projected_week",
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const decoded = yield* decodePayload(PlayerDetailsPayload, payload, "read_player_weeks");
      if (decoded.league.league_key !== leagueKey) {
        return yield* responseMismatch({
          operation: "read_player_weeks",
          field: "league.league_key",
        });
      }
      for (const player of decoded.league.players) {
        weeks.push(playerWeekOf(player, input.week.week));
      }
    }
    yield* Effect.annotateCurrentSpan("provider.player_week_count", weeks.length);
    return weeks;
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
      const query = historyQuery(input.sport, period, input.currentPeriod);
      const details: Array<ProviderPlayerDetail> = [];
      for (let index = 0; index < playerKeys.length; index += maximumSelectedPlayers) {
        const chunkDetails = yield* readPlayerPeriod({
          cookie,
          leagueKey,
          playerKeys: playerKeys.slice(index, index + maximumSelectedPlayers),
          query,
          ownership: true,
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
        `;out=percent_started,percent_owned,ranks;ranks=${playerRankTypes.join(",")}`,
      query: {
        format: "json",
        "percent_started.cut_types": communityStartRateCut,
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
    const stat = yield* ValidSearchStat(input.sort, input.statId, input.statType);
    const players = yield* searchPlayersThroughSdk(sdk, "search_players", cookie, {
      leagueKey,
      season: input.season,
      query,
      availability: input.availability,
      sort: input.sort,
      statType: stat.statType,
      statId: stat.statId,
      limit,
    });
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
    const matchups = yield* readMatchupsThroughSdk(
      sdk,
      "read_matchups",
      cookie,
      leagueKey,
      week,
    ).pipe(Effect.map((decoded) => providerMatchupsOf(decoded, input.period)));
    yield* Effect.annotateCurrentSpan("provider.matchup_count", matchups.length);
    return matchups;
  });

  const readTransactions = Effect.fn("YahooProvider.readTransactions")(function* (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKey: string | undefined;
      readonly limit: number;
      readonly offset?: number;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_transactions");
    const cookie = yield* sessionCookie(input, "read_transactions");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_transactions");
    const limit = yield* ValidTransactionLimit(input.limit);
    const offset = yield* ValidTransactionOffset(input.offset ?? 0);
    yield* ValidLeagueTeamKey(input.providerTeamKey, leagueKey, "read_transactions");
    const decoded = yield* readTransactionsThroughSdk(sdk, "read_transactions", cookie, {
      leagueKey,
      teamKey: input.providerTeamKey,
      limit,
      offset,
    });
    const transactions = decoded.map(providerTransactionOf);
    yield* Effect.annotateCurrentSpan("provider.transaction_count", transactions.length);
    return transactions;
  });

  const readCompletedTrades = Effect.fn("YahooProvider.readCompletedTrades")(function* (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKey: string;
      readonly limit: number;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_completed_trades");
    const cookie = yield* sessionCookie(input, "read_completed_trades");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_completed_trades");
    const limit = yield* ValidTransactionLimit(input.limit);
    const teamFilter = yield* ValidLeagueTeamKey(
      input.providerTeamKey,
      leagueKey,
      "read_completed_trades",
    );
    const payload = yield* readJson(internet, {
      operation: "read_completed_trades",
      origin: readOrigin,
      path: `/fantasy/v2/league/${leagueKey}/transactions;type=trade${teamFilter};count=${String(limit)}`,
      query: { format: "json" },
      cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(TransactionsPayload, payload, "read_completed_trades");
    if (decoded.league.league_key !== leagueKey) {
      return yield* responseMismatch({
        operation: "read_completed_trades",
        field: "league.league_key",
      });
    }
    const trades = (yield* decodeTransactions(decoded.league.transactions)).filter(
      (transaction) => transaction.type === "trade",
    );
    yield* Effect.annotateCurrentSpan("provider.completed_trade_count", trades.length);
    return trades;
  });

  const readPendingTrades = Effect.fn("YahooProvider.readPendingTrades")(function* (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKey: string;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_pending_trades");
    const cookie = yield* sessionCookie(input, "read_pending_trades");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_pending_trades");
    yield* ValidLeagueTeamKey(input.providerTeamKey, leagueKey, "read_pending_trades");
    const decoded = yield* readPendingTradesThroughSdk(
      sdk,
      "read_pending_trades",
      cookie,
      leagueKey,
      input.providerTeamKey,
    );
    const offers = decoded.map(providerPendingTradeOf);
    yield* Effect.annotateCurrentSpan("provider.pending_trade_count", offers.length);
    return offers;
  });

  const readDraftResults = Effect.fn("YahooProvider.readDraftResults")(function* (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_draft_results");
    const cookie = yield* sessionCookie(input, "read_draft_results");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_draft_results");
    const decoded = yield* readDraftResultsThroughSdk(sdk, "read_draft_results", cookie, leagueKey);
    const picks = decoded.map(providerDraftPickOf);
    yield* Effect.annotateCurrentSpan("provider.draft_pick_count", picks.length);
    return picks;
  });

  const readLeagueTeams = Effect.fn("YahooProvider.readLeagueTeams")(function* (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_league_teams");
    const cookie = yield* sessionCookie(input, "read_league_teams");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_league_teams");
    return yield* readLeagueTeamsThroughSdk(sdk, "read_league_teams", cookie, leagueKey);
  });

  const readAvailableDraftPicks = Effect.fn("YahooProvider.readAvailableDraftPicks")(function* (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKeys: ReadonlyArray<string>;
    },
  ) {
    yield* Effect.annotateCurrentSpan("provider.operation", "read_available_draft_picks");
    const cookie = yield* sessionCookie(input, "read_available_draft_picks");
    const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_available_draft_picks");
    if (
      input.providerTeamKeys.length === 0 ||
      input.providerTeamKeys.length > maximumDraftPickTeams ||
      new Set(input.providerTeamKeys).size !== input.providerTeamKeys.length
    ) {
      return yield* ProviderResponseInvalid.make({ operation: "read_available_draft_picks" });
    }
    const teamKeys = yield* Effect.forEach(input.providerTeamKeys, (teamKey) =>
      ValidTeamKey(teamKey, "read_available_draft_picks"),
    );
    if (teamKeys.some((teamKey) => providerLeagueKey(teamKey) !== leagueKey)) {
      return yield* ProviderResponseInvalid.make({ operation: "read_available_draft_picks" });
    }
    const payload = yield* readJson(internet, {
      operation: "read_available_draft_picks",
      origin: androidReadOrigin,
      path: `/fantasy/v2/league/${leagueKey}/teams;team_keys=${teamKeys.join(",")};out=available_draft_picks`,
      query: { format: "json" },
      cookie,
      normalize: true,
    });
    const decoded = yield* decodePayload(
      AvailableDraftPicksPayload,
      payload,
      "read_available_draft_picks",
    );
    const requested = new Set(teamKeys);
    if (
      decoded.league.league_key !== leagueKey ||
      decoded.league.teams.length !== teamKeys.length ||
      decoded.league.teams.some((team) => !requested.has(team.team_key))
    ) {
      return yield* responseMismatch({ operation: "read_available_draft_picks" });
    }
    yield* Effect.annotateCurrentSpan(
      "provider.draft_pick_team_count",
      decoded.league.teams.length,
    );
    return decoded.league.teams.flatMap((team) =>
      team.available_draft_picks.picks.map(({ pick }) => ({
        providerTeamKey: team.team_key,
        round: pick.round,
      })),
    );
  });

  return {
    key,
    capabilities: yahooCapabilities,
    validateSession,
    discoverTeams,
    readLeague,
    readStandings,
    readRoster,
    readLeagueRosters,
    readRosterSchedule,
    applyNativeAction,
    applyExplicitAssignments,
    applyTransaction,
    proposeTrade,
    withdrawTrade,
    applyReserveMove,
    readPlayerDetails,
    readPlayerHistory,
    readPlayerWeeks,
    searchPlayers,
    readMatchups,
    readTransactions,
    readCompletedTrades,
    readPendingTrades,
    readDraftResults,
    readAvailableDraftPicks,
    readLeagueTeams,
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
      }),
  } satisfies ProviderShape;
});

const key = decodeProviderKey("yahoo");

class YahooCrumbUnavailable extends Schema.TaggedError<
  YahooCrumbUnavailable,
  { readonly brand: unique symbol }
>()("provider.crumb_unavailable", {
  operation: Schema.Literals([
    "apply_native_action",
    "apply_explicit_assignments",
    "apply_transaction",
    "propose_trade",
    "withdraw_trade",
    "apply_reserve_move",
  ]),
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
        yield* Effect.annotateCurrentSpan("provider.refusal.status", response.status);
        return yield* ProviderSessionRejected.make({
          operation: request.operation,
          status: response.status,
          ...(yield* providerRefusalDetail(response)),
        });
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
        key !== "stats.date" &&
        key !== "percent_started.cut_types",
    )
  ) {
    throw new Error("Yahoo request contains an unsupported query field");
  }
  return url;
}

function yahooWriteUrl(path: string, crumb: string, origin: URL): URL {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("Yahoo write path must be a relative path without query or fragment");
  }
  const url = new URL(path, origin);
  if (
    url.origin !== origin.origin ||
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

function ValidTransactionPlayerKeys(
  keys: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, ProviderResponseInvalid> {
  const unique = new Set(keys);
  if (unique.size !== keys.length || !keys.every(isTransactionPlayerKey) || keys.length > 1) {
    return ProviderResponseInvalid.make({ operation: "apply_transaction" });
  }
  return Effect.succeed(keys);
}

function ValidTradePlayerKeys(
  keys: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, ProviderResponseInvalid> {
  const unique = new Set(keys);
  if (unique.size !== keys.length || !keys.every(isTransactionPlayerKey)) {
    return ProviderResponseInvalid.make({ operation: "propose_trade" });
  }
  return Effect.succeed(keys);
}

function ValidTradePicks(
  picks: ReadonlyArray<ProviderTradePick>,
  providerTeamKey: string,
  counterpartyTeamKey: string,
): Effect.Effect<ReadonlyArray<ProviderTradePick>, ProviderResponseInvalid> {
  const identities = new Set(picks.map((pick) => `${String(pick.round)}:${pick.sourceTeamKey}`));
  const valid = picks.every(
    (pick) =>
      Number.isSafeInteger(pick.round) &&
      pick.round >= 1 &&
      pick.sourceTeamKey !== pick.destinationTeamKey &&
      [providerTeamKey, counterpartyTeamKey].includes(pick.sourceTeamKey) &&
      [providerTeamKey, counterpartyTeamKey].includes(pick.destinationTeamKey),
  );
  return valid && identities.size === picks.length
    ? Effect.succeed(picks)
    : ProviderResponseInvalid.make({ operation: "propose_trade" });
}

function ValidTradeTransactionKey(
  key: string,
  operation: ProviderOperation,
): Effect.Effect<string, ProviderResponseInvalid> {
  return /^[0-9]+\.l\.[0-9]+\.pt\.[0-9]+$/u.test(key)
    ? Effect.succeed(key)
    : ProviderResponseInvalid.make({ operation });
}

function ValidTransactionPlayerKey(
  key: string,
  operation: ProviderOperation,
): Effect.Effect<string, ProviderResponseInvalid> {
  return isTransactionPlayerKey(key)
    ? Effect.succeed(key)
    : ProviderResponseInvalid.make({ operation });
}

function isTransactionPlayerKey(key: string): boolean {
  return /^[0-9]+\.p\.[0-9]+$/u.test(key);
}

function ValidSlot(slot: string): Effect.Effect<string, ProviderResponseInvalid> {
  return /^[A-Za-z0-9/+_-]{1,16}$/u.test(slot)
    ? Effect.succeed(slot)
    : ProviderResponseInvalid.make({ operation: "apply_reserve_move" });
}

function transactionBody(input: {
  readonly providerTeamKey: string;
  readonly adds: ReadonlyArray<string>;
  readonly drops: ReadonlyArray<string>;
  readonly faabBid: number | undefined;
}): string {
  const players = [
    ...input.adds.map((key) => transactionPlayerBody(key, "add", input.providerTeamKey)),
    ...input.drops.map((key) => transactionPlayerBody(key, "drop", input.providerTeamKey)),
  ];
  const type =
    input.adds.length > 0 && input.drops.length > 0
      ? "add/drop"
      : input.adds.length > 0
        ? "add"
        : "drop";
  const bid = input.faabBid === undefined ? "" : `<faab_bid>${String(input.faabBid)}</faab_bid>`;
  const roster =
    players.length === 1 ? (players[0] ?? "") : `<players>${players.join("")}</players>`;
  return `<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>${type}</type>${bid}${roster}</transaction></fantasy_content>`;
}

function transactionPlayerBody(
  playerKey: string,
  movement: "add" | "drop",
  providerTeamKey: string,
): string {
  const team = movement === "add" ? "destination_team_key" : "source_team_key";
  return `<player><player_key>${playerKey}</player_key><transaction_data><type>${movement}</type><${team}>${providerTeamKey}</${team}></transaction_data></player>`;
}

function tradeProposalBody(input: {
  readonly providerTeamKey: string;
  readonly counterpartyTeamKey: string;
  readonly send: ReadonlyArray<string>;
  readonly receive: ReadonlyArray<string>;
  readonly picks: ReadonlyArray<ProviderTradePick>;
  readonly note: string | undefined;
}): string {
  const players = [
    ...input.send.map((key) =>
      tradePlayerBody(key, input.providerTeamKey, input.counterpartyTeamKey),
    ),
    ...input.receive.map((key) =>
      tradePlayerBody(key, input.counterpartyTeamKey, input.providerTeamKey),
    ),
  ];
  const picks = input.picks.map(
    (pick) =>
      `<pick><source_team_key>${pick.sourceTeamKey}</source_team_key><destination_team_key>${pick.destinationTeamKey}</destination_team_key><round>${String(pick.round)}</round></pick>`,
  );
  const playersBody = players.length === 0 ? "" : `<players>${players.join("")}</players>`;
  const picksBody = picks.length === 0 ? "" : `<picks>${picks.join("")}</picks>`;
  const noteBody =
    input.note === undefined && picks.length > 0
      ? ""
      : `<trade_note>${xmlText(input.note ?? "")}</trade_note>`;
  return `<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>pending_trade</type><trader_team_key>${input.providerTeamKey}</trader_team_key><tradee_team_key>${input.counterpartyTeamKey}</tradee_team_key>${noteBody}${playersBody}${picksBody}</transaction></fantasy_content>`;
}

function tradePlayerBody(
  playerKey: string,
  sourceTeamKey: string,
  destinationTeamKey: string,
): string {
  return `<player><player_key>${playerKey}</player_key><transaction_data><type>pending_trade</type><source_team_key>${sourceTeamKey}</source_team_key><destination_team_key>${destinationTeamKey}</destination_team_key></transaction_data></player>`;
}

function xmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pendingTradeKeyOf(body: string): string | undefined {
  const payload = (() => {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return undefined;
    }
  })();
  return findPendingTradeKey(normalizeYahooJson(payload));
}

function findPendingTradeKey(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findPendingTradeKey(entry);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const record = value;
  const key = record["transaction_key"];
  if (
    record["type"] === "pending_trade" &&
    typeof key === "string" &&
    /^[0-9]+\.l\.[0-9]+\.pt\.[0-9]+$/u.test(key)
  ) {
    return key;
  }
  for (const entry of Object.values(record)) {
    const found = findPendingTradeKey(entry);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function reserveMoveBody(target: ProviderNativeTarget, playerKey: string, slot: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster>${coverageBody(target)}<players><player><player_key>${playerKey}</player_key><position>${slot}</position></player></players></roster></fantasy_content>`;
}

const refusalBodyLimitCharacters = 4_096;

function providerRefusalDetail(
  response: Response,
): Effect.Effect<{ readonly detail?: string }, never> {
  const body = response.body;
  if (body === null) {
    return Effect.succeed({});
  }
  return Effect.gen(function* () {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (text.length < refusalBodyLimitCharacters) {
      const next = yield* Effect.tryPromise({
        try: () => reader.read(),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined));
      if (next === undefined || next.done) {
        break;
      }
      text += decoder.decode(next.value, { stream: true });
    }
    yield* Effect.promise(() => reader.cancel().catch(() => undefined));
    return refusalDetailOf(text);
  });
}

function refusalDetailOf(text: string): { readonly detail?: string } {
  const statement = providerStatement(withoutProviderSecrets(text))?.trim();
  return statement === undefined || statement.length === 0
    ? {}
    : { detail: statement.slice(0, 300) };
}

function providerErrorDetail(
  response: Response,
): Effect.Effect<{ readonly detail?: string }, never> {
  return Effect.tryPromise({ try: () => response.text(), catch: () => undefined }).pipe(
    Effect.map((text) => {
      const description = providerDescription(text);
      return description === undefined ? {} : { detail: description };
    }),
    Effect.orElseSucceed(() => ({})),
  );
}

function providerDescription(text: string): string | undefined {
  const readable = withoutProviderSecrets(text);
  return providerStatement(readable) ?? providerRawText(readable);
}

function providerStatement(text: string): string | undefined {
  const xml =
    /<(?:description|message)>([\s\S]*?)<\/(?:description|message)>/iu.exec(text)?.[1] ??
    /<error>([\s\S]*?)<\/error>/iu.exec(text)?.[1];
  const json = (() => {
    try {
      const payload: unknown = JSON.parse(text);
      if (typeof payload !== "object" || payload === null) {
        return undefined;
      }
      const error: unknown = Reflect.get(payload, "error");
      const errorCandidates: Array<unknown> =
        typeof error === "object" && error !== null
          ? [
              Reflect.get(error, "description"),
              Reflect.get(error, "message"),
              Reflect.get(error, "detail"),
            ]
          : [];
      const candidates: Array<unknown> = [
        typeof error === "string" ? error : undefined,
        ...errorCandidates,
        Reflect.get(payload, "description"),
        Reflect.get(payload, "message"),
        Reflect.get(payload, "detail"),
      ];
      return candidates.find(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate.trim().length > 0,
      );
    } catch {
      return undefined;
    }
  })();
  const statement = xml ?? json;
  if (statement === undefined) {
    return undefined;
  }
  const cleaned = statement
    .replace(/<[^>]*>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length === 0 ? undefined : cleaned.slice(0, 300);
}

function providerRawText(text: string): string | undefined {
  const readable = text.replace(/\s+/gu, " ").trim();
  return readable.length === 0 ? undefined : readable.slice(0, 300);
}

function withoutProviderSecrets(text: string): string {
  return text
    .replace(/\bcrumb=[^&"'\s<]*/giu, "crumb=<redacted>")
    .replace(/("crumb"\s*:\s*")[^"]*(")/giu, "$1<redacted>$2");
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
    yield* Effect.logWarning("Your league response did not match its decoder");
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

function providerLeagueKey(teamKey: string): string {
  return teamKey.slice(0, teamKey.lastIndexOf(".t."));
}

const teamPagePath = {
  basketball: "basketball",
  baseball: "baseball",
  football: "f1",
  hockey: "hockey",
} as const satisfies Readonly<Record<FantasySport, string>>;

function teamProviderUrl(
  team: { readonly teamKey: string; readonly url?: string | undefined },
  league: (typeof supportedLeagues)[number],
): string | undefined {
  const payloadUrl = httpsUrl(team.url);
  if (payloadUrl !== undefined) {
    return payloadUrl;
  }
  const leagueId = team.teamKey.slice(
    team.teamKey.indexOf(".l.") + ".l.".length,
    team.teamKey.lastIndexOf(".t."),
  );
  const teamId = team.teamKey.slice(team.teamKey.lastIndexOf(".t.") + ".t.".length);
  const sport = leagueSport[league];
  return `https://${reviewHosts[sport]}/${teamPagePath[sport]}/${leagueId}/${teamId}`;
}

function httpsUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function leagueSettings(
  settings: YahooLeagueSettings,
  sport: FantasySport,
): Effect.Effect<ProviderLeagueSettings, ProviderResponseInvalid | ProviderOperationUnsupported> {
  return Effect.gen(function* () {
    const periodWindow = yield* weekWindow(settings);
    const rosterCoverage = yield* declaredRosterCoverage(settings);
    const rosterPositions = settings.settings.rosterPositions.map(
      ({ position, positionType, count, isStartingPosition }) => {
        const kind = rosterSlotKind(position, isStartingPosition);
        return {
          position,
          positionType,
          kind,
          count,
          eligibility: kind === "bench" ? [] : [position],
        };
      },
    );
    const webUrl = yield* Effect.try({
      try: () => reviewBase(settings.url, sport, leagueIdFromKey(settings.leagueKey)).href,
      catch: () => ProviderResponseInvalid.make({ operation: "read_league", field: "league.url" }),
    }).pipe(Effect.tapError((error) => reportSchemaMismatch(error.field)));
    return {
      providerLeagueKey: settings.leagueKey,
      name: settings.name,
      webUrl,
      season: settings.season,
      startDate: settings.startDate,
      endDate: settings.endDate,
      currentDate: settings.currentDate,
      teamCount: settings.teamCount,
      format: leagueFormat(settings.scoringType, settings.settings.statModifiers.length),
      scoringType: settings.scoringType,
      scoringLabel: settings.scoringLabel,
      weeklyDeadline: settings.weeklyDeadline,
      rosterChange: rosterChange(settings),
      waiverType: settings.settings.waiverType,
      waiverRule: settings.settings.waiverRule,
      usesFaab: settings.settings.usesFaab,
      waiverDays: settings.settings.waiverTime,
      maxWeeklyAcquisitions: settings.settings.maxWeeklyAdds,
      maxSeasonAcquisitions: settings.settings.maxAdds,
      tradeEndDate: settings.settings.tradeEndDate,
      tradeRatification: tradeRatification(settings.settings.tradeRatifyType),
      tradeObjectionDays: settings.settings.tradeRejectTime,
      tradeDraftPicks: settings.settings.canTradeDraftPicks,
      draftStatus: settings.draftStatus,
      periodWindow,
      rosterCoverage,
      maxGamesPlayed: declaredLimit(settings.settings.maxGamesPlayed),
      maxInningsPitched: declaredLimit(settings.settings.maxInningsPitched),
      rosterConstraints: yahooRosterConstraints(rosterPositions),
      rosterPositions,
      statCategories: settings.settings.statCategories,
      statModifiers: settings.settings.statModifiers.map(({ statId, value }) => ({
        statId,
        points: String(value),
      })),
    };
  });
}

function declaredLimit(limit: number | undefined): number | undefined {
  return limit !== undefined && limit > 0 ? limit : undefined;
}

function tradeRatification(type: string | undefined): ProviderTradeRatification | undefined {
  switch (type) {
    case undefined:
      return undefined;
    case "vote":
      return "vote";
    case "commish":
      return "commissioner";
    case "none":
      return "none";
    default:
      return "unknown";
  }
}

function rosterChange(settings: YahooLeagueSettings): ProviderRosterChange | undefined {
  const deadline = settings.weeklyDeadline;
  if (deadline === undefined) {
    return undefined;
  }
  if (deadline === "intraday") {
    return {
      rule: "same_day",
      source: ["weekly_deadline"],
      detail: `Your league's weekly_deadline is "intraday", which means a roster move takes effect the same day.`,
    };
  }
  if (deadline === "game") {
    return {
      rule: "same_day",
      source: ["weekly_deadline"],
      detail: `Your league's weekly_deadline is "game", so a roster move takes effect at a player's game time that day.`,
    };
  }
  if (/^[1-7]$/u.test(deadline)) {
    return {
      rule: "weekly_lock",
      source: ["weekly_deadline"],
      detail: `Your league's weekly_deadline is "${deadline}", which names the weekly deadline day, so the league locks roster changes once a week.`,
    };
  }
  if (deadline !== "") {
    return undefined;
  }
  const editKey = settings.editKey;
  if (editKey === undefined) {
    return undefined;
  }
  if (/^\d+$/u.test(editKey)) {
    return {
      rule: "weekly_lock",
      source: ["weekly_deadline", "edit_key"],
      detail: `Your league's weekly_deadline is empty and its edit_key is ${JSON.stringify(editKey)}, a scoring week, so roster changes are locked to that week.`,
    };
  }
  const currentDate = settings.currentDate;
  if (!isCalendarDate(editKey) || currentDate === undefined || !isCalendarDate(currentDate)) {
    return undefined;
  }
  if (editKey === currentDate) {
    return {
      rule: "same_day",
      source: ["weekly_deadline", "edit_key"],
      detail: `Your league's weekly_deadline is empty and its edit_key is ${editKey}, your league's current_date, so a roster move takes effect the same day.`,
    };
  }
  if (nextCalendarDate(currentDate) === editKey) {
    return {
      rule: "next_day",
      source: ["weekly_deadline", "edit_key"],
      detail: `Your league's weekly_deadline is empty and its edit_key is ${editKey}, the day after your league's current_date ${currentDate}, so a roster move takes effect the next day.`,
    };
  }
  return undefined;
}

function isCalendarDate(value: string): boolean {
  const parsed = DateTime.make(`${value}T00:00:00.000Z`);
  return Option.isSome(parsed) && DateTime.formatIsoDate(parsed.value) === value;
}

function nextCalendarDate(value: string): string | undefined {
  const parsed = DateTime.make(`${value}T00:00:00.000Z`);
  return Option.isSome(parsed)
    ? DateTime.formatIsoDate(DateTime.add(parsed.value, { days: 1 }))
    : undefined;
}

function declaredRosterCoverage(
  settings: YahooLeagueSettings,
): Effect.Effect<ProviderCoverageKind, ProviderOperationUnsupported> {
  const deadline = settings.weeklyDeadline ?? "";
  const coverage = weeklyDeadlineCoverage[deadline] ?? editKeyCoverage(settings.editKey);
  if (coverage !== undefined) {
    return Effect.succeed(coverage);
  }
  return ProviderOperationUnsupported.make({
    operation: "read_league",
    reason: `The league declares weekly deadline ${JSON.stringify(deadline)} and editable period ${JSON.stringify(settings.editKey ?? null)}. Neither identifies a weekly or daily roster cadence, so this league's lineup period cannot be resolved.`,
  });
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

function yahooRosterConstraints(
  positions: ReadonlyArray<ProviderRosterPosition>,
): ProviderRosterConstraints {
  return {
    rosterMaximum: positions
      .filter((position) => position.kind !== "reserve")
      .reduce((total, position) => total + position.count, 0),
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
  };
}

function weekWindow(
  settings: YahooLeagueSettings,
): Effect.Effect<ProviderPeriodWindow | undefined, ProviderResponseInvalid> {
  const currentWeek = settings.currentWeek;
  const startWeek = settings.startWeek;
  const endWeek = settings.endWeek;
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

function leagueRosterFromPayload(
  team: (typeof LeagueRostersPayload.Type)["league"]["teams"][number],
  requestedLeagueKey: string,
): Effect.Effect<ProviderLeagueRoster, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    if (providerLeagueKey(team.team_key) !== requestedLeagueKey) {
      return yield* responseMismatch({
        operation: "read_league_rosters",
        field: "league.teams.team_key",
      });
    }
    const roster = team.roster;
    const entries = isReadonlyArray(roster)
      ? roster
      : "entries" in roster
        ? roster.entries
        : [roster];
    const players = entries.flatMap((entry) => entry.players);
    if (players.length === 0) {
      return yield* responseMismatch({
        operation: "read_league_rosters",
        field: `league.teams.${team.team_key}.roster.players`,
      });
    }
    const coverage = yield* leagueRosterCoverage(
      players,
      isReadonlyArray(roster) ? undefined : roster,
    );
    return {
      providerTeamKey: team.team_key,
      providerLeagueKey: requestedLeagueKey,
      name: team.name,
      coverage,
      players: players.map(toRosterPlayer),
    };
  });
}

function leagueRosterCoverage(
  players: ReadonlyArray<typeof LeagueRosterPlayerPayload.Type>,
  declared: typeof RosterCoverage.Type | undefined,
): Effect.Effect<ProviderRosterCoverage, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    const coverageTypes = new Set(players.map((player) => player.selected_position.coverage_type));
    const coverageType = [...coverageTypes][0];
    if (coverageTypes.size !== 1 || coverageType === undefined) {
      return yield* responseMismatch({ operation: "read_league_rosters" });
    }
    if (coverageType === "week") {
      const weeks = new Set(
        players.flatMap((player) =>
          player.selected_position.week === undefined ? [] : [player.selected_position.week],
        ),
      );
      if (weeks.size > 1) {
        return yield* responseMismatch({ operation: "read_league_rosters" });
      }
      const playerWeek = [...weeks][0];
      const declaredWeek = declared?.week;
      if (declaredWeek !== undefined && playerWeek !== undefined && declaredWeek !== playerWeek) {
        return yield* responseMismatch({ operation: "read_league_rosters" });
      }
      const week = declaredWeek ?? playerWeek;
      if (week === undefined) {
        return yield* responseMismatch({ operation: "read_league_rosters" });
      }
      return { type: "week" as const, week };
    }
    if (coverageType === "date") {
      const dates = new Set(
        players.flatMap((player) =>
          player.selected_position.date === undefined ? [] : [player.selected_position.date],
        ),
      );
      if (dates.size > 1) {
        return yield* responseMismatch({ operation: "read_league_rosters" });
      }
      const playerDate = [...dates][0];
      const declaredDate = declared?.date;
      if (declaredDate !== undefined && playerDate !== undefined && declaredDate !== playerDate) {
        return yield* responseMismatch({ operation: "read_league_rosters" });
      }
      const date = declaredDate ?? playerDate;
      if (date === undefined) {
        return yield* responseMismatch({ operation: "read_league_rosters" });
      }
      return { type: "date" as const, date };
    }
    return yield* responseMismatch({ operation: "read_league_rosters" });
  });
}

function sameRosterCoverage(left: ProviderRosterCoverage, right: ProviderRosterCoverage): boolean {
  return left.type === "week" && right.type === "week"
    ? left.week === right.week
    : left.type === "date" && right.type === "date"
      ? left.date === right.date
      : false;
}

function rosterPayloadRows(
  payload: typeof TeamRosterPayload.Type,
  requestedTeamKey: string,
): Effect.Effect<
  {
    readonly declared: typeof RosterCoverage.Type | undefined;
    readonly coverageType: string;
    readonly players: ReadonlyArray<typeof RosterPlayerPayload.Type>;
  },
  ProviderResponseInvalid
> {
  return Effect.gen(function* () {
    if (payload.team.team_key !== requestedTeamKey) {
      return yield* responseMismatch({ operation: "read_roster", field: "team.team_key" });
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
    const coverageTypes = new Set(players.map((player) => player.selected_position.coverage_type));
    const coverageType = [...coverageTypes][0];
    if (coverageTypes.size !== 1 || coverageType === undefined) {
      return yield* responseMismatch({ operation: "read_roster" });
    }
    return {
      declared: isReadonlyArray(roster) ? undefined : roster,
      coverageType,
      players,
    };
  });
}

function scheduleFromPayload(
  payload: typeof TeamRosterPayload.Type,
  requestedTeamKey: string,
  requested: ProviderRosterCoverage,
): Effect.Effect<
  ReadonlyArray<ProviderSchedulePlayer>,
  ProviderResponseInvalid | ProviderPeriodMismatch
> {
  return Effect.gen(function* () {
    const rows = yield* rosterPayloadRows(payload, requestedTeamKey);
    if (requested.type === "week") {
      const weeks = new Set(
        rows.players.flatMap((player) =>
          player.selected_position.week === undefined ? [] : [player.selected_position.week],
        ),
      );
      const playerWeek = [...weeks][0];
      const declaredWeek = rows.declared?.week;
      const week = declaredWeek ?? playerWeek;
      if (
        rows.coverageType !== "week" ||
        weeks.size > 1 ||
        (declaredWeek !== undefined && playerWeek !== undefined && declaredWeek !== playerWeek) ||
        week !== requested.week
      ) {
        return yield* ProviderPeriodMismatch.make({
          operation: "read_roster_schedule",
          requested,
          covered:
            rows.coverageType === "week" && week !== undefined ? { type: "week", week } : null,
        });
      }
      return rows.players.map((player) => toSchedulePlayer(player, gamesIn(player, undefined)));
    }
    const dates = new Set(
      rows.players.flatMap((player) =>
        player.selected_position.date === undefined ? [] : [player.selected_position.date],
      ),
    );
    const playerDate = [...dates][0];
    const declaredDate = rows.declared?.date;
    const date = declaredDate ?? playerDate;
    if (
      rows.coverageType !== "date" ||
      dates.size > 1 ||
      (declaredDate !== undefined && playerDate !== undefined && declaredDate !== playerDate) ||
      date !== requested.date
    ) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_roster_schedule",
        requested,
        covered: rows.coverageType === "date" && date !== undefined ? { type: "date", date } : null,
      });
    }
    return rows.players.map((player) => toSchedulePlayer(player, gamesIn(player, requested.date)));
  });
}

function toSchedulePlayer(
  player: typeof RosterPlayerPayload.Type,
  games: ReadonlyArray<ProviderScheduledGame>,
): ProviderSchedulePlayer {
  return {
    providerPlayerKey: player.player_key,
    name: player.name.full,
    proTeamKey: optionalNonEmpty(player.editorial_team_key ?? ""),
    proTeamAbbreviation: optionalNonEmpty(player.editorial_team_abbr ?? ""),
    games,
  };
}

function gamesIn(
  player: typeof RosterPlayerPayload.Type,
  date: string | undefined,
): ReadonlyArray<ProviderScheduledGame> {
  const opponent = scheduledOpponent(player.opponent);
  return opponent === undefined ? [] : [{ date, ...opponent }];
}

function mergeDailySchedules(
  days: ReadonlyArray<ReadonlyArray<ProviderSchedulePlayer>>,
): ReadonlyArray<ProviderSchedulePlayer> {
  const players = new Map<string, ProviderSchedulePlayer>();
  for (const day of days) {
    for (const player of day) {
      const existing = players.get(player.providerPlayerKey);
      players.set(
        player.providerPlayerKey,
        existing === undefined
          ? player
          : { ...player, games: [...existing.games, ...player.games] },
      );
    }
  }
  return [...players.values()];
}

function scheduleDates(period: {
  readonly start: string;
  readonly end: string;
}): Effect.Effect<ReadonlyArray<string>, ProviderOperationUnsupported | ProviderResponseInvalid> {
  if (!isProviderDate(period.start) || !isProviderDate(period.end) || period.start > period.end) {
    return ProviderResponseInvalid.make({ operation: "read_roster_schedule" });
  }
  const dates = calendarDays(period.start, period.end);
  if (dates.length > maximumScheduleDates) {
    return ProviderOperationUnsupported.make({
      operation: "read_roster_schedule",
      reason: `The scoring period ${period.start} to ${period.end} covers ${String(dates.length)} dates, above the ${String(maximumScheduleDates)}-date limit for one schedule read.`,
    });
  }
  return Effect.succeed(dates);
}

function toRosterPlayer(player: typeof LeagueRosterPlayerPayload.Type): ProviderRosterPlayer {
  const opponent = scheduledOpponent(player.opponent);
  return {
    providerPlayerKey: player.player_key,
    name: player.name.full,
    displayPosition: player.display_position,
    primaryPosition: player.primary_position,
    positionType: optionalNonEmpty(player.position_type),
    proTeamAbbreviation: optionalNonEmpty(player.editorial_team_abbr ?? ""),
    eligiblePositions: (player.eligible_positions ?? []).map(({ position }) => position),
    slot: rosterSlotOf(player.selected_position.position),
    isEditable: player.is_editable ?? null,
    injuryCode: optionalNonEmpty(player.status),
    injuryDetail: optionalNonEmpty(player.injury_note) ?? optionalNonEmpty(player.status_full),
    status: yahooPlayerStatus(optionalNonEmpty(player.status)),
    byeWeek: player.bye_weeks?.week ?? null,
    scheduled: opponent !== undefined,
    opponent,
    startingLineup: startingLineupOf(startingFlagOf(player.starting_status)),
    undroppable: player.is_undroppable ?? null,
    transactionTrend: transactionTrendOf(player.transactions),
  };
}

function startingFlagOf(
  status: ReadonlyArray<typeof StartingStatus.Type> | undefined,
): boolean | undefined {
  const starting = status?.find((entry) => entry.is_starting === 0 || entry.is_starting === 1);
  return starting === undefined ? undefined : starting.is_starting === 1;
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
    const week = entry.player_rank.rank_week;
    if (type !== undefined && Number.isInteger(rank) && rank > 0) {
      ranks.push({ type, rank, ...(week === undefined ? {} : { week }) });
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

const providerDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

const hockeyRateStatIds: ReadonlySet<number> = new Set([
  goalsAgainstAverageStatId,
  savePercentageStatId,
]);
const rateStatNotAggregated =
  "A rate or percentage is not summed across days; your league publishes this category only as a season total or a single date.";

const maximumDayReadConcurrency = 5;
const maximumScheduleDates = 21;

type PlayerStatQuery =
  | { readonly type: "season" }
  | { readonly type: "week"; readonly week: number }
  | { readonly type: "date"; readonly date: string };

type PlayerPeriodResolution =
  | { readonly kind: "single"; readonly query: PlayerStatQuery }
  | {
      readonly kind: "daily";
      readonly start: string;
      readonly end: string;
      readonly days: ReadonlyArray<string>;
    };

function playerDetailQuery(query: PlayerStatQuery): Record<string, string> {
  switch (query.type) {
    case "season":
      return { format: "json", "stats.type": "season" };
    case "week":
      return { format: "json", "stats.type": "week", "stats.week": String(query.week) };
    case "date":
      return { format: "json", "stats.type": "date", "stats.date": query.date };
  }
}

function resolvePlayerPeriod(input: {
  readonly operation: ProviderOperation;
  readonly period: ProviderStatPeriod;
  readonly support: ProviderPeriodSupport;
  readonly currentPeriod: number | undefined;
  readonly seasonStart: string | undefined;
  readonly seasonEnd: string | undefined;
  readonly fantasyDay: ProviderFantasyDay;
  readonly now: DateTime.Utc;
}): Effect.Effect<PlayerPeriodResolution, ProviderReadFailure> {
  return Effect.gen(function* () {
    const period = input.period;
    const mode = input.support.kinds[period.kind];
    if (mode === "unsupported") {
      return yield* unsupportedPeriod(input, input.support.detail);
    }
    switch (period.kind) {
      case "season":
        return { kind: "single" as const, query: { type: "season" as const } };
      case "week": {
        const week = yield* ValidWeek(period.week);
        if (input.currentPeriod === undefined || week >= input.currentPeriod) {
          return yield* unsupportedPeriod(
            input,
            `Your league publishes weekly player statistics only for a completed scoring week, and week ${String(week)} is the current or upcoming week.`,
          );
        }
        return { kind: "single" as const, query: { type: "week" as const, week } };
      }
      case "preset": {
        const window = input.support.presets.find((entry) => entry.preset === period.preset);
        if (window === undefined) {
          return yield* unsupportedPeriod(
            input,
            `Your league does not declare the \`${period.preset}\` window.`,
          );
        }
        const end = fantasyDayLabel(input.now, input.fantasyDay);
        const start = shiftDate(end, -(window.days - 1));
        return yield* dailyResolution(input, start, end);
      }
      case "range":
        if (!isProviderDate(period.start) || !isProviderDate(period.end)) {
          return yield* unsupportedPeriod(
            input,
            "The requested range is not a pair of calendar dates in `YYYY-MM-DD` form.",
          );
        }
        if (period.start > period.end) {
          return yield* unsupportedPeriod(input, "The requested range ends before it starts.");
        }
        if (
          input.seasonStart !== undefined &&
          input.seasonEnd !== undefined &&
          period.start <= input.seasonStart &&
          period.end >= input.seasonEnd
        ) {
          yield* Effect.annotateCurrentSpan("provider.period_served_as", "season");
          return { kind: "single" as const, query: { type: "season" as const } };
        }
        if (
          (input.seasonEnd !== undefined && period.start > input.seasonEnd) ||
          (input.seasonStart !== undefined && period.end < input.seasonStart)
        ) {
          return yield* unsupportedPeriod(
            input,
            `The requested range is outside the league's declared season (${input.seasonStart ?? "unknown"} to ${input.seasonEnd ?? "unknown"}).`,
          );
        }
        return yield* dailyResolution(input, period.start, period.end);
    }
  });
}

function dailyResolution(
  input: {
    readonly support: ProviderPeriodSupport;
  } & Parameters<typeof unsupportedPeriod>[0],
  start: string,
  end: string,
): Effect.Effect<PlayerPeriodResolution, ProviderReadFailure> {
  return Effect.gen(function* () {
    const days = calendarDays(start, end);
    if (days.length > input.support.maximumRangeDays) {
      return yield* unsupportedPeriod(
        input,
        `The requested window covers ${String(days.length)} days, and your league serves an explicit window of at most ${String(input.support.maximumRangeDays)} days.`,
      );
    }
    return { kind: "daily" as const, start, end, days };
  });
}

function unsupportedPeriod(
  input: {
    readonly operation: ProviderOperation;
    readonly period: ProviderStatPeriod;
    readonly support: ProviderPeriodSupport;
  },
  reason: string,
): Effect.Effect<never, ProviderPeriodUnsupported> {
  const alternatives = servedAlternatives(input.support);
  return ProviderPeriodUnsupported.make({
    operation: input.operation,
    kind: input.period.kind,
    declared: input.support.kinds[input.period.kind],
    reason,
    remedy:
      alternatives.length === 0
        ? "Your league serves no player-statistics period for this sport."
        : `Ask for one of: ${alternatives.join(", ")}.`,
  });
}

function servedAlternatives(support: ProviderPeriodSupport): ReadonlyArray<string> {
  const alternatives: Array<string> = [];
  if (support.kinds.season !== "unsupported") {
    alternatives.push('`kind: "season"` for season totals');
  }
  if (support.kinds.week !== "unsupported") {
    alternatives.push('`kind: "week"` with a completed scoring week');
  }
  if (support.kinds.preset !== "unsupported" && support.presets.length > 0) {
    alternatives.push(
      `\`kind: "preset"\` with ${support.presets.map((entry) => `\`${entry.preset}\``).join(", ")}`,
    );
  }
  if (support.kinds.range !== "unsupported") {
    alternatives.push(
      `\`kind: "range"\` with an explicit \`start\` and \`end\` of at most ${String(support.maximumRangeDays)} days`,
    );
  }
  return alternatives;
}

function aggregateDailyDetails(
  days: ReadonlyArray<{
    readonly date: string;
    readonly details: ReadonlyArray<ProviderPlayerDetail>;
  }>,
  start: string,
  end: string,
  windowDays: number,
  sport: FantasySport,
): ReadonlyArray<ProviderPlayerDetail> {
  const basis: ProviderStatBasis = { type: "date_range", start, end, days: windowDays };
  const rateStatIds = sport === "hockey" ? hockeyRateStatIds : new Set<number>();
  const players = new Map<
    string,
    { head: ProviderPlayerDetail; sums: Map<number, number | null> }
  >();
  for (const day of days) {
    for (const detail of day.details) {
      const entry = players.get(detail.providerPlayerKey) ?? { head: detail, sums: new Map() };
      entry.head = detail;
      for (const stat of detail.actual?.stats ?? []) {
        if (rateStatIds.has(stat.statId)) {
          entry.sums.set(stat.statId, null);
        } else if (stat.value !== null) {
          entry.sums.set(stat.statId, (entry.sums.get(stat.statId) ?? 0) + stat.value);
        } else if (!entry.sums.has(stat.statId)) {
          entry.sums.set(stat.statId, null);
        }
      }
      players.set(detail.providerPlayerKey, entry);
    }
  }
  return [...players.values()].map(({ head, sums }) => ({
    ...head,
    actual:
      sums.size === 0
        ? undefined
        : {
            basis,
            stats: [...sums]
              .filter(([statId]) => !rateStatIds.has(statId))
              .map(([statId, value]) => ({ statId, value })),
            notAggregated: [...rateStatIds]
              .filter((statId) => sums.has(statId))
              .toSorted((left, right) => left - right)
              .map((statId): ProviderStatOmission => ({
                statId,
                detail: rateStatNotAggregated,
              })),
          },
  }));
}

function calendarDays(start: string, end: string): ReadonlyArray<string> {
  const days: Array<string> = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) {
    days.push(date);
  }
  return days;
}

function shiftDate(date: string, days: number): string {
  return DateTime.formatIsoDate(
    DateTime.add(DateTime.makeUnsafe(`${date}T00:00:00.000Z`), { days }),
  );
}

function isProviderDate(value: string): boolean {
  return (
    providerDatePattern.test(value) &&
    DateTime.formatIsoDate(DateTime.makeUnsafe(`${value}T00:00:00.000Z`)) === value
  );
}

function playerDetailsFromPayload(
  payload: typeof PlayerDetailsPayload.Type,
  requestedLeagueKey: string,
  query: PlayerStatQuery,
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
          : yield* statSeries(player.player_stats, query);
      details.push({
        providerPlayerKey: player.player_key,
        name: optionalNonEmpty(player.name?.full ?? ""),
        primaryPosition: optionalNonEmpty(player.primary_position ?? ""),
        displayPosition: optionalNonEmpty(player.display_position ?? ""),
        proTeam: optionalNonEmpty(player.editorial_team_abbr ?? ""),
        availabilityDetail: availabilityDetailOf(player),
        eligiblePositions:
          player.eligible_positions === undefined
            ? undefined
            : player.eligible_positions.map(({ position }) => position),
        rosterStatus: rosterStatusOf(player.ownership?.ownership_type),
        actual:
          series === undefined
            ? undefined
            : { basis: basisOfQuery(query), stats: series, notAggregated: [] },
        projected: undefined,
      });
    }
    return details;
  });
}

function basisOfQuery(query: PlayerStatQuery): ProviderStatBasis {
  switch (query.type) {
    case "season":
      return { type: "season" };
    case "week":
      return { type: "week", week: query.week };
    case "date":
      return { type: "date_range", start: query.date, end: query.date, days: 1 };
  }
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
          opponent: scheduledOpponent(player.opponent),
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

function playerWeekOf(
  player: typeof PlayerDetailPayload.Type,
  week: number,
): ProviderPlayerWeekFact {
  const opponent = scheduledOpponent(player.opponent);
  const projected = playerRanksOf(player.player_ranks).find((entry) => entry.type === "PW");
  return {
    providerPlayerKey: player.player_key,
    week,
    plays: opponent !== undefined,
    opponent,
    projectedRank:
      projected !== undefined && (projected.week === undefined || projected.week === week)
        ? projected.rank
        : undefined,
  };
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

function historyQuery(
  sport: FantasySport,
  period: ProviderScoringWeek,
  currentWeek: number | undefined,
): PlayerStatQuery {
  return sport === "football" && currentWeek !== undefined && period.week < currentWeek
    ? { type: "week", week: period.week }
    : { type: "season" };
}

function statSeries(
  stats: typeof PlayerStats.Type,
  query: PlayerStatQuery,
): Effect.Effect<
  ReadonlyArray<{ readonly statId: number; readonly value: number | null }>,
  ProviderResponseInvalid | ProviderPeriodMismatch
> {
  return Effect.gen(function* () {
    const coverage = stats.entries[0];
    if (
      stats.entries.length !== 1 ||
      coverage === undefined ||
      coverage.coverage_type !== query.type
    ) {
      return yield* responseMismatch({
        operation: "read_player_details",
        field: "player_stats",
      });
    }
    if (query.type === "week" && coverage.week !== query.week) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_player_details",
        requested: { type: "week", week: query.week },
        covered:
          coverage.week === undefined ? null : { type: "week" as const, week: coverage.week },
      });
    }
    if (query.type === "date" && coverage.date !== undefined && coverage.date !== query.date) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_player_details",
        requested: { type: "date", date: query.date },
        covered: { type: "date" as const, date: coverage.date },
      });
    }
    return stats.stats.map(({ stat }) => ({
      statId: stat.stat_id,
      value: providerNumber(stat.value),
    }));
  });
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
    acquisitionUsage: acquisitionUsageOf(team.number_of_moves, team.roster_adds),
    categoryTotals: (team.team_stats?.stats ?? []).map(statValue),
    categoryPoints: (team.team_points?.stats ?? []).map(statValue),
  };
}

function acquisitionUsageOf(
  seasonMoves: number | string | undefined,
  rosterAdds: typeof AcquisitionPayload.Type | undefined,
): ProviderAcquisitionUsage {
  const weeklyAdds = rosterAdds === undefined ? undefined : weeklyAddsOf(rosterAdds);
  return { seasonMoves: providerNumber(seasonMoves) ?? undefined, weeklyAdds };
}

function weeklyAddsOf(
  rosterAdds: typeof AcquisitionPayload.Type,
): ProviderAcquisitionUsage["weeklyAdds"] {
  const used = providerNumber(rosterAdds.value);
  if (used === null) {
    return undefined;
  }
  if (rosterAdds.coverage_type === "date") {
    return typeof rosterAdds.coverage_value === "string" &&
      isProviderDate(rosterAdds.coverage_value)
      ? { used, coverage: { type: "date", date: rosterAdds.coverage_value } }
      : undefined;
  }
  const week = providerNumber(rosterAdds.coverage_value);
  return week !== null && Number.isInteger(week) && week >= 1 && week <= 99
    ? { used, coverage: { type: "week", week } }
    : undefined;
}

function statValue(entry: typeof StatEntry.Type): ProviderStatValue {
  return { statId: entry.stat.stat_id, value: providerNumber(entry.stat.value) };
}

function providerMatchupsOf(
  matchups: ReadonlyArray<YahooMatchup>,
  period: ProviderScoringWeek,
): ReadonlyArray<ProviderMatchup> {
  return matchups.map((matchup) => ({
    period,
    home: providerTeamScoreOf(matchup.home),
    away: providerTeamScoreOf(matchup.away),
    status: matchup.status,
    isPlayoffs: matchup.isPlayoffs,
    isConsolation: matchup.isConsolation,
    isTied: matchup.isTied,
    weekStart: matchup.weekStart,
    weekEnd: matchup.weekEnd,
    categoryWinners: matchup.categoryWinners.map((winner): ProviderCategoryWinner => ({
      statId: winner.statId,
      winnerProviderTeamKey: winner.winnerTeamKey,
      isTied: winner.isTied,
    })),
  }));
}

function providerTeamScoreOf(team: YahooMatchup["home"]): ProviderTeamScore {
  return {
    providerTeamKey: team.teamKey,
    name: team.name,
    points: team.points,
    projectedPoints: team.projectedPoints,
    winProbability: team.winProbability,
    remainingGames: team.remainingGames,
    categoryTotals: team.stats,
  };
}

function decodeTransactions(
  transactions: ReadonlyArray<typeof TransactionPayload.Type>,
): Effect.Effect<ReadonlyArray<ProviderTransaction>, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    const decoded: ProviderTransaction[] = [];
    for (const transaction of transactions) {
      const occurredAt = yield* providerInstant(transaction.timestamp);
      const type = transactionType(transaction.type);
      const players = (transaction.players ?? []).map((player) => ({
        providerPlayerKey: player.player_key,
        movement: playerMovement(player.transaction_data),
        name: optionalNonEmpty(player.name?.full ?? ""),
        primaryPosition: optionalNonEmpty(player.primary_position ?? ""),
        displayPosition: optionalNonEmpty(player.display_position ?? ""),
        eligiblePositions:
          player.eligible_positions === undefined
            ? undefined
            : player.eligible_positions.map(({ position }) => position),
        proTeam: optionalNonEmpty(player.editorial_team_abbr ?? ""),
      }));
      const proposer = transactionTeam(transaction.trader_team_key, transaction.trader_team_name);
      const receiver = transactionTeam(transaction.tradee_team_key, transaction.tradee_team_name);
      const parties = transactionParties(type, proposer, receiver, players);
      const picks = (transaction.picks ?? []).map(({ pick }) => ({
        round: pick.round,
        from: transactionTeam(pick.source_team_key, pick.source_team_name),
        to: transactionTeam(pick.destination_team_key, pick.destination_team_name),
        original: transactionTeam(pick.original_team_key, pick.original_team_name),
      }));
      decoded.push({
        transactionKey: transaction.transaction_key,
        occurredAt,
        type,
        status: optionalNonEmpty(transaction.status ?? ""),
        parties,
        teams: transactionTeams(players, picks, parties),
        picks,
        players,
        incomplete: incompleteTransaction(type, players, picks),
      });
    }
    return decoded;
  });
}

function providerTransactionOf(transaction: YahooTransaction): ProviderTransaction {
  const players = transaction.players.map(providerTransactionPlayerOf);
  const parties = transactionParties(
    transaction.type,
    providerTransactionTeamOf(transaction.proposer),
    providerTransactionTeamOf(transaction.receiver),
    players,
  );
  const picks = transaction.picks.map(providerTransactionPickOf);
  return {
    transactionKey: transaction.transactionKey,
    occurredAt: transaction.occurredAt,
    type: transaction.type,
    status: transaction.status,
    parties,
    teams: transactionTeams(players, picks, parties),
    picks,
    players,
    incomplete: incompleteTransaction(transaction.type, players, picks),
  };
}

function providerPendingTradeOf(offer: YahooPendingTrade): ProviderPendingTrade {
  const players = offer.players.map(providerTransactionPlayerOf);
  const picks = offer.picks.map(providerTransactionPickOf);
  return {
    transactionKey: offer.transactionKey,
    proposedAt: offer.proposedAt,
    note: offer.note,
    canRespond: optionalFlag(offer.canRespond) ?? false,
    proposer: providerTransactionTeamOf(offer.proposer),
    receiver: providerTransactionTeamOf(offer.receiver),
    unusedRosterSpots: offer.unusedRosterSpots,
    players,
    picks,
    incomplete: incompletePendingTrade(players, picks),
  };
}

function providerTransactionPlayerOf(player: YahooTransactionPlayer): ProviderTransactionPlayer {
  return {
    providerPlayerKey: player.playerKey,
    movement: {
      kind: player.movement.kind,
      from: providerTransactionTeamOf(player.movement.from),
      to: providerTransactionTeamOf(player.movement.to),
    },
    name: player.name,
    primaryPosition: player.primaryPosition,
    displayPosition: player.displayPosition,
    eligiblePositions: player.eligiblePositions,
    proTeam: player.proTeamAbbreviation,
  };
}

function providerTransactionPickOf(
  pick: YahooTransactionPick,
): ProviderPendingTrade["picks"][number] {
  return {
    round: pick.round,
    from: providerTransactionTeamOf(pick.from),
    to: providerTransactionTeamOf(pick.to),
    original: providerTransactionTeamOf(pick.original),
  };
}

function providerTransactionTeamOf(
  team: YahooTransactionTeam | undefined,
): ProviderTransactionTeam | undefined {
  return team === undefined ? undefined : { providerTeamKey: team.teamKey, name: team.name };
}

function providerDraftPickOf(pick: YahooDraftPick): ProviderDraftPick {
  return {
    round: pick.round,
    pick: pick.pick,
    providerTeamKey: pick.teamKey,
    providerPlayerKey: pick.playerKey,
    ...(pick.name === undefined ? {} : { name: pick.name }),
  };
}

function incompletePendingTrade(
  players: ReadonlyArray<ProviderTransactionPlayer>,
  picks: ReadonlyArray<ProviderPendingTrade["picks"][number]>,
): ProviderTransactionIncomplete | undefined {
  if (players.length === 0 && picks.length === 0) {
    return {
      code: "no_movements",
      detail:
        "Your league published this offer with no player movements and no traded picks, so neither side can be shown.",
    };
  }
  for (const player of players) {
    if (player.movement.from === undefined || player.movement.to === undefined) {
      return {
        code: "movement_missing_party",
        detail: `Your league published an offer movement for ${playerLabel(player)} without both the team it left and the team it joined.`,
      };
    }
  }
  for (const pick of picks) {
    if (pick.from === undefined || pick.to === undefined) {
      return {
        code: "movement_missing_party",
        detail: `Your league published a round ${String(pick.round)} draft pick without both the team that sent it and the team that received it.`,
      };
    }
  }
  return undefined;
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
    case "pending_trade":
      return "pending_trade";
    default:
      return type.startsWith("commish") ? "commissioner" : "other";
  }
}

function playerMovement(
  data: (typeof TransactionPlayerPayload.Type)["transaction_data"],
): ProviderTransactionMovement {
  return {
    kind: movementKind(data.type),
    from: transactionTeam(data.source_team_key, data.source_team_name),
    to: transactionTeam(data.destination_team_key, data.destination_team_name),
  };
}

function movementKind(type: string): ProviderTransactionMovement["kind"] {
  switch (type) {
    case "add":
      return "add";
    case "drop":
      return "drop";
    case "trade":
      return "trade";
    case "pending_trade":
      return "pending_trade";
    default:
      return "other";
  }
}

function transactionTeam(
  providerTeamKey: string | undefined,
  name: string | undefined,
): ProviderTransactionTeam | undefined {
  return providerTeamKey === undefined
    ? undefined
    : { providerTeamKey, name: optionalNonEmpty(name ?? "") };
}

function transactionParties(
  type: ProviderTransaction["type"],
  proposer: ProviderTransactionTeam | undefined,
  receiver: ProviderTransactionTeam | undefined,
  players: ReadonlyArray<ProviderTransaction["players"][number]>,
): ProviderTransactionParties | undefined {
  const named = (team: ProviderTransactionTeam): ProviderTransactionTeam => {
    if (team.name !== undefined) {
      return team;
    }
    for (const player of players) {
      for (const movementTeam of [player.movement.from, player.movement.to]) {
        if (
          movementTeam?.providerTeamKey === team.providerTeamKey &&
          movementTeam.name !== undefined
        ) {
          return movementTeam;
        }
      }
    }
    return team;
  };
  if (proposer !== undefined || receiver !== undefined) {
    return {
      source: "provider",
      entries: [
        ...(proposer === undefined ? [] : [{ role: "proposer" as const, team: named(proposer) }]),
        ...(receiver === undefined ? [] : [{ role: "receiver" as const, team: named(receiver) }]),
      ],
    };
  }
  if (type !== "trade") {
    return undefined;
  }
  const entries: ProviderTransactionParty[] = [];
  for (const player of players) {
    for (const team of [player.movement.from, player.movement.to]) {
      if (
        team !== undefined &&
        !entries.some((entry) => entry.team.providerTeamKey === team.providerTeamKey)
      ) {
        entries.push({ role: "participant", team });
      }
    }
  }
  return entries.length === 0 ? undefined : { source: "player_movements", entries };
}

function transactionTeams(
  players: ReadonlyArray<ProviderTransaction["players"][number]>,
  picks: ReadonlyArray<ProviderTransaction["picks"][number]>,
  parties: ProviderTransactionParties | undefined,
): ReadonlyArray<ProviderTransactionTeam> {
  const teams = new Map<string, ProviderTransactionTeam>();
  const add = (team: ProviderTransactionTeam | undefined): void => {
    if (team === undefined) {
      return;
    }
    const existing = teams.get(team.providerTeamKey);
    if (existing === undefined || (existing.name === undefined && team.name !== undefined)) {
      teams.set(team.providerTeamKey, team);
    }
  };
  for (const player of players) {
    add(player.movement.from);
    add(player.movement.to);
  }
  for (const pick of picks) {
    add(pick.from);
    add(pick.to);
  }
  for (const party of parties?.entries ?? []) {
    add(party.team);
  }
  return [...teams.values()];
}

function incompleteTransaction(
  type: ProviderTransaction["type"],
  players: ReadonlyArray<ProviderTransaction["players"][number]>,
  picks: ReadonlyArray<ProviderTransaction["picks"][number]>,
): ProviderTransactionIncomplete | undefined {
  if (players.length === 0 && picks.length === 0) {
    return {
      code: "no_movements",
      detail:
        "Your league published this transaction with no player movements and no traded picks, so neither side can be reconstructed. This is not evidence that no assets moved.",
    };
  }
  for (const player of players) {
    const movement = player.movement;
    if (
      type === "trade" ||
      type === "pending_trade" ||
      movement.kind === "trade" ||
      movement.kind === "pending_trade"
    ) {
      if (
        movement.from === undefined ||
        movement.to === undefined ||
        movement.from.providerTeamKey === movement.to.providerTeamKey
      ) {
        return {
          code: "movement_missing_party",
          detail: `Your league published a trade movement for ${playerLabel(player)} without both the team it left and the team it joined, so neither side can be reconstructed.`,
        };
      }
      continue;
    }
    if (movement.kind === "add" && movement.to === undefined) {
      return {
        code: "movement_missing_party",
        detail: `Your league published an add for ${playerLabel(player)} without the team it joined, so the movement cannot be reconstructed.`,
      };
    }
    if (movement.kind === "drop" && movement.from === undefined) {
      return {
        code: "movement_missing_party",
        detail: `Your league published a drop for ${playerLabel(player)} without the team it left, so the movement cannot be reconstructed.`,
      };
    }
    if (movement.kind === "other") {
      return {
        code: "unknown_movement",
        detail: `Your league gave ${playerLabel(player)} a movement type this adapter cannot place on a team, so the movement cannot be reconstructed.`,
      };
    }
  }
  for (const pick of picks) {
    if (pick.from === undefined || pick.to === undefined) {
      return {
        code: "movement_missing_party",
        detail: `Your league published a round ${String(pick.round)} draft pick without both the team that sent it and the team that received it, so the pick's movement cannot be reconstructed.`,
      };
    }
  }
  const sendingTeams = new Set(
    [
      ...players.map((player) => player.movement.from?.providerTeamKey),
      ...picks.map((pick) => pick.from?.providerTeamKey),
    ].filter((providerTeamKey): providerTeamKey is string => providerTeamKey !== undefined),
  );
  if ((type === "trade" || type === "pending_trade") && sendingTeams.size === 1) {
    return {
      code: "trade_return_unpublished",
      detail: `Your league published no returning player and no traded draft pick for this ${type === "pending_trade" ? "offer" : "trade"}, so the return side cannot be reconstructed; do not treat this as a one-for-nothing trade.`,
    };
  }
  return undefined;
}

function playerLabel(player: ProviderTransaction["players"][number]): string {
  return player.name === undefined ? "a player" : `player ${JSON.stringify(player.name)}`;
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

function providerNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value === undefined || value === null || value.trim() === "" || value.trim() === "-") {
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

function isReadonlyArray<A>(value: ReadonlyArray<A> | A): value is ReadonlyArray<A> {
  return Array.isArray(value);
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

function ValidTransactionOffset(value: number): Effect.Effect<number, ProviderResponseInvalid> {
  return Number.isSafeInteger(value) && value >= 0
    ? Effect.succeed(value)
    : ProviderResponseInvalid.make({ operation: "read_transactions" });
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
  statType: ProviderStatBasis["type"],
): Effect.Effect<
  { readonly statId: number | undefined; readonly statType: "season" },
  ProviderReadFailure
> {
  if (statType !== "season") {
    return ProviderOperationUnsupported.make({
      operation: "search_players",
      reason:
        "The player collection publishes season ranks and season stat values only, so it cannot show a weekly ordering in the rows.",
    });
  }
  if (sort !== "stat") {
    return Effect.succeed({ statId: undefined, statType });
  }
  return statId !== undefined && Number.isSafeInteger(statId) && statId >= 1 && statId <= 1_000
    ? Effect.succeed({ statId, statType })
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

function availabilityDetailOf(player: {
  readonly status?: string | boolean | undefined;
  readonly status_full?: string | undefined;
  readonly injury_note?: string | undefined;
}): string | undefined {
  return (
    optionalNonEmpty(player.injury_note) ??
    optionalNonEmpty(player.status_full) ??
    (typeof player.status === "string" ? optionalNonEmpty(player.status) : undefined)
  );
}

const SessionCookie = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(8_192)),
  Schema.check(Schema.isPattern(/^[\x20-\x7e]+$/u)),
  Schema.check(Schema.isPattern(/=/u)),
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

const AcquisitionPayload = Schema.Struct({
  coverage_type: Schema.Literals(["week", "date"]),
  coverage_value: Schema.Union([Schema.Finite, Schema.String]),
  value: Schema.Union([Schema.Finite, Schema.String]),
});

const CrumbPayload = Schema.Struct({
  service: Schema.Struct({
    crumb: Schema.NullOr(Schema.String),
  }),
});

const StartingStatus = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  is_starting: Schema.optional(IntFromStringOrNumber),
});

const PlayerTransactions = Schema.Union([
  Schema.Struct({
    adds: Schema.optional(IntFromStringOrNumber),
    drops: Schema.optional(IntFromStringOrNumber),
  }),
  Schema.Array(
    Schema.Struct({
      adds: Schema.optional(IntFromStringOrNumber),
      drops: Schema.optional(IntFromStringOrNumber),
    }),
  ),
]);

const RosterPlayerFields = Schema.Struct({
  player_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.p\.[0-9]+$/u))),
  name: Schema.Struct({ full: Schema.NonEmptyString }),
  display_position: Schema.NonEmptyString,
  primary_position: Schema.NonEmptyString,
  position_type: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  editorial_team_key: Schema.optional(Schema.String),
  editorial_team_abbr: Schema.optional(Schema.String),
  selected_position: Schema.Struct({
    coverage_type: Schema.NonEmptyString,
    week: Schema.optional(IntFromStringOrNumber),
    date: Schema.optional(Schema.String),
    position: Schema.Union([Schema.NonEmptyString, Schema.Literal("")]),
    is_flex: Schema.optional(Flag),
  }),
  is_editable: Schema.optional(Flag),
  status: Schema.optional(Schema.String),
  status_full: Schema.optional(Schema.String),
  injury_note: Schema.optional(Schema.String),
  bye_weeks: Schema.optional(Schema.Struct({ week: IntFromStringOrNumber })),
  is_undroppable: Schema.optional(Flag),
});

const RosterPlayerPayload = Schema.Struct({
  ...RosterPlayerFields.fields,
  opponent: Schema.NullOr(Schema.String),
  starting_status: Schema.optional(Schema.Array(StartingStatus)),
  transactions: Schema.optional(PlayerTransactions),
});

const LeagueRosterPlayerPayload = Schema.Struct({
  ...RosterPlayerFields.fields,
  opponent: Schema.optional(Schema.NullOr(Schema.String)),
  starting_status: Schema.optional(Schema.Array(StartingStatus)),
  transactions: Schema.optional(PlayerTransactions),
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

const LeagueRosterEntry = Schema.Struct({
  ...RosterCoverage.fields,
  players: Schema.Array(LeagueRosterPlayerPayload),
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

const LeagueRostersPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    teams: Schema.Array(
      Schema.Struct({
        team_key: TeamKey,
        name: Schema.NonEmptyString,
        roster: Schema.Union([
          Schema.Array(LeagueRosterEntry),
          Schema.Struct({ ...RosterCoverage.fields, entries: Schema.Array(LeagueRosterEntry) }),
          LeagueRosterEntry,
        ]),
      }),
    ),
  }),
});
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
    value: Schema.Union([Schema.Finite, Schema.String, Schema.Null]),
  }),
});

const StatCoverageEntry = Schema.Struct({
  coverage_type: Schema.NonEmptyString,
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
  date: Schema.optional(Schema.String),
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
    rank_season: Schema.optional(IntFromStringOrNumber),
    rank_week: Schema.optional(IntFromStringOrNumber),
  }),
});

const PlayerDetailPayload = Schema.Struct({
  player_key: PlayerKey,
  name: Schema.optional(Schema.Struct({ full: Schema.optional(Schema.String) })),
  primary_position: Schema.optional(Schema.String),
  display_position: Schema.optional(Schema.String),
  editorial_team_abbr: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  ownership: Schema.optional(PlayerOwnership),
  percent_owned: Schema.optional(PercentOwned),
  percent_started: Schema.optional(PercentStartedPayload),
  player_ranks: Schema.optional(Schema.Array(PlayerRankPayload)),
  player_stats: Schema.optional(PlayerStats),
  status: Schema.optional(Schema.Union([Schema.String, Schema.Boolean])),
  status_full: Schema.optional(Schema.String),
  injury_note: Schema.optional(Schema.String),
  opponent: Schema.optional(Schema.NullOr(Schema.String)),
});

const PlayerDetailsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    players: Schema.Array(PlayerDetailPayload),
  }),
});

const ScoreboardPointsPayload = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  season: Schema.optional(IntFromStringOrNumber),
  total: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  stats: Schema.optional(Schema.Array(StatEntry)),
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

const TransactionPlayerPayload = Schema.Struct({
  player_key: PlayerKey,
  name: Schema.optional(Schema.Struct({ full: Schema.optional(Schema.String) })),
  editorial_team_abbr: Schema.optional(Schema.String),
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

const TransactionPickPayload = Schema.Struct({
  pick: Schema.Struct({
    round: IntFromStringOrNumber,
    source_team_key: Schema.optional(TeamKey),
    source_team_name: Schema.optional(Schema.String),
    destination_team_key: Schema.optional(TeamKey),
    destination_team_name: Schema.optional(Schema.String),
    original_team_key: Schema.optional(TeamKey),
    original_team_name: Schema.optional(Schema.String),
  }),
});

const TransactionPayload = Schema.Struct({
  transaction_key: Schema.optional(Schema.NonEmptyString),
  type: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  timestamp: IntFromStringOrNumber,
  trader_team_key: Schema.optional(TeamKey),
  trader_team_name: Schema.optional(Schema.String),
  tradee_team_key: Schema.optional(TeamKey),
  tradee_team_name: Schema.optional(Schema.String),
  picks: Schema.optional(Schema.Array(TransactionPickPayload)),
  players: Schema.optional(Schema.Array(TransactionPlayerPayload)),
});

const AvailableDraftPicksPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: LeagueKey,
    teams: Schema.Array(
      Schema.Struct({
        team_key: TeamKey,
        available_draft_picks: Schema.Struct({
          picks: Schema.Array(
            Schema.Struct({
              pick: Schema.Struct({ round: IntFromStringOrNumber }),
            }),
          ),
        }),
      }),
    ),
  }),
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
  number_of_moves: Schema.optional(Schema.Union([Schema.Finite, Schema.String])),
  roster_adds: Schema.optional(AcquisitionPayload),
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
