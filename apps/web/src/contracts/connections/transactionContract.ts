import type { FantasyLeague, FantasySport } from "@lineupkeep/backend/connections/FantasyTeam";
import type { TransactionMoveKind } from "@lineupkeep/backend/connections/TransactionPlans";

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
  readonly decision: "undecided" | "saved" | "now" | "discarded";
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
  readonly validation: TransactionMoveValidationView;
  readonly check: TransactionMoveCheckView;
  readonly result?:
    | "executed"
    | "pending"
    | "failed"
    | "skipped"
    | "unknown"
    | "withdrawn"
    | "expired";
};

export type TransactionMoveTeamDayView = {
  readonly team: TransactionMoveTeamView;
  readonly moves: ReadonlyArray<TransactionMoveView>;
};

export type TransactionMoveDayView = {
  readonly day?: string;
  readonly today: boolean;
  readonly teams: ReadonlyArray<TransactionMoveTeamDayView>;
};

export type TransactionPlanDayView = {
  readonly day?: string;
  readonly today: boolean;
  readonly moves: ReadonlyArray<TransactionMoveView>;
};

export type TransactionMoveListData = {
  readonly status: "ok";
  readonly team?: TransactionMoveTeamView;
  readonly moves: ReadonlyArray<TransactionMoveView>;
  readonly days: ReadonlyArray<TransactionMoveDayView>;
  readonly counts: {
    readonly open: number;
    readonly today: number;
    readonly saved: number;
    readonly ended: number;
  };
  readonly teamCount: number;
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

export type TransactionPlanData = {
  readonly team: TransactionMoveTeamView;
  readonly today?: string;
  readonly moves: ReadonlyArray<TransactionMoveView>;
  readonly days: ReadonlyArray<TransactionPlanDayView>;
};

type TransactionRefusalView = {
  readonly code: string;
  readonly detail: string;
};

export type TransactionMoveActionData =
  | { readonly status: "saved" | "discarded"; readonly move: string }
  | { readonly status: "refused"; readonly refusals: ReadonlyArray<TransactionRefusalView> };

type TransactionTodayChoice = {
  readonly team: string;
  readonly move: string;
  readonly choice: "now" | "discard";
};

export type TransactionSubmitTodayData = {
  readonly status: "submitted";
  readonly counts: {
    readonly moves: number;
    readonly executed: number;
    readonly pending: number;
    readonly failed: number;
    readonly skipped: number;
    readonly unknown: number;
  };
  readonly discarded: number;
  readonly refusals: ReadonlyArray<TransactionRefusalView>;
};

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

export type TransactionSubmitTodayRequest = {
  readonly choices: ReadonlyArray<TransactionTodayChoice>;
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
