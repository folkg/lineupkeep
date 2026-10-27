import { solveLineup } from "@lineupkeep/lineup-solver";
import type {
  LineupPlan,
  LineupProblem,
  LineupRefusal,
  RosterSlot,
  SelectionBasis,
} from "@lineupkeep/lineup-solver";

import { buildLineupProblem } from "./policy.ts";
import { valueSourceLadder } from "./source.ts";
import type {
  LineupPolicyInput,
  LineupPolicyRefusal,
  PlayerValuation,
  ValueSourceKind,
} from "./types.ts";

const lineupPlanRefusalCodes = {
  membership: "assignment:plan-membership",
  lockedPlayer: "assignment:locked-player",
  reserveSlot: "assignment:reserve-slot",
} as const;

export function planLineup(inputs: ReadonlyArray<LineupPolicyInput>): LineupPlanResult {
  const refusals: Array<LineupPlanRefusal> = [];
  for (const input of ordered(inputs)) {
    const source = input.source;
    if (source === undefined) {
      continue;
    }
    const verdict = buildLineupProblem(input);
    if (verdict.kind === "refusal") {
      refusals.push(policyRefusal(source.kind, verdict.refusal));
      continue;
    }
    const solved = solveLineup(verdict.problem);
    if (solved.kind === "refusal") {
      refusals.push(solverRefusal(source.kind, solved.refusal));
      continue;
    }
    return {
      kind: "planned",
      source: source.kind,
      basis: solved.plan.selectionBasis,
      plan: solved.plan,
      problem: verdict.problem,
      valuations: verdict.valuations,
    };
  }
  return { kind: "refused", refusals };
}

export function describeLineupRefusal(code: string, player: string): string {
  switch (code) {
    case "policy:no-value-source":
      return "This league publishes no value source the custom policy can use, so its lineup cannot be valued.";
    case "policy:no-observed-periods":
      return "No completed scoring period is available to value the roster, so the custom policy cannot plan a lineup.";
    case "solver:unusable-selection-value":
      return "Some roster players have no usable selection value, so a complete lineup cannot be planned.";
    case "solver:lock-references-unknown-slot":
      return "A locked player occupies a slot this league does not declare, so the lineup cannot be planned.";
    case "solver:locked-player-ineligible-for-slot":
      return "A locked player is not eligible for the slot they occupy, so the lineup cannot be planned.";
    case "solver:lock-capacity-exceeded":
      return "Locked players exceed a slot's declared capacity, so the lineup cannot be planned.";
    case "solver:roster-exceeds-slot-capacity":
      return "The roster has more players than the league's declared slots, so the lineup cannot be planned without dropping a player.";
    case "solver:player-has-no-legal-slot":
      return "Some roster players have no legal slot, so the lineup cannot be planned.";
    case "solver:required-starting-position-unfillable":
      return "A required starting position cannot be filled from the current roster.";
    case "solver:no-legal-assignment":
      return "No complete legal assignment of this roster exists.";
    case lineupPlanRefusalCodes.membership:
      return "The plan does not cover every roster member, so no lineup change was made. Refresh the team and run again.";
    case lineupPlanRefusalCodes.lockedPlayer:
      return `The plan moves ${namedPlayer(player)}, but the provider reports that player as locked. No lineup change was made. Refresh the team and run again after the lock clears.`;
    case lineupPlanRefusalCodes.reserveSlot:
      return `The plan moves ${namedPlayer(player)} through a reserve slot, which this operation does not write. No lineup change was made. Move the player out of the reserve list on the provider, or leave the lineup unchanged.`;
    default:
      return "The lineup cannot be planned from the available facts.";
  }
}

export function lineupAssignments(facts: LineupAssignmentFacts): LineupAssignmentResult {
  const playersByKey = new Map(facts.players.map((player) => [player.playerKey, player]));
  const slotKinds = new Map(facts.slots.map((slot) => [slot.id, slot.kind]));
  const plannedSlots = new Map(
    facts.plan.assignments.map((assignment) => [
      String(assignment.playerId),
      String(assignment.slotId),
    ]),
  );
  if (
    facts.players.some((player) => !plannedSlots.has(player.playerKey)) ||
    facts.plan.assignments.some((assignment) => !playersByKey.has(assignment.playerId))
  ) {
    return refusal(lineupPlanRefusalCodes.membership, undefined);
  }

  const assignments: Array<{ readonly playerKey: string; readonly slot: string }> = [];
  for (const player of facts.players) {
    const targetSlot = plannedSlots.get(player.playerKey);
    if (targetSlot === undefined || targetSlot === player.slot) {
      continue;
    }
    if (!player.editable) {
      return refusal(lineupPlanRefusalCodes.lockedPlayer, player);
    }
    if (slotKinds.get(player.slot) === "reserve" || slotKinds.get(targetSlot) === "reserve") {
      return refusal(lineupPlanRefusalCodes.reserveSlot, player);
    }
    assignments.push({ playerKey: player.playerKey, slot: targetSlot });
  }
  return { kind: "request", assignments };
}

function ordered(inputs: ReadonlyArray<LineupPolicyInput>): ReadonlyArray<LineupPolicyInput> {
  return [...inputs].sort((left, right) => rank(left) - rank(right));
}

function rank(input: LineupPolicyInput): number {
  const index = input.source === undefined ? -1 : valueSourceLadder.indexOf(input.source.kind);
  return index === -1 ? valueSourceLadder.length : index;
}

function policyRefusal(source: ValueSourceKind, refusal: LineupPolicyRefusal): LineupPlanRefusal {
  return describedRefusal(source, `policy:${refusal.kind}`);
}

function solverRefusal(source: ValueSourceKind, refusal: LineupRefusal): LineupPlanRefusal {
  return describedRefusal(source, `solver:${refusal.reason}`);
}

function describedRefusal(source: ValueSourceKind, code: string): LineupPlanRefusal {
  return { source, code, detail: describeLineupRefusal(code, "") };
}

function refusal(
  code: string,
  player: LineupAssignmentFacts["players"][number] | undefined,
): LineupAssignmentResult {
  return {
    kind: "refused",
    code,
    detail: describeLineupRefusal(code, player === undefined ? "" : player.name),
  };
}

function namedPlayer(name: string): string {
  return name === "" ? "a roster player" : name;
}

export type LineupAssignmentFacts = {
  readonly plan: LineupPlan;
  readonly slots: ReadonlyArray<{ readonly id: string; readonly kind: RosterSlot["kind"] }>;
  readonly players: ReadonlyArray<{
    readonly playerKey: string;
    readonly name: string;
    readonly slot: string;
    readonly editable: boolean;
  }>;
};

export type LineupAssignmentResult =
  | {
      readonly kind: "request";
      readonly assignments: ReadonlyArray<{ readonly playerKey: string; readonly slot: string }>;
    }
  | { readonly kind: "refused"; readonly code: string; readonly detail: string };

export type LineupPlanRefusal = {
  readonly source: ValueSourceKind;
  readonly code: string;
  readonly detail: string;
};

export type LineupPlanResult =
  | {
      readonly kind: "planned";
      readonly source: ValueSourceKind;
      readonly basis: SelectionBasis;
      readonly plan: LineupPlan;
      readonly problem: LineupProblem;
      readonly valuations: ReadonlyArray<PlayerValuation>;
    }
  | { readonly kind: "refused"; readonly refusals: ReadonlyArray<LineupPlanRefusal> };
