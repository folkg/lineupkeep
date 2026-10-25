import { Machine } from "@typeonce/effect-machine";
import { and, asc, eq, sql } from "drizzle-orm";
import { Array, Context, DateTime, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { ProviderConnection } from "#contexts/connections/Connection.ts";
import {
  ConnectionStatus,
  decodeConnectionId,
} from "#contexts/connections/Connection.ts";
import {
  fantasyDayLabel,
  fantasyDayPolicy,
  nextFantasyDayBoundary,
} from "#contexts/connections/FantasyDay.ts";
import { FantasyTeam, TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  TeamControlRejected,
  TeamNotFound,
  TeamPersistenceFailed,
} from "#contexts/connections/Teams.ts";
import { UserId as UserIdSchema } from "#contexts/auth/User.ts";
import { anyOf } from "#database/dbUtilities.ts";
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

export type SetEnabledCommand = {
  readonly team: TeamId;
  readonly enabled: boolean;
};

export type TeamControlFailure = TeamNotFound | TeamControlRejected | TeamPersistenceFailed;

export class TeamRepository extends Context.Service<TeamRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/TeamRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;

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
            automationState: providerTeams.automationState,
            automationStatus: providerTeams.automationStatus,
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
            automationState: providerTeams.automationState,
            automationStatus: providerTeams.automationStatus,
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

      const setEnabled = Effect.fn("TeamRepository.setEnabled")(function* (
        userId: UserId,
        commands: ReadonlyArray<SetEnabledCommand>,
      ) {
        const ids = [...new Set(commands.map((command) => command.team))];
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        const byId = new Map(commands.map((command) => [command.team, command]));
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
              const changed: Array<{
                readonly row: typeof providerTeams.$inferSelect;
                readonly team: FantasyTeam;
              }> = [];
              for (const id of ids) {
                const command = byId.get(id);
                const entry = locked.get(id);
                if (command === undefined || entry === undefined) {
                  return yield* TeamNotFound.make({ team: id });
                }
                const status = entry.team.automation.status;
                if (command.enabled && status === "paused-until-fantasy-day-end") {
                  return yield* TeamControlRejected.make({ team: id, status });
                }
                if (
                  (command.enabled && status === "enabled") ||
                  (!command.enabled && status === "disabled")
                ) {
                  continue;
                }
                const next = yield* planAutomation(
                  automationStateOf(entry.team),
                  command.enabled
                    ? { _tag: "Enabled", at: now }
                    : { _tag: "Disabled", at: now },
                ).pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
                changed.push({ row: entry.row, team: applyAutomation(entry.team, next, now) });
              }
              if (changed.length > 0) {
                yield* tx
                  .insert(providerTeams)
                  .values(
                    changed.map(({ row, team }) => ({
                      ...row,
                      availability: team.availability,
                      automationState: encodeAutomation(automationStateOf(team)),
                      automationStatus: team.automation.status,
                      updatedAt: DateTime.toDateUtc(now),
                    })),
                  )
                  .onConflictDoUpdate({
                    target: [providerTeams.connectionId, providerTeams.providerTeamKey],
                    set: {
                      automationState: sql`excluded.automation_state`,
                      automationStatus: sql`excluded.automation_status`,
                      updatedAt: sql`excluded.updated_at`,
                    },
                  });
              }
              return changed.map(({ team }) => team);
            }),
          )
          .pipe(Effect.mapError(mapTransactionalError));
      });

      const pause = Effect.fn("TeamRepository.pause")(function* (
        userId: UserId,
        ids: ReadonlyArray<TeamId>,
      ) {
        const uniqueIds = [...new Set(ids)];
        if (!Array.isArrayNonEmpty(uniqueIds)) {
          return [];
        }
        const now = yield* DateTime.now;
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const rows = yield* tx
                .select()
                .from(providerTeams)
                .where(and(eq(providerTeams.userId, userId), anyOf(providerTeams.id, uniqueIds)))
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
              const changed: Array<{
                readonly row: typeof providerTeams.$inferSelect;
                readonly team: FantasyTeam;
              }> = [];
              for (const id of uniqueIds) {
                const entry = locked.get(id);
                if (entry === undefined) {
                  return yield* TeamNotFound.make({ team: id });
                }
                if (entry.team.automation.status === "paused-until-fantasy-day-end") {
                  continue;
                }
                if (entry.team.automation.status !== "enabled") {
                  return yield* TeamControlRejected.make({
                    team: id,
                    status: entry.team.automation.status,
                  });
                }
                const policy = fantasyDayPolicy(entry.team.provider, entry.team.league);
                const next = yield* planAutomation(automationStateOf(entry.team), {
                  _tag: "Paused",
                  at: now,
                  resumesAt: nextFantasyDayBoundary(now, policy),
                  timeZone: policy.timeZone,
                  fantasyDay: fantasyDayLabel(now, policy),
                  policyVersion: policy.version,
                }).pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
                changed.push({ row: entry.row, team: applyAutomation(entry.team, next, now) });
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
                    set: {
                      automationState: sql`excluded.automation_state`,
                      automationStatus: sql`excluded.automation_status`,
                      updatedAt: sql`excluded.updated_at`,
                    },
                  });
              }
              return changed.map(({ team }) => team);
            }),
          )
          .pipe(Effect.mapError(mapTransactionalError));
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
                .orderBy(sql`${providerTeams.automationState}->>'resumesAt' asc`)
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
                if (resumesAt === undefined || DateTime.toEpochMillis(resumesAt) > DateTime.toEpochMillis(now)) {
                  continue;
                }
                const next = yield* planAutomation(automationStateOf(team), {
                  _tag: "PauseExpired",
                  at: now,
                }).pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
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
                    set: {
                      automationState: sql`excluded.automation_state`,
                      automationStatus: sql`excluded.automation_status`,
                      updatedAt: sql`excluded.updated_at`,
                    },
                  });
              }
              return changed.map(({ team }) => team);
            }),
          )
          .pipe(Effect.mapError(mapTransactionalError));
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
            automationState: providerTeams.automationState,
            automationStatus: providerTeams.automationStatus,
            lastSeenAt: providerTeams.lastSeenAt,
            createdAt: providerTeams.createdAt,
            updatedAt: providerTeams.updatedAt,
            provider: providerTeams.provider,
            connectionStatus: providerConnections.status,
          })
          .from(providerTeams)
          .innerJoin(
            providerConnections,
            eq(providerConnections.id, providerTeams.connectionId),
          )
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

      return { list, load, setEnabled, pause, expirePauses, eligible };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

function toTeamRecord(
  row: unknown,
): Effect.Effect<TeamRecord, TeamPersistenceFailed> {
  return Effect.gen(function* () {
    const raw = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        id: Schema.String,
        connectionId: Schema.String,
        connectionStatus: Schema.String,
      }),
    )(row).pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
    const team = yield* Schema.decodeUnknownEffect(FantasyTeamRow)(row).pipe(
      Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })),
    );
    const status = yield* Schema.decodeUnknownEffect(ConnectionStatus)(raw.connectionStatus).pipe(
      Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })),
    );
    return {
      team,
      connection: {
        id: decodeConnectionId(raw.connectionId),
        status,
      },
    } satisfies TeamRecord;
  });
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
        team.automation.policyVersion === undefined
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
        policyVersion: team.automation.policyVersion,
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
          policyVersion: state.policyVersion,
        },
        updatedAt: changedAt,
      };
  }
}

function planAutomation(
  state: TeamAutomationState,
  event: TeamAutomationEvent,
): Effect.Effect<TeamAutomationState, unknown> {
  return Effect.gen(function* () {
    const snapshot = yield* snapshotOf(TeamAutomationWorkflow, state);
    const planned = yield* Machine.plan(TeamAutomationWorkflow, snapshot, event);
    const handled = planned.microsteps.some((step) => step.transitions.length > 0);
    if (!handled) {
      return yield* Effect.die(new Error("Team automation rejected the requested transition"));
    }
    return yield* Schema.decodeUnknownEffect(TeamAutomationState)(planned.next.state.value);
  });
}

function encodeAutomation(state: TeamAutomationState): unknown {
  return Schema.encodeSync(Schema.toCodecJson(TeamAutomationState))(state);
}

function mapTransactionalError(cause: unknown): TeamControlFailure {
  if (
    Schema.is(TeamPersistenceFailed)(cause) ||
    Schema.is(TeamNotFound)(cause) ||
    Schema.is(TeamControlRejected)(cause)
  ) {
    return cause;
  }
  return TeamPersistenceFailed.make({ cause });
}
