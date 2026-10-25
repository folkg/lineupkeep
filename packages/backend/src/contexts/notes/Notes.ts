import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context } from "effect";
import type { Effect } from "effect";

import type {
  CreateNoteInput,
  ListNotesInput,
  Note,
  NoteError,
  NoteIdInput,
  NotePage,
  UpdateNoteInput,
} from "./Note.ts";

export class Notes extends Context.Service<Notes, NotesShape>()(
  "@lineupkeep/backend/contexts/notes/Notes",
) {}

export type NotesShape = {
  readonly list: (userId: UserId, input?: ListNotesInput) => Effect.Effect<NotePage, NoteError>;

  readonly create: (
    userId: UserId,
    inputs: ReadonlyArray<CreateNoteInput>,
  ) => Effect.Effect<ReadonlyArray<Note>, NoteError>;

  readonly update: (
    userId: UserId,
    inputs: ReadonlyArray<UpdateNoteInput>,
  ) => Effect.Effect<ReadonlyArray<Note>, NoteError>;

  readonly moveToTrash: (
    userId: UserId,
    inputs: ReadonlyArray<NoteIdInput>,
  ) => Effect.Effect<ReadonlyArray<Note>, NoteError>;

  readonly restore: (
    userId: UserId,
    inputs: ReadonlyArray<NoteIdInput>,
  ) => Effect.Effect<ReadonlyArray<Note>, NoteError>;

  readonly deletePermanently: (
    userId: UserId,
    inputs: ReadonlyArray<NoteIdInput>,
  ) => Effect.Effect<void, NoteError>;
};
