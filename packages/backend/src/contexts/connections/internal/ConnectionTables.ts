import { createSelectSchema } from "drizzle-orm/effect-schema";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { Effect, Schema, SchemaParser, SchemaTransformation, Struct } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { ConnectionCredentialGeneration, ConnectionId } from "#contexts/connections/Connection.ts";

import { ConnectionLifecycleState } from "./ConnectionLifecycleWorkflow.ts";

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    provider: text("provider", { enum: ["yahoo"] }).notNull(),
    status: text("status", {
      enum: ["linking", "ready", "reconnect-required", "disconnected"],
    }).notNull(),
    pairingCode: text("pairing_code").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    credentialGeneration: integer("credential_generation"),
    reconnectRequiredAt: timestamp("reconnect_required_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("provider_connections_user_id_id_idx").on(table.userId, table.id),
    uniqueIndex("provider_connections_user_id_request_id_idx").on(table.userId, table.requestId),
  ],
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    connectionId: text("connection_id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: ["yahoo"] }).notNull(),
    generation: integer("generation").notNull(),
    envelope: text("envelope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("provider_credentials_user_id_connection_id_idx").on(table.userId, table.connectionId),
  ],
);

const Row = createSelectSchema(providerConnections, {
  id: ConnectionId,
  userId: UserId,
  pairingCode: Schema.String,
  expiresAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  approvedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  credentialGeneration: Schema.NullOr(ConnectionCredentialGeneration),
  reconnectRequiredAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  disconnectedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

const Identity = Struct.pick(Row.fields, ["id", "userId", "requestId", "pairingCode", "createdAt"]);
const LifecycleConnection = Schema.Struct({ ...Identity, state: ConnectionLifecycleState }).pipe(
  Schema.toType,
);

export const ConnectionRow = Row.pipe(
  Schema.decodeTo(
    LifecycleConnection,
    SchemaTransformation.transformEffect<typeof LifecycleConnection.Type, typeof Row.Type>({
      decode: (row) => {
        const content = {
          provider: row.provider,
          updatedAt: row.updatedAt,
        };
        const state = (() => {
          switch (row.status) {
            case "linking":
              return { _tag: "Linking", ...content, expiresAt: row.expiresAt };
            case "ready":
              return {
                _tag: "Ready",
                ...content,
                approvedAt: row.approvedAt,
                credentialGeneration: row.credentialGeneration,
              };
            case "reconnect-required":
              return {
                _tag: "ReconnectRequired",
                ...content,
                reconnectRequiredAt: row.reconnectRequiredAt,
                credentialGeneration: row.credentialGeneration,
              };
            case "disconnected":
              return { _tag: "Disconnected", ...content, disconnectedAt: row.disconnectedAt };
          }
        })();
        return SchemaParser.decodeUnknownEffect(ConnectionLifecycleState)(state).pipe(
          Effect.map((state) => ({
            id: row.id,
            userId: row.userId,
            requestId: row.requestId,
            pairingCode: row.pairingCode,
            createdAt: row.createdAt,
            state,
          })),
        );
      },
      encode: ({ state, ...identity }) =>
        Effect.succeed(
          (() => {
            switch (state._tag) {
              case "Linking":
                return {
                  ...identity,
                  provider: state.provider,
                  status: "linking" as const,
                  expiresAt: state.expiresAt,
                  approvedAt: null,
                  credentialGeneration: null,
                  reconnectRequiredAt: null,
                  disconnectedAt: null,
                  updatedAt: state.updatedAt,
                };
              case "Ready":
                return {
                  ...identity,
                  provider: state.provider,
                  status: "ready" as const,
                  expiresAt: null,
                  approvedAt: state.approvedAt,
                  credentialGeneration: state.credentialGeneration,
                  reconnectRequiredAt: null,
                  disconnectedAt: null,
                  updatedAt: state.updatedAt,
                };
              case "ReconnectRequired":
                return {
                  ...identity,
                  provider: state.provider,
                  status: "reconnect-required" as const,
                  expiresAt: null,
                  approvedAt: null,
                  credentialGeneration: state.credentialGeneration,
                  reconnectRequiredAt: state.reconnectRequiredAt,
                  disconnectedAt: null,
                  updatedAt: state.updatedAt,
                };
              case "Disconnected":
                return {
                  ...identity,
                  provider: state.provider,
                  status: "disconnected" as const,
                  expiresAt: null,
                  approvedAt: null,
                  credentialGeneration: null,
                  reconnectRequiredAt: null,
                  disconnectedAt: state.disconnectedAt,
                  updatedAt: state.updatedAt,
                };
            }
          })(),
        ),
    }),
  ),
);
