import { EffectArray, EffectString } from "@lineupkeep/collections";

import {
  formatClockTime,
  formatDateTime,
  formatReaderTime,
  formatWeekday,
} from "#browser/shared-ui/formatTime.ts";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type {
  LineupRunView,
  TeamAutomationView,
  TeamSummaryView,
  TeamView,
} from "#contracts/connections/teamContract.ts";
import { leagueDisplayName, sportDisplayName } from "#contracts/connections/teamVocabulary.ts";

export function teamContextLabel(team: TeamView, showProvider: boolean): string {
  const sportAndSeason =
    team.leagueName === undefined
      ? `${sportDisplayName(team.sport)} · ${leagueDisplayName(team.league)} ${String(team.season)}`
      : `${team.leagueName} · ${sportDisplayName(team.sport)} · ${String(team.season)}`;
  return showProvider
    ? `${sportAndSeason} · ${providerDisplayName(team.provider)}`
    : sportAndSeason;
}

export function showsProvider(teams: ReadonlyArray<TeamSummaryView>): boolean {
  const first = teams[0];
  return (
    first !== undefined &&
    EffectArray.some(teams, (team) => team.team.provider !== first.team.provider)
  );
}

export type LastCheckStatus = {
  readonly value: string;
  readonly note?: string;
};

export function lastCheckStatus(
  run: LineupRunView | undefined,
  now?: Date,
): LastCheckStatus | undefined {
  if (run === undefined) {
    return undefined;
  }
  if (run.outcome === undefined) {
    if (run.status === "queued") {
      return { value: "Not started", note: formatReaderTime(run.createdAt, now) };
    }
    return {
      value: `Started ${formatReaderTime(run.createdAt, now)}`,
      note: runStatusLabel(run.status),
    };
  }
  return {
    value: formatReaderTime(run.updatedAt, now),
    note: lastCheckNote(run.outcome),
  };
}

function lastCheckNote(outcome: NonNullable<LineupRunView["outcome"]>): string {
  switch (outcome.kind) {
    case "changed":
      return `Changed ${playerCount(outcome.changes.length)}`;
    case "no_op":
      return "Changed nothing";
    case "blocked":
      return "Was blocked";
    case "failed":
      return "Failed";
    case "uncertain":
      return "Not confirmed";
    case "skipped":
      return "Had nothing to do";
    case "superseded":
      return "Replaced later";
  }
}

export function quietGroupSpan(runs: ReadonlyArray<LineupRunView>): QuietGroupSpan {
  const newest = runs[0];
  const oldest = runs[runs.length - 1];
  if (newest === undefined || oldest === undefined) {
    throw new Error("A quiet group needs at least one run");
  }
  return { count: runs.length, from: oldest.updatedAt, to: newest.updatedAt };
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

export function provenanceExplanation(
  provenance: NonNullable<NonNullable<LineupRunView["outcome"]>["provenance"]>,
): string {
  switch (provenance.kind) {
    case "planned":
      return `Scored from ${provenance.label}.`;
    case "refused":
      return `Not scored by the custom policy (${provenance.label}).`;
  }
}

export function runExplanation(run: LineupRunView): string {
  if (run.outcome !== undefined) {
    return skippedExplanation(run.outcome) ?? run.outcome.summary;
  }
  if (run.pending !== undefined) {
    return run.pending.detail;
  }
  switch (run.status) {
    case "queued":
      return "This run is waiting to start; the lineup has not been checked yet.";
    case "reading":
    case "planning":
    case "validating":
    case "applying":
    case "verifying":
      return "The run is in progress; its result is not confirmed yet.";
    case "uncertain":
      return "Lineupgrade could not confirm the result; a later run will check again.";
    case "superseded":
      return "A later run replaced this one.";
    case "completed":
    case "skipped":
    case "blocked":
    case "failed":
      return "No outcome was recorded.";
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

export function runIsInProgress(status: LineupRunView["status"]): boolean {
  switch (status) {
    case "queued":
    case "reading":
    case "planning":
    case "validating":
    case "applying":
    case "verifying":
    case "retry-wait":
      return true;
    case "completed":
    case "skipped":
    case "blocked":
    case "failed":
    case "uncertain":
    case "superseded":
      return false;
  }
}

export function runIsCheckingNow(status: LineupRunView["status"]): boolean {
  switch (status) {
    case "reading":
    case "planning":
    case "validating":
    case "applying":
    case "verifying":
      return true;
    case "queued":
    case "completed":
    case "skipped":
    case "blocked":
    case "failed":
    case "uncertain":
    case "superseded":
    case "retry-wait":
      return false;
  }
}

function skippedExplanation(outcome: NonNullable<LineupRunView["outcome"]>): string | undefined {
  if (outcome.kind !== "skipped" || outcome.nextTickAt === undefined) {
    return undefined;
  }
  if (outcome.nextGameAt === undefined) {
    return `Nothing to check; the next check is at ${sentenceClock(outcome.nextTickAt)}`;
  }
  return `Nothing to check; the next game is ${formatWeekday(outcome.nextGameAt)} at ${sentenceClock(outcome.nextGameAt)}`;
}

function sentenceClock(value: string): string {
  return `${EffectString.replace(formatClockTime(value), /\.$/u, "")}.`;
}

function playerCount(count: number): string {
  return count === 1 ? "1 player" : `${String(count)} players`;
}

export type QuietGroupSpan = {
  readonly count: number;
  readonly from: string;
  readonly to: string;
};
