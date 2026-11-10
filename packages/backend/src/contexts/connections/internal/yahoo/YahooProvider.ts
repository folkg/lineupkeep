import { DateTime, Effect, Option, Redacted, Schema } from "effect";

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
  ProviderResponseInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderCategoryWinner,
  ProviderDraftPick,
  ProviderFantasyDay,
  ProviderGamesPlayed,
  ProviderLeagueSettings,
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

import { scoreYahooRoster, yahooCapabilities } from "./YahooLineup.ts";
import type { YahooPlayerFacts, YahooStartRateCut, YahooStartRateSummary } from "./YahooLineup.ts";
import type {
  YahooDraftPick,
  YahooGamesPlayed,
  YahooLeagueSettings,
  YahooMatchup,
  YahooPendingTrade,
  YahooPercentCut,
  YahooPlayerDetail,
  YahooPlayerRank,
  YahooTransaction,
  YahooTransactionPick,
  YahooTransactionPlayer,
  YahooTransactionTeam,
} from "./YahooSdk.ts";
import {
  applyExplicitAssignmentsThroughSdk,
  applyNativeActionThroughSdk,
  applyReserveMoveThroughSdk,
  applyTransactionThroughSdk,
  discoverLeaguesThroughSdk,
  proposeTradeThroughSdk,
  readAvailableDraftPicksThroughSdk,
  readDraftResultsThroughSdk,
  readLeagueTeamsThroughSdk,
  readLeagueThroughSdk,
  readLeagueRostersThroughSdk,
  readMatchupsThroughSdk,
  readPendingTradesThroughSdk,
  readPlayerDetailsRawThroughSdk,
  readPlayerDetailsThroughSdk,
  readRosterScheduleThroughSdk,
  readRosterThroughSdk,
  readStandingsThroughSdk,
  readTeamGamesPlayedThroughSdk,
  readTransactionsThroughSdk,
  scheduledOpponent,
  searchPlayersThroughSdk,
  validateSessionThroughSdk,
  withdrawTradeThroughSdk,
  yahooSdkContext,
} from "./YahooSdk.ts";

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
    const standings = yield* readStandingsThroughSdk(sdk, "read_standings", cookie, leagueKey);
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
    const rosters = yield* readLeagueRostersThroughSdk(
      sdk,
      "read_league_rosters",
      cookie,
      input.providerLeagueKey,
    );
    yield* Effect.annotateCurrentSpan({
      "provider.team_count": rosters.length,
      "provider.player_count": rosters.reduce((total, roster) => total + roster.players.length, 0),
    });
    return rosters;
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
      const players = yield* readRosterScheduleThroughSdk(
        sdk,
        "read_roster_schedule",
        cookie,
        teamKey,
        requested,
      ).pipe(
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
      return { providerTeamKey: teamKey, period: input.period, dates: [], players };
    }
    const dates = yield* scheduleDates(input.period);
    const daily = yield* Effect.forEach(
      dates,
      (date) =>
        readRosterScheduleThroughSdk(sdk, "read_roster_schedule", cookie, teamKey, {
          type: "date",
          date,
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
      yield* Effect.annotateCurrentSpan("provider.native_action", "start_active_players");
      const cookie = yield* sessionCookie(input, "apply_native_action");
      return yield* applyNativeActionThroughSdk(sdk, "apply_native_action", cookie, {
        teamKey: input.providerTeamKey,
        coverage: input.target,
      });
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
      yield* Effect.annotateCurrentSpan("provider.assignment_count", input.assignments.length);
      const cookie = yield* sessionCookie(input, "apply_explicit_assignments");
      return yield* applyExplicitAssignmentsThroughSdk(sdk, "apply_explicit_assignments", cookie, {
        teamKey: input.providerTeamKey,
        coverage: input.target,
        assignments: input.assignments.map((assignment) => ({
          playerKey: assignment.providerPlayerKey,
          slot: assignment.slot,
        })),
      });
    });

  const applyTransaction: ProviderShape["applyTransaction"] = Effect.fn(
    "YahooProvider.applyTransaction",
  )(function* (input) {
    yield* Effect.annotateCurrentSpan("provider.operation", "apply_transaction");
    const assets = yield* transactionAssetsOf(input.adds, input.drops);
    yield* Effect.annotateCurrentSpan({
      "provider.add_count": assets.add === undefined ? 0 : 1,
      "provider.drop_count": assets.drop === undefined ? 0 : 1,
      "provider.faab_bid": input.faabBid === undefined ? "not_sent" : "sent",
    });
    const cookie = yield* sessionCookie(input, "apply_transaction");
    return yield* applyTransactionThroughSdk(sdk, "apply_transaction", cookie, {
      leagueKey: input.providerLeagueKey,
      teamKey: input.providerTeamKey,
      add: assets.add,
      drop: assets.drop,
      faabBid: input.faabBid,
    });
  });

  const proposeTrade: ProviderShape["proposeTrade"] = Effect.fn("YahooProvider.proposeTrade")(
    function* (input) {
      yield* Effect.annotateCurrentSpan("provider.operation", "propose_trade");
      const sides = yield* tradePickSidesOf(
        input.picks,
        input.providerTeamKey,
        input.counterpartyTeamKey,
      );
      yield* Effect.annotateCurrentSpan({
        "provider.send_count": input.send.length,
        "provider.receive_count": input.receive.length,
        "provider.pick_count": input.picks.length,
      });
      const cookie = yield* sessionCookie(input, "propose_trade");
      return yield* proposeTradeThroughSdk(sdk, "propose_trade", cookie, {
        leagueKey: input.providerLeagueKey,
        traderTeamKey: input.providerTeamKey,
        tradeeTeamKey: input.counterpartyTeamKey,
        send: input.send,
        receive: input.receive,
        sendPicks: sides.send,
        receivePicks: sides.receive,
        note: input.note ?? "",
      });
    },
  );

  const withdrawTrade: ProviderShape["withdrawTrade"] = Effect.fn("YahooProvider.withdrawTrade")(
    function* (input) {
      yield* Effect.annotateCurrentSpan("provider.operation", "withdraw_trade");
      const cookie = yield* sessionCookie(input, "withdraw_trade");
      return yield* withdrawTradeThroughSdk(sdk, "withdraw_trade", cookie, input.transactionKey);
    },
  );

  const applyReserveMove: ProviderShape["applyReserveMove"] = Effect.fn(
    "YahooProvider.applyReserveMove",
  )(function* (input) {
    yield* Effect.annotateCurrentSpan("provider.operation", "apply_reserve_move");
    yield* Effect.annotateCurrentSpan("provider.reserve_slot", input.slot);
    const cookie = yield* sessionCookie(input, "apply_reserve_move");
    return yield* applyReserveMoveThroughSdk(sdk, "apply_reserve_move", cookie, {
      teamKey: input.providerTeamKey,
      coverage: input.coverage,
      playerKey: input.providerPlayerKey,
      slot: input.slot,
    });
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
      const details = yield* readPlayerDetailsThroughSdk(sdk, "read_player_details", cookie, {
        leagueKey,
        playerKeys,
        stats: resolution.query,
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
        readPlayerDetailsThroughSdk(sdk, "read_player_details", cookie, {
          leagueKey,
          playerKeys,
          stats: { type: "date", date },
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
      const details = yield* readPlayerDetailsRawThroughSdk(sdk, "read_player_weeks", cookie, {
        leagueKey,
        playerKeys: chunk,
        fields: ["ranks", "opponent"],
        ranks: ["projected_week"],
      });
      for (const player of details) {
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
        const chunkDetails = yield* readPlayerDetailsThroughSdk(
          sdk,
          "read_player_history",
          cookie,
          {
            leagueKey,
            playerKeys: playerKeys.slice(index, index + maximumSelectedPlayers),
            stats: query,
          },
        );
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
    const details = yield* readPlayerDetailsRawThroughSdk(sdk, "read_player_details", cookie, {
      leagueKey,
      playerKeys,
      fields: ["percent_started", "percent_owned", "ranks"],
      ranks: playerRankTypes,
      percentStartedCutTypes: [communityStartRateCut],
    });
    const rates = yield* playerFactsOf(details, input.coverage);
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
    const facts = yield* readTeamGamesPlayedThroughSdk(
      sdk,
      "read_league",
      cookie,
      leagueKey,
      teamKey,
    );
    const gamesPlayed = providerGamesPlayedOf(facts, input.pitcherSlot);
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
    const teamKey = yield* ValidLeagueTeamKey(
      input.providerTeamKey,
      leagueKey,
      "read_completed_trades",
    );
    const decoded = yield* readTransactionsThroughSdk(sdk, "read_completed_trades", cookie, {
      leagueKey,
      teamKey,
      limit,
      offset: 0,
      type: "trade",
    });
    const trades = decoded.map(providerTransactionOf);
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
    const teams = yield* readAvailableDraftPicksThroughSdk(
      sdk,
      "read_available_draft_picks",
      cookie,
      leagueKey,
      input.providerTeamKeys,
    );
    yield* Effect.annotateCurrentSpan("provider.draft_pick_team_count", teams.length);
    return teams.flatMap((team) =>
      team.picks.map(({ round }) => ({ providerTeamKey: team.teamKey, round })),
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

function transactionAssetsOf(
  adds: ReadonlyArray<string>,
  drops: ReadonlyArray<string>,
): Effect.Effect<
  { readonly add: string | undefined; readonly drop: string | undefined },
  ProviderResponseInvalid
> {
  const [add, ...moreAdds] = adds;
  const [drop, ...moreDrops] = drops;
  return moreAdds.length > 0 || moreDrops.length > 0
    ? ProviderResponseInvalid.make({ operation: "apply_transaction" })
    : Effect.succeed({ add, drop });
}

function tradePickSidesOf(
  picks: ReadonlyArray<ProviderTradePick>,
  traderTeamKey: string,
  tradeeTeamKey: string,
): Effect.Effect<
  { readonly send: ReadonlyArray<number>; readonly receive: ReadonlyArray<number> },
  ProviderResponseInvalid
> {
  const send: Array<number> = [];
  const receive: Array<number> = [];
  for (const pick of picks) {
    if (pick.sourceTeamKey === traderTeamKey && pick.destinationTeamKey === tradeeTeamKey) {
      send.push(pick.round);
    } else if (pick.sourceTeamKey === tradeeTeamKey && pick.destinationTeamKey === traderTeamKey) {
      receive.push(pick.round);
    } else {
      return ProviderResponseInvalid.make({ operation: "propose_trade" });
    }
  }
  return Effect.succeed({ send, receive });
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

function pitcherSlotOf(league: ProviderLeagueSettings): string | undefined {
  return ["P", "RP", "SP"].find((name) =>
    league.rosterPositions.some(
      (position) => position.kind === "starting" && position.position === name,
    ),
  );
}

function providerGamesPlayedOf(
  facts: ReadonlyArray<YahooGamesPlayed>,
  pitcherSlot: string | undefined,
): ReadonlyArray<ProviderGamesPlayed> {
  const rows: Array<ProviderGamesPlayed> = [];
  for (const fact of facts) {
    for (const position of fact.positions) {
      rows.push({
        position: position.position,
        played: position.played,
        max: position.max,
        projected: position.projected,
      });
    }
    const innings = fact.inningsPitched;
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
}

function playerRanksOf(ranks: ReadonlyArray<YahooPlayerRank>): ReadonlyArray<PlayerRank> {
  const mapped: Array<PlayerRank> = [];
  for (const rank of ranks) {
    const type = rankTypeMap[rank.type];
    if (
      type !== undefined &&
      rank.value !== null &&
      Number.isInteger(rank.value) &&
      rank.value > 0
    ) {
      mapped.push({
        type,
        rank: rank.value,
        ...(rank.week === undefined ? {} : { week: rank.week }),
      });
    }
  }
  return mapped;
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

function playerFactsOf(
  details: ReadonlyArray<YahooPlayerDetail>,
  expected: ProviderRosterCoverage,
): Effect.Effect<
  ReadonlyArray<YahooPlayerFacts>,
  ProviderResponseInvalid | ProviderPeriodMismatch
> {
  return Effect.gen(function* () {
    const rates: Array<YahooPlayerFacts> = [];
    for (const player of details) {
      const percentStarted = yield* communityStartRateOf(player.percentStarted, expected);
      if (percentStarted !== undefined) {
        rates.push({
          providerPlayerKey: player.playerKey,
          ...percentStarted,
          percentOwned: player.percentOwned?.value ?? null,
          percentOwnedDelta: player.percentOwned?.delta ?? null,
          ranks: playerRanksOf(player.ranks),
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

function playerWeekOf(player: YahooPlayerDetail, week: number): ProviderPlayerWeekFact {
  const opponent = scheduledOpponent(player.opponent);
  const projected = playerRanksOf(player.ranks).find((entry) => entry.type === "PW");
  return {
    providerPlayerKey: player.playerKey,
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
  percentStarted: YahooPlayerDetail["percentStarted"],
  expected: ProviderRosterCoverage,
): Effect.Effect<YahooStartRateSummary | undefined, ProviderPeriodMismatch> {
  return Effect.gen(function* () {
    if (percentStarted === undefined) {
      return undefined;
    }
    if (percentStarted.coverage !== undefined && !sameCoverage(percentStarted.coverage, expected)) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_player_details",
        requested: expected,
        covered: percentStarted.coverage,
      });
    }
    return {
      percent: percentStarted.value,
      cuts: (percentStarted.cuts ?? []).map((cut: YahooPercentCut): YahooStartRateCut => ({
        cut: cut.cut,
        percent: cut.value,
      })),
    };
  });
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
    movement: providerTransactionMovementOf(player.movement),
    name: player.name,
    primaryPosition: player.primaryPosition,
    displayPosition: player.displayPosition,
    eligiblePositions: player.eligiblePositions,
    proTeam: player.proTeamAbbreviation,
  };
}

function providerTransactionMovementOf(
  movement: YahooTransactionPlayer["movement"],
): ProviderTransactionMovement {
  return {
    kind: movement.kind,
    from: providerTransactionTeamOf(movement.from),
    to: providerTransactionTeamOf(movement.to),
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
    ? Effect.succeed(value)
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

const SessionCookie = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(8_192)),
  Schema.check(Schema.isPattern(/^[\x20-\x7e]+$/u)),
  Schema.check(Schema.isPattern(/=/u)),
);
