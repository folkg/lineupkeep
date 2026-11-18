import type {
  TransactionMoveView,
  TransactionPlanGroupView,
} from "#contracts/connections/transactionContract.ts";

import { moveCount, moveSummary } from "./transactionCopy";

export function groupCards(input: GroupCardsInput): ReadonlyArray<GroupCard> {
  const byGroup = new Map(input.groups.map((group) => [group.group, group] as const));
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
      fixes: ordered.flatMap((move) => fixesByFunded.get(move.move) ?? []),
      today: input.today,
      ...(group === undefined ? {} : { group }),
    });
  }
  for (const [funded, fixes] of fixesByFunded) {
    if (cards.some((card) => card.moves.some((move) => move.move === funded))) {
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
      left.lead.team.name.localeCompare(right.lead.team.name),
  );
}

export function cardMembers(card: GroupCard): ReadonlyArray<TransactionMoveView> {
  return [...card.moves, ...card.fixes].filter((move) => move.decision !== "discarded");
}

export function cardStatus(card: GroupCard): CardStatus {
  const members = cardMembers(card);
  if (members.every((move) => move.phase === "with_league")) {
    return { kind: "with-league" };
  }
  if (members.every((move) => move.result === "pending")) {
    return { kind: "waiting" };
  }
  if (members.some((move) => move.result === "executed")) {
    return members.every((move) => move.result === "executed")
      ? { kind: "ran" }
      : { kind: "partly-ran" };
  }
  if (members.some((move) => move.result === "failed" || move.result === "unknown")) {
    return { kind: "failed" };
  }
  if (
    card.group?.status === "blocked" ||
    members.some((move) => move.validation.status !== "current" || move.result === "skipped")
  ) {
    return { kind: "blocked" };
  }
  if (members.every(isSubmitted)) {
    const runsOn = card.lead.runsOn ?? card.lead.runDay;
    return members.every((move) => move.decision === "confirmed") && runsOn !== undefined
      ? { kind: "scheduled", runDay: runsOn }
      : { kind: "running" };
  }
  return { kind: "needs-decision" };
}

export function cardNeedsDecision(card: GroupCard): boolean {
  return cardStatus(card).kind === "needs-decision";
}

export function cardIsSettled(card: GroupCard): boolean {
  const kind = cardStatus(card).kind;
  return kind === "waiting" || kind === "with-league" || kind === "scheduled";
}

export function cardNextAction(card: GroupCard): CardNextAction | undefined {
  const status = cardStatus(card);
  if (status.kind !== "blocked" && status.kind !== "failed" && status.kind !== "partly-ran") {
    return undefined;
  }
  const cure = card.group?.cure;
  if (cure !== undefined) {
    return { text: cure, tone: "muted" };
  }
  const members = cardMembers(card);
  const refused = members.find(
    (move) => move.result === "failed" || move.result === "unknown" || move.result === "skipped",
  );
  if (refused?.resultDetail !== undefined) {
    return { text: refused.resultDetail, tone: "danger" };
  }
  const invalid = members.find((move) => move.validation.status !== "current");
  const reason = invalid?.validation.reasons[0]?.detail;
  if (invalid !== undefined && reason !== undefined) {
    return {
      text: members.length === 1 ? reason : `${moveSummary(invalid)}: ${reason}`,
      tone: "danger",
    };
  }
  const detail = card.group?.detail;
  return detail === undefined ? undefined : { text: detail, tone: "muted" };
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

function isSubmitted(move: TransactionMoveView): boolean {
  return move.decision === "now" || move.decision === "confirmed";
}

function cardPosition(card: GroupCard): number {
  return Math.min(
    ...card.moves.map((move) => move.position),
    ...card.fixes.map((move) => move.position),
  );
}

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
  | { readonly kind: "scheduled"; readonly runDay: string }
  | { readonly kind: "waiting" }
  | { readonly kind: "with-league" }
  | { readonly kind: "running" }
  | { readonly kind: "partly-ran" }
  | { readonly kind: "blocked" }
  | { readonly kind: "failed" }
  | { readonly kind: "ran" };

export type CardNextAction = {
  readonly text: string;
  readonly tone: "danger" | "muted";
};

export type GroupCardsInput = {
  readonly moves: ReadonlyArray<TransactionMoveView>;
  readonly groups: ReadonlyArray<TransactionPlanGroupView>;
  readonly today: boolean;
};
