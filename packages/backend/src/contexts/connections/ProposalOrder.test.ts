import { assert, it } from "@effect/vitest";

import { planProposalOrder } from "./ProposalOrder.ts";
import type {
  ProposalOrderInput,
  ProposalOrderItem,
  ProposalOrderPlayer,
} from "./ProposalOrder.ts";
import { ineligibleSlotOccupants } from "./RosterSlots.ts";

type Slot = ProposalOrderInput["slots"][number];
type PlayerRef = ProposalOrderInput["items"][number]["adds"][number];

it("orders a drop before a move into the slot that drop frees", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "BN", ["C"]),
      player("p2", "Roster Two", "IR", ["C", "IR"]),
      player("p3", "Roster Three", "C", ["C"]),
    ],
    timing: skate,
    items: [
      move("move-two-to-bench", ref("p2", "Roster Two"), "BN"),
      drop("drop-one", ref("p1", "Roster One")),
    ],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["drop-one", "move-two-to-bench"],
    );
    assert.strictEqual(decision.timing, "same_day");
    assert.strictEqual(decision.effectiveDate, "2026-10-31");
  }
});

it("names the move and the drop when the drop frees a different slot", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "C", ["C"]),
      player("p2", "Roster Two", "BN", ["C"]),
      player("p3", "Roster Three", "IR", ["C", "IR"]),
    ],
    timing: skate,
    items: [
      move("move-three-to-bench", ref("p3", "Roster Three"), "BN"),
      drop("drop-one", ref("p1", "Roster One")),
    ],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.deepStrictEqual(
      decision.conflicts.map((conflict) => conflict.items),
      [["move-three-to-bench", "drop-one"]],
    );
    const detail = decision.conflicts[0]?.detail ?? "";
    assert.include(detail, "Roster Three");
    assert.include(detail, "BN");
    assert.include(detail, "Roster One");
    assert.include(detail, "C");
    assert.include(detail, "cannot both be legal on 2026-10-31");
  }
});

it("refuses a locked player's move on the league's effective date", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [player("p1", "Roster One", "BN", ["C", "IR"], false)],
    timing: skate,
    items: [move("move-one-to-reserve", ref("p1", "Roster One"), "IR")],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    const detail = decision.conflicts[0]?.detail ?? "";
    assert.include(detail, "Roster One is locked");
    assert.include(detail, "2026-10-31");
    assert.include(detail, "IR");
  }
});

it("computes a next-day league against the day after the provider's current date", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [player("p1", "Roster One", "BN", ["C", "IR"], false)],
    timing: { rule: "next_day", currentDate: "2026-10-31" },
    items: [move("move-one-to-reserve", ref("p1", "Roster One"), "IR")],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.strictEqual(decision.timing, "next_day");
    assert.strictEqual(decision.effectiveDate, "2026-11-01");
    assert.include(decision.conflicts[0]?.detail ?? "", "2026-11-01");
  }
});

it("names the scoring week when a weekly-locking league publishes no date", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [player("p1", "Roster One", "BN", ["C", "IR"], false)],
    timing: { rule: "weekly_lock", currentDate: "2026-10-31" },
    items: [move("move-one-to-reserve", ref("p1", "Roster One"), "IR")],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.strictEqual(decision.timing, "weekly_lock");
    assert.isUndefined(decision.effectiveDate);
    assert.include(decision.conflicts[0]?.detail ?? "", "in the league's scoring week");
  }
});

it("starts an illegal roster with the move that makes it legal", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [player("p1", "Roster One", "IR", ["C"]), player("p2", "Roster Two", "C", ["C"])],
    timing: skate,
    items: [
      drop("drop-two", ref("p2", "Roster Two")),
      move("move-one-to-bench", ref("p1", "Roster One"), "BN"),
    ],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["move-one-to-bench", "drop-two"],
    );
  }
});

it("refuses a set that never makes a locked illegal roster legal", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "IR", ["C"], false),
      player("p2", "Roster Two", "C", ["C"]),
    ],
    timing: skate,
    items: [drop("drop-two", ref("p2", "Roster Two"))],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.include(decision.conflicts[0]?.detail ?? "", "Roster One");
    assert.include(decision.conflicts[0]?.detail ?? "", "IR");
  }
});

it("orders a drop before an add that needs the roster spot", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [player("p1", "Roster One", "C", ["C"]), player("p2", "Roster Two", "BN", ["C"])],
    timing: skate,
    items: [add("add-pool", [ref("p9", "Pool One")]), drop("drop-two", ref("p2", "Roster Two"))],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["drop-two", "add-pool"],
    );
  }
});

it("plans the roster move an add needs to fit", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "C", ["C"]),
      player("p2", "Roster Two", "BN", ["C", "IR"]),
    ],
    timing: skate,
    items: [add("add-pool", [ref("p9", "Pool One")])],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["add-pool"],
    );
    assert.deepStrictEqual(decision.steps[0]?.reserveMove, {
      playerKey: "p2",
      playerName: "Roster Two",
      fromSlot: "BN",
      toSlot: "IR",
    });
  }
});

it("keeps the declared order when more than one order is legal", () => {
  const decision = planProposalOrder({
    slots: [starting("C", 2), bench("BN", 2)],
    players: [player("p1", "Roster One", "C", ["C"]), player("p2", "Roster Two", "C", ["C"])],
    timing: skate,
    items: [drop("drop-one", ref("p1", "Roster One")), drop("drop-two", ref("p2", "Roster Two"))],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["drop-one", "drop-two"],
    );
  }
});

it("reports the search bound instead of claiming no order exists", () => {
  const drops = Array.from({ length: 15 }, (_, index) =>
    drop(`drop-${String(index)}`, ref(`p${String(index)}`, `Roster ${String(index)}`)),
  );
  const decision = planProposalOrder({
    slots: [starting("C", 1), bench("BN", 15)],
    players: Array.from({ length: 15 }, (_, index) =>
      player(`p${String(index)}`, `Roster ${String(index)}`, "BN", ["C"]),
    ),
    timing: skate,
    items: [
      ...drops,
      add(
        "add-too-many",
        Array.from({ length: 20 }, (_, index) => ref(`n${String(index)}`, `Pool ${String(index)}`)),
      ),
    ],
  });

  assert.strictEqual(decision.status, "unresolved");
  if (decision.status === "unresolved") {
    assert.include(decision.detail, "20,000");
    assert.include(decision.detail, "not proof");
  }
});

it("names a reserve-slot player whose positions the slot does not accept", () => {
  const occupants = ineligibleSlotOccupants({
    slots: [starting("C", 2), bench("BN", 3), reserve("IR", 1)],
    players: [{ key: "p1", name: "Marcus Reserve", slot: "IR", positions: ["C"] }],
  });

  assert.deepStrictEqual(occupants, [
    {
      key: "p1",
      name: "Marcus Reserve",
      slot: "IR",
      positions: ["C"],
      detail: "Marcus Reserve is in the IR slot, but it does not accept their positions (C).",
    },
  ]);
});

it("accepts a player whose positions include one the slot accepts", () => {
  const occupants = ineligibleSlotOccupants({
    slots: [starting("C", 2), bench("BN", 3), reserve("IR", 1)],
    players: [{ key: "p1", name: "Legal Reserve", slot: "IR", positions: ["C", "IR"] }],
  });

  assert.deepStrictEqual(occupants, []);
});

it("accepts any player the league puts on its bench", () => {
  const occupants = ineligibleSlotOccupants({
    slots: [starting("C", 2), bench("BN", 3)],
    players: [{ key: "p1", name: "Benched Player", slot: "BN", positions: ["LW"] }],
  });

  assert.deepStrictEqual(occupants, []);
});

it("ignores a slot the league does not declare", () => {
  const occupants = ineligibleSlotOccupants({
    slots: [starting("C", 2)],
    players: [{ key: "p1", name: "Unknown Slot", slot: "TAXI", positions: ["C"] }],
  });

  assert.deepStrictEqual(occupants, []);
});

it("names a starting slot the player is not eligible for", () => {
  const occupants = ineligibleSlotOccupants({
    slots: [starting("C", 1), starting("LW", 1)],
    players: [{ key: "p1", name: "Wing In The Middle", slot: "C", positions: ["LW"] }],
  });

  assert.deepStrictEqual(
    occupants.map((occupant) => occupant.detail),
    ["Wing In The Middle is in the C slot, but it does not accept their positions (LW)."],
  );
});

it("uses the league's own name for a reserve list", () => {
  const slots: ReadonlyArray<Slot> = [
    { position: "RESERVE", kind: "reserve", count: 1, eligibility: ["PG"] },
  ];
  const occupants = ineligibleSlotOccupants({
    slots,
    players: [{ key: "p1", name: "Eve Reserve", slot: "RESERVE", positions: ["SF"] }],
  });

  assert.deepStrictEqual(
    occupants.map((occupant) => [occupant.slot, occupant.detail]),
    [
      [
        "RESERVE",
        "Eve Reserve is in the RESERVE slot, but it does not accept their positions (SF).",
      ],
    ],
  );
});

const skate = { rule: "same_day", currentDate: "2026-10-31" } as const;

function starting(position: string, count: number): Slot {
  return { position, kind: "starting", count, eligibility: [position] };
}

function bench(position: string, count: number): Slot {
  return { position, kind: "bench", count, eligibility: [] };
}

function reserve(position: string, count: number): Slot {
  return { position, kind: "reserve", count, eligibility: [position] };
}

function player(
  key: string,
  name: string,
  slot: string,
  positions: ReadonlyArray<string>,
  editable = true,
): ProposalOrderPlayer {
  return { key, name, positions, slot, editable };
}

function ref(key: string, name: string): PlayerRef {
  return { key, name };
}

function move(
  id: string,
  player: { readonly key: string; readonly name: string },
  toSlot: string,
): ProposalOrderItem {
  return {
    id,
    label: `Move ${player.name} to ${toSlot}`,
    adds: [],
    drops: [],
    move: { player, toSlot },
    mayRepair: false,
  };
}

function drop(
  id: string,
  player: { readonly key: string; readonly name: string },
): ProposalOrderItem {
  return {
    id,
    label: `Drop ${player.name}`,
    adds: [],
    drops: [player],
    move: undefined,
    mayRepair: true,
  };
}

function add(id: string, players: ReadonlyArray<PlayerRef>): ProposalOrderItem {
  return {
    id,
    label: `Add ${players.map((player) => player.name).join(", ")}`,
    adds: players,
    drops: [],
    move: undefined,
    mayRepair: true,
  };
}
