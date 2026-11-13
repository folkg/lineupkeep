import type {
  ProposalError,
  ProposalSetList,
  ProposalSetReview,
  ProposalStaleReason,
} from "@lineupkeep/backend/connections/TransactionProposals";
import { DateTime, Schema } from "effect";

import type {
  TransactionProposalListData,
  TransactionProposalSetSummaryView,
  TransactionReviewIllegalRosterView,
  TransactionReviewItemView,
  TransactionReviewOrderView,
  TransactionReviewPlayerView,
  TransactionReviewStaleReasonView,
  TransactionReviewPendingOfferView,
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
      updatedAt: DateTime.formatIso(review.set.updatedAt),
      submissions: review.set.submissions.map((submission) => ({
        submittedAt: DateTime.formatIso(submission.submittedAt),
        ...(submission.completedAt === undefined
          ? {}
          : { completedAt: DateTime.formatIso(submission.completedAt) }),
      })),
      closed: review.set.closed,
    },
    teams: review.teams.map(toTeamView),
  };
}

export function toTransactionProposalListView(list: ProposalSetList): TransactionProposalListData {
  return {
    status: "ok",
    team: toListTeam(list.team),
    sets: list.sets.map(toProposalSetSummaryView),
    page: {
      returned: list.page.returned,
      complete: list.page.complete,
      remaining: list.page.remaining,
      ...(list.page.next === undefined ? {} : { next: list.page.next }),
      ...(list.page.total === undefined ? {} : { total: list.page.total }),
    },
  };
}

function toProposalSetSummaryView(
  set: ProposalSetList["sets"][number],
): TransactionProposalSetSummaryView {
  return {
    id: set.id,
    proposedBy: {
      kind: set.proposedBy.kind,
      surface: set.proposedBy.surface,
      ...(set.proposedBy.client === undefined ? {} : { client: set.proposedBy.client }),
    },
    createdAt: DateTime.formatIso(set.createdAt),
    updatedAt: DateTime.formatIso(set.updatedAt),
    closed: set.closed,
    reviewPath: set.reviewPath,
    teams: set.teams.map((entry) => ({
      team: toListTeam(entry.team),
      items: entry.items.map((item) => ({ ...toItemView(item), settled: item.settled })),
      ...(entry.illegalRoster === undefined
        ? {}
        : { illegalRoster: entry.illegalRoster.map(toIllegalRosterView) }),
    })),
  };
}

function toListTeam(team: ProposalSetList["team"]): TransactionReviewTeamView["team"] {
  return {
    id: team.id,
    name: team.name,
    league: team.league,
    sport: team.sport,
    season: team.season,
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
    ...(team.tradeProposal === undefined
      ? {}
      : {
          tradeProposal: {
            assets: [...team.tradeProposal.assets],
            detail: team.tradeProposal.detail,
          },
        }),
    ...(team.tradeRules === undefined
      ? {}
      : {
          tradeRules: {
            ...(team.tradeRules.endDate === undefined ? {} : { endDate: team.tradeRules.endDate }),
            ...(team.tradeRules.ratification === undefined
              ? {}
              : { ratification: team.tradeRules.ratification }),
            ...(team.tradeRules.objectionDays === undefined
              ? {}
              : { objectionDays: team.tradeRules.objectionDays }),
          },
        }),
    ...(team.order === undefined ? {} : { order: toOrderView(team.order) }),
    ...(team.illegalRoster === undefined
      ? {}
      : { illegalRoster: team.illegalRoster.map(toIllegalRosterView) }),
    ...(team.today === undefined ? {} : { today: team.today }),
    ...(team.lineup === undefined
      ? {}
      : {
          lineup: {
            status: team.lineup.status,
            detail: team.lineup.detail,
            ...(team.lineup.run === undefined ? {} : { run: team.lineup.run }),
            ...(team.lineup.at === undefined ? {} : { at: team.lineup.at }),
          },
        }),
    ...(team.failure === undefined ? {} : { failure: unreadableTeamDetail }),
    items: team.items.map(toItemView),
    pendingOffers: team.pendingOffers.map(toPendingOfferView),
  };
}

function toIllegalRosterView(occupant: {
  readonly name: string;
  readonly slot: string;
  readonly detail: string;
}): TransactionReviewIllegalRosterView {
  return { name: occupant.name, slot: occupant.slot, detail: occupant.detail };
}

function toOrderView(
  order: NonNullable<ProposalSetReview["teams"][number]["order"]>,
): TransactionReviewOrderView {
  switch (order.status) {
    case "ordered":
      return {
        status: "ordered",
        timing: order.timing,
        ...(order.effectiveDate === undefined ? {} : { effectiveDate: order.effectiveDate }),
        ...(order.rosterPlaces === undefined ? {} : { rosterPlaces: order.rosterPlaces }),
        steps: order.steps.map((step) => ({
          item: step.item,
          position: step.position,
          ...(step.rosterPlace === undefined ? {} : { rosterPlace: step.rosterPlace }),
        })),
      };
    case "conflict":
      return {
        status: "conflict",
        timing: order.timing,
        ...(order.effectiveDate === undefined ? {} : { effectiveDate: order.effectiveDate }),
        conflicts: order.conflicts.map((conflict) => ({
          items: [...conflict.items],
          detail: conflict.detail,
        })),
      };
    case "unresolved":
      return {
        status: "unresolved",
        timing: order.timing,
        ...(order.effectiveDate === undefined ? {} : { effectiveDate: order.effectiveDate }),
        detail: order.detail,
      };
  }
}

function toItemView(
  item: ProposalSetReview["teams"][number]["items"][number],
): TransactionReviewItemView {
  return {
    id: item.id,
    kind: item.kind,
    adds: item.adds.map(toPlayerView),
    ...(item.fallbacks.length === 0 ? {} : { fallbacks: item.fallbacks.map(toPlayerView) }),
    drops: item.drops.map(toPlayerView),
    picks: item.picks.map((pick) => ({
      round: pick.round,
      from: { ref: pick.from.ref, name: pick.from.name },
      to: { ref: pick.to.ref, name: pick.to.name },
    })),
    ...(item.bid === undefined ? {} : { bid: item.bid }),
    ...(item.window === undefined ? {} : { window: item.window }),
    ...(item.approvedAt === undefined ? {} : { approvedAt: DateTime.formatIso(item.approvedAt) }),
    reason: item.reason,
    state: item.state,
    ...(item.outcomeDetail === undefined ? {} : { outcomeDetail: item.outcomeDetail }),
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
            ...(item.execution.position === undefined ? {} : { position: item.execution.position }),
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
            ...(item.reserveMove.fromSlot === undefined
              ? {}
              : { fromSlot: item.reserveMove.fromSlot }),
            toSlot: item.reserveMove.toSlot,
            order: item.reserveMove.order,
          },
        }),
    ...(item.slotMove === undefined
      ? {}
      : {
          slotMove: {
            ...(item.slotMove.player.name === undefined
              ? {}
              : { playerName: item.slotMove.player.name }),
            ...(item.slotMove.fromSlot === undefined ? {} : { fromSlot: item.slotMove.fromSlot }),
            toSlot: item.slotMove.toSlot,
          },
        }),
    ...(item.placement === undefined
      ? {}
      : {
          placement: {
            ...(item.placement.player.name === undefined
              ? {}
              : { playerName: item.placement.player.name }),
            ...(item.placement.fromSlot === undefined ? {} : { fromSlot: item.placement.fromSlot }),
            toSlot: item.placement.toSlot,
            detail: item.placement.detail,
          },
        }),
    ...(item.counterparty === undefined
      ? {}
      : {
          counterparty: {
            ref: item.counterparty.ref,
            ...(item.counterparty.name === undefined ? {} : { name: item.counterparty.name }),
            ...(item.counterparty.managerName === undefined
              ? {}
              : { managerName: item.counterparty.managerName }),
          },
        }),
    ...(item.trade === undefined
      ? {}
      : {
          trade: {
            state: item.trade.state,
            requestedAt: DateTime.formatIso(item.trade.requestedAt),
            ...(item.trade.proposedAt === undefined
              ? {}
              : { proposedAt: DateTime.formatIso(item.trade.proposedAt) }),
            ...(item.trade.settledAt === undefined
              ? {}
              : { settledAt: DateTime.formatIso(item.trade.settledAt) }),
            ...(item.trade.detail === undefined ? {} : { detail: item.trade.detail }),
          },
        }),
  };
}

function toPendingOfferView(
  offer: ProposalSetReview["teams"][number]["pendingOffers"][number],
): TransactionReviewPendingOfferView {
  return {
    offerRef: offer.offerRef,
    proposedAt: DateTime.formatIso(offer.proposedAt),
    ...(offer.note === undefined ? {} : { note: offer.note }),
    canRespond: offer.canRespond,
    ...(offer.proposingTeam === undefined
      ? {}
      : {
          proposingTeam: {
            ref: offer.proposingTeam.ref,
            ...(offer.proposingTeam.name === undefined ? {} : { name: offer.proposingTeam.name }),
          },
        }),
    ...(offer.receivingTeam === undefined
      ? {}
      : {
          receivingTeam: {
            ref: offer.receivingTeam.ref,
            ...(offer.receivingTeam.name === undefined ? {} : { name: offer.receivingTeam.name }),
          },
        }),
    players: offer.players.map((player) => ({
      player: player.player,
      ...(player.name === undefined ? {} : { name: player.name }),
      ...(player.displayPosition === undefined ? {} : { displayPosition: player.displayPosition }),
      ...(player.proTeam === undefined ? {} : { proTeam: player.proTeam }),
      ...(player.from === undefined
        ? {}
        : {
            from: {
              ref: player.from.ref,
              ...(player.from.name === undefined ? {} : { name: player.from.name }),
            },
          }),
      ...(player.to === undefined
        ? {}
        : {
            to: {
              ref: player.to.ref,
              ...(player.to.name === undefined ? {} : { name: player.to.name }),
            },
          }),
    })),
    picks: offer.picks.map((pick) => ({
      round: pick.round,
      ...(pick.from === undefined
        ? {}
        : {
            from: {
              ref: pick.from.ref,
              ...(pick.from.name === undefined ? {} : { name: pick.from.name }),
            },
          }),
      ...(pick.to === undefined
        ? {}
        : {
            to: { ref: pick.to.ref, ...(pick.to.name === undefined ? {} : { name: pick.to.name }) },
          }),
      ...(pick.original === undefined
        ? {}
        : {
            original: {
              ref: pick.original.ref,
              ...(pick.original.name === undefined ? {} : { name: pick.original.name }),
            },
          }),
    })),
    ...(offer.incomplete === undefined ? {} : { incomplete: offer.incomplete.detail }),
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
  | "transactions.set_closed"
  | "transactions.items_not_open"
  | "transactions.submission_in_progress"
  | "transactions.nothing_included"
  | "transactions.trade_not_found"
  | "transactions.trade_not_pending"
> {
  switch (error._tag) {
    case "proposal.set_not_found":
      return { type: "transactions.set_not_found", outcome: "rejected" };
    case "proposal.content_invalid":
    case "proposal.nothing_accepted":
      return { type: "transactions.input_invalid", outcome: "rejected" };
    case "proposal.items_not_open":
      return { type: "transactions.items_not_open", outcome: "rejected" };
    case "proposal.nothing_included":
      return { type: "transactions.nothing_included", outcome: "rejected" };
    case "proposal.trade_not_found":
      return { type: "transactions.trade_not_found", outcome: "rejected" };
    case "proposal.trade_not_pending":
      return { type: "transactions.trade_not_pending", outcome: "conflict" };
    case "proposal.set_closed":
      return { type: "transactions.set_closed", outcome: "conflict" };
    case "proposal.submission_in_progress":
      return { type: "transactions.submission_in_progress", outcome: "conflict" };
    case "proposal.team_not_found":
    case "proposal.connection_not_ready":
    case "proposal.provider_unavailable":
      return { type: "transactions.unavailable", outcome: "rejected" };
    case "proposal.persistence_failed":
      return { type: "transactions.persistence_failed", outcome: "failure" };
  }
}
