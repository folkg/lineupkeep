import type { Exact } from "./Exact.ts";

export type { Exact };

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

export type ValueSourceKind = "projection" | "community-start-rate" | "ownership-composite";

export type CommunityStartRatePopulation =
  | { readonly kind: "cut"; readonly cut: string }
  | {
      readonly kind: "overall";
      readonly cut: string;
      readonly finding: "cut-incomplete" | "cut-unpopulated";
    };

export type ValueSource =
  | {
      readonly kind: "projection";
      readonly period: Period;
      readonly players: ReadonlyArray<PlayerProjection>;
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

type PlayerProjection = {
  readonly id: string;
  readonly rank: number;
};

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
