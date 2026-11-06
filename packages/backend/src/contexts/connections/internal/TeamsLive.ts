import { DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { checkAgentNote } from "#contexts/connections/AgentNote.ts";
import { Connections } from "#contexts/connections/Connections.ts";
import { currentFantasyDayStart } from "#contexts/connections/FantasyDay.ts";
import type { TeamAutomation } from "#contexts/connections/FantasyTeam.ts";
import type { FantasyTeam } from "#contexts/connections/FantasyTeam.ts";
import type { LineupRun } from "#contexts/connections/LineupRun.ts";
import type { ProviderFantasyDay } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import type { ProviderRegistryShape } from "#contexts/connections/ProviderRegistry.ts";
import { checkTeamNote } from "#contexts/connections/TeamNote.ts";
import {
  TeamAgentNoteRejected,
  TeamNotFound,
  TeamPersistenceFailed,
  TeamNoteRejected,
  Teams,
} from "#contexts/connections/Teams.ts";
import type {
  TeamControlInput,
  TeamControlResult,
  TeamError,
  TeamNoteSaved,
  TeamSummary,
  TeamsShape,
} from "#contexts/connections/Teams.ts";

import { LineupRunRepository } from "./LineupRunRepository.ts";
import { toLineupRun } from "./LineupRunViewRepository.ts";
import { TeamRepository } from "./TeamRepository.ts";
import type { TeamControlRecord, TeamRecord } from "./TeamRepository.ts";

export const TeamsLive = Layer.effect(
  Teams,
  Effect.gen(function* () {
    const teams = yield* TeamRepository;
    const runs = yield* LineupRunRepository;
    const registry = yield* ProviderRegistry;
    const connections = yield* Connections;

    const summaries = (
      userId: UserId,
      records: ReadonlyArray<TeamRecord>,
      connectionCount: number,
    ): Effect.Effect<ReadonlyArray<TeamSummary>, TeamError> =>
      Effect.gen(function* () {
        if (records.length === 0) {
          return [];
        }
        const now = yield* DateTime.now;
        const bounds = records.map((record) => ({
          record,
          since: currentFantasyDayStart(now, fantasyDayOf(registry, record.team)),
        }));
        const activity = yield* runs
          .loadTeamActivity(
            userId,
            records.map((record) => record.team.id),
            bounds
              .map((bound) => bound.since)
              .reduce((earliest, at) =>
                DateTime.toEpochMillis(at) < DateTime.toEpochMillis(earliest) ? at : earliest,
              ),
          )
          .pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
        return bounds.map(({ record, since }) => {
          const teamActivity = activity.get(record.team.id);
          const recentRuns: ReadonlyArray<LineupRun> = (teamActivity?.runs ?? [])
            .filter((run) => DateTime.toEpochMillis(run.createdAt) >= DateTime.toEpochMillis(since))
            .map(toLineupRun);
          return {
            team: record.team,
            connectionStatus: record.connection.status,
            connectionCount,
            recentRuns,
            ...(teamActivity === undefined ? {} : { lastRun: toLineupRun(teamActivity.latest) }),
          };
        });
      });

    const list: TeamsShape["list"] = (userId) =>
      Effect.gen(function* () {
        const named = yield* ensureLeagueNames(userId, yield* teams.list(userId));
        return yield* summaries(userId, named, yield* connectionCountOf(userId));
      });

    const get: TeamsShape["get"] = (userId, team) =>
      Effect.gen(function* () {
        const records = yield* teams.load(userId, [team]);
        const summary = (yield* summaries(userId, records, yield* connectionCountOf(userId)))[0];
        if (summary === undefined) {
          return yield* TeamNotFound.make({ team });
        }
        return summary;
      });

    const connectionCountOf = (userId: UserId): Effect.Effect<number, TeamError> =>
      connections.list(userId).pipe(
        Effect.map((owned) => owned.length),
        Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })),
      );

    const ensureLeagueNames = (
      userId: UserId,
      records: ReadonlyArray<TeamRecord>,
    ): Effect.Effect<ReadonlyArray<TeamRecord>, TeamError> =>
      Effect.gen(function* () {
        const unnamed = records.filter(
          (record) => record.team.leagueName === undefined && record.connection.status === "ready",
        );
        if (unnamed.length === 0) {
          return records;
        }
        const connectionIds = [...new Set(unnamed.map((record) => record.team.connectionId))];
        yield* Effect.annotateCurrentSpan("teams.league_names_discovered", connectionIds.length);
        yield* connections
          .discoverTeams(
            userId,
            connectionIds.map((id) => ({ id })),
          )
          .pipe(Effect.catch(() => Effect.void));
        return yield* teams.list(userId);
      });

    const control = Effect.fn("Teams.control")(function* (
      userId: UserId,
      inputs: ReadonlyArray<TeamControlInput>,
    ) {
      const records = yield* teams.control(userId, inputs);
      const results = records.map(toControlResult);
      yield* Effect.annotateCurrentSpan({
        "automation.requested": results.length,
        "automation.changed": countOutcome(results, "changed"),
        "automation.unchanged": countOutcome(results, "unchanged"),
        "automation.rejected": countOutcome(results, "rejected"),
        "automation.not_found": countOutcome(results, "not_found"),
      });
      return results;
    });

    const saveNote: TeamsShape["saveNote"] = (userId, input) =>
      Effect.gen(function* () {
        const checked = checkTeamNote(input.note);
        if (!checked.valid) {
          return yield* TeamNoteRejected.make({
            team: input.team,
            reason: checked.reason,
            message: checked.message,
          });
        }
        const team = yield* teams.saveNote(userId, { team: input.team, note: checked.note });
        yield* Effect.annotateCurrentSpan({
          "team.note_set": team.ownerNote !== null,
          "team.note_chars": team.ownerNote === null ? 0 : Array.from(team.ownerNote).length,
        });
        return {
          team: team.id,
          note: team.ownerNote,
          updatedAt: team.ownerNoteUpdatedAt,
        } satisfies TeamNoteSaved;
      });

    const addAgentNote: TeamsShape["addAgentNote"] = (userId, author, input) =>
      Effect.gen(function* () {
        const checked = checkAgentNote(input.body);
        if (!checked.valid) {
          return yield* TeamAgentNoteRejected.make({
            team: input.team,
            reason: checked.reason,
            message: checked.message,
          });
        }
        const saved = yield* teams.addAgentNote(userId, author, {
          team: input.team,
          body: checked.body,
        });
        yield* Effect.annotateCurrentSpan({
          "team.agent_note_chars": Array.from(checked.body).length,
        });
        return saved;
      });

    return Teams.of({ list, get, control, saveNote, addAgentNote });
  }),
);

function fantasyDayOf(registry: ProviderRegistryShape, team: FantasyTeam): ProviderFantasyDay {
  const provider = registry.get(team.provider);
  if (provider === undefined) {
    throw new Error(`Team ${team.id} references an unregistered provider`);
  }
  return provider.capabilities.fantasyDay;
}

function toControlResult(record: TeamControlRecord): TeamControlResult {
  if (record.outcome === "not_found") {
    return {
      outcome: "not_found",
      team: record.team,
      action: record.action,
      detail: "The selected team is not available to this account. List your teams again.",
    };
  }
  const automation = record.teamState.automation;
  return {
    outcome: record.outcome,
    team: record.team,
    action: record.action,
    enrolled: automation.status !== "disabled",
    availability: record.teamState.availability,
    automation,
    detail: controlDetail(record),
  };
}

function controlDetail(
  record: Exclude<TeamControlRecord, { readonly outcome: "not_found" }>,
): string {
  return controlOutcomeDetail(record, record.teamState.automation);
}

function controlOutcomeDetail(
  record: Exclude<TeamControlRecord, { readonly outcome: "not_found" }>,
  automation: TeamAutomation,
): string {
  switch (record.outcome) {
    case "changed":
      return changedDetail(record.action, automation);
    case "unchanged":
      return unchangedDetail(record.action, automation);
    case "rejected":
      return rejectedDetail(record, automation);
  }
}

function changedDetail(action: TeamControlRecord["action"], automation: TeamAutomation): string {
  switch (action) {
    case "enable":
      return "Automation is enabled.";
    case "disable":
      return "Automation is disabled; the team's configuration is retained.";
    case "pause-today":
      return `Automation is paused until ${pauseBoundary(automation)}.`;
    case "resume":
      return "The pause is cleared; automation is enabled.";
  }
}

function unchangedDetail(action: TeamControlRecord["action"], automation: TeamAutomation): string {
  switch (action) {
    case "enable":
      return "Automation is already enabled.";
    case "disable":
      return "Automation is already disabled.";
    case "pause-today":
      return `Automation is already paused until ${pauseBoundary(automation)}.`;
    case "resume":
      return "Automation is not paused.";
  }
}

function rejectedDetail(
  record: Extract<TeamControlRecord, { readonly outcome: "rejected" }>,
  automation: TeamAutomation,
): string {
  switch (record.rejection) {
    case "already-paused":
      return `Automation is paused until ${pauseBoundary(automation)}. Use resume to clear the pause instead of enabling.`;
    case "not-enabled":
      return record.action === "resume"
        ? "Automation is disabled. Enable it before resuming."
        : "Automation is disabled. Enable it before pausing.";
  }
}

function pauseBoundary(automation: TeamAutomation): string {
  if (automation.resumesAt === undefined || automation.timeZone === undefined) {
    throw new Error("A paused team is missing its resume boundary");
  }
  return `${DateTime.formatIso(automation.resumesAt)} (${automation.timeZone})`;
}

function countOutcome(
  results: ReadonlyArray<TeamControlResult>,
  outcome: TeamControlResult["outcome"],
): number {
  return results.filter((result) => result.outcome === outcome).length;
}
