import type { FantasyLeague, FantasySport } from "@lineupkeep/backend/connections/FantasyTeam";
import type {
  TransactionMoveKind,
  TransactionMoveStatus,
} from "@lineupkeep/backend/connections/TransactionPlans";

import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";
import type { UseCaseResult } from "#contracts/useCaseContract.ts";

type TransactionMoveTeamView = {
  readonly id: string;
  readonly name: string;
  readonly league: FantasyLeague;
  readonly sport: FantasySport;
  readonly season: number;
};

export type TransactionMovePlayerView = {
  readonly name?: string;
  readonly position?: string;
  readonly proTeam?: string;
  readonly availability?: string;
};

type TransactionMoveAttemptView = {
  readonly kind: "claim" | "fallback";
  readonly player: TransactionMovePlayerView;
  readonly outcome:
    | "pending"
    | "won"
    | "lost"
    | "executed"
    | "failed"
    | "unavailable"
    | "unknown"
    | "retry";
  readonly reason: string;
  readonly at: string;
  readonly effectiveDate?: string;
};

type TransactionMovePickView = {
  readonly round: number;
  readonly sourceName: string;
  readonly destinationName: string;
};

type TransactionMoveValidationReasonView = {
  readonly code: string;
  readonly detail: string;
};

type TransactionMoveValidationView = {
  readonly status: "unchecked" | "current" | "stale" | "illegal";
  readonly checkedAt?: string;
  readonly reasons: ReadonlyArray<TransactionMoveValidationReasonView>;
};

type TransactionMoveCheckView = {
  readonly status: "checked" | "stored" | "last_checked";
  readonly note?: string;
};

export type TransactionMoveView = {
  readonly move: string;
  readonly team: TransactionMoveTeamView;
  readonly group?: string;
  readonly kind: TransactionMoveKind;
  readonly position: number;
  readonly decision: "undecided" | "saved" | "now" | "confirmed" | "discarded";
  readonly status: TransactionMoveStatus;
  readonly phase?: "with_league" | "won" | "lost";
  readonly attempts: ReadonlyArray<TransactionMoveAttemptView>;
  readonly reason: string;
  readonly adds: ReadonlyArray<TransactionMovePlayerView>;
  readonly fallbacks: ReadonlyArray<TransactionMovePlayerView>;
  readonly drops: ReadonlyArray<TransactionMovePlayerView>;
  readonly picks: ReadonlyArray<TransactionMovePickView>;
  readonly slotMove?: { readonly playerName?: string; readonly toSlot: string };
  readonly intent?: {
    readonly kind: "add" | "activate" | "stash";
    readonly player?: TransactionMovePlayerView;
    readonly to?: "active" | "reserve";
  };
  readonly placement?: {
    readonly playerName?: string;
    readonly fromSlot?: string;
    readonly toSlot: string;
    readonly detail: string;
  };
  readonly bid?: number;
  readonly runDay?: string;
  readonly effectiveDate?: string;
  readonly sendsAt?: string;
  readonly decidedAt?: string;
  readonly decidedBy?: "owner" | "agent" | "system";
  readonly surface?: string;
  readonly confirmation?: { readonly by: string; readonly at: string };
  readonly runAt?: string;
  readonly runDecidedBy?: "owner" | "agent" | "system";
  readonly runSurface?: string;
  readonly validation: TransactionMoveValidationView;
  readonly check: TransactionMoveCheckView;
  readonly result?: "executed" | "pending" | "failed" | "skipped" | "unknown";
  readonly resultDetail?: string;
  readonly resultAt?: string;
};

export type TransactionMoveTeamDayView = {
  readonly team: TransactionMoveTeamView;
  readonly moves: ReadonlyArray<TransactionMoveView>;
};

export type TransactionMoveDayView = {
  readonly day?: string;
  readonly groupedBy: "runDay";
  readonly today: boolean;
  readonly teams: ReadonlyArray<TransactionMoveTeamDayView>;
};

export type ReserveEligibilityView =
  | { readonly kind: "published_positions"; readonly positions: ReadonlyArray<string> }
  | { readonly kind: "injury_status" }
  | { readonly kind: "not_published"; readonly detail: string };

export type ReserveListView = {
  readonly name: string;
  readonly eligibility: ReserveEligibilityView;
  readonly capacity: number;
  readonly occupied: number;
  readonly free: number;
};

export type RosterPlacesView = {
  readonly used: number;
  readonly maximum: number;
  readonly free: number;
};

export type TransactionTeamFactsView = {
  readonly team: string;
  readonly places: RosterPlacesView;
  readonly reserve: ReadonlyArray<ReserveListView>;
  readonly waiver?: TransactionWaiverRuleView;
};

export type TransactionWaiverRuleView = {
  readonly rule?: string;
  readonly type?: string;
  readonly days?: number;
};

export type TransactionPlanDayView = {
  readonly day?: string;
  readonly groupedBy: "runDay";
  readonly today: boolean;
  readonly moves: ReadonlyArray<TransactionMoveView>;
};

type TransactionPlanGroupActionView = {
  readonly move: string;
  readonly action: "add" | "drop" | "reserve_move" | "slot_move";
  readonly player?: string;
  readonly fromSlot?: string;
  readonly toSlot?: string;
  readonly outcome: "executed" | "pending" | "failed" | "skipped" | "unknown";
  readonly detail?: string;
};

export type TransactionPlanGroupView = {
  readonly group: string;
  readonly team: string;
  readonly label?: string;
  readonly status: "ready" | "blocked" | "partly_done" | "done" | "failed";
  readonly moves: ReadonlyArray<string>;
  readonly fixesFor?: string;
  readonly actions: ReadonlyArray<TransactionPlanGroupActionView>;
  readonly failed?: TransactionPlanGroupActionView;
  readonly notRun: ReadonlyArray<string>;
  readonly detail: string;
  readonly cure?: string;
};

export type TransactionMoveListData = {
  readonly status: "ok";
  readonly team?: TransactionMoveTeamView;
  readonly nextCheckAt: string;
  readonly moves: ReadonlyArray<TransactionMoveView>;
  readonly days: ReadonlyArray<TransactionMoveDayView>;
  readonly teamFacts: ReadonlyArray<TransactionTeamFactsView>;
  readonly counts: {
    readonly open: number;
    readonly today: number;
    readonly saved: number;
    readonly ended: number;
  };
  readonly teamCount: number;
  readonly groups: ReadonlyArray<TransactionPlanGroupView>;
  readonly page: {
    readonly returned: number;
    readonly complete: boolean;
    readonly next?: {
      readonly runDay: string | null;
      readonly team: string;
      readonly position: number;
      readonly move: string;
    };
  };
};

type WaiverBidView =
  | { readonly kind: "published"; readonly balance: number }
  | { readonly kind: "bidless" };

type TransactionPlanSnapshotView =
  | { readonly status: "live"; readonly checkedAt: string; readonly source: string }
  | { readonly status: "stored"; readonly checkedAt: string; readonly note: string }
  | { readonly status: "unavailable"; readonly note: string };

export type TransactionPlanData = {
  readonly team: TransactionMoveTeamView;
  readonly today?: string;
  readonly nextCheckAt: string;
  readonly snapshot: TransactionPlanSnapshotView;
  readonly waiverBid?: WaiverBidView;
  readonly waiver?: TransactionWaiverRuleView;
  readonly places?: RosterPlacesView;
  readonly reserve?: ReadonlyArray<ReserveListView>;
  readonly addsPossible?: number;
  readonly moves: ReadonlyArray<TransactionMoveView>;
  readonly days: ReadonlyArray<TransactionPlanDayView>;
  readonly groups: ReadonlyArray<TransactionPlanGroupView>;
};

type TransactionRefusalView = {
  readonly code: string;
  readonly detail: string;
};

export type TransactionMoveActionData =
  | {
      readonly status: "saved";
      readonly move: string;
      readonly confirmationCleared: boolean;
    }
  | { readonly status: "discarded"; readonly move: string }
  | { readonly status: "fixed"; readonly move: string }
  | { readonly status: "refused"; readonly refusals: ReadonlyArray<TransactionRefusalView> };

export type TransactionMoveRetryData =
  | {
      readonly status: "retried";
      readonly retried: ReadonlyArray<string>;
      readonly counts: {
        readonly moves: number;
        readonly executed: number;
        readonly pending: number;
        readonly failed: number;
        readonly skipped: number;
        readonly unknown: number;
      };
      readonly refusals: ReadonlyArray<TransactionRefusalView>;
    }
  | { readonly status: "refused"; readonly refusals: ReadonlyArray<TransactionRefusalView> };

export type TransactionMoveConfirmationData =
  | {
      readonly status: "confirmed";
      readonly confirmed: ReadonlyArray<string>;
      readonly counts: {
        readonly moves: number;
        readonly executed: number;
        readonly pending: number;
        readonly failed: number;
        readonly skipped: number;
        readonly unknown: number;
      };
      readonly refusals: ReadonlyArray<TransactionRefusalView>;
    }
  | { readonly status: "refused"; readonly refusals: ReadonlyArray<TransactionRefusalView> };

export type TransactionListRequest = {
  readonly team?: string;
  readonly state?: "today" | "saved" | "ended";
  readonly after?: {
    readonly runDay: string | null;
    readonly team: string;
    readonly position: number;
    readonly move: string;
  };
  readonly limit?: number;
};

export type TransactionTimelineRequest = {
  readonly after?: TransactionListRequest["after"];
  readonly limit?: number;
};

export type TransactionPlanRequest = {
  readonly team: string;
};

export type TransactionSaveMoveRequest = {
  readonly team: string;
  readonly move: string;
  readonly runDay: string;
};

export type TransactionDiscardMoveRequest = {
  readonly team: string;
  readonly move: string;
};

export type TransactionDiscardGroupRequest = {
  readonly team: string;
  readonly move: string;
};

export type TransactionFixMoveRequest = {
  readonly team: string;
  readonly move: string;
};

export type TransactionRetryMoveRequest = {
  readonly team: string;
  readonly move: string;
  readonly key: string;
};

export type TransactionConfirmRequest = {
  readonly team: string;
  readonly moves: ReadonlyArray<string>;
  readonly key: string;
};

export type TransactionError = {
  readonly type:
    | "transactions.team_not_found"
    | "transactions.move_not_found"
    | "transactions.run_in_progress"
    | "transactions.persistence_failed"
    | "transactions.unavailable"
    | "transactions.input_invalid";
};

export type TransactionRequestResult<A> =
  | UseCaseResult<A, TransactionError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
