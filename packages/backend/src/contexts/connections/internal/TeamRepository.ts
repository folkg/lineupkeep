import { Machine } from "@typeonce/effect-machine";
import { and, asc, eq } from "drizzle-orm";
import { Array, Context, DateTime, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { UserId as UserIdSchema } from "#contexts/auth/User.ts";
import type { ProviderConnection } from "#contexts/connections/Connection.ts";
import { ConnectionStatus, decodeConnectionId } from "#contexts/connections/Connection.ts";
import { fantasyDayLabel, nextFantasyDayBoundary } from "#contexts/connections/FantasyDay.ts";
import { FantasyTeam, TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { ProviderFantasyDay } from "#contexts/connections/Provider.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import {
  TeamConnectionNotReady,
  TeamNotFound,
  TeamPersistenceFailed,
} from "#contexts/connections/Teams.ts";
import type { TeamAutomationAction, TeamControlInput } from "#contexts/connections/Teams.ts";
import { anyOf, excludedValues } from "#database/dbUtilities.ts";
import { snapshotOf } from "#utilities/machine.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import {
  FantasyTeamRow,
  providerConnections,
  providerCredentials,
  providerTeams,
} from "./ConnectionTables.ts";
import type { TeamAutomationEvent } from "./TeamAutomationWorkflow.ts";
import { TeamAutomationState, TeamAutomationWorkflow } from "./TeamAutomationWorkflow.ts";

const teamListLimit = 100;

export type TeamRecord = {
  readonly team: FantasyTeam;
  readonly connection: Pick<ProviderConnection, "id" | "status">;
};

type TeamProviderAccess = {
  readonly team: FantasyTeam;
  readonly connection: {
    readonly id: ReturnType<typeof decodeConnectionId>;
    readonly provider: ReturnType<typeof decodeProviderKey>;
    readonly envelope: string;
  };
};

type TeamControlRejection = "already-paused" | "not-enabled";

export type TeamControlRecord =
  | {
      readonly team: TeamId;
      readonly action: TeamAutomationAction;
      readonly outcome: "changed";
      readonly teamState: FantasyTeam;
    }
  | {
      readonly team: TeamId;
      readonly action: TeamAutomationAction;
      readonly outcome: "unchanged";
      readonly teamState: FantasyTeam;
    }
  | {
      readonly team: TeamId;
      readonly action: TeamAutomationAction;
      readonly outcome: "rejected";
      readonly teamState: FantasyTeam;
      readonly rejection: TeamControlRejection;
    }
  | {
      readonly team: TeamId;
      readonly action: TeamAutomationAction;
      readonly outcome: "not_found";
    };

type ControlPlan =
  | { readonly _tag: "Changed"; readonly team: FantasyTeam }
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Rejected"; readonly rejection: TeamControlRejection };

export class TeamRepository extends Context.Service<TeamRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/TeamRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const registry = yield* ProviderRegistry;

      const fantasyDayOf = (team: FantasyTeam): ProviderFantasyDay => {
        const provider = registry.get(team.provider);
        if (provider === undefined) {
          throw new Error(`Team ${team.id} references an unregistered provider`);
        }
        return provider.capabilities.fantasyDay;
      };

      const list = Effect.fn("TeamRepository.list")(function* (userId: UserId) {
        const rows = yield* database
          .select({
            id: providerTeams.id,
            connectionId: providerTeams.connectionId,
            userId: providerTeams.userId,
            provider: providerTeams.provider,
            providerTeamKey: providerTeams.providerTeamKey,
            providerLeagueKey: providerTeams.providerLeagueKey,
            league: providerTeams.league,
            sport: providerTeams.sport,
            season: providerTeams.season,
            name: providerTeams.name,
            availability: providerTeams.availability,
            unavailableReason: providerTeams.unavailableReason,
            unavailableDetail: providerTeams.unavailableDetail,
            availabilityObservedAt: providerTeams.availabilityObservedAt,
            availabilityRefusals: providerTeams.availabilityRefusals,
            automationState: providerTeams.automationState,
            automationStatus: providerTeams.automationStatus,
            ownerNote: providerTeams.ownerNote,
            ownerNoteUpdatedAt: providerTeams.ownerNoteUpdatedAt,
            lastSeenAt: providerTeams.lastSeenAt,
            createdAt: providerTeams.createdAt,
            updatedAt: providerTeams.updatedAt,
            connectionStatus: providerConnections.status,
          })
          .from(providerTeams)
          .innerJoin(
            providerConnections,
            and(
              eq(providerConnections.id, providerTeams.connectionId),
              eq(providerConnections.userId, userId),
            ),
          )
          .where(eq(providerTeams.userId, userId))
          .orderBy(asc(providerTeams.league), asc(providerTeams.name), asc(providerTeams.id))
          .limit(teamListLimit)
          .pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
        return yield* Effect.forEach(rows, toTeamRecord);
      });

      const load = Effect.fn("TeamRepository.load")(function* (
        userId: UserId,
        ids: ReadonlyArray<TeamId>,
      ) {
        const uniqueIds = [...new Set(ids)];
        if (!Array.isArrayNonEmpty(uniqueIds)) {
          return [];
        }
        const rows = yield* database
          .select({
            id: providerTeams.id,
            connectionId: providerTeams.connectionId,
            userId: providerTeams.userId,
            provider: providerTeams.provider,
            providerTeamKey: providerTeams.providerTeamKey,
            providerLeagueKey: providerTeams.providerLeagueKey,
            league: providerTeams.league,
            sport: providerTeams.sport,
            season: providerTeams.season,
            name: providerTeams.name,
            availability: providerTeams.availability,
            unavailableReason: providerTeams.unavailableReason,
            unavailableDetail: providerTeams.unavailableDetail,
            availabilityObservedAt: providerTeams.availabilityObservedAt,
            availabilityRefusals: providerTeams.availabilityRefusals,
            automationState: providerTeams.automationState,
            automationStatus: providerTeams.automationStatus,
            ownerNote: providerTeams.ownerNote,
            ownerNoteUpdatedAt: providerTeams.ownerNoteUpdatedAt,
            lastSeenAt: providerTeams.lastSeenAt,
            createdAt: providerTeams.createdAt,
            updatedAt: providerTeams.updatedAt,
            connectionStatus: providerConnections.status,
          })
          .from(providerTeams)
          .innerJoin(
            providerConnections,
            and(
              eq(providerConnections.id, providerTeams.connectionId),
              eq(providerConnections.userId, userId),
            ),
          )
          .where(and(eq(providerTeams.userId, userId), anyOf(providerTeams.id, uniqueIds)))
          .orderBy(asc(providerTeams.id))
          .pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
        const byId = new Map(
          yield* Effect.forEach(rows, (row) =>
            toTeamRecord(row).pipe(Effect.map((record) => [record.team.id, record] as const)),
          ),
        );
        return yield* Effect.forEach(ids, (team) => {
          const record = byId.get(team);
          return record === undefined ? TeamNotFound.make({ team }) : Effect.succeed(record);
        });
      });

      const loadProviderAccess = Effect.fn("TeamRepository.loadProviderAccess")(function* (
        userId: UserId,
        team: TeamId,
      ) {
        const rows = yield* database
          .select({
            id: providerTeams.id,
            connectionId: providerTeams.connectionId,
            userId: providerTeams.userId,
            provider: providerTeams.provider,
            providerTeamKey: providerTeams.providerTeamKey,
            providerLeagueKey: providerTeams.providerLeagueKey,
            league: providerTeams.league,
            sport: providerTeams.sport,
            season: providerTeams.season,
            name: providerTeams.name,
            availability: providerTeams.availability,
            unavailableReason: providerTeams.unavailableReason,
            unavailableDetail: providerTeams.unavailableDetail,
            availabilityObservedAt: providerTeams.availabilityObservedAt,
            availabilityRefusals: providerTeams.availabilityRefusals,
            automationState: providerTeams.automationState,
            automationStatus: providerTeams.automationStatus,
            ownerNote: providerTeams.ownerNote,
            ownerNoteUpdatedAt: providerTeams.ownerNoteUpdatedAt,
            lastSeenAt: providerTeams.lastSeenAt,
            createdAt: providerTeams.createdAt,
            updatedAt: providerTeams.updatedAt,
            connectionStatus: providerConnections.status,
            credentialProvider: providerCredentials.provider,
            envelope: providerCredentials.envelope,
          })
          .from(providerTeams)
          .innerJoin(
            providerConnections,
            and(
              eq(providerConnections.id, providerTeams.connectionId),
              eq(providerConnections.userId, providerTeams.userId),
            ),
          )
          .innerJoin(
            providerCredentials,
            and(
              eq(providerCredentials.connectionId, providerTeams.connectionId),
              eq(providerCredentials.userId, providerTeams.userId),
            ),
          )
          .where(and(eq(providerTeams.userId, userId), eq(providerTeams.id, team)))
          .limit(1)
          .pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
        const row = rows[0];
        if (row === undefined) {
          return yield* TeamNotFound.make({ team });
        }
        const status = yield* Schema.decodeEffect(ConnectionStatus)(row.connectionStatus).pipe(
          Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })),
        );
        if (status !== "ready") {
          return yield* TeamConnectionNotReady.make({ team, status });
        }
        const decoded = yield* Schema.decodeEffect(FantasyTeamRow)(row).pipe(
          Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })),
        );
        return {
          team: decoded,
          connection: {
            id: decodeConnectionId(row.connectionId),
            provider: decodeProviderKey(row.credentialProvider),
            envelope: row.envelope,
          },
        } satisfies TeamProviderAccess;
      });

      const control = Effect.fn("TeamRepository.control")(function* (
        userId: UserId,
        inputs: ReadonlyArray<TeamControlInput>,
      ) {
        const ids = [...new Set(inputs.map((input) => input.team))];
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        const now = yield* DateTime.now;
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const rows = yield* tx
                .select()
                .from(providerTeams)
                .where(and(eq(providerTeams.userId, userId), anyOf(providerTeams.id, ids)))
                .orderBy(asc(providerTeams.id))
                .for("update");
              const locked = new Map(
                yield* Effect.forEach(rows, (row) =>
                  Schema.decodeEffect(FantasyTeamRow)(row).pipe(
                    Effect.map((team) => [team.id, { row, team }] as const),
                    Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })),
                  ),
                ),
              );
              const changedById = new Map<
                TeamId,
                {
                  readonly row: typeof providerTeams.$inferSelect;
                  readonly team: FantasyTeam;
                }
              >();
              const results: Array<TeamControlRecord> = [];
              for (const input of inputs) {
                const entry = locked.get(input.team);
                if (entry === undefined) {
                  results.push({
                    team: input.team,
                    action: input.action,
                    outcome: "not_found",
                  });
                  continue;
                }
                const plan = yield* planControl(
                  entry.team,
                  input.action,
                  now,
                  fantasyDayOf(entry.team),
                );
                switch (plan._tag) {
                  case "Changed":
                    results.push({
                      team: input.team,
                      action: input.action,
                      outcome: "changed",
                      teamState: plan.team,
                    });
                    changedById.set(input.team, { row: entry.row, team: plan.team });
                    break;
                  case "Unchanged":
                    results.push({
                      team: input.team,
                      action: input.action,
                      outcome: "unchanged",
                      teamState: entry.team,
                    });
                    break;
                  case "Rejected":
                    results.push({
                      team: input.team,
                      action: input.action,
                      outcome: "rejected",
                      teamState: entry.team,
                      rejection: plan.rejection,
                    });
                    break;
                }
              }
              const changed = [...changedById.values()];
              if (changed.length > 0) {
                yield* tx
                  .insert(providerTeams)
                  .values(
                    changed.map(({ row, team }) => ({
                      ...row,
                      automationState: encodeAutomation(automationStateOf(team)),
                      automationStatus: team.automation.status,
                      updatedAt: DateTime.toDateUtc(now),
                    })),
                  )
                  .onConflictDoUpdate({
                    target: [providerTeams.connectionId, providerTeams.providerTeamKey],
                    set: excludedValues(providerTeams, [
                      "automationState",
                      "automationStatus",
                      "updatedAt",
                    ]),
                  });
              }
              return results;
            }),
          )
          .pipe(Effect.mapError(mapPersistenceError));
      });

      const saveNote = Effect.fn("TeamRepository.saveNote")(function* (
        userId: UserId,
        input: { readonly team: TeamId; readonly note: string | null },
      ) {
        const now = yield* DateTime.now;
        const rows = yield* database
          .update(providerTeams)
          .set({
            ownerNote: input.note,
            ownerNoteUpdatedAt: input.note === null ? null : DateTime.toDateUtc(now),
          })
          .where(and(eq(providerTeams.userId, userId), eq(providerTeams.id, input.team)))
          .returning()
          .pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
        const row = rows[0];
        if (row === undefined) {
          return yield* TeamNotFound.make({ team: input.team });
        }
        return yield* Schema.decodeEffect(FantasyTeamRow)(row).pipe(
          Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })),
        );
      });

      const expirePauses = Effect.fn("TeamRepository.expirePauses")(function* (
        limit: number,
        now: DateTime.Utc,
      ) {
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const rows = yield* tx
                .select()
                .from(providerTeams)
                .where(eq(providerTeams.automationStatus, "paused-until-fantasy-day-end"))
                .orderBy(asc(providerTeams.updatedAt))
                .limit(limit)
                .for("update");
              const changed: Array<{
                readonly row: typeof providerTeams.$inferSelect;
                readonly team: FantasyTeam;
              }> = [];
              for (const row of rows) {
                const team = yield* Schema.decodeEffect(FantasyTeamRow)(row).pipe(
                  Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })),
                );
                const resumesAt = team.automation.resumesAt;
                if (
                  resumesAt === undefined ||
                  DateTime.toEpochMillis(resumesAt) > DateTime.toEpochMillis(now)
                ) {
                  continue;
                }
                const next = yield* planAutomation(automationStateOf(team), {
                  _tag: "PauseExpired",
                  at: now,
                });
                changed.push({ row, team: applyAutomation(team, next, now) });
              }
              if (changed.length > 0) {
                yield* tx
                  .insert(providerTeams)
                  .values(
                    changed.map(({ row, team }) => ({
                      ...row,
                      automationState: encodeAutomation(automationStateOf(team)),
                      automationStatus: team.automation.status,
                      updatedAt: DateTime.toDateUtc(now),
                    })),
                  )
                  .onConflictDoUpdate({
                    target: [providerTeams.connectionId, providerTeams.providerTeamKey],
                    set: excludedValues(providerTeams, [
                      "automationState",
                      "automationStatus",
                      "updatedAt",
                    ]),
                  });
              }
              return changed.map(({ team }) => team);
            }),
          )
          .pipe(Effect.mapError(mapPersistenceError));
      });

      const eligible = Effect.fn("TeamRepository.eligible")(function* (limit: number) {
        const rows = yield* database
          .select({
            id: providerTeams.id,
            userId: providerTeams.userId,
            connectionId: providerTeams.connectionId,
            name: providerTeams.name,
            league: providerTeams.league,
            sport: providerTeams.sport,
            providerTeamKey: providerTeams.providerTeamKey,
            providerLeagueKey: providerTeams.providerLeagueKey,
            season: providerTeams.season,
            availability: providerTeams.availability,
            unavailableReason: providerTeams.unavailableReason,
            unavailableDetail: providerTeams.unavailableDetail,
            availabilityObservedAt: providerTeams.availabilityObservedAt,
            availabilityRefusals: providerTeams.availabilityRefusals,
            automationState: providerTeams.automationState,
            automationStatus: providerTeams.automationStatus,
            ownerNote: providerTeams.ownerNote,
            ownerNoteUpdatedAt: providerTeams.ownerNoteUpdatedAt,
            lastSeenAt: providerTeams.lastSeenAt,
            createdAt: providerTeams.createdAt,
            updatedAt: providerTeams.updatedAt,
            provider: providerTeams.provider,
            connectionStatus: providerConnections.status,
          })
          .from(providerTeams)
          .innerJoin(providerConnections, eq(providerConnections.id, providerTeams.connectionId))
          .innerJoin(
            providerCredentials,
            and(
              eq(providerCredentials.connectionId, providerTeams.connectionId),
              eq(providerCredentials.userId, providerTeams.userId),
            ),
          )
          .where(
            and(
              eq(providerTeams.automationStatus, "enabled"),
              eq(providerTeams.availability, "available"),
              eq(providerConnections.status, "ready"),
              eq(providerConnections.userId, providerTeams.userId),
            ),
          )
          .orderBy(asc(providerTeams.id))
          .limit(limit)
          .pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
        return yield* Effect.forEach(rows, (row) =>
          Effect.all({
            team: Schema.decodeEffect(FantasyTeamRow)(row),
            userId: Schema.decodeEffect(UserIdSchema)(row.userId),
          }).pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause }))),
        );
      });

      return { list, load, loadProviderAccess, control, saveNote, expirePauses, eligible };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

function toTeamRecord(row: unknown): Effect.Effect<TeamRecord, TeamPersistenceFailed> {
  return Effect.gen(function* () {
    const raw = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        id: Schema.String,
        connectionId: Schema.String,
        connectionStatus: Schema.String,
      }),
    )(row);
    const team = yield* Schema.decodeUnknownEffect(FantasyTeamRow)(row);
    const status = yield* Schema.decodeUnknownEffect(ConnectionStatus)(raw.connectionStatus);
    return {
      team,
      connection: {
        id: decodeConnectionId(raw.connectionId),
        status,
      },
    } satisfies TeamRecord;
  }).pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
}

function automationStateOf(team: FantasyTeam): TeamAutomationState {
  switch (team.automation.status) {
    case "disabled":
      return { _tag: "Disabled", changedAt: team.automation.changedAt };
    case "enabled":
      return { _tag: "Enabled", changedAt: team.automation.changedAt };
    case "paused-until-fantasy-day-end":
      if (
        team.automation.pausedAt === undefined ||
        team.automation.resumesAt === undefined ||
        team.automation.timeZone === undefined ||
        team.automation.fantasyDay === undefined ||
        team.automation.fantasyDayVersion === undefined
      ) {
        throw new Error("A paused team is missing its fantasy-day boundary");
      }
      return {
        _tag: "PausedUntilFantasyDayEnd",
        changedAt: team.automation.changedAt,
        pausedAt: team.automation.pausedAt,
        resumesAt: team.automation.resumesAt,
        timeZone: team.automation.timeZone,
        fantasyDay: team.automation.fantasyDay,
        fantasyDayVersion: team.automation.fantasyDayVersion,
      };
  }
}

function applyAutomation(
  team: FantasyTeam,
  state: TeamAutomationState,
  changedAt: DateTime.Utc,
): FantasyTeam {
  switch (state._tag) {
    case "Disabled":
      return { ...team, automation: { status: "disabled", changedAt }, updatedAt: changedAt };
    case "Enabled":
      return { ...team, automation: { status: "enabled", changedAt }, updatedAt: changedAt };
    case "PausedUntilFantasyDayEnd":
      return {
        ...team,
        automation: {
          status: "paused-until-fantasy-day-end",
          changedAt: state.changedAt,
          pausedAt: state.pausedAt,
          resumesAt: state.resumesAt,
          timeZone: state.timeZone,
          fantasyDay: state.fantasyDay,
          fantasyDayVersion: state.fantasyDayVersion,
        },
        updatedAt: changedAt,
      };
  }
}

function planAutomation(
  state: TeamAutomationState,
  event: TeamAutomationEvent,
): Effect.Effect<TeamAutomationState> {
  return Effect.gen(function* () {
    const snapshot = yield* snapshotOf(TeamAutomationWorkflow, state);
    const planned = yield* Machine.plan(TeamAutomationWorkflow, snapshot, event);
    const handled = planned.microsteps.some((step) => step.transitions.length > 0);
    if (!handled) {
      return yield* Effect.die(new Error("Team automation rejected the requested transition"));
    }
    return yield* Schema.decodeEffect(TeamAutomationState)(planned.next.state.value);
  }).pipe(Effect.orDie);
}

function encodeAutomation(state: TeamAutomationState): unknown {
  return Schema.encodeSync(Schema.toCodecJson(TeamAutomationState))(state);
}

function mapPersistenceError(cause: unknown): TeamPersistenceFailed {
  return Schema.is(TeamPersistenceFailed)(cause) ? cause : TeamPersistenceFailed.make({ cause });
}

function planControl(
  team: FantasyTeam,
  action: TeamAutomationAction,
  now: DateTime.Utc,
  fantasyDay: ProviderFantasyDay,
): Effect.Effect<ControlPlan> {
  switch (action) {
    case "enable":
      return planEnable(team, now);
    case "disable":
      return planDisable(team, now);
    case "pause-today":
      return planPauseToday(team, now, fantasyDay);
    case "resume":
      return planResume(team, now);
  }
}

function planEnable(team: FantasyTeam, now: DateTime.Utc): Effect.Effect<ControlPlan> {
  switch (team.automation.status) {
    case "disabled":
      return transition(team, { _tag: "Enabled", at: now }, now);
    case "enabled":
      return Effect.succeed({ _tag: "Unchanged" });
    case "paused-until-fantasy-day-end":
      return Effect.succeed({ _tag: "Rejected", rejection: "already-paused" });
  }
}

function planDisable(team: FantasyTeam, now: DateTime.Utc): Effect.Effect<ControlPlan> {
  switch (team.automation.status) {
    case "disabled":
      return Effect.succeed({ _tag: "Unchanged" });
    case "enabled":
    case "paused-until-fantasy-day-end":
      return transition(team, { _tag: "Disabled", at: now }, now);
  }
}

function planPauseToday(
  team: FantasyTeam,
  now: DateTime.Utc,
  fantasyDay: ProviderFantasyDay,
): Effect.Effect<ControlPlan> {
  switch (team.automation.status) {
    case "enabled": {
      return transition(
        team,
        {
          _tag: "Paused",
          at: now,
          resumesAt: nextFantasyDayBoundary(now, fantasyDay),
          timeZone: fantasyDay.timeZone,
          fantasyDay: fantasyDayLabel(now, fantasyDay),
          fantasyDayVersion: fantasyDay.version,
        },
        now,
      );
    }
    case "paused-until-fantasy-day-end":
      return Effect.succeed({ _tag: "Unchanged" });
    case "disabled":
      return Effect.succeed({ _tag: "Rejected", rejection: "not-enabled" });
  }
}

function planResume(team: FantasyTeam, now: DateTime.Utc): Effect.Effect<ControlPlan> {
  switch (team.automation.status) {
    case "paused-until-fantasy-day-end":
      return transition(team, { _tag: "Resumed", at: now }, now);
    case "enabled":
      return Effect.succeed({ _tag: "Unchanged" });
    case "disabled":
      return Effect.succeed({ _tag: "Rejected", rejection: "not-enabled" });
  }
}

function transition(
  team: FantasyTeam,
  event: TeamAutomationEvent,
  now: DateTime.Utc,
): Effect.Effect<ControlPlan> {
  return planAutomation(automationStateOf(team), event).pipe(
    Effect.map((state) => ({
      _tag: "Changed" as const,
      team: applyAutomation(team, state, now),
    })),
  );
}
