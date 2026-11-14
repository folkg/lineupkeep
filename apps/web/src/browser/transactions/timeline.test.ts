import { expect, it } from "vitest";

import type {
  TransactionProposalItemView,
  TransactionProposalSetSummaryView,
  TransactionRunGroupView,
} from "#contracts/connections/transactionContract.ts";

import { buildTimeline, nextRunDate } from "./timeline";

const today = "2026-11-13";
const now = "2026-11-13T18:00:00.000Z";
const alpha = {
  id: "team-alpha",
  name: "Alpha",
  league: "nfl" as const,
  sport: "football" as const,
  season: 2026,
};
const beta = {
  id: "team-beta",
  name: "Beta",
  league: "nhl" as const,
  sport: "hockey" as const,
  season: 2026,
};

it("groups open moves by run day across teams and keeps ended moves apart", () => {
  const todayItem = item({ id: "today", drops: [player("Riley Chen")] });
  const futureItem = item({ id: "future", window: "2026-11-15", lifecycle: "scheduled" });
  const endedItem = item({
    id: "ended",
    state: "executed",
    lifecycle: "executed",
    settled: true,
  });
  const timeline = buildTimeline(
    [
      set({
        id: "one",
        teams: [
          {
            team: alpha,
            today,
            items: [todayItem, endedItem],
            groups: [
              day([todayItem.id], today, "same_day"),
              day([endedItem.id], today, "same_day"),
            ],
          },
        ],
      }),
      set({
        id: "two",
        teams: [
          {
            team: beta,
            today,
            items: [futureItem],
            groups: [day([futureItem.id], "2026-11-15", "next_day")],
          },
        ],
      }),
    ],
    [],
  );

  expect(
    timeline.today.map((group) => [group.team.name, group.items.map((entry) => entry.id)]),
  ).toEqual([["Alpha", ["today"]]]);
  expect(
    timeline.future.map((day) => [
      day.date,
      day.groups.map((group) => [group.team.name, group.items.map((entry) => entry.id)]),
    ]),
  ).toEqual([["2026-11-15", [["Beta", ["future"]]]]]);
  expect(timeline.earlier.map((entry) => [entry.team.name, entry.item.id])).toEqual([
    ["Alpha", "ended"],
  ]);
});

it("puts a move without a run day in today when the read carries no groups", () => {
  const immediate = item({ id: "immediate", drops: [player("Riley Chen")] });
  const saved = item({ id: "saved", window: "2026-11-15", lifecycle: "scheduled" });
  const timeline = buildTimeline(
    [
      set({
        id: "one",
        teams: [{ team: alpha, today, items: [immediate, saved] }],
      }),
    ],
    [],
  );

  expect(timeline.today.flatMap((group) => group.items.map((entry) => entry.id))).toEqual([
    "immediate",
  ]);
  expect(
    timeline.future.flatMap((day) =>
      day.groups.flatMap((group) => group.items.map((entry) => entry.id)),
    ),
  ).toEqual(["saved"]);
});

it("adds one day to a league date", () => {
  expect(nextRunDate("2026-11-13")).toBe("2026-11-14");
  expect(nextRunDate("2026-12-31")).toBe("2027-01-01");
});

function set(
  overrides: Partial<TransactionProposalSetSummaryView> & {
    readonly teams: ReadonlyArray<TransactionProposalSetSummaryView["teams"][number]>;
  },
): TransactionProposalSetSummaryView {
  return {
    id: "set",
    proposedBy: { kind: "agent", surface: "mcp" },
    createdAt: now,
    updatedAt: now,
    closed: false,
    reviewPath: "/transactions/set",
    ...overrides,
  };
}

function day(
  items: ReadonlyArray<string>,
  date: string,
  effectiveRule: TransactionRunGroupView["effectiveRule"],
): TransactionRunGroupView {
  return {
    date,
    triggerAt: `${date}T08:00:00.000Z`,
    timeZone: "America/Los_Angeles",
    effectiveRule,
    items,
  };
}

function item(overrides: Partial<TransactionProposalItemView> = {}): TransactionProposalItemView {
  return {
    id: "item",
    kind: "drop",
    adds: [],
    drops: [player("Riley Chen")],
    picks: [],
    reason: "Drop the open place.",
    state: "proposed",
    lifecycle: "proposed",
    budgetPeriod: { status: "none", detail: "No bid." },
    settled: false,
    staleness: { status: "current", checkedAt: now, reasons: [] },
    ...overrides,
  };
}

function player(name: string): TransactionProposalItemView["adds"][number] {
  return { name };
}
