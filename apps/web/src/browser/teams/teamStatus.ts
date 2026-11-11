import { formatClockTime } from "#browser/shared-ui/formatTime.ts";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { runIsCheckingNow } from "./teamLabels";

const hourlyCheckMinuteUtc = 55;

export function nextScheduledCheck(at: Date): Date {
  const next = new Date(at.getTime());
  next.setUTCMinutes(hourlyCheckMinuteUtc, 0, 0);
  if (next.getTime() <= at.getTime()) {
    next.setUTCHours(next.getUTCHours() + 1);
  }
  return next;
}

export function teamStatusLine(team: TeamSummaryView, now: Date): string {
  if (team.lastRun?.status === "queued") {
    return "A check is waiting to start.";
  }
  if (team.lastRun !== undefined && runIsCheckingNow(team.lastRun.status)) {
    return "Checking now. This usually takes under a minute.";
  }
  const automation = team.team.automation;
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
