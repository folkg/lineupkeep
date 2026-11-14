import { assert, it } from "@effect/vitest";
import { DateTime, Schema } from "effect";

import {
  claimTransactionPlanMoves,
  evaluateTransactionPlan,
  orderTransactionPlanMoves,
} from "./TransactionPlanEvaluation.ts";
import type {
  TransactionPlanClaimInput,
  TransactionPlanClaimRefusal,
  TransactionPlanClaims,
  TransactionPlanConstraints,
  TransactionPlanEvaluation,
  TransactionPlanEvaluationInput,
  TransactionPlanGroupEvaluation,
  TransactionPlanMove,
  TransactionPlanMoveClaims,
  TransactionPlanMoveEvaluation,
  TransactionPlanOrder,
  TransactionPlanOrderBlockage,
  TransactionPlanOrderInput,
  TransactionPlanOrderMove,
  TransactionPlanOrderStep,
  TransactionPlanPoolPlayer,
  TransactionPlanRosterPlayer,
  TransactionPlanSlot,
  TransactionPlanTeamFacts,
  TransactionPlanTiming,
} from "./TransactionPlanEvaluation.ts";
import type {
  StoredMovePick,
  StoredMovePlayer,
  StoredMoveSlot,
  TransactionMoveId,
} from "./TransactionPlanRecord.ts";
import { TransactionMoveId as TransactionMoveIdSchema } from "./TransactionPlanRecord.ts";

const checkedAt = DateTime.makeUnsafe("2026-11-10T18:00:00.000Z");
const idAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const idsByLabel = new Map<string, TransactionMoveId>();

it("refuses the second of two drops for one player", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [bench("BN", 2)],
      constraints: constraints(2),
      roster: [rostered("p1", "Roster One", "BN"), rostered("p2", "Roster Two", "BN")],
    }),
    moves: [
      move("drop-one", { kind: "drop", drops: [player("p1", "Roster One")] }),
      move("drop-two", { kind: "drop", drops: [player("p1", "Roster One")] }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "current");
  assert.deepStrictEqual(evaluation.moves[0]?.claims, [{ kind: "player", key: "p1" }]);
  assert.strictEqual(evaluation.moves[1]?.validation.status, "stale");
  assert.deepStrictEqual(
    evaluation.moves[1]?.validation.reasons.map((reason) => [reason.code, reason.detail]),
    [
      [
        "player_claimed",
        "Roster One is already claimed in this plan by another move. Two open moves cannot claim the same player; discard or change one of them.",
      ],
    ],
  );
  assert.deepStrictEqual(
    evaluation.order.steps.map((step) => step.move),
    [moveId("drop-one")],
  );
});

it("refuses the second of two adds for one free agent", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [bench("BN", 2)],
      constraints: constraints(2),
      roster: [rostered("p1", "Roster One", "BN")],
      pool: [freeAgent("fa1", "Free Agent", ["WR"])],
    }),
    moves: [
      move("add-one", {
        kind: "free_agent_add",
        adds: [player("fa1", "Free Agent")],
        group: "pair",
      }),
      move("add-two", {
        kind: "free_agent_add",
        adds: [player("fa1", "Free Agent")],
        group: "pair",
      }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "current");
  assert.strictEqual(evaluation.moves[0]?.placement?.toSlot, "BN");
  assert.strictEqual(evaluation.moves[1]?.validation.status, "stale");
  assert.deepStrictEqual(
    evaluation.moves[1]?.validation.reasons.map((reason) => reason.code),
    ["player_claimed"],
  );
  assert.deepStrictEqual(
    evaluation.order.steps.map((step) => step.move),
    [moveId("add-one")],
  );
  assert.deepStrictEqual(
    evaluation.groups.map((group) => [group.group, group.valid]),
    [["pair", false]],
  );
  assert.include(evaluation.groups[0]?.detail ?? "", "Add Free Agent cannot run:");
});

it("refuses a bid the team cannot cover", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [bench("BN", 2)],
      constraints: constraints(2),
      roster: [],
      pool: [waived("w1", "Waiver One", ["WR"]), waived("w2", "Waiver Two", ["WR"])],
      budget: 10,
    }),
    moves: [
      move("affordable", {
        kind: "waiver_claim",
        adds: [player("w1", "Waiver One")],
        bid: 10,
      }),
      move("over-budget", {
        kind: "waiver_claim",
        adds: [player("w2", "Waiver Two")],
        bid: 11,
      }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "current");
  assert.strictEqual(evaluation.moves[1]?.validation.status, "stale");
  assert.deepStrictEqual(
    evaluation.moves[1]?.validation.reasons.map((reason) => [reason.code, reason.detail]),
    [["bid_exceeds_budget", "A bid of 11 is more than the 10 FAAB this team has left."]],
  );
});

it("refuses two moves for the same reserve place", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [starting("RB", ["RB"]), bench("BN", 1), reserve("IR", ["RB"])],
      constraints: constraints(2),
      roster: [
        rostered("p1", "Starting Runner", "RB", ["RB"]),
        rostered("p2", "Bench Runner", "BN", ["RB"]),
      ],
    }),
    moves: [
      move("move-one", {
        kind: "slot_move",
        slotMove: slotMove("p1", "Starting Runner", "IR"),
      }),
      move("move-two", {
        kind: "slot_move",
        slotMove: slotMove("p2", "Bench Runner", "IR"),
      }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "current");
  assert.deepStrictEqual(evaluation.moves[0]?.claims, [
    { kind: "place", key: "IR" },
    { kind: "place", key: "RB" },
  ]);
  assert.strictEqual(evaluation.moves[1]?.validation.status, "stale");
  assert.deepStrictEqual(
    evaluation.moves[1]?.validation.reasons.map((reason) => reason.code),
    ["place_claimed"],
  );
  assert.include(evaluation.moves[1]?.validation.reasons[0]?.detail ?? "", "IR place");
  assert.deepStrictEqual(
    evaluation.order.steps.map((step) => step.move),
    [moveId("move-one")],
  );
});

it("refuses a slot move to a place that does not accept the player", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [starting("QB", ["QB"]), starting("RB", ["RB"]), bench("BN", 1)],
      constraints: constraints(3),
      roster: [
        rostered("p1", "Roster Quarterback", "QB", ["QB"]),
        rostered("p2", "Roster Runner", "RB", ["RB"]),
        rostered("p3", "Roster Bench", "BN", ["RB"]),
      ],
    }),
    moves: [
      move("move-runner", {
        kind: "slot_move",
        slotMove: slotMove("p2", "Roster Runner", "QB"),
      }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "illegal");
  assert.deepStrictEqual(
    evaluation.moves[0]?.validation.reasons.map((reason) => [reason.code, reason.detail]),
    [["slot_illegal", "Roster Runner cannot move to QB: it does not accept their positions (RB)."]],
  );
  assert.deepStrictEqual(evaluation.order.steps, []);
});

it("marks a roster with a healthy player in an injury reserve place illegal", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [starting("RB", ["RB"]), bench("BN", 1), reserve("IR", ["RB"])],
      constraints: constraints(2, { reserveEligibility: { kind: "injury_status" } }),
      roster: [
        rostered("p1", "Roster Runner", "RB", ["RB"]),
        rostered("p2", "Bench Runner", "BN", ["RB"]),
        rostered("h1", "Healthy Reserve", "IR", ["RB"]),
      ],
    }),
    moves: [
      move("drop-runner", { kind: "drop", drops: [player("p1", "Roster Runner")] }),
      move("drop-healthy", { kind: "drop", drops: [player("h1", "Healthy Reserve")] }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "illegal");
  assert.deepStrictEqual(
    evaluation.moves[0]?.validation.reasons.map((reason) => [reason.code, reason.playerKey]),
    [["slot_illegal", "h1"]],
  );
  assert.include(
    evaluation.moves[0]?.validation.reasons[0]?.detail ?? "",
    "Healthy Reserve is no longer injured but sits in IR.",
  );
  assert.strictEqual(evaluation.moves[1]?.validation.status, "current");
  assert.deepStrictEqual(
    evaluation.order.steps.map((step) => step.move),
    [moveId("drop-healthy")],
  );
});

it("refuses a healthy player in an injury-based reserve place", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [starting("RB", ["RB"]), bench("BN", 1), reserve("IR", ["RB"])],
      constraints: constraints(2, { reserveEligibility: { kind: "injury_status" } }),
      roster: [
        rostered("h1", "Healthy Runner", "RB", ["RB"]),
        rostered("b1", "Bench Runner", "BN", ["RB"]),
      ],
    }),
    moves: [
      move("stash-healthy", {
        kind: "stash",
        intent: { kind: "stash", player: player("h1", "Healthy Runner") },
      }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "stale");
  assert.deepStrictEqual(
    evaluation.moves[0]?.validation.reasons.map((reason) => [reason.code, reason.detail]),
    [
      [
        "reserve_unavailable",
        "Healthy Runner cannot sit on a reserve list: the league's reserve lists only accept an injured player, and Healthy Runner is not injured.",
      ],
    ],
  );
  assert.deepStrictEqual(evaluation.order.steps, []);
});

it("rechecks a saved move whose day arrived as due today and stale", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [bench("BN", 1)],
      constraints: constraints(1),
      roster: [rostered("p1", "Roster One", "BN")],
      today: "2026-11-10",
      timing: { rule: "same_day", currentDate: "2026-11-10" },
    }),
    moves: [
      move("saved-drop", {
        kind: "drop",
        drops: [player("gone", "Gone Player")],
        decision: "saved",
        runDay: "2026-11-09",
      }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.runDay, "2026-11-10");
  assert.strictEqual(evaluation.moves[0]?.effectiveDate, "2026-11-10");
  assert.strictEqual(evaluation.moves[0]?.dueToday, true);
  assert.strictEqual(evaluation.moves[0]?.validation.status, "stale");
  assert.deepStrictEqual(
    evaluation.moves[0]?.validation.reasons.map((reason) => reason.code),
    ["drop_not_rostered"],
  );
});

it("orders an add after the drop that funds it", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [starting("RB", ["RB"]), bench("BN", 2)],
      constraints: constraints(3),
      roster: [
        rostered("r1", "Starting Runner", "RB", ["RB"]),
        rostered("b1", "Bench One", "BN", ["WR"]),
        rostered("b2", "Bench Two", "BN", ["WR"]),
      ],
      pool: [freeAgent("fa1", "Free Agent", ["WR"])],
    }),
    moves: [
      move("add-free-agent", { kind: "free_agent_add", adds: [player("fa1", "Free Agent")] }),
      move("drop-bench-two", { kind: "drop", drops: [player("b2", "Bench Two")] }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "current");
  assert.strictEqual(evaluation.moves[0]?.placement?.toSlot, "BN");
  assert.deepStrictEqual(
    evaluation.order.steps.map((step) => [step.move, step.position, step.fundedBy, step.dependsOn]),
    [
      [moveId("drop-bench-two"), 0, undefined, []],
      [moveId("add-free-agent"), 1, moveId("drop-bench-two"), [moveId("drop-bench-two")]],
    ],
  );
  assert.strictEqual(evaluation.moves[0]?.runPosition, 1);
});

it("orders a reserve add after the activate that frees its place", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [starting("RB", ["RB"]), bench("BN", 1), reserve("IR", ["RB"])],
      constraints: constraints(2),
      roster: [
        rostered("r1", "Reserve Runner", "IR", ["RB"]),
        rostered("b1", "Bench One", "BN", ["RB"]),
      ],
      pool: [freeAgent("fa2", "Second Free Agent", ["RB"])],
    }),
    moves: [
      move("add-reserve", {
        kind: "free_agent_add",
        adds: [player("fa2", "Second Free Agent")],
        intent: { kind: "add", to: "reserve" },
      }),
      move("activate-runner", {
        kind: "activate",
        intent: { kind: "activate", player: player("r1", "Reserve Runner") },
      }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "current");
  assert.strictEqual(evaluation.moves[0]?.placement?.toSlot, "IR");
  assert.strictEqual(evaluation.moves[1]?.validation.status, "current");
  assert.deepStrictEqual(
    evaluation.order.steps.map((step) => [step.move, step.fundedBy, step.dependsOn]),
    [
      [moveId("activate-runner"), undefined, []],
      [moveId("add-reserve"), undefined, [moveId("activate-runner")]],
    ],
  );
});

it("orders a valid mixed plan", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [
        starting("QB", ["QB"]),
        starting("RB", ["RB"]),
        bench("BN", 3),
        reserve("IR", ["RB"]),
      ],
      constraints: constraints(5),
      roster: [
        rostered("qb1", "Roster Quarterback", "QB", ["QB"]),
        rostered("rb1", "Roster Runner", "RB", ["RB"]),
        rostered("b1", "Bench One", "BN", ["WR"]),
        rostered("b2", "Bench Two", "BN", ["WR"]),
        rostered("b3", "Bench Three", "BN", ["QB"]),
      ],
      pool: [freeAgent("fa1", "Free Agent", ["WR"])],
    }),
    moves: [
      move("drop-quarterback", {
        kind: "drop",
        drops: [player("qb1", "Roster Quarterback")],
        group: "swap",
      }),
      move("move-bench-three", {
        kind: "slot_move",
        slotMove: slotMove("b3", "Bench Three", "QB"),
        group: "swap",
      }),
      move("stash-runner", {
        kind: "stash",
        intent: { kind: "stash", player: player("rb1", "Roster Runner") },
      }),
      move("add-free-agent", {
        kind: "free_agent_add",
        adds: [player("fa1", "Free Agent")],
        group: "swap",
      }),
    ],
  });

  const moves: ReadonlyArray<TransactionPlanMoveEvaluation> = evaluation.moves;
  const groups: ReadonlyArray<TransactionPlanGroupEvaluation> = evaluation.groups;
  assert.deepStrictEqual(
    moves.map((entry) => [entry.move, entry.validation.status, entry.runPosition]),
    [
      [moveId("drop-quarterback"), "current", 0],
      [moveId("move-bench-three"), "current", 1],
      [moveId("stash-runner"), "current", 2],
      [moveId("add-free-agent"), "current", 3],
    ],
  );
  assert.deepStrictEqual(
    evaluation.order.steps.map((step) => step.move),
    [
      moveId("drop-quarterback"),
      moveId("move-bench-three"),
      moveId("stash-runner"),
      moveId("add-free-agent"),
    ],
  );
  assert.deepStrictEqual(
    groups.map((group) => [group.group, group.moves, group.valid]),
    [
      [
        "swap",
        [moveId("drop-quarterback"), moveId("move-bench-three"), moveId("add-free-agent")],
        true,
      ],
      [undefined, [moveId("stash-runner")], true],
    ],
  );
});

it("claims a trade's outgoing players and picks but not its incoming player", () => {
  const input: TransactionPlanClaimInput = {
    moves: [
      positioned("trade", 0, {
        kind: "trade",
        drops: [player("outgoing", "Outgoing Player")],
        adds: [player("incoming", "Incoming Player")],
        picks: [pick(2)],
      }),
    ],
    placements: new Map(),
    roster: new Map([["outgoing", rostered("outgoing", "Outgoing Player", "BN")]]),
  };

  const claims: TransactionPlanClaims = claimTransactionPlanMoves(input);
  const entry: TransactionPlanMoveClaims | undefined = claims.moves[0];

  assert.deepStrictEqual(entry?.claims, [
    { kind: "draft_pick", key: "2:team-one" },
    { kind: "player", key: "outgoing" },
  ]);
});

it("refuses a second claim and names the move that holds it", () => {
  const claims: TransactionPlanClaims = claimTransactionPlanMoves({
    moves: [
      positioned("first-drop", 0, {
        kind: "drop",
        drops: [player("p1", "Roster One")],
      }),
      positioned("second-drop", 1, {
        kind: "drop",
        drops: [player("p1", "Roster One")],
      }),
    ],
    placements: new Map(),
    roster: new Map([["p1", rostered("p1", "Roster One", "BN")]]),
  });
  const refusal: TransactionPlanClaimRefusal | undefined = claims.refused[0];

  assert.strictEqual(refusal?.move, moveId("second-drop"));
  assert.strictEqual(refusal?.heldBy, moveId("first-drop"));
  assert.strictEqual(refusal?.code, "player_claimed");
});

it("excludes a move that did not pass its check from the run order", () => {
  const input: TransactionPlanOrderInput = {
    facts: facts({
      slots: [bench("BN", 2)],
      constraints: constraints(2),
      roster: [rostered("p1", "Roster One", "BN"), rostered("p2", "Roster Two", "BN")],
    }),
    moves: [
      {
        move: positioned("ordered-drop", 0, {
          kind: "drop",
          drops: [player("p1", "Roster One")],
        }),
        placement: undefined,
        runnable: true,
      },
      {
        move: positioned("excluded-drop", 1, {
          kind: "drop",
          drops: [player("p2", "Roster Two")],
        }),
        placement: undefined,
        runnable: false,
      },
    ] satisfies ReadonlyArray<TransactionPlanOrderMove>,
  };

  const order: TransactionPlanOrder = orderTransactionPlanMoves(input);
  const steps: ReadonlyArray<TransactionPlanOrderStep> = order.steps;

  assert.deepStrictEqual(
    steps.map((step) => step.move),
    [moveId("ordered-drop")],
  );
  assert.deepStrictEqual(order.excluded, [moveId("excluded-drop")]);
});

it("blocks a move that needs a roster place no plan move frees", () => {
  const order: TransactionPlanOrder = orderTransactionPlanMoves({
    facts: facts({
      slots: [bench("BN", 1)],
      constraints: constraints(1),
      roster: [rostered("p1", "Roster One", "BN")],
      pool: [freeAgent("fa1", "Free Agent", ["WR"])],
    }),
    moves: [
      {
        move: positioned("add-free-agent", 0, {
          kind: "free_agent_add",
          adds: [player("fa1", "Free Agent")],
        }),
        placement: {
          playerKey: "fa1",
          playerName: "Free Agent",
          toSlot: "BN",
          detail: "Free Agent goes to BN on the bench.",
        },
        runnable: true,
      },
    ],
  });
  const blockage: TransactionPlanOrderBlockage | undefined = order.blocked[0];

  assert.strictEqual(blockage?.move, moveId("add-free-agent"));
  assert.include(blockage?.detail ?? "", "needs a roster place");
  assert.deepStrictEqual(order.steps, []);
});

it("refuses a second trade for the same draft pick", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [bench("BN", 2)],
      constraints: constraints(2),
      roster: [rostered("p1", "Roster One", "BN"), rostered("p2", "Roster Two", "BN")],
    }),
    moves: [
      move("trade-one", {
        kind: "trade",
        drops: [player("p1", "Roster One")],
        picks: [pick(2)],
      }),
      move("trade-two", {
        kind: "trade",
        drops: [player("p2", "Roster Two")],
        picks: [pick(2)],
      }),
    ],
  });

  assert.strictEqual(evaluation.moves[0]?.validation.status, "current");
  assert.deepStrictEqual(evaluation.moves[0]?.claims, [
    { kind: "draft_pick", key: "2:team-one" },
    { kind: "player", key: "p1" },
  ]);
  assert.strictEqual(evaluation.moves[1]?.validation.status, "stale");
  assert.deepStrictEqual(
    evaluation.moves[1]?.validation.reasons.map((reason) => [reason.code, reason.detail]),
    [
      [
        "pick_claimed",
        "The round 2 pick from My Team is already claimed in this plan by another move. Two open moves cannot claim the same draft pick; discard or change one of them.",
      ],
    ],
  );
});

it("applies a same-day move on its run day", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [bench("BN", 2)],
      constraints: constraints(2),
      roster: [rostered("p1", "Roster One", "BN"), rostered("p2", "Roster Two", "BN")],
      today: "2026-11-10",
      timing: { rule: "same_day", currentDate: "2026-11-10" },
    }),
    moves: [
      move("today", { kind: "drop", drops: [player("p1", "Roster One")], decision: "saved" }),
      move("later", {
        kind: "drop",
        drops: [player("p2", "Roster Two")],
        decision: "saved",
        runDay: "2026-11-12",
      }),
    ],
  });

  assert.deepStrictEqual(
    evaluation.moves.map((entry) => [entry.runDay, entry.effectiveDate, entry.dueToday]),
    [
      ["2026-11-10", "2026-11-10", true],
      ["2026-11-12", "2026-11-12", false],
    ],
  );
});

it("applies a next-day move on the day after its run day", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [bench("BN", 2)],
      constraints: constraints(2),
      roster: [rostered("p1", "Roster One", "BN"), rostered("p2", "Roster Two", "BN")],
      today: "2026-11-10",
      timing: { rule: "next_day", currentDate: "2026-11-10" },
    }),
    moves: [
      move("today", { kind: "drop", drops: [player("p1", "Roster One")], decision: "saved" }),
      move("later", {
        kind: "drop",
        drops: [player("p2", "Roster Two")],
        decision: "saved",
        runDay: "2026-11-12",
      }),
    ],
  });

  assert.deepStrictEqual(
    evaluation.moves.map((entry) => [entry.runDay, entry.effectiveDate, entry.dueToday]),
    [
      ["2026-11-10", "2026-11-11", true],
      ["2026-11-12", "2026-11-13", false],
    ],
  );
});

it("applies a weekly-lock move on the league's published locked date", () => {
  const evaluation = evaluate({
    facts: facts({
      slots: [bench("BN", 2)],
      constraints: constraints(2),
      roster: [rostered("p1", "Roster One", "BN"), rostered("p2", "Roster Two", "BN")],
      today: "2026-11-10",
      timing: { rule: "weekly_lock", currentDate: "2026-11-11" },
    }),
    moves: [
      move("today", { kind: "drop", drops: [player("p1", "Roster One")], decision: "saved" }),
      move("later", {
        kind: "drop",
        drops: [player("p2", "Roster Two")],
        decision: "saved",
        runDay: "2026-11-12",
      }),
    ],
  });

  assert.deepStrictEqual(
    evaluation.moves.map((entry) => [entry.runDay, entry.effectiveDate, entry.dueToday]),
    [
      ["2026-11-10", "2026-11-11", true],
      ["2026-11-12", "2026-11-11", false],
    ],
  );
});

function evaluate(plan: {
  readonly facts: TransactionPlanTeamFacts;
  readonly moves: ReadonlyArray<Omit<TransactionPlanMove, "position">>;
}): TransactionPlanEvaluation {
  const input: TransactionPlanEvaluationInput = {
    facts: plan.facts,
    moves: plan.moves.map((move, position) => ({ ...move, position })),
    checkedAt,
  };
  return evaluateTransactionPlan(input);
}

function positioned(
  label: string,
  position: number,
  fields: Omit<Partial<TransactionPlanMove>, "id" | "position" | "kind"> &
    Pick<TransactionPlanMove, "kind">,
): TransactionPlanMove {
  return { ...move(label, fields), position };
}

function facts(input: {
  readonly slots: TransactionPlanTeamFacts["slots"];
  readonly constraints: TransactionPlanConstraints;
  readonly roster: TransactionPlanTeamFacts["roster"];
  readonly pool?: ReadonlyArray<TransactionPlanPoolPlayer>;
  readonly today?: string;
  readonly timing?: TransactionPlanTiming;
  readonly budget?: number;
}): TransactionPlanTeamFacts {
  return {
    roster: input.roster,
    pool: new Map((input.pool ?? []).map((player) => [player.key, player] as const)),
    slots: input.slots,
    constraints: input.constraints,
    today: input.today ?? "2026-11-10",
    timing: input.timing ?? { rule: "same_day", currentDate: input.today ?? "2026-11-10" },
    budget: input.budget,
  };
}

function constraints(
  rosterMaximum: number,
  overrides: Partial<TransactionPlanConstraints> = {},
): TransactionPlanConstraints {
  return {
    rosterMaximum,
    benchCapacity: "per_slot",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
    ...overrides,
  };
}

function starting(position: string, eligibility: ReadonlyArray<string> = []): TransactionPlanSlot {
  return { position, kind: "starting", count: 1, eligibility };
}

function bench(position: string, count: number): TransactionPlanSlot {
  return { position, kind: "bench", count, eligibility: [] };
}

function reserve(position: string, eligibility: ReadonlyArray<string> = []): TransactionPlanSlot {
  return { position, kind: "reserve", count: 1, eligibility };
}

function rostered(
  key: string,
  name: string,
  slot: string,
  positions: ReadonlyArray<string> = [],
  injured = false,
): TransactionPlanRosterPlayer {
  return { key, name, positions, slot, injured, editable: true };
}

function freeAgent(
  key: string,
  name: string,
  positions: ReadonlyArray<string>,
): TransactionPlanPoolPlayer {
  return { key, name, positions, availability: "free_agent" };
}

function waived(
  key: string,
  name: string,
  positions: ReadonlyArray<string>,
): TransactionPlanPoolPlayer {
  return { key, name, positions, availability: "waiver" };
}

function move(
  id: string,
  fields: Omit<Partial<TransactionPlanMove>, "id" | "position" | "kind"> &
    Pick<TransactionPlanMove, "kind">,
): Omit<TransactionPlanMove, "position"> {
  return {
    id: moveId(id),
    group: undefined,
    adds: [],
    fallbacks: [],
    drops: [],
    picks: [],
    slotMove: undefined,
    intent: undefined,
    bid: undefined,
    runDay: undefined,
    decision: "undecided",
    ...fields,
  };
}

function moveId(label: string): TransactionMoveId {
  const existing = idsByLabel.get(label);
  if (existing !== undefined) {
    return existing;
  }
  const code = idAlphabet[idsByLabel.size];
  if (code === undefined) {
    throw new Error("This test declared more moves than the identifier alphabet allows");
  }
  const id = Schema.decodeSync(TransactionMoveIdSchema)(`01ARZ3NDEKTSV4RRFFQ69G5FA${code}`);
  idsByLabel.set(label, id);
  return id;
}

function player(key: string, name: string): StoredMovePlayer {
  return { key, name };
}

function slotMove(playerKey: string, playerName: string, toSlot: string): StoredMoveSlot {
  return { playerKey, playerName, toSlot };
}

function pick(round: number): StoredMovePick {
  return {
    round,
    sourceTeamKey: "team-one",
    destinationTeamKey: "team-two",
    sourceName: "My Team",
    destinationName: "Their Team",
  };
}
