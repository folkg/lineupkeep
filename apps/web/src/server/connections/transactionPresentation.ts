import type {
  ProposalError,
  ProposalSetReview,
  ProposalStaleReason,
} from "@lineupkeep/backend/connections/TransactionProposals";
import { DateTime, Schema } from "effect";

import type {
  TransactionReviewItemView,
  TransactionReviewPlayerView,
  TransactionReviewStaleReasonView,
  TransactionReviewTeamView,
  TransactionReviewView,
} from "#contracts/connections/transactionContract.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";

const unreadableTeamDetail =
  "This team could not be checked against current state. Its moves are excluded until the team can be read again.";
const unreadableItemDetail =
  "The team's current state could not be read, so this move cannot be included.";

export function toTransactionReviewView(review: ProposalSetReview): TransactionReviewView {
  return {
    set: {
      id: review.set.id,
      proposedBy: {
        kind: review.set.proposedBy.kind,
        surface: review.set.proposedBy.surface,
      },
      createdAt: DateTime.formatIso(review.set.createdAt),
      expiresAt: DateTime.formatIso(review.set.expiresAt),
      expired: review.set.expired,
      ...(review.set.submission === undefined
        ? {}
        : {
            submission: {
              submittedAt: DateTime.formatIso(review.set.submission.submittedAt),
              ...(review.set.submission.completedAt === undefined
                ? {}
                : { completedAt: DateTime.formatIso(review.set.submission.completedAt) }),
            },
          }),
    },
    teams: review.teams.map(toTeamView),
  };
}

function toTeamView(team: ProposalSetReview["teams"][number]): TransactionReviewTeamView {
  return {
    team: {
      id: team.team.id,
      name: team.team.name,
      league: team.team.league,
      sport: team.team.sport,
      season: team.team.season,
    },
    ...(team.budget === undefined
      ? {}
      : team.budget.status === "published"
        ? { budget: { status: "published" as const, remaining: team.budget.remaining } }
        : { budget: { status: "not_published" as const, detail: team.budget.detail } }),
    ...(team.failure === undefined ? {} : { failure: unreadableTeamDetail }),
    items: team.items.map(toItemView),
  };
}

function toItemView(
  item: ProposalSetReview["teams"][number]["items"][number],
): TransactionReviewItemView {
  return {
    id: item.id,
    kind: item.kind,
    adds: item.adds.map(toPlayerView),
    drops: item.drops.map(toPlayerView),
    ...(item.bid === undefined ? {} : { bid: item.bid }),
    reason: item.reason,
    state: item.state,
    staleness: {
      status: item.staleness.status,
      ...(item.staleness.checkedAt === undefined
        ? {}
        : { checkedAt: DateTime.formatIso(item.staleness.checkedAt) }),
      reasons: item.staleness.reasons.map(toStaleReasonView),
    },
    ...(item.execution === undefined
      ? {}
      : {
          execution: {
            outcome: item.execution.outcome,
            ...(item.execution.detail === undefined ? {} : { detail: item.execution.detail }),
            decidedAt: DateTime.formatIso(item.execution.decidedAt),
            steps: item.execution.steps.map((step) => ({
              kind: step.kind,
              ...(step.player.name === undefined ? {} : { playerName: step.player.name }),
              ...(step.fromSlot === undefined ? {} : { fromSlot: step.fromSlot }),
              ...(step.toSlot === undefined ? {} : { toSlot: step.toSlot }),
              outcome: step.outcome,
              ...(step.detail === undefined ? {} : { detail: step.detail }),
              decidedAt: DateTime.formatIso(step.decidedAt),
            })),
          },
        }),
    ...(item.reserveMove === undefined
      ? {}
      : {
          reserveMove: {
            ...(item.reserveMove.player.name === undefined
              ? {}
              : { playerName: item.reserveMove.player.name }),
            fromSlot: item.reserveMove.fromSlot,
            toSlot: item.reserveMove.toSlot,
          },
        }),
  };
}

function toPlayerView(
  player: ProposalSetReview["teams"][number]["items"][number]["adds"][number],
): TransactionReviewPlayerView {
  return {
    ...(player.name === undefined ? {} : { name: player.name }),
    ...(player.position === undefined ? {} : { position: player.position }),
    ...(player.proTeam === undefined ? {} : { proTeam: player.proTeam }),
    ...(player.availability === undefined ? {} : { availability: player.availability }),
  };
}

function toStaleReasonView(reason: ProposalStaleReason): TransactionReviewStaleReasonView {
  return {
    code: reason.code,
    detail: reason.code === "state_unavailable" ? unreadableItemDetail : reason.detail,
  };
}

export class TransactionInputInvalid extends Schema.TaggedError<
  TransactionInputInvalid,
  { readonly brand: unique symbol }
>()("TransactionInputInvalid", {}) {}

export function mapTransactionReviewError(
  error: ProposalError,
): ExpectedFailure<
  | "transactions.set_not_found"
  | "transactions.persistence_failed"
  | "transactions.unavailable"
  | "transactions.input_invalid"
  | "transactions.set_expired"
  | "transactions.already_submitted"
  | "transactions.nothing_included"
> {
  switch (error._tag) {
    case "proposal.set_not_found":
      return { type: "transactions.set_not_found", outcome: "rejected" };
    case "proposal.content_invalid":
    case "proposal.nothing_accepted":
      return { type: "transactions.input_invalid", outcome: "rejected" };
    case "proposal.nothing_included":
      return { type: "transactions.nothing_included", outcome: "rejected" };
    case "proposal.set_expired":
      return { type: "transactions.set_expired", outcome: "rejected" };
    case "proposal.already_submitted":
      return { type: "transactions.already_submitted", outcome: "conflict" };
    case "proposal.team_not_found":
    case "proposal.connection_not_ready":
    case "proposal.provider_unavailable":
      return { type: "transactions.unavailable", outcome: "rejected" };
    case "proposal.persistence_failed":
      return { type: "transactions.persistence_failed", outcome: "failure" };
  }
}
