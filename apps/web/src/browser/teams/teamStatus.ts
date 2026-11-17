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

export function teamStatusBadge(team: TeamSummaryView): TeamStatusBadge {
  const lastRun = teamLastRun(team);
  if (lastRun?.status === "queued") {
    return { label: "Waiting", tone: "neutral" };
  }
  if (lastRun !== undefined && runIsCheckingNow(lastRun.status)) {
    return { label: "Checking", tone: "accent" };
  }
  const automation = teamAutomation(team);
  switch (automation.status) {
    case "paused-until-fantasy-day-end":
      return { label: "Paused", tone: "neutral" };
    case "disabled":
      return { label: "Checks off", tone: "neutral" };
    case "enabled":
      return { label: "Checks on", tone: "accent" };
  }
}

export function teamStatusLine(team: TeamSummaryView, now: Date): string {
  const lastRun = teamLastRun(team);
  if (lastRun?.status === "queued") {
    return "A check is waiting to start.";
  }
  if (lastRun !== undefined && runIsCheckingNow(lastRun.status)) {
    return "Checking now. This usually takes under a minute.";
  }
  const automation = teamAutomation(team);
  switch (automation.status) {
    case "paused-until-fantasy-day-end":
      return automation.resumesAt === undefined
        ? "Paused for the rest of the fantasy day."
        : `Paused for the rest of the fantasy day · resumes at ${formatClockTime(automation.resumesAt)}`;
    case "disabled":
      return "Lineup checks are off. Turn them on to check this team hourly.";
    case "enabled":
      return `Next check at ${formatClockTime(nextScheduledCheck(now))}`;
  }
}

export type TeamStatusBadge = {
  readonly label: string;
  readonly tone: "accent" | "neutral";
};
