import type { FantasyLeague, FantasySport } from "@lineupkeep/backend/connections/FantasyTeam";
import type {
  ProposalItemKind,
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

export type TransactionReviewItemView = {
  readonly id: string;
  readonly kind: ProposalItemKind;
  readonly adds: ReadonlyArray<TransactionReviewPlayerView>;
  readonly drops: ReadonlyArray<TransactionReviewPlayerView>;
  readonly bid?: number;
  readonly reason: string;
  readonly staleness: {
    readonly status: ProposalStalenessStatus;
    readonly checkedAt?: string;
    readonly reasons: ReadonlyArray<TransactionReviewStaleReasonView>;
  };
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
  readonly failure?: string;
  readonly items: ReadonlyArray<TransactionReviewItemView>;
};

export type TransactionReviewView = {
  readonly set: {
    readonly id: string;
    readonly proposedBy: {
      readonly kind: "user" | "agent";
      readonly surface: "app" | "mcp";
    };
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly expired: boolean;
  };
  readonly teams: ReadonlyArray<TransactionReviewTeamView>;
};

export type TransactionReviewData = {
  readonly review: TransactionReviewView;
};

export type TransactionReviewError = {
  readonly type:
    | "transactions.set_not_found"
    | "transactions.persistence_failed"
    | "transactions.unavailable"
    | "transactions.input_invalid";
};

export type TransactionReviewRequestResult<A> =
  | UseCaseResult<A, TransactionReviewError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
