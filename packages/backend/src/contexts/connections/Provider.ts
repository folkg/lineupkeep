import { Schema } from "effect";
import type { Effect } from "effect";

import type { ProviderSessionEvidence } from "./Connection.ts";
import { FantasyLeague, FantasySport } from "./FantasyTeam.ts";
import type { LineupTargetPeriod } from "./LineupRun.ts";
import { ProviderKey } from "./ProviderKey.ts";
import type { LeagueFormat, StatPeriodKind } from "./QueryValues.ts";

const ProviderOperation = Schema.Literals([
  "validate_session",
  "discover_teams",
  "read_league",
  "read_standings",
  "read_roster",
  "read_league_rosters",
  "read_roster_schedule",
  "read_player_details",
  "read_player_history",
  "read_player_weeks",
  "search_players",
  "read_matchups",
  "read_transactions",
  "read_completed_trades",
  "read_pending_trades",
  "read_draft_results",
  "read_available_draft_picks",
  "read_league_teams",
  "apply_native_action",
  "apply_explicit_assignments",
  "apply_transaction",
  "propose_trade",
  "withdraw_trade",
  "apply_reserve_move",
]);
export type ProviderOperation = typeof ProviderOperation.Type;

export const ProviderSessionMaterial = Schema.Struct({
  provider: ProviderKey,
  session: Schema.Redacted(Schema.String),
});
export type ProviderSessionMaterial = typeof ProviderSessionMaterial.Type;

export const ProviderTeam = Schema.Struct({
  provider: ProviderKey,
  providerTeamKey: Schema.NonEmptyString,
  providerLeagueKey: Schema.NonEmptyString,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
  name: Schema.NonEmptyString,
  leagueName: Schema.optional(Schema.NonEmptyString),
  providerUrl: Schema.optional(Schema.NonEmptyString),
});
export type ProviderTeam = typeof ProviderTeam.Type;

export const ProviderFantasyDay = Schema.Struct({
  timeZone: Schema.NonEmptyString,
  boundary: Schema.Literal("local-midnight"),
  version: Schema.NonEmptyString,
});
export type ProviderFantasyDay = typeof ProviderFantasyDay.Type;

const ProviderLimitationSubject = Schema.Literals([
  "team_remaining_games",
  "per_team_games_played",
]);
export type ProviderLimitationSubject = typeof ProviderLimitationSubject.Type;

type ProviderLimitation = {
  readonly subject: ProviderLimitationSubject;
  readonly detail: string;
};

type ProviderTradeAsset = "player" | "draft_pick";

type ProviderTradeProposal = {
  readonly assets: ReadonlyArray<ProviderTradeAsset>;
  readonly detail: string;
};

type ProviderTransactionRequest = {
  readonly maximumAdds: number;
  readonly maximumDrops: number;
};

export type ProviderCapabilities = {
  readonly fantasyDay: ProviderFantasyDay;
  readonly sports: ReadonlyArray<FantasySport>;
  readonly playerSearch: {
    readonly sorts: ReadonlyArray<ProviderPlayerSearchSort>;
    readonly providerOrderedSorts: ReadonlyArray<ProviderPlayerSearchSort>;
    readonly weeklyOrderingValues: boolean;
  };
  readonly statPeriods: Readonly<Record<FantasySport, ProviderPeriodSupport>>;
  readonly scheduleRead: {
    readonly maximumDates: number;
  };
  readonly tradeProposal: ProviderTradeProposal;
  readonly transactionRequest: ProviderTransactionRequest;
  readonly projections: ProviderProjectionSupport;
  readonly limitations: ReadonlyArray<ProviderLimitation>;
};

type ProviderProjectionSupport = {
  readonly basis: "week";
  readonly sports: ReadonlyArray<FantasySport>;
};

type ProviderPeriodMode = "native" | "aggregated" | "unsupported";

type ProviderPeriodPresetWindow = {
  readonly preset: StatPeriodPresetName;
  readonly days: number;
};

export type ProviderPeriodSupport = {
  readonly kinds: Readonly<Record<StatPeriodKind, ProviderPeriodMode>>;
  readonly presets: ReadonlyArray<ProviderPeriodPresetWindow>;
  readonly maximumRangeDays: number;
  readonly detail: string;
};

const ProviderDate = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)));

export const ProviderRosterCoverage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("week"),
    week: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(99)),
  }),
  Schema.Struct({
    type: Schema.Literal("date"),
    date: ProviderDate,
  }),
]);
export type ProviderRosterCoverage = typeof ProviderRosterCoverage.Type;

export class ProviderSessionRejected extends Schema.TaggedError<
  ProviderSessionRejected,
  { readonly brand: unique symbol }
>()("provider.session_rejected", {
  operation: ProviderOperation,
  status: Schema.optional(Schema.Int),
  detail: Schema.optional(Schema.String),
}) {}

export function sessionEvidenceOf(error: ProviderSessionRejected): ProviderSessionEvidence {
  return {
    operation: error.operation,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.detail === undefined ? {} : { detail: error.detail }),
  };
}

export class ProviderRequestFailed extends Schema.TaggedError<
  ProviderRequestFailed,
  { readonly brand: unique symbol }
>()("provider.request_failed", {
  operation: ProviderOperation,
  status: Schema.optional(Schema.Int),
}) {}

export class ProviderResponseInvalid extends Schema.TaggedError<
  ProviderResponseInvalid,
  { readonly brand: unique symbol }
>()("provider.response_invalid", {
  operation: ProviderOperation,
  field: Schema.optional(Schema.String),
}) {}

export class ProviderOperationUnsupported extends Schema.TaggedError<
  ProviderOperationUnsupported,
  { readonly brand: unique symbol }
>()("provider.operation_unsupported", {
  operation: ProviderOperation,
  reason: Schema.String,
}) {}

export class ProviderPeriodMismatch extends Schema.TaggedError<
  ProviderPeriodMismatch,
  { readonly brand: unique symbol }
>()("provider.period_mismatch", {
  operation: ProviderOperation,
  requested: ProviderRosterCoverage,
  covered: Schema.NullOr(ProviderRosterCoverage),
}) {}

export class ProviderPeriodUnsupported extends Schema.TaggedError<
  ProviderPeriodUnsupported,
  { readonly brand: unique symbol }
>()("provider.period_unsupported", {
  operation: ProviderOperation,
  kind: Schema.Literals(["season", "week", "preset", "range"]),
  declared: Schema.Literals(["native", "aggregated", "unsupported"]),
  reason: Schema.String,
  remedy: Schema.String,
}) {}

export class ProviderUnregistered extends Schema.TaggedError<
  ProviderUnregistered,
  { readonly brand: unique symbol }
>()("provider.unregistered", {
  provider: Schema.String,
}) {}

export type ProviderFailure =
  | ProviderSessionRejected
  | ProviderRequestFailed
  | ProviderResponseInvalid;

export type ProviderReadFailure =
  | ProviderFailure
  | ProviderOperationUnsupported
  | ProviderPeriodMismatch
  | ProviderPeriodUnsupported;

export const ProviderReadFailureSchema = Schema.Union([
  ProviderSessionRejected,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderOperationUnsupported,
  ProviderPeriodMismatch,
  ProviderPeriodUnsupported,
]);

export type Provider = ProviderShape;

export type ProviderShape = {
  readonly key: ProviderKey;

  readonly capabilities: ProviderCapabilities;

  readonly validateSession: (
    input: ProviderSessionMaterial,
  ) => Effect.Effect<void, ProviderFailure>;

  readonly discoverTeams: (
    input: ProviderSessionMaterial,
  ) => Effect.Effect<ReadonlyArray<ProviderTeam>, ProviderFailure>;

  readonly readLeague: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly sport: FantasySport;
    },
  ) => Effect.Effect<ProviderLeagueSettings, ProviderReadFailure>;

  readonly readRoster: (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly period: ProviderRosterCoverage | undefined;
    },
  ) => Effect.Effect<ProviderRoster, ProviderReadFailure>;

  readonly readLeagueRosters: (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) => Effect.Effect<ReadonlyArray<ProviderLeagueRoster>, ProviderReadFailure>;

  readonly readRosterSchedule: (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly period: ProviderSchedulePeriod;
    },
  ) => Effect.Effect<ProviderRosterSchedule, ProviderReadFailure>;

  readonly applyNativeAction: (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly target: ProviderNativeTarget;
    },
  ) => Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid>;

  readonly applyExplicitAssignments: (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly target: ProviderNativeTarget;
      readonly assignments: ReadonlyArray<ProviderLineupAssignment>;
    },
  ) => Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid>;

  readonly applyTransaction: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKey: string;
      readonly adds: ReadonlyArray<string>;
      readonly drops: ReadonlyArray<string>;
      readonly faabBid: number | undefined;
    },
  ) => Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid>;

  readonly proposeTrade: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKey: string;
      readonly counterpartyTeamKey: string;
      readonly send: ReadonlyArray<string>;
      readonly receive: ReadonlyArray<string>;
      readonly picks: ReadonlyArray<ProviderTradePick>;
      readonly note: string | undefined;
    },
  ) => Effect.Effect<
    ProviderTradeProposalResult,
    ProviderSessionRejected | ProviderResponseInvalid
  >;

  readonly withdrawTrade: (
    input: ProviderSessionMaterial & { readonly transactionKey: string },
  ) => Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid>;

  readonly applyReserveMove: (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly coverage: ProviderNativeTarget;
      readonly providerPlayerKey: string;
      readonly slot: string;
    },
  ) => Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid>;

  readonly readPlayerDetails: (
    input: ProviderSessionMaterial & ProviderPlayerReadInput,
  ) => Effect.Effect<ReadonlyArray<ProviderPlayerDetail>, ProviderReadFailure>;
  readonly readPlayerWeeks: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerPlayerKeys: ReadonlyArray<string>;
      readonly week: ProviderScoringWeek;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderPlayerWeekFact>, ProviderReadFailure>;
  readonly readPlayerHistory: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerPlayerKeys: ReadonlyArray<string>;
      readonly sport: FantasySport;
      readonly periods: ReadonlyArray<ProviderScoringWeek>;
      readonly currentPeriod: number | undefined;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderPlayerPeriod>, ProviderReadFailure>;

  readonly searchPlayers: (
    input: ProviderPlayerSearchInput,
  ) => Effect.Effect<ProviderPlayerSearchResult, ProviderReadFailure>;

  readonly readMatchups: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly period: ProviderScoringWeek;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderMatchup>, ProviderReadFailure>;

  readonly readTransactions: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKey: string | undefined;
      readonly limit: number;
      readonly offset?: number;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderTransaction>, ProviderReadFailure>;

  readonly readCompletedTrades: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKey: string;
      readonly limit: number;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderTransaction>, ProviderReadFailure>;

  readonly readPendingTrades: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKey: string;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderPendingTrade>, ProviderReadFailure>;

  readonly readDraftResults: (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) => Effect.Effect<ReadonlyArray<ProviderDraftPick>, ProviderReadFailure>;

  readonly readAvailableDraftPicks: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKeys: ReadonlyArray<string>;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderAvailableDraftPick>, ProviderReadFailure>;

  readonly readStandings: (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) => Effect.Effect<ProviderStandings, ProviderReadFailure>;

  readonly readLeagueTeams: (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) => Effect.Effect<ReadonlyArray<ProviderLeagueTeam>, ProviderReadFailure>;

  readonly scoreRoster: (
    input: ProviderScoreRequest,
  ) => Effect.Effect<ProviderScoreOutcome, ProviderReadFailure>;
};

type ProviderPlayerReadInput = {
  readonly providerLeagueKey: string;
  readonly providerPlayerKeys: ReadonlyArray<string>;
  readonly sport: FantasySport;
  readonly period: ProviderStatPeriod;
  readonly currentPeriod: number | undefined;
  readonly seasonStart: string | undefined;
  readonly seasonEnd: string | undefined;
};

export type ProviderCoverageKind = ProviderRosterCoverage["type"];

export type ProviderPeriodWindow = {
  readonly current: number;
  readonly start: number;
  readonly end: number;
};

type ProviderRosterSlotKind = "starting" | "bench" | "reserve";

export type ProviderRosterPosition = {
  readonly position: string;
  readonly positionType: string | undefined;
  readonly kind: ProviderRosterSlotKind;
  readonly count: number;
  readonly eligibility: ReadonlyArray<string>;
};

type ProviderReserveEligibility =
  | { readonly kind: "published_positions" }
  | { readonly kind: "not_published"; readonly detail: string };

export type ProviderRosterConstraints = {
  readonly rosterMaximum: number;
  readonly benchCapacity: "generic" | "per_slot";
  readonly startingSlotsMayStandEmpty: boolean;
  readonly reserveEligibility: ProviderReserveEligibility;
};

type ProviderStatCategory = {
  readonly statId: number;
  readonly name: string;
  readonly displayName: string;
  readonly abbreviation: string;
  readonly group: string;
  readonly enabled: boolean;
  readonly displayOnly: boolean;
  readonly positionTypes: ReadonlyArray<string>;
};

type ProviderStatModifier = {
  readonly statId: number;
  readonly points: string;
};

export type ProviderTradeRatification = "vote" | "commissioner" | "none" | "unknown";

type ProviderRosterChangeRule = "same_day" | "next_day" | "weekly_lock";

export type ProviderRosterChange = {
  readonly rule: ProviderRosterChangeRule;
  readonly source: ReadonlyArray<string>;
  readonly detail: string;
};

export type ProviderLeagueSettings = {
  readonly providerLeagueKey: string;
  readonly name: string;
  readonly webUrl: string;
  readonly season: number;
  readonly startDate: string | undefined;
  readonly endDate: string | undefined;
  readonly currentDate: string | undefined;
  readonly teamCount: number;
  readonly format: LeagueFormat;
  readonly scoringType: string;
  readonly scoringLabel: string | undefined;
  readonly weeklyDeadline: string | undefined;
  readonly rosterChange: ProviderRosterChange | undefined;
  readonly waiverType: string | undefined;
  readonly waiverRule: string | undefined;
  readonly usesFaab: boolean | undefined;
  readonly waiverDays: number | undefined;
  readonly maxWeeklyAcquisitions: number | undefined;
  readonly maxSeasonAcquisitions: number | undefined;
  readonly tradeEndDate: string | undefined;
  readonly tradeRatification: ProviderTradeRatification | undefined;
  tradeObjectionDays: number | undefined;
  readonly tradeDraftPicks: boolean | undefined;
  readonly draftStatus: string | undefined;
  readonly periodWindow: ProviderPeriodWindow | undefined;
  readonly rosterCoverage: ProviderCoverageKind;
  readonly maxGamesPlayed: number | undefined;
  readonly maxInningsPitched: number | undefined;
  readonly rosterConstraints: ProviderRosterConstraints;
  readonly rosterPositions: ReadonlyArray<ProviderRosterPosition>;
  readonly statCategories: ReadonlyArray<ProviderStatCategory>;
  readonly statModifiers: ReadonlyArray<ProviderStatModifier>;
};

export type ProviderScoringWeek = {
  readonly week: number;
};

export type ProviderNativeTarget = ProviderRosterCoverage;

export type ProviderLineupAssignment = {
  readonly providerPlayerKey: string;
  readonly slot: string;
};

export type ProviderWriteResult =
  | { readonly status: "accepted" }
  | {
      readonly status: "rejected";
      readonly reason: "invalid_request" | "not_found" | "premium_required";
      readonly detail?: string;
      readonly httpStatus?: number;
    }
  | {
      readonly status: "not_sent";
      readonly reason: "session_incomplete" | "request_failed";
      readonly detail?: string;
      readonly httpStatus?: number;
    }
  | { readonly status: "unknown" };

export type ProviderTradeProposalResult =
  | { readonly status: "accepted"; readonly transactionKey: string }
  | {
      readonly status: "rejected";
      readonly reason: "invalid_request" | "not_found" | "premium_required";
      readonly detail?: string;
      readonly httpStatus?: number;
    }
  | {
      readonly status: "not_sent";
      readonly reason: "session_incomplete" | "request_failed";
      readonly detail?: string;
      readonly httpStatus?: number;
    }
  | { readonly status: "unknown" };

export const ProviderStartingLineup = Schema.Literals([
  "confirmed-starting",
  "confirmed-not-starting",
  "unconfirmed",
]);
export type ProviderStartingLineup = typeof ProviderStartingLineup.Type;

type ProviderTransactionTrendWindow = "provider_current_day";

export type ProviderTransactionTrend =
  | {
      readonly status: "published";
      readonly adds: number;
      readonly drops: number;
      readonly window: ProviderTransactionTrendWindow;
    }
  | { readonly status: "not_published"; readonly reason: string };

export type PlayerWeekOpponent = {
  readonly opponent: string;
  readonly home: boolean;
};

export type ProviderPlayerWeekFact = {
  readonly providerPlayerKey: string;
  readonly week: number;
  readonly plays: boolean;
  readonly opponent: PlayerWeekOpponent | undefined;
  readonly projectedRank: number | undefined;
};

export type ProviderRosterPlayer = {
  readonly providerPlayerKey: string;
  readonly name: string;
  readonly displayPosition: string;
  readonly primaryPosition: string;
  readonly positionType: string | undefined;
  readonly proTeamAbbreviation: string | undefined;
  readonly eligiblePositions: ReadonlyArray<string>;
  readonly slot: ProviderRosterSlot;
  readonly isEditable: boolean | null;
  readonly injuryCode: string | undefined;
  readonly injuryDetail: string | undefined;
  readonly status?: ProviderPlayerStatus;
  readonly byeWeek: number | null;
  readonly scheduled: boolean;
  readonly opponent?: PlayerWeekOpponent;
  readonly startingLineup: ProviderStartingLineup;
  readonly undroppable: boolean | null;
  readonly transactionTrend: ProviderTransactionTrend;
};

export type ProviderRoster = {
  readonly providerTeamKey: string;
  readonly providerLeagueKey: string;
  readonly coverage: ProviderRosterCoverage;
  readonly players: ReadonlyArray<ProviderRosterPlayer>;
};

export type ProviderLeagueRoster = ProviderRoster & {
  readonly name: string;
};

export type ProviderRosterSlot =
  | { readonly status: "verified"; readonly slot: string }
  | { readonly status: "unverified"; readonly rawValue: string; readonly reason: string };

export type ProviderSchedulePeriod =
  | { readonly type: "week"; readonly week: number }
  | { readonly type: "date"; readonly start: string; readonly end: string };

export type ProviderScheduledGame = {
  readonly date: string | undefined;
  readonly opponent: string;
  readonly home: boolean;
};

export type ProviderSchedulePlayer = {
  readonly providerPlayerKey: string;
  readonly name: string;
  readonly proTeamKey: string | undefined;
  readonly proTeamAbbreviation: string | undefined;
  readonly games: ReadonlyArray<ProviderScheduledGame>;
};

export type ProviderRosterSchedule = {
  readonly providerTeamKey: string;
  readonly period: ProviderSchedulePeriod;
  readonly dates: ReadonlyArray<string>;
  readonly players: ReadonlyArray<ProviderSchedulePlayer>;
};

export type ProviderStatValue = {
  readonly statId: number;
  readonly value: number | null;
};

type StatPeriodPresetName = "last_7_days" | "last_14_days" | "last_30_days";

export type ProviderStatPeriod =
  | { readonly kind: "season" }
  | { readonly kind: "week"; readonly week: number }
  | { readonly kind: "preset"; readonly preset: StatPeriodPresetName }
  | { readonly kind: "range"; readonly start: string; readonly end: string };

export type ProviderStatBasis =
  | { readonly type: "week"; readonly week: number }
  | { readonly type: "season" }
  | {
      readonly type: "date_range";
      readonly start: string;
      readonly end: string;
      readonly days: number;
    };

export type ProviderStatOmission = {
  readonly statId: number;
  readonly detail: string;
};

export type ProviderPlayerStatGroup = {
  readonly basis: ProviderStatBasis;
  readonly stats: ReadonlyArray<ProviderStatValue>;
  readonly notAggregated: ReadonlyArray<ProviderStatOmission>;
};

export type ProviderPlayerDetail = {
  readonly providerPlayerKey: string;
  readonly name: string | undefined;
  readonly primaryPosition: string | undefined;
  readonly displayPosition: string | undefined;
  readonly proTeam: string | undefined;
  readonly availabilityDetail: string | undefined;
  readonly eligiblePositions: ReadonlyArray<string> | undefined;
  readonly rosterStatus: "rostered" | "free_agent" | "waiver" | "unknown";
  readonly actual: ProviderPlayerStatGroup | undefined;
  readonly projected: ProviderPlayerStatGroup | undefined;
};

export type ProviderPlayerPeriod = {
  readonly period: ProviderScoringWeek;
  readonly details: ReadonlyArray<ProviderPlayerDetail>;
};

export type ProviderPlayerSearchSort =
  | "name"
  | "position"
  | "ownership"
  | "actual_rank"
  | "overall_rank"
  | "stat";

export type ProviderPlayerSearchInput = ProviderSessionMaterial & {
  readonly providerLeagueKey: string;
  readonly season: number;
  readonly query: string | undefined;
  readonly availability: "all" | "free_agent" | "waiver";
  readonly sort: ProviderPlayerSearchSort;
  readonly statId: number | undefined;
  readonly statType: ProviderStatBasis["type"];
  readonly limit: number;
};

export type ProviderPlayerStatus = "healthy" | "day_to_day" | "out" | "injured_reserve" | "unknown";

export type ProviderPlayerSearchResult = {
  readonly players: ReadonlyArray<{
    readonly providerPlayerKey: string;
    readonly name: string;
    readonly primaryPosition: string;
    readonly displayPosition: string;
    readonly eligiblePositions: ReadonlyArray<string>;
    readonly availability: "free_agent" | "waiver" | "rostered" | "unknown";
    readonly proTeam: string | undefined;
    readonly proTeamKey?: string | undefined;
    readonly status: {
      readonly value: ProviderPlayerStatus;
      readonly code: string | undefined;
      readonly detail: string | undefined;
    };
    readonly percentOwned: number | null;
    readonly percentOwnedDelta: number | null;
    readonly percentStarted: number | null;
    readonly percentStartedChange: number | null;
    readonly actualRank: number | null;
    readonly overallRank: number | null;
    readonly statValue: number | null;
    readonly transactionTrend: ProviderTransactionTrend;
  }>;
};

type ProviderStandingRecord = {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly percentage: number | null;
};

export type ProviderStanding = {
  readonly providerTeamKey: string;
  readonly name: string;
  readonly rank: number | null;
  readonly playoffSeed: number | null;
  readonly record: ProviderStandingRecord | undefined;
  readonly gamesBack: number | null;
  readonly pointsBack: number | null;
  readonly points: number | null;
  readonly pointsFor: number | null;
  readonly pointsAgainst: number | null;
  readonly streak: { readonly type: string; readonly value: number } | undefined;
  readonly acquisitionUsage: ProviderAcquisitionUsage;
  readonly categoryTotals: ReadonlyArray<ProviderStatValue>;
  readonly categoryPoints: ReadonlyArray<ProviderStatValue>;
};

export type ProviderStandings = {
  readonly providerLeagueKey: string;
  readonly teams: ReadonlyArray<ProviderStanding>;
};

export type ProviderRemainingGames = {
  readonly week: number | null;
  readonly completed: number;
  readonly live: number;
  readonly remaining: number;
};

export type ProviderTeamScore = {
  readonly providerTeamKey: string;
  readonly name: string;
  readonly points: number | null;
  readonly projectedPoints: number | null;
  readonly winProbability: number | null;
  readonly remainingGames: ProviderRemainingGames | undefined;
  readonly categoryTotals: ReadonlyArray<ProviderStatValue>;
};

export type ProviderCategoryWinner = {
  readonly statId: number;
  readonly winnerProviderTeamKey: string | undefined;
  readonly isTied: boolean;
};

export type ProviderMatchup = {
  readonly period: ProviderScoringWeek;
  readonly home: ProviderTeamScore;
  readonly away: ProviderTeamScore;
  readonly status: string | undefined;
  readonly isPlayoffs: boolean | undefined;
  readonly isConsolation: boolean | undefined;
  readonly isTied: boolean | undefined;
  readonly weekStart: string | undefined;
  readonly weekEnd: string | undefined;
  readonly categoryWinners: ReadonlyArray<ProviderCategoryWinner>;
};

export type ProviderTransactionTeam = {
  readonly providerTeamKey: string;
  readonly name: string | undefined;
};

export type ProviderTransactionMovement = {
  readonly kind: "add" | "drop" | "trade" | "pending_trade" | "other";
  readonly from: ProviderTransactionTeam | undefined;
  readonly to: ProviderTransactionTeam | undefined;
};

export type ProviderTransactionPlayer = {
  readonly providerPlayerKey: string;
  readonly movement: ProviderTransactionMovement;
  readonly name: string | undefined;
  readonly primaryPosition: string | undefined;
  readonly displayPosition: string | undefined;
  readonly eligiblePositions: ReadonlyArray<string> | undefined;
  readonly proTeam: string | undefined;
};

export type ProviderTransactionParty = {
  readonly role: "proposer" | "receiver" | "participant";
  readonly team: ProviderTransactionTeam;
};

export type ProviderTransactionParties = {
  readonly source: "provider" | "player_movements";
  readonly entries: ReadonlyArray<ProviderTransactionParty>;
};

export type ProviderTransactionIncomplete = {
  readonly code:
    | "no_movements"
    | "movement_missing_party"
    | "unknown_movement"
    | "trade_return_unpublished";
  readonly detail: string;
};

type ProviderTransactionPick = {
  readonly round: number;
  readonly from: ProviderTransactionTeam | undefined;
  readonly to: ProviderTransactionTeam | undefined;
  readonly original: ProviderTransactionTeam | undefined;
};

export type ProviderTransaction = {
  readonly transactionKey: string | undefined;
  readonly occurredAt: string;
  readonly type: "add" | "drop" | "add_drop" | "trade" | "pending_trade" | "commissioner" | "other";
  readonly status: string | undefined;
  readonly parties: ProviderTransactionParties | undefined;
  readonly teams: ReadonlyArray<ProviderTransactionTeam>;
  readonly picks: ReadonlyArray<ProviderTransactionPick>;
  readonly players: ReadonlyArray<ProviderTransactionPlayer>;
  readonly incomplete: ProviderTransactionIncomplete | undefined;
};

export type ProviderPendingTrade = {
  readonly transactionKey: string;
  readonly proposedAt: string;
  readonly note: string | undefined;
  readonly canRespond: boolean;
  readonly proposer: ProviderTransactionTeam | undefined;
  readonly receiver: ProviderTransactionTeam | undefined;
  readonly unusedRosterSpots: number | undefined;
  readonly players: ReadonlyArray<ProviderTransactionPlayer>;
  readonly picks: ReadonlyArray<ProviderTransactionPick>;
  readonly incomplete: ProviderTransactionIncomplete | undefined;
};

export type ProviderDraftPick = {
  readonly round: number;
  readonly pick: number;
  readonly providerTeamKey: string;
  readonly providerPlayerKey: string;
  readonly name?: string;
};

export type ProviderAvailableDraftPick = {
  readonly providerTeamKey: string;
  readonly round: number;
};

export type ProviderTradePick = {
  readonly round: number;
  readonly sourceTeamKey: string;
  readonly destinationTeamKey: string;
};

export type ProviderAcquisitionUsage = {
  readonly seasonMoves: number | undefined;
  readonly weeklyAdds:
    | {
        readonly used: number;
        readonly coverage: ProviderRosterCoverage;
      }
    | undefined;
};

export type ProviderLeagueTeam = {
  readonly providerTeamKey: string;
  readonly providerLeagueKey: string;
  readonly name: string;
  readonly managerName?: string;
  readonly acquisitionUsage: ProviderAcquisitionUsage;
  readonly remainingBudget?: number | undefined;
};

export type ProviderScoreRequest = ProviderSessionMaterial & {
  readonly providerTeamKey: string;
  readonly providerLeagueKey: string;
  readonly sport: FantasySport;
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly target: LineupTargetPeriod;
};

export type ProviderScoreRefusal = "structural" | "transient";

export const ProviderAvailabilityTier = Schema.Literals([
  "confirmed-start",
  "will-play",
  "might-play",
  "unlikely-to-play",
  "will-not-play",
  "not-scheduled",
]);
export type ProviderAvailabilityTier = typeof ProviderAvailabilityTier.Type;

export type ProviderScoreOutcome =
  | {
      readonly kind: "scored";
      readonly provenance: string;
      readonly players: ReadonlyArray<ProviderPlayerScore>;
      readonly gamesPlayed: ReadonlyArray<ProviderGamesPlayed>;
    }
  | {
      readonly kind: "refused";
      readonly refusal: ProviderScoreRefusal;
      readonly provenance: string;
      readonly detail: string;
    };

export type ProviderPlayerScore = {
  readonly providerPlayerKey: string;
  readonly score: number | null;
  readonly availability: ProviderAvailabilityTier;
};

export type ProviderGamesPlayed = {
  readonly position: string;
  readonly played: number;
  readonly max: number;
  readonly projected: number;
};
