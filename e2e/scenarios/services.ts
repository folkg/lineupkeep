import {
  CreateNoteInput,
  ListNotesInput,
  NoteIdInput,
  UpdateNoteInput,
} from "@lineupkeep/backend/notes/Note";
import type { Note } from "@lineupkeep/backend/notes/Note";
import { Notes } from "@lineupkeep/backend/notes/Notes";
import { Array, Effect, Schema } from "effect";

import type { ServiceProgram } from "#e2e/serviceContract.ts";

export const createNote: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(CreateNoteInput)(arguments_);
    const notes = yield* Notes;
    const note = Array.getUnsafe(yield* notes.create(user.id, [input]), 0);
    return observeNote(note);
  });

export const createNotes: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const inputs = yield* Schema.decodeUnknownEffect(Schema.Array(CreateNoteInput))(arguments_);
    const notes = yield* Notes;
    return (yield* notes.create(user.id, inputs)).map(observeNote);
  });

export const updateNotes: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const inputs = yield* Schema.decodeUnknownEffect(Schema.Array(UpdateNoteInput))(arguments_);
    const notes = yield* Notes;
    return (yield* notes.update(user.id, inputs)).map(observeNote);
  });

export const readNotes: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(ListNotesInput)(arguments_);
    const notes = yield* Notes;
    return (yield* notes.list(user.id, input)).items.map(observeNote);
  });

export const trashNote: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(NoteIdInput)(arguments_);
    const notes = yield* Notes;
    const note = Array.getUnsafe(yield* notes.moveToTrash(user.id, [input]), 0);
    return observeNote(note);
  });

export const seedTrash: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const inputs = yield* Schema.decodeUnknownEffect(Schema.Array(CreateNoteInput))(arguments_);
    const notes = yield* Notes;
    const created = yield* notes.create(user.id, inputs);
    yield* notes.moveToTrash(
      user.id,
      created.map((note) => ({ id: note.id })),
    );
    return { count: inputs.length, ids: created.map((note) => note.id) };
  });

export const rejectOperation: ServiceProgram = (_user, arguments_) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.Struct({}))(arguments_);
    return yield* Effect.fail({ _tag: "ExpectedRejection", message: "Synthetic rejection" });
  });

export const nonJsonResult: ServiceProgram = (_user, arguments_) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.Struct({}))(arguments_);
    return 1n;
  });

function observeNote(note: Note): Pick<Note, "id" | "title" | "body" | "lifecycle"> {
  return { id: note.id, title: note.title, body: note.body, lifecycle: note.lifecycle };
}
