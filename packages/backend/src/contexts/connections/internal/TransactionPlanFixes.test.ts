import { assert, it } from "@effect/vitest";
import { Schema } from "effect";

import { rosterRuleOf } from "#contexts/connections/RosterSlots.ts";

import type {
  TransactionPlanMove,
  TransactionPlanRosterPlayer,
  TransactionPlanSlot,
  TransactionPlanTeamFacts,
} from "./TransactionPlanEvaluation.ts";
import { searchRosterFixes } from "./TransactionPlanFixes.ts";
import { TransactionMoveId as TransactionMoveIdSchema } from "./TransactionPlanRecord.ts";

it("finds the stash that frees a place for an add", () => {
  const facts = teamFacts({
    roster: [{ ...player("a1", "Roster One", "BN"), injured: true }],
    slots: [bench("BN", 1), reserve("IR")],
    maximum: 1,
  });

  const search = searchRosterFixes({
    facts,
    rule: rosterRuleOf(facts.constraints, facts.slots),
    funded: fundedMove(),
    reasons: [{ code: "roster_full", detail: "The roster is full." }],
  });

  assert.deepStrictEqual(
    search.fixes.map((fix) => [fix.kind, fix.playerKey]),
    [["stash", "a1"]],
  );
  assert.include(search.fixes[0]?.detail ?? "", "to free a place");
});

it("finds the activate that cures an illegal reserve place", () => {
  const facts = teamFacts({
    roster: [
      player("a1", "Roster One", "BN"),
      player("a2", "Roster Two", "IR"),
      { ...player("a3", "Roster Three", "IR+"), injured: true },
    ],
    slots: [bench("BN", 3), reserve("IR"), reserve("IR+")],
    maximum: 4,
    reserveEligibility: { kind: "injury_status" },
  });

  const search = searchRosterFixes({
    facts,
    rule: rosterRuleOf(facts.constraints, facts.slots),
    funded: fundedMove(),
    reasons: [{ code: "slot_illegal", playerKey: "a2", detail: "Roster Two sits in IR." }],
  });

  assert.deepStrictEqual(
    search.fixes.map((fix) => [fix.kind, fix.playerKey]),
    [["activate", "a2"]],
  );
});

it("adds the stash that frees the place an activate needs", () => {
  const facts = teamFacts({
    roster: [
      player("a1", "Roster One", "BN"),
      player("a2", "Roster Two", "IR"),
      { ...player("a3", "Roster Three", "BN"), injured: true },
    ],
    slots: [bench("BN", 2), reserve("IR"), reserve("IR+")],
    maximum: 2,
    reserveEligibility: { kind: "injury_status" },
  });

  const search = searchRosterFixes({
    facts,
    rule: rosterRuleOf(facts.constraints, facts.slots),
    funded: fundedMove(),
    reasons: [{ code: "slot_illegal", playerKey: "a2", detail: "Roster Two sits in IR." }],
  });

  assert.deepStrictEqual(
    search.fixes.map((fix) => [fix.kind, fix.playerKey]),
    [
      ["stash", "a3"],
      ["activate", "a2"],
    ],
  );
});

it("names the cure when no eligibility move can free a place", () => {
  const facts = teamFacts({
    roster: [player("a1", "Roster One", "BN")],
    slots: [bench("BN", 1)],
    maximum: 1,
  });

  const search = searchRosterFixes({
    facts,
    rule: rosterRuleOf(facts.constraints, facts.slots),
    funded: fundedMove(),
    reasons: [{ code: "roster_full", detail: "The roster is full." }],
  });

  assert.deepStrictEqual(search.fixes, []);
  assert.strictEqual(
    search.detail,
    "Add Free Agent needs a place, and no injured player on the roster can move to a reserve list to free one. Add a drop, or remove this move.",
  );
});

it("finds no fix for a reason that is not about places or eligibility", () => {
  const facts = teamFacts({
    roster: [player("a1", "Roster One", "BN")],
    slots: [bench("BN", 2)],
    maximum: 2,
  });

  const search = searchRosterFixes({
    facts,
    rule: rosterRuleOf(facts.constraints, facts.slots),
    funded: fundedMove(),
    reasons: [{ code: "player_locked", playerKey: "a1", detail: "Roster One is locked." }],
  });

  assert.deepStrictEqual(search, { fixes: [], detail: undefined });
});

function teamFacts(input: {
  readonly roster: ReadonlyArray<TransactionPlanRosterPlayer>;
  readonly slots: ReadonlyArray<TransactionPlanSlot>;
  readonly maximum: number;
  readonly reserveEligibility?:
    | { readonly kind: "published_positions" }
    | { readonly kind: "injury_status" }
    | { readonly kind: "not_published"; readonly detail: string };
}): TransactionPlanTeamFacts {
  return {
    roster: input.roster,
    pool: new Map([
      [
        "fa1",
        { key: "fa1", name: "Free Agent", positions: [], availability: "free_agent" as const },
      ],
    ]),
    slots: input.slots,
    constraints: {
      rosterMaximum: input.maximum,
      benchCapacity: "generic",
      startingSlotsMayStandEmpty: true,
      reserveEligibility: input.reserveEligibility ?? { kind: "published_positions" },
    },
    today: "2026-11-14",
    timing: { rule: "next_day", currentDate: "2026-11-14", periodStart: undefined },
    budget: undefined,
    waiverBid: { kind: "bidless" },
    rosterSource: "week 1",
    leagueKey: "461.l.1000",
  };
}

function fundedMove(): TransactionPlanMove {
  return {
    id: Schema.decodeSync(TransactionMoveIdSchema)(`01J${String(1).padStart(23, "0")}`),
    group: undefined,
    position: 0,
    kind: "free_agent_add",
    adds: [{ key: "fa1", name: "Free Agent" }],
    fallbacks: [],
    drops: [],
    picks: [],
    slotMove: undefined,
    intent: { kind: "add", to: "active" },
    bid: undefined,
    runDay: undefined,
    result: undefined,
    decision: "now",
  };
}

function player(key: string, name: string, slot: string): TransactionPlanRosterPlayer {
  return { key, name, positions: [], slot, injured: false, editable: true };
}

function bench(position: string, count: number): TransactionPlanSlot {
  return { position, kind: "bench", count, eligibility: [] };
}

function reserve(position: string): TransactionPlanSlot {
  return { position, kind: "reserve", count: 1, eligibility: [] };
}
