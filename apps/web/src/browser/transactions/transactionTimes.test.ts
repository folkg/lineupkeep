import { expect, it } from "vitest";

import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type { TransactionMoveView } from "#contracts/connections/transactionContract.ts";

import {
  discardLine,
  moveOutcomeLabel,
  scheduledMoment,
  submittedLine,
  timingLine,
} from "./transactionTimes.ts";

const reader = { locale: "en-US", timeZone: "America/New_York" } as const;
const nextRunAt = "2026-11-17T21:55:00.000Z";

it("names a scheduled moment at the 55 minute mark in the reader's local time", () => {
  expect(scheduledMoment("2026-11-17", nextRunAt, reader)).toBe(
    `${formatCalendarDate("2026-11-17")} at 4:55 PM`,
  );
});

it("shows the day of a submission, in the reader's zone and never as a bare clock", () => {
  expect(
    submittedLine(
      executed({ confirmation: { by: "owner", at: "2026-11-12T02:30:00.000Z" } }),
      nextRunAt,
      reader,
      new Date("2026-11-12T18:00:00.000Z"),
    ),
  ).toBe("You submitted this on Nov 11 at 9:30 PM.");
  expect(
    submittedLine(
      executed({ confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" } }),
      nextRunAt,
      reader,
      new Date("2026-11-11T18:00:00.000Z"),
    ),
  ).toBe("You submitted this on Nov 11 at 12:35 PM.");
  expect(
    submittedLine(
      executed({ confirmation: { by: "owner", at: "2025-11-11T17:35:00.000Z" } }),
      nextRunAt,
      reader,
      new Date("2026-11-11T18:00:00.000Z"),
    ),
  ).toBe("You submitted this on Nov 11, 2025 at 12:35 PM.");
});

it("dates a later day's submission and the day it runs", () => {
  expect(
    submittedLine(
      executed({
        decision: "confirmed",
        runDay: "2026-11-17",
        confirmation: { by: "owner", at: "2026-11-16T13:55:00.000Z" },
      }),
      nextRunAt,
      reader,
      new Date("2026-11-17T12:00:00.000Z"),
    ),
  ).toBe(`Scheduled on Nov 16 at 8:55 AM for ${formatCalendarDate("2026-11-17")} at 4:55 PM.`);
});

it("dates a later day's claim without the hourly run time", () => {
  const claim = executed({
    kind: "waiver_claim",
    phase: "with_league",
    decision: "confirmed",
    runDay: "2026-11-17",
    confirmation: { by: "owner", at: "2026-11-16T13:55:00.000Z" },
  });
  expect(submittedLine(claim, nextRunAt, reader, new Date("2026-11-17T12:00:00.000Z"))).toBe(
    `Scheduled on Nov 16 at 8:55 AM for ${formatCalendarDate("2026-11-17")}.`,
  );
  expect(moveOutcomeLabel(claim)).toBe("With the league");
  expect(
    moveOutcomeLabel(executed({ kind: "waiver_claim", phase: "won", result: "executed" })),
  ).toBe("Claim won");
  expect(
    moveOutcomeLabel(executed({ kind: "free_agent_add", phase: "lost", result: "executed" })),
  ).toBe("Claim lost, fallback ran");
  expect(
    moveOutcomeLabel(executed({ kind: "waiver_claim", phase: "lost", result: "failed" })),
  ).toBe("All choices failed");
});

it("dates a claim only once the league awards it", () => {
  expect(
    timingLine(
      executed({
        kind: "waiver_claim",
        phase: "with_league",
        decision: "now",
        result: "pending",
        runDay: "2026-11-17",
        effectiveDate: "2026-11-18",
      }),
    ),
  ).toBeUndefined();
  expect(
    timingLine(
      executed({
        kind: "waiver_claim",
        phase: "lost",
        decision: "now",
        result: "failed",
        runDay: "2026-11-17",
        effectiveDate: "2026-11-18",
      }),
    ),
  ).toBeUndefined();
  expect(
    timingLine(
      executed({
        kind: "waiver_claim",
        phase: "won",
        decision: "now",
        result: "executed",
        runDay: "2026-11-17",
        effectiveDate: "2026-11-18",
      }),
    ),
  ).toBe(`Takes effect ${formatCalendarDate("2026-11-18")}.`);
  expect(
    timingLine(
      executed({
        kind: "free_agent_add",
        decision: "confirmed",
        result: undefined,
        runDay: "2026-11-14",
        effectiveDate: "2026-11-15",
      }),
    ),
  ).toBe(`Takes effect ${formatCalendarDate("2026-11-15")}.`);
});

it("keeps one submission line apart from the run outcome", () => {
  const move = executed({
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    runAt: "2026-11-11T18:05:00.000Z",
  });
  expect(submittedLine(move, nextRunAt, reader, new Date("2026-11-17T12:00:00.000Z"))).toBe(
    "You submitted this on Nov 11 at 12:35 PM.",
  );
  expect(moveOutcomeLabel(move)).toBe("Ran after you submitted");
});

it("names the run outcome without inventing a time", () => {
  expect(moveOutcomeLabel(executed({ runDecidedBy: "system" }))).toBe("Ran on schedule");
  expect(moveOutcomeLabel(executed({}))).toBe("Ran after you submitted");
  expect(moveOutcomeLabel(executed({ runDecidedBy: "owner" }))).toBe("Ran after you submitted");
  expect(moveOutcomeLabel(executed({ result: "pending" }))).toBe("Waiting for the league");
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
    attempts: [],
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
