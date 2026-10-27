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

export type ValueSourceKind = "projected-points" | "scoring-rules" | "community-start-rate";

export type CommunityStartRatePopulation =
  | { readonly kind: "overall" }
  | { readonly kind: "cut"; readonly cut: string };

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
    };

type PlayerProjection = {
  readonly id: string;
  readonly points: Exact;
};

export type PlayerRealisedPoints = {
  readonly id: string;
  readonly points: Exact;
};

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
  | { readonly kind: "uncertain"; readonly reason: "day-to-day" }
  | { readonly kind: "unrecognised"; readonly code: string };

type ExclusionReason = "out" | "injured-reserve" | "suspended" | "not-active";

export type AvailabilityAssessment =
  | { readonly tier: "will-play"; readonly fact: "available" }
  | { readonly tier: "might-play"; readonly fact: "day-to-day" }
  | { readonly tier: "might-play"; readonly fact: "unrecognised-status"; readonly code: string }
  | { readonly tier: "will-not-play"; readonly fact: "excluded"; readonly reason: ExclusionReason }
  | { readonly tier: "will-not-play"; readonly fact: "no-game"; readonly period: Period };

export type PolicyPlayer = {
  readonly id: string;
  readonly availability: PlayerAvailability;
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
    };
