import { createSelectSchema } from "drizzle-orm/effect-schema";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { Effect, Schema, SchemaTransformation } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import {
  FeedbackId,
  FeedbackKind,
  FeedbackStatus,
  FeedbackSubmitterKind,
  FeedbackSurface,
  TeamReference,
} from "#contexts/feedback/Feedback.ts";

import { FeedbackRecord } from "./FeedbackRecord.ts";

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    submitterKind: text("submitter_kind", { enum: ["user", "agent"] }).notNull(),
    submitterReference: text("submitter_reference").notNull(),
    kind: text("kind", {
      enum: ["bug", "data-issue", "friction", "wishlist", "other"],
    }).notNull(),
    status: text("status", {
      enum: ["open", "acknowledged", "resolved", "wontfix"],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    toolName: text("tool_name"),
    teamReference: text("team_reference"),
    clientName: text("client_name"),
    surface: text("surface", {
      enum: ["app", "teams", "team", "run", "connections", "mcp"],
    }),
    resolutionNote: text("resolution_note"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("feedback_user_id_status_created_at_idx").on(table.userId, table.status, table.createdAt),
    index("feedback_user_id_kind_created_at_idx").on(table.userId, table.kind, table.createdAt),
    index("feedback_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("feedback_status_closed_at_idx").on(table.status, table.closedAt),
  ],
);

export const feedbackQuota = pgTable(
  "feedback_quota",
  {
    key: text("key").primaryKey(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [index("feedback_quota_window_started_at_idx").on(table.windowStartedAt)],
);

const FeedbackSelect = createSelectSchema(feedback, {
  id: FeedbackId,
  userId: UserId,
  submitterKind: FeedbackSubmitterKind,
  submitterReference: Schema.NonEmptyString,
  kind: FeedbackKind,
  status: FeedbackStatus,
  title: Schema.NonEmptyString,
  body: Schema.NonEmptyString,
  toolName: Schema.NullOr(Schema.NonEmptyString),
  teamReference: Schema.NullOr(TeamReference),
  clientName: Schema.NullOr(Schema.NonEmptyString),
  surface: Schema.NullOr(FeedbackSurface),
  resolutionNote: Schema.NullOr(Schema.NonEmptyString),
  closedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export const FeedbackRow = FeedbackSelect.pipe(
  Schema.decodeTo(
    FeedbackRecord,
    SchemaTransformation.transformEffect<FeedbackRecord, typeof FeedbackSelect.Type>({
      decode: (row) =>
        Effect.gen(function* () {
          const closed = row.status === "resolved" || row.status === "wontfix";
          if (closed !== (row.closedAt !== null)) {
            return yield* Effect.die(
              new Error("A feedback record's closure time must match its status"),
            );
          }
          if (row.status === "resolved" && row.resolutionNote === null) {
            return yield* Effect.die(new Error("A resolved feedback record requires a note"));
          }
          if (!closed && row.resolutionNote !== null) {
            return yield* Effect.die(
              new Error("An open feedback record cannot own a resolution note"),
            );
          }
          return {
            id: row.id,
            userId: row.userId,
            submitter: { kind: row.submitterKind, reference: row.submitterReference },
            kind: row.kind,
            status: row.status,
            title: row.title,
            body: row.body,
            context: {
              ...(row.toolName === null ? {} : { tool: row.toolName }),
              ...(row.teamReference === null ? {} : { team: row.teamReference }),
              ...(row.clientName === null ? {} : { client: row.clientName }),
              ...(row.surface === null ? {} : { surface: row.surface }),
            },
            ...(row.resolutionNote === null ? {} : { resolutionNote: row.resolutionNote }),
            ...(row.closedAt === null ? {} : { closedAt: row.closedAt }),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        }),
      encode: (record) =>
        Effect.succeed({
          id: record.id,
          userId: record.userId,
          submitterKind: record.submitter.kind,
          submitterReference: record.submitter.reference,
          kind: record.kind,
          status: record.status,
          title: record.title,
          body: record.body,
          toolName: record.context.tool ?? null,
          teamReference: record.context.team ?? null,
          clientName: record.context.client ?? null,
          surface: record.context.surface ?? null,
          resolutionNote: record.resolutionNote ?? null,
          closedAt: record.closedAt ?? null,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }),
    }),
  ),
);
