import { assert, it } from "@effect/vitest";
import { Array as EffectArray } from "effect";

import { rosterOccupancy, rosterRuleOf, slotPlacement } from "./RosterSlots.ts";
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
    EffectArray.map(occupancy.illegal, (occupant) => occupant.detail),
    [
      "Linus Ullmark is no longer injured but sits in IR+. This roster is illegal, so all adds and drops are blocked until it is cured. Activate Linus Ullmark together with a drop, or drop Linus Ullmark.",
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

it("publishes the blocker's fact and the drop that cures it", () => {
  const occupancy = rosterOccupancy({
    rule: injuryRule,
    players: [
      place("center", "Roster Center", "C", ["C"], true),
      place("bench", "Roster Bench", "BN", ["C"], true),
      place("ullmark", "Linus Ullmark", "IR+", ["G"], false),
    ],
  });

  assert.deepStrictEqual(
    EffectArray.map(occupancy.illegal, ({ key, name, slot, fact, cure }) => ({
      key,
      name,
      slot,
      fact,
      cure,
    })),
    [
      {
        key: "ullmark",
        name: "Linus Ullmark",
        slot: "IR+",
        fact: "Linus Ullmark is no longer injured but sits in IR+.",
        cure: "Activate Linus Ullmark together with a drop, or drop Linus Ullmark.",
      },
    ],
  );
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
    EffectArray.map(occupancy.illegal, (occupant) => occupant.detail),
    [
      "Linus Ullmark is no longer injured but sits in IR+. This roster is illegal, so all adds and drops are blocked until it is cured. Activate Linus Ullmark, or drop Linus Ullmark.",
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
    EffectArray.map(occupancy.illegal, (occupant) => occupant.detail),
    [
      "Linus Ullmark sits in IR+, but IR+ does not accept their positions (G). This roster is illegal, so all adds and drops are blocked until it is cured. Activate Linus Ullmark, or drop Linus Ullmark.",
    ],
  );
});

it("reports each reserve list by its own name and capacity while the active places stay full", () => {
  const rule = rosterRuleOf(
    {
      rosterMaximum: 2,
      benchCapacity: "generic",
      startingSlotsMayStandEmpty: true,
      reserveEligibility: { kind: "injury_status" },
    },
    [
      { position: "C", kind: "starting", count: 1, eligibility: ["C"] },
      { position: "BN", kind: "bench", count: 1, eligibility: [] },
      { position: "IR", kind: "reserve", count: 1, eligibility: ["IR"] },
      { position: "IR+", kind: "reserve", count: 2, eligibility: ["IR+"] },
    ],
  );
  const occupancy = rosterOccupancy({
    rule,
    players: [
      place("center", "Roster Center", "C", ["C"], true),
      place("bench", "Roster Bench", "BN", ["C"], true),
      place("tall", "Injured Tall", "IR+", ["C"], true),
    ],
  });

  assert.deepStrictEqual(occupancy.places, { used: 2, maximum: 2, free: 0 });
  assert.deepStrictEqual(occupancy.reserve, [
    { name: "IR", eligibility: { kind: "injury_status" }, capacity: 1, occupied: 0, free: 1 },
    { name: "IR+", eligibility: { kind: "injury_status" }, capacity: 2, occupied: 1, free: 1 },
  ]);
});

it("publishes no reserve lists when the league declares none", () => {
  const rule = rosterRuleOf(
    {
      rosterMaximum: 1,
      benchCapacity: "generic",
      startingSlotsMayStandEmpty: true,
      reserveEligibility: {
        kind: "not_published",
        detail: "This league declares no reserve list.",
      },
    },
    [{ position: "BN", kind: "bench", count: 1, eligibility: [] }],
  );
  const occupancy = rosterOccupancy({
    rule,
    players: [place("bench", "Roster Bench", "BN", [], true)],
  });

  assert.deepStrictEqual(occupancy.places, { used: 1, maximum: 1, free: 0 });
  assert.deepStrictEqual(occupancy.reserve, []);
});

it("publishes the positions a reserve list declares", () => {
  const rule = rosterRuleOf(
    {
      rosterMaximum: 0,
      benchCapacity: "generic",
      startingSlotsMayStandEmpty: true,
      reserveEligibility: { kind: "published_positions" },
    },
    [{ position: "NA", kind: "reserve", count: 1, eligibility: ["C", "LW"] }],
  );
  const occupancy = rosterOccupancy({ rule, players: [] });

  assert.deepStrictEqual(occupancy.reserve, [
    {
      name: "NA",
      eligibility: { kind: "published_positions", positions: ["C", "LW"] },
      capacity: 1,
      occupied: 0,
      free: 1,
    },
  ]);
});

it("does not treat a healthy player as eligible for an injury-only list", () => {
  const placement = slotPlacement(injuryRule, "IR+", {
    positions: ["C"],
    injured: false,
  });

  assert.strictEqual(placement.legal, false);
});

it("uses the roster row's reserve names on an injury-based list", () => {
  const rule = rosterRuleOf(
    {
      rosterMaximum: 1,
      benchCapacity: "generic",
      startingSlotsMayStandEmpty: true,
      reserveEligibility: { kind: "injury_status" },
    },
    [
      { position: "BN", kind: "bench", count: 1, eligibility: [] },
      { position: "IR", kind: "reserve", count: 1, eligibility: ["IR"] },
      { position: "IR+", kind: "reserve", count: 1, eligibility: ["IR+"] },
    ],
  );
  const dayToDay = {
    positions: ["LW", "RW", "Util", "IR+"],
    injured: true,
  };

  assert.strictEqual(slotPlacement(rule, "IR", dayToDay).legal, false);
  assert.strictEqual(slotPlacement(rule, "IR+", dayToDay).legal, true);
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
