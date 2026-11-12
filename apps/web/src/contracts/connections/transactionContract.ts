import type { FantasyLeague, FantasySport } from "@lineupkeep/backend/connections/FantasyTeam";
import type {
  ProposalItemKind,
  ProposalItemState,
  ProposalOutcome,
  ProposalStalenessStatus,
} from "@lineupkeep/backend/connections/TransactionProposals";

import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";
import type { UseCaseResult } from "#contracts/useCaseContract.ts";

export type TransactionReviewPlayerView = {
  readonly name?: string;
  readonly position?: string;
  readonly proTeam?: string;
  readonly availability?: string;
};

export type TransactionReviewStaleReasonView = {
  readonly code: string;
  readonly detail: string;
};

export type TransactionReviewStepView = {
  readonly kind: "reserve_move" | "slot_move" | "add" | "drop";
  readonly playerName?: string;
  readonly fromSlot?: string;
  readonly toSlot?: string;
  readonly outcome: ProposalOutcome;
  readonly detail?: string;
  readonly decidedAt: string;
};

export type TransactionReviewExecutionView = {
  readonly position?: number;
  readonly outcome: ProposalOutcome;
  readonly detail?: string;
  readonly decidedAt: string;
  readonly steps: ReadonlyArray<TransactionReviewStepView>;
};

type TransactionReviewReserveMoveView = {
  readonly playerName?: string;
  readonly fromSlot?: string;
  readonly toSlot: string;
  readonly order: "before" | "after";
};

type TransactionReviewSlotMoveView = {
  readonly playerName?: string;
  readonly fromSlot?: string;
  readonly toSlot: string;
};

type TransactionReviewPlacementView = {
  readonly playerName?: string;
  readonly fromSlot?: string;
  readonly toSlot: string;
  readonly detail: string;
};

type TransactionReviewLineupView = {
  readonly status:
    | "settled"
    | "pending"
    | "blocked"
    | "failed"
    | "uncertain"
    | "not_started"
    | "not_needed"
    | "superseded";
  readonly detail: string;
  readonly run?: string;
  readonly at?: string;
};

type TransactionReviewCounterpartyView = {
  readonly ref: string;
  readonly name?: string;
  readonly managerName?: string;
};

type TransactionReviewTradePartyView = {
  readonly ref: string;
  readonly name: string;
};

export type TransactionReviewTradePickView = {
  readonly round: number;
  readonly from: TransactionReviewTradePartyView;
  readonly to: TransactionReviewTradePartyView;
};

type TransactionReviewTradeSupportView = {
  readonly assets: ReadonlyArray<"player" | "draft_pick">;
  readonly detail: string;
};

export type TransactionReviewTradeView = {
  readonly state: "pending" | "accepted" | "withdrawn" | "expired";
  readonly requestedAt: string;
  readonly proposedAt?: string;
  readonly settledAt?: string;
  readonly detail?: string;
};

type TransactionReviewOfferPartyView = {
  readonly ref: string;
  readonly name?: string;
};

type TransactionReviewOfferPlayerView = {
  readonly player: string;
  readonly name?: string;
  readonly displayPosition?: string;
  readonly proTeam?: string;
  readonly from?: TransactionReviewOfferPartyView;
  readonly to?: TransactionReviewOfferPartyView;
};

type TransactionReviewOfferPickView = {
  readonly round: number;
  readonly from?: TransactionReviewOfferPartyView;
  readonly to?: TransactionReviewOfferPartyView;
  readonly original?: TransactionReviewOfferPartyView;
};

export type TransactionReviewPendingOfferView = {
  readonly offerRef: string;
  readonly proposedAt: string;
  readonly note?: string;
  readonly canRespond: boolean;
  readonly proposingTeam?: TransactionReviewOfferPartyView;
  readonly receivingTeam?: TransactionReviewOfferPartyView;
  readonly players: ReadonlyArray<TransactionReviewOfferPlayerView>;
  readonly picks: ReadonlyArray<TransactionReviewOfferPickView>;
  readonly incomplete?: string;
};

export type TransactionReviewItemView = {
  readonly id: string;
  readonly kind: ProposalItemKind;
  readonly adds: ReadonlyArray<TransactionReviewPlayerView>;
  readonly drops: ReadonlyArray<TransactionReviewPlayerView>;
  readonly picks: ReadonlyArray<TransactionReviewTradePickView>;
  readonly bid?: number;
  readonly reason: string;
  readonly state: ProposalItemState;
  readonly outcomeDetail?: string;
  readonly staleness: {
    readonly status: ProposalStalenessStatus;
    readonly checkedAt?: string;
    readonly reasons: ReadonlyArray<TransactionReviewStaleReasonView>;
  };
  readonly execution?: TransactionReviewExecutionView;
  readonly reserveMove?: TransactionReviewReserveMoveView;
  readonly slotMove?: TransactionReviewSlotMoveView;
  readonly placement?: TransactionReviewPlacementView;
  readonly counterparty?: TransactionReviewCounterpartyView;
  readonly trade?: TransactionReviewTradeView;
};

export type TransactionReviewTradeRulesView = {
  readonly endDate?: string;
  readonly ratification?: "vote" | "commissioner" | "none" | "unknown";
  readonly objectionDays?: number;
};

type TransactionReviewRosterPlacesView = {
  readonly maximum: number;
  readonly occupied: number;
  readonly net: number;
};

export type TransactionReviewOrderView =
  | {
      readonly status: "ordered";
      readonly timing: "same_day" | "next_day" | "weekly_lock" | "not_published";
      readonly effectiveDate?: string;
      readonly rosterPlaces: TransactionReviewRosterPlacesView;
      readonly steps: ReadonlyArray<{
        readonly item: string;
        readonly position: number;
        readonly rosterPlace?: "frees" | "consumes";
      }>;
    }
  | {
      readonly status: "conflict";
      readonly timing: "same_day" | "next_day" | "weekly_lock" | "not_published";
      readonly effectiveDate?: string;
      readonly conflicts: ReadonlyArray<{
        readonly items: ReadonlyArray<string>;
        readonly detail: string;
      }>;
    }
  | {
      readonly status: "unresolved";
      readonly timing: "same_day" | "next_day" | "weekly_lock" | "not_published";
      readonly effectiveDate?: string;
      readonly detail: string;
    };

export type TransactionReviewTeamView = {
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly league: FantasyLeague;
    readonly sport: FantasySport;
    readonly season: number;
  };
  readonly budget?:
    | { readonly status: "published"; readonly remaining: number }
    | { readonly status: "not_published"; readonly detail: string };
  readonly tradeProposal?: TransactionReviewTradeSupportView;
  readonly tradeRules?: TransactionReviewTradeRulesView;
  readonly order?: TransactionReviewOrderView;
  readonly lineup?: TransactionReviewLineupView;
  readonly failure?: string;
  readonly items: ReadonlyArray<TransactionReviewItemView>;
  readonly pendingOffers: ReadonlyArray<TransactionReviewPendingOfferView>;
};

export type TransactionReviewView = {
  readonly set: {
    readonly id: string;
    readonly proposedBy: {
      readonly kind: "user" | "agent";
      readonly surface: "app" | "mcp";
    };
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly submissions: ReadonlyArray<{
      readonly submittedAt: string;
      readonly completedAt?: string;
    }>;
    readonly closed: boolean;
  };
  readonly teams: ReadonlyArray<TransactionReviewTeamView>;
};

export type TransactionReviewData = {
  readonly review: TransactionReviewView;
  readonly submittedBids?: ReadonlyArray<{ readonly item: string; readonly bid: number }>;
};

export type SubmitTransactionReviewRequest = {
  readonly set: string;
  readonly include: ReadonlyArray<string>;
  readonly bids: ReadonlyArray<{ readonly item: string; readonly bid: number }>;
};

export type DismissTransactionProposalRequest = {
  readonly set: string;
  readonly items: ReadonlyArray<string>;
  readonly reason?: string;
};

export type DismissTransactionProposalData =
  | {
      readonly outcome: "dismissed";
      readonly review: TransactionReviewView;
    }
  | {
      readonly outcome: "refused";
      readonly detail: string;
      readonly refusals: ReadonlyArray<{ readonly item: string; readonly detail: string }>;
    };

export type WithdrawTradeData = {
  readonly status: "withdrawn" | "not_pending";
  readonly detail: string;
};
export type WithdrawTradeRequest = {
  readonly team: string;
  readonly item?: string;
  readonly offer?: string;
};

export type TransactionReviewError = {
  readonly type:
    | "transactions.set_not_found"
    | "transactions.persistence_failed"
    | "transactions.unavailable"
    | "transactions.input_invalid"
    | "transactions.set_closed"
    | "transactions.items_not_open"
    | "transactions.submission_in_progress"
    | "transactions.nothing_included"
    | "transactions.trade_not_found"
    | "transactions.trade_not_pending";
};

export type TransactionReviewRequestResult<A> =
  | UseCaseResult<A, TransactionReviewError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
