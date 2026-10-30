import { formatDateTime, formatDay, formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type {
  LineupRunView,
  TeamAutomationView,
  TeamView,
} from "#contracts/connections/teamContract.ts";

export function teamContextLabel(team: TeamView): string {
  return `${sportLabel(team.sport)} · ${leagueLabel(team.league)} ${String(team.season)}`;
}

export function lastCheckLine(run: LineupRunView, now?: Date): string {
  if (run.outcome === undefined) {
    return `${lastCheckLabel(run)} · started ${formatReaderTime(run.createdAt, now)}`;
  }
  return `${lastCheckLabel(run)} · ${formatReaderTime(run.updatedAt, now)}`;
}

function lastCheckLabel(run: LineupRunView): string {
  if (run.outcome !== undefined) {
    switch (run.outcome.kind) {
      case "changed":
        return `Last check changed ${playerCount(run.outcome.changes.length)}`;
      case "no_op":
        return "Last check changed nothing";
      case "blocked":
        return "Last check was blocked";
      case "failed":
        return "Last check failed";
      case "uncertain":
        return "Last check is not confirmed";
      case "skipped":
        return "Last check had nothing to do";
      case "superseded":
        return "Last check was replaced by a later run";
    }
  }
  switch (run.status) {
    case "queued":
      return "Last check is waiting to start";
    case "reading":
      return "Last check is reading the lineup";
    case "planning":
      return "Last check is choosing players";
    case "validating":
      return "Last check is checking the lineup";
    case "applying":
      return "Last check is setting the lineup";
    case "verifying":
      return "Last check is confirming the result";
    case "retry-wait":
      return "Last check is waiting to retry";
    case "completed":
    case "skipped":
    case "blocked":
    case "failed":
    case "uncertain":
    case "superseded":
      return "Last check finished";
  }
}

export function checkTallyLabel(runs: ReadonlyArray<LineupRunView>): string | undefined {
  if (runs.length < 2) {
    return undefined;
  }
  const changed = runs.filter((run) => (run.outcome?.changes.length ?? 0) > 0).length;
  if (changed === 0) {
    return undefined;
  }
  if (changed === runs.length) {
    return `The last ${String(runs.length)} checks all changed the lineup`;
  }
  return `${String(changed)} of the last ${String(runs.length)} checks changed the lineup`;
}

export function quietGroupLabel(runs: ReadonlyArray<LineupRunView>): string {
  const newest = runs[0];
  const oldest = runs[runs.length - 1];
  if (newest === undefined || oldest === undefined) {
    throw new Error("A quiet group needs at least one run");
  }
  const noun = runs.length === 1 ? "check" : "checks";
  const first = formatDay(oldest.updatedAt);
  const last = formatDay(newest.updatedAt);
  return first === last
    ? `${String(runs.length)} ${noun} on ${first} changed nothing`
    : `${String(runs.length)} ${noun} between ${first} and ${last} changed nothing`;
}

export function pauseResumeLabel(automation: TeamAutomationView): string | undefined {
  if (automation.status !== "paused-until-fantasy-day-end") {
    return undefined;
  }
  if (automation.resumesAt === undefined) {
    return "Paused for the rest of the fantasy day.";
  }
  return `Paused for the rest of the fantasy day. Resumes after ${formatDateTime(automation.resumesAt)}.`;
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

function playerCount(count: number): string {
  return count === 1 ? "1 player" : `${String(count)} players`;
}

function leagueLabel(league: TeamView["league"]): string {
  return league === "nfl" ? "NFL" : "NHL";
}

function sportLabel(sport: TeamView["sport"]): string {
  return sport === "football" ? "Football" : "Hockey";
}
