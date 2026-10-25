import { Machine } from "@typeonce/effect-machine";
import { and, asc, eq } from "drizzle-orm";
import { Array, Context, Crypto, DateTime, Effect, Layer, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import {
  ConnectionCreateFailed,
  ConnectionLinkExpired,
  ConnectionLinkRejected,
  ConnectionNotFound,
  ConnectionPersistenceFailed,
  decodeConnectionId,
} from "#contexts/connections/Connection.ts";
import type {
  ConnectionError,
  ConnectionIdInput,
  ProviderConnection,
  StartLinkingInput,
} from "#contexts/connections/Connection.ts";
import {
  connectionLinkingWindowMillis,
  connectionListLimit,
} from "#contexts/connections/ConnectionLimits.ts";
import { anyOf, maxInsertRows, mutateRows } from "#database/dbUtilities.ts";
import { chunked } from "#utilities/collections.ts";
import { planBatch, snapshotOf } from "#utilities/machine.ts";

import {
  ConnectionLifecycleEvents,
  ConnectionLifecycleStates,
  ConnectionLifecycleWorkflow,
} from "./ConnectionLifecycleWorkflow.ts";
import type { ConnectionLifecycleRequest } from "./ConnectionLifecycleWorkflow.ts";
import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { ConnectionRow, providerConnections } from "./ConnectionTables.ts";

export class ConnectionRepository extends Context.Service<ConnectionRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/ConnectionRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const crypto = yield* Crypto.Crypto;
      const generateConnectionId = crypto.randomUUIDv7().pipe(
        Effect.map(decodeConnectionId),
        Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
      );

      const listConnections = Effect.fn("ConnectionRepository.listConnections")(function* (
        userId: UserId,
      ) {
        const rows = yield* database
          .select()
          .from(providerConnections)
          .where(eq(providerConnections.userId, userId))
          .orderBy(asc(providerConnections.id))
          .limit(connectionListLimit)
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
        return yield* Effect.forEach(rows, toConnection);
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
            pairingCode: input.pairingCode,
            expiresAt: DateTime.toDateUtc(expiresAt),
            approvedAt: null,
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
              return yield* Effect.forEach(ordered, toConnection);
            }),
          )
          .pipe(mapTransactionError);
      });

      const cancelLinking = Effect.fn("ConnectionRepository.cancelLinking")(function* (
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
            mutateRows(transaction, providerConnections, {
              where: eq(providerConnections.userId, userId),
              ids,
              codec: ConnectionRow,
              plan: (locked) =>
                Effect.gen(function* () {
                  const targets: Array<{
                    readonly id: (typeof ids)[number];
                    readonly record: typeof ConnectionRow.Type;
                    readonly snapshot: Machine.Snapshot<typeof ConnectionLifecycleStates>;
                  }> = [];
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
                    const snapshot = yield* snapshotOf(
                      ConnectionLifecycleWorkflow,
                      record.state,
                    ).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
                    targets.push({ id, record, snapshot });
                  }
                  const cancelled: ConnectionLifecycleRequest =
                    ConnectionLifecycleEvents.cases.LinkCancelled.make({ at });
                  const planned = yield* planBatch(
                    ConnectionLifecycleWorkflow,
                    targets,
                    (_target) => cancelled,
                  ).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
                  return [
                    ...unchanged,
                    ...planned.map(({ row, snapshot }) => ({
                      ...row.record,
                      state: snapshot.state.value,
                    })),
                  ];
                }),
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              cause._tag === "SchemaError" ? ConnectionPersistenceFailed.make({ cause }) : cause,
            ),
            mapTransactionError,
            Effect.map((rows) => {
              const byId = new Map(rows.map((row) => [row.id, row]));
              return ids.flatMap((id) => {
                const row = byId.get(id);
                return row === undefined ? [] : [recordToConnection(row, row.state)];
              });
            }),
          );
      });

      const approveLinking = Effect.fn("ConnectionRepository.approveLinking")(function* (
        userId: UserId,
        inputs: ReadonlyArray<ConnectionIdInput>,
      ) {
        const ids = [...new Set(inputs.map((input) => input.id))];
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        const now = yield* DateTime.now;
        return yield* database
          .transaction((transaction) =>
            mutateRows(transaction, providerConnections, {
              where: eq(providerConnections.userId, userId),
              ids,
              codec: ConnectionRow,
              plan: (locked) =>
                Effect.gen(function* () {
                  const targets: Array<{
                    readonly id: (typeof ids)[number];
                    readonly record: typeof ConnectionRow.Type;
                    readonly snapshot: Machine.Snapshot<typeof ConnectionLifecycleStates>;
                  }> = [];
                  for (const id of ids) {
                    const record = locked.get(id);
                    if (record === undefined) {
                      return yield* ConnectionNotFound.make({ id });
                    }
                    if (record.state._tag !== "Linking") {
                      return yield* ConnectionLinkRejected.make({
                        id,
                        status: record.state._tag === "Ready" ? "ready" : "disconnected",
                      });
                    }
                    if (
                      DateTime.toEpochMillis(record.state.expiresAt) <= DateTime.toEpochMillis(now)
                    ) {
                      return yield* ConnectionLinkExpired.make({ id });
                    }
                    const snapshot = yield* snapshotOf(
                      ConnectionLifecycleWorkflow,
                      record.state,
                    ).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
                    targets.push({ id, record, snapshot });
                  }
                  const approved = yield* planBatch(
                    ConnectionLifecycleWorkflow,
                    targets,
                    (_target) => ConnectionLifecycleEvents.cases.LinkApproved.make({ at: now }),
                  ).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
                  return approved.map(({ row, snapshot }) => ({
                    ...row.record,
                    state: snapshot.state.value,
                  }));
                }),
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              cause._tag === "SchemaError" ? ConnectionPersistenceFailed.make({ cause }) : cause,
            ),
            mapTransactionError,
            Effect.map((rows) => {
              const byId = new Map(rows.map((row) => [row.id, row]));
              return ids.flatMap((id) => {
                const row = byId.get(id);
                return row === undefined ? [] : [recordToConnection(row, row.state)];
              });
            }),
          );
      });

      return { listConnections, startLinking, cancelLinking, approveLinking };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
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
        case "connection.link_expired":
        case "connection.link_rejected":
        case "connection.not_found":
        case "connection.persistence_failed":
          return cause;
      }
    }),
  );
}

const toConnection: (
  row: unknown,
) => Effect.Effect<ProviderConnection, ConnectionPersistenceFailed> = Effect.fnUntraced(
  function* (row: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(ConnectionRow)(row);
    return recordToConnection(decoded, decoded.state);
  },
  (effect) => effect.pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause }))),
);

function recordToConnection(
  {
    id,
    userId,
    pairingCode,
    createdAt,
  }: Pick<typeof ConnectionRow.Type, "id" | "userId" | "pairingCode" | "createdAt">,
  state: typeof ConnectionRow.Type.state,
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
        pairingCode,
        linkingExpiresAt: state.expiresAt,
      };
    case "Ready":
      return { ...content, status: "ready", approvedAt: state.approvedAt };
    case "Disconnected":
      return { ...content, status: "disconnected", disconnectedAt: state.disconnectedAt };
  }
}
