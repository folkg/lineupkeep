import type { UserId } from "@sourdough/backend/auth/User";
import {
  CreateNoteInput,
  ListNotesInput,
  Note,
  NoteIdInput,
  UpdateNoteInput,
} from "@sourdough/backend/notes/Note";
import type { NoteError } from "@sourdough/backend/notes/Note";
import { Notes } from "@sourdough/backend/notes/Notes";
import { noteScopes } from "@sourdough/backend/notes/NoteScopes";
import { Array, Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });
const NoteOutput = Schema.Struct({ note: Schema.toCodecJson(Note) });

export const noteTools = Toolkit.make(
  Tool.make("list_notes", {
    description:
      "List your Notes in ID order, optionally searching title/body and choosing active or trashed Notes. Defaults to 100 active Notes, maximum 1,000. Pass nextCursor as cursor with the same filters for the next page.",
    parameters: Schema.toType(ListNotesInput),
    success: Schema.Struct({
      notes: Schema.Array(Schema.toCodecJson(Note)),
      nextCursor: Schema.optional(Schema.String),
    }),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, noteScopes.read)
    .annotate(Tool.Title, "List Notes")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("create_note", {
    description:
      "Create an active Note. Supply a trimmed, nonempty title and a UUID requestId and reuse it on retries; an existing key returns the current Note.",
    parameters: Schema.toType(CreateNoteInput),
    success: NoteOutput,
    failure: ToolFailure,
  })
    .annotate(RequiredScope, noteScopes.write)
    .annotate(Tool.Title, "Create Note")
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("update_note", {
    description:
      "Replace an active Note's trimmed, nonempty title and body. Trashed Notes must be restored before editing. Existing content is overwritten.",
    parameters: Schema.toType(UpdateNoteInput),
    success: NoteOutput,
    failure: ToolFailure,
  })
    .annotate(RequiredScope, noteScopes.write)
    .annotate(Tool.Title, "Update Note")
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("trash_note", {
    description:
      "Move an active Note to Trash. Content is retained and can be restored. This never permanently deletes a Note.",
    parameters: NoteIdInput,
    success: NoteOutput,
    failure: ToolFailure,
  })
    .annotate(RequiredScope, noteScopes.write)
    .annotate(Tool.Title, "Move Note to Trash")
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("restore_note", {
    description: "Restore a trashed Note to the active working set, preserving its content.",
    parameters: NoteIdInput,
    success: NoteOutput,
    failure: ToolFailure,
  })
    .annotate(RequiredScope, noteScopes.write)
    .annotate(Tool.Title, "Restore Note")
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function noteToolHandlers(
  userId: UserId,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof noteTools>>, never, Notes> {
  return noteTools.toLayer(
    Effect.gen(function* () {
      const notes = yield* Notes;
      return noteTools.of({
        list_notes: (input) =>
          notes.list(userId, input).pipe(
            Effect.map((page) => ({
              notes: page.items,
              ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
            })),
            mapOutcome,
          ),
        create_note: (input) =>
          notes.create(userId, [input]).pipe(
            Effect.map((notes) => Array.getUnsafe(notes, 0)),
            Effect.map((note) => ({ note })),
            mapOutcome,
          ),
        update_note: (input) =>
          notes.update(userId, [input]).pipe(
            Effect.map((notes) => Array.getUnsafe(notes, 0)),
            Effect.map((note) => ({ note })),
            mapOutcome,
          ),
        trash_note: (input) =>
          notes.moveToTrash(userId, [input]).pipe(
            Effect.map((notes) => Array.getUnsafe(notes, 0)),
            Effect.map((note) => ({ note })),
            mapOutcome,
          ),
        restore_note: (input) =>
          notes.restore(userId, [input]).pipe(
            Effect.map((notes) => Array.getUnsafe(notes, 0)),
            Effect.map((note) => ({ note })),
            mapOutcome,
          ),
      });
    }),
  );
}

function mapOutcome<A>(program: Effect.Effect<A, NoteError>): Effect.Effect<
  A,
  {
    code: string;
    message: string;
  },
  never
> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "note.list_invalid":
          return reject(
            error._tag,
            "This cursor is invalid or belongs to different filters. List from the first page with the intended filters.",
          );
        case "note.batch_invalid":
          return reject(error._tag, "Provide valid Note inputs and one instruction per target.");
        case "note.not_found":
          return reject(
            error._tag,
            "Note not found. List your Notes to choose an available identifier.",
          );
        case "note.lifecycle_conflict":
          return reject(
            error._tag,
            "The Note changed during this request. List your Notes and retry with its current state.",
          );
        case "note.lifecycle_rejected":
          return reject(
            error._tag,
            "This action is not allowed in the Note's current state. List active and trashed Notes; restore before editing.",
          );
        case "note.create_failed":
        case "note.persistence_failed":
          return Effect.annotateCurrentSpan({
            "app.outcome": "failure",
            "error.type": error._tag,
          }).pipe(
            Effect.andThen(
              Effect.die(
                new Error(
                  "Note operation could not be confirmed. List your Notes; retry creation only with the same requestId.",
                ),
              ),
            ),
          );
      }
    }),
  );
}

function reject(
  code: string,
  message: string,
): Effect.Effect<
  never,
  {
    code: string;
    message: string;
  },
  never
> {
  return Effect.annotateCurrentSpan({ "app.outcome": "rejected", "error.type": code }).pipe(
    Effect.andThen(Effect.fail({ code, message })),
  );
}
