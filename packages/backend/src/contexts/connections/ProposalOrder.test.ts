import { assert, it } from "@effect/vitest";

import { planProposalOrder } from "./ProposalOrder.ts";
import type {
  ProposalOrderInput,
  ProposalOrderItem,
  ProposalOrderPlan,
  ProposalOrderPlayer,
} from "./ProposalOrder.ts";
import type { ProviderRosterConstraints } from "./Provider.ts";
import { rosterOccupancy, rosterRuleOf } from "./RosterSlots.ts";

type Slot = ProposalOrderInput["slots"][number];
type PlayerRef = ProposalOrderInput["items"][number]["adds"][number];

it("orders a drop before a move into the starting slot that drop frees", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "C", ["C"]),
      player("p2", "Roster Two", "IR", ["C", "IR"]),
      player("p3", "Roster Three", "BN", ["C"]),
    ],
    timing: skate,
    items: [
      move("move-two-to-center", ref("p2", "Roster Two"), "C"),
      drop("drop-one", ref("p1", "Roster One")),
    ],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["drop-one", "move-two-to-center"],
    );
    assert.strictEqual(decision.timing, "same_day");
    assert.strictEqual(decision.effectiveDate, "2026-10-31");
  }
});

it("refuses only the move whose drop frees a different slot", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "C", ["C"]),
      player("p2", "Roster Two", "BN", ["C"]),
      player("p3", "Roster Three", "IR", ["C", "IR"]),
    ],
    timing: skate,
    items: [
      move("move-three-to-center", ref("p3", "Roster Three"), "C"),
      drop("drop-two", ref("p2", "Roster Two")),
    ],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.deepStrictEqual(
      decision.conflicts.map((conflict) => conflict.items),
      [["move-three-to-center"]],
    );
    const reasons = decision.conflicts[0]?.reasons ?? [];
    assert.deepStrictEqual(
      reasons.map((reason) => [reason.item, reason.code]),
      [["move-three-to-center", "move_slot_full"]],
    );
    const detail = decision.conflicts[0]?.detail ?? "";
    assert.include(detail, "Moving Roster Three to the C starting slot is refused");
    assert.include(detail, "Roster One already holds it");
    assert.notInclude(detail, "not BN");
    assert.notInclude(detail, "free BN slot");
  }
});

it("refuses a locked player's move on the league's effective date", () => {
  const decision = plan({
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
  const decision = plan({
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
  const decision = plan({
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
  const decision = plan({
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

it("refuses only the add that has no place after two reserve placements are cured", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 4), reserve("IR", 1), reserve("IR+", 1)],
    players: reserveHeavyRoster(),
    timing: skate,
    items: [
      drop("drop-bench-one", ref("b1", "Roster Bench One")),
      drop("drop-reserve-two", ref("r2", "Roster Reserve Two")),
      move("move-reserve-one-to-bench", ref("r1", "Roster Reserve One"), "BN"),
      add("add-pool", [skater("pool", "Pool Forward", ["C"])]),
    ],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.deepStrictEqual(
      decision.conflicts.map((conflict) => conflict.items),
      [["add-pool"]],
    );
    const reason = decision.conflicts[0]?.reasons?.[0];
    assert.strictEqual(reason?.item, "add-pool");
    assert.strictEqual(reason?.code, "roster_full");
    assert.include(reason?.detail ?? "", "6");
    assert.include(reason?.detail ?? "", "allows 5");
    assert.include(reason?.detail ?? "", "This set frees 1 place and consumes 2 places");
    assert.notInclude(reason?.detail ?? "", "Add a drop item");
    assert.notInclude(reason?.detail ?? "", "add a slot move");
  }
});

it("orders the reserve cures before an add that uses the place they free", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 4), reserve("IR", 1), reserve("IR+", 1)],
    players: reserveHeavyRoster(),
    timing: skate,
    items: [
      add("add-pool", [skater("pool", "Pool Forward", ["C"])]),
      drop("drop-bench-one", ref("b1", "Roster Bench One")),
      drop("drop-reserve-two", ref("r2", "Roster Reserve Two")),
      move("move-reserve-one-to-bench", ref("r1", "Roster Reserve One"), "BN"),
      drop("drop-bench-two", ref("b2", "Roster Bench Two")),
    ],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    const order = decision.steps.map((step) => step.item);
    assert.deepStrictEqual(order.at(-1), "add-pool");
    assert.isBelow(order.indexOf("move-reserve-one-to-bench"), order.indexOf("add-pool"));
    assert.isBelow(order.indexOf("drop-reserve-two"), order.indexOf("add-pool"));
    assert.isBelow(order.indexOf("drop-bench-two"), order.indexOf("add-pool"));
  }
});

it("counts a dropped reserve player as freeing no roster place", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("p1", "Roster Center", "C", ["C"]),
      player("p2", "Roster Bench One", "BN", ["C"]),
      player("p3", "Roster Reserve One", "IR", ["C", "IR"]),
    ],
    timing: skate,
    items: [
      addWithDrop(
        "add-pool",
        skater("pool", "Pool Forward", ["C"]),
        ref("p3", "Roster Reserve One"),
      ),
    ],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    const reason = decision.conflicts[0]?.reasons?.[0];
    assert.strictEqual(reason?.item, "add-pool");
    assert.strictEqual(reason?.code, "roster_full");
    assert.include(reason?.detail ?? "", "This set frees 0 places and consumes 1 place");
    assert.include(reason?.detail ?? "", "free 1 place more");
  }
});

it("composes three illegal reserve placements the same way as two", () => {
  const decision = plan({
    slots: [
      starting("C", 1),
      bench("BN", 4),
      reserve("IR", 1),
      reserve("IR+", 1),
      reserve("TAXI", 1),
    ],
    players: [
      player("c1", "Roster Center", "C", ["C"]),
      player("b1", "Roster Bench One", "BN", ["C"]),
      player("b2", "Roster Bench Two", "BN", ["C"]),
      player("b3", "Roster Bench Three", "BN", ["C"]),
      player("b4", "Roster Bench Four", "BN", ["C"]),
      player("r1", "Roster Reserve One", "IR", ["C"]),
      player("r2", "Roster Reserve Two", "IR+", ["C"]),
      player("r3", "Roster Reserve Three", "TAXI", ["C"]),
    ],
    timing: skate,
    items: [
      add("add-pool", [skater("pool", "Pool Forward", ["C"])]),
      drop("drop-bench-one", ref("b1", "Roster Bench One")),
      drop("drop-bench-two", ref("b2", "Roster Bench Two")),
      drop("drop-reserve-two", ref("r2", "Roster Reserve Two")),
      drop("drop-reserve-three", ref("r3", "Roster Reserve Three")),
      move("move-reserve-one-to-bench", ref("r1", "Roster Reserve One"), "BN"),
    ],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    const order = decision.steps.map((step) => step.item);
    assert.deepStrictEqual(order.at(-1), "add-pool");
    for (const cure of [
      "drop-bench-one",
      "drop-bench-two",
      "drop-reserve-two",
      "drop-reserve-three",
      "move-reserve-one-to-bench",
    ]) {
      assert.isBelow(order.indexOf(cure), order.indexOf("add-pool"));
    }
  }
});

it("credits the starting place a drop bundled into an add frees", () => {
  const decision = plan({
    slots: [starting("C", 2), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("c1", "Roster Center One", "C", ["C"]),
      player("c2", "Roster Center Two", "C", ["C"]),
      player("r1", "Roster Reserve One", "IR", ["C", "IR"]),
    ],
    timing: skate,
    items: [
      move("move-reserve-one-to-center", ref("r1", "Roster Reserve One"), "C"),
      addWithDrop(
        "add-pool",
        skater("pool", "Pool Forward", ["C"]),
        ref("c1", "Roster Center One"),
      ),
    ],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["add-pool", "move-reserve-one-to-center"],
    );
  }
});

it("refuses a set that never makes a locked illegal roster legal", () => {
  const decision = plan({
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

it("orders a drop before an add that needs the roster place", () => {
  const decision = plan({
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
  const decision = plan({
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
      order: "before",
    });
  }
});

it("sends a roster move after the drop that frees its destination", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "C", ["C"]),
      player("p2", "Roster Two", "BN", ["C", "IR"]),
      player("p3", "Roster Three", "IR", ["C", "IR"]),
    ],
    timing: skate,
    items: [addWithDrop("swap-three", skater("p9", "Pool One", ["C"]), ref("p3", "Roster Three"))],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => [step.item, step.reserveMove]),
      [
        [
          "swap-three",
          {
            playerKey: "p2",
            playerName: "Roster Two",
            fromSlot: "BN",
            toSlot: "IR",
            order: "after",
          },
        ],
      ],
    );
  }
});

it("keeps the declared order when more than one order is legal", () => {
  const decision = plan({
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

it("holds one player on a bench slot while two players swap slots", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1), bench("HOLD", 1)],
    constraints: { benchCapacity: "per_slot" },
    players: [player("p1", "Roster One", "C", ["C"]), player("p2", "Roster Two", "BN", ["C"])],
    timing: skate,
    items: [
      move("move-one-to-bench", ref("p1", "Roster One"), "BN"),
      move("move-two-to-center", ref("p2", "Roster Two"), "C"),
    ],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => [step.item, step.reserveMove]),
      [
        [
          "move-two-to-center",
          {
            playerKey: "p1",
            playerName: "Roster One",
            fromSlot: "C",
            toSlot: "HOLD",
            order: "before",
          },
        ],
        ["move-one-to-bench", undefined],
      ],
    );
  }
});

it("refuses a slot swap when no bench slot is free to hold a player", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1)],
    constraints: { benchCapacity: "per_slot" },
    players: [player("p1", "Roster One", "C", ["C"]), player("p2", "Roster Two", "BN", ["C"])],
    timing: skate,
    items: [
      move("move-one-to-bench", ref("p1", "Roster One"), "BN"),
      move("move-two-to-center", ref("p2", "Roster Two"), "C"),
    ],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.deepStrictEqual(decision.conflicts[0]?.items, [
      "move-one-to-bench",
      "move-two-to-center",
    ]);
    const detail = decision.conflicts[0]?.detail ?? "";
    assert.include(detail, "Neither operation can go first");
    assert.include(detail, "Moving Roster One to the BN bench slot is refused");
    assert.include(detail, "Moving Roster Two to the C starting slot is refused");
    assert.include(detail, "cannot both be legal on 2026-10-31");
  }
});

it("refuses a reserve list that does not accept the player's positions", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1), reserve("IL+", 1)],
    players: [
      { ...player("p1", "Roster One", "BN", ["C"]), injured: true },
      player("p2", "Roster Two", "C", ["C"]),
    ],
    timing: skate,
    items: [move("move-one-to-reserve", ref("p1", "Roster One"), "IL+")],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.deepStrictEqual(
      decision.conflicts[0]?.reasons?.map((reason) => reason.code),
      ["slot_illegal"],
    );
    const detail = decision.conflicts[0]?.detail ?? "";
    assert.include(detail, "Roster One");
    assert.include(detail, "IL+ reserve list");
  }
});

it("refuses an injury-based reserve list for a player who is not injured", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR+", 1)],
    constraints: { reserveEligibility: { kind: "injury_status" } },
    players: [player("p1", "Roster One", "BN", ["C"]), player("p2", "Roster Two", "C", ["C"])],
    timing: skate,
    items: [move("move-one-to-reserve", ref("p1", "Roster One"), "IR+")],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.deepStrictEqual(
      decision.conflicts[0]?.reasons?.map((reason) => reason.code),
      ["slot_illegal"],
    );
    const detail = decision.conflicts[0]?.detail ?? "";
    assert.include(detail, "Roster One cannot move to the IR+ reserve list");
    assert.include(detail, "it only accepts an injured player");
    assert.notInclude(detail, "positions");
  }
});

it("refuses a reserve list whose eligibility the league does not publish", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    constraints: {
      reserveEligibility: {
        kind: "not_published",
        detail: "This league publishes no reserve rule.",
      },
    },
    players: [player("p1", "Roster One", "BN", ["C", "IR"])],
    timing: skate,
    items: [move("move-one-to-reserve", ref("p1", "Roster One"), "IR")],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.deepStrictEqual(
      decision.conflicts[0]?.reasons?.map((reason) => reason.code),
      ["state_unavailable"],
    );
    assert.include(
      decision.conflicts[0]?.detail ?? "",
      "does not publish how reserve eligibility is established",
    );
  }
});

it("refuses an add no open slot accepts", () => {
  const decision = plan({
    slots: [starting("C", 2)],
    players: [player("p1", "Roster One", "C", ["C"])],
    timing: skate,
    items: [add("add-wing", [skater("p9", "Pool Wing", ["LW"])])],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    const detail = decision.conflicts[0]?.detail ?? "";
    assert.include(detail, "Pool Wing");
    assert.include(detail, "no open slot accepts their positions");
    assert.include(detail, "2 of 2 roster places");
  }
});

it("refuses an add the roster cannot hold instead of reporting a search bound", () => {
  const drops = Array.from({ length: 15 }, (_, index) =>
    drop(`drop-${String(index)}`, ref(`p${String(index)}`, `Roster ${String(index)}`)),
  );
  const decision = plan({
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

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    const reason = decision.conflicts[0]?.reasons?.[0];
    assert.strictEqual(reason?.item, "add-too-many");
    assert.strictEqual(reason?.code, "roster_full");
    assert.include(reason?.detail ?? "", "the league allows 16");
    assert.include(reason?.detail ?? "", "This set frees 15 places and consumes 20 places");
  }
});

it("activates a reserve player onto a full bench when the total stays under the maximum", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 2), reserve("IR", 1)],
    players: [
      player("p2", "Roster Two", "BN", ["C"]),
      player("p3", "Roster Three", "BN", ["C"]),
      player("p4", "Roster Four", "IR", ["C", "IR"]),
    ],
    timing: skate,
    items: [move("move-four-to-bench", ref("p4", "Roster Four"), "BN")],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["move-four-to-bench"],
    );
    assert.deepStrictEqual(decision.rosterPlaces, { maximum: 3, occupied: 2, net: -1 });
  }
});

it("refuses the activation that would push the total past the maximum", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 2), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "C", ["C"]),
      player("p2", "Roster Two", "BN", ["C"]),
      player("p3", "Roster Three", "BN", ["C"]),
      player("p4", "Roster Four", "IR", ["C", "IR"]),
    ],
    timing: skate,
    items: [move("move-four-to-bench", ref("p4", "Roster Four"), "BN")],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    const reason = decision.conflicts[0]?.reasons?.[0];
    assert.strictEqual(reason?.code, "roster_full");
    assert.include(reason?.detail ?? "", "The team would hold 4 players on its roster");
    assert.include(reason?.detail ?? "", "allows 3");
    assert.include(reason?.detail ?? "", "free 1 place more");
  }
});

it("refuses a move into an occupied starting slot and names the occupant", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 1), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "C", ["C"]),
      player("p2", "Roster Two", "BN", ["C", "IR"]),
      player("p3", "Roster Three", "IR", ["C", "IR"]),
    ],
    timing: skate,
    items: [move("move-three-to-center", ref("p3", "Roster Three"), "C")],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    const reason = decision.conflicts[0]?.reasons?.[0];
    assert.strictEqual(reason?.code, "move_slot_full");
    assert.include(reason?.detail, "C starting slot");
    assert.include(reason?.detail, "Roster One already holds it");
  }
});

it("reports each move's roster-place effect and the set's net count", () => {
  const decision = plan({
    slots: [starting("C", 1), bench("BN", 2), reserve("IR", 1)],
    players: [
      player("p1", "Roster One", "C", ["C"]),
      player("p2", "Roster Two", "BN", ["C"]),
      player("r1", "Roster Reserve One", "IR", ["C", "IR"]),
    ],
    timing: skate,
    items: [
      move("move-reserve-to-bench", ref("r1", "Roster Reserve One"), "BN"),
      drop("drop-two", ref("p2", "Roster Two")),
      add("add-pool", [skater("pool", "Pool Forward", ["C"])]),
    ],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => [step.item, step.rosterPlace]),
      [
        ["move-reserve-to-bench", "consumes"],
        ["drop-two", "frees"],
        ["add-pool", "consumes"],
      ],
    );
    assert.deepStrictEqual(decision.rosterPlaces, { maximum: 3, occupied: 2, net: -1 });
  }
});

it("refuses a set that leaves a required starting slot empty", () => {
  const decision = plan({
    slots: [starting("C", 1), starting("LW", 1)],
    constraints: { startingSlotsMayStandEmpty: false },
    players: [player("p1", "Roster One", "C", ["C"]), player("p2", "Roster Two", "LW", ["LW"])],
    timing: skate,
    items: [drop("drop-two", ref("p2", "Roster Two"))],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    const detail = decision.conflicts[0]?.detail ?? "";
    assert.include(detail, "The LW starting slot is empty");
    assert.include(detail, "requires every starting slot to be filled");
  }
});

it("lets a starting slot stand empty when the league allows it", () => {
  const decision = plan({
    slots: [starting("C", 1), starting("LW", 1)],
    players: [player("p1", "Roster One", "C", ["C"]), player("p2", "Roster Two", "LW", ["LW"])],
    timing: skate,
    items: [drop("drop-two", ref("p2", "Roster Two"))],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["drop-two"],
    );
  }
});

it("names a reserve-slot player whose positions the slot does not accept", () => {
  const occupancy = rosterOccupancy({
    rule: rosterRuleOf(leagueOf([starting("C", 2), bench("BN", 3), reserve("IR", 1)]), [
      starting("C", 2),
      bench("BN", 3),
      reserve("IR", 1),
    ]),
    players: [{ key: "p1", name: "Marcus Reserve", slot: "IR", positions: ["C"], injured: false }],
  });

  assert.deepStrictEqual(occupancy.illegal, [
    {
      key: "p1",
      name: "Marcus Reserve",
      slot: "IR",
      kind: "reserve",
      positions: ["C"],
      injured: false,
      detail:
        "Marcus Reserve is on the IR reserve list, but it does not accept their positions (C).",
    },
  ]);
  assert.strictEqual(occupancy.occupied, 0);
  assert.strictEqual(occupancy.reserved, 1);
});

it("accepts a player whose positions include one the slot accepts", () => {
  const slots = [starting("C", 2), bench("BN", 3), reserve("IR", 1)];
  const occupancy = rosterOccupancy({
    rule: rosterRuleOf(leagueOf(slots), slots),
    players: [
      { key: "p1", name: "Legal Reserve", slot: "IR", positions: ["C", "IR"], injured: false },
    ],
  });

  assert.deepStrictEqual(occupancy.illegal, []);
  assert.strictEqual(occupancy.reserved, 1);
});

it("accepts any player the league puts on its bench", () => {
  const slots = [starting("C", 2), bench("BN", 3)];
  const occupancy = rosterOccupancy({
    rule: rosterRuleOf(leagueOf(slots), slots),
    players: [{ key: "p1", name: "Benched Player", slot: "BN", positions: ["LW"], injured: false }],
  });

  assert.deepStrictEqual(occupancy.illegal, []);
  assert.strictEqual(occupancy.occupied, 1);
});

it("ignores a slot the league does not declare", () => {
  const slots = [starting("C", 2)];
  const occupancy = rosterOccupancy({
    rule: rosterRuleOf(leagueOf(slots), slots),
    players: [{ key: "p1", name: "Unknown Slot", slot: "TAXI", positions: ["C"], injured: false }],
  });

  assert.deepStrictEqual(occupancy.illegal, []);
  assert.strictEqual(occupancy.occupied, 1);
});

it("names a starting slot the player is not eligible for", () => {
  const slots = [starting("C", 1), starting("LW", 1)];
  const occupancy = rosterOccupancy({
    rule: rosterRuleOf(leagueOf(slots), slots),
    players: [
      { key: "p1", name: "Wing In The Middle", slot: "C", positions: ["LW"], injured: false },
    ],
  });

  assert.deepStrictEqual(
    occupancy.illegal.map((occupant) => occupant.detail),
    ["Wing In The Middle is in the C starting slot, but it does not accept their positions (LW)."],
  );
});

it("uses the league's own name for a reserve list", () => {
  const slots: ReadonlyArray<Slot> = [
    { position: "RESERVE", kind: "reserve", count: 1, eligibility: ["PG"] },
  ];
  const occupancy = rosterOccupancy({
    rule: rosterRuleOf(leagueOf(slots), slots),
    players: [
      { key: "p1", name: "Eve Reserve", slot: "RESERVE", positions: ["SF"], injured: false },
    ],
  });

  assert.deepStrictEqual(
    occupancy.illegal.map((occupant) => [occupant.slot, occupant.detail]),
    [
      [
        "RESERVE",
        "Eve Reserve is on the RESERVE reserve list, but it does not accept their positions (SF).",
      ],
    ],
  );
});

function plan(
  input: Omit<ProposalOrderInput, "constraints"> & {
    readonly constraints?: Partial<ProviderRosterConstraints>;
  },
): ProposalOrderPlan {
  return planProposalOrder({ ...input, constraints: leagueOf(input.slots, input.constraints) });
}

function leagueOf(
  slots: ReadonlyArray<Slot>,
  overrides: Partial<ProviderRosterConstraints> = {},
): ProviderRosterConstraints {
  return {
    rosterMaximum: slots
      .filter((slot) => slot.kind !== "reserve")
      .reduce((total, slot) => total + slot.count, 0),
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
    ...overrides,
  };
}

function addWithDrop(id: string, added: PlayerRef, dropped: PlayerRef): ProposalOrderItem {
  return {
    id,
    label: `Add ${added.name} and drop ${dropped.name}`,
    adds: [added],
    drops: [dropped],
    move: undefined,
    mayRepair: true,
  };
}

function reserveHeavyRoster(): ReadonlyArray<ProposalOrderPlayer> {
  return [
    player("c1", "Roster Center", "C", ["C"]),
    player("b1", "Roster Bench One", "BN", ["C"]),
    player("b2", "Roster Bench Two", "BN", ["C"]),
    player("b3", "Roster Bench Three", "BN", ["C"]),
    player("b4", "Roster Bench Four", "BN", ["C"]),
    player("r1", "Roster Reserve One", "IR", ["C"]),
    player("r2", "Roster Reserve Two", "IR+", ["C"]),
  ];
}

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

function skater(key: string, name: string, positions: ReadonlyArray<string>): PlayerRef {
  return { key, name, positions };
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
