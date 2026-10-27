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

export type PeriodScore =
  | { readonly kind: "scored"; readonly points: Exact; readonly coverage: PeriodCoverage }
  | {
      readonly kind: "unknown";
      readonly reasons: ReadonlyArray<PeriodScoreUnknown>;
      readonly coverage: PeriodCoverage;
    };

export type PeriodScoreUnknown =
  | { readonly kind: "no-observations" }
  | { readonly kind: "value-unknown"; readonly statId: StatId };

export type PeriodCoverage = {
  readonly scored: ReadonlyArray<StatId>;
  readonly absent: ReadonlyArray<StatId>;
  readonly unknown: ReadonlyArray<StatId>;
  readonly unscored: ReadonlyArray<StatId>;
};

export type Period =
  | { readonly kind: "week"; readonly week: number }
  | { readonly kind: "date"; readonly date: string };

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
      readonly realised: ReadonlyArray<PlayerRealisedPoints>;
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

export type PlayerRealisedPoints = {
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

export type AvailabilityAssessment =
  | { readonly tier: "confirmed-start"; readonly fact: "confirmed-start" }
  | { readonly tier: "will-play"; readonly fact: "available" }
  | { readonly tier: "might-play"; readonly fact: "uncertain-status"; readonly code: string }
  | { readonly tier: "might-play"; readonly fact: "unrecognised-status"; readonly code: string }
  | { readonly tier: "will-not-play"; readonly fact: "excluded"; readonly reason: ExclusionReason }
  | { readonly tier: "not-scheduled"; readonly fact: "no-game"; readonly period: Period };

export type PolicyPlayer = {
  readonly id: string;
  readonly availability: PlayerAvailability;
  readonly scheduled: boolean;
  readonly confirmedStart: boolean;
  readonly nonGamePeriods: ReadonlyArray<Period>;
};

type PeriodObservation = {
  readonly period: Period;
  readonly players: ReadonlyArray<{
    readonly id: string;
    readonly stats: ReadonlyArray<StatObservation>;
  }>;
};

export type ValueAssessment =
  | {
      readonly kind: "realised-points";
      readonly countedPeriods: ReadonlyArray<Period>;
      readonly skippedPeriods: ReadonlyArray<Period>;
      readonly periodPoints: ReadonlyArray<Exact>;
      readonly average: Exact | undefined;
    }
  | {
      readonly kind: "projected-points";
      readonly projection: Exact | undefined;
      readonly realised: Exact | undefined;
    }
  | {
      readonly kind: "community-start-rate";
      readonly population: CommunityStartRatePopulation;
      readonly percent: Exact | undefined;
    }
  | {
      readonly kind: "ownership-composite";
      readonly percentOwned: Exact | undefined;
      readonly rankScore: Exact;
      readonly deltaAdjustment: Exact;
      readonly composite: Exact | undefined;
    };
