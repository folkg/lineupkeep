import { expect, it } from "vitest";

import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type { TransactionMoveView } from "#contracts/connections/transactionContract.ts";

import {
  confirmationLine,
  discardLine,
  moveOutcomeLabel,
  scheduledRunLine,
  waitingOnLeagueLine,
} from "./transactionTimes.ts";

const reader = { locale: "en-US", timeZone: "America/New_York" } as const;

it("names a scheduled run at the 55 minute mark in the reader's local time", () => {
  expect(scheduledRunLine("2026-11-17", "2026-11-17T21:55:00.000Z", reader)).toBe(
    `Runs ${formatCalendarDate("2026-11-17")} at 4:55 PM`,
  );
});

it("shows the date when the moment is not today, in the reader's zone", () => {
  expect(
    confirmationLine(
      executed({ confirmation: { by: "owner", at: "2026-11-12T02:30:00.000Z" } }),
      reader,
      new Date("2026-11-12T18:00:00.000Z"),
    ),
  ).toBe("You confirmed this on Nov 11 at 9:30 PM.");
  expect(
    confirmationLine(
      executed({ confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" } }),
      reader,
      new Date("2026-11-11T18:00:00.000Z"),
    ),
  ).toBe("You confirmed this on 12:35 PM.");
  expect(
    confirmationLine(
      executed({ confirmation: { by: "owner", at: "2025-11-11T17:35:00.000Z" } }),
      reader,
      new Date("2026-11-11T18:00:00.000Z"),
    ),
  ).toBe("You confirmed this on Nov 11, 2025 at 12:35 PM.");
});

it("keeps one confirmation line apart from the run outcome", () => {
  const move = executed({
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    runAt: "2026-11-11T18:05:00.000Z",
  });
  expect(confirmationLine(move, reader, new Date("2026-11-17T12:00:00.000Z"))).toBe(
    "You confirmed this on Nov 11 at 12:35 PM.",
  );
  expect(moveOutcomeLabel(move)).toBe("Ran when you confirmed");
});

it("names the run outcome without inventing a time", () => {
  expect(moveOutcomeLabel(executed({ runDecidedBy: "system" }))).toBe("Ran on schedule");
  expect(moveOutcomeLabel(executed({}))).toBe("You changed this");
  expect(moveOutcomeLabel(executed({ runDecidedBy: "agent" }))).toBe("An agent changed this");
  expect(moveOutcomeLabel(executed({ result: "pending" }))).toBe("Waiting");
  expect(moveOutcomeLabel(executed({ result: "failed" }))).toBe("Failed");
});

it("lets a discard win over every recorded result", () => {
  expect(moveOutcomeLabel(executed({ decision: "discarded", result: "failed" }))).toBe("Discarded");
  expect(
    discardLine(
      executed({
        decision: "discarded",
        decidedAt: "2026-11-10T15:10:00.000Z",
        decidedBy: "owner",
        result: "failed",
      }),
      reader,
      new Date("2026-11-17T12:00:00.000Z"),
    ),
  ).toBe("You discarded this on Nov 10 at 10:10 AM.");
});

it("names the league's next run while a waiver waits", () => {
  expect(
    waitingOnLeagueLine("2026-11-17T21:55:00.000Z", reader, new Date("2026-11-17T18:00:00.000Z")),
  ).toBe("Waiting on the league until 4:55 PM.");
});

function executed(overrides: Partial<TransactionMoveView>): TransactionMoveView {
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
    runDecidedBy: "owner",
    ...overrides,
  };
}
