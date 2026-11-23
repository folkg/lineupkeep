import { formatClockTime } from "#browser/shared-ui/formatTime.ts";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { runIsCheckingNow } from "./teamLabels";
import { teamAutomation, teamLastRun } from "./teamPending";

const hourlyCheckMinuteUtc = 55;

export function nextScheduledCheck(at: Date): Date {
  const next = new Date(at.getTime());
  next.setUTCMinutes(hourlyCheckMinuteUtc, 0, 0);
  if (next.getTime() <= at.getTime()) {
    next.setUTCHours(next.getUTCHours() + 1);
  }
  return next;
}

export type CheckStatus = {
  readonly value: string;
  readonly note?: string;
};

export function nextCheckStatus(team: TeamSummaryView, now: Date): CheckStatus {
  const lastRun = teamLastRun(team);
  if (lastRun?.status === "queued") {
    return { value: "Waiting to start", note: "Queued for the next check." };
  }
  if (lastRun !== undefined && runIsCheckingNow(lastRun.status)) {
    return { value: "Checking now", note: "Usually under a minute." };
  }
  const automation = teamAutomation(team);
  switch (automation.status) {
    case "paused-until-fantasy-day-end":
      return {
        value: "Paused today",
        note:
          automation.resumesAt === undefined
            ? "Resumes after the fantasy day."
            : `Resumes at ${formatClockTime(automation.resumesAt)}`,
      };
    case "disabled":
      return { value: "Checks are off", note: "Turn them on to check hourly." };
    case "enabled":
      return { value: formatClockTime(nextScheduledCheck(now)), note: "Scheduled hourly." };
  }
}
