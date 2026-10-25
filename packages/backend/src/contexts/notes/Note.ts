import { UserId } from "@lineupkeep/backend/auth/User";
import { Schema } from "effect";

import { noteTitleMaxLength, noteBodyMaxLength, noteSearchMaxLength } from "./NoteLimits.ts";

export const NoteId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("NoteId"));
export type NoteId = typeof NoteId.Type;
export const decodeNoteId = Schema.decodeUnknownSync(NoteId);

export const NoteTitle = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(noteTitleMaxLength)),
  Schema.brand("NoteTitle"),
);
export type NoteTitle = typeof NoteTitle.Type;
export const decodeNoteTitle = Schema.decodeUnknownSync(NoteTitle);

export const NoteBody = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value: string) =>
        value.trim().length > 0 || "Note body must contain non-whitespace characters",
    ),
    Schema.isMaxLength(noteBodyMaxLength),
  ),
  Schema.brand("NoteBody"),
);
export type NoteBody = typeof NoteBody.Type;
export const decodeNoteBody = Schema.decodeUnknownSync(NoteBody);

const NoteSearch = Schema.Trim.pipe(
  Schema.check(Schema.isMaxLength(noteSearchMaxLength)),
  Schema.brand("NoteSearch"),
);

const NoteTimestamp = Schema.DateTimeUtc;
export const decodeNoteTimestamp = Schema.decodeUnknownSync(Schema.DateTimeUtcFromString);

export const NoteLifecycle = Schema.Literals(["active", "trashed"]);
export type NoteLifecycle = typeof NoteLifecycle.Type;

export const Note = Schema.Struct({
  id: NoteId,
  userId: UserId,
  title: NoteTitle,
  body: NoteBody,
  lifecycle: NoteLifecycle,
  trashedAt: Schema.optional(NoteTimestamp),
  createdAt: NoteTimestamp,
  updatedAt: NoteTimestamp,
});
export type Note = typeof Note.Type;

export const ListNotesInput = Schema.Struct({
  search: Schema.optional(NoteSearch),
  lifecycle: Schema.optional(NoteLifecycle),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1000)),
  ),
});
export type ListNotesInput = typeof ListNotesInput.Type;

const NoteCreationRequestId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("NoteCreationRequestId"),
);

export const CreateNoteInput = Schema.Struct({
  requestId: NoteCreationRequestId,
  title: NoteTitle,
  body: NoteBody,
});
export type CreateNoteInput = typeof CreateNoteInput.Type;

export const UpdateNoteInput = Schema.Struct({
  id: NoteId,
  title: NoteTitle,
  body: NoteBody,
});
export type UpdateNoteInput = typeof UpdateNoteInput.Type;

export const NoteIdInput = Schema.Struct({
  id: NoteId,
});
export type NoteIdInput = typeof NoteIdInput.Type;

export type NotePage = {
  readonly items: ReadonlyArray<Note>;
  readonly nextCursor?: string;
};

export type NoteError =
  | NoteListInvalid
  | NoteBatchInvalid
  | NoteCreateFailed
  | NoteLifecycleConflict
  | NoteLifecycleRejected
  | NoteNotFound
  | NotePersistenceFailed;

export class NoteListInvalid extends Schema.TaggedError<
  NoteListInvalid,
  { readonly brand: unique symbol }
>()("note.list_invalid", {}) {}

export class NoteBatchInvalid extends Schema.TaggedError<
  NoteBatchInvalid,
  { readonly brand: unique symbol }
>()("note.batch_invalid", { reason: Schema.String }) {}

export class NoteCreateFailed extends Schema.TaggedError<
  NoteCreateFailed,
  { readonly brand: unique symbol }
>()("note.create_failed", {}) {}

export class NoteLifecycleConflict extends Schema.TaggedError<
  NoteLifecycleConflict,
  { readonly brand: unique symbol }
>()("note.lifecycle_conflict", {
  id: NoteId,
  expected: NoteLifecycle,
}) {}

export class NoteLifecycleRejected extends Schema.TaggedError<
  NoteLifecycleRejected,
  { readonly brand: unique symbol }
>()("note.lifecycle_rejected", {
  id: NoteId,
  lifecycle: NoteLifecycle,
  event: Schema.String,
}) {}

export class NoteNotFound extends Schema.TaggedError<
  NoteNotFound,
  { readonly brand: unique symbol }
>()("note.not_found", {
  id: NoteId,
}) {}

export class NotePersistenceFailed extends Schema.TaggedError<
  NotePersistenceFailed,
  { readonly brand: unique symbol }
>()("note.persistence_failed", {
  cause: Schema.Defect(),
}) {}
