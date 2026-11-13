import { assert, it } from "@effect/vitest";

import { rosterOccupancy, rosterRuleOf } from "./RosterSlots.ts";
import type { RosterPlayerPlace, RosterSlot } from "./RosterSlots.ts";

const slots: ReadonlyArray<RosterSlot> = [
  { position: "C", kind: "starting", count: 1, eligibility: ["C"] },
  { position: "BN", kind: "bench", count: 1, eligibility: [] },
  { position: "IR+", kind: "reserve", count: 1, eligibility: ["IR+"] },
];

const injuryRule = rosterRuleOf(
  {
    rosterMaximum: 2,
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "injury_status" },
  },
  slots,
);

it("names a healthy player on an injury-based reserve list and requires a drop when the roster is full", () => {
  const occupancy = rosterOccupancy({
    rule: injuryRule,
    players: [
      place("center", "Roster Center", "C", ["C"], true),
      place("bench", "Roster Bench", "BN", ["C"], true),
      place("ullmark", "Linus Ullmark", "IR+", ["G"], false),
    ],
  });

  assert.deepStrictEqual(
    occupancy.illegal.map((occupant) => occupant.detail),
    [
      "Linus Ullmark is no longer injured, and the IR+ reserve list only accepts an injured player. Activate them. Your roster is full, so a drop is required.",
    ],
  );
  assert.strictEqual(occupancy.occupied, 2);
  assert.strictEqual(occupancy.reserved, 1);
});

it("accepts the same player on an injury-based reserve list while injured", () => {
  const occupancy = rosterOccupancy({
    rule: injuryRule,
    players: [
      place("center", "Roster Center", "C", ["C"], true),
      place("bench", "Roster Bench", "BN", ["C"], true),
      place("ullmark", "Linus Ullmark", "IR+", ["G"], true),
    ],
  });

  assert.deepStrictEqual(occupancy.illegal, []);
});

it("asks for an activation without a drop when the roster has room", () => {
  const occupancy = rosterOccupancy({
    rule: injuryRule,
    players: [
      place("center", "Roster Center", "C", ["C"], true),
      place("ullmark", "Linus Ullmark", "IR+", ["G"], false),
    ],
  });

  assert.deepStrictEqual(
    occupancy.illegal.map((occupant) => occupant.detail),
    [
      "Linus Ullmark is no longer injured, and the IR+ reserve list only accepts an injured player. Activate them.",
    ],
  );
});

it("keeps the position wording for a reserve list that publishes positions", () => {
  const rule = rosterRuleOf(
    {
      rosterMaximum: 2,
      benchCapacity: "generic",
      startingSlotsMayStandEmpty: true,
      reserveEligibility: { kind: "published_positions" },
    },
    slots,
  );
  const occupancy = rosterOccupancy({
    rule,
    players: [place("ullmark", "Linus Ullmark", "IR+", ["G"], true)],
  });

  assert.deepStrictEqual(
    occupancy.illegal.map((occupant) => occupant.detail),
    ["Linus Ullmark is on the IR+ reserve list, but it does not accept their positions (G)."],
  );
});

function place(
  key: string,
  name: string,
  slot: string,
  positions: ReadonlyArray<string>,
  injured: boolean,
): RosterPlayerPlace {
  return { key, name, slot, positions, injured };
}
