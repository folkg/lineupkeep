import type {
  TransactionMovePlayerView,
  TransactionMoveView,
} from "#contracts/connections/transactionContract.ts";

export function moveSummary(move: TransactionMoveView): string {
  if (move.kind === "slot_move") {
    return move.slotMove === undefined
      ? "Slot move"
      : `Move ${move.slotMove.playerName ?? "this player"} to ${move.slotMove.toSlot}`;
  }
  if (move.kind === "activate" || move.kind === "stash") {
    const player = move.placement?.playerName ?? move.intent?.player?.name ?? "this player";
    return `${move.kind === "activate" ? "Activate" : "Stash"} ${player}`;
  }
  const adds = playerNames(move.adds);
  const drops = playerNames(move.drops);
  if (move.kind === "trade") {
    const outgoing = [
      ...(drops === undefined ? [] : [drops]),
      ...move.picks
        .filter((pick) => pick.sourceName !== "the other team")
        .map((pick) => `a round ${String(pick.round)} pick`),
    ];
    const incoming = [
      ...(adds === undefined ? [] : [adds]),
      ...move.picks
        .filter((pick) => pick.sourceName === "the other team")
        .map((pick) => `a round ${String(pick.round)} pick`),
    ];
    if (outgoing.length > 0 && incoming.length > 0) {
      return `Send ${outgoing.join(", ")} for ${incoming.join(", ")}`;
    }
  }
  const verb = move.kind === "waiver_claim" ? "Claim" : "Add";
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

export function moveCount(count: number): string {
  return `${String(count)} ${count === 1 ? "move" : "moves"}`;
}

export function openMoveCount(count: number): string {
  return `${String(count)} open ${count === 1 ? "move" : "moves"}`;
}

export function endedMoveCount(count: number): string {
  return `${String(count)} ended ${count === 1 ? "move" : "moves"}`;
}

export function teamCount(count: number): string {
  return `${String(count)} ${count === 1 ? "team" : "teams"}`;
}

function playerNames(players: ReadonlyArray<TransactionMovePlayerView>): string | undefined {
  const names = players.flatMap((player) => (player.name === undefined ? [] : [player.name]));
  if (names.length === 0) {
    return undefined;
  }
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
