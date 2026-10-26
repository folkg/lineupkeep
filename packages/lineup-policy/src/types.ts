import type { Exact, ScoringProfile, StatObservation } from "@lineupkeep/lineup-scoring";
import type {
  LineupProblem,
  PlayerId,
  PlayerSelection,
  PositionType,
  RosterSlot,
  SelectionBasis,
  SlotId,
} from "@lineupkeep/lineup-solver";

export type Period =
  | { readonly kind: "week"; readonly week: number }
  | { readonly kind: "date"; readonly date: string };

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
  readonly selectionBasis: SelectionBasis;
  readonly period: Period;
  readonly window: ReadonlyArray<Period>;
  readonly scoring: ScoringProfile;
  readonly slots: ReadonlyArray<RosterSlot>;
  readonly players: ReadonlyArray<PolicyPlayer>;
  readonly observations: ReadonlyArray<PeriodObservation>;
};

export type LineupPolicyResult =
  | {
      readonly kind: "problem";
      readonly problem: LineupProblem;
      readonly valuations: ReadonlyArray<PlayerValuation>;
    }
  | { readonly kind: "refusal"; readonly refusal: LineupPolicyRefusal };

export type LineupPolicyRefusal =
  | { readonly kind: "no-scoring-rules" }
  | { readonly kind: "no-observed-periods"; readonly window: ReadonlyArray<Period> };

export type PlayerValuation = {
  readonly playerId: PlayerId;
  readonly availability: AvailabilityAssessment;
  readonly countedPeriods: ReadonlyArray<Period>;
  readonly skippedPeriods: ReadonlyArray<Period>;
  readonly periodPoints: ReadonlyArray<Exact>;
  readonly average: Exact | undefined;
  readonly selection: PlayerSelection;
};
