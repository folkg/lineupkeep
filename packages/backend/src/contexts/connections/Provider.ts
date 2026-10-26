import { Context, Schema } from "effect";
import type { Effect, Redacted } from "effect";

const ProviderSport = Schema.Literals(["football", "hockey"]);
type ProviderSport = typeof ProviderSport.Type;

const ProviderLeague = Schema.Literals(["nfl", "nhl"]);
type ProviderLeague = typeof ProviderLeague.Type;

const ProviderOperation = Schema.Literals([
  "validate_session",
  "discover_teams",
  "read_crumb",
  "read_league",
  "read_standings",
  "read_roster",
  "read_player_details",
  "read_player_history",
  "search_players",
  "read_matchups",
  "read_transactions",
  "read_league_teams",
  "build_review_link",
  "apply_native_start_active",
  "apply_explicit_assignments",
]);
export type ProviderOperation = typeof ProviderOperation.Type;

export const ProviderSessionMaterial = Schema.Struct({
  provider: Schema.Literals(["yahoo"]),
  session: Schema.Redacted(Schema.String),
});
export type ProviderSessionMaterial = typeof ProviderSessionMaterial.Type;

export const ProviderTeam = Schema.Struct({
  provider: Schema.Literals(["yahoo"]),
  providerTeamKey: Schema.NonEmptyString,
  providerLeagueKey: Schema.NonEmptyString,
  league: ProviderLeague,
  sport: ProviderSport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
  name: Schema.NonEmptyString,
});
export type ProviderTeam = typeof ProviderTeam.Type;

type ProviderCrumb = {
  readonly crumb: Redacted.Redacted<string>;
};

type ProviderRosterPosition = {
  readonly position: string;
  readonly positionType: string | undefined;
  readonly count: number;
  readonly isStarting: boolean;
};

type ProviderStatCategory = {
  readonly statId: number;
  readonly name: string;
  readonly displayName: string;
  readonly abbreviation: string;
  readonly group: string;
  readonly enabled: boolean;
  readonly positionTypes: ReadonlyArray<string>;
};

type ProviderStatModifier = {
  readonly statId: number;
  readonly points: string;
};

export type ProviderPeriodWindow = {
  readonly currentWeek: number;
  readonly startWeek: number;
  readonly endWeek: number;
};

const ProviderPeriodKind = Schema.Literals(["week", "date"]);
export type ProviderPeriodKind = typeof ProviderPeriodKind.Type;

const ProviderDate = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)));

const ProviderRosterCoverage = Schema.Union([
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

export type ProviderLeagueSettings = {
  readonly providerLeagueKey: string;
  readonly name: string;
  readonly webUrl: string;
  readonly season: number;
  readonly startDate: string | undefined;
  readonly endDate: string | undefined;
  readonly teamCount: number;
  readonly scoringType: string;
  readonly scoringLabel: string | undefined;
  readonly weeklyDeadline: string | undefined;
  readonly waiverType: string | undefined;
  readonly waiverRule: string | undefined;
  readonly usesFaab: boolean | undefined;
  readonly draftStatus: string | undefined;
  readonly periodWindow: ProviderPeriodWindow | undefined;
  readonly rosterCoverage: ProviderPeriodKind;
  readonly rosterPositions: ReadonlyArray<ProviderRosterPosition>;
  readonly statCategories: ReadonlyArray<ProviderStatCategory>;
  readonly statModifiers: ReadonlyArray<ProviderStatModifier>;
};

export type ProviderPeriod = {
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
  | { readonly status: "not_sent"; readonly reason: "crumb_unavailable" | "request_failed" }
  | { readonly status: "unknown" };

export type ProviderRosterPlayer = {
  readonly providerPlayerKey: string;
  readonly name: string;
  readonly displayPosition: string;
  readonly primaryPosition: string;
  readonly positionType: string | undefined;
  readonly proTeamAbbreviation: string | undefined;
  readonly eligiblePositions: ReadonlyArray<string>;
  readonly slot: string;
  readonly isFlex: boolean | null;
  readonly isEditable: boolean | null;
  readonly injuryCode: string | undefined;
  readonly injuryDetail: string | undefined;
  readonly byeWeek: number | null;
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

export type ProviderStatBasis =
  | { readonly type: "week"; readonly week: number }
  | { readonly type: "season" };

export type ProviderPlayerStatGroup = {
  readonly basis: ProviderStatBasis;
  readonly stats: ReadonlyArray<ProviderStatValue>;
};

export type ProviderStartPercentageCut = {
  readonly cutType: string;
  readonly percent: number | null;
};

export type ProviderPercentStarted = {
  readonly percent: number | null;
  readonly delta: number | null;
  readonly coverage: ProviderRosterCoverage | null;
  readonly cuts: ReadonlyArray<ProviderStartPercentageCut>;
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
  readonly percentStarted: ProviderPercentStarted | undefined;
};

export type ProviderPlayerPeriod = {
  readonly period: ProviderPeriod;
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
  readonly query: string | undefined;
  readonly availability: "all" | "free_agent" | "waiver";
  readonly sort: ProviderPlayerSearchSort;
  readonly statId: number | undefined;
  readonly statType: "season" | "week";
  readonly limit: number;
};

export type ProviderPlayerSearchResult = {
  readonly players: ReadonlyArray<{
    readonly providerPlayerKey: string;
    readonly name: string;
    readonly primaryPosition: string;
    readonly displayPosition: string;
    readonly eligiblePositions: ReadonlyArray<string>;
    readonly availability: "free_agent" | "waiver" | "rostered" | "unknown";
    readonly percentOwned: number | null;
    readonly percentOwnedDelta: number | null;
    readonly percentStarted: number | null;
    readonly percentStartedDelta: number | null;
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
  readonly period: ProviderPeriod;
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

type ProviderTransactionPlayer = {
  readonly providerPlayerKey: string;
  readonly direction: "add" | "drop" | "incoming" | "outgoing";
  readonly name: string | undefined;
  readonly primaryPosition: string | undefined;
  readonly displayPosition: string | undefined;
  readonly eligiblePositions: ReadonlyArray<string> | undefined;
};

type ProviderTransactionTeam = {
  readonly providerTeamKey: string;
  readonly name: string;
};

export type ProviderTransaction = {
  readonly occurredAt: string;
  readonly type: "add" | "drop" | "add_drop" | "trade" | "commissioner" | "other";
  readonly status: string | undefined;
  readonly teams: ReadonlyArray<ProviderTransactionTeam>;
  readonly players: ReadonlyArray<ProviderTransactionPlayer>;
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
  readonly leagueWebUrl: string;
  readonly sport: ProviderSport;
  readonly intent: ProviderReviewIntent;
};

export type ProviderFailure =
  | ProviderSessionRejected
  | ProviderRequestFailed
  | ProviderResponseInvalid;

export type ProviderReadFailure =
  | ProviderFailure
  | ProviderOperationUnsupported
  | ProviderPeriodMismatch;

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

export class ProviderCrumbUnavailable extends Schema.TaggedError<
  ProviderCrumbUnavailable,
  { readonly brand: unique symbol }
>()("provider.crumb_unavailable", {
  operation: ProviderOperation,
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

export class ProviderReviewLinkInvalid extends Schema.TaggedError<
  ProviderReviewLinkInvalid,
  { readonly brand: unique symbol }
>()("provider.review_link_invalid", {
  reason: Schema.Literals([
    "unsupported-player-key",
    "unsupported-league-url",
    "unsupported-review-surface",
  ]),
}) {}

export type ProviderGatewayShape = {
  readonly validateSession: (
    input: ProviderSessionMaterial,
  ) => Effect.Effect<void, ProviderFailure>;

  readonly discoverTeams: (
    input: ProviderSessionMaterial,
  ) => Effect.Effect<ReadonlyArray<ProviderTeam>, ProviderFailure>;

  readonly readCrumb: (
    input: ProviderSessionMaterial,
  ) => Effect.Effect<ProviderCrumb, ProviderFailure | ProviderCrumbUnavailable>;

  readonly readLeague: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly sport: ProviderSport;
    },
  ) => Effect.Effect<ProviderLeagueSettings, ProviderReadFailure>;

  readonly readRoster: (
    input: ProviderSessionMaterial & {
      readonly providerTeamKey: string;
      readonly period: ProviderRosterCoverage | undefined;
    },
  ) => Effect.Effect<ProviderRoster, ProviderReadFailure>;

  readonly applyNativeStartActive: (
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
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerPlayerKeys: ReadonlyArray<string>;
      readonly sport: ProviderSport;
      readonly period: ProviderPeriod | undefined;
      readonly startedPeriod: ProviderRosterCoverage | undefined;
      readonly currentWeek: number | undefined;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderPlayerDetail>, ProviderReadFailure>;

  readonly readPlayerHistory: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerPlayerKeys: ReadonlyArray<string>;
      readonly sport: ProviderSport;
      readonly periods: ReadonlyArray<ProviderPeriod>;
      readonly currentWeek: number | undefined;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderPlayerPeriod>, ProviderReadFailure>;

  readonly searchPlayers: (
    input: ProviderPlayerSearchInput,
  ) => Effect.Effect<ProviderPlayerSearchResult, ProviderReadFailure>;

  readonly readMatchups: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly period: ProviderPeriod;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderMatchup>, ProviderReadFailure>;

  readonly readTransactions: (
    input: ProviderSessionMaterial & {
      readonly providerLeagueKey: string;
      readonly providerTeamKey: string | undefined;
      readonly limit: number;
    },
  ) => Effect.Effect<ReadonlyArray<ProviderTransaction>, ProviderReadFailure>;

  readonly readStandings: (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) => Effect.Effect<ProviderStandings, ProviderReadFailure>;

  readonly readLeagueTeams: (
    input: ProviderSessionMaterial & { readonly providerLeagueKey: string },
  ) => Effect.Effect<ReadonlyArray<ProviderLeagueTeam>, ProviderReadFailure>;

  readonly buildReviewLink: (
    input: ProviderReviewLinkInput,
  ) => Effect.Effect<string, ProviderReviewLinkInvalid>;
};

export class ProviderGateway extends Context.Service<ProviderGateway, ProviderGatewayShape>()(
  "@lineupkeep/backend/contexts/connections/Provider/ProviderGateway",
) {}
