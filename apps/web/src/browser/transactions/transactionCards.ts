import { EffectArray } from "@lineupkeep/collections";
import { EffectOption } from "@lineupkeep/collections";
import { EffectString } from "@lineupkeep/collections";

import type {
  TransactionMoveDayView,
  TransactionMoveView,
  TransactionPlanGroupView,
} from "#contracts/connections/transactionContract.ts";

import { moveCount, moveSummary } from "./transactionCopy";

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

function groupCards(input: GroupCardsInput): ReadonlyArray<GroupCard> {
  const byGroup = new Map(EffectArray.map(input.groups, (group) => [group.group, group] as const));
  const fixesByFunded = new Map<string, Array<TransactionMoveView>>();
  const leads = new Map<string, Array<TransactionMoveView>>();
  for (const move of input.moves) {
    const group = move.group === undefined ? undefined : byGroup.get(move.group);
    if (group?.fixesFor !== undefined) {
      const held = fixesByFunded.get(group.fixesFor) ?? [];
      held.push(move);
      fixesByFunded.set(group.fixesFor, held);
      continue;
    }
    const key = move.group ?? move.move;
    const held = leads.get(key) ?? [];
    held.push(move);
    leads.set(key, held);
  }
  const cards: Array<GroupCard> = [];
  for (const [key, members] of leads) {
    const ordered = [...members].sort((left, right) => left.position - right.position);
    const lead = ordered[0];
    if (lead === undefined) {
      continue;
    }
    const group = byGroup.get(key);
    cards.push({
      key,
      lead,
      moves: ordered,
      fixes: EffectArray.flatMap(ordered, (move) => {
        const flatMapped1 = fixesByFunded.get(move.move) ?? [];
        return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
      }),
      today: input.today,
      ...(group === undefined ? {} : { group }),
    });
  }
  for (const [funded, fixes] of fixesByFunded) {
    if (
      EffectArray.some(cards, (card) =>
        EffectArray.some(card.moves, (move) => move.move === funded),
      )
    ) {
      continue;
    }
    const ordered = [...fixes].sort((left, right) => left.position - right.position);
    const lead = ordered[0];
    if (lead !== undefined) {
      cards.push({
        key: `fixes:${funded}`,
        lead,
        moves: ordered,
        fixes: [],
        today: input.today,
      });
    }
  }
  return cards.sort(
    (left, right) =>
      cardPosition(left) - cardPosition(right) ||
      EffectString.localeCompare(left.lead.team.name, right.lead.team.name),
  );
}

export function dayTeamCards(
  day: TransactionMoveDayView | undefined,
  groups: ReadonlyArray<TransactionPlanGroupView>,
): ReadonlyArray<DayTeamCards> {
  return optionalArrayValue(day?.teams ?? [], (value) =>
    EffectArray.map(value, (team) => ({
      team: team.team,
      cards: groupCards({ moves: team.moves, groups, today: day?.today === true }),
    })),
  );
}

export function cardMembers(card: GroupCard): ReadonlyArray<TransactionMoveView> {
  return EffectArray.filter(
    [...card.moves, ...card.fixes],
    (move) => move.decision !== "discarded",
  );
}

export function cardStatus(card: GroupCard): CardStatus {
  const members = cardMembers(card);
  const statuses = EffectArray.map(members, (move) => move.status);
  if (EffectArray.every(statuses, (status) => status === "claim_waiting")) {
    return { kind: "waiting", label: "With the league" };
  }
  if (EffectArray.every(statuses, (status) => status === "offer_sent")) {
    return { kind: "waiting", label: "Offer sent" };
  }
  if (EffectArray.every(statuses, (status) => status === "claim_lost_retrying")) {
    return { kind: "waiting", label: "Claim lost, retrying" };
  }
  if (
    EffectArray.every(
      statuses,
      (status) =>
        status === "claim_waiting" || status === "claim_lost_retrying" || status === "offer_sent",
    )
  ) {
    return { kind: "waiting", label: "Waiting" };
  }
  if (
    EffectArray.some(
      statuses,
      (status) => status === "ran_immediately" || status === "ran_on_schedule",
    )
  ) {
    return EffectArray.every(
      statuses,
      (status) => status === "ran_immediately" || status === "ran_on_schedule",
    )
      ? { kind: "ran" }
      : { kind: "partly-ran" };
  }
  if (
    EffectArray.some(
      statuses,
      (status) =>
        status === "failed" ||
        status === "unknown" ||
        status === "claim_lost" ||
        status === "all_choices_failed" ||
        status === "fallback_unknown",
    )
  ) {
    return { kind: "failed", label: failedLabel(statuses) };
  }
  if (
    card.group?.status === "blocked" ||
    EffectArray.some(statuses, (status) => status === "skipped") ||
    EffectArray.some(members, (move) => move.validation.status !== "current")
  ) {
    return { kind: "blocked" };
  }
  if (EffectArray.every(statuses, (status) => status === "open_now")) {
    return { kind: "running" };
  }
  if (
    EffectArray.every(statuses, (status) => status === "open_confirmed" || status === "open_now")
  ) {
    return {
      kind: "scheduled",
      ...(card.lead.sendsAt === undefined ? {} : { sendsAt: card.lead.sendsAt }),
    };
  }
  return { kind: "needs-decision" };
}

function failedLabel(statuses: ReadonlyArray<TransactionMoveView["status"]>): string {
  const first = statuses[0];
  if (first === undefined || EffectArray.some(statuses, (status) => status !== first)) {
    return "Failed";
  }
  if (first === "claim_lost") {
    return "Claim lost";
  }
  if (first === "all_choices_failed") {
    return "All choices failed";
  }
  if (first === "fallback_unknown" || first === "unknown") {
    return "Unknown outcome";
  }
  return "Failed";
}

export function cardNeedsDecision(card: GroupCard): boolean {
  return cardStatus(card).kind === "needs-decision";
}

export function cardIsOpenToday(card: GroupCard): boolean {
  const kind = cardStatus(card).kind;
  return kind !== "waiting" && kind !== "ran";
}

export function cardIsSettled(card: GroupCard): boolean {
  const kind = cardStatus(card).kind;
  if (kind === "needs-decision" || kind === "running") {
    return false;
  }
  return cardAction(card).kind === "none";
}

export function cardAction(card: GroupCard): CardAction {
  switch (cardStatus(card).kind) {
    case "needs-decision":
      return { kind: "decide" };
    case "blocked":
      return blockedAction(card);
    case "failed":
    case "partly-ran":
      return runAction(card);
    case "scheduled":
    case "waiting":
    case "running":
    case "ran":
      return { kind: "none" };
  }
}

export function cardNextAction(card: GroupCard): CardNextAction | undefined {
  const kind = cardStatus(card).kind;
  if (kind !== "blocked" && kind !== "failed" && kind !== "partly-ran") {
    return undefined;
  }
  const action = cardAction(card);
  switch (action.kind) {
    case "cure":
      return { text: action.text, tone: "danger" };
    case "dependency":
      return { text: action.text, tone: "muted" };
    case "retry":
    case "discard":
      return { text: action.text ?? card.group?.detail ?? "Check this move.", tone: "danger" };
    case "none":
      return { text: "Nothing is waiting for you.", tone: "muted" };
    case "decide":
      return undefined;
  }
}

export function cardTitle(card: GroupCard): string {
  if (card.group?.label !== undefined) {
    return card.group.label;
  }
  if (card.moves.length === 1) {
    const only = card.moves[0];
    return only === undefined ? "This move" : moveSummary(only);
  }
  return `Group of ${moveCount(card.moves.length)}`;
}

function blockedAction(card: GroupCard): CardAction {
  const members = cardMembers(card);
  const remaining = discardableMoves(card);
  const roster = EffectOption.getOrUndefined(
    EffectArray.findFirst(members, (move) => rosterReason(move) !== undefined),
  );
  if (roster !== undefined && card.fixes.length === 0) {
    return { kind: "cure", text: reasonText(members, roster) };
  }
  const dependency = EffectOption.getOrUndefined(
    EffectArray.findFirst(members, (move) => dependencyReason(move) !== undefined),
  );
  if (dependency !== undefined) {
    return { kind: "dependency", text: reasonText(members, dependency), moves: remaining };
  }
  return remaining.length === 0
    ? { kind: "none" }
    : {
        kind: "discard",
        moves: remaining,
        text:
          firstResultDetail(members) ??
          invalidReasonText(members) ??
          card.group?.cure ??
          card.group?.detail,
      };
}

function runAction(card: GroupCard): CardAction {
  if (retriable(card)) {
    return { kind: "retry", text: firstResultDetail(cardMembers(card)) };
  }
  const members = cardMembers(card);
  const remaining = discardableMoves(card);
  return remaining.length === 0
    ? { kind: "none" }
    : {
        kind: "discard",
        moves: remaining,
        text:
          firstResultDetail(members) ??
          invalidReasonText(members) ??
          card.group?.cure ??
          card.group?.detail,
      };
}

function retriable(card: GroupCard): boolean {
  if (cardStatus(card).kind !== "failed") {
    return false;
  }
  const members = cardMembers(card);
  if (members.length === 0) {
    return false;
  }
  if (EffectArray.some(members, (move) => move.phase !== undefined)) {
    return false;
  }
  if (EffectArray.some(members, (move) => move.validation.status !== "current")) {
    return false;
  }
  if (
    !EffectArray.every(members, (move) => move.result === "failed" || move.result === "skipped")
  ) {
    return false;
  }
  return optionalArrayValue(card.group?.actions ?? [], (value) =>
    EffectArray.every(value, (action) => action.outcome !== "executed"),
  );
}

function moveIsDiscardable(move: TransactionMoveView): boolean {
  return (
    move.decision !== "discarded" &&
    move.phase === undefined &&
    (move.result === undefined ||
      move.result === "failed" ||
      move.result === "skipped" ||
      move.result === "unknown")
  );
}

function discardableMoves(card: GroupCard): ReadonlyArray<TransactionMoveView> {
  return EffectArray.filter(cardMembers(card), moveIsDiscardable);
}

function rosterReason(
  move: TransactionMoveView,
): TransactionMoveView["validation"]["reasons"][number] | undefined {
  return EffectOption.getOrUndefined(
    EffectArray.findFirst(
      move.validation.reasons,
      (reason) => reason.code === "roster_full" || reason.code === "slot_illegal",
    ),
  );
}

function dependencyReason(
  move: TransactionMoveView,
): TransactionMoveView["validation"]["reasons"][number] | undefined {
  return EffectOption.getOrUndefined(
    EffectArray.findFirst(
      move.validation.reasons,
      (reason) => reason.code === "pending_outcome" || reason.code === "blocked_by_move",
    ),
  );
}

function reasonText(
  members: ReadonlyArray<TransactionMoveView>,
  move: TransactionMoveView,
): string {
  const reason = rosterReason(move) ?? dependencyReason(move);
  const detail = reason?.detail ?? move.validation.reasons[0]?.detail ?? "This move is blocked.";
  return members.length === 1 ? detail : `${moveSummary(move)}: ${detail}`;
}

function invalidReasonText(members: ReadonlyArray<TransactionMoveView>): string | undefined {
  const invalid = EffectOption.getOrUndefined(
    EffectArray.findFirst(members, (move) => move.validation.status !== "current"),
  );
  const reason = invalid?.validation.reasons[0];
  if (invalid === undefined || reason === undefined) {
    return undefined;
  }
  return members.length === 1 ? reason.detail : `${moveSummary(invalid)}: ${reason.detail}`;
}

function firstResultDetail(members: ReadonlyArray<TransactionMoveView>): string | undefined {
  const refused = EffectOption.getOrUndefined(
    EffectArray.findFirst(
      members,
      (move) =>
        move.resultDetail !== undefined &&
        (move.result === "failed" || move.result === "unknown" || move.result === "skipped"),
    ),
  );
  return refused?.resultDetail;
}

function cardPosition(card: GroupCard): number {
  return Math.min(
    ...EffectArray.map(card.moves, (move) => move.position),
    ...EffectArray.map(card.fixes, (move) => move.position),
  );
}

export type DayTeamCards = {
  readonly team: TransactionMoveDayView["teams"][number]["team"];
  readonly cards: ReadonlyArray<GroupCard>;
};

export type GroupCard = {
  readonly key: string;
  readonly lead: TransactionMoveView;
  readonly moves: ReadonlyArray<TransactionMoveView>;
  readonly fixes: ReadonlyArray<TransactionMoveView>;
  readonly today: boolean;
  readonly group?: TransactionPlanGroupView;
};

export type CardStatus =
  | { readonly kind: "needs-decision" }
  | { readonly kind: "scheduled"; readonly sendsAt?: string }
  | { readonly kind: "waiting"; readonly label: string }
  | { readonly kind: "running" }
  | { readonly kind: "partly-ran" }
  | { readonly kind: "blocked" }
  | { readonly kind: "failed"; readonly label: string }
  | { readonly kind: "ran" };

export type CardAction =
  | { readonly kind: "decide" }
  | { readonly kind: "cure"; readonly text: string }
  | { readonly kind: "retry"; readonly text?: string }
  | {
      readonly kind: "discard";
      readonly moves: ReadonlyArray<TransactionMoveView>;
      readonly text?: string;
    }
  | {
      readonly kind: "dependency";
      readonly text: string;
      readonly moves: ReadonlyArray<TransactionMoveView>;
    }
  | { readonly kind: "none" };

export type CardNextAction = {
  readonly text: string;
  readonly tone: "danger" | "muted";
};

type GroupCardsInput = {
  readonly moves: ReadonlyArray<TransactionMoveView>;
  readonly groups: ReadonlyArray<TransactionPlanGroupView>;
  readonly today: boolean;
};
