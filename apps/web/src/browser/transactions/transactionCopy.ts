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
    const drops = playerNames(move.drops);
    const label = `${move.kind === "activate" ? "Activate" : "Stash"} ${player}`;
    return drops === undefined ? label : `${label}, drop ${drops}`;
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
  if (adds !== undefined) {
    const reserve =
      move.intent?.to === "reserve" && move.placement !== undefined
        ? ` to ${move.placement.toSlot}`
        : "";
    const bid =
      move.kind === "waiver_claim" && move.bid !== undefined ? ` for ${String(move.bid)} FAAB` : "";
    const base = `${verb} ${adds}${reserve}${bid}`;
    return drops === undefined ? base : `${base} and drop ${drops}`;
  }
  if (drops !== undefined) {
    return `Drop ${drops}`;
  }
  return "This move";
}

export function originalClaimLine(move: TransactionMoveView): string | undefined {
  if (move.phase !== "lost" || move.result !== "executed") {
    return undefined;
  }
  const name = move.attempts.find((attempt) => attempt.kind === "claim")?.player.name;
  return name === undefined ? undefined : `The claim for ${name} did not run.`;
}

export function fallbackPlanLine(move: TransactionMoveView): string | undefined {
  const names = fallbackSequence(move);
  if (names === undefined) {
    return undefined;
  }
  return `If the ${move.kind === "waiver_claim" ? "claim" : "add"} fails: ${names}`;
}

export function fallbackPlanDetail(move: TransactionMoveView): ReadonlyArray<string> {
  const record = fallbackRecord(move);
  if (record.length > 0) {
    return record;
  }
  const names = fallbackSequence(move);
  return names === undefined
    ? []
    : [
        `Each is stored with this move, and the server tries them in that order if the first fails.`,
      ];
}

function fallbackSequence(move: TransactionMoveView): string | undefined {
  const names = move.fallbacks.flatMap((player) =>
    player.name === undefined ? [] : [player.name],
  );
  return names.length === 0 ? undefined : names.join(", then ");
}

function fallbackRecord(move: TransactionMoveView): ReadonlyArray<string> {
  const lines = move.attempts.flatMap((attempt) => {
    if (attempt.kind === "claim") {
      switch (attempt.outcome) {
        case "lost":
          return [`The claim failed: ${attempt.reason}`];
        case "won":
          return [`The claim was awarded: ${attempt.reason}`];
        case "pending":
          return [`The claim is with the league: ${attempt.reason}`];
        case "executed":
        case "failed":
        case "retry":
        case "unavailable":
        case "unknown":
          return [];
      }
    }
    const name = attempt.player.name ?? "This fallback";
    switch (attempt.outcome) {
      case "executed":
        return [`${name} ran.`];
      case "failed":
        return [`${name} failed: ${attempt.reason}`];
      case "unavailable":
        return [`${name} was not available: ${attempt.reason}`];
      case "unknown":
        return [`${name} has an unknown outcome: ${attempt.reason}`];
      case "retry":
        return [`${name} could not be sent: ${attempt.reason}`];
      case "pending":
        return [`${name} is waiting: ${attempt.reason}`];
      case "lost":
      case "won":
        return [];
    }
  });
  if (lines.length === 0) {
    return [];
  }
  const left = remainingFallbacks(move);
  return [
    ...lines,
    left.length > 0 ? `Still to try: ${left.join(", then ")}.` : "No choices are left.",
  ];
}

export function moveCount(count: number): string {
  return `${String(count)} ${count === 1 ? "move" : "moves"}`;
}

export function openMoveCount(count: number): string {
  return `${String(count)} open ${count === 1 ? "move" : "moves"}`;
}

export function readableReason(reason: string): string {
  return reason.replace(/^\s*\d{1,2}[A-Z]\s*[:.)\-–—]\s*/u, "").trim();
}

function remainingFallbacks(move: TransactionMoveView): ReadonlyArray<string> {
  const tried = new Set(
    move.attempts.flatMap((attempt) =>
      attempt.kind === "fallback" && attempt.player.name !== undefined ? [attempt.player.name] : [],
    ),
  );
  return move.fallbacks.flatMap((player) =>
    player.name === undefined || tried.has(player.name) ? [] : [player.name],
  );
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
