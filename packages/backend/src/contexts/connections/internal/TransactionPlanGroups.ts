import { Array as EffectArray } from "effect";
import { Option as EffectOption } from "effect";

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
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(value: A, f: (value: A) => B): B;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined {
  return value === undefined || value === null ? undefined : f(value);
}

function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

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
  return EffectArray.map(
    EffectArray.filter(
      EffectArray.map([...groups], ([group, members]) => ({
        group,
        members: sortMembers(
          EffectArray.filter(members, (member) => isLiveMemberOf(group, member)),
        ),
      })),
      (entry) => EffectArray.some(entry.members, (member) => !isDiscarded(member.move)),
    ).sort(
      (left, right) =>
        positionOf(firstMember(left.members)) - positionOf(firstMember(right.members)) ||
        left.group.localeCompare(right.group),
    ),
    (entry) => groupReadOf(entry.group, entry.members, input.steps),
  );
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
  const actions = EffectArray.flatMap(members, (member) => {
    const flatMapped1 = EffectArray.map(steps.get(member.move.id) ?? [], (step) =>
      actionOf(member.move, step),
    );
    return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
  });
  const failed = EffectOption.getOrUndefined(
    EffectArray.findFirst(
      actions,
      (action) => action.outcome === "failed" || action.outcome === "unknown",
    ),
  );
  const notRun = optionalArrayValue(
    EffectArray.filter(members, (member) => didNotRun(member) && member.move.id !== failed?.move),
    (value) => EffectArray.map(value, (member) => member.move.id),
  );
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
    moves: EffectArray.map(members, (member) => member.move.id),
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
  if (EffectArray.some(members, (member) => isFailed(member))) {
    return "failed";
  }
  const executed = EffectArray.filter(members, (member) => ran(member.move)).length;
  if (executed === members.length) {
    return "done";
  }
  if (executed > 0 || EffectArray.some(actions, (action) => action.outcome === "executed")) {
    return "partly_done";
  }
  const stopped = EffectArray.some(
    members,
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
      return sentence("This group ran whole.", ...EffectArray.map(input.actions, actionSentence));
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
        `${EffectArray.join(
          EffectArray.map(input.members, (member) => memberLabel(member.move)),
          ", ",
        )}.`,
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
  const blocked = EffectOption.getOrUndefined(
    EffectArray.findFirst(input.members, (member) => member.blockedBy !== undefined),
  );
  if (blocked !== undefined) {
    return sentence("This group does not run.", blocked.blockedBy);
  }
  const discarded = EffectOption.getOrUndefined(
    EffectArray.findFirst(input.members, (member) => isDiscarded(member.move)),
  );
  if (discarded !== undefined) {
    return sentence(
      "This group is not whole.",
      `The ${memberLabel(discarded.move)} was discarded, so the rest cannot run until you discard the group or form it again.`,
    );
  }
  const invalid = EffectOption.getOrUndefined(
    EffectArray.findFirst(input.members, (member) => member.validation.status !== "current"),
  );
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
  const attempted = EffectArray.flatMap(members, (member) => {
    const flatMapped2 = EffectArray.map(
      member.move.attempts,
      (attempt) =>
        `${attempt.kind === "claim" ? "Claim" : "Fallback"} ${attempt.player.name ?? attempt.player.key}: ${attempt.reason}`,
    );
    return arrayValueIsArray(flatMapped2) ? flatMapped2 : [flatMapped2];
  });
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
  return EffectArray.map(
    EffectArray.filter(
      actions,
      (action) =>
        action === failed ||
        action.outcome === "executed" ||
        action.outcome === "pending" ||
        action.outcome === "skipped",
    ),
    actionSentence,
  );
}

function notRunSentences(
  members: ReadonlyArray<TransactionPlanGroupMember>,
  failed: TransactionPlanGroupAction | undefined,
): ReadonlyArray<string> {
  return optionalArrayValue(
    EffectArray.filter(members, (member) => didNotRun(member) && member.move.id !== failed?.move),
    (value) => EffectArray.map(value, (member) => `The ${memberLabel(member.move)} did not run.`),
  );
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
      const drops = EffectArray.flatMap(move.drops, (drop) => {
        const flatMapped3 = drop.name === undefined ? [] : [drop.name];
        return arrayValueIsArray(flatMapped3) ? flatMapped3 : [flatMapped3];
      });
      const base = player === undefined ? noun : `${noun} of ${player}`;
      return drops.length === 0 ? base : `${base} and drop of ${EffectArray.join(drops, ", ")}`;
    }
    case "slot_move": {
      const player = move.slotMove?.playerName ?? move.slotMove?.playerKey;
      const drops = EffectArray.flatMap(move.drops, (drop) => {
        const flatMapped4 = drop.name === undefined ? [] : [drop.name];
        return arrayValueIsArray(flatMapped4) ? flatMapped4 : [flatMapped4];
      });
      const base = player === undefined ? "slot move" : `slot move of ${player}`;
      return drops.length === 0 ? base : `${base} and drop of ${EffectArray.join(drops, ", ")}`;
    }
  }
}

function playerNameOf(move: TransactionMoveRecord, playerKey: string): string | undefined {
  const named: ReadonlyArray<{ readonly key: string; readonly name: string | undefined }> = [
    ...EffectArray.map([...move.adds, ...move.fallbacks, ...move.drops], (player) => ({
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
  return EffectOption.getOrUndefined(
    EffectArray.findFirst(named, (player) => player.key === playerKey),
  )?.name;
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
  return EffectArray.join(
    EffectArray.filter(parts, (part) => part !== undefined),
    " ",
  );
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
