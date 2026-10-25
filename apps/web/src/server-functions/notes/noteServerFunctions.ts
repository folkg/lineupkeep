import {
  CreateNoteInput,
  ListNotesInput,
  NoteIdInput,
  UpdateNoteInput,
} from "@lineupkeep/backend/notes/Note";
import { Notes } from "@lineupkeep/backend/notes/Notes";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Array, Effect, Schema } from "effect";

import { runUseCase } from "#server/backendEntry.ts";
import { mapNoteError, NoteInputInvalid, toNoteView } from "#server/notes/notePresentation.ts";

export const listNotesServerFn = createServerFn({ method: "GET" })
  .validator((raw: typeof ListNotesInput.Encoded) => Schema.decodeResult(ListNotesInput)(raw))
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "notes.list",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => NoteInputInvalid.make({})),
          );
          const page = yield* Notes.use((notes) => notes.list(userId, input));
          return { ...page, items: page.items.map(toNoteView) };
        }),
      mapNoteError,
    ),
  );

export const createNoteServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof CreateNoteInput.Encoded) => Schema.decodeResult(CreateNoteInput)(raw))
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "notes.create",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => NoteInputInvalid.make({})),
          );
          const notes = yield* Notes.use((notes) => notes.create(userId, [input]));
          const note = Array.getUnsafe(notes, 0);
          return toNoteView(note);
        }),
      mapNoteError,
    ),
  );

export const updateNoteServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof UpdateNoteInput.Encoded) => Schema.decodeResult(UpdateNoteInput)(raw))
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "notes.update",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => NoteInputInvalid.make({})),
          );
          const notes = yield* Notes.use((notes) => notes.update(userId, [input]));
          return toNoteView(Array.getUnsafe(notes, 0));
        }),
      mapNoteError,
    ),
  );

export const moveNoteToTrashServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof NoteIdInput.Encoded) => Schema.decodeResult(NoteIdInput)(raw))
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "notes.trash",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => NoteInputInvalid.make({})),
          );
          const notes = yield* Notes.use((notes) => notes.moveToTrash(userId, [input]));
          return toNoteView(Array.getUnsafe(notes, 0));
        }),
      mapNoteError,
    ),
  );

export const restoreNoteServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof NoteIdInput.Encoded) => Schema.decodeResult(NoteIdInput)(raw))
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "notes.restore",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => NoteInputInvalid.make({})),
          );
          const notes = yield* Notes.use((notes) => notes.restore(userId, [input]));
          return toNoteView(Array.getUnsafe(notes, 0));
        }),
      mapNoteError,
    ),
  );

export const deleteNotePermanentlyServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof NoteIdInput.Encoded) => Schema.decodeResult(NoteIdInput)(raw))
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "notes.delete_permanently",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => NoteInputInvalid.make({})),
          );
          return yield* Notes.use((notes) => notes.deletePermanently(userId, [input]));
        }),
      mapNoteError,
    ),
  );
