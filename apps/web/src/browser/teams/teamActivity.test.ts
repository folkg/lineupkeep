import { describe, expect, it } from "vitest";

import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type { LineupRunView } from "#contracts/connections/teamContract.ts";

import { groupRuns } from "./teamActivity";
import { checkTallyLabel, lastCheckLine, quietGroupSpan } from "./teamLabels";

const team = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1";
const now = new Date("2026-10-05T14:00:00.000Z");

describe("run activity", () => {
  it("folds consecutive runs that changed nothing", () => {
    const entries = groupRuns([
      changed("changed-1", "2026-10-05T12:00:00.000Z"),
      quiet("quiet-1", "2026-10-05T11:00:00.000Z"),
      quiet("quiet-2", "2026-10-05T10:00:00.000Z"),
      quiet("quiet-3", "2026-10-05T09:00:00.000Z"),
      failed("failed-1", "2026-10-05T08:00:00.000Z"),
    ]);

    expect(entries.map(summarize)).toEqual(["changed-1", 3, "failed-1"]);
  });

  it("splits quiet runs on either side of a change", () => {
    const entries = groupRuns([
      quiet("quiet-1", "2026-10-05T12:00:00.000Z"),
      quiet("quiet-2", "2026-10-05T11:00:00.000Z"),
      changed("changed-1", "2026-10-05T10:00:00.000Z"),
      quiet("quiet-3", "2026-10-05T09:00:00.000Z"),
      quiet("quiet-4", "2026-10-05T08:00:00.000Z"),
    ]);

    expect(entries.map(summarize)).toEqual([2, "changed-1", 2]);
  });

  it("folds every silent stretch in a day separately", () => {
    const entries = groupRuns([
      changed("changed-1", "2026-10-05T12:00:00.000Z"),
      quiet("quiet-1", "2026-10-05T11:00:00.000Z"),
      quiet("quiet-2", "2026-10-05T10:00:00.000Z"),
      changed("changed-2", "2026-10-05T09:00:00.000Z"),
      quiet("quiet-3", "2026-10-05T08:00:00.000Z"),
      quiet("quiet-4", "2026-10-05T07:00:00.000Z"),
      blocked("blocked-1", "2026-10-05T06:00:00.000Z"),
      quiet("quiet-5", "2026-10-05T05:00:00.000Z"),
      quiet("quiet-6", "2026-10-05T04:00:00.000Z"),
    ]);

    expect(entries.map(summarize)).toEqual(["changed-1", 2, "changed-2", 2, "blocked-1", 2]);
  });

  it("keeps a lone quiet run on its own", () => {
    const entries = groupRuns([quiet("quiet-1", "2026-10-05T12:00:00.000Z")]);

    expect(entries.map(summarize)).toEqual(["quiet-1"]);
  });

  it("never folds a blocked, failed, uncertain, or in-progress run", () => {
    for (const loud of [
      failed("failed-1", "2026-10-05T12:00:00.000Z"),
      blocked("blocked-1", "2026-10-05T12:00:00.000Z"),
      uncertain("uncertain-1", "2026-10-05T12:00:00.000Z"),
      inProgress("running-1", "2026-10-05T12:00:00.000Z"),
    ]) {
      expect(
        groupRuns([loud, quiet("quiet-1", "2026-10-05T11:00:00.000Z")]).map(summarize),
      ).toEqual([loud.run, "quiet-1"]);
    }
  });

  it("folds a skipped or superseded run that changed nothing", () => {
    expect(
      groupRuns([
        skipped("skipped-1", "2026-10-05T12:00:00.000Z"),
        superseded("superseded-1", "2026-10-05T11:00:00.000Z"),
      ]).map(summarize),
    ).toEqual([2]);
  });
});

describe("quiet group spans", () => {
  it("names the count and both ends of the group", () => {
    expect(
      quietGroupSpan([
        quiet("quiet-1", "2026-10-05T12:00:00.000Z"),
        quiet("quiet-2", "2026-10-05T09:00:00.000Z"),
      ]),
    ).toEqual({
      count: 2,
      from: "2026-10-05T09:00:00.000Z",
      to: "2026-10-05T12:00:00.000Z",
    });
  });

  it("keeps both ends when the group crosses a reader's midnight", () => {
    expect(
      quietGroupSpan([
        quiet("quiet-1", "2026-10-05T12:00:00.000Z"),
        quiet("quiet-2", "2026-10-03T09:00:00.000Z"),
      ]),
    ).toEqual({
      count: 2,
      from: "2026-10-03T09:00:00.000Z",
      to: "2026-10-05T12:00:00.000Z",
    });
  });
});

describe("last check lines", () => {
  it("says what the check did and how long ago it was", () => {
    expect(lastCheckLine(changed("changed-1", "2026-10-05T12:00:00.000Z"), now)).toBe(
      `Last check changed 2 players · ${formatReaderTime("2026-10-05T12:00:00.000Z", now)}`,
    );
    expect(lastCheckLine(quiet("quiet-1", "2026-10-05T12:00:00.000Z"), now)).toBe(
      `Last check changed nothing · ${formatReaderTime("2026-10-05T12:00:00.000Z", now)}`,
    );
  });

  it("says when a check is still running", () => {
    expect(lastCheckLine(inProgress("running-1", "2026-10-05T12:00:00.000Z"), now)).toBe(
      `Last check is setting the lineup · started ${formatReaderTime(
        "2026-10-05T12:00:00.000Z",
        now,
      )}`,
    );
  });
});

describe("check tallies", () => {
  it("stays quiet until a recent check changed the lineup", () => {
    expect(checkTallyLabel([])).toBeUndefined();
    expect(checkTallyLabel([quiet("quiet-1", "2026-10-05T12:00:00.000Z")])).toBeUndefined();
    expect(
      checkTallyLabel([
        quiet("quiet-1", "2026-10-05T12:00:00.000Z"),
        quiet("quiet-2", "2026-10-05T11:00:00.000Z"),
      ]),
    ).toBeUndefined();
  });

  it("counts the checks that changed the lineup", () => {
    expect(
      checkTallyLabel([
        changed("changed-1", "2026-10-05T12:00:00.000Z"),
        quiet("quiet-1", "2026-10-05T11:00:00.000Z"),
        quiet("quiet-2", "2026-10-05T10:00:00.000Z"),
      ]),
    ).toBe("1 of the last 3 checks changed the lineup");
    expect(
      checkTallyLabel([
        changed("changed-1", "2026-10-05T12:00:00.000Z"),
        changed("changed-2", "2026-10-05T11:00:00.000Z"),
      ]),
    ).toBe("The last 2 checks all changed the lineup");
  });
});

function summarize(entry: ReturnType<typeof groupRuns>[number]): string | number {
  return entry.type === "run" ? entry.run.run : entry.runs.length;
}

function quiet(run: string, updatedAt: string): LineupRunView {
  return runView(run, updatedAt, "completed", {
    kind: "no_op",
    verified: true,
    reconciled: false,
    summary: "The lineup already matched the plan.",
    observedAt: updatedAt,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 8,
  });
}

function changed(run: string, updatedAt: string): LineupRunView {
  return runView(run, updatedAt, "completed", {
    kind: "changed",
    verified: true,
    reconciled: false,
    summary: "Verified 2 native lineup changes.",
    observedAt: updatedAt,
    changes: [
      { name: "Sam Rivers", from: "BN", to: "WR" },
      { name: "Alex Vance", from: "BN", to: "RB" },
    ],
    lockedPlayers: 0,
    editablePlayers: 8,
  });
}

function failed(run: string, updatedAt: string): LineupRunView {
  return runView(run, updatedAt, "failed", {
    kind: "failed",
    verified: false,
    reconciled: false,
    summary: "The provider rejected the lineup.",
    observedAt: updatedAt,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 8,
  });
}

function blocked(run: string, updatedAt: string): LineupRunView {
  return runView(run, updatedAt, "blocked", {
    kind: "blocked",
    verified: false,
    reconciled: false,
    summary: "The lineup is not legal yet.",
    observedAt: updatedAt,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 8,
  });
}

function uncertain(run: string, updatedAt: string): LineupRunView {
  return runView(run, updatedAt, "uncertain", {
    kind: "uncertain",
    verified: false,
    reconciled: false,
    summary: "The provider response was lost.",
    observedAt: updatedAt,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 8,
  });
}

function skipped(run: string, updatedAt: string): LineupRunView {
  return runView(run, updatedAt, "skipped", {
    kind: "skipped",
    verified: false,
    reconciled: false,
    summary: "No action was needed.",
    observedAt: updatedAt,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 8,
  });
}

function superseded(run: string, updatedAt: string): LineupRunView {
  return runView(run, updatedAt, "superseded", {
    kind: "superseded",
    verified: false,
    reconciled: false,
    summary: "A later run replaced this one.",
    observedAt: updatedAt,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 8,
  });
}

function inProgress(run: string, updatedAt: string): LineupRunView {
  return runView(run, updatedAt, "applying", undefined);
}

function runView(
  run: string,
  updatedAt: string,
  status: LineupRunView["status"],
  outcome: LineupRunView["outcome"],
): LineupRunView {
  return {
    run,
    request: `${run}-request`,
    team,
    target: { coverage: "current" },
    trigger: "scheduled",
    implementation: "provider_native",
    implementationVersion: "1",
    status,
    attempts: 1,
    createdAt: updatedAt,
    updatedAt,
    ...(outcome === undefined ? {} : { outcome }),
  };
}
