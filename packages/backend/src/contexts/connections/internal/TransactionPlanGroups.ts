import type {
  TransactionPlanGroupAction,
  TransactionPlanGroupRead,
  TransactionPlanGroupStatus,
} from "#contexts/connections/TransactionPlans.ts";
import { transactionMoveStatus } from "#contexts/connections/TransactionPlans.ts";

import { isRosterFixGroup, rosterFixFundedMove, rosterFixLabel } from "./TransactionPlanFixes.ts";
import type {
  TransactionMoveId,
  TransactionMoveRecord,
  StoredMoveStep,
  StoredMoveValidation,
} from "./TransactionPlanRecord.ts";

export function planGroupReads(input: PlanGroupInput): ReadonlyArray<TransactionPlanGroupRead> {
  const groups = new Map<string, Array<TransactionPlanGroupMember>>();
  for (const member of input.members) {
    const group = member.move.group;
    if (group === undefined) {
      continue;
    }
    const held = groups.get(group) ?? [];
    held.push(member);
    groups.set(group, held);
  }
  return [...groups]
    .map(([group, members]) => ({
      group,
      members: sortMembers(members.filter((member) => isLiveMemberOf(group, member))),
    }))
    .filter((entry) => entry.members.some((member) => !isDiscarded(member.move)))
    .sort(
      (left, right) =>
        positionOf(firstMember(left.members)) - positionOf(firstMember(right.members)) ||
        left.group.localeCompare(right.group),
    )
    .map((entry) => groupReadOf(entry.group, entry.members, input.steps));
}

function isDiscarded(move: TransactionMoveRecord): boolean {
  return move.decision === "discarded";
}

function isLiveMemberOf(group: string, member: TransactionPlanGroupMember): boolean {
  return !isRosterFixGroup(group) || !isDiscarded(member.move);
}

function groupReadOf(
  group: string,
  members: ReadonlyArray<TransactionPlanGroupMember>,
  steps: ReadonlyMap<TransactionMoveId, ReadonlyArray<StoredMoveStep>>,
): TransactionPlanGroupRead {
  const actions = members.flatMap((member) =>
    (steps.get(member.move.id) ?? []).map((step) => actionOf(member.move, step)),
  );
  const failed = actions.find(
    (action) => action.outcome === "failed" || action.outcome === "unknown",
  );
  const notRun = members
    .filter((member) => didNotRun(member) && member.move.id !== failed?.move)
    .map((member) => member.move.id);
  const status = statusOf(members, actions);
  const cure =
    status === "partly_done" || (status === "blocked" && actions.length > 0)
      ? "Check your roster, then choose the move again or discard it."
      : undefined;
  const fixesFor = rosterFixFundedMove(group);
  return {
    group,
    team: firstMember(members).move.team,
    ...(isRosterFixGroup(group) ? { label: rosterFixLabel } : {}),
    ...(fixesFor === undefined ? {} : { fixesFor }),
    status,
    moves: members.map((member) => member.move.id),
    actions,
    ...(failed === undefined ? {} : { failed }),
    notRun,
    detail: detailOf({ status, members, actions, failed, cure }),
    ...(cure === undefined ? {} : { cure }),
  };
}

function statusOf(
  members: ReadonlyArray<TransactionPlanGroupMember>,
  actions: ReadonlyArray<TransactionPlanGroupAction>,
): TransactionPlanGroupStatus {
  if (members.some((member) => isFailed(member))) {
    return "failed";
  }
  const executed = members.filter((member) => ran(member.move)).length;
  if (executed === members.length) {
    return "done";
  }
  if (executed > 0 || actions.some((action) => action.outcome === "executed")) {
    return "partly_done";
  }
  const stopped = members.some(
    (member) =>
      isDiscarded(member.move) ||
      member.move.result !== undefined ||
      member.validation.status !== "current" ||
      member.blockedBy !== undefined,
  );
  return stopped ? "blocked" : "ready";
}

function detailOf(input: {
  readonly status: TransactionPlanGroupStatus;
  readonly members: ReadonlyArray<TransactionPlanGroupMember>;
  readonly actions: ReadonlyArray<TransactionPlanGroupAction>;
  readonly failed: TransactionPlanGroupAction | undefined;
  readonly cure: string | undefined;
}): string {
  switch (input.status) {
    case "done":
      return sentence("This group ran whole.", ...input.actions.map(actionSentence));
    case "partly_done":
      return sentence(
        "This group ran in part.",
        ...actedSentences(input.actions, input.failed),
        ...notRunSentences(input.members, input.failed),
        input.cure,
      );
    case "blocked":
      return blockedDetail(input);
    case "failed":
      return failedDetail(input.members);
    case "ready":
      return sentence(
        "This group is ready to run whole, in this order:",
        `${input.members.map((member) => memberLabel(member.move)).join(", ")}.`,
      );
  }
}

function blockedDetail(input: {
  readonly members: ReadonlyArray<TransactionPlanGroupMember>;
  readonly actions: ReadonlyArray<TransactionPlanGroupAction>;
  readonly failed: TransactionPlanGroupAction | undefined;
  readonly cure: string | undefined;
}): string {
  if (input.actions.length > 0) {
    return sentence(
      "This group did not run.",
      ...actedSentences(input.actions, input.failed),
      ...notRunSentences(input.members, input.failed),
      input.cure,
    );
  }
  const blocked = input.members.find((member) => member.blockedBy !== undefined);
  if (blocked !== undefined) {
    return sentence("This group does not run.", blocked.blockedBy);
  }
  const discarded = input.members.find((member) => isDiscarded(member.move));
  if (discarded !== undefined) {
    return sentence(
      "This group is not whole.",
      `The ${memberLabel(discarded.move)} was discarded, so the rest cannot run until you discard the group or form it again.`,
    );
  }
  const invalid = input.members.find((member) => member.validation.status !== "current");
  if (invalid !== undefined) {
    const reason = invalid.validation.reasons[0];
    return sentence(
      "This group does not run.",
      `The ${memberLabel(invalid.move)} cannot run: ${reason?.detail ?? "its check did not pass."}`,
    );
  }
  return "This group does not run.";
}

function failedDetail(members: ReadonlyArray<TransactionPlanGroupMember>): string {
  const attempted = members.flatMap((member) =>
    member.move.attempts.map(
      (attempt) =>
        `${attempt.kind === "claim" ? "Claim" : "Fallback"} ${attempt.player.name ?? attempt.player.key}: ${attempt.reason}`,
    ),
  );
  return sentence(
    "This group ended failed.",
    "All choices failed.",
    ...attempted,
    "Nothing is waiting.",
  );
}

function isFailed(member: TransactionPlanGroupMember): boolean {
  switch (transactionMoveStatus(member.move)) {
    case "claim_lost":
    case "all_choices_failed":
    case "fallback_unknown":
      return true;
    case "open_undecided":
    case "open_saved":
    case "open_now":
    case "open_confirmed":
    case "discarded":
    case "ran_immediately":
    case "ran_on_schedule":
    case "claim_waiting":
    case "claim_won":
    case "claim_lost_fallback_ran":
    case "claim_lost_retrying":
    case "offer_sent":
    case "failed":
    case "skipped":
    case "unknown":
      return false;
  }
}

function ran(move: TransactionMoveRecord): boolean {
  const status = transactionMoveStatus(move);
  return (
    status === "ran_immediately" ||
    status === "ran_on_schedule" ||
    status === "claim_won" ||
    status === "claim_lost_fallback_ran"
  );
}

function actedSentences(
  actions: ReadonlyArray<TransactionPlanGroupAction>,
  failed: TransactionPlanGroupAction | undefined,
): ReadonlyArray<string> {
  return actions
    .filter(
      (action) =>
        action === failed ||
        action.outcome === "executed" ||
        action.outcome === "pending" ||
        action.outcome === "skipped",
    )
    .map(actionSentence);
}

function notRunSentences(
  members: ReadonlyArray<TransactionPlanGroupMember>,
  failed: TransactionPlanGroupAction | undefined,
): ReadonlyArray<string> {
  return members
    .filter((member) => didNotRun(member) && member.move.id !== failed?.move)
    .map((member) => `The ${memberLabel(member.move)} did not run.`);
}

function actionOf(move: TransactionMoveRecord, step: StoredMoveStep): TransactionPlanGroupAction {
  const player = playerNameOf(move, step.playerKey);
  return {
    move: move.id,
    action: step.kind,
    ...(player === undefined ? {} : { player }),
    ...(step.fromSlot === undefined ? {} : { fromSlot: step.fromSlot }),
    ...(step.toSlot === undefined ? {} : { toSlot: step.toSlot }),
    outcome: step.outcome,
    ...(step.detail === undefined ? {} : { detail: step.detail }),
  };
}

function actionSentence(action: TransactionPlanGroupAction): string {
  const subject = `The ${actionNoun(action)}`;
  switch (action.outcome) {
    case "executed":
      return `${subject} reached your league.`;
    case "pending":
      return `${subject} waits on the league's answer.`;
    case "failed":
      return `${subject} failed: ${action.detail ?? "your league refused it."}`;
    case "unknown":
      return `${subject} was not confirmed: ${action.detail ?? "your league did not answer."}`;
    case "skipped":
      return `${subject} did not run.`;
  }
}

function actionNoun(action: TransactionPlanGroupAction): string {
  const player = action.player === undefined ? "" : ` of ${action.player}`;
  const place = action.toSlot === undefined ? "" : ` to ${action.toSlot}`;
  switch (action.action) {
    case "add":
      return `add${player}`;
    case "drop":
      return `drop${player}`;
    case "reserve_move":
      return `move${player}${place}`;
    case "slot_move":
      return `slot move${player}${place}`;
  }
}

function memberLabel(move: TransactionMoveRecord): string {
  switch (move.kind) {
    case "free_agent_add":
      return "add";
    case "waiver_claim":
      return "claim";
    case "drop":
      return move.drops[0]?.name === undefined ? "drop" : `drop of ${move.drops[0].name}`;
    case "trade":
      return "trade";
    case "activate":
    case "stash": {
      const player = move.intent?.player?.name;
      const noun = move.kind === "activate" ? "activate" : "stash";
      const drops = move.drops.flatMap((drop) => (drop.name === undefined ? [] : [drop.name]));
      const base = player === undefined ? noun : `${noun} of ${player}`;
      return drops.length === 0 ? base : `${base} and drop of ${drops.join(", ")}`;
    }
    case "slot_move": {
      const player = move.slotMove?.playerName ?? move.slotMove?.playerKey;
      const drops = move.drops.flatMap((drop) => (drop.name === undefined ? [] : [drop.name]));
      const base = player === undefined ? "slot move" : `slot move of ${player}`;
      return drops.length === 0 ? base : `${base} and drop of ${drops.join(", ")}`;
    }
  }
}

function playerNameOf(move: TransactionMoveRecord, playerKey: string): string | undefined {
  const named: ReadonlyArray<{ readonly key: string; readonly name: string | undefined }> = [
    ...[...move.adds, ...move.fallbacks, ...move.drops].map((player) => ({
      key: player.key,
      name: player.name,
    })),
    ...(move.intent?.player === undefined
      ? []
      : [{ key: move.intent.player.key, name: move.intent.player.name }]),
    ...(move.slotMove === undefined
      ? []
      : [{ key: move.slotMove.playerKey, name: move.slotMove.playerName }]),
    ...(move.placement === undefined
      ? []
      : [{ key: move.placement.playerKey, name: move.placement.playerName }]),
  ];
  return named.find((player) => player.key === playerKey)?.name;
}

function didNotRun(member: TransactionPlanGroupMember): boolean {
  switch (transactionMoveStatus(member.move)) {
    case "discarded":
    case "failed":
    case "skipped":
    case "unknown":
    case "all_choices_failed":
    case "fallback_unknown":
      return true;
    case "open_undecided":
    case "open_saved":
    case "open_now":
    case "open_confirmed":
    case "ran_immediately":
    case "ran_on_schedule":
    case "claim_waiting":
    case "claim_won":
    case "claim_lost":
    case "claim_lost_fallback_ran":
    case "claim_lost_retrying":
    case "offer_sent":
      return false;
  }
}

function sortMembers(
  members: ReadonlyArray<TransactionPlanGroupMember>,
): ReadonlyArray<TransactionPlanGroupMember> {
  return [...members].sort(
    (left, right) =>
      positionOf(left) - positionOf(right) ||
      left.move.position - right.move.position ||
      left.move.id.localeCompare(right.move.id),
  );
}

function positionOf(member: TransactionPlanGroupMember): number {
  return member.runPosition ?? member.move.position;
}

function firstMember(
  members: ReadonlyArray<TransactionPlanGroupMember>,
): TransactionPlanGroupMember {
  const first = members[0];
  if (first === undefined) {
    throw new Error("A group read was built from no moves");
  }
  return first;
}

function sentence(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part) => part !== undefined).join(" ");
}

export type TransactionPlanGroupMember = {
  readonly move: TransactionMoveRecord;
  readonly validation: StoredMoveValidation;
  readonly blockedBy: string | undefined;
  readonly runPosition: number | undefined;
};

export type PlanGroupInput = {
  readonly members: ReadonlyArray<TransactionPlanGroupMember>;
  readonly steps: ReadonlyMap<TransactionMoveId, ReadonlyArray<StoredMoveStep>>;
};
