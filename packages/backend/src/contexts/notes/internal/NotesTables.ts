import { createSelectSchema } from "drizzle-orm/effect-schema";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { Effect, Schema, SchemaParser, SchemaTransformation, Struct } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { NoteId } from "#contexts/notes/Note.ts";

import { NoteLifecycleState } from "./NoteLifecycleWorkflow.ts";

export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    lifecycle: text("lifecycle", { enum: ["active", "trashed", "deleted"] }).notNull(),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notes_user_id_lifecycle_id_idx").on(table.userId, table.lifecycle, table.id),
    uniqueIndex("notes_user_id_request_id_idx").on(table.userId, table.requestId),
  ],
);

const Row = createSelectSchema(notes, {
  id: NoteId,
  userId: UserId,
  trashedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  deletedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

const Identity = Struct.pick(Row.fields, ["id", "userId", "requestId", "createdAt"]);
const LifecycleNote = Schema.Struct({ ...Identity, state: NoteLifecycleState }).pipe(Schema.toType);

export const NoteRow = Row.pipe(
  Schema.decodeTo(
    LifecycleNote,
    SchemaTransformation.transformEffect<typeof LifecycleNote.Type, typeof Row.Type>({
      decode: (row) => {
        const content = { title: row.title, body: row.body, updatedAt: row.updatedAt };
        const state = (() => {
          switch (row.lifecycle) {
            case "active":
              return { _tag: "Active", ...content };
            case "trashed":
              return { _tag: "Trashed", ...content, trashedAt: row.trashedAt };
            case "deleted":
              return { _tag: "Deleted", ...content, deletedAt: row.deletedAt };
          }
        })();
        return SchemaParser.decodeUnknownEffect(NoteLifecycleState)(state).pipe(
          Effect.map((state) => ({
            id: row.id,
            userId: row.userId,
            requestId: row.requestId,
            createdAt: row.createdAt,
            state,
          })),
        );
      },
      encode: ({ state, ...identity }) =>
        Effect.succeed(
          (() => {
            switch (state._tag) {
              case "Active":
                return {
                  ...identity,
                  title: state.title,
                  body: state.body,
                  updatedAt: state.updatedAt,
                  lifecycle: "active" as const,
                  trashedAt: null,
                  deletedAt: null,
                };
              case "Trashed":
                return {
                  ...identity,
                  title: state.title,
                  body: state.body,
                  updatedAt: state.updatedAt,
                  lifecycle: "trashed" as const,
                  trashedAt: state.trashedAt,
                  deletedAt: null,
                };
              case "Deleted":
                return {
                  ...identity,
                  title: state.title,
                  body: state.body,
                  updatedAt: state.updatedAt,
                  lifecycle: "deleted" as const,
                  trashedAt: null,
                  deletedAt: state.deletedAt,
                };
            }
          })(),
        ),
    }),
  ),
);

export const ReadNoteRow = NoteRow.pipe(
  Schema.decodeTo(
    Schema.Struct({
      ...Identity,
      state: Schema.Union([NoteLifecycleState.cases.Active, NoteLifecycleState.cases.Trashed]),
    }).pipe(Schema.toType),
  ),
);
