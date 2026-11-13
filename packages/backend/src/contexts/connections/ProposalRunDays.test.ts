import { assert, it } from "@effect/vitest";
import { DateTime } from "effect";

import { proposalRunDayGroups } from "./ProposalRunDays.ts";

const fantasyDay = {
  timeZone: "America/Los_Angeles",
  boundary: "local-midnight" as const,
  version: "yahoo-pacific-midnight/1",
};

it("puts today first, then later dates in order, with a move without a window under today", () => {
  const groups = proposalRunDayGroups({
    items: [
      { id: "later", window: "2026-11-14" },
      { id: "no-window" },
      { id: "sooner", window: "2026-11-02" },
      { id: "today", window: "2026-10-31" },
      { id: "overdue", window: "2026-10-30" },
    ],
    today: "2026-10-31",
    effectiveRule: "next_day",
    fantasyDay,
  });

  assert.deepStrictEqual(
    groups.map((group) => [group.date, group.effectiveRule, group.items.map((item) => item.id)]),
    [
      ["2026-10-31", "next_day", ["no-window", "today", "overdue"]],
      ["2026-11-02", "next_day", ["sooner"]],
      ["2026-11-14", "next_day", ["later"]],
    ],
  );
  assert.deepStrictEqual(
    groups.map((group) => DateTime.formatIso(group.triggerAt)),
    ["2026-10-31T07:00:00.000Z", "2026-11-02T08:00:00.000Z", "2026-11-14T08:00:00.000Z"],
  );
});

it("omits a day with no move rather than inventing an empty group", () => {
  const groups = proposalRunDayGroups({
    items: [{ id: "later", window: "2026-11-14" }],
    today: "2026-11-12",
    effectiveRule: "not_published",
    fantasyDay,
  });

  assert.deepStrictEqual(
    groups.map((group) => group.date),
    ["2026-11-14"],
  );
});
