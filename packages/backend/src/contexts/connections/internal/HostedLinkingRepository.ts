import { and, count, eq, gte, lte, or } from "drizzle-orm";
import { Array, Context, DateTime, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { ConnectionId, Provider } from "#contexts/connections/Connection.ts";
import { hostedLinkingWindowMillis } from "#contexts/connections/ConnectionLimits.ts";
import {
  HostedLinkingExpired,
  HostedLinkingNotActive,
  HostedLinkingNotFound,
  HostedLinkingPersistenceFailed,
  HostedLinkingSessionActive,
  HostedLinkingSessionId,
  HostedLinkingTicketRejected,
} from "#contexts/connections/HostedLinking.ts";
import type {
  HostedLinkingError,
  HostedLinkingFailureReason,
  HostedLinkingSessionStatus,
} from "#contexts/connections/HostedLinking.ts";
import { anyOf } from "#database/dbUtilities.ts";
import { planBatch, snapshotOf } from "#utilities/machine.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import {
  HostedLinkingRow,
  hostedLinkingSessionLocks,
  hostedLinkingSessions,
} from "./HostedLinkingTables.ts";
import type { HostedLinkingState } from "./HostedLinkingWorkflow.ts";
import { HostedLinkingEvents, HostedLinkingWorkflow } from "./HostedLinkingWorkflow.ts";
import type { HostedLinkingRequest } from "./HostedLinkingWorkflow.ts";

type Transaction = Parameters<Parameters<ConnectionsDatabase["Service"]["transaction"]>[0]>[0];
export type HostedLinkingRecord = typeof HostedLinkingRow.Type;
type Record = HostedLinkingRecord;

type CreateHostedLinkingCommand = {
  readonly id: HostedLinkingSessionId;
  readonly connectionId: ConnectionId;
  readonly provider: Provider;
  readonly ticketHash: string;
};

type ClaimHostedLinkingCommand = {
  readonly id: HostedLinkingSessionId;
  readonly ticketHash: string;
  readonly at: DateTime.Utc;
};

export class HostedLinkingRepository extends Context.Service<
  HostedLinkingRepository,
  HostedLinkingRepositoryShape
>()("@lineupkeep/backend/contexts/connections/internal/HostedLinkingRepository") {
  static readonly layer = Layer.effect(
    HostedLinkingRepository,
    Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;

      const loadOwned = Effect.fn("HostedLinkingRepository.loadOwned")(function* (
        userId: UserId,
        id: HostedLinkingSessionId,
      ) {
        const rows = yield* database
          .select()
          .from(hostedLinkingSessions)
          .where(and(eq(hostedLinkingSessions.userId, userId), eq(hostedLinkingSessions.id, id)))
          .limit(1)
          .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
        const row = rows[0];
        if (row === undefined) {
          return yield* HostedLinkingNotFound.make({ id });
        }
        return yield* decodeRow(row);
      });

      const create = Effect.fn("HostedLinkingRepository.create")(function* (
        userId: UserId,
        command: CreateHostedLinkingCommand,
      ) {
        const now = yield* DateTime.now;
        const state: typeof HostedLinkingState.Type = {
          _tag: "Active",
          connectionId: command.connectionId,
          provider: command.provider,
          startedAt: now,
          expiresAt: DateTime.addDuration(now, hostedLinkingWindowMillis),
          updatedAt: now,
        };
        const values = yield* encodeRecord({
          id: command.id,
          userId,
          ticketHash: command.ticketHash,
          createdAt: now,
          state,
        });
        return yield* transaction((tx) =>
          Effect.gen(function* () {
            const lock = yield* tx
              .insert(hostedLinkingSessionLocks)
              .values({ userId, sessionId: command.id })
              .onConflictDoNothing()
              .returning()
              .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
            if (lock.length === 0) {
              return yield* HostedLinkingSessionActive.make({});
            }
            const inserted = yield* tx
              .insert(hostedLinkingSessions)
              .values(values)
              .returning()
              .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
            return yield* decodeRow(Array.getUnsafe(inserted, 0));
          }),
        );
      });

      const countStartsSince = Effect.fn("HostedLinkingRepository.countStartsSince")(function* (
        userId: UserId,
        since: DateTime.Utc,
      ) {
        const rows = yield* database
          .select({ value: count() })
          .from(hostedLinkingSessions)
          .where(
            and(
              eq(hostedLinkingSessions.userId, userId),
              gte(hostedLinkingSessions.createdAt, DateTime.toDateUtc(since)),
            ),
          )
          .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
        return rows[0]?.value ?? 0;
      });

      const expireStale = Effect.fn("HostedLinkingRepository.expireStale")(function* (
        userId: UserId,
        at: DateTime.Utc,
      ) {
        const stale = yield* database
          .select({ id: hostedLinkingSessions.id })
          .from(hostedLinkingSessions)
          .where(
            and(
              eq(hostedLinkingSessions.userId, userId),
              or(
                eq(hostedLinkingSessions.status, "active"),
                eq(hostedLinkingSessions.status, "completing"),
              ),
              lte(hostedLinkingSessions.expiresAt, DateTime.toDateUtc(at)),
            ),
          )
          .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
        const ids = yield* Effect.forEach(stale, ({ id }) =>
          Schema.decodeEffect(HostedLinkingSessionId)(id).pipe(
            Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })),
          ),
        );
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        return yield* transition(userId, ids, () => expireRequest(at));
      });

      const claimCompletion = Effect.fn("HostedLinkingRepository.claimCompletion")(function* (
        userId: UserId,
        command: ClaimHostedLinkingCommand,
      ) {
        const records = yield* transaction((tx) =>
          mutateRows(tx, userId, [command.id], (locked, id) => {
            const record = locked.get(id);
            if (record === undefined) {
              return Effect.fail(HostedLinkingNotFound.make({ id }));
            }
            if (record.ticketHash !== command.ticketHash) {
              return Effect.fail(HostedLinkingTicketRejected.make({ id }));
            }
            if (record.state._tag === "Active" && isExpired(record.state, command.at)) {
              return transitionRecord(record, expireRequest(command.at));
            }
            if (record.state._tag !== "Active") {
              return Effect.fail(
                HostedLinkingNotActive.make({ id, status: statusOf(record.state) }),
              );
            }
            return transitionRecord(
              record,
              HostedLinkingEvents.cases.CompletionStarted.make({ at: command.at }),
            );
          }),
        );
        const record = Array.getUnsafe(records, 0);
        return record.state._tag === "Expired"
          ? yield* HostedLinkingExpired.make({ id: record.id })
          : record;
      });

      const markCompleted = Effect.fn("HostedLinkingRepository.markCompleted")(function* (
        userId: UserId,
        id: HostedLinkingSessionId,
        at: DateTime.Utc,
      ) {
        const records = yield* transition(userId, [id], (record) =>
          record.state._tag === "Completing"
            ? HostedLinkingEvents.cases.CompletionSucceeded.make({ at })
            : notActive(record),
        );
        return Array.getUnsafe(records, 0);
      });

      const markFailed = Effect.fn("HostedLinkingRepository.markFailed")(function* (
        userId: UserId,
        id: HostedLinkingSessionId,
        at: DateTime.Utc,
        reason: HostedLinkingFailureReason,
      ) {
        const records = yield* transition(userId, [id], (record) =>
          record.state._tag === "Active" || record.state._tag === "Completing"
            ? HostedLinkingEvents.cases.CompletionFailed.make({ at, reason })
            : notActive(record),
        );
        return Array.getUnsafe(records, 0);
      });

      const cancel = Effect.fn("HostedLinkingRepository.cancel")(function* (
        userId: UserId,
        ids: ReadonlyArray<HostedLinkingSessionId>,
        at: DateTime.Utc,
      ) {
        return yield* transition(userId, ids, (record) => {
          if (record.state._tag === "Cancelled") {
            return undefined;
          }
          return record.state._tag === "Active" || record.state._tag === "Completing"
            ? HostedLinkingEvents.cases.Cancelled.make({ at })
            : notActive(record);
        });
      });

      const expire = Effect.fn("HostedLinkingRepository.expire")(function* (
        userId: UserId,
        ids: ReadonlyArray<HostedLinkingSessionId>,
        at: DateTime.Utc,
      ) {
        return yield* transition(userId, ids, (record) => {
          if (record.state._tag === "Expired") {
            return undefined;
          }
          return record.state._tag === "Active" || record.state._tag === "Completing"
            ? expireRequest(at)
            : notActive(record);
        });
      });

      function transition(
        userId: UserId,
        ids: ReadonlyArray<HostedLinkingSessionId>,
        request: (record: Record) => HostedLinkingRequest | NotActiveRecord | undefined,
      ): Effect.Effect<ReadonlyArray<Record>, HostedLinkingError> {
        if (ids.length === 0) {
          return Effect.succeed([]);
        }
        return transaction((tx) =>
          mutateRows(tx, userId, ids, (locked, id) => {
            const record = locked.get(id);
            if (record === undefined) {
              return Effect.fail(HostedLinkingNotFound.make({ id }));
            }
            const planned = request(record);
            if (planned === undefined) {
              return Effect.succeed(record);
            }
            if ("_tag" in planned && planned._tag === "not-active") {
              return Effect.fail(
                HostedLinkingNotActive.make({ id, status: statusOf(record.state) }),
              );
            }
            return transitionRecord(record, planned);
          }),
        );
      }

      function mutateRows(
        tx: Transaction,
        userId: UserId,
        ids: ReadonlyArray<HostedLinkingSessionId>,
        plan: (
          locked: ReadonlyMap<string, Record>,
          id: HostedLinkingSessionId,
        ) => Effect.Effect<Record, HostedLinkingError>,
      ): Effect.Effect<ReadonlyArray<Record>, HostedLinkingError> {
        const [first, ...rest] = ids;
        if (first === undefined) {
          return Effect.succeed([]);
        }
        return Effect.gen(function* () {
          const rows = yield* tx
            .select()
            .from(hostedLinkingSessions)
            .where(
              and(
                eq(hostedLinkingSessions.userId, userId),
                anyOf(hostedLinkingSessions.id, [first, ...rest]),
              ),
            )
            .orderBy(hostedLinkingSessions.id)
            .for("update")
            .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
          const records = yield* Effect.forEach(rows, decodeRow);
          const locked = new Map(records.map((record) => [record.id, record]));
          const planned = yield* Effect.forEach(ids, (id) => plan(locked, id));
          return yield* Effect.forEach(planned, (record) => persistRecord(tx, record));
        });
      }

      function persistRecord(
        tx: Transaction,
        record: Record,
      ): Effect.Effect<Record, HostedLinkingError> {
        return Effect.gen(function* () {
          const values = yield* encodeRecord(record);
          const rows = yield* tx
            .update(hostedLinkingSessions)
            .set({
              status: values.status,
              provider: values.provider,
              connectionId: values.connectionId,
              startedAt: values.startedAt,
              expiresAt: values.expiresAt,
              completedAt: values.completedAt ?? null,
              cancelledAt: values.cancelledAt ?? null,
              expiredAt: values.expiredAt ?? null,
              failedAt: values.failedAt ?? null,
              failureReason: values.failureReason ?? null,
              updatedAt: values.updatedAt,
            })
            .where(
              and(
                eq(hostedLinkingSessions.userId, record.userId),
                eq(hostedLinkingSessions.id, record.id),
              ),
            )
            .returning()
            .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
          const row = rows[0];
          if (row === undefined) {
            return yield* HostedLinkingNotFound.make({ id: record.id });
          }
          if (isTerminal(record.state)) {
            yield* tx
              .delete(hostedLinkingSessionLocks)
              .where(
                and(
                  eq(hostedLinkingSessionLocks.userId, record.userId),
                  eq(hostedLinkingSessionLocks.sessionId, record.id),
                ),
              )
              .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
          }
          return yield* decodeRow(row);
        });
      }

      function transitionRecord(
        record: Record,
        request: HostedLinkingRequest,
      ): Effect.Effect<Record, HostedLinkingError> {
        return Effect.gen(function* () {
          const snapshot = yield* snapshotOf(HostedLinkingWorkflow, record.state);
          const planned = yield* planBatch(
            HostedLinkingWorkflow,
            [{ id: record.id, record, snapshot }],
            request,
          );
          const change = planned[0];
          if (change === undefined) {
            return record;
          }
          return { ...record, state: change.snapshot.state.value };
        }).pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
      }

      function transaction<A>(
        run: (tx: Transaction) => Effect.Effect<A, HostedLinkingError>,
      ): Effect.Effect<A, HostedLinkingError> {
        return (
          database.transaction(run) as Effect.Effect<
            A,
            HostedLinkingError | { readonly _tag: "SqlError" | "EffectDrizzleQueryError" },
            never
          >
        ).pipe(
          Effect.mapError((cause) =>
            isHostedLinkingError(cause) ? cause : HostedLinkingPersistenceFailed.make({ cause }),
          ),
        );
      }

      function decodeRow(
        row: typeof hostedLinkingSessions.$inferSelect,
      ): Effect.Effect<Record, HostedLinkingPersistenceFailed> {
        return Schema.decodeEffect(HostedLinkingRow)(row).pipe(
          Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })),
        );
      }

      function encodeRecord(
        record: Record,
      ): Effect.Effect<typeof hostedLinkingSessions.$inferInsert, HostedLinkingPersistenceFailed> {
        return Schema.encodeEffect(HostedLinkingRow)(record).pipe(
          Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })),
        );
      }

      return {
        loadOwned,
        create,
        countStartsSince,
        expireStale,
        claimCompletion,
        markCompleted,
        markFailed,
        cancel,
        expire,
      } satisfies HostedLinkingRepositoryShape;
    }),
  );
}

export type HostedLinkingRepositoryShape = {
  readonly loadOwned: (
    userId: UserId,
    id: HostedLinkingSessionId,
  ) => Effect.Effect<Record, HostedLinkingError>;

  readonly create: (
    userId: UserId,
    command: CreateHostedLinkingCommand,
  ) => Effect.Effect<Record, HostedLinkingError>;

  readonly countStartsSince: (
    userId: UserId,
    since: DateTime.Utc,
  ) => Effect.Effect<number, HostedLinkingError>;

  readonly expireStale: (
    userId: UserId,
    at: DateTime.Utc,
  ) => Effect.Effect<ReadonlyArray<Record>, HostedLinkingError>;

  readonly claimCompletion: (
    userId: UserId,
    command: ClaimHostedLinkingCommand,
  ) => Effect.Effect<Record, HostedLinkingError>;

  readonly markCompleted: (
    userId: UserId,
    id: HostedLinkingSessionId,
    at: DateTime.Utc,
  ) => Effect.Effect<Record, HostedLinkingError>;

  readonly markFailed: (
    userId: UserId,
    id: HostedLinkingSessionId,
    at: DateTime.Utc,
    reason: HostedLinkingFailureReason,
  ) => Effect.Effect<Record, HostedLinkingError>;

  readonly cancel: (
    userId: UserId,
    ids: ReadonlyArray<HostedLinkingSessionId>,
    at: DateTime.Utc,
  ) => Effect.Effect<ReadonlyArray<Record>, HostedLinkingError>;

  readonly expire: (
    userId: UserId,
    ids: ReadonlyArray<HostedLinkingSessionId>,
    at: DateTime.Utc,
  ) => Effect.Effect<ReadonlyArray<Record>, HostedLinkingError>;
};

type NotActiveRecord = { readonly _tag: "not-active" };

function notActive(_record: Record): NotActiveRecord {
  return { _tag: "not-active" };
}

function expireRequest(at: DateTime.Utc): HostedLinkingRequest {
  return HostedLinkingEvents.cases.Expired.make({ at });
}

function isExpired(state: { readonly expiresAt: DateTime.Utc }, at: DateTime.Utc): boolean {
  return DateTime.toEpochMillis(state.expiresAt) <= DateTime.toEpochMillis(at);
}

function isTerminal(state: typeof HostedLinkingState.Type): boolean {
  return (
    state._tag === "Completed" ||
    state._tag === "Cancelled" ||
    state._tag === "Expired" ||
    state._tag === "Failed"
  );
}

function statusOf(state: typeof HostedLinkingState.Type): HostedLinkingSessionStatus {
  switch (state._tag) {
    case "Active":
      return "active";
    case "Completing":
      return "completing";
    case "Completed":
      return "completed";
    case "Cancelled":
      return "cancelled";
    case "Expired":
      return "expired";
    case "Failed":
      return "failed";
  }
}

export { statusOf as hostedLinkingStatusOf };

function isHostedLinkingError(error: unknown): error is HostedLinkingError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string" &&
    error._tag.startsWith("hosted_linking.")
  );
}
