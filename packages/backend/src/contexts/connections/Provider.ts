import { Schema } from "effect";
import type { Effect } from "effect";

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
  "read_player_details",
  "read_player_history",
  "search_players",
  "read_matchups",
  "read_transactions",
  "read_draft_results",
  "read_league_teams",
  "build_review_link",
  "apply_native_action",
  "apply_explicit_assignments",
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
});
export type ProviderTeam = typeof ProviderTeam.Type;

export const ProviderFantasyDay = Schema.Struct({
  timeZone: Schema.NonEmptyString,
  boundary: Schema.Literal("local-midnight"),
  version: Schema.NonEmptyString,
});
export type ProviderFantasyDay = typeof ProviderFantasyDay.Type;

const ProviderLimitationSubject = Schema.Literals([
  "player_schedule",
  "probable_starters",
  "projections",
  "team_remaining_games",
  "lock_timing",
  "historical_seasons",
]);
export type ProviderLimitationSubject = typeof ProviderLimitationSubject.Type;

type ProviderLimitation = {
  readonly subject: ProviderLimitationSubject;
  readonly detail: string;
};

export type ProviderCapabilities = {
  readonly fantasyDay: ProviderFantasyDay;
  readonly sports: ReadonlyArray<FantasySport>;
  readonly playerSearch: {
    readonly sorts: ReadonlyArray<ProviderPlayerSearchSort>;
    readonly providerOrderedSorts: ReadonlyArray<ProviderPlayerSearchSort>;
    readonly weeklyStatSeriesSports: ReadonlyArray<FantasySport>;
  };
  readonly statPeriods: Readonly<Record<FantasySport, ProviderPeriodSupport>>;
  readonly publishesProjections: boolean;
  readonly limitations: ReadonlyArray<ProviderLimitation>;
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
}) {}

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

export class ProviderReviewLinkInvalid extends Schema.TaggedError<
  ProviderReviewLinkInvalid,
  { readonly brand: unique symbol }
>()("provider.review_link_invalid", {
  reason: Schema.Literals([
    "unsupported-player-key",
    "unsupported-team-key",
    "unsupported-league-url",
    "unsupported-review-surface",
  ]),
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

  readonly readPlayerDetails: (
    input: ProviderSessionMaterial & ProviderPlayerReadInput,
  ) => Effect.Effect<ReadonlyArray<ProviderPlayerDetail>, ProviderReadFailure>;
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
    },
  ) => Effect.Effect<ReadonlyArray<ProviderTransaction>, ProviderReadFailure>;

  readonly readDraftResults: (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) => Effect.Effect<ReadonlyArray<ProviderDraftPick>, ProviderReadFailure>;

  readonly readStandings: (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) => Effect.Effect<ProviderStandings, ProviderReadFailure>;

  readonly readLeagueTeams: (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) => Effect.Effect<ReadonlyArray<ProviderLeagueTeam>, ProviderReadFailure>;

  readonly reviewLinkTemplate: { readonly version: string };

  readonly buildReviewLink: (
    input: ProviderReviewLinkInput,
  ) => Effect.Effect<string, ProviderReviewLinkInvalid>;

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

export type ProviderLeagueSettings = {
  readonly providerLeagueKey: string;
  readonly name: string;
  readonly webUrl: string;
  readonly season: number;
  readonly startDate: string | undefined;
  readonly endDate: string | undefined;
  readonly teamCount: number;
  readonly format: LeagueFormat;
  readonly scoringType: string;
  readonly scoringLabel: string | undefined;
  readonly weeklyDeadline: string | undefined;
  readonly waiverType: string | undefined;
  readonly waiverRule: string | undefined;
  readonly usesFaab: boolean | undefined;
  readonly draftStatus: string | undefined;
  readonly periodWindow: ProviderPeriodWindow | undefined;
  readonly rosterCoverage: ProviderCoverageKind;
  readonly maxGamesPlayed: number | undefined;
  readonly maxInningsPitched: number | undefined;
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
    }
  | { readonly status: "not_sent"; readonly reason: "session_incomplete" | "request_failed" }
  | { readonly status: "unknown" };

export const ProviderStartingLineup = Schema.Literals([
  "confirmed-starting",
  "confirmed-not-starting",
  "unconfirmed",
]);
export type ProviderStartingLineup = typeof ProviderStartingLineup.Type;

export type ProviderRosterPlayer = {
  readonly providerPlayerKey: string;
  readonly name: string;
  readonly displayPosition: string;
  readonly primaryPosition: string;
  readonly positionType: string | undefined;
  readonly proTeamAbbreviation: string | undefined;
  readonly eligiblePositions: ReadonlyArray<string>;
  readonly slot: string;
  readonly isEditable: boolean | null;
  readonly injuryCode: string | undefined;
  readonly injuryDetail: string | undefined;
  readonly byeWeek: number | null;
  readonly scheduled: boolean;
  readonly startingLineup: ProviderStartingLineup;
  readonly undroppable: boolean | null;
};

export type ProviderRoster = {
  readonly providerTeamKey: string;
  readonly providerLeagueKey: string;
  readonly coverage: ProviderRosterCoverage;
  readonly players: ReadonlyArray<ProviderRosterPlayer>;
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
  readonly kind: "add" | "drop" | "trade" | "other";
  readonly from: ProviderTransactionTeam | undefined;
  readonly to: ProviderTransactionTeam | undefined;
};

type ProviderTransactionPlayer = {
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
  readonly occurredAt: string;
  readonly type: "add" | "drop" | "add_drop" | "trade" | "commissioner" | "other";
  readonly status: string | undefined;
  readonly parties: ProviderTransactionParties | undefined;
  readonly teams: ReadonlyArray<ProviderTransactionTeam>;
  readonly picks: ReadonlyArray<ProviderTransactionPick>;
  readonly players: ReadonlyArray<ProviderTransactionPlayer>;
  readonly incomplete: ProviderTransactionIncomplete | undefined;
};

export type ProviderDraftPick = {
  readonly round: number;
  readonly pick: number;
  readonly providerTeamKey: string;
  readonly providerPlayerKey: string;
};

export type ProviderLeagueTeam = {
  readonly providerTeamKey: string;
  readonly providerLeagueKey: string;
  readonly name: string;
};

export type ProviderReviewIntent =
  | {
      readonly kind: "add";
      readonly add: string;
    }
  | {
      readonly kind: "add_drop";
      readonly add: string;
      readonly drop: string;
    }
  | {
      readonly kind: "drop";
      readonly drop: string;
    }
  | {
      readonly kind: "trade";
      readonly send: ReadonlyArray<string>;
      readonly receive: ReadonlyArray<string>;
    };

export type ProviderReviewLinkInput = {
  readonly providerLeagueKey: string;
  readonly providerTeamKey: string;
  readonly leagueWebUrl: string;
  readonly sport: FantasySport;
  readonly intent: ProviderReviewIntent;
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
