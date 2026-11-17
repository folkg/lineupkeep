import type {
  TransactionMoveDay,
  TransactionMoveList,
  TransactionMoveRead,
  TransactionMoveValidationView,
  TransactionPlanDay,
  TransactionPlanGroupRead,
  TransactionPlanRead,
  TransactionPlanServiceError,
} from "@lineupkeep/backend/connections/TransactionPlans";
import { DateTime, Schema } from "effect";

import type {
  TransactionMoveActionData,
  TransactionMoveConfirmationData,
  TransactionMoveDayView,
  TransactionMoveListData,
  TransactionMoveTeamDayView,
  TransactionMoveView,
  TransactionPlanData,
  TransactionPlanDayView,
  TransactionPlanGroupView,
} from "#contracts/connections/transactionContract.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";

export function toTransactionMoveListView(list: TransactionMoveList): TransactionMoveListData {
  return {
    status: "ok",
    ...(list.team === undefined ? {} : { team: list.team }),
    nextRunAt: DateTime.formatIso(list.nextRunAt),
    moves: list.moves.map(toMoveView),
    days: list.days.map(toMoveDayView),
    groups: list.groups.map(toGroupView),
    teamFacts: list.teamFacts,
    counts: list.counts,
    teamCount: list.teamCount,
    page: {
      returned: list.page.returned,
      complete: list.page.complete,
      ...(list.page.next === undefined
        ? {}
        : {
            next: {
              runDay: list.page.next.runDay,
              team: list.page.next.team,
              position: list.page.next.position,
              move: list.page.next.move,
            },
          }),
    },
  };
}

export function toTransactionPlanData(plan: TransactionPlanRead): TransactionPlanData {
  return {
    team: plan.team,
    ...(plan.today === undefined ? {} : { today: plan.today }),
    nextRunAt: DateTime.formatIso(plan.nextRunAt),
    snapshot:
      plan.snapshot.status === "live"
        ? {
            status: "live",
            checkedAt: DateTime.formatIso(plan.snapshot.checkedAt),
            source: plan.snapshot.source,
          }
        : plan.snapshot.status === "stored"
          ? {
              status: "stored",
              checkedAt: DateTime.formatIso(plan.snapshot.checkedAt),
              note: plan.snapshot.note,
            }
          : { status: "unavailable", note: plan.snapshot.note },
    ...(plan.waiverBid === undefined ? {} : { waiverBid: plan.waiverBid }),
    ...(plan.places === undefined ? {} : { places: plan.places }),
    ...(plan.reserve === undefined ? {} : { reserve: plan.reserve }),
    ...(plan.addsPossible === undefined ? {} : { addsPossible: plan.addsPossible }),
    moves: plan.moves.map(toMoveView),
    days: plan.days.map(toPlanDayView),
    groups: plan.groups.map(toGroupView),
  };
}

function toGroupView(group: TransactionPlanGroupRead): TransactionPlanGroupView {
  return {
    group: group.group,
    team: group.team,
    ...(group.label === undefined ? {} : { label: group.label }),
    status: group.status,
    moves: group.moves,
    ...(group.fixesFor === undefined ? {} : { fixesFor: group.fixesFor }),
    actions: group.actions,
    ...(group.failed === undefined ? {} : { failed: group.failed }),
    notRun: group.notRun,
    detail: group.detail,
    ...(group.cure === undefined ? {} : { cure: group.cure }),
  };
}

function toMoveView(move: TransactionMoveRead): TransactionMoveView {
  return {
    move: move.move,
    team: move.team,
    ...(move.group === undefined ? {} : { group: move.group }),
    kind: move.kind,
    position: move.position,
    decision: move.decision,
    reason: move.reason,
    adds: move.adds,
    fallbacks: move.fallbacks,
    drops: move.drops,
    picks: move.picks,
    ...(move.slotMove === undefined ? {} : { slotMove: move.slotMove }),
    ...(move.intent === undefined ? {} : { intent: move.intent }),
    ...(move.placement === undefined ? {} : { placement: move.placement }),
    ...(move.bid === undefined ? {} : { bid: move.bid }),
    ...(move.runDay === undefined ? {} : { runDay: move.runDay }),
    ...(move.effectiveDate === undefined ? {} : { effectiveDate: move.effectiveDate }),
    ...(move.decidedAt === undefined ? {} : { decidedAt: DateTime.formatIso(move.decidedAt) }),
    ...(move.decidedBy === undefined ? {} : { decidedBy: move.decidedBy }),
    ...(move.surface === undefined ? {} : { surface: move.surface }),
    ...(move.confirmation === undefined
      ? {}
      : {
          confirmation: {
            by: move.confirmation.by,
            at: DateTime.formatIso(move.confirmation.at),
          },
        }),
    ...(move.runAt === undefined ? {} : { runAt: DateTime.formatIso(move.runAt) }),
    ...(move.runDecidedBy === undefined ? {} : { runDecidedBy: move.runDecidedBy }),
    ...(move.runSurface === undefined ? {} : { runSurface: move.runSurface }),
    validation: validationView(move.validation),
    check: move.check,
    ...(move.result === undefined ? {} : { result: move.result }),
    ...(move.resultDetail === undefined ? {} : { resultDetail: move.resultDetail }),
    ...(move.resultAt === undefined ? {} : { resultAt: DateTime.formatIso(move.resultAt) }),
  };
}

function validationView(validation: TransactionMoveValidationView): {
  readonly status: TransactionMoveValidationView["status"];
  readonly checkedAt?: string;
  readonly reasons: ReadonlyArray<{ readonly code: string; readonly detail: string }>;
} {
  return {
    status: validation.status,
    ...(validation.checkedAt === undefined
      ? {}
      : { checkedAt: DateTime.formatIso(validation.checkedAt) }),
    reasons: validation.reasons.map((reason) => ({ code: reason.code, detail: reason.detail })),
  };
}

function toMoveDayView(day: TransactionMoveDay): TransactionMoveDayView {
  return {
    ...(day.day === undefined ? {} : { day: day.day }),
    today: day.today,
    teams: day.teams.map((entry): TransactionMoveTeamDayView => ({
      team: entry.team,
      moves: entry.moves.map(toMoveView),
    })),
  };
}

function toPlanDayView(day: TransactionPlanDay): TransactionPlanDayView {
  return {
    ...(day.day === undefined ? {} : { day: day.day }),
    today: day.today,
    moves: day.moves.map(toMoveView),
  };
}

export class TransactionInputInvalid extends Schema.TaggedError<
  TransactionInputInvalid,
  { readonly brand: unique symbol }
>()("TransactionInputInvalid", {}) {}

export function mapTransactionError(
  error: TransactionPlanServiceError,
): ExpectedFailure<
  | "transactions.team_not_found"
  | "transactions.move_not_found"
  | "transactions.run_in_progress"
  | "transactions.persistence_failed"
  | "transactions.unavailable"
  | "transactions.input_invalid"
> {
  switch (error._tag) {
    case "transaction_plan.facts_unavailable":
      return { type: "transactions.unavailable", outcome: "rejected" };
    case "transaction_plan.team_not_found":
      return { type: "transactions.team_not_found", outcome: "rejected" };
    case "transaction_plan.move_not_found":
      return { type: "transactions.move_not_found", outcome: "rejected" };
    case "transaction_plan.run_in_progress":
      return { type: "transactions.run_in_progress", outcome: "conflict" };
    case "transaction_plan.persistence_failed":
      return { type: "transactions.persistence_failed", outcome: "failure" };
  }
}

export function confirmationOf(input: {
  readonly confirmed: ReadonlyArray<string>;
  readonly counts: {
    readonly moves: number;
    readonly executed: number;
    readonly pending: number;
    readonly failed: number;
    readonly skipped: number;
    readonly unknown: number;
  };
  readonly refusals: ReadonlyArray<{ readonly code: string; readonly detail: string }>;
}): TransactionMoveConfirmationData {
  return input.refusals.length === 0
    ? {
        status: "confirmed",
        confirmed: input.confirmed,
        counts: input.counts,
        refusals: [],
      }
    : {
        status: "refused",
        refusals: input.refusals.map((entry) => ({ code: entry.code, detail: entry.detail })),
      };
}

export function actionOf(
  move: string,
  status: "saved" | "discarded",
  refused: ReadonlyArray<{ readonly code: string; readonly detail: string }>,
  confirmationCleared = false,
): TransactionMoveActionData {
  if (refused.length > 0) {
    return {
      status: "refused",
      refusals: refused.map((entry) => ({ code: entry.code, detail: entry.detail })),
    };
  }
  return status === "saved" ? { status, move, confirmationCleared } : { status, move };
}
