import { expect, it } from "vitest";

import type {
  TransactionProposalItemView,
  TransactionProposalSetSummaryView,
  TransactionRunGroupView,
} from "#contracts/connections/transactionContract.ts";

import { buildTimeline, dayMoveTotal, nextRunDate } from "./timeline";

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
const gamma = {
  id: "team-gamma",
  name: "Gamma",
  league: "nba" as const,
  sport: "basketball" as const,
  season: 2026,
};

it("groups open moves by day and then by team while keeping ended moves apart", () => {
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

  expect(timeline.today.teams.map((card) => card.team.name)).toEqual(["Alpha"]);
  expect(timeline.today.teams.map((card) => card.moves.map((move) => move.item.id))).toEqual([
    ["today"],
  ]);
  expect(timeline.future.map((day) => day.date)).toEqual(["2026-11-15"]);
  expect(timeline.future[0]?.teams.map((card) => card.team.name)).toEqual(["Beta"]);
  expect(timeline.future[0]?.teams[0]?.moves.map((move) => move.item.id)).toEqual(["future"]);
  expect(timeline.earlier.map((entry) => [entry.team.name, entry.item.id])).toEqual([
    ["Alpha", "ended"],
  ]);
});

it("puts one team's moves from more than one plan in the same day card", () => {
  const firstToday = item({ id: "first-today" });
  const secondToday = item({ id: "second-today" });
  const firstFuture = item({ id: "first-future", window: "2026-11-15" });
  const secondFuture = item({ id: "second-future", window: "2026-11-15" });
  const timeline = buildTimeline(
    [
      set({
        id: "one",
        teams: [
          {
            team: alpha,
            today,
            items: [firstToday, firstFuture],
            groups: [
              day([firstToday.id], today, "same_day"),
              day([firstFuture.id], "2026-11-15", "next_day"),
            ],
          },
        ],
      }),
      set({
        id: "two",
        teams: [
          {
            team: alpha,
            today,
            items: [secondToday, secondFuture],
            groups: [
              day([secondToday.id], today, "same_day"),
              day([secondFuture.id], "2026-11-15", "next_day"),
            ],
          },
        ],
      }),
    ],
    [],
  );

  expect(timeline.today.teams).toHaveLength(1);
  expect(timeline.today.teams[0]?.moves.map((move) => move.item.id)).toEqual([
    "first-today",
    "second-today",
  ]);
  expect(timeline.future).toHaveLength(1);
  expect(timeline.future[0]?.teams).toHaveLength(1);
  expect(timeline.future[0]?.teams[0]?.moves.map((move) => move.item.id)).toEqual([
    "first-future",
    "second-future",
  ]);
  expect(timeline.future[0]?.teams[0]?.moves.map((move) => move.set)).toEqual(["one", "two"]);
});

it("sorts future days by date and teams inside each day by name", () => {
  const laterBeta = item({ id: "later-beta", window: "2026-11-16" });
  const soonGamma = item({ id: "soon-gamma", window: "2026-11-15" });
  const soonAlpha = item({ id: "soon-alpha", window: "2026-11-15" });
  const timeline = buildTimeline(
    [
      set({
        id: "one",
        teams: [
          {
            team: beta,
            today,
            items: [laterBeta],
            groups: [day([laterBeta.id], "2026-11-16", "next_day")],
          },
          {
            team: gamma,
            today,
            items: [soonGamma],
            groups: [day([soonGamma.id], "2026-11-15", "next_day")],
          },
          {
            team: alpha,
            today,
            items: [soonAlpha],
            groups: [day([soonAlpha.id], "2026-11-15", "next_day")],
          },
        ],
      }),
    ],
    [],
  );

  expect(timeline.future.map((day) => [day.date, day.teams.map((team) => team.team.name)])).toEqual(
    [
      ["2026-11-15", ["Alpha", "Gamma"]],
      ["2026-11-16", ["Beta"]],
    ],
  );
});

it("keeps each move's effective rule with the move when a team shares a day", () => {
  const sameDay = item({ id: "same-day", window: "2026-11-15" });
  const nextDay = item({ id: "next-day", window: "2026-11-15" });
  const timeline = buildTimeline(
    [
      set({
        id: "one",
        teams: [
          {
            team: alpha,
            today,
            items: [sameDay, nextDay],
            groups: [
              day([sameDay.id], "2026-11-15", "same_day"),
              day([nextDay.id], "2026-11-15", "next_day"),
            ],
          },
        ],
      }),
    ],
    [],
  );

  expect(
    timeline.future[0]?.teams[0]?.moves.map((move) => [move.item.id, move.effectiveRule]),
  ).toEqual([
    ["same-day", "same_day"],
    ["next-day", "next_day"],
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

  expect(timeline.today.teams.flatMap((card) => card.moves.map((move) => move.item.id))).toEqual([
    "immediate",
  ]);
  expect(
    timeline.future.flatMap((day) => day.teams.flatMap((card) => card.moves.map((m) => m.item.id))),
  ).toEqual(["saved"]);
  expect(dayMoveTotal(timeline.today)).toBe(1);
  expect(timeline.future.reduce((total, day) => total + dayMoveTotal(day), 0)).toBe(1);
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
