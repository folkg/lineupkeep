import { assert, it } from "@effect/vitest";
import { DateTime } from "effect";

import type { ProviderRosterPlayer, ProviderRosterPosition } from "./Provider.ts";
import {
  reserveActivityOf,
  reserveSlotCandidates,
  reserveSlotSuspects,
} from "./ReserveSlotSuspicion.ts";
import type { ReserveActivityWindow } from "./ReserveSlotSuspicion.ts";

const now = DateTime.makeUnsafe("2026-11-02T18:00:00.000Z");

const injuredReserve = position("IR", "reserve");
const bench = position("BN", "bench");
const starting = position("C", "starting");
const secondProviderReserve = position("RESERVE", "reserve");

it("names a healthy reserve player with recent statistics as a reserve slot suspect", () => {
  const findings = reserveSlotSuspects({
    positions: [starting, bench, injuredReserve],
    players: [player("p1", "Marcus", "IR")],
    activity: new Map([["p1", lastFourteenDays]]),
    currentWeek: 10,
    now,
  });

  assert.strictEqual(findings.length, 1);
  const [finding] = findings;
  assert.strictEqual(finding?.player.providerPlayerKey, "p1");
  assert.deepStrictEqual(finding?.suspect.slot, "IR");
  assert.strictEqual(finding?.suspect.code, "reserve_slot_suspect");
  assert.deepStrictEqual(finding?.suspect.activity, lastFourteenDays);
  assert.strictEqual(
    finding?.suspect.detail,
    "Marcus is in a reserve slot but has played in the last 14 days, and the provider reports no injury. The roster may be refused until they are moved or dropped.",
  );
});

it("names the most recently completed week when that is the statistics window", () => {
  const findings = reserveSlotSuspects({
    positions: [starting, bench, injuredReserve],
    players: [player("p1", "Marcus", "IR")],
    activity: new Map([["p1", { kind: "week" as const, week: 9 }]]),
    currentWeek: 10,
    now,
  });

  assert.deepStrictEqual(
    findings.map((finding) => finding.suspect.detail),
    [
      "Marcus is in a reserve slot but has played in the most recently completed week, and the provider reports no injury. The roster may be refused until they are moved or dropped.",
    ],
  );
});

it("says nothing when the week statistics are not the most recently completed week", () => {
  for (const currentWeek of [10, undefined]) {
    const findings = reserveSlotSuspects({
      positions: [starting, bench, injuredReserve],
      players: [player("p1", "Marcus", "IR")],
      activity: new Map([["p1", { kind: "week" as const, week: 8 }]]),
      currentWeek,
      now,
    });

    assert.deepStrictEqual(findings, []);
  }
});

it("says nothing about a reserve player the provider reports as injured", () => {
  for (const reported of [
    { injuryCode: "IR" as const },
    { injuryDetail: "Out for the season." },
    { status: "injured_reserve" as const },
    { status: "day_to_day" as const },
    { status: "unknown" as const },
  ]) {
    const findings = reserveSlotSuspects({
      positions: [starting, bench, injuredReserve],
      players: [{ ...player("p1", "Marcus", "IR"), ...reported }],
      activity: new Map([["p1", lastFourteenDays]]),
      currentWeek: 10,
      now,
    });

    assert.deepStrictEqual(findings, []);
  }
});

it("says nothing about a reserve player with no recent statistics", () => {
  const findings = reserveSlotSuspects({
    positions: [starting, bench, injuredReserve],
    players: [player("p1", "Marcus", "IR")],
    activity: new Map(),
    currentWeek: 10,
    now,
  });

  assert.deepStrictEqual(findings, []);
});

it("says nothing when the statistics are older than the recent window", () => {
  const findings = reserveSlotSuspects({
    positions: [starting, bench, injuredReserve],
    players: [player("p1", "Marcus", "IR")],
    activity: new Map([
      ["p1", { kind: "date_range" as const, start: "2026-10-01", end: "2026-10-14", days: 14 }],
    ]),
    currentWeek: 10,
    now,
  });

  assert.deepStrictEqual(findings, []);
});

it("says nothing when the statistics cover more than the recent window", () => {
  const findings = reserveSlotSuspects({
    positions: [starting, bench, injuredReserve],
    players: [player("p1", "Marcus", "IR")],
    activity: new Map([
      ["p1", { kind: "date_range" as const, start: "2026-10-04", end: "2026-11-02", days: 30 }],
    ]),
    currentWeek: 10,
    now,
  });

  assert.deepStrictEqual(findings, []);
});

it("reads a dated statistics window only from a published positive value", () => {
  const dated = (values: ReadonlyArray<number | null>): ReturnType<typeof reserveActivityOf> =>
    reserveActivityOf({
      basis: { type: "date_range", start: "2026-10-20", end: "2026-11-02", days: 14 },
      stats: values.map((value, index) => ({ statId: index + 1, value })),
      notAggregated: [],
    });

  assert.deepStrictEqual(dated([0, 0]), undefined);
  assert.deepStrictEqual(dated([0, null]), undefined);
  assert.deepStrictEqual(dated([]), undefined);
  assert.deepStrictEqual(dated([0, 3]), lastFourteenDays);
  assert.deepStrictEqual(
    reserveActivityOf(undefined),
    undefined,
    "a missing statistics group is no evidence",
  );
  assert.deepStrictEqual(
    reserveActivityOf({ basis: { type: "season" }, stats: [], notAggregated: [] }),
    undefined,
  );
});

it("reads a completed week window from a week basis", () => {
  assert.deepStrictEqual(
    reserveActivityOf({
      basis: { type: "week", week: 9 },
      stats: [{ statId: 4, value: 287 }],
      notAggregated: [],
    }),
    { kind: "week", week: 9 },
  );
});

it("names a second provider's own reserve slot without naming a slot itself", () => {
  const findings = reserveSlotSuspects({
    positions: [position("PG", "starting"), position("BENCH", "bench"), secondProviderReserve],
    players: [player("a1", "Eve Reserve", "RESERVE")],
    activity: new Map([["a1", lastFourteenDays]]),
    currentWeek: 4,
    now,
  });

  assert.deepStrictEqual(
    findings.map((finding) => finding.suspect.slot),
    ["RESERVE"],
  );
  assert.notInclude(findings[0]?.suspect.detail ?? "", "IR");
  assert.notInclude(findings[0]?.suspect.detail ?? "", "RESERVE");
});

it("says nothing about a starting or bench player, whatever their statistics", () => {
  for (const slot of ["C", "BN"]) {
    const findings = reserveSlotSuspects({
      positions: [starting, bench, injuredReserve],
      players: [player("p1", "Marcus", slot)],
      activity: new Map([["p1", lastFourteenDays]]),
      currentWeek: 10,
      now,
    });

    assert.deepStrictEqual(findings, []);
  }
});

it("says nothing about a slot the league does not declare or an unverified slot", () => {
  const undeclared = reserveSlotSuspects({
    positions: [starting, bench, injuredReserve],
    players: [player("p1", "Marcus", "XX")],
    activity: new Map([["p1", lastFourteenDays]]),
    currentWeek: 10,
    now,
  });
  const unverified = reserveSlotSuspects({
    positions: [starting, bench, injuredReserve],
    players: [
      {
        ...player("p1", "Marcus", "IR"),
        slot: { status: "unverified" as const, rawValue: "", reason: "No slot was published." },
      },
    ],
    activity: new Map([["p1", lastFourteenDays]]),
    currentWeek: 10,
    now,
  });

  assert.deepStrictEqual(undeclared, []);
  assert.deepStrictEqual(unverified, []);
});

it("selects only healthy reserve players as candidates for an evidence read", () => {
  const candidates = reserveSlotCandidates({
    positions: [starting, bench, injuredReserve],
    players: [
      player("p1", "Marcus", "IR"),
      { ...player("p2", "Injured", "IR"), injuryCode: "IR" },
      player("p3", "Starter", "C"),
      player("p4", "Benched", "BN"),
      player("p5", "Elsewhere", "XX"),
    ],
  });

  assert.deepStrictEqual(
    candidates.map((member) => member.providerPlayerKey),
    ["p1"],
  );
});

const lastFourteenDays: ReserveActivityWindow = {
  kind: "date_range",
  start: "2026-10-20",
  end: "2026-11-02",
  days: 14,
};

function position(position_: string, kind: ProviderRosterPosition["kind"]): ProviderRosterPosition {
  return { position: position_, positionType: undefined, kind, count: 1, eligibility: [position_] };
}

function player(providerPlayerKey: string, name: string, slot: string): ProviderRosterPlayer {
  return {
    providerPlayerKey,
    name,
    displayPosition: "C",
    primaryPosition: "C",
    positionType: "P",
    proTeamAbbreviation: "SYN",
    eligiblePositions: ["C"],
    slot: { status: "verified", slot },
    isEditable: true,
    injuryCode: undefined,
    injuryDetail: undefined,
    status: "healthy",
    byeWeek: null,
    scheduled: true,
    startingLineup: "unconfirmed",
    undroppable: null,
    transactionTrend: { status: "not_published", reason: "The test provider publishes no counts." },
  };
}
