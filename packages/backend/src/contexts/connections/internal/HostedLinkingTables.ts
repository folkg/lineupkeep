import { createSelectSchema } from "drizzle-orm/effect-schema";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { DateTime, Effect, Schema, SchemaTransformation } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { ConnectionId, ProviderKey } from "#contexts/connections/Connection.ts";
import {
  HostedLinkingFailureReason,
  HostedLinkingSessionId,
  HostedLinkingSessionStatus,
} from "#contexts/connections/HostedLinking.ts";

import { HostedLinkingState } from "./HostedLinkingWorkflow.ts";

export const hostedLinkingSessions = pgTable(
  "hosted_linking_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    connectionId: text("connection_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status", {
      enum: ["active", "completing", "completed", "cancelled", "expired", "failed"],
    }).notNull(),
    ticketHash: text("ticket_hash").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureReason: text("failure_reason", {
      enum: [
        "session_rejected",
        "provider_unavailable",
        "link_expired",
        "connection_unavailable",
        "persistence_failed",
      ],
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("hosted_linking_sessions_user_created_idx").on(table.userId, table.createdAt),
    index("hosted_linking_sessions_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const hostedLinkingSessionLocks = pgTable("hosted_linking_session_locks", {
  userId: text("user_id").primaryKey(),
  sessionId: text("session_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const HostedLinkingRowSelect = createSelectSchema(hostedLinkingSessions);

const HostedLinkingRecord = Schema.Struct({
  id: HostedLinkingSessionId,
  userId: UserId,
  ticketHash: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtc,
  state: HostedLinkingState,
}).pipe(Schema.toType);

export const HostedLinkingRow = HostedLinkingRowSelect.pipe(
  Schema.decodeTo(
    HostedLinkingRecord,
    SchemaTransformation.transformEffect<
      typeof HostedLinkingRecord.Type,
      typeof HostedLinkingRowSelect.Encoded
    >({
      decode: (row) =>
        Effect.gen(function* () {
          const id = yield* Schema.decodeEffect(HostedLinkingSessionId)(row.id);
          const userId = yield* Schema.decodeEffect(UserId)(row.userId);
          const connectionId = yield* Schema.decodeEffect(ConnectionId)(row.connectionId);
          const provider = yield* Schema.decodeEffect(ProviderKey)(row.provider);
          const content = {
            connectionId,
            provider,
            startedAt: DateTime.fromDateUnsafe(row.startedAt),
            expiresAt: DateTime.fromDateUnsafe(row.expiresAt),
            updatedAt: DateTime.fromDateUnsafe(row.updatedAt),
          };
          const state = yield* Schema.decodeEffect(HostedLinkingState)(stateFromRow(row, content));
          return {
            id,
            userId,
            ticketHash: row.ticketHash,
            createdAt: DateTime.fromDateUnsafe(row.createdAt),
            state,
          };
        }).pipe(Effect.orDie),
      encode: (record) => Effect.succeed(rowFromState(record, record.state)),
    }),
  ),
);

type RowContent = {
  readonly connectionId: ConnectionId;
  readonly provider: ProviderKey;
  readonly startedAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
};

function stateFromRow(
  row: typeof HostedLinkingRowSelect.Type,
  content: RowContent,
): typeof HostedLinkingState.Type {
  switch (row.status) {
    case "active":
      return { _tag: "Active", ...content };
    case "completing":
      return { _tag: "Completing", ...content };
    case "completed":
      return {
        _tag: "Completed",
        ...content,
        completedAt: requiredDate(row.completedAt, "completed_at"),
      };
    case "cancelled":
      return {
        _tag: "Cancelled",
        ...content,
        cancelledAt: requiredDate(row.cancelledAt, "cancelled_at"),
      };
    case "expired":
      return { _tag: "Expired", ...content, expiredAt: requiredDate(row.expiredAt, "expired_at") };
    case "failed":
      return {
        _tag: "Failed",
        ...content,
        failedAt: requiredDate(row.failedAt, "failed_at"),
        reason: failureReason(row.failureReason),
      };
  }
}

function rowFromState(
  record: typeof HostedLinkingRecord.Type,
  state: typeof HostedLinkingState.Type,
): typeof HostedLinkingRowSelect.Encoded {
  return {
    id: record.id,
    userId: record.userId,
    connectionId: state.connectionId,
    provider: state.provider,
    status: statusFromState(state),
    ticketHash: record.ticketHash,
    startedAt: DateTime.toDateUtc(state.startedAt),
    expiresAt: DateTime.toDateUtc(state.expiresAt),
    completedAt: state._tag === "Completed" ? DateTime.toDateUtc(state.completedAt) : null,
    cancelledAt: state._tag === "Cancelled" ? DateTime.toDateUtc(state.cancelledAt) : null,
    expiredAt: state._tag === "Expired" ? DateTime.toDateUtc(state.expiredAt) : null,
    failedAt: state._tag === "Failed" ? DateTime.toDateUtc(state.failedAt) : null,
    failureReason: state._tag === "Failed" ? state.reason : null,
    createdAt: DateTime.toDateUtc(record.createdAt),
    updatedAt: DateTime.toDateUtc(state.updatedAt),
  };
}

function statusFromState(state: typeof HostedLinkingState.Type): HostedLinkingSessionStatus {
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

function requiredDate(value: Date | null, column: string): DateTime.Utc {
  if (value === null) {
    throw new Error(`hosted_linking_sessions.${column} is required for its status`);
  }
  return DateTime.fromDateUnsafe(value);
}

function failureReason(value: HostedLinkingFailureReason | null): HostedLinkingFailureReason {
  if (value === null) {
    throw new Error("hosted_linking_sessions.failure_reason is required for a failed session");
  }
  return value;
}
