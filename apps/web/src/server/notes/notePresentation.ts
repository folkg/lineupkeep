import type { Note, NoteError } from "@lineupkeep/backend/notes/Note";
import { DateTime, Schema } from "effect";

import type { NoteMutationError, NoteView } from "#contracts/notes/noteContract.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";
export function toNoteView(note: Note): NoteView {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    lifecycle: note.lifecycle,
    ...(note.trashedAt === undefined ? {} : { trashedAt: DateTime.formatIso(note.trashedAt) }),
    createdAt: DateTime.formatIso(note.createdAt),
    updatedAt: DateTime.formatIso(note.updatedAt),
  };
}

export function mapNoteError(
  error: NoteError | NoteInputInvalid,
): ExpectedFailure<NoteMutationError["type"]> {
  switch (error._tag) {
    case "NoteInputInvalid":
    case "note.batch_invalid":
      return { type: "note.input_invalid", outcome: "rejected" };
    case "note.list_invalid":
    case "note.not_found":
    case "note.lifecycle_rejected":
      return { type: error._tag, outcome: "rejected" };
    case "note.lifecycle_conflict":
      return { type: error._tag, outcome: "conflict" };
    case "note.create_failed":
    case "note.persistence_failed":
      return { type: error._tag, outcome: "failure" };
  }
}

export class NoteInputInvalid extends Schema.TaggedError<
  NoteInputInvalid,
  { readonly brand: unique symbol }
>()("NoteInputInvalid", {}) {}
