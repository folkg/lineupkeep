import type { TransactionProposalItemView } from "#contracts/connections/transactionContract.ts";

export function moveSummary(item: TransactionProposalItemView): string {
  if (item.kind === "slot_move") {
    return item.slotMove === undefined
      ? "Slot move"
      : `Move ${item.slotMove.playerName ?? "this player"} to ${item.slotMove.toSlot}`;
  }
  if (item.kind === "activate" || item.kind === "stash") {
    return `${kindLabel(item.kind)} ${item.placement?.playerName ?? "this player"}`;
  }
  const adds = playerNames(item.adds);
  const drops = playerNames(item.drops);
  if (item.kind === "trade") {
    const outgoing = [
      ...(drops === undefined ? [] : [drops]),
      ...item.picks
        .filter((pick) => pick.to.ref === item.counterparty?.ref)
        .map((pick) => `a round ${String(pick.round)} pick`),
    ];
    const incoming = [
      ...(adds === undefined ? [] : [adds]),
      ...item.picks
        .filter((pick) => pick.from.ref === item.counterparty?.ref)
        .map((pick) => `a round ${String(pick.round)} pick`),
    ];
    if (outgoing.length > 0 && incoming.length > 0) {
      return `Send ${outgoing.join(", ")} to ${item.counterparty?.name ?? "the other team"} for ${incoming.join(", ")}`;
    }
  }
  const verb = item.kind === "waiver_claim" ? "Claim" : "Add";
  if (adds !== undefined && drops !== undefined) {
    return `${verb} ${adds} and drop ${drops}`;
  }
  if (adds !== undefined) {
    return `${verb} ${adds}`;
  }
  if (drops !== undefined) {
    return `Drop ${drops}`;
  }
  return "This move";
}

export function kindLabel(kind: TransactionProposalItemView["kind"]): string {
  switch (kind) {
    case "waiver_claim":
      return "Claim";
    case "free_agent_add":
      return "Add";
    case "drop":
      return "Drop";
    case "trade":
      return "Trade";
    case "slot_move":
      return "Slot move";
    case "activate":
      return "Activate";
    case "stash":
      return "Stash";
  }
}

export function lifecycleLabel(lifecycle: TransactionProposalItemView["lifecycle"]): string {
  switch (lifecycle) {
    case "proposed":
      return "Open";
    case "scheduled":
      return "Saved";
    case "stale":
      return "Needs another look";
    case "executed":
      return "Executed";
    case "pending":
      return "Pending";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "unknown":
      return "Not confirmed";
    case "accepted":
      return "Accepted";
    case "withdrawn":
      return "Withdrawn";
    case "expired":
      return "Expired";
    case "dismissed":
      return "Discarded";
  }
}

export function moveCount(count: number): string {
  return `${String(count)} ${count === 1 ? "move" : "moves"}`;
}

export function endedMoveCount(count: number): string {
  return `${String(count)} ended ${count === 1 ? "move" : "moves"}`;
}

function playerNames(players: TransactionProposalItemView["adds"]): string | undefined {
  const names = players.flatMap((player) => (player.name === undefined ? [] : [player.name]));
  if (names.length === 0) {
    return undefined;
  }
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
