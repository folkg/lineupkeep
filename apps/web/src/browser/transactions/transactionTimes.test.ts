import { EffectArray } from "@lineupkeep/collections";
import { expect, it } from "vitest";

import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type { TransactionMoveView } from "#contracts/connections/transactionContract.ts";

import {
  discardLine,
  moveOutcome,
  moveOutcomeLabel,
  plannedMoment,
  submittedLine,
  timingLine,
} from "./transactionTimes.ts";

const reader = { locale: "en-US", timeZone: "America/New_York" } as const;
const sendsAt = "2026-11-17T21:55:00.000Z";

it("names a scheduled moment in the reader's local time", () => {
  expect(plannedMoment(sendsAt, reader)).toBe("Nov 17 at 4:55 PM");
});

it("shows the day of a submission, in the reader's zone and never as a bare clock", () => {
  expect(
    submittedLine(
      executed({ confirmation: { by: "owner", at: "2026-11-12T02:30:00.000Z" } }),
      reader,
      new Date("2026-11-12T18:00:00.000Z"),
    ),
  ).toBe("You submitted this on Nov 11 at 9:30 PM.");
  expect(
    submittedLine(
      executed({ confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" } }),
      reader,
      new Date("2026-11-11T18:00:00.000Z"),
    ),
  ).toBe("You submitted this on Nov 11 at 12:35 PM.");
  expect(
    submittedLine(
      executed({ confirmation: { by: "owner", at: "2025-11-11T17:35:00.000Z" } }),
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
        effectiveDate: "2026-11-18",
        sendsAt,
        confirmation: { by: "owner", at: "2026-11-16T13:55:00.000Z" },
      }),
      reader,
      new Date("2026-11-17T12:00:00.000Z"),
    ),
  ).toBe("Scheduled on Nov 16 at 8:55 AM to run Nov 17 at 4:55 PM.");
});

it("dates a later day's claim without the hourly run time", () => {
  const claim = executed({
    kind: "waiver_claim",
    phase: "with_league",
    decision: "confirmed",
    runDay: "2026-11-17",
    sendsAt,
    confirmation: { by: "owner", at: "2026-11-16T13:55:00.000Z" },
  });
  expect(submittedLine(claim, reader, new Date("2026-11-17T12:00:00.000Z"))).toBe(
    "Scheduled on Nov 16 at 8:55 AM to run Nov 17 at 4:55 PM.",
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
  ).toBe("Claim lost");
  expect(
    moveOutcomeLabel(
      executed({
        kind: "waiver_claim",
        phase: "lost",
        result: "failed",
        attempts: [
          {
            kind: "fallback",
            player: { name: "Amon-Ra St. Brown" },
            outcome: "failed",
            reason: "The league refused the fallback.",
            at: "2026-11-18T12:00:00.000Z",
          },
        ],
      }),
    ),
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
  ).toBe(`Took effect ${formatCalendarDate("2026-11-18")}.`);
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
  ).toBe(`Runs when you confirm. Takes effect ${formatCalendarDate("2026-11-15")}.`);
  expect(
    timingLine(
      executed({
        kind: "free_agent_add",
        decision: "confirmed",
        result: undefined,
        runDay: "2026-11-17",
        effectiveDate: "2026-11-18",
        sendsAt,
      }),
      reader,
    ),
  ).toBe(`Runs Nov 17 at 4:55 PM. Takes effect ${formatCalendarDate("2026-11-18")}.`);
});

it("keeps one submission line apart from the run outcome", () => {
  const move = executed({
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    runAt: "2026-11-11T18:05:00.000Z",
  });
  expect(submittedLine(move, reader, new Date("2026-11-17T12:00:00.000Z"))).toBe(
    "You submitted this on Nov 11 at 12:35 PM.",
  );
  expect(moveOutcomeLabel(move)).toBe("Ran immediately");
});

it("names the run outcome without inventing a time", () => {
  expect(moveOutcomeLabel(executed({ runDecidedBy: "system" }))).toBe("Ran on schedule");
  expect(moveOutcomeLabel(executed({}))).toBe("Ran immediately");
  expect(moveOutcomeLabel(executed({ runDecidedBy: "owner" }))).toBe("Ran immediately");
  expect(moveOutcomeLabel(executed({ kind: "trade", result: "pending" }))).toBe("Offer sent");
  expect(moveOutcomeLabel(executed({ result: "failed" }))).toBe("Failed");
});

it("gives every recorded outcome an icon and a tooltip", () => {
  const cases: ReadonlyArray<{
    readonly status: TransactionMoveView["status"];
    readonly label: string;
    readonly icon: ReturnType<typeof moveOutcome> extends infer Outcome
      ? Outcome extends { readonly icon: infer Icon }
        ? Icon
        : never
      : never;
  }> = [
    { status: "ran_immediately", label: "Ran immediately", icon: "check" },
    { status: "ran_on_schedule", label: "Ran on schedule", icon: "clock-check" },
    { status: "claim_waiting", label: "With the league", icon: "hourglass" },
    { status: "claim_won", label: "Claim won", icon: "badge-check" },
    { status: "claim_lost", label: "Claim lost", icon: "circle-slash" },
    {
      status: "claim_lost_fallback_ran",
      label: "Claim lost, fallback ran",
      icon: "iteration-ccw",
    },
    {
      status: "claim_lost_retrying",
      label: "Claim lost, retrying",
      icon: "rotate-cw",
    },
    { status: "all_choices_failed", label: "All choices failed", icon: "x" },
    { status: "fallback_unknown", label: "Unknown outcome", icon: "circle-question-mark" },
    { status: "offer_sent", label: "Offer sent", icon: "send-horizontal" },
    { status: "failed", label: "Failed", icon: "x" },
    { status: "skipped", label: "Skipped", icon: "skip-forward" },
    { status: "unknown", label: "Unknown outcome", icon: "circle-question-mark" },
    { status: "discarded", label: "Discarded", icon: "ban" },
  ];

  for (const entry of cases) {
    expect(moveOutcome(executed({ status: entry.status }))).toMatchObject({
      label: entry.label,
      icon: entry.icon,
    });
  }
  for (const status of ["open_undecided", "open_saved", "open_now", "open_confirmed"] as const) {
    expect(moveOutcome(executed({ status }))).toBeUndefined();
  }
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

function fixtureStatus(move: Omit<TransactionMoveView, "status">): TransactionMoveView["status"] {
  if (move.decision === "discarded") {
    return "discarded";
  }
  switch (move.phase) {
    case "with_league":
      return "claim_waiting";
    case "won":
      return "claim_won";
    case "lost":
      switch (move.result) {
        case "executed":
          return "claim_lost_fallback_ran";
        case "pending":
          return "claim_lost_retrying";
        case "unknown":
          return "fallback_unknown";
        case "failed":
          return EffectArray.some(move.attempts, (attempt) => attempt.kind === "fallback")
            ? "all_choices_failed"
            : "claim_lost";
        case "skipped":
          return "skipped";
        case undefined:
          return "claim_lost";
      }
      break;
    case undefined:
      break;
  }
  switch (move.result) {
    case "executed":
      return move.runDecidedBy === "system" ? "ran_on_schedule" : "ran_immediately";
    case "pending":
      return move.kind === "trade" ? "offer_sent" : "open_now";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "unknown":
      return "unknown";
    case undefined:
      switch (move.decision) {
        case "undecided":
          return "open_undecided";
        case "saved":
          return "open_saved";
        case "now":
          return "open_now";
        case "confirmed":
          return "open_confirmed";
      }
  }
}

function executed(overrides: Partial<TransactionMoveView>): TransactionMoveView {
  const base: Omit<TransactionMoveView, "status"> = {
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
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    status: overrides.status ?? fixtureStatus(merged),
  };
}
