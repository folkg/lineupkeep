import type { Exact } from "./Exact.ts";

export type { Exact };

export type StatId = string;

type StatValue = string | number;

export type ScoringCategory = {
  readonly statId: StatId;
  readonly label: string;
};

export type ScoringRule = {
  readonly statId: StatId;
  readonly points: Exact;
};

export type ScoringProfile = {
  readonly categories: ReadonlyArray<ScoringCategory>;
  readonly rules: ReadonlyArray<ScoringRule>;
  readonly scale: number;
};

export type StatObservation = {
  readonly statId: StatId;
  readonly value: StatValue | null;
};

export type Period =
  | { readonly kind: "week"; readonly week: number }
  | { readonly kind: "date"; readonly date: string };

export type AvailabilityTier =
  | "confirmed-start"
  | "will-play"
  | "might-play"
  | "unlikely-to-play"
  | "will-not-play"
  | "not-scheduled";

export type ValueSourceKind =
  | "projected-points"
  | "scoring-rules"
  | "community-start-rate"
  | "ownership-composite";

export type CommunityStartRatePopulation =
  | { readonly kind: "cut"; readonly cut: string }
  | {
      readonly kind: "overall";
      readonly cut: string;
      readonly finding: "cut-incomplete" | "cut-unpopulated";
    };

export type ValueSource =
  | {
      readonly kind: "projected-points";
      readonly projections: ReadonlyArray<PlayerProjection>;
    }
  | {
      readonly kind: "scoring-rules";
      readonly window: ReadonlyArray<Period>;
      readonly scoring: ScoringProfile;
      readonly observations: ReadonlyArray<PeriodObservation>;
    }
  | {
      readonly kind: "community-start-rate";
      readonly started: ReadonlyArray<PlayerCommunityStartRate>;
    }
  | {
      readonly kind: "ownership-composite";
      readonly sport: FantasySport;
      readonly teamCount: number;
      readonly standardRosterSpots: number;
      readonly players: ReadonlyArray<PlayerOwnership>;
    };

type PlayerProjection = {
  readonly id: string;
  readonly points: Exact;
};

export type PlayerOwnership = {
  readonly id: string;
  readonly percentOwned: Exact | undefined;
  readonly delta: Exact | undefined;
  readonly ranks: ReadonlyArray<PlayerRank>;
};

export type PlayerRank = {
  readonly type: RankType;
  readonly rank: number;
};

export type RankType = "L30" | "L14" | "PS7" | "PSR" | "L4W" | "PW" | "PN4W";

type FantasySport = "football" | "hockey";

export type PlayerCommunityStartRate = {
  readonly id: string;
  readonly percent: Exact | undefined;
  readonly cuts: ReadonlyArray<CommunityStartRateCut>;
};

type CommunityStartRateCut = {
  readonly cut: string;
  readonly percent: Exact;
};

export type PlayerAvailability =
  | { readonly kind: "available" }
  | { readonly kind: "excluded"; readonly reason: ExclusionReason }
  | { readonly kind: "uncertain"; readonly code: string }
  | { readonly kind: "unrecognised"; readonly code: string };

type ExclusionReason = "out" | "injured-reserve" | "suspended" | "not-active";

export type StartingLineup = "confirmed-starting" | "confirmed-not-starting" | "unconfirmed";

export type StartingLineupRule = "unlikely-to-play" | "not-an-availability-fact";

export type PolicyPlayer = {
  readonly id: string;
  readonly availability: PlayerAvailability;
  readonly startingLineup: StartingLineup;
  readonly startingLineupRule: StartingLineupRule;
  readonly scheduled: boolean;
  readonly nonGamePeriods: ReadonlyArray<Period>;
};

type PeriodObservation = {
  readonly period: Period;
  readonly players: ReadonlyArray<{
    readonly id: string;
    readonly stats: ReadonlyArray<StatObservation>;
  }>;
};
