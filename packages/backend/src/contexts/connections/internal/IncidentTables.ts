import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
