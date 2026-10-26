import type { LineupRunView, TeamSummaryView } from "#contracts/connections/teamContract.ts";

export function automationLabel(team: TeamSummaryView): string {
  switch (team.team.automation.status) {
    case "disabled":
      return "Automation off";
    case "enabled":
      return "Automation on";
    case "paused-until-fantasy-day-end":
      return "Paused for the rest of this fantasy day";
  }
}

export function availabilityLabel(team: TeamSummaryView): string {
  return team.team.availability === "available" ? "Team available" : "Team unavailable";
}

export function connectionLabel(team: TeamSummaryView): string {
  switch (team.connectionStatus) {
    case "ready":
      return "Yahoo connected";
    case "reconnect-required":
      return "Reconnect Yahoo";
    case "linking":
      return "Yahoo pairing in progress";
    case "disconnected":
      return "Yahoo disconnected";
  }
}

export function pauseResumeLabel(team: TeamSummaryView): string | undefined {
  if (team.team.automation.status !== "paused-until-fantasy-day-end") {
    return undefined;
  }
  if (team.team.automation.resumesAt === undefined) {
    return "Resumes at the next fantasy day.";
  }
  const resumes = new Date(team.team.automation.resumesAt);
  const zone = team.team.automation.timeZone;
  if (zone === undefined) {
    return `Resumes ${formatDateTime(resumes)}.`;
  }
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  }).format(resumes);
  return `Resumes ${formatted} ${zone}.`;
}

export function runStatusLabel(status: LineupRunView["status"]): string {
  switch (status) {
    case "queued":
      return "Waiting to start";
    case "reading":
      return "Reading lineup";
    case "planning":
      return "Planning";
    case "validating":
      return "Validating";
    case "applying":
      return "Applying";
    case "verifying":
      return "Verifying";
    case "completed":
      return "Completed";
    case "skipped":
      return "No action needed";
    case "blocked":
      return "Blocked";
    case "retry-wait":
      return "Waiting to retry";
    case "failed":
      return "Failed";
    case "uncertain":
      return "Needs reconciliation";
    case "superseded":
      return "Superseded";
  }
}

export function runExplanation(run: LineupRunView): string {
  if (run.outcome !== undefined) {
    return run.outcome.summary;
  }
  if (run.pending !== undefined) {
    return run.pending.detail;
  }
  switch (run.status) {
    case "queued":
      return "Accepted into the queue. The lineup has not been checked yet.";
    case "reading":
    case "planning":
    case "validating":
    case "applying":
    case "verifying":
      return "The run is in progress. Its result is not confirmed yet.";
    case "completed":
    case "skipped":
    case "blocked":
    case "failed":
    case "uncertain":
    case "superseded":
      return "No outcome explanation is available.";
    case "retry-wait":
      return "Waiting for a safe retry window.";
  }
}

export function targetLabel(target: LineupRunView["target"]): string {
  switch (target.coverage) {
    case "current":
      return "Current scoring period";
    case "week":
      return `Week ${String(target.week)}`;
    case "date":
      return target.date;
  }
}

export function triggerLabel(run: LineupRunView): string {
  return run.trigger === "scheduled" ? "Hourly automation" : "Manual run";
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
