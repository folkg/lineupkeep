import { expect, it } from "vitest";

import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type { TransactionMoveView } from "#contracts/connections/transactionContract.ts";

import {
  formatLocalDate,
  groupTimingLine,
  moveTimingLine,
  scheduledRunLine,
} from "./transactionTimes.ts";

const reader = { locale: "en-US", timeZone: "America/New_York" } as const;

it("renders the exact run time in the reader's chosen zone", () => {
  expect(
    moveTimingLine({
      move: executed("2026-11-11T21:32:00.000Z", "owner"),
      today: false,
      nextRunAt: undefined,
      reader,
    }),
  ).toBe("Ran now at 4:32 PM");
  expect(
    moveTimingLine({
      move: executed("2026-11-17T21:55:00.000Z", "system"),
      today: false,
      nextRunAt: undefined,
      reader,
    }),
  ).toBe("Ran on schedule at 4:55 PM");
  expect(scheduledRunLine("2026-11-17", "2026-11-17T21:55:00.000Z", reader)).toBe(
    `Runs ${formatCalendarDate("2026-11-17")} at 4:55 PM`,
  );
});

it("keeps dates in the reader's zone beside the scheduled clock", () => {
  expect(formatLocalDate("2026-11-12T02:30:00.000Z", reader)).toBe("November 11");
});

it("says when a later group runs and that a today group runs now", () => {
  expect(
    groupTimingLine({
      today: false,
      runDay: "2026-11-17",
      confirmed: true,
      nextRunAt: "2026-11-17T21:55:00.000Z",
      reader,
    }),
  ).toBe(`Runs ${formatCalendarDate("2026-11-17")} at 4:55 PM`);
  expect(
    groupTimingLine({
      today: true,
      runDay: "2026-11-17",
      confirmed: false,
      nextRunAt: "2026-11-17T21:55:00.000Z",
      reader,
    }),
  ).toBe("Confirming runs this group now");
});

function executed(runAt: string, runDecidedBy: "owner" | "system"): TransactionMoveView {
  return {
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b1",
    team: {
      id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1",
      name: "Alpha",
      league: "nfl",
      sport: "football",
      season: 2026,
    },
    kind: "drop",
    position: 0,
    decision: "now",
    reason: "Make the roster change.",
    adds: [],
    fallbacks: [],
    drops: [{ name: "Riley Chen" }],
    picks: [],
    validation: { status: "current", reasons: [] },
    check: { status: "checked" },
    result: "executed",
    runAt,
    runDecidedBy,
  };
}
