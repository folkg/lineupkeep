import type { Exact, ScoringProfile, StatObservation } from "@lineupkeep/lineup-scoring";
import type {
  LineupProblem,
  PlayerId,
  PlayerSelection,
  PositionType,
  RosterSlot,
  SlotId,
} from "@lineupkeep/lineup-solver";

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

export type PlayerProjection = {
  readonly id: PlayerId;
  readonly points: Exact;
};

export type PlayerRealisedPoints = {
  readonly id: PlayerId;
  readonly points: Exact;
};

export type PlayerCommunityStartRate = {
  readonly id: PlayerId;
  readonly percent: Exact | undefined;
  readonly cuts: ReadonlyArray<CommunityStartRateCut>;
};

export type CommunityStartRateCut = {
  readonly cut: string;
  readonly percent: Exact;
};

export type PlayerAvailability =
  | { readonly kind: "available" }
  | { readonly kind: "excluded"; readonly reason: ExclusionReason }
  | { readonly kind: "uncertain"; readonly reason: "day-to-day" }
  | { readonly kind: "unrecognised"; readonly code: string };

export type ExclusionReason = "out" | "injured-reserve" | "suspended" | "not-active";

export type AvailabilityAssessment =
  | { readonly tier: "will-play"; readonly fact: "available" }
  | { readonly tier: "might-play"; readonly fact: "day-to-day" }
  | { readonly tier: "might-play"; readonly fact: "unrecognised-status"; readonly code: string }
  | { readonly tier: "will-not-play"; readonly fact: "excluded"; readonly reason: ExclusionReason }
  | { readonly tier: "will-not-play"; readonly fact: "no-game"; readonly period: Period };

export type PolicyPlayer = {
  readonly id: PlayerId;
  readonly eligiblePositions: ReadonlyArray<PositionType>;
  readonly availability: PlayerAvailability;
  readonly locked: boolean;
  readonly currentSlotId: SlotId;
  readonly nonGamePeriods: ReadonlyArray<Period>;
};

export type PeriodObservation = {
  readonly period: Period;
  readonly players: ReadonlyArray<{
    readonly id: PlayerId;
    readonly stats: ReadonlyArray<StatObservation>;
  }>;
};

export type LineupPolicyInput = {
  readonly period: Period;
  readonly source: ValueSource | undefined;
  readonly slots: ReadonlyArray<RosterSlot>;
  readonly players: ReadonlyArray<PolicyPlayer>;
};

export type LineupPolicyResult =
  | {
      readonly kind: "problem";
      readonly problem: LineupProblem;
      readonly valuations: ReadonlyArray<PlayerValuation>;
    }
  | { readonly kind: "refusal"; readonly refusal: LineupPolicyRefusal };

export type LineupPolicyRefusal =
  | { readonly kind: "no-value-source" }
  | { readonly kind: "no-observed-periods"; readonly window: ReadonlyArray<Period> };

export type PlayerValuation = {
  readonly playerId: PlayerId;
  readonly availability: AvailabilityAssessment;
  readonly selection: PlayerSelection;
  readonly value: ValueAssessment;
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
