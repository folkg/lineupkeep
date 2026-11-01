import { DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { currentFantasyDayStart } from "#contexts/connections/FantasyDay.ts";
import type { TeamAutomation } from "#contexts/connections/FantasyTeam.ts";
import type { FantasyTeam } from "#contexts/connections/FantasyTeam.ts";
import type { LineupRun } from "#contexts/connections/LineupRun.ts";
import type { ProviderFantasyDay } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import type { ProviderRegistryShape } from "#contexts/connections/ProviderRegistry.ts";
import { checkTeamNote } from "#contexts/connections/TeamNote.ts";
import {
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

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
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
    const encryption = yield* ConnectionCredentialEncryption;

    const summaries = (
      userId: UserId,
      records: ReadonlyArray<TeamRecord>,
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
            recentRuns,
            ...(teamActivity === undefined ? {} : { lastRun: toLineupRun(teamActivity.latest) }),
          };
        });
      });

    const list: TeamsShape["list"] = (userId) =>
      Effect.gen(function* () {
        const records = yield* teams.list(userId);
        return yield* summaries(userId, records);
      });

    const get: TeamsShape["get"] = (userId, team) =>
      Effect.gen(function* () {
        const records = yield* teams.load(userId, [team]);
        const summary = (yield* summaries(userId, records))[0];
        if (summary === undefined) {
          return yield* TeamNotFound.make({ team });
        }
        return summary;
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

    const readRoster: TeamsShape["readRoster"] = (userId, team) =>
      Effect.gen(function* () {
        const access = yield* teams.loadProviderAccess(userId, team);
        const provider = registry.get(access.connection.provider);
        if (provider === undefined) {
          return yield* TeamPersistenceFailed.make({
            cause: new Error(`Team ${team} references an unregistered provider`),
          });
        }
        const session = yield* encryption
          .decrypt({
            userId,
            connectionId: access.connection.id,
            provider: access.connection.provider,
            envelope: access.connection.envelope,
          })
          .pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
        const observedAt = yield* DateTime.now;
        const roster = yield* provider.readRoster({
          provider: access.connection.provider,
          session,
          providerTeamKey: access.team.providerTeamKey,
          period: undefined,
        });
        yield* Effect.annotateCurrentSpan("provider.player_count", roster.players.length);
        return {
          observedAt,
          players: roster.players.map((player) => ({
            name: player.name,
            slot: player.slot,
            primaryPosition: player.primaryPosition,
            displayPosition: player.displayPosition,
            proTeam: player.proTeamAbbreviation ?? null,
            injury: injuryOf(player),
            trend: player.transactionTrend,
          })),
        };
      });

    return Teams.of({ list, get, control, saveNote, readRoster });
  }),
);

function injuryOf(player: {
  readonly injuryCode: string | undefined;
  readonly injuryDetail: string | undefined;
}): {
  readonly reported: boolean;
  readonly code?: string;
  readonly detail?: string;
} {
  return {
    reported: player.injuryCode !== undefined || player.injuryDetail !== undefined,
    ...(player.injuryCode === undefined ? {} : { code: player.injuryCode }),
    ...(player.injuryDetail === undefined ? {} : { detail: player.injuryDetail }),
  };
}

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
