import { and, asc, eq, getTableColumns, notInArray, or } from "drizzle-orm";
import { Array, Context, Crypto, DateTime, Effect, Layer, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import {
  ConnectionCredentialGeneration,
  ConnectionCreateFailed,
  ConnectionCredentialGenerationStale,
  ConnectionLinkExpired,
  ConnectionLinkRejected,
  ConnectionNotFound,
  ConnectionPersistenceFailed,
  ProviderKey,
  decodeConnectionId,
} from "#contexts/connections/Connection.ts";
import {
  ConnectionId,
  type ConnectionError,
  ConnectionIdInput,
  ConnectionStatus,
  ProviderConnection,
  providerSessionOf,
  StartLinkingInput,
} from "#contexts/connections/Connection.ts";
import type { ProviderSessionEvidence } from "#contexts/connections/Connection.ts";
import {
  connectionLinkingWindowMillis,
  connectionListLimit,
} from "#contexts/connections/ConnectionLimits.ts";
import type { FantasyTeam } from "#contexts/connections/FantasyTeam.ts";
import { decodeTeamId } from "#contexts/connections/FantasyTeam.ts";
import type { ProviderTeam } from "#contexts/connections/Provider.ts";
import { anyOf, excludedValues, maxInsertRows, mutateRows } from "#database/dbUtilities.ts";
import { chunked } from "#utilities/collections.ts";
import { planBatch, type Snapshot, snapshotOf } from "#utilities/machine.ts";

import {
  ConnectionLifecycleEvents,
  ConnectionLifecycleWorkflow,
} from "./ConnectionLifecycleWorkflow.ts";
import type {
  ConnectionLifecycleRequest,
  ConnectionLifecycleState,
} from "./ConnectionLifecycleWorkflow.ts";
import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import {
  ConnectionRow,
  FantasyTeamRow,
  providerConnections,
  providerCredentials,
  providerTeams,
} from "./ConnectionTables.ts";
import { connectionIncidents, notifications } from "./IncidentTables.ts";
import { TeamAutomationState } from "./TeamAutomationWorkflow.ts";

type Transaction = Parameters<Parameters<ConnectionsDatabase["Service"]["transaction"]>[0]>[0];

export type CompleteLinkingCommand = {
  readonly id: ConnectionId;
  readonly provider: ProviderKey;
  readonly envelope: string;
};

export type ReconnectCommand = CompleteLinkingCommand & {
  readonly expectedGeneration: ConnectionCredentialGeneration;
};

type ReconnectRequiredCommand = {
  readonly id: ConnectionId;
  readonly expectedGeneration: ConnectionCredentialGeneration;
  readonly evidence?: ProviderSessionEvidence;
};

export type ReadyCredential = {
  readonly connectionId: ConnectionId;
  readonly provider: ProviderKey;
  readonly generation: ConnectionCredentialGeneration;
  readonly envelope: string;
};

export type TeamDiscovery = {
  readonly connectionId: ConnectionId;
  readonly teams: ReadonlyArray<ProviderTeam>;
};

export class ConnectionRepository extends Context.Service<ConnectionRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/ConnectionRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const crypto = yield* Crypto.Crypto;
      const generateConnectionId = crypto.randomULID.pipe(
        Effect.map(decodeConnectionId),
        Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
      );
      const newNotificationId = crypto.randomULID.pipe(
        Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
      );

      const listConnections = Effect.fn("ConnectionRepository.listConnections")(function* (
        userId: UserId,
      ) {
        const rows = yield* database
          .select({
            ...getTableColumns(providerConnections),
            provenAt: providerCredentials.provenAt,
          })
          .from(providerConnections)
          .leftJoin(
            providerCredentials,
            eq(providerCredentials.connectionId, providerConnections.id),
          )
          .where(eq(providerConnections.userId, userId))
          .orderBy(asc(providerConnections.id))
          .limit(connectionListLimit)
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
        return yield* Effect.forEach(rows, (row) =>
          toConnection({ connection: row, provenAt: row.provenAt }),
        );
      });

      const loadSessionHealth = Effect.fn("ConnectionRepository.loadSessionHealth")(function* (
        inputs: ReadonlyArray<{
          readonly userId: UserId;
          readonly ids: ReadonlyArray<ConnectionId>;
        }>,
      ) {
        const filters = inputs.flatMap((input) => {
          const ids = [...new Set(input.ids)];
          return Array.isArrayNonEmpty(ids)
            ? [
                and(
                  eq(providerConnections.userId, input.userId),
                  anyOf(providerConnections.id, ids),
                ),
              ]
            : [];
        });
        if (!Array.isArrayNonEmpty(filters)) {
          return [];
        }
        const rows = yield* database
          .select({ id: providerConnections.id, status: providerConnections.status })
          .from(providerConnections)
          .where(or(...filters))
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
        return yield* Effect.forEach(rows, (row) =>
          Effect.map(Schema.decodeEffect(ConnectionStatus)(row.status), (status) => ({
            id: decodeConnectionId(row.id),
            status,
          })).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause }))),
        );
      });

      const recordSessionProven = Effect.fn("ConnectionRepository.recordSessionProven")(function* (
        userId: UserId,
        connectionId: ConnectionId,
        generation: ConnectionCredentialGeneration,
        at: DateTime.Utc,
      ) {
        yield* database
          .update(providerCredentials)
          .set({ provenAt: DateTime.toDateUtc(at) })
          .where(
            and(
              eq(providerCredentials.userId, userId),
              eq(providerCredentials.connectionId, connectionId),
              eq(providerCredentials.generation, generation),
            ),
          )
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
      });

      const loadOwned = Effect.fn("ConnectionRepository.loadOwned")(function* (
        userId: UserId,
        ids: ReadonlyArray<ConnectionId>,
      ) {
        const uniqueIds = [...new Set(ids)];
        if (!Array.isArrayNonEmpty(uniqueIds)) {
          return [];
        }
        const rows = yield* database
          .select()
          .from(providerConnections)
          .where(
            and(eq(providerConnections.userId, userId), anyOf(providerConnections.id, uniqueIds)),
          )
          .orderBy(asc(providerConnections.id))
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
        const byId = new Map(
          yield* Effect.forEach(rows, (row) =>
            Schema.decodeEffect(ConnectionRow)(row).pipe(
              Effect.map((record) => [record.id, record] as const),
              Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
            ),
          ),
        );
        return yield* Effect.forEach(ids, (id) => {
          const record = byId.get(id);
          return record === undefined ? ConnectionNotFound.make({ id }) : Effect.succeed(record);
        });
      });

      const loadCredential = Effect.fn("ConnectionRepository.loadCredential")(function* (
        userId: UserId,
        connectionId: ConnectionId,
      ) {
        const rows = yield* database
          .select({
            provider: providerConnections.provider,
            generation: providerCredentials.generation,
            envelope: providerCredentials.envelope,
          })
          .from(providerConnections)
          .innerJoin(
            providerCredentials,
            eq(providerCredentials.connectionId, providerConnections.id),
          )
          .where(
            and(
              eq(providerConnections.userId, userId),
              eq(providerConnections.id, connectionId),
              eq(providerConnections.status, "ready"),
            ),
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
        const active = rows[0];
        if (active === undefined) {
          return yield* ConnectionNotFound.make({ id: connectionId });
        }
        return yield* Schema.decodeEffect(ActiveCredential)(active).pipe(
          Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
        );
      });

      const startLinking = Effect.fn("ConnectionRepository.startLinking")(function* (
        userId: UserId,
        inputs: ReadonlyArray<StartLinkingInput>,
      ) {
        if (inputs.length === 0) {
          return [];
        }
        const now = yield* DateTime.now;
        const expiresAt = DateTime.addDuration(now, connectionLinkingWindowMillis);
        const rows = yield* Effect.forEach(inputs, (input) =>
          Effect.map(generateConnectionId, (id) => ({
            id,
            userId,
            requestId: input.requestId,
            provider: input.provider,
            status: "linking" as const,
            expiresAt: DateTime.toDateUtc(expiresAt),
            approvedAt: null,
            credentialGeneration: null,
            reconnectRequiredAt: null,
            disconnectedAt: null,
            createdAt: DateTime.toDateUtc(now),
            updatedAt: DateTime.toDateUtc(now),
          })),
        );
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const sortedRows = rows.toSorted((left, right) =>
                left.requestId.localeCompare(right.requestId),
              );
              const inserted = yield* chunked(
                sortedRows,
                maxInsertRows(providerConnections),
                (chunk) =>
                  tx
                    .insert(providerConnections)
                    .values(chunk)
                    .onConflictDoNothing({
                      target: [providerConnections.userId, providerConnections.requestId],
                    })
                    .returning(),
              );
              const results = new Map(inserted.map((row) => [row.requestId, row]));
              const skipped = inputs
                .filter((input) => !results.has(input.requestId))
                .map((input) => input.requestId);
              if (Array.isArrayNonEmpty(skipped)) {
                const existing = yield* tx
                  .select()
                  .from(providerConnections)
                  .where(
                    and(
                      eq(providerConnections.userId, userId),
                      anyOf(providerConnections.requestId, skipped),
                    ),
                  );
                for (const row of existing) {
                  results.set(row.requestId, row);
                }
              }
              const ordered: Array<typeof providerConnections.$inferSelect> = [];
              for (const input of inputs) {
                const row = results.get(input.requestId);
                if (row === undefined) {
                  return yield* ConnectionCreateFailed.make({});
                }
                ordered.push(row);
              }
              yield* Effect.annotateCurrentSpan({
                "connections.created_count": inserted.length,
                "connections.replayed_count": inputs.length - inserted.length,
              });
              return yield* Effect.forEach(ordered, (row) =>
                toConnection({ connection: row, provenAt: null }),
              );
            }),
          )
          .pipe(mapTransactionError);
      });

      const discardLinking = Effect.fn("ConnectionRepository.discardLinking")(function* (
        userId: UserId,
        ids: ReadonlyArray<ConnectionId>,
      ) {
        const uniqueIds = [...new Set(ids)];
        if (!Array.isArrayNonEmpty(uniqueIds)) {
          return;
        }
        yield* database
          .delete(providerConnections)
          .where(
            and(
              eq(providerConnections.userId, userId),
              anyOf(providerConnections.id, uniqueIds),
              eq(providerConnections.status, "linking"),
            ),
          )
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
      });

      const completeLinking = Effect.fn("ConnectionRepository.completeLinking")(function* (
        userId: UserId,
        commands: ReadonlyArray<CompleteLinkingCommand>,
      ) {
        if (commands.length === 0) {
          return [];
        }
        const byId = new Map(commands.map((command) => [command.id, command]));
        const ids = [...byId.keys()];
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        const now = yield* DateTime.now;
        return yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const rows = yield* mutateRows(transaction, providerConnections, {
                where: eq(providerConnections.userId, userId),
                ids,
                codec: ConnectionRow,
                plan: (locked) =>
                  Effect.gen(function* () {
                    const targets: Array<LockedTarget> = [];
                    for (const id of ids) {
                      const record = locked.get(id);
                      const command = byId.get(id);
                      if (record === undefined || command === undefined) {
                        return yield* ConnectionNotFound.make({ id });
                      }
                      if (record.state._tag !== "Linking") {
                        return yield* ConnectionLinkRejected.make({
                          id,
                          status: connectionStatus(record.state),
                        });
                      }
                      if (
                        DateTime.toEpochMillis(record.state.expiresAt) <=
                        DateTime.toEpochMillis(now)
                      ) {
                        return yield* ConnectionLinkExpired.make({ id });
                      }
                      const snapshot = yield* snapshotOf(
                        ConnectionLifecycleWorkflow,
                        record.state,
                      ).pipe(
                        Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
                      );
                      targets.push({ id, record, snapshot });
                    }
                    const completed: ConnectionLifecycleRequest =
                      ConnectionLifecycleEvents.cases.LinkCompleted.make({
                        at: now,
                        credentialGeneration: makeCredentialGeneration(1),
                      });
                    const planned = yield* planBatch(
                      ConnectionLifecycleWorkflow,
                      targets,
                      (_target) => completed,
                    ).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
                    return planned.map(({ row, snapshot }) => ({
                      ...row.record,
                      state: snapshot.state,
                    }));
                  }),
              });
              const credentials = credentialRows(rows, byId, now);
              yield* transaction
                .delete(providerCredentials)
                .where(
                  and(
                    eq(providerCredentials.userId, userId),
                    anyOf(providerCredentials.connectionId, ids),
                  ),
                );
              yield* chunked(credentials, maxInsertRows(providerCredentials), (chunk) =>
                transaction.insert(providerCredentials).values(chunk).returning(),
              );
              yield* resolveIncidents(transaction, ids, now, "reconnected");
              return orderConnections(rows, ids);
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              cause._tag === "SchemaError" ? ConnectionPersistenceFailed.make({ cause }) : cause,
            ),
            mapTransactionError,
            Effect.map((rows) => rows.map((row) => recordToConnection(row, row.state))),
          );
      });

      const reconnect = Effect.fn("ConnectionRepository.reconnect")(function* (
        userId: UserId,
        commands: ReadonlyArray<ReconnectCommand>,
      ) {
        if (commands.length === 0) {
          return [];
        }
        const byId = new Map(commands.map((command) => [command.id, command]));
        const ids = [...byId.keys()];
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        const now = yield* DateTime.now;
        return yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const rows = yield* mutateRows(transaction, providerConnections, {
                where: eq(providerConnections.userId, userId),
                ids,
                codec: ConnectionRow,
                plan: (locked) =>
                  Effect.gen(function* () {
                    const targets: Array<LockedTarget> = [];
                    const generations = new Map<string, ConnectionCredentialGeneration>();
                    for (const id of ids) {
                      const record = locked.get(id);
                      const command = byId.get(id);
                      if (record === undefined || command === undefined) {
                        return yield* ConnectionNotFound.make({ id });
                      }
                      if (
                        record.state._tag !== "Ready" &&
                        record.state._tag !== "ReconnectRequired"
                      ) {
                        return yield* ConnectionLinkRejected.make({
                          id,
                          status: connectionStatus(record.state),
                        });
                      }
                      if (record.state.credentialGeneration !== command.expectedGeneration) {
                        return yield* ConnectionCredentialGenerationStale.make({
                          id,
                          expectedGeneration: command.expectedGeneration,
                          actualGeneration: record.state.credentialGeneration,
                        });
                      }
                      generations.set(
                        id,
                        makeCredentialGeneration(record.state.credentialGeneration + 1),
                      );
                      const snapshot = yield* snapshotOf(
                        ConnectionLifecycleWorkflow,
                        record.state,
                      ).pipe(
                        Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
                      );
                      targets.push({ id, record, snapshot });
                    }
                    const planned = yield* planBatch(
                      ConnectionLifecycleWorkflow,
                      targets,
                      (target) => {
                        const credentialGeneration = generations.get(target.id);
                        if (credentialGeneration === undefined) {
                          throw new Error("reconnect target is missing its credential generation");
                        }
                        return ConnectionLifecycleEvents.cases.Reconnected.make({
                          at: now,
                          credentialGeneration,
                        });
                      },
                    ).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
                    return planned.map(({ row, snapshot }) => ({
                      ...row.record,
                      state: snapshot.state,
                    }));
                  }),
              });
              const credentials = credentialRows(rows, byId, now);
              yield* transaction
                .delete(providerCredentials)
                .where(
                  and(
                    eq(providerCredentials.userId, userId),
                    anyOf(providerCredentials.connectionId, ids),
                  ),
                );
              yield* chunked(credentials, maxInsertRows(providerCredentials), (chunk) =>
                transaction.insert(providerCredentials).values(chunk).returning(),
              );

              yield* resolveIncidents(transaction, ids, now, "reconnected");
              return orderConnections(rows, ids);
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              cause._tag === "SchemaError" ? ConnectionPersistenceFailed.make({ cause }) : cause,
            ),
            mapTransactionError,
            Effect.map((rows) => rows.map((row) => recordToConnection(row, row.state))),
          );
      });

      const disconnect = Effect.fn("ConnectionRepository.disconnect")(function* (
        userId: UserId,
        inputs: ReadonlyArray<ConnectionIdInput>,
      ) {
        const ids = [...new Set(inputs.map((input) => input.id))];
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        const at = yield* DateTime.now;
        return yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const rows = yield* mutateRows(transaction, providerConnections, {
                where: eq(providerConnections.userId, userId),
                ids,
                codec: ConnectionRow,
                plan: (locked) =>
                  Effect.gen(function* () {
                    const targets: Array<LockedTarget> = [];
                    const unchanged: Array<typeof ConnectionRow.Type> = [];
                    for (const id of ids) {
                      const record = locked.get(id);
                      if (record === undefined) {
                        return yield* ConnectionNotFound.make({ id });
                      }
                      if (record.state._tag === "Disconnected") {
                        unchanged.push(record);
                        continue;
                      }
                      if (record.state._tag === "Linking") {
                        return yield* ConnectionLinkRejected.make({ id, status: "linking" });
                      }
                      const snapshot = yield* snapshotOf(
                        ConnectionLifecycleWorkflow,
                        record.state,
                      ).pipe(
                        Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
                      );
                      targets.push({ id, record, snapshot });
                    }
                    const disconnected: ConnectionLifecycleRequest =
                      ConnectionLifecycleEvents.cases.Disconnected.make({ at });
                    const planned = yield* planBatch(
                      ConnectionLifecycleWorkflow,
                      targets,
                      (_target) => disconnected,
                    ).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
                    return [
                      ...unchanged,
                      ...planned.map(({ row, snapshot }) => ({
                        ...row.record,
                        state: snapshot.state,
                      })),
                    ];
                  }),
              });
              yield* transaction
                .delete(providerCredentials)
                .where(
                  and(
                    eq(providerCredentials.userId, userId),
                    anyOf(providerCredentials.connectionId, ids),
                  ),
                );
              yield* transaction
                .update(providerTeams)
                .set({ availability: "unavailable", updatedAt: DateTime.toDateUtc(at) })
                .where(
                  and(eq(providerTeams.userId, userId), anyOf(providerTeams.connectionId, ids)),
                );

              return orderConnections(rows, ids);
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              cause._tag === "SchemaError" ? ConnectionPersistenceFailed.make({ cause }) : cause,
            ),
            mapTransactionError,
            Effect.map((rows) => rows.map((row) => recordToConnection(row, row.state))),
          );
      });

      const markReconnectRequired = Effect.fn("ConnectionRepository.markReconnectRequired")(
        function* (userId: UserId, commands: ReadonlyArray<ReconnectRequiredCommand>) {
          if (commands.length === 0) {
            return [];
          }
          const byId = new Map(commands.map((command) => [command.id, command]));
          const ids = [...byId.keys()];
          if (!Array.isArrayNonEmpty(ids)) {
            return [];
          }
          const at = yield* DateTime.now;
          return yield* database
            .transaction((transaction) =>
              mutateRows(transaction, providerConnections, {
                where: eq(providerConnections.userId, userId),
                ids,
                codec: ConnectionRow,
                plan: (locked) =>
                  Effect.gen(function* () {
                    const targets: Array<LockedTarget> = [];
                    const unchanged: Array<typeof ConnectionRow.Type> = [];
                    for (const id of ids) {
                      const record = locked.get(id);
                      const command = byId.get(id);
                      if (record === undefined || command === undefined) {
                        return yield* ConnectionNotFound.make({ id });
                      }
                      if (record.state._tag === "ReconnectRequired") {
                        if (record.state.credentialGeneration !== command.expectedGeneration) {
                          return yield* ConnectionCredentialGenerationStale.make({
                            id,
                            expectedGeneration: command.expectedGeneration,
                            actualGeneration: record.state.credentialGeneration,
                          });
                        }
                        unchanged.push(record);
                        continue;
                      }
                      if (record.state._tag !== "Ready") {
                        return yield* ConnectionLinkRejected.make({
                          id,
                          status: connectionStatus(record.state),
                        });
                      }
                      if (record.state.credentialGeneration !== command.expectedGeneration) {
                        return yield* ConnectionCredentialGenerationStale.make({
                          id,
                          expectedGeneration: command.expectedGeneration,
                          actualGeneration: record.state.credentialGeneration,
                        });
                      }
                      const snapshot = yield* snapshotOf(
                        ConnectionLifecycleWorkflow,
                        record.state,
                      ).pipe(
                        Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
                      );
                      targets.push({ id, record, snapshot });
                    }
                    const required: ConnectionLifecycleRequest =
                      ConnectionLifecycleEvents.cases.ReconnectRequired.make({ at });
                    const planned = yield* planBatch(
                      ConnectionLifecycleWorkflow,
                      targets,
                      (_target) => required,
                    ).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
                    const next = [
                      ...unchanged,
                      ...planned.map(({ row, snapshot }) => ({
                        ...row.record,
                        state: snapshot.state,
                      })),
                    ];
                    const candidates = next.flatMap((record) =>
                      record.state._tag === "ReconnectRequired"
                        ? [
                            {
                              userId: record.userId,
                              connectionId: record.id,
                              credentialGeneration: record.state.credentialGeneration,
                              status: "open" as const,
                              openedAt: DateTime.toDateUtc(at),
                              operation: byId.get(record.id)?.evidence?.operation ?? null,
                              providerStatus: byId.get(record.id)?.evidence?.status ?? null,
                              providerDetail: byId.get(record.id)?.evidence?.detail ?? null,
                              resolvedAt: null,
                              resolution: null,
                            },
                          ]
                        : [],
                    );
                    if (candidates.length > 0) {
                      const incidentIds = yield* Effect.replicateEffect(candidates.length)(
                        crypto.randomULID,
                      ).pipe(
                        Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
                      );
                      yield* transaction
                        .insert(connectionIncidents)
                        .values(
                          Array.zipWith(candidates, incidentIds, (candidate, id) => ({
                            id,
                            ...candidate,
                          })),
                        )
                        .onConflictDoNothing({
                          target: [
                            connectionIncidents.connectionId,
                            connectionIncidents.credentialGeneration,
                          ],
                        });
                    }
                    const incidentConnectionIds: string[] = [
                      ...new Set(candidates.map((candidate) => candidate.connectionId)),
                    ];
                    if (Array.isArrayNonEmpty(incidentConnectionIds)) {
                      const open = yield* transaction
                        .select({
                          id: connectionIncidents.id,
                          userId: connectionIncidents.userId,
                        })
                        .from(connectionIncidents)
                        .where(
                          and(
                            eq(connectionIncidents.status, "open"),
                            anyOf(connectionIncidents.connectionId, incidentConnectionIds),
                          ),
                        );
                      if (Array.isArrayNonEmpty(open)) {
                        const pending = yield* Effect.forEach(open, (incident) =>
                          Effect.map(
                            newNotificationId,
                            (id): typeof notifications.$inferInsert => ({
                              id,
                              userId: incident.userId,
                              incidentId: incident.id,
                              kind: "connection_reconnect_required",
                              status: "pending",
                              attempts: 0,
                              nextAttemptAt: DateTime.toDateUtc(at),
                              lastError: null,
                              createdAt: DateTime.toDateUtc(at),
                              updatedAt: DateTime.toDateUtc(at),
                              sentAt: null,
                            }),
                          ),
                        );
                        yield* transaction
                          .insert(notifications)
                          .values(pending)
                          .onConflictDoNothing({ target: notifications.incidentId });
                      }
                    }
                    return next;
                  }),
              }),
            )
            .pipe(
              Effect.mapError((cause) =>
                cause._tag === "SchemaError" ? ConnectionPersistenceFailed.make({ cause }) : cause,
              ),
              mapTransactionError,
              Effect.map((rows) => rows.map((row) => recordToConnection(row, row.state))),
            );
        },
      );

      const loadCredentials = Effect.fn("ConnectionRepository.loadCredentials")(function* (
        userId: UserId,
        ids: ReadonlyArray<ConnectionId>,
      ) {
        const uniqueIds = [...new Set(ids)];
        if (!Array.isArrayNonEmpty(uniqueIds)) {
          return [];
        }
        const rows = yield* database
          .select({
            connectionId: providerCredentials.connectionId,
            provider: providerCredentials.provider,
            generation: providerCredentials.generation,
            envelope: providerCredentials.envelope,
          })
          .from(providerCredentials)
          .innerJoin(
            providerConnections,
            eq(providerCredentials.connectionId, providerConnections.id),
          )
          .where(
            and(
              eq(providerCredentials.userId, userId),
              eq(providerConnections.userId, userId),
              anyOf(providerCredentials.connectionId, uniqueIds),
              eq(providerConnections.status, "ready"),
            ),
          )
          .orderBy(asc(providerCredentials.connectionId))
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
        const byId = new Map(
          yield* Effect.forEach(rows, (row) =>
            Schema.decodeEffect(ReadyCredentialRow)(row).pipe(
              Effect.map((credential) => [credential.connectionId, credential] as const),
              Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
            ),
          ),
        );
        return yield* Effect.forEach(ids, (id) => {
          const credential = byId.get(id);
          return credential === undefined
            ? ConnectionPersistenceFailed.make({
                cause: new Error("ready connection is missing its credential"),
              })
            : Effect.succeed(credential);
        });
      });

      const recordDiscoveries = Effect.fn("ConnectionRepository.recordDiscoveries")(function* (
        userId: UserId,
        discoveries: ReadonlyArray<TeamDiscovery>,
        at: DateTime.Utc,
      ) {
        if (discoveries.length === 0) {
          return;
        }
        const ids = [...new Set(discoveries.map((discovery) => discovery.connectionId))];
        if (!Array.isArrayNonEmpty(ids)) {
          return;
        }
        const atDate = DateTime.toDateUtc(at);
        const rows = yield* Effect.forEach(
          discoveries,
          ({ connectionId, teams }) =>
            Effect.forEach(
              teams,
              (team) =>
                crypto.randomULID.pipe(
                  Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
                  Effect.map((id) => ({
                    id: decodeTeamId(id),
                    connectionId,
                    userId,
                    provider: team.provider,
                    providerTeamKey: team.providerTeamKey,
                    providerLeagueKey: team.providerLeagueKey,
                    league: team.league,
                    sport: team.sport,
                    season: team.season,
                    name: team.name,
                    leagueName: team.leagueName ?? null,
                    providerUrl: team.providerUrl ?? null,
                    availability: "available" as const,
                    automationState: Schema.encodeSync(Schema.toCodecJson(TeamAutomationState))({
                      _tag: "Disabled" as const,
                      changedAt: at,
                    }),
                    automationStatus: "disabled" as const,
                    lastSeenAt: atDate,
                    createdAt: atDate,
                    updatedAt: atDate,
                  })),
                ),
              { concurrency: 1 },
            ),
          { concurrency: 1 },
        ).pipe(Effect.map((nested) => nested.flat()));
        yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const owned = yield* tx
                .select({ id: providerConnections.id })
                .from(providerConnections)
                .where(
                  and(eq(providerConnections.userId, userId), anyOf(providerConnections.id, ids)),
                );
              const ownedIds = new Set(owned.map((row) => row.id));
              for (const id of ids) {
                if (!ownedIds.has(id)) {
                  return yield* ConnectionNotFound.make({ id });
                }
              }
              if (rows.length > 0) {
                yield* chunked(rows, maxInsertRows(providerTeams), (chunk) =>
                  tx
                    .insert(providerTeams)
                    .values(chunk)
                    .onConflictDoUpdate({
                      target: [providerTeams.connectionId, providerTeams.providerTeamKey],
                      set: excludedValues(providerTeams, [
                        "providerLeagueKey",
                        "league",
                        "sport",
                        "season",
                        "name",
                        "leagueName",
                        "providerUrl",
                        "availability",
                        "lastSeenAt",
                        "updatedAt",
                      ]),
                    })
                    .returning(),
                );
              }
              for (const { connectionId, teams } of discoveries) {
                const keys = teams.map((team) => team.providerTeamKey);
                yield* tx
                  .update(providerTeams)
                  .set({ availability: "unavailable", updatedAt: atDate })
                  .where(
                    keys.length === 0
                      ? and(
                          eq(providerTeams.userId, userId),
                          eq(providerTeams.connectionId, connectionId),
                        )
                      : and(
                          eq(providerTeams.userId, userId),
                          eq(providerTeams.connectionId, connectionId),
                          notInArray(providerTeams.providerTeamKey, keys),
                        ),
                  );
              }
            }),
          )
          .pipe(mapTransactionError);
      });

      const listTeams = Effect.fn("ConnectionRepository.listTeams")(function* (userId: UserId) {
        const rows = yield* database
          .select()
          .from(providerTeams)
          .where(eq(providerTeams.userId, userId))
          .orderBy(asc(providerTeams.league), asc(providerTeams.name), asc(providerTeams.id))
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
        return yield* Effect.forEach(rows, toFantasyTeam);
      });

      const listTeamsForConnections = Effect.fn("ConnectionRepository.listTeamsForConnections")(
        function* (userId: UserId, ids: ReadonlyArray<ConnectionId>) {
          const uniqueIds = [...new Set(ids)];
          if (!Array.isArrayNonEmpty(uniqueIds)) {
            return [];
          }
          const rows = yield* database
            .select()
            .from(providerTeams)
            .where(
              and(eq(providerTeams.userId, userId), anyOf(providerTeams.connectionId, uniqueIds)),
            )
            .orderBy(asc(providerTeams.league), asc(providerTeams.name), asc(providerTeams.id))
            .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
          return yield* Effect.forEach(rows, toFantasyTeam);
        },
      );

      return {
        listConnections,
        loadSessionHealth,
        recordSessionProven,
        loadOwned,
        loadCredential,
        startLinking,
        discardLinking,
        completeLinking,
        reconnect,
        disconnect,
        markReconnectRequired,
        loadCredentials,
        recordDiscoveries,
        listTeams,
        listTeamsForConnections,
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

function resolveIncidents(
  tx: Transaction,
  connectionIds: ReadonlyArray<ConnectionId>,
  at: DateTime.Utc,
  resolution: "reconnected" | "disconnected",
): Effect.Effect<void, ConnectionPersistenceFailed> {
  const ids = [...connectionIds];
  if (!Array.isArrayNonEmpty(ids)) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    const resolved = yield* tx
      .update(connectionIncidents)
      .set({
        status: "resolved",
        resolvedAt: DateTime.toDateUtc(at),
        resolution,
      })
      .where(
        and(eq(connectionIncidents.status, "open"), anyOf(connectionIncidents.connectionId, ids)),
      )
      .returning({ id: connectionIncidents.id });
    const incidentIds: string[] = resolved.map((row) => row.id);
    if (!Array.isArrayNonEmpty(incidentIds)) {
      return;
    }
    yield* tx
      .update(notifications)
      .set({ status: "cancelled", updatedAt: DateTime.toDateUtc(at) })
      .where(
        and(eq(notifications.status, "pending"), anyOf(notifications.incidentId, incidentIds)),
      );
  }).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
}

function connectionStatus(state: typeof ConnectionRow.Type.state): ConnectionStatus {
  switch (state._tag) {
    case "Linking":
      return "linking" as const;
    case "Ready":
      return "ready" as const;
    case "ReconnectRequired":
      return "reconnect-required" as const;
    case "Disconnected":
      return "disconnected" as const;
  }
}

function credentialRows(
  rows: ReadonlyArray<typeof ConnectionRow.Type>,
  commands: ReadonlyMap<string, CompleteLinkingCommand>,
  now: DateTime.Utc,
): ReadonlyArray<{
  readonly connectionId: ConnectionId;
  readonly userId: UserId;
  readonly provider: ProviderKey;
  readonly generation: ConnectionCredentialGeneration;
  readonly envelope: string;
  readonly provenAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}> {
  const at = DateTime.toDateUtc(now);
  return rows.map((row) => {
    const command = commands.get(row.id);
    if (command === undefined || row.state._tag !== "Ready") {
      throw new Error("completed connection is missing its credential");
    }
    return {
      connectionId: row.id,
      userId: row.userId,
      provider: row.state.provider,
      generation: row.state.credentialGeneration,
      envelope: command.envelope,
      provenAt: at,
      createdAt: at,
      updatedAt: at,
    };
  });
}

function orderConnections(
  rows: ReadonlyArray<typeof ConnectionRow.Type>,
  ids: ReadonlyArray<ConnectionId>,
): ReadonlyArray<typeof ConnectionRow.Type> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [row];
  });
}

function makeCredentialGeneration(value: number): ConnectionCredentialGeneration {
  return Schema.decodeSync(ConnectionCredentialGeneration)(value);
}

function mapTransactionError<A, R>(
  effect: Effect.Effect<
    A,
    ConnectionError | { readonly _tag: "SqlError" | "EffectDrizzleQueryError" },
    R
  >,
): Effect.Effect<A, ConnectionError, R> {
  return effect.pipe(
    Effect.mapError((cause) => {
      switch (cause._tag) {
        case "SqlError":
        case "EffectDrizzleQueryError":
          return ConnectionPersistenceFailed.make({ cause });
        case "connection.create_failed":
        case "connection.credential_generation_stale":
        case "connection.link_expired":
        case "connection.link_rejected":
        case "connection.not_found":
        case "connection.persistence_failed":
        case "connection.provider_rejected":
        case "connection.provider_unavailable":
          return cause;
      }
    }),
  );
}

const toFantasyTeam: (row: unknown) => Effect.Effect<FantasyTeam, ConnectionPersistenceFailed> =
  Effect.fnUntraced(
    function* (row: unknown) {
      return yield* Schema.decodeUnknownEffect(FantasyTeamRow)(row);
    },
    (effect) =>
      effect.pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause }))),
  );

const toConnection: (row: {
  readonly connection: unknown;
  readonly provenAt: Date | null;
}) => Effect.Effect<ProviderConnection, ConnectionPersistenceFailed> = Effect.fnUntraced(
  function* (row) {
    const decoded = yield* Schema.decodeUnknownEffect(ConnectionRow)(row.connection);
    const provenAt =
      row.provenAt === null ? undefined : DateTime.makeUnsafe(row.provenAt.getTime());
    return recordToConnection(decoded, decoded.state, provenAt);
  },
  (effect) => effect.pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause }))),
);

function recordToConnection(
  { id, userId, createdAt }: Pick<typeof ConnectionRow.Type, "id" | "userId" | "createdAt">,
  state: typeof ConnectionRow.Type.state,
  provenAt?: DateTime.Utc,
): ProviderConnection {
  const content = {
    id,
    userId,
    provider: state.provider,
    createdAt,
    updatedAt: state.updatedAt,
  };
  switch (state._tag) {
    case "Linking":
      return {
        ...content,
        status: "linking",
        session: providerSessionOf({ status: "linking" }),
        linkingExpiresAt: state.expiresAt,
      };
    case "Ready":
      return {
        ...content,
        status: "ready",
        session: providerSessionOf({
          status: "ready",
          provenAt: provenAt ?? state.approvedAt,
        }),
        approvedAt: state.approvedAt,
        credentialGeneration: state.credentialGeneration,
      };
    case "ReconnectRequired":
      return {
        ...content,
        status: "reconnect-required",
        session: providerSessionOf({
          status: "reconnect-required",
          ...(provenAt === undefined ? {} : { provenAt }),
          rejectedAt: state.reconnectRequiredAt,
        }),
        credentialGeneration: state.credentialGeneration,
        reconnectRequiredAt: state.reconnectRequiredAt,
      };
    case "Disconnected":
      return {
        ...content,
        status: "disconnected",
        session: providerSessionOf({ status: "disconnected" }),
        disconnectedAt: state.disconnectedAt,
      };
  }
}

type LockedTarget = {
  readonly id: ConnectionId;
  readonly record: typeof ConnectionRow.Type;
  readonly snapshot: Snapshot<ConnectionLifecycleState>;
};

const ReadyCredentialRow = Schema.Struct({
  connectionId: ConnectionId,
  provider: ProviderKey,
  generation: ConnectionCredentialGeneration,
  envelope: Schema.String,
});

const ActiveCredential = Schema.Struct({
  provider: ProviderKey,
  generation: ConnectionCredentialGeneration,
  envelope: Schema.String,
});
