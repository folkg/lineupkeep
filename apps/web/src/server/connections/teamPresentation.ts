import type { ConnectionError } from "@lineupkeep/backend/connections/Connection";
import type { LineupRun } from "@lineupkeep/backend/connections/LineupRun";
import type { LineupError } from "@lineupkeep/backend/connections/LineupRun";
import type { LineupRunOutcome } from "@lineupkeep/backend/connections/LineupRun";
import { teamNoteLimit } from "@lineupkeep/backend/connections/TeamNote";
import type { TeamSummary } from "@lineupkeep/backend/connections/Teams";
import type {
  TeamError,
  TeamNoteError,
  TeamNoteSaved,
} from "@lineupkeep/backend/connections/Teams";
import { DateTime, Schema } from "effect";

import type {
  LineupRunView,
  TeamMutationError,
  TeamNoteSaveResult,
  TeamSummaryView,
  TeamView,
} from "#contracts/connections/teamContract.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";

export function toTeamSummaryView(summary: TeamSummary): TeamSummaryView {
  return {
    team: toTeamView(summary.team),
    connectionStatus: summary.connectionStatus,
    connectionCount: summary.connectionCount,
    ...(summary.lastRun === undefined ? {} : { lastRun: toLineupRunView(summary.lastRun) }),
    recentRuns: summary.recentRuns.map(toLineupRunView),
  };
}

export function toLineupRunView(run: LineupRun): LineupRunView {
  return {
    run: run.run,
    request: run.request,
    team: run.team,
    target: run.target,
    trigger: run.trigger,
    implementation: run.implementation,
    implementationVersion: run.implementationVersion,
    status: run.status,
    attempts: run.attempts,
    createdAt: DateTime.formatIso(run.createdAt),
    updatedAt: DateTime.formatIso(run.updatedAt),
    ...(run.outcome === undefined ? {} : { outcome: toLineupOutcomeView(run.outcome) }),
    ...(run.pending === undefined
      ? {}
      : {
          pending: {
            reason: run.pending.reason,
            detail: run.pending.detail,
            ...(run.pending.retryAt === undefined
              ? {}
              : { retryAt: DateTime.formatIso(run.pending.retryAt) }),
          },
        }),
  };
}

function toLineupOutcomeView(outcome: LineupRunOutcome): NonNullable<LineupRunView["outcome"]> {
  const { nextGameAt, nextTickAt, ...rest } = outcome;
  return {
    ...rest,
    observedAt: DateTime.formatIso(outcome.observedAt),
    ...(nextGameAt === undefined ? {} : { nextGameAt: DateTime.formatIso(nextGameAt) }),
    ...(nextTickAt === undefined ? {} : { nextTickAt: DateTime.formatIso(nextTickAt) }),
  };
}

function toTeamView(summary: TeamSummary["team"]): TeamView {
  return {
    id: summary.id,
    connectionId: summary.connectionId,
    provider: summary.provider,
    providerTeamKey: summary.providerTeamKey,
    providerLeagueKey: summary.providerLeagueKey,
    league: summary.league,
    sport: summary.sport,
    season: summary.season,
    name: summary.name,
    ...(summary.leagueName === undefined ? {} : { leagueName: summary.leagueName }),
    ...(summary.providerUrl === undefined ? {} : { providerUrl: summary.providerUrl }),
    availability: summary.availability,
    automation: {
      status: summary.automation.status,
      changedAt: DateTime.formatIso(summary.automation.changedAt),
      ...(summary.automation.pausedAt === undefined
        ? {}
        : { pausedAt: DateTime.formatIso(summary.automation.pausedAt) }),
      ...(summary.automation.resumesAt === undefined
        ? {}
        : { resumesAt: DateTime.formatIso(summary.automation.resumesAt) }),
      ...(summary.automation.timeZone === undefined
        ? {}
        : { timeZone: summary.automation.timeZone }),
      ...(summary.automation.fantasyDay === undefined
        ? {}
        : { fantasyDay: summary.automation.fantasyDay }),
      ...(summary.automation.fantasyDayVersion === undefined
        ? {}
        : { fantasyDayVersion: summary.automation.fantasyDayVersion }),
    },
    ownerNote: summary.ownerNote,
    ownerNoteUpdatedAt:
      summary.ownerNoteUpdatedAt === null ? null : DateTime.formatIso(summary.ownerNoteUpdatedAt),
    ownerNoteLimit: teamNoteLimit,
    lastSeenAt: DateTime.formatIso(summary.lastSeenAt),
    createdAt: DateTime.formatIso(summary.createdAt),
    updatedAt: DateTime.formatIso(summary.updatedAt),
  };
}

export function mapTeamError(error: TeamError): ExpectedFailure<TeamMutationError["type"]> {
  switch (error._tag) {
    case "team.not_found":
      return { type: "team.not_found", outcome: "rejected" };
    case "team.control_rejected":
      return { type: "team.control_rejected", outcome: "conflict" };
    case "team.persistence_failed":
      return { type: "team.persistence_failed", outcome: "failure" };
  }
}

export function mapTeamRefreshError(
  error: ConnectionError | TeamError,
): ExpectedFailure<TeamMutationError["type"]> {
  if (error._tag === "team.not_found") {
    return { type: "team.not_found", outcome: "rejected" };
  }
  if (error._tag === "team.control_rejected") {
    return { type: "team.control_rejected", outcome: "conflict" };
  }
  if (error._tag === "team.persistence_failed") {
    return { type: "team.persistence_failed", outcome: "failure" };
  }
  return { type: "team.refresh_failed", outcome: "failure" };
}

export function mapLineupError(
  error: LineupError,
): ExpectedFailure<
  | "lineup.run_not_found"
  | "lineup.team_not_found"
  | "lineup.connection_not_ready"
  | "lineup.selection_invalid"
  | "lineup.request_conflict"
  | "lineup.persistence_failed"
> {
  switch (error._tag) {
    case "lineup.run_not_found":
    case "lineup.team_not_found":
    case "lineup.connection_not_ready":
    case "lineup.selection_invalid":
      return { type: error._tag, outcome: "rejected" };
    case "lineup.request_conflict":
      return { type: error._tag, outcome: "conflict" };
    case "lineup.persistence_failed":
      return { type: error._tag, outcome: "failure" };
  }
}

export class TeamInputInvalid extends Schema.TaggedError<
  TeamInputInvalid,
  { readonly brand: unique symbol }
>()("TeamInputInvalid", {}) {}

export function toTeamNoteSaveResult(note: TeamNoteSaved): TeamNoteSaveResult {
  return {
    outcome: "saved",
    note: note.note,
    updatedAt: note.updatedAt === null ? null : DateTime.formatIso(note.updatedAt),
  };
}

export function mapTeamNoteError(error: TeamNoteError): ExpectedFailure<TeamNoteErrorCode> {
  switch (error._tag) {
    case "team.not_found":
      return { type: "team.not_found", outcome: "rejected" };
    case "team.note_rejected":
      return { type: "team.input_invalid", outcome: "rejected" };
    case "team.persistence_failed":
      return { type: "team.persistence_failed", outcome: "failure" };
  }
}

type TeamNoteErrorCode = "team.not_found" | "team.persistence_failed" | "team.input_invalid";

export class LineupRunInputInvalid extends Schema.TaggedError<
  LineupRunInputInvalid,
  { readonly brand: unique symbol }
>()("LineupRunInputInvalid", {}) {}
