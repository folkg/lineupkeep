import { DateTime } from "effect";

import { placeIntentItems } from "#contexts/connections/ProposalOrder.ts";
import type { ProposalPlacementInput } from "#contexts/connections/ProposalOrder.ts";
import {
  rosterOccupancy,
  rosterPlaceChange,
  rosterPlaceCount,
  rosterRuleOf,
  slotCapacity,
  slotMismatchDetail,
  slotPlacement,
} from "#contexts/connections/RosterSlots.ts";
import type { RosterRule } from "#contexts/connections/RosterSlots.ts";

import type {
  StoredMoveClaim,
  StoredMoveDate,
  StoredMovePlacement,
  StoredMoveValidation,
  StoredMoveValidationReason,
  TransactionMoveId,
  TransactionMoveRecord,
} from "./TransactionPlanRecord.ts";

export function evaluateTransactionPlan(
  input: TransactionPlanEvaluationInput,
): TransactionPlanEvaluation {
  const facts = input.facts;
  const rule = rosterRuleOf(facts.constraints, facts.slots);
  const roster = rosterOf(facts);
  const moves = [...input.moves].sort(comparePlanMoves);
  const checked = new Map<TransactionMoveId, CheckedMove>(
    moves.map((move) => [move.id, { move, placement: undefined, stale: [], illegal: [] }]),
  );
  const identity = new Map(
    moves.map((move) => [move.id, identityReasons(move, facts, rule, roster)] as const),
  );
  const qualified = moves.filter((move) => reasonCount(identity.get(move.id)) === 0);
  const slotChecks = checkSlotMoves(qualified, facts, rule, roster);
  const placement = placeMoves(qualified, facts, slotChecks.refused);
  const claims = claimTransactionPlanMoves({ moves, placements: placement.placements, roster });

  for (const move of moves) {
    const entry = requireValue(checked.get(move.id), "A plan move was not checked");
    appendReasons(entry.stale, identity.get(move.id)?.stale);
    appendReasons(entry.illegal, identity.get(move.id)?.illegal);
    appendReasons(entry.stale, slotChecks.reasons.get(move.id)?.stale);
    appendReasons(entry.illegal, slotChecks.reasons.get(move.id)?.illegal);
    appendReasons(entry.stale, placement.reasons.get(move.id)?.stale);
    appendReasons(entry.illegal, placement.reasons.get(move.id)?.illegal);
    entry.placement = placement.placements.get(move.id);
    const illegality = rosterIllegality(entry, facts, rule, roster);
    appendReasons(entry.stale, illegality.stale);
    appendReasons(entry.illegal, illegality.illegal);
  }

  for (const refusal of claims.refused) {
    const entry = checked.get(refusal.move);
    entry?.stale.push({
      code: refusal.code,
      ...(refusal.claim.kind === "player" ? { playerKey: refusal.claim.key } : {}),
      detail: refusal.detail,
    });
  }

  for (const [id, reasons] of placeAccounting(moves, checked, facts, rule)) {
    appendReasons(requireValue(checked.get(id), "A plan move was not checked").stale, reasons);
  }

  const claimsByMove = new Map(claims.moves.map((entry) => [entry.move, entry.claims] as const));
  const evaluated = moves.map((move) =>
    moveEvaluation(
      requireValue(checked.get(move.id), "A plan move was not checked"),
      claimsByMove.get(move.id) ?? [],
      facts,
      input.checkedAt,
    ),
  );
  const evaluatedById = new Map(evaluated.map((entry) => [entry.move, entry] as const));
  const order = orderTransactionPlanMoves({
    facts,
    moves: moves.map((move) => {
      const evaluation = requireValue(evaluatedById.get(move.id), "A plan move was not evaluated");
      return {
        move,
        placement: evaluation.placement,
        runnable: evaluation.validation.status === "current",
      };
    }),
  });
  const blocked = new Map(order.blocked.map((entry) => [entry.move, entry.detail] as const));
  const positioned = evaluated.map((entry) => {
    const detail = blocked.get(entry.move);
    const runPosition = order.steps.find((step) => step.move === entry.move)?.position;
    return detail === undefined
      ? { ...entry, runPosition }
      : {
          ...entry,
          runPosition: undefined,
          validation: {
            status: "stale" as const,
            checkedAt: input.checkedAt,
            reasons: [...entry.validation.reasons, { code: "order_conflict", detail }],
          },
        };
  });

  return {
    moves: positioned,
    groups: groupEvaluations(positioned, moves),
    order,
  };
}

export function orderTransactionPlanMoves(input: TransactionPlanOrderInput): TransactionPlanOrder {
  const rule = rosterRuleOf(input.facts.constraints, input.facts.slots);
  const entries = [...input.moves].sort((left, right) => comparePlanMoves(left.move, right.move));
  const runnable = entries.filter((entry) => entry.runnable);
  const excluded = entries.filter((entry) => !entry.runnable).map((entry) => entry.move.id);
  const dependencies = new Map<TransactionMoveId, Set<TransactionMoveId>>(
    runnable.map((entry) => [entry.move.id, new Set<TransactionMoveId>()]),
  );
  const fundedBy = new Map<TransactionMoveId, TransactionMoveId>();
  const blocked = new Map<TransactionMoveId, string>();

  addDestinationDependencies(runnable, input.facts, rule, dependencies, fundedBy);
  addCapacityDependencies(runnable, input.facts, rule, dependencies, fundedBy, blocked);

  const done = new Set<TransactionMoveId>();
  const steps: Array<TransactionPlanOrderStep> = [];
  let progressed = true;
  while (progressed && done.size < runnable.length) {
    progressed = false;
    for (const entry of runnable) {
      if (done.has(entry.move.id) || blocked.has(entry.move.id)) {
        continue;
      }
      const waiting = unmetDependencies(entry.move.id, dependencies, done);
      if (waiting.length > 0) {
        continue;
      }
      steps.push({
        move: entry.move.id,
        position: steps.length,
        fundedBy: fundedBy.get(entry.move.id),
        dependsOn: orderedDependencies(entry.move.id, dependencies, runnable),
      });
      done.add(entry.move.id);
      progressed = true;
    }
  }

  for (const entry of runnable) {
    if (done.has(entry.move.id) || blocked.has(entry.move.id)) {
      continue;
    }
    const waiting = unmetDependencies(entry.move.id, dependencies, done);
    blocked.set(
      entry.move.id,
      `No order can run ${moveLabel(entry.move)}: it waits on ${waiting
        .map((id) => moveLabel(moveById(runnable, id)))
        .join(", ")}.`,
    );
  }

  return {
    steps,
    excluded,
    blocked: [...blocked.entries()].map(([move, detail]) => ({ move, detail })),
  };
}

export function claimTransactionPlanMoves(input: TransactionPlanClaimInput): TransactionPlanClaims {
  const moves = [...input.moves].sort(comparePlanMoves);
  const held = new Map<string, TransactionMoveId>();
  const claimed: Array<TransactionPlanMoveClaims> = [];
  const refused: Array<TransactionPlanClaimRefusal> = [];

  for (const move of moves) {
    const candidates = claimCandidates(move, input.placements.get(move.id), input.roster);
    for (const candidate of candidates) {
      const key = claimKey(candidate.claim);
      const holder = held.get(key);
      if (holder === undefined) {
        held.set(key, move.id);
        continue;
      }
      refused.push({
        move: move.id,
        claim: candidate.claim,
        heldBy: holder,
        code: claimRefusalCode(candidate.claim.kind),
        detail: `${candidate.label} is already claimed in this plan by another move. Two open moves cannot claim the same ${claimSubject(candidate.claim.kind)}; discard or change one of them.`,
      });
    }
    claimed.push({
      move: move.id,
      claims: candidates.map((candidate) => candidate.claim).sort(compareClaims),
    });
  }

  return { moves: claimed, refused };
}

function identityReasons(
  move: TransactionPlanMove,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
  roster: ReadonlyMap<string, TransactionPlanRosterPlayer>,
): Reasons {
  const reasons = emptyReasons();
  for (const drop of move.drops) {
    if (!roster.has(drop.key)) {
      stale(
        reasons,
        "drop_not_rostered",
        drop.key,
        `${nameOf(drop)} is no longer on the roster, so this move cannot drop them.`,
      );
    }
  }
  if (isAddKind(move.kind)) {
    const wanted = move.kind === "free_agent_add" ? "free_agent" : "waiver";
    for (const add of move.adds) {
      const available = facts.pool.get(add.key);
      if (available === undefined) {
        stale(
          reasons,
          "player_unavailable",
          add.key,
          `${nameOf(add)} is not in the league's available player pool.`,
        );
      } else if (available.availability !== wanted) {
        stale(
          reasons,
          "player_unavailable",
          add.key,
          wanted === "free_agent"
            ? `${nameOf(add)} is on waivers, so a free-agent add cannot bring them in.`
            : `${nameOf(add)} is a free agent, so a waiver claim is not needed.`,
        );
      }
    }
    if (move.adds.length !== 1) {
      stale(
        reasons,
        "intent_invalid",
        undefined,
        move.adds.length === 0
          ? "This move adds no one. A free-agent add or waiver claim names one player to add."
          : `This move adds ${String(move.adds.length)} players. A move adds one player, because each added player needs their own place.`,
      );
    }
  }
  if (move.kind === "activate" || move.kind === "stash") {
    const player = move.intent?.player;
    if (player === undefined) {
      stale(
        reasons,
        "intent_invalid",
        undefined,
        `This move names no player. An ${move.kind} names the rostered player to move.`,
      );
    } else if (!roster.has(player.key)) {
      stale(
        reasons,
        "move_not_rostered",
        player.key,
        `${nameOf(player)} is no longer on the roster, so this move cannot place them.`,
      );
    }
  }
  if (move.kind === "slot_move") {
    const declared = move.slotMove;
    if (declared === undefined) {
      stale(
        reasons,
        "intent_invalid",
        undefined,
        "This move names no place. A slot move names the player to move and the place they move to.",
      );
    } else {
      const player = roster.get(declared.playerKey);
      if (player === undefined) {
        stale(
          reasons,
          "move_not_rostered",
          declared.playerKey,
          `${declared.playerName ?? declared.playerKey} is no longer on the roster, so this move cannot place them.`,
        );
      } else {
        const destination = rule.byPosition.get(declared.toSlot);
        if (destination === undefined) {
          stale(
            reasons,
            "move_slot_unknown",
            undefined,
            `The league does not declare a ${declared.toSlot} place, so ${player.name} cannot move there.`,
          );
        } else {
          const placement = slotPlacement(rule, destination.position, player);
          if (placement.legal === "unknown") {
            stale(
              reasons,
              "state_unavailable",
              declared.playerKey,
              `The league does not publish what its ${destination.position} reserve place accepts, so ${player.name} cannot be moved there.`,
            );
          } else if (!placement.legal) {
            illegal(
              reasons,
              "slot_illegal",
              declared.playerKey,
              slotMismatchDetail({
                name: player.name,
                slot: destination.position,
                kind: destination.kind,
                positions: player.positions,
                reserveEligibility: rule.reserveEligibility,
                injured: player.injured,
                mismatch: { kind: "destination" },
              }),
            );
          }
        }
      }
    }
  }
  if (move.bid !== undefined) {
    if (move.kind !== "waiver_claim") {
      stale(reasons, "bid_not_available", undefined, "Only a waiver claim carries a FAAB bid.");
    } else if (facts.budget === undefined) {
      stale(
        reasons,
        "bid_not_available",
        undefined,
        "The league does not publish the FAAB this team has left, so this bid cannot be checked.",
      );
    } else if (move.bid > facts.budget) {
      stale(
        reasons,
        "bid_exceeds_budget",
        undefined,
        `A bid of ${String(move.bid)} is more than the ${String(facts.budget)} FAAB this team has left.`,
      );
    }
  }
  if (move.kind === "trade" && move.runDay !== undefined && move.runDay > facts.today) {
    stale(
      reasons,
      "window_not_allowed",
      undefined,
      `A trade carries no future day, and this trade is saved for ${move.runDay}. It is sent when you submit it.`,
    );
  }
  return reasons;
}

function checkSlotMoves(
  moves: ReadonlyArray<TransactionPlanMove>,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
  roster: ReadonlyMap<string, TransactionPlanRosterPlayer>,
): { readonly reasons: Map<TransactionMoveId, Reasons>; readonly refused: Set<TransactionMoveId> } {
  const reasons = new Map<TransactionMoveId, Reasons>();
  const refused = new Set<TransactionMoveId>();
  const dropped = droppedKeys(moves);

  for (const move of moves) {
    const declared = move.kind === "slot_move" ? move.slotMove : undefined;
    if (declared === undefined) {
      continue;
    }
    const reasonsOfMove = reasons.get(move.id) ?? emptyReasons();
    reasons.set(move.id, reasonsOfMove);
    const player = roster.get(declared.playerKey);
    if (player === undefined) {
      continue;
    }
    const destination = rule.byPosition.get(declared.toSlot);
    if (destination === undefined) {
      continue;
    }
    if (dropped.has(player.key)) {
      stale(
        reasonsOfMove,
        "move_not_rostered",
        player.key,
        `Another move in this plan drops ${player.name}, so this move cannot also place them.`,
      );
      refused.add(move.id);
      continue;
    }
    const capacity = slotCapacity(rule, destination);
    const occupants = facts.roster.filter(
      (occupant) =>
        occupant.slot === destination.position &&
        occupant.key !== player.key &&
        !dropped.has(occupant.key),
    );
    if (capacity !== undefined && occupants.length >= capacity) {
      illegal(
        reasonsOfMove,
        "slot_illegal",
        player.key,
        `The ${destination.position} place already holds ${nameList(
          occupants.map((occupant) => occupant.name),
        )}. Move one of them first, or choose another place.`,
      );
      refused.add(move.id);
    }
  }
  return { reasons, refused };
}

function placeMoves(
  moves: ReadonlyArray<TransactionPlanMove>,
  facts: TransactionPlanTeamFacts,
  refusedSlotMoves: ReadonlySet<TransactionMoveId>,
): {
  readonly placements: Map<TransactionMoveId, StoredMovePlacement>;
  readonly reasons: Map<TransactionMoveId, Reasons>;
} {
  const reasons = new Map<TransactionMoveId, Reasons>();
  const placements = new Map<TransactionMoveId, StoredMovePlacement>();
  const ids = new Map(moves.map((move) => [String(move.id), move.id] as const));
  const dropped = droppedKeys(moves);
  const players = new Map(
    facts.roster
      .filter((player) => !dropped.has(player.key))
      .map((player) => [player.key, player] as const),
  );
  for (const move of moves) {
    const declared = move.kind === "slot_move" ? move.slotMove : undefined;
    if (declared === undefined || refusedSlotMoves.has(move.id)) {
      continue;
    }
    const player = players.get(declared.playerKey);
    if (player === undefined) {
      continue;
    }
    players.set(player.key, { ...player, slot: declared.toSlot });
  }

  const items = moves.flatMap((move) => {
    const item = placementItem(move, facts);
    return item === undefined ? [] : [item];
  });
  if (items.length === 0) {
    return { placements, reasons };
  }
  const placed = placeIntentItems({
    constraints: facts.constraints,
    slots: facts.slots,
    players: [...players.values()],
    items,
  });
  for (const placement of placed.placements) {
    const id = ids.get(placement.item);
    if (id !== undefined && !placements.has(id)) {
      placements.set(id, {
        playerKey: placement.playerKey,
        playerName: placement.playerName,
        ...(placement.fromSlot === undefined ? {} : { fromSlot: placement.fromSlot }),
        toSlot: placement.toSlot,
        detail: placement.detail,
      });
    }
  }
  for (const refusal of placed.refused) {
    const id = ids.get(refusal.item);
    if (id === undefined) {
      continue;
    }
    const reasonsOfMove = reasons.get(id) ?? emptyReasons();
    reasons.set(id, reasonsOfMove);
    if (refusal.code === "slot_illegal") {
      illegal(reasonsOfMove, refusal.code, undefined, refusal.detail);
    } else {
      stale(reasonsOfMove, refusal.code, undefined, refusal.detail);
    }
  }
  return { placements, reasons };
}

function placementItem(
  move: TransactionPlanMove,
  facts: TransactionPlanTeamFacts,
): ProposalPlacementInput["items"][number] | undefined {
  const intent = placementIntentOf(move);
  if (intent === undefined) {
    return undefined;
  }
  return {
    id: move.id,
    adds:
      intent.kind === "add"
        ? move.adds.map((add) => ({
            key: add.key,
            name: nameOf(add),
            positions: facts.pool.get(add.key)?.positions ?? [],
          }))
        : [],
    drops: move.drops.map((drop) => ({ key: drop.key, name: nameOf(drop) })),
    move: undefined,
    intent,
  };
}

function placementIntentOf(move: TransactionPlanMove): PlacementIntent | undefined {
  if (move.kind === "activate" || move.kind === "stash") {
    const player = move.intent?.player;
    return player === undefined
      ? undefined
      : { kind: move.kind, player: { key: player.key, name: nameOf(player) } };
  }
  if (isAddKind(move.kind) && move.adds.length === 1) {
    return { kind: "add", to: move.intent?.to ?? "active" };
  }
  return undefined;
}

function rosterIllegality(
  entry: CheckedMove,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
  roster: ReadonlyMap<string, TransactionPlanRosterPlayer>,
): Reasons {
  const reasons = emptyReasons();
  const occupancy = rosterOccupancy({ rule, players: facts.roster });
  for (const occupant of occupancy.illegal) {
    if (curesPlacement(entry, occupant.key, rule, roster)) {
      continue;
    }
    illegal(reasons, "slot_illegal", occupant.key, occupant.detail);
  }
  return reasons;
}

function curesPlacement(
  entry: CheckedMove,
  playerKey: string,
  rule: RosterRule,
  roster: ReadonlyMap<string, TransactionPlanRosterPlayer>,
): boolean {
  if (entry.move.drops.some((drop) => drop.key === playerKey)) {
    return true;
  }
  const declared = entry.move.kind === "slot_move" ? entry.move.slotMove : undefined;
  const mover =
    declared?.playerKey ??
    (entry.move.kind === "activate" || entry.move.kind === "stash"
      ? entry.move.intent?.player?.key
      : undefined);
  const destination = declared?.toSlot ?? entry.placement?.toSlot;
  const player = roster.get(playerKey);
  if (mover !== playerKey || destination === undefined || player === undefined) {
    return false;
  }
  return slotPlacement(rule, destination, player).legal === true;
}

function placeAccounting(
  moves: ReadonlyArray<TransactionPlanMove>,
  checked: ReadonlyMap<TransactionMoveId, CheckedMove>,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
): Map<TransactionMoveId, ReadonlyArray<StoredMoveValidationReason>> {
  const clear = moves.filter((move) => {
    const entry = checked.get(move.id);
    return entry !== undefined && reasonCount(entry) === 0;
  });
  const changes = new Map(
    clear.map(
      (move) =>
        [move.id, placeChangeOf(move, checked.get(move.id)?.placement, facts, rule)] as const,
    ),
  );
  const allocation = allocatePlaces(clear, changes, facts, rule);
  const reasons = new Map<TransactionMoveId, ReadonlyArray<StoredMoveValidationReason>>();
  for (const move of clear) {
    if (!allocation.uncovered.has(move.id)) {
      continue;
    }
    reasons.set(move.id, [
      {
        code: "roster_full",
        detail: `${moveLabel(move)} needs a roster place, and this plan does not free one. Add a drop or a reserve move that frees a place, or remove this move.`,
      },
    ]);
  }
  return reasons;
}

type PlaceAllocation = {
  readonly funding: ReadonlyMap<TransactionMoveId, ReadonlyArray<TransactionMoveId>>;
  readonly uncovered: ReadonlySet<TransactionMoveId>;
};

function allocatePlaces(
  moves: ReadonlyArray<TransactionPlanMove>,
  changes: ReadonlyMap<TransactionMoveId, { readonly frees: number; readonly consumes: number }>,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
): PlaceAllocation {
  const occupied = rosterOccupancy({ rule, players: facts.roster }).occupied;
  let free = Math.max(0, facts.constraints.rosterMaximum - occupied);
  let deficit = Math.max(0, occupied - facts.constraints.rosterMaximum);
  const freeing = moves.flatMap((move) => {
    const change = requireValue(changes.get(move.id), "A plan move has no place change");
    const count = Math.max(0, change.frees - change.consumes);
    return count === 0 ? [] : [{ id: move.id, remaining: count }];
  });
  for (const entry of freeing) {
    if (deficit === 0) {
      break;
    }
    const taken = Math.min(deficit, entry.remaining);
    entry.remaining -= taken;
    deficit -= taken;
  }
  const funding = new Map<TransactionMoveId, ReadonlyArray<TransactionMoveId>>();
  const uncovered = new Set<TransactionMoveId>();
  for (const move of moves) {
    const change = requireValue(changes.get(move.id), "A plan move has no place change");
    let needed = Math.max(0, change.consumes - change.frees);
    if (needed === 0) {
      continue;
    }
    const fromFree = Math.min(free, needed);
    free -= fromFree;
    needed -= fromFree;
    const takenFrom: Array<TransactionMoveId> = [];
    for (const entry of freeing) {
      if (needed === 0) {
        break;
      }
      if (entry.id === move.id || entry.remaining === 0) {
        continue;
      }
      const taken = Math.min(entry.remaining, needed);
      entry.remaining -= taken;
      needed -= taken;
      takenFrom.push(entry.id);
    }
    if (takenFrom.length > 0) {
      funding.set(move.id, takenFrom);
    }
    if (needed > 0) {
      uncovered.add(move.id);
    }
  }
  return { funding, uncovered };
}

function placeChangeOf(
  move: TransactionPlanMove,
  placement: StoredMovePlacement | undefined,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
): { readonly frees: number; readonly consumes: number } {
  let frees = 0;
  let consumes = 0;
  for (const drop of move.drops) {
    if (rosterPlaceCount(rule, rosterSlotOf(facts, drop.key)) > 0) {
      frees += 1;
    }
  }
  if (placement !== undefined) {
    if (placement.fromSlot !== undefined && rosterPlaceCount(rule, placement.fromSlot) > 0) {
      frees += 1;
    }
    if (rosterPlaceCount(rule, placement.toSlot) > 0) {
      consumes += 1;
    }
  }
  const declared = move.kind === "slot_move" ? move.slotMove : undefined;
  if (declared !== undefined) {
    const change = rosterPlaceChange(
      rule,
      rosterSlotOf(facts, declared.playerKey),
      declared.toSlot,
    );
    frees += change.frees;
    consumes += change.consumes;
  }
  if (move.kind === "trade") {
    consumes += move.adds.length;
  }
  return { frees, consumes };
}

function addDestinationDependencies(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
  dependencies: Map<TransactionMoveId, Set<TransactionMoveId>>,
  fundedBy: Map<TransactionMoveId, TransactionMoveId>,
): void {
  const leaves = new Map<string, TransactionMoveId>();
  for (const entry of entries) {
    for (const drop of entry.move.drops) {
      if (!leaves.has(drop.key)) {
        leaves.set(drop.key, entry.move.id);
      }
    }
    const declared = entry.move.kind === "slot_move" ? entry.move.slotMove : undefined;
    const mover =
      declared?.playerKey ??
      (entry.move.kind === "activate" || entry.move.kind === "stash"
        ? entry.move.intent?.player?.key
        : undefined);
    const from = entry.placement?.fromSlot ?? rosterSlotOf(facts, mover);
    if (mover !== undefined && from !== undefined && from !== declared?.toSlot) {
      if (!leaves.has(mover)) {
        leaves.set(mover, entry.move.id);
      }
    }
  }

  for (const entry of entries) {
    const destinations = planDestinations(entry);
    for (const destination of destinations) {
      for (const occupant of facts.roster) {
        if (occupant.slot !== destination) {
          continue;
        }
        const remover = leaves.get(occupant.key);
        if (remover === undefined || remover === entry.move.id) {
          continue;
        }
        addDependency(dependencies, entry.move.id, remover);
        if (
          isAddKind(entry.move.kind) &&
          fundedBy.get(entry.move.id) === undefined &&
          consumesPlace(entry, rule)
        ) {
          fundedBy.set(entry.move.id, remover);
        }
      }
    }
  }
}

function addCapacityDependencies(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
  dependencies: Map<TransactionMoveId, Set<TransactionMoveId>>,
  fundedBy: Map<TransactionMoveId, TransactionMoveId>,
  blocked: Map<TransactionMoveId, string>,
): void {
  const moves = entries.map((entry) => entry.move);
  const changes = new Map(
    entries.map(
      (entry) => [entry.move.id, placeChangeOf(entry.move, entry.placement, facts, rule)] as const,
    ),
  );
  const allocation = allocatePlaces(moves, changes, facts, rule);
  for (const entry of entries) {
    for (const funding of allocation.funding.get(entry.move.id) ?? []) {
      addDependency(dependencies, entry.move.id, funding);
    }
    const firstFunding = allocation.funding.get(entry.move.id)?.[0];
    if (
      firstFunding !== undefined &&
      isAddKind(entry.move.kind) &&
      fundedBy.get(entry.move.id) === undefined
    ) {
      fundedBy.set(entry.move.id, firstFunding);
    }
    if (allocation.uncovered.has(entry.move.id)) {
      blocked.set(
        entry.move.id,
        `${moveLabel(entry.move)} needs a roster place, and the team has none free.`,
      );
    }
  }
}

function moveEvaluation(
  entry: CheckedMove,
  claims: ReadonlyArray<StoredMoveClaim>,
  facts: TransactionPlanTeamFacts,
  checkedAt: DateTime.Utc,
): TransactionPlanMoveEvaluation {
  const runDay = runDayOf(entry.move, facts.today);
  return {
    move: entry.move.id,
    group: entry.move.group,
    claims,
    validation: validationOf(entry, checkedAt),
    placement: entry.placement,
    runDay,
    effectiveDate: effectiveDateOf(entry.move.kind, runDay, facts.timing),
    dueToday: runDay === facts.today && isDueDecision(entry.move.decision),
    runPosition: undefined,
  };
}

function validationOf(entry: CheckedMove, checkedAt: DateTime.Utc): StoredMoveValidation {
  if (entry.illegal.length > 0) {
    return { status: "illegal", checkedAt, reasons: [...entry.stale, ...entry.illegal] };
  }
  return entry.stale.length > 0
    ? { status: "stale", checkedAt, reasons: [...entry.stale] }
    : { status: "current", checkedAt, reasons: [] };
}

function groupEvaluations(
  moves: ReadonlyArray<TransactionPlanMoveEvaluation>,
  sources: ReadonlyArray<TransactionPlanMove>,
): ReadonlyArray<TransactionPlanGroupEvaluation> {
  const byId = movesById(sources);
  const positions = new Map(sources.map((move) => [move.id, move.position] as const));
  const grouped = new Map<string, Array<TransactionPlanMoveEvaluation>>();
  const ungrouped: Array<TransactionPlanMoveEvaluation> = [];
  for (const move of moves) {
    if (move.group === undefined) {
      ungrouped.push(move);
      continue;
    }
    const entries = grouped.get(move.group) ?? [];
    entries.push(move);
    grouped.set(move.group, entries);
  }
  const entries = [
    ...[...grouped.entries()].map(([group, movesInGroup]) => ({ group, movesInGroup })),
    ...ungrouped.map((move) => ({ group: undefined, movesInGroup: [move] })),
  ].sort(
    (left, right) =>
      firstGroupPosition(left.movesInGroup, positions) -
      firstGroupPosition(right.movesInGroup, positions),
  );
  return entries.map(({ group, movesInGroup }) => {
    const invalid = movesInGroup.find((move) => move.validation.status !== "current");
    if (invalid !== undefined) {
      const source = requireValue(byId.get(invalid.move), "A grouped move was not declared");
      const reason = invalid.validation.reasons[0];
      return {
        group,
        moves: movesInGroup.map((move) => move.move),
        valid: false,
        detail: `A group lands whole or not at all. ${moveLabel(source)} cannot run: ${reason?.detail ?? "its check did not pass"}`,
      };
    }
    const days = [...new Set(movesInGroup.map((move) => move.runDay))];
    if (days.length > 1) {
      return {
        group,
        moves: movesInGroup.map((move) => move.move),
        valid: false,
        detail: `A group runs on one day, and these moves run on ${days.join(", ")}.`,
      };
    }
    return { group, moves: movesInGroup.map((move) => move.move), valid: true };
  });
}

function firstGroupPosition(
  moves: ReadonlyArray<TransactionPlanMoveEvaluation>,
  positions: ReadonlyMap<TransactionMoveId, number>,
): number {
  const first = moves[0];
  return first === undefined
    ? Number.MAX_SAFE_INTEGER
    : (positions.get(first.move) ?? Number.MAX_SAFE_INTEGER);
}

function runDayOf(move: TransactionPlanMove, today: StoredMoveDate): StoredMoveDate {
  return move.runDay !== undefined && move.runDay > today ? move.runDay : today;
}

function effectiveDateOf(
  kind: TransactionPlanMove["kind"],
  runDay: StoredMoveDate,
  timing: TransactionPlanTiming,
): StoredMoveDate | undefined {
  if (kind === "trade") {
    return undefined;
  }
  switch (timing.rule) {
    case "same_day":
      return runDay;
    case "next_day":
      return nextDate(runDay);
    case "weekly_lock":
      return timing.currentDate;
    case undefined:
      return undefined;
  }
}

function nextDate(date: StoredMoveDate): StoredMoveDate {
  return DateTime.formatIsoDate(
    DateTime.add(DateTime.makeUnsafe(`${date}T00:00:00.000Z`), { days: 1 }),
  );
}

function isDueDecision(decision: TransactionPlanMove["decision"]): boolean {
  return decision === "now" || decision === "saved";
}

function claimCandidates(
  move: TransactionPlanMove,
  placement: StoredMovePlacement | undefined,
  roster: ReadonlyMap<string, TransactionPlanRosterPlayer>,
): ReadonlyArray<ClaimCandidate> {
  const candidates: Array<ClaimCandidate> = [];
  for (const drop of move.drops) {
    candidates.push({
      claim: { kind: "player", key: drop.key },
      label: nameOf(drop),
    });
  }
  if (move.kind !== "trade") {
    for (const add of move.adds) {
      candidates.push({
        claim: { kind: "player", key: add.key },
        label: nameOf(add),
      });
    }
    for (const fallback of move.fallbacks) {
      candidates.push({
        claim: { kind: "player", key: fallback.key },
        label: nameOf(fallback),
      });
    }
  }
  for (const pick of move.picks) {
    candidates.push({
      claim: { kind: "draft_pick", key: pickKey(pick.round, pick.sourceTeamKey) },
      label: `The round ${String(pick.round)} pick from ${pick.sourceName}`,
    });
  }
  if (move.kind === "slot_move" && move.slotMove !== undefined) {
    const from = roster.get(move.slotMove.playerKey)?.slot;
    if (from !== undefined) {
      candidates.push({ claim: { kind: "place", key: from }, label: `The ${from} place` });
    }
    candidates.push({
      claim: { kind: "place", key: move.slotMove.toSlot },
      label: `The ${move.slotMove.toSlot} place`,
    });
  }
  if (move.kind === "activate" || move.kind === "stash") {
    const player = move.intent?.player;
    const from =
      placement?.fromSlot ?? (player === undefined ? undefined : roster.get(player.key)?.slot);
    if (from !== undefined) {
      candidates.push({ claim: { kind: "place", key: from }, label: `The ${from} place` });
    }
    if (placement !== undefined) {
      candidates.push({
        claim: { kind: "place", key: placement.toSlot },
        label: `The ${placement.toSlot} place`,
      });
    }
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = claimKey(candidate.claim);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function claimKey(claim: StoredMoveClaim): string {
  return `${claim.kind}:${claim.key}`;
}

function pickKey(round: number, sourceTeamKey: string): string {
  return `${String(round)}:${sourceTeamKey}`;
}

function claimRefusalCode(kind: StoredMoveClaim["kind"]): TransactionPlanClaimRefusal["code"] {
  switch (kind) {
    case "player":
      return "player_claimed";
    case "place":
      return "place_claimed";
    case "draft_pick":
      return "pick_claimed";
  }
}

function claimSubject(kind: StoredMoveClaim["kind"]): string {
  switch (kind) {
    case "player":
      return "player";
    case "place":
      return "place";
    case "draft_pick":
      return "draft pick";
  }
}

function compareClaims(left: StoredMoveClaim, right: StoredMoveClaim): number {
  return left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key);
}

function planDestinations(entry: TransactionPlanOrderMove): ReadonlyArray<string> {
  const declared = entry.move.kind === "slot_move" ? entry.move.slotMove?.toSlot : undefined;
  const placed = entry.placement?.toSlot;
  return [
    ...new Set([
      ...(declared === undefined ? [] : [declared]),
      ...(placed === undefined ? [] : [placed]),
    ]),
  ];
}

function consumesPlace(entry: TransactionPlanOrderMove, rule: RosterRule): boolean {
  const placed = entry.placement?.toSlot;
  return placed !== undefined && rosterPlaceCount(rule, placed) > 0;
}

function addDependency(
  dependencies: Map<TransactionMoveId, Set<TransactionMoveId>>,
  move: TransactionMoveId,
  prerequisite: TransactionMoveId,
): void {
  dependencies.get(move)?.add(prerequisite);
}

function unmetDependencies(
  move: TransactionMoveId,
  dependencies: ReadonlyMap<TransactionMoveId, ReadonlySet<TransactionMoveId>>,
  done: ReadonlySet<TransactionMoveId>,
): ReadonlyArray<TransactionMoveId> {
  return [...(dependencies.get(move) ?? [])].filter((id) => !done.has(id));
}

function orderedDependencies(
  move: TransactionMoveId,
  dependencies: ReadonlyMap<TransactionMoveId, ReadonlySet<TransactionMoveId>>,
  entries: ReadonlyArray<TransactionPlanOrderMove>,
): ReadonlyArray<TransactionMoveId> {
  const positions = new Map(entries.map((entry) => [entry.move.id, entry.move.position] as const));
  return [...(dependencies.get(move) ?? [])].sort(
    (left, right) => (positions.get(left) ?? 0) - (positions.get(right) ?? 0),
  );
}

function moveById(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  move: TransactionMoveId,
): TransactionPlanMove {
  return requireValue(
    entries.find((entry) => entry.move.id === move)?.move,
    "An ordered move was not declared in the plan",
  );
}

function requireValue<Value>(value: Value | undefined, detail: string): Value {
  if (value === undefined) {
    throw new Error(detail);
  }
  return value;
}

function movesById(
  moves: ReadonlyArray<TransactionPlanMove>,
): ReadonlyMap<TransactionMoveId, TransactionPlanMove> {
  return new Map(moves.map((move) => [move.id, move] as const));
}

function rosterOf(
  facts: TransactionPlanTeamFacts,
): ReadonlyMap<string, TransactionPlanRosterPlayer> {
  return new Map(facts.roster.map((player) => [player.key, player] as const));
}

function rosterSlotOf(
  facts: TransactionPlanTeamFacts,
  playerKey: string | undefined,
): string | undefined {
  return playerKey === undefined
    ? undefined
    : facts.roster.find((player) => player.key === playerKey)?.slot;
}

function droppedKeys(moves: ReadonlyArray<TransactionPlanMove>): ReadonlySet<string> {
  return new Set(moves.flatMap((move) => move.drops.map((drop) => drop.key)));
}

function comparePlanMoves(left: TransactionPlanMove, right: TransactionPlanMove): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function isAddKind(kind: TransactionPlanMove["kind"]): boolean {
  return kind === "free_agent_add" || kind === "waiver_claim";
}

function nameOf(player: { readonly key: string; readonly name?: string }): string {
  return player.name ?? player.key;
}

function nameList(names: ReadonlyArray<string>): string {
  const first = names[0];
  if (first === undefined) {
    return "no one";
  }
  if (names.length === 1) {
    return first;
  }
  return `${names.slice(0, -1).join(", ")} and ${String(names[names.length - 1])}`;
}

function moveLabel(move: TransactionPlanMove): string {
  const drops = move.drops.map((drop) => nameOf(drop)).join(", ");
  switch (move.kind) {
    case "free_agent_add":
    case "waiver_claim": {
      const adds = move.adds.map((add) => nameOf(add)).join(", ");
      return drops === "" ? `Add ${adds}` : `Add ${adds} and drop ${drops}`;
    }
    case "drop":
      return `Drop ${drops}`;
    case "trade":
      return "The trade";
    case "activate":
    case "stash": {
      const player = move.intent?.player;
      return `${move.kind === "activate" ? "Activate" : "Stash"} ${player === undefined ? "a player" : nameOf(player)}`;
    }
    case "slot_move":
      return `Move ${move.slotMove?.playerName ?? move.slotMove?.playerKey ?? "a player"} to ${move.slotMove?.toSlot ?? "a place"}`;
  }
}

function appendReasons(
  target: Array<StoredMoveValidationReason> | undefined,
  reasons: ReadonlyArray<StoredMoveValidationReason> | undefined,
): void {
  if (target === undefined || reasons === undefined) {
    return;
  }
  for (const reason of reasons) {
    target.push(reason);
  }
}

function emptyReasons(): Reasons {
  return { stale: [], illegal: [] };
}

function reasonCount(reasons: Reasons | undefined): number {
  return reasons === undefined ? 0 : reasons.stale.length + reasons.illegal.length;
}

function stale(
  reasons: Reasons,
  code: string,
  playerKey: string | undefined,
  detail: string,
): void {
  reasons.stale.push({ code, ...(playerKey === undefined ? {} : { playerKey }), detail });
}

function illegal(
  reasons: Reasons,
  code: string,
  playerKey: string | undefined,
  detail: string,
): void {
  reasons.illegal.push({ code, ...(playerKey === undefined ? {} : { playerKey }), detail });
}

export type TransactionPlanConstraints = {
  readonly rosterMaximum: number;
  readonly benchCapacity: "generic" | "per_slot";
  readonly startingSlotsMayStandEmpty: boolean;
  readonly reserveEligibility:
    | { readonly kind: "published_positions" }
    | { readonly kind: "injury_status" }
    | { readonly kind: "not_published"; readonly detail: string };
};

export type TransactionPlanTiming = {
  readonly rule: "same_day" | "next_day" | "weekly_lock" | undefined;
  readonly currentDate: StoredMoveDate | undefined;
};

export type TransactionPlanSlot = {
  readonly position: string;
  readonly kind: "starting" | "bench" | "reserve";
  readonly count: number;
  readonly eligibility: ReadonlyArray<string>;
};

export type TransactionPlanRosterPlayer = {
  readonly key: string;
  readonly name: string;
  readonly positions: ReadonlyArray<string>;
  readonly slot: string | undefined;
  readonly injured: boolean;
  readonly editable: boolean;
};

export type TransactionPlanPoolPlayer = {
  readonly key: string;
  readonly name: string;
  readonly positions: ReadonlyArray<string>;
  readonly availability: "free_agent" | "waiver";
};

export type TransactionPlanTeamFacts = {
  readonly roster: ReadonlyArray<TransactionPlanRosterPlayer>;
  readonly pool: ReadonlyMap<string, TransactionPlanPoolPlayer>;
  readonly slots: ReadonlyArray<TransactionPlanSlot>;
  readonly constraints: TransactionPlanConstraints;
  readonly today: StoredMoveDate;
  readonly timing: TransactionPlanTiming;
  readonly budget: number | undefined;
};

export type TransactionPlanMove = Pick<
  TransactionMoveRecord,
  | "id"
  | "group"
  | "position"
  | "kind"
  | "adds"
  | "fallbacks"
  | "drops"
  | "picks"
  | "slotMove"
  | "intent"
  | "bid"
  | "runDay"
  | "decision"
>;

export type TransactionPlanEvaluationInput = {
  readonly facts: TransactionPlanTeamFacts;
  readonly moves: ReadonlyArray<TransactionPlanMove>;
  readonly checkedAt: DateTime.Utc;
};

export type TransactionPlanMoveEvaluation = {
  readonly move: TransactionMoveId;
  readonly group: string | undefined;
  readonly claims: ReadonlyArray<StoredMoveClaim>;
  readonly validation: StoredMoveValidation;
  readonly placement: StoredMovePlacement | undefined;
  readonly runDay: StoredMoveDate;
  readonly effectiveDate: StoredMoveDate | undefined;
  readonly dueToday: boolean;
  readonly runPosition: number | undefined;
};

export type TransactionPlanGroupEvaluation = {
  readonly group: string | undefined;
  readonly moves: ReadonlyArray<TransactionMoveId>;
  readonly valid: boolean;
  readonly detail?: string;
};

export type TransactionPlanEvaluation = {
  readonly moves: ReadonlyArray<TransactionPlanMoveEvaluation>;
  readonly groups: ReadonlyArray<TransactionPlanGroupEvaluation>;
  readonly order: TransactionPlanOrder;
};

export type TransactionPlanOrderInput = {
  readonly facts: TransactionPlanTeamFacts;
  readonly moves: ReadonlyArray<TransactionPlanOrderMove>;
};

export type TransactionPlanOrderMove = {
  readonly move: TransactionPlanMove;
  readonly placement: StoredMovePlacement | undefined;
  readonly runnable: boolean;
};

export type TransactionPlanOrderStep = {
  readonly move: TransactionMoveId;
  readonly position: number;
  readonly fundedBy: TransactionMoveId | undefined;
  readonly dependsOn: ReadonlyArray<TransactionMoveId>;
};

export type TransactionPlanOrderBlockage = {
  readonly move: TransactionMoveId;
  readonly detail: string;
};

export type TransactionPlanOrder = {
  readonly steps: ReadonlyArray<TransactionPlanOrderStep>;
  readonly excluded: ReadonlyArray<TransactionMoveId>;
  readonly blocked: ReadonlyArray<TransactionPlanOrderBlockage>;
};

export type TransactionPlanClaimInput = {
  readonly moves: ReadonlyArray<TransactionPlanMove>;
  readonly placements: ReadonlyMap<TransactionMoveId, StoredMovePlacement>;
  readonly roster: ReadonlyMap<string, TransactionPlanRosterPlayer>;
};

export type TransactionPlanMoveClaims = {
  readonly move: TransactionMoveId;
  readonly claims: ReadonlyArray<StoredMoveClaim>;
};

export type TransactionPlanClaimRefusal = {
  readonly move: TransactionMoveId;
  readonly claim: StoredMoveClaim;
  readonly heldBy: TransactionMoveId;
  readonly code: "player_claimed" | "place_claimed" | "pick_claimed";
  readonly detail: string;
};

export type TransactionPlanClaims = {
  readonly moves: ReadonlyArray<TransactionPlanMoveClaims>;
  readonly refused: ReadonlyArray<TransactionPlanClaimRefusal>;
};

type Reasons = {
  readonly stale: Array<StoredMoveValidationReason>;
  readonly illegal: Array<StoredMoveValidationReason>;
};

type CheckedMove = {
  readonly move: TransactionPlanMove;
  readonly stale: Array<StoredMoveValidationReason>;
  readonly illegal: Array<StoredMoveValidationReason>;
  placement: StoredMovePlacement | undefined;
};

type ClaimCandidate = {
  readonly claim: StoredMoveClaim;
  readonly label: string;
};

type PlacementIntent =
  | { readonly kind: "activate"; readonly player: { readonly key: string; readonly name: string } }
  | { readonly kind: "stash"; readonly player: { readonly key: string; readonly name: string } }
  | { readonly kind: "add"; readonly to: "active" | "reserve" };
