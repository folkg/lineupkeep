import { createSelectSchema } from "drizzle-orm/effect-schema";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { Effect, Schema, SchemaParser, SchemaTransformation } from "effect";

import { UserId } from "#contexts/auth/User.ts";

import {
  ConnectionNotificationState,
  connectionNotificationProjection,
} from "./ConnectionNotificationWorkflow.ts";

export const connectionIncidents = pgTable(
  "connection_incidents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    connectionId: text("connection_id").notNull(),
    credentialGeneration: integer("credential_generation").notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    operation: text("operation"),
    providerStatus: integer("provider_status"),
    providerDetail: text("provider_detail"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution", { enum: ["reconnected", "disconnected"] }),
  },
  (table) => [
    uniqueIndex("connection_incidents_connection_generation_idx").on(
      table.connectionId,
      table.credentialGeneration,
    ),
    index("connection_incidents_user_id_status_idx").on(table.userId, table.status),
    index("connection_incidents_status_resolved_at_idx").on(table.status, table.resolvedAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    incidentId: text("incident_id").notNull(),
    kind: text("kind", { enum: ["connection_reconnect_required"] }).notNull(),
    status: text("status", {
      enum: ["pending", "sending", "sent", "cancelled", "failed"],
    }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notifications_incident_id_idx").on(table.incidentId),
    index("notifications_status_next_attempt_at_idx").on(table.status, table.nextAttemptAt),
    index("notifications_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

const NotificationsSelect = createSelectSchema(notifications, {
  userId: UserId,
  status: Schema.Literals(["pending", "sending", "sent", "cancelled", "failed"]),
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  nextAttemptAt: Schema.DateTimeUtcFromDate,
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
  sentAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});

const NotificationsRecord = Schema.Struct({
  id: Schema.String,
  userId: UserId,
  incidentId: Schema.String,
  kind: Schema.Literal("connection_reconnect_required"),
  createdAt: Schema.DateTimeUtc,
  state: ConnectionNotificationState,
}).pipe(Schema.toType);

export const NotificationsRow = NotificationsSelect.pipe(
  Schema.decodeTo(
    NotificationsRecord,
    SchemaTransformation.transformEffect<
      typeof NotificationsRecord.Type,
      typeof NotificationsSelect.Type
    >({
      decode: (row) =>
        Effect.gen(function* () {
          const state = yield* SchemaParser.decodeUnknownEffect(ConnectionNotificationState)({
            _tag: row.status,
            attempts: row.attempts,
            nextAttemptAt: row.nextAttemptAt,
            lastError: row.lastError,
            sentAt: row.sentAt,
            updatedAt: row.updatedAt,
          });
          return {
            id: row.id,
            userId: row.userId,
            incidentId: row.incidentId,
            kind: row.kind,
            createdAt: row.createdAt,
            state,
          };
        }),
      encode: ({ state, ...identity }) =>
        Effect.succeed({ ...identity, ...connectionNotificationProjection(state) }),
    }),
  ),
);
