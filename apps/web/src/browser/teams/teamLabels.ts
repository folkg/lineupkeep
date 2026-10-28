import { providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type { LineupRunView, TeamSummaryView } from "#contracts/connections/teamContract.ts";

export function automationLabel(team: TeamSummaryView): string {
  switch (team.team.automation.status) {
    case "disabled":
      return "Lineup checks off";
    case "enabled":
      return "Lineup checks on";
    case "paused-until-fantasy-day-end":
      return "Paused until the end of the fantasy day";
  }
}

export function automationStateLabel(team: TeamSummaryView): string {
  switch (team.team.automation.status) {
    case "disabled":
      return "Off";
    case "enabled":
      return "On";
    case "paused-until-fantasy-day-end":
      return "Paused";
  }
}

export function availabilityLabel(team: TeamSummaryView): string {
  return team.team.availability === "available"
    ? `${providerDisplayName(team.team.provider)} lists this team`
    : `${providerDisplayName(team.team.provider)} no longer lists this team`;
}

export function connectionLabel(team: TeamSummaryView): string {
  switch (team.connectionStatus) {
    case "ready":
      return `${providerDisplayName(team.team.provider)} connected`;
    case "reconnect-required":
      return `Reconnect ${providerDisplayName(team.team.provider)}`;
    case "linking":
      return `${providerDisplayName(team.team.provider)} sign-in in progress`;
    case "disconnected":
      return `${providerDisplayName(team.team.provider)} disconnected`;
  }
}

export function connectionStateLabel(team: TeamSummaryView): string {
  switch (team.connectionStatus) {
    case "ready":
      return "Connected";
    case "reconnect-required":
      return "Reconnect needed";
    case "linking":
      return "Sign-in in progress";
    case "disconnected":
      return "Disconnected";
  }
}

export function pauseResumeLabel(team: TeamSummaryView): string | undefined {
  if (team.team.automation.status !== "paused-until-fantasy-day-end") {
    return undefined;
  }
  if (team.team.automation.resumesAt === undefined) {
    return "Lineup checks resume at the start of the next fantasy day.";
  }
  const resumes = new Date(team.team.automation.resumesAt);
  const zone = team.team.automation.timeZone;
  if (zone === undefined) {
    return `Lineup checks resume at ${formatDateTime(resumes)}.`;
  }
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  }).format(resumes);
  return `Lineup checks resume at ${formatted} ${zone}.`;
}

export function runStatusLabel(status: LineupRunView["status"]): string {
  switch (status) {
    case "queued":
      return "Waiting to start";
    case "reading":
      return "Reading lineup";
    case "planning":
      return "Choosing players";
    case "validating":
      return "Checking the lineup";
    case "applying":
      return "Setting the lineup";
    case "verifying":
      return "Confirming the result";
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
      return "Not confirmed";
    case "superseded":
      return "Replaced by a later run";
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
      return "This run is waiting to start. The lineup has not been checked yet.";
    case "reading":
    case "planning":
    case "validating":
    case "applying":
    case "verifying":
      return "The run is in progress. Its result is not confirmed yet.";
    case "uncertain":
      return "Lineupkeep could not confirm the result. A later run will check it again.";
    case "superseded":
      return "A later run replaced this one.";
    case "completed":
    case "skipped":
    case "blocked":
    case "failed":
      return "No outcome explanation is available.";
    case "retry-wait":
      return "Waiting to try again.";
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
  return run.trigger === "scheduled" ? "Scheduled check" : "Manual run";
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
