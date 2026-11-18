import { DateTime } from "effect";

import { placeIntentItems } from "#contexts/connections/ProposalOrder.ts";
import type { ProposalPlacementInput } from "#contexts/connections/ProposalOrder.ts";
import {
  exclusivePlace,
  rosterOccupancy,
  rosterRuleOf,
  slotCapacity,
  slotMismatchDetail,
  slotPlacement,
} from "#contexts/connections/RosterSlots.ts";
import type { RosterRule } from "#contexts/connections/RosterSlots.ts";
import type { TransactionWaiverBid } from "#contexts/connections/TransactionPlans.ts";

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
  const moves = [...input.moves].sort(comparePlanMoves);
  const byId = movesById(moves);
  const entries = moves.map((move) => ({ move, placement: undefined, runnable: true }));
  const graph = planDependencies(entries, facts, rule);
  const sequence = topologicalSequence(entries, graph);
  const groupCures = groupCuredPlayers(moves);
  const replay = replayPlan({ facts, rule, entries, byId, graph, sequence, groupCures });
  const explanations = sequence.blocked.filter(
    (entry) => reasonCount(replay.steps.get(entry.move)) === 0,
  );
  for (const explanation of explanations) {
    requireValue(
      replay.steps.get(explanation.move),
      "A blocked plan move was not replayed",
    ).stale.push({ code: "order_conflict", detail: explanation.detail });
  }

  const positions = new Map(replay.applied.map((move, position) => [move, position] as const));
  const evaluated = moves.map((move) =>
    moveEvaluation(
      requireValue(replay.steps.get(move.id), "A plan move was not replayed"),
      facts,
      input.checkedAt,
      positions.get(move.id),
    ),
  );
  const order: TransactionPlanOrder = {
    steps: replay.applied.map((move, position) => ({
      move,
      position,
      fundedBy: graph.fundedBy.get(move),
      dependsOn: orderedDependencies(move, graph.dependencies, entries),
    })),
    excluded: moves.filter((move) => !positions.has(move.id)).map((move) => move.id),
    blocked: explanations.map((entry) => ({ move: entry.move, detail: entry.detail })),
  };

  return {
    moves: evaluated,
    groups: groupEvaluations(evaluated, moves),
    order,
  };
}

export function orderTransactionPlanMoves(input: TransactionPlanOrderInput): TransactionPlanOrder {
  const rule = rosterRuleOf(input.facts.constraints, input.facts.slots);
  const entries = [...input.moves].sort((left, right) => comparePlanMoves(left.move, right.move));
  const runnable = entries.filter((entry) => entry.runnable);
  const excluded = entries.filter((entry) => !entry.runnable).map((entry) => entry.move.id);
  const sequence = topologicalSequence(runnable, planDependencies(runnable, input.facts, rule));

  return { steps: sequence.steps, excluded, blocked: sequence.blocked };
}

export function claimTransactionPlanMoves(input: TransactionPlanClaimInput): TransactionPlanClaims {
  const moves = [...input.moves].sort(comparePlanMoves);
  const held = new Map<string, TransactionMoveId>();
  const claimed: Array<TransactionPlanMoveClaims> = [];
  const refused: Array<TransactionPlanClaimRefusal> = [];

  for (const move of moves) {
    const candidates = claimCandidates(
      move,
      input.placements.get(move.id),
      input.roster,
      input.placeClaims,
    );
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
        detail: claimRefusalDetail(candidate),
      });
    }
    claimed.push({
      move: move.id,
      claims: candidates.map((candidate) => candidate.claim).sort(compareClaims),
    });
  }

  return { moves: claimed, refused };
}

export function describeTransactionPlanMove(move: TransactionPlanMove): string {
  return moveLabel(move);
}

export function dateHasArrived(
  move: Pick<TransactionPlanMove, "effectiveDate">,
  today: StoredMoveDate,
): boolean {
  return move.effectiveDate === undefined || move.effectiveDate <= today;
}

export function projectedLegs(input: {
  readonly rule: RosterRule;
  readonly roster: ReadonlyArray<TransactionPlanRosterPlayer>;
  readonly submitted: ReadonlyArray<TransactionPlanMove>;
  readonly dates: ReadonlyArray<StoredMoveDate>;
}): ReadonlyArray<TransactionPlanMove> {
  const players = new Map(input.roster.map((player) => [player.key, player] as const));
  const dates = new Set(input.dates);
  return input.submitted.filter(
    (move) =>
      (move.effectiveDate === undefined || dates.has(move.effectiveDate)) &&
      !shownOnRoster(move, players, input.rule),
  );
}

function replayPlan(input: {
  readonly facts: TransactionPlanTeamFacts;
  readonly rule: RosterRule;
  readonly entries: ReadonlyArray<TransactionPlanOrderMove>;
  readonly byId: ReadonlyMap<TransactionMoveId, TransactionPlanMove>;
  readonly graph: PlanGraph;
  readonly sequence: PlanSequence;
  readonly groupCures: ReadonlyMap<string, ReadonlySet<string>>;
}): {
  readonly steps: Map<TransactionMoveId, ReplayStep>;
  readonly applied: ReadonlyArray<TransactionMoveId>;
} {
  const projection = initialProjection(input.facts);
  const steps = new Map<TransactionMoveId, ReplayStep>();
  const applied: Array<TransactionMoveId> = [];
  const blocked = new Set(input.sequence.blocked.map((entry) => entry.move));
  const runnable = [
    ...input.sequence.steps.map((step) => step.move),
    ...input.sequence.blocked.map((entry) => entry.move),
  ];

  for (const id of runnable) {
    const move = requireValue(input.byId.get(id), "A replayed move was not declared in the plan");
    const step = evaluateReplayMove({
      move,
      projection,
      facts: input.facts,
      rule: input.rule,
      byId: input.byId,
      dependencies: input.graph.dependencies,
      entries: input.entries,
      steps,
      blocked: blocked.has(id),
      groupCures: input.groupCures,
    });
    steps.set(id, step);
    if (step.applied) {
      applied.push(id);
    }
  }

  return { steps, applied };
}

function evaluateReplayMove(input: ReplayMoveInput): ReplayStep {
  const { move, projection, facts, rule, byId } = input;
  const placeClaims = (place: string): boolean => exclusivePlace(rule, place);
  const dependsOn = orderedDependencies(move.id, input.dependencies, input.entries);
  const step: ReplayStep = {
    move,
    dependsOn,
    claims: claimCandidates(move, undefined, projection.roster, placeClaims)
      .map((candidate) => candidate.claim)
      .sort(compareClaims),
    stale: [],
    illegal: [],
    placement: undefined,
    applied: false,
    pending: false,
    projectedRoster: [],
  };
  const dependencies = dependsOn.map((id) => input.steps.get(id));
  const waitingOn = dependencies.find((dependency) => dependency?.pending === true);
  const brokenBy = dependencies.find(
    (dependency) => dependency !== undefined && !dependency.pending && !dependency.applied,
  );

  if (move.result === "pending" && move.kind === "trade") {
    step.pending = true;
    stale(
      step,
      "pending_outcome",
      undefined,
      `${moveLabel(move)} waits on the league's answer before it can run.`,
    );
    holdClaims(step, projection, true, undefined, placeClaims);
    step.projectedRoster = projectionRoster(projection);
    return step;
  }
  if (waitingOn !== undefined) {
    stale(
      step,
      "pending_outcome",
      undefined,
      `${moveLabel(move)} waits on ${moveLabel(waitingOn.move)}, which is waiting on the league's answer.`,
    );
    step.projectedRoster = projectionRoster(projection);
    return step;
  }
  if (brokenBy !== undefined) {
    stale(
      step,
      "blocked_by_move",
      undefined,
      `${moveLabel(move)} cannot run because ${moveLabel(brokenBy.move)} did not pass its check.`,
    );
    step.projectedRoster = projectionRoster(projection);
    return step;
  }

  const claims = checkClaims(move, projection, placeClaims);
  if (claims.waiting !== undefined) {
    const holder = requireValue(
      byId.get(claims.waiting.move),
      "A claiming move was not declared in the plan",
    );
    stale(
      step,
      "pending_outcome",
      undefined,
      `${claims.waiting.label} is claimed by ${moveLabel(holder)}, which is waiting on the league's answer.`,
    );
    step.projectedRoster = projectionRoster(projection);
    return step;
  }
  if (claims.refused.length > 0) {
    appendReasons(step.stale, claims.refused);
    step.projectedRoster = projectionRoster(projection);
    return step;
  }

  const identity = identityReasons(move, facts, rule, projection, byId);
  appendReasons(step.stale, identity.stale);
  appendReasons(step.illegal, identity.illegal);
  let effect: PlanEffect | undefined;
  if (reasonCount(step) === 0) {
    const intended = replayEffect(move, projection, undefined, rule, facts);
    const reserveClaim = destinationRefusal({
      move,
      places: uniquePlaces(intended.reserveUsed),
      projection,
      byId,
    });
    if (reserveClaim !== undefined) {
      step.stale.push(reserveClaim);
    }
    if (reasonCount(step) === 0) {
      step.placement = placeMove(move, projection, facts, rule, step);
      effect =
        step.placement === undefined
          ? intended
          : replayEffect(move, projection, step.placement, rule, facts);
    }
  }
  if (reasonCount(step) === 0) {
    const illegality = rosterIllegality(move, step.placement, rule, projection, input.groupCures);
    appendReasons(step.stale, illegality.stale);
    appendReasons(step.illegal, illegality.illegal);
  }
  if (reasonCount(step) === 0 && effect !== undefined) {
    const destination = destinationRefusal({
      move,
      places: usedDestinations(move, step.placement, placeClaims),
      projection,
      byId,
    });
    if (destination !== undefined) {
      step.stale.push(destination);
    }
  }
  if (reasonCount(step) === 0 && effect !== undefined) {
    const accounting = accountingReason(move, effect, projection, facts, rule);
    if (accounting !== undefined) {
      step.stale.push(accounting);
    }
  }
  if (
    reasonCount(step) === 0 &&
    effect !== undefined &&
    placementIntentOf(move) !== undefined &&
    step.placement === undefined
  ) {
    stale(
      step,
      "state_unavailable",
      undefined,
      `${moveLabel(move)} has no place this check can confirm, so it cannot run.`,
    );
  }
  if (reasonCount(step) === 0 && !input.blocked) {
    step.claims = claimCandidates(move, step.placement, projection.roster, placeClaims)
      .map((candidate) => candidate.claim)
      .sort(compareClaims);
    if (holdsClaimsWithoutEffect(move.result)) {
      holdClaims(step, projection, false, step.placement, placeClaims);
    } else {
      applyMove(
        step,
        requireValue(effect, "An applied move has no projected effect"),
        projection,
        placeClaims,
      );
      step.applied = true;
    }
  }
  step.projectedRoster = projectionRoster(projection);
  return step;
}

function identityReasons(
  move: TransactionPlanMove,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
  projection: TeamProjection,
  byId: ReadonlyMap<TransactionMoveId, TransactionPlanMove>,
): Reasons {
  const reasons = emptyReasons();
  const dueToday = runDayOf(move, facts.today) === facts.today;
  if (needsSlotWrite(move) && facts.slotWrites.status === "not_published") {
    stale(
      reasons,
      "provider_write_unavailable",
      undefined,
      `${moveLabel(move)} cannot run. ${facts.slotWrites.detail}`,
    );
  }
  for (const drop of move.drops) {
    const player = projection.roster.get(drop.key);
    if (player === undefined) {
      stale(
        reasons,
        "drop_not_rostered",
        drop.key,
        leftRosterDetail(nameOf(drop), "drop them", drop.key, projection, byId),
      );
    } else if (dueToday && !player.editable) {
      stale(
        reasons,
        "player_locked",
        drop.key,
        lockedPlayerDetail(player.name, lockedActionOf(move, drop.key)),
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
    if (move.drops.length > 1) {
      stale(
        reasons,
        "intent_invalid",
        undefined,
        `This move drops ${String(move.drops.length)} players. An ${move.kind} drops one player to fund it.`,
      );
    }
    if (player !== undefined && move.drops.some((drop) => drop.key === player.key)) {
      stale(
        reasons,
        "intent_invalid",
        player.key,
        `This move drops the same player it moves. Name a different player to fund the ${move.kind}.`,
      );
    }
    if (player === undefined) {
      stale(
        reasons,
        "intent_invalid",
        undefined,
        `This move names no player. An ${move.kind} names the rostered player to move.`,
      );
    } else {
      const rostered = projection.roster.get(player.key);
      if (rostered === undefined) {
        stale(
          reasons,
          "move_not_rostered",
          player.key,
          leftRosterDetail(nameOf(player), "place them", player.key, projection, byId),
        );
      } else if (dueToday && !rostered.editable) {
        stale(
          reasons,
          "player_locked",
          player.key,
          lockedPlayerDetail(rostered.name, lockedActionOf(move, player.key)),
        );
      }
    }
  }
  if (move.kind === "slot_move") {
    const declared = move.slotMove;
    if (move.drops.length > 1) {
      stale(
        reasons,
        "intent_invalid",
        undefined,
        `This move drops ${String(move.drops.length)} players. A slot move drops one player to fund it.`,
      );
    }
    if (declared !== undefined && move.drops.some((drop) => drop.key === declared.playerKey)) {
      stale(
        reasons,
        "intent_invalid",
        declared.playerKey,
        "This move drops the same player it moves. Name a different player to fund the slot move.",
      );
    }
    if (declared === undefined) {
      stale(
        reasons,
        "intent_invalid",
        undefined,
        "This move names no place. A slot move names the player to move and the place they move to.",
      );
    } else {
      const player = projection.roster.get(declared.playerKey);
      if (player === undefined) {
        stale(
          reasons,
          "move_not_rostered",
          declared.playerKey,
          leftRosterDetail(
            declared.playerName ?? declared.playerKey,
            "place them",
            declared.playerKey,
            projection,
            byId,
          ),
        );
      } else if (dueToday && !player.editable) {
        stale(
          reasons,
          "player_locked",
          declared.playerKey,
          lockedPlayerDetail(player.name, lockedActionOf(move, declared.playerKey)),
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
  if (move.kind === "waiver_claim") {
    if (facts.waiverBid.kind === "published") {
      const balance = projection.budget ?? facts.waiverBid.balance;
      if (move.bid === undefined) {
        stale(
          reasons,
          "bid_required",
          undefined,
          `This league takes a FAAB bid and publishes the balance: name a bid from 0 to ${String(balance)}.`,
        );
      } else if (move.bid > balance) {
        stale(
          reasons,
          "bid_exceeds_budget",
          undefined,
          `A bid of ${String(move.bid)} is more than the ${String(balance)} FAAB this team has left.`,
        );
      }
    } else if (move.bid !== undefined) {
      stale(
        reasons,
        "bid_not_available",
        undefined,
        "This league takes no FAAB bid: name the claim without a bid.",
      );
    }
  } else if (move.bid !== undefined) {
    stale(reasons, "bid_not_available", undefined, "Only a waiver claim carries a FAAB bid.");
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

function lockedActionOf(move: TransactionPlanMove, playerKey: string): string {
  if (move.kind === "trade") {
    return "trade them away";
  }
  if (move.drops.some((drop) => drop.key === playerKey)) {
    return "drop them";
  }
  if (move.kind === "slot_move" && move.slotMove !== undefined) {
    return `move them to ${move.slotMove.toSlot}`;
  }
  if (move.kind === "activate") {
    return "activate them";
  }
  if (move.kind === "stash") {
    return "stash them";
  }
  return "move them";
}

function lockedPlayerDetail(name: string, action: string): string {
  return `${name} has already played or is locked in their place today, so this move cannot ${action}. Wait until the league unlocks ${name}, or choose another player.`;
}

function leftRosterDetail(
  name: string,
  action: string,
  playerKey: string,
  projection: TeamProjection,
  byId: ReadonlyMap<TransactionMoveId, TransactionPlanMove>,
): string {
  const remover = projection.removedBy.get(playerKey);
  return remover === undefined
    ? `${name} is no longer on the roster, so this move cannot ${action}.`
    : `${name} left the roster when ${moveLabel(requireValue(byId.get(remover), "A removing move was not declared in the plan"))} ran, so this move cannot ${action}.`;
}

function checkClaims(
  move: TransactionPlanMove,
  projection: TeamProjection,
  placeClaims: (place: string) => boolean,
): ClaimCheck {
  const leaving = leavingPlaces(move, projection);
  const refused: Array<StoredMoveValidationReason> = [];
  for (const candidate of claimCandidates(move, undefined, projection.roster, placeClaims)) {
    const held = projection.claims.get(claimKey(candidate.claim));
    if (held === undefined || held.move === move.id) {
      continue;
    }
    if (candidate.claim.kind === "place" && leaving.has(candidate.claim.key)) {
      continue;
    }
    if (held.pending) {
      return { refused, waiting: { move: held.move, label: candidate.label } };
    }
    if (transfersClaim(held, candidate.claim, move)) {
      continue;
    }
    refused.push({
      code: claimRefusalCode(candidate.claim.kind),
      ...(candidate.claim.kind === "player" ? { playerKey: candidate.claim.key } : {}),
      detail: claimRefusalDetail(candidate),
    });
  }
  return { refused, waiting: undefined };
}

function transfersClaim(
  held: HeldClaim,
  claim: StoredMoveClaim,
  move: TransactionPlanMove,
): boolean {
  if (claim.kind !== "player") {
    return false;
  }
  const adds =
    move.adds.some((add) => add.key === claim.key) ||
    move.fallbacks.some((fallback) => fallback.key === claim.key);
  return held.adds !== adds;
}

function destinationRefusal(input: {
  readonly move: TransactionPlanMove;
  readonly places: ReadonlyArray<string>;
  readonly projection: TeamProjection;
  readonly byId: ReadonlyMap<TransactionMoveId, TransactionPlanMove>;
}): StoredMoveValidationReason | undefined {
  for (const place of input.places) {
    const held = input.projection.claims.get(claimKey({ kind: "place", key: place }));
    if (held === undefined || held.move === input.move.id) {
      continue;
    }
    if (held.pending) {
      return {
        code: "pending_outcome",
        detail: `${moveLabel(input.move)} waits on ${moveLabel(requireValue(input.byId.get(held.move), "A claiming move was not declared in the plan"))}, which holds the ${place} place and is waiting on the league's answer.`,
      };
    }
    return {
      code: "place_claimed",
      detail: `The ${place} place is already claimed in this plan by another move. Two open moves cannot claim the same place; discard or change one of them.`,
    };
  }
  return undefined;
}

function usedDestinations(
  move: TransactionPlanMove,
  placement: StoredMovePlacement | undefined,
  placeClaims: (place: string) => boolean,
): ReadonlyArray<string> {
  const places: Array<string> = [];
  if (move.kind === "slot_move" && move.slotMove !== undefined) {
    places.push(move.slotMove.toSlot);
  }
  if (placement !== undefined) {
    places.push(placement.toSlot);
  }
  return uniquePlaces(places).filter(placeClaims);
}

function uniquePlaces(places: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(places)];
}

function placeMove(
  move: TransactionPlanMove,
  projection: TeamProjection,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
  step: ReplayStep,
): StoredMovePlacement | undefined {
  if (move.kind === "slot_move") {
    checkSlotDestination(move, projection, rule, step);
    return undefined;
  }
  const item = placementItem(move, facts);
  if (item === undefined) {
    return undefined;
  }
  const players = [...projection.roster.values()].filter(
    (player) => !move.drops.some((drop) => drop.key === player.key),
  );
  const placed = placeIntentItems({
    constraints: facts.constraints,
    slots: facts.slots,
    players,
    items: [item],
  });
  for (const refusal of placed.refused) {
    if (refusal.code === "slot_illegal") {
      illegal(step, refusal.code, undefined, refusal.detail);
    } else {
      stale(step, refusal.code, undefined, refusal.detail);
    }
  }
  const placement = placed.placements.find((entry) => entry.item === move.id);
  return placement === undefined
    ? undefined
    : {
        playerKey: placement.playerKey,
        playerName: placement.playerName,
        ...(placement.fromSlot === undefined ? {} : { fromSlot: placement.fromSlot }),
        toSlot: placement.toSlot,
        detail: placement.detail,
      };
}

function checkSlotDestination(
  move: TransactionPlanMove,
  projection: TeamProjection,
  rule: RosterRule,
  step: ReplayStep,
): void {
  const declared = move.slotMove;
  if (declared === undefined) {
    return;
  }
  const destination = rule.byPosition.get(declared.toSlot);
  if (destination === undefined) {
    return;
  }
  const capacity = slotCapacity(rule, destination);
  const occupants = [...projection.roster.values()].filter(
    (occupant) => occupant.slot === destination.position && occupant.key !== declared.playerKey,
  );
  if (capacity !== undefined && occupants.length >= capacity) {
    illegal(
      step,
      "slot_illegal",
      declared.playerKey,
      `The ${destination.position} place already holds ${nameList(occupants.map((occupant) => occupant.name))}. Move one of them first, or choose another place.`,
    );
  }
}

function rosterIllegality(
  move: TransactionPlanMove,
  placement: StoredMovePlacement | undefined,
  rule: RosterRule,
  projection: TeamProjection,
  groupCures: ReadonlyMap<string, ReadonlySet<string>>,
): Reasons {
  const reasons = emptyReasons();
  const occupancy = rosterOccupancy({ rule, players: [...projection.roster.values()] });
  for (const occupant of occupancy.illegal) {
    if (curesPlacement(move, placement, occupant.key, rule, projection)) {
      continue;
    }
    if (move.group !== undefined && groupCures.get(move.group)?.has(occupant.key) === true) {
      continue;
    }
    illegal(reasons, "slot_illegal", occupant.key, occupant.detail);
  }
  return reasons;
}

function groupCuredPlayers(
  moves: ReadonlyArray<TransactionPlanMove>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const cured = new Map<string, Set<string>>();
  for (const move of moves) {
    if (move.group === undefined) {
      continue;
    }
    const keys = cured.get(move.group) ?? new Set<string>();
    for (const drop of move.drops) {
      keys.add(drop.key);
    }
    const mover = moverKeyOf(move);
    if (mover !== undefined) {
      keys.add(mover);
    }
    cured.set(move.group, keys);
  }
  return cured;
}

function curesPlacement(
  move: TransactionPlanMove,
  placement: StoredMovePlacement | undefined,
  playerKey: string,
  rule: RosterRule,
  projection: TeamProjection,
): boolean {
  if (move.drops.some((drop) => drop.key === playerKey)) {
    return true;
  }
  const declared = move.kind === "slot_move" ? move.slotMove : undefined;
  const mover = moverKeyOf(move);
  const destination = declared?.toSlot ?? placement?.toSlot;
  const player = projection.roster.get(playerKey);
  if (mover !== playerKey || destination === undefined || player === undefined) {
    return false;
  }
  return slotPlacement(rule, destination, player).legal === true;
}

function accountingReason(
  move: TransactionPlanMove,
  effect: PlanEffect,
  projection: TeamProjection,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
): StoredMoveValidationReason | undefined {
  const occupancy = rosterOccupancy({ rule, players: [...projection.roster.values()] });
  const free = Math.max(0, facts.constraints.rosterMaximum - occupancy.occupied);
  const needed = Math.max(0, effect.placesUsed - effect.placesFreed);
  if (needed > free) {
    return {
      code: "roster_full",
      detail: `${moveLabel(move)} needs a roster place, and this plan does not free one. Add a drop or a reserve move that frees a place, or remove this move.`,
    };
  }
  for (const list of uniquePlaces(effect.reserveUsed)) {
    const slot = rule.byPosition.get(list);
    const capacity = slot?.kind === "reserve" ? slot.count : 0;
    const occupied = occupancy.reserve.find((entry) => entry.name === list)?.occupied ?? 0;
    const freed = effect.reserveFreed.filter((name) => name === list).length;
    const used = effect.reserveUsed.filter((name) => name === list).length;
    if (used > Math.max(0, capacity - occupied) + freed) {
      return {
        code: "reserve_unavailable",
        detail: `${moveLabel(move)} needs a place on the ${list} reserve list, and this plan does not free one.`,
      };
    }
  }
  return undefined;
}

function applyMove(
  step: ReplayStep,
  effect: PlanEffect,
  projection: TeamProjection,
  exclusivePlaceOf: (place: string) => boolean,
): void {
  const move = step.move;
  for (const place of leavingPlaces(move, projection)) {
    projection.claims.delete(claimKey({ kind: "place", key: place }));
  }
  for (const transfer of effect.transfers) {
    if (transfer.to === undefined) {
      projection.roster.delete(transfer.key);
      projection.removedBy.set(transfer.key, move.id);
      projection.claims.delete(claimKey({ kind: "player", key: transfer.key }));
    }
  }
  for (const transfer of effect.transfers) {
    const member = transfer.member;
    if (transfer.to === undefined || member === undefined) {
      continue;
    }
    projection.roster.set(transfer.key, {
      key: transfer.key,
      name: member.name,
      positions: member.positions,
      slot: member.slot,
      injured: member.injured,
      editable: member.editable,
    });
  }
  for (const drop of move.drops) {
    projection.claims.set(claimKey({ kind: "player", key: drop.key }), {
      move: move.id,
      adds: false,
      pending: false,
    });
  }
  for (const add of [...move.adds, ...move.fallbacks]) {
    projection.claims.set(claimKey({ kind: "player", key: add.key }), {
      move: move.id,
      adds: true,
      pending: false,
    });
  }
  for (const place of usedPlaces(move, step.placement, exclusivePlaceOf)) {
    projection.claims.set(claimKey({ kind: "place", key: place }), {
      move: move.id,
      adds: false,
      pending: false,
    });
  }
  for (const pick of effect.picks) {
    projection.claims.set(claimKey({ kind: "draft_pick", key: pick }), {
      move: move.id,
      adds: false,
      pending: false,
    });
  }
  if (effect.budgetSpent !== 0 && projection.budget !== undefined) {
    projection.budget -= effect.budgetSpent;
  }
}

function holdClaims(
  step: ReplayStep,
  projection: TeamProjection,
  pending: boolean,
  placement: StoredMovePlacement | undefined,
  placeClaims: (place: string) => boolean,
): void {
  for (const candidate of claimCandidates(step.move, placement, projection.roster, placeClaims)) {
    projection.claims.set(claimKey(candidate.claim), {
      move: step.move.id,
      adds:
        candidate.claim.kind === "player" &&
        (step.move.adds.some((add) => add.key === candidate.claim.key) ||
          step.move.fallbacks.some((fallback) => fallback.key === candidate.claim.key)),
      pending,
    });
  }
}

function leavingPlaces(move: TransactionPlanMove, projection: TeamProjection): Set<string> {
  const places = new Set<string>();
  for (const drop of move.drops) {
    const player = projection.roster.get(drop.key);
    if (player?.slot !== undefined) {
      places.add(player.slot);
    }
  }
  const mover = moverKeyOf(move);
  const player = mover === undefined ? undefined : projection.roster.get(mover);
  if (player?.slot !== undefined) {
    places.add(player.slot);
  }
  return places;
}

function usedPlaces(
  move: TransactionPlanMove,
  placement: StoredMovePlacement | undefined,
  placeClaims: (place: string) => boolean,
): ReadonlyArray<string> {
  const places = claimedPlacesOf(move, placement);
  return places.filter(placeClaims);
}

function claimedPlacesOf(
  move: TransactionPlanMove,
  placement: StoredMovePlacement | undefined,
): ReadonlyArray<string> {
  if (move.kind === "slot_move") {
    return move.slotMove === undefined ? [] : [move.slotMove.toSlot];
  }
  if (move.kind === "activate" || move.kind === "stash") {
    return placement === undefined ? [] : [placement.toSlot];
  }
  return [];
}

function moverKeyOf(move: TransactionPlanMove): string | undefined {
  if (move.kind === "slot_move") {
    return move.slotMove?.playerKey;
  }
  if (move.kind === "activate" || move.kind === "stash") {
    return move.intent?.player?.key;
  }
  return undefined;
}

function initialProjection(facts: TransactionPlanTeamFacts): TeamProjection {
  return {
    roster: new Map(facts.roster.map((player) => [player.key, player] as const)),
    budget: facts.budget,
    claims: new Map(),
    removedBy: new Map(),
  };
}

function projectionRoster(projection: TeamProjection): ReadonlyArray<TransactionPlanRosterPlayer> {
  return [...projection.roster.values()];
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

function planDependencies(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
): PlanGraph {
  const dependencies = new Map<TransactionMoveId, Set<TransactionMoveId>>(
    entries.map((entry) => [entry.move.id, new Set<TransactionMoveId>()]),
  );
  const fundedBy = new Map<TransactionMoveId, TransactionMoveId>();
  const blocked = new Map<TransactionMoveId, string>();

  addProducerDependencies(entries, dependencies);
  const effects = planMoveEffects(producerOrder(entries, dependencies), facts, rule);
  addDestinationDependencies(entries, facts, dependencies);
  addPlaceDependencies({ entries, facts, rule, effects, dependencies, fundedBy, blocked });

  return { dependencies, fundedBy, blocked };
}

function producerOrder(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  dependencies: ReadonlyMap<TransactionMoveId, ReadonlySet<TransactionMoveId>>,
): ReadonlyArray<TransactionPlanOrderMove> {
  const sequence = topologicalSequence(entries, {
    dependencies: new Map([...dependencies].map(([move, deps]) => [move, new Set(deps)] as const)),
    fundedBy: new Map(),
    blocked: new Map(),
  });
  const byId = new Map(entries.map((entry) => [entry.move.id, entry] as const));
  const ordered = sequence.steps.flatMap((step) => {
    const entry = byId.get(step.move);
    return entry === undefined ? [] : [entry];
  });
  const orderedIds = new Set(ordered.map((entry) => entry.move.id));
  return [...ordered, ...entries.filter((entry) => !orderedIds.has(entry.move.id))];
}

function topologicalSequence(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  graph: PlanGraph,
): PlanSequence {
  const done = new Set<TransactionMoveId>();
  const steps: Array<TransactionPlanOrderStep> = [];
  const blocked = new Map(graph.blocked);
  let progressed = true;
  while (progressed && done.size < entries.length) {
    progressed = false;
    for (const entry of entries) {
      if (done.has(entry.move.id) || blocked.has(entry.move.id)) {
        continue;
      }
      const waiting = unmetDependencies(entry.move.id, graph.dependencies, done);
      if (waiting.length > 0) {
        continue;
      }
      steps.push({
        move: entry.move.id,
        position: steps.length,
        fundedBy: graph.fundedBy.get(entry.move.id),
        dependsOn: orderedDependencies(entry.move.id, graph.dependencies, entries),
      });
      done.add(entry.move.id);
      progressed = true;
    }
  }

  for (const entry of entries) {
    if (done.has(entry.move.id) || blocked.has(entry.move.id)) {
      continue;
    }
    const waiting = unmetDependencies(entry.move.id, graph.dependencies, done);
    blocked.set(
      entry.move.id,
      `No order can run ${moveLabel(entry.move)}: it waits on ${waiting
        .map((id) => moveLabel(moveById(entries, id)))
        .join(", ")}.`,
    );
  }

  return {
    steps,
    blocked: [...blocked.entries()].map(([move, detail]) => ({ move, detail })),
  };
}

function addProducerDependencies(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  dependencies: Map<TransactionMoveId, Set<TransactionMoveId>>,
): void {
  const producers = new Map<string, TransactionMoveId>();
  for (const entry of entries) {
    for (const add of entry.move.adds) {
      if (!producers.has(add.key)) {
        producers.set(add.key, entry.move.id);
      }
    }
  }
  for (const entry of entries) {
    for (const key of consumedPlayers(entry.move)) {
      const producer = producers.get(key);
      if (producer !== undefined && producer !== entry.move.id) {
        addDependency(dependencies, entry.move.id, producer);
      }
    }
  }
}

function consumedPlayers(move: TransactionPlanMove): ReadonlyArray<string> {
  return [
    ...move.drops.map((drop) => drop.key),
    ...(move.slotMove === undefined ? [] : [move.slotMove.playerKey]),
    ...(move.intent?.player === undefined ? [] : [move.intent.player.key]),
  ];
}

function addDestinationDependencies(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  facts: TransactionPlanTeamFacts,
  dependencies: Map<TransactionMoveId, Set<TransactionMoveId>>,
): void {
  const leaves = new Map<string, TransactionMoveId>();
  for (const entry of entries) {
    for (const drop of entry.move.drops) {
      if (!leaves.has(drop.key)) {
        leaves.set(drop.key, entry.move.id);
      }
    }
    const mover = moverKeyOf(entry.move);
    const declared = entry.move.kind === "slot_move" ? entry.move.slotMove : undefined;
    const from =
      entry.placement?.fromSlot ?? facts.roster.find((player) => player.key === mover)?.slot;
    if (mover !== undefined && from !== undefined && from !== declared?.toSlot) {
      if (!leaves.has(mover)) {
        leaves.set(mover, entry.move.id);
      }
    }
  }

  for (const entry of entries) {
    const destination = entry.move.kind === "slot_move" ? entry.move.slotMove?.toSlot : undefined;
    if (destination === undefined) {
      continue;
    }
    for (const occupant of facts.roster) {
      if (occupant.slot !== destination) {
        continue;
      }
      const remover = leaves.get(occupant.key);
      if (remover === undefined || remover === entry.move.id) {
        continue;
      }
      addDependency(dependencies, entry.move.id, remover);
    }
  }
}

function addPlaceDependencies(input: {
  readonly entries: ReadonlyArray<TransactionPlanOrderMove>;
  readonly facts: TransactionPlanTeamFacts;
  readonly rule: RosterRule;
  readonly effects: ReadonlyMap<TransactionMoveId, PlanEffect>;
  readonly dependencies: Map<TransactionMoveId, Set<TransactionMoveId>>;
  readonly fundedBy: Map<TransactionMoveId, TransactionMoveId>;
  readonly blocked: Map<TransactionMoveId, string>;
}): void {
  const moves = input.entries.map((entry) => entry.move);
  const occupancy = rosterOccupancy({ rule: input.rule, players: input.facts.roster });

  const active = allocatePlaces({
    moves,
    changes: changesOf(input.entries, input.effects, (effect) => ({
      frees: effect.placesFreed,
      consumes: effect.placesUsed,
    })),
    free: Math.max(0, input.facts.constraints.rosterMaximum - occupancy.occupied),
    deficit: Math.max(0, occupancy.occupied - input.facts.constraints.rosterMaximum),
  });
  applyAllocation(input, active, undefined);

  for (const slot of input.rule.slots) {
    if (slot.kind !== "reserve") {
      continue;
    }
    const list = occupancy.reserve.find((entry) => entry.name === slot.position);
    const reserved = list?.occupied ?? 0;
    const allocation = allocatePlaces({
      moves,
      changes: changesOf(input.entries, input.effects, (effect) => ({
        frees: effect.reserveFreed.filter((name) => name === slot.position).length,
        consumes: effect.reserveUsed.filter((name) => name === slot.position).length,
      })),
      free: Math.max(0, slot.count - reserved),
      deficit: Math.max(0, reserved - slot.count),
    });
    applyAllocation(input, allocation, slot.position);
  }
}

function changesOf(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  effects: ReadonlyMap<TransactionMoveId, PlanEffect>,
  change: (effect: PlanEffect) => { readonly frees: number; readonly consumes: number },
): ReadonlyMap<TransactionMoveId, { readonly frees: number; readonly consumes: number }> {
  return new Map(
    entries.map((entry) => {
      const effect = requireValue(
        effects.get(entry.move.id),
        "A plan move has no projected effect",
      );
      return [entry.move.id, change(effect)] as const;
    }),
  );
}

function applyAllocation(
  input: {
    readonly entries: ReadonlyArray<TransactionPlanOrderMove>;
    readonly dependencies: Map<TransactionMoveId, Set<TransactionMoveId>>;
    readonly fundedBy: Map<TransactionMoveId, TransactionMoveId>;
    readonly blocked: Map<TransactionMoveId, string>;
  },
  allocation: PlaceAllocation,
  list: string | undefined,
): void {
  for (const entry of input.entries) {
    for (const funding of allocation.funding.get(entry.move.id) ?? []) {
      addDependency(input.dependencies, entry.move.id, funding);
    }
    const firstFunding = allocation.funding.get(entry.move.id)?.[0];
    if (firstFunding !== undefined && input.fundedBy.get(entry.move.id) === undefined) {
      input.fundedBy.set(entry.move.id, firstFunding);
    }
    if (allocation.uncovered.has(entry.move.id) && !input.blocked.has(entry.move.id)) {
      input.blocked.set(
        entry.move.id,
        list === undefined
          ? `${moveLabel(entry.move)} needs a roster place, and the team has none free.`
          : `${moveLabel(entry.move)} needs a place on the ${list} reserve list, and the team has none free.`,
      );
    }
  }
}

type PlaceAllocation = {
  readonly funding: ReadonlyMap<TransactionMoveId, ReadonlyArray<TransactionMoveId>>;
  readonly uncovered: ReadonlySet<TransactionMoveId>;
};

function allocatePlaces(input: {
  readonly moves: ReadonlyArray<TransactionPlanMove>;
  readonly changes: ReadonlyMap<
    TransactionMoveId,
    { readonly frees: number; readonly consumes: number }
  >;
  readonly free: number;
  readonly deficit: number;
}): PlaceAllocation {
  let free = input.free;
  let deficit = input.deficit;
  const freeing = input.moves.flatMap((move) => {
    const change = requireValue(input.changes.get(move.id), "A plan move has no place change");
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
  for (const move of input.moves) {
    const change = requireValue(input.changes.get(move.id), "A plan move has no place change");
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

function planMoveEffects(
  entries: ReadonlyArray<TransactionPlanOrderMove>,
  facts: TransactionPlanTeamFacts,
  rule: RosterRule,
): ReadonlyMap<TransactionMoveId, PlanEffect> {
  const state: PlanState = {
    players: new Map(
      facts.roster.map((player) => [player.key, planMemberOf(player, rule)] as const),
    ),
  };
  const effects = new Map<TransactionMoveId, PlanEffect>();
  for (const entry of entries) {
    const effect = planEffectOf(entry.move, state, entry.placement, rule, facts);
    effects.set(entry.move.id, effect);
    applyPlanEffect(state, effect);
  }
  return effects;
}

function planMemberOf(player: TransactionPlanRosterPlayer, rule: RosterRule): PlanMember {
  return {
    key: player.key,
    name: player.name,
    positions: player.positions,
    injured: player.injured,
    editable: player.editable,
    slot: player.slot,
    area: planAreaOfSlot(rule, player.slot),
  };
}

function planAreaOfSlot(rule: RosterRule, slot: string | undefined): PlanArea {
  const declared = slot === undefined ? undefined : rule.byPosition.get(slot);
  if (declared === undefined) {
    return { kind: "unknown" };
  }
  return declared.kind === "reserve"
    ? { kind: "reserve", list: declared.position }
    : { kind: "active" };
}

function planEffectOf(
  move: TransactionPlanMove,
  state: PlanState,
  placement: StoredMovePlacement | undefined,
  rule: RosterRule,
  facts: TransactionPlanTeamFacts,
): PlanEffect {
  const transfers: Array<PlanTransfer> = [];

  for (const drop of move.drops) {
    const member = state.players.get(drop.key);
    transfers.push({
      key: drop.key,
      from: member?.area,
      to: undefined,
      member,
    });
  }

  const add = isAddKind(move.kind) && move.adds.length === 1 ? move.adds[0] : undefined;
  if (add !== undefined) {
    const pooled = facts.pool.get(add.key);
    const member: PlanMember = {
      key: add.key,
      name: pooled?.name ?? nameOf(add),
      positions: pooled?.positions ?? [],
      injured: false,
      editable: true,
      slot: undefined,
      area: { kind: "unknown" },
    };
    const target =
      (move.intent?.to ?? "active") === "reserve"
        ? reserveTarget(member, state, rule, placement)
        : activeTarget(placement);
    transfers.push({
      key: add.key,
      from: undefined,
      to: target.area,
      member: { ...member, slot: target.slot, area: target.area },
    });
  }

  if (move.kind === "activate" || move.kind === "stash") {
    const key = move.intent?.player?.key;
    const member = key === undefined ? undefined : state.players.get(key);
    if (key !== undefined && member !== undefined) {
      if (move.kind === "activate") {
        const target = activeTarget(placement);
        transfers.push({
          key,
          from: member.area,
          to: target.area,
          member: { ...member, slot: target.slot, area: target.area },
        });
      } else if (member.area.kind !== "reserve") {
        const target = reserveTarget(member, state, rule, placement);
        transfers.push({
          key,
          from: member.area,
          to: target.area,
          member: { ...member, slot: target.slot, area: target.area },
        });
      }
    }
  }

  if (move.kind === "slot_move" && move.slotMove !== undefined) {
    const declared = move.slotMove;
    const member = state.players.get(declared.playerKey);
    if (member !== undefined) {
      const target = planAreaOfSlot(rule, declared.toSlot);
      transfers.push({
        key: declared.playerKey,
        from: member.area,
        to: target,
        member: { ...member, slot: declared.toSlot, area: target },
      });
    }
  }

  if (move.kind === "trade") {
    for (const add of move.adds) {
      if (move.drops.some((drop) => drop.key === add.key)) {
        continue;
      }
      const member: PlanMember = {
        key: add.key,
        name: nameOf(add),
        positions: [],
        injured: false,
        editable: true,
        slot: undefined,
        area: { kind: "unknown" },
      };
      transfers.push({ key: add.key, from: undefined, to: member.area, member });
    }
  }

  return effectOf(transfers, move);
}

function activeTarget(placement: StoredMovePlacement | undefined): {
  readonly area: PlanArea;
  readonly slot: string | undefined;
} {
  return { area: { kind: "active" }, slot: placement?.toSlot };
}

function reserveTarget(
  member: PlanMember,
  state: PlanState,
  rule: RosterRule,
  placement: StoredMovePlacement | undefined,
): { readonly area: PlanArea; readonly slot: string | undefined } {
  const placed = placement?.toSlot;
  const declared =
    placed !== undefined && rule.byPosition.get(placed)?.kind === "reserve" ? placed : undefined;
  const list = declared ?? eligibleReserveList(member, state, rule);
  return list === undefined
    ? { area: { kind: "unknown" }, slot: placed }
    : { area: { kind: "reserve", list }, slot: list };
}

function eligibleReserveList(
  member: PlanMember,
  state: PlanState,
  rule: RosterRule,
): string | undefined {
  const eligible = rule.slots.filter(
    (slot) => slot.kind === "reserve" && slotPlacement(rule, slot.position, member).legal === true,
  );
  if (eligible.length === 0) {
    return undefined;
  }
  const open = eligible.find(
    (slot) => reserveOccupancy(state, slot.position, member.key) < slot.count,
  );
  return (open ?? eligible[0])?.position;
}

function reserveOccupancy(state: PlanState, list: string, excludeKey?: string): number {
  let occupants = 0;
  for (const [key, member] of state.players) {
    if (key !== excludeKey && member.area.kind === "reserve" && member.area.list === list) {
      occupants += 1;
    }
  }
  return occupants;
}

function effectOf(transfers: ReadonlyArray<PlanTransfer>, move: TransactionPlanMove): PlanEffect {
  let placesFreed = 0;
  let placesUsed = 0;
  const reserveFreed: Array<string> = [];
  const reserveUsed: Array<string> = [];
  for (const transfer of transfers) {
    if (transfer.from !== undefined) {
      if (transfer.from.kind === "reserve") {
        if (transfer.to?.kind !== "reserve" || transfer.to.list !== transfer.from.list) {
          reserveFreed.push(transfer.from.list);
        }
      } else {
        placesFreed += 1;
      }
    }
    if (transfer.to !== undefined) {
      if (transfer.to.kind === "reserve") {
        if (transfer.from?.kind !== "reserve" || transfer.from.list !== transfer.to.list) {
          reserveUsed.push(transfer.to.list);
        }
      } else {
        placesUsed += 1;
      }
    }
  }
  return {
    transfers,
    placesFreed,
    placesUsed,
    reserveFreed,
    reserveUsed,
    picks: move.picks.map((pick) => pickKey(pick.round, pick.sourceTeamKey)),
    budgetSpent: move.bid ?? 0,
  };
}

function applyPlanEffect(state: PlanState, effect: PlanEffect): void {
  for (const transfer of effect.transfers) {
    if (transfer.to === undefined) {
      state.players.delete(transfer.key);
    }
  }
  for (const transfer of effect.transfers) {
    if (transfer.to !== undefined && transfer.member !== undefined) {
      state.players.set(transfer.key, transfer.member);
    }
  }
}

function replayEffect(
  move: TransactionPlanMove,
  projection: TeamProjection,
  placement: StoredMovePlacement | undefined,
  rule: RosterRule,
  facts: TransactionPlanTeamFacts,
): PlanEffect {
  const state: PlanState = {
    players: new Map(
      [...projection.roster].map(([key, player]) => [key, planMemberOf(player, rule)] as const),
    ),
  };
  return planEffectOf(move, state, placement, rule, facts);
}

function moveEvaluation(
  step: ReplayStep,
  facts: TransactionPlanTeamFacts,
  checkedAt: DateTime.Utc,
  runPosition: number | undefined,
): TransactionPlanMoveEvaluation {
  const runDay = runDayOf(step.move, facts.today);
  const effectiveDate = effectiveDateFor(step.move, runDay, facts.timing);
  const runsOn = effectiveDate !== undefined && effectiveDate > runDay ? effectiveDate : runDay;
  const waitsForDate = effectiveDate !== undefined && effectiveDate > facts.today;
  return {
    move: step.move.id,
    group: step.move.group,
    claims: step.claims,
    validation: validationOf(step, checkedAt),
    placement: step.placement,
    runDay,
    effectiveDate,
    runsOn,
    dueToday: runDay === facts.today && isDueDecision(step.move.decision) && !waitsForDate,
    runPosition,
    dependsOn: step.dependsOn,
    projectedRoster: step.projectedRoster,
  };
}

function validationOf(step: ReplayStep, checkedAt: DateTime.Utc): StoredMoveValidation {
  if (step.illegal.length > 0) {
    return { status: "illegal", checkedAt, reasons: [...step.stale, ...step.illegal] };
  }
  return step.stale.length > 0
    ? { status: "stale", checkedAt, reasons: [...step.stale] }
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
        detail: `A group is checked whole. ${moveLabel(source)} cannot run: ${reason?.detail ?? "its check did not pass"}`,
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
    const dates = [
      ...new Set(
        movesInGroup.flatMap((move) =>
          move.effectiveDate === undefined ? [] : [move.effectiveDate],
        ),
      ),
    ];
    if (dates.length > 1) {
      return {
        group,
        moves: movesInGroup.map((move) => move.move),
        valid: false,
        detail: `A group applies on one date, and these moves apply on ${dates.join(", ")}.`,
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

function runDayOf(
  move: Pick<TransactionPlanMove, "runDay">,
  today: StoredMoveDate,
): StoredMoveDate {
  return move.runDay !== undefined && move.runDay > today ? move.runDay : today;
}

function effectiveDateFor(
  move: Pick<TransactionPlanMove, "kind" | "effectiveDate">,
  runDay: StoredMoveDate,
  timing: TransactionPlanTiming,
): StoredMoveDate | undefined {
  if (move.kind === "trade") {
    return undefined;
  }
  return move.effectiveDate ?? derivedEffectiveDate(runDay, timing);
}

function derivedEffectiveDate(
  runDay: StoredMoveDate,
  timing: TransactionPlanTiming,
): StoredMoveDate | undefined {
  switch (timing.rule) {
    case "same_day":
      return runDay;
    case "next_day":
      return nextDate(runDay);
    case "weekly_lock":
      return lockedPeriodDate(runDay, timing.periodStart);
    case undefined:
      return undefined;
  }
}

function lockedPeriodDate(
  runDay: StoredMoveDate,
  periodStart: StoredMoveDate | undefined,
): StoredMoveDate | undefined {
  if (periodStart === undefined) {
    return undefined;
  }
  const start = DateTime.makeUnsafe(`${periodStart}T00:00:00.000Z`);
  const day = DateTime.makeUnsafe(`${runDay}T00:00:00.000Z`);
  const days = Math.floor(
    (DateTime.toEpochMillis(day) - DateTime.toEpochMillis(start)) / 86_400_000,
  );
  return DateTime.formatIsoDate(
    DateTime.add(start, { days: Math.max(0, Math.floor(days / 7) * 7) }),
  );
}

function nextDate(date: StoredMoveDate): StoredMoveDate {
  return DateTime.formatIsoDate(
    DateTime.add(DateTime.makeUnsafe(`${date}T00:00:00.000Z`), { days: 1 }),
  );
}

function isDueDecision(decision: TransactionPlanMove["decision"]): boolean {
  return decision === "now" || decision === "confirmed";
}

function claimCandidates(
  move: TransactionPlanMove,
  placement: StoredMovePlacement | undefined,
  roster: ReadonlyMap<string, TransactionPlanRosterPlayer>,
  placeClaims: (place: string) => boolean,
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
    if (candidate.claim.kind === "place" && !placeClaims(candidate.claim.key)) {
      return false;
    }
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

function claimRefusalDetail(candidate: ClaimCandidate): string {
  return `${candidate.label} is already claimed in this plan by another move. Two open moves cannot claim the same ${claimSubject(candidate.claim.kind)}; discard or change one of them.`;
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

function comparePlanMoves(left: TransactionPlanMove, right: TransactionPlanMove): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function isAddKind(kind: TransactionPlanMove["kind"]): boolean {
  return kind === "free_agent_add" || kind === "waiver_claim";
}

function needsSlotWrite(move: TransactionPlanMove): boolean {
  switch (move.kind) {
    case "activate":
    case "stash":
    case "slot_move":
      return true;
    case "free_agent_add":
    case "waiver_claim":
      return move.intent?.to === "reserve";
    case "drop":
    case "trade":
      return false;
  }
}

function shownOnRoster(
  move: TransactionPlanMove,
  players: ReadonlyMap<string, TransactionPlanRosterPlayer>,
  rule: RosterRule,
): boolean {
  if (move.kind === "trade") {
    return true;
  }
  if (move.drops.some((drop) => !players.has(drop.key))) {
    return true;
  }
  if ([...move.adds, ...move.fallbacks].some((add) => players.has(add.key))) {
    return true;
  }
  const mover = moverKeyOf(move);
  if (mover !== undefined) {
    const player = players.get(mover);
    if (player === undefined) {
      return true;
    }
    const slot = player.slot === undefined ? undefined : rule.byPosition.get(player.slot);
    const onReserve = slot?.kind === "reserve";
    if (move.kind === "activate") {
      return slot !== undefined && !onReserve;
    }
    if (move.kind === "stash") {
      return onReserve;
    }
    return player.slot === move.slotMove?.toSlot;
  }
  return false;
}

function holdsClaimsWithoutEffect(result: TransactionPlanMove["result"]): boolean {
  return result === "failed" || result === "skipped" || result === "unknown";
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
      const fallbacks = move.fallbacks.map((fallback) => nameOf(fallback)).join(", ");
      const reserve =
        move.intent?.to === "reserve" && move.placement !== undefined
          ? ` to ${move.placement.toSlot}`
          : "";
      const fallback = fallbacks === "" ? "" : ` (fallback ${fallbacks})`;
      const bid =
        move.kind === "waiver_claim" && move.bid !== undefined
          ? ` for ${String(move.bid)} FAAB`
          : "";
      const base = `Add ${adds}${reserve}${fallback}${bid}`;
      return drops === "" ? base : `${base} and drop ${drops}`;
    }
    case "drop":
      return `Drop ${drops}`;
    case "trade":
      return "The trade";
    case "activate":
    case "stash": {
      const player = move.intent?.player;
      const label = `${move.kind === "activate" ? "Activate" : "Stash"} ${player === undefined ? "a player" : nameOf(player)}`;
      return drops === "" ? label : `${label}, drop ${drops}`;
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

type Reasons = {
  readonly stale: Array<StoredMoveValidationReason>;
  readonly illegal: Array<StoredMoveValidationReason>;
};

type ReplayStep = Reasons & {
  readonly move: TransactionPlanMove;
  readonly dependsOn: ReadonlyArray<TransactionMoveId>;
  claims: ReadonlyArray<StoredMoveClaim>;
  placement: StoredMovePlacement | undefined;
  applied: boolean;
  pending: boolean;
  projectedRoster: ReadonlyArray<TransactionPlanRosterPlayer>;
};

type TeamProjection = {
  readonly roster: Map<string, TransactionPlanRosterPlayer>;
  budget: number | undefined;
  readonly claims: Map<string, HeldClaim>;
  readonly removedBy: Map<string, TransactionMoveId>;
};

type HeldClaim = {
  readonly move: TransactionMoveId;
  readonly adds: boolean;
  readonly pending: boolean;
};
type ClaimCheck = {
  readonly refused: ReadonlyArray<StoredMoveValidationReason>;
  readonly waiting: { readonly move: TransactionMoveId; readonly label: string } | undefined;
};

type PlanGraph = {
  readonly dependencies: Map<TransactionMoveId, Set<TransactionMoveId>>;
  readonly fundedBy: Map<TransactionMoveId, TransactionMoveId>;
  readonly blocked: Map<TransactionMoveId, string>;
};

type PlanSequence = {
  readonly steps: ReadonlyArray<TransactionPlanOrderStep>;
  readonly blocked: ReadonlyArray<TransactionPlanOrderBlockage>;
};

type PlanArea =
  | { readonly kind: "active" }
  | { readonly kind: "reserve"; readonly list: string }
  | { readonly kind: "unknown" };

type PlanMember = {
  readonly key: string;
  readonly name: string;
  readonly positions: ReadonlyArray<string>;
  readonly injured: boolean;
  readonly editable: boolean;
  readonly slot: string | undefined;
  readonly area: PlanArea;
};

type PlanTransfer = {
  readonly key: string;
  readonly from: PlanArea | undefined;
  readonly to: PlanArea | undefined;
  readonly member: PlanMember | undefined;
};

type PlanEffect = {
  readonly transfers: ReadonlyArray<PlanTransfer>;
  readonly placesFreed: number;
  readonly placesUsed: number;
  readonly reserveFreed: ReadonlyArray<string>;
  readonly reserveUsed: ReadonlyArray<string>;
  readonly picks: ReadonlyArray<string>;
  readonly budgetSpent: number;
};

type PlanState = {
  readonly players: Map<string, PlanMember>;
};

type ReplayMoveInput = {
  readonly move: TransactionPlanMove;
  readonly projection: TeamProjection;
  readonly facts: TransactionPlanTeamFacts;
  readonly rule: RosterRule;
  readonly byId: ReadonlyMap<TransactionMoveId, TransactionPlanMove>;
  readonly dependencies: ReadonlyMap<TransactionMoveId, ReadonlySet<TransactionMoveId>>;
  readonly entries: ReadonlyArray<TransactionPlanOrderMove>;
  readonly steps: ReadonlyMap<TransactionMoveId, ReplayStep>;
  readonly blocked: boolean;
  readonly groupCures: ReadonlyMap<string, ReadonlySet<string>>;
};

type ClaimCandidate = {
  readonly claim: StoredMoveClaim;
  readonly label: string;
};

type PlacementIntent =
  | { readonly kind: "activate"; readonly player: { readonly key: string; readonly name: string } }
  | { readonly kind: "stash"; readonly player: { readonly key: string; readonly name: string } }
  | { readonly kind: "add"; readonly to: "active" | "reserve" };

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
  readonly periodStart: StoredMoveDate | undefined;
};

export type TransactionPlanSlotWrites =
  | { readonly status: "published" }
  | { readonly status: "not_published"; readonly detail: string };

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
  readonly slotWrites: TransactionPlanSlotWrites;
  readonly budget: number | undefined;
  readonly waiverBid: TransactionWaiverBid;
  readonly rosterSource: string;
  readonly leagueKey: string;
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
  | "placement"
  | "bid"
  | "runDay"
  | "effectiveDate"
  | "result"
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
  readonly runsOn: StoredMoveDate;
  readonly dueToday: boolean;
  readonly runPosition: number | undefined;
  readonly dependsOn: ReadonlyArray<TransactionMoveId>;
  readonly projectedRoster: ReadonlyArray<TransactionPlanRosterPlayer>;
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
  readonly placeClaims: (place: string) => boolean;
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
