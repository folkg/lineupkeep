import type {
  CreateNoteInput,
  UpdateNoteInput,
  ListNotesInput,
  NoteIdInput,
  NoteLifecycle,
  NoteError,
} from "@sourdough/backend/notes/Note";

import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";
import type { UseCaseResult } from "#contracts/useCaseContract.ts";

export type NoteView = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly lifecycle: NoteLifecycleView;
  readonly trashedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NotePageView = {
  readonly items: ReadonlyArray<NoteView>;
  readonly nextCursor?: string;
};

export type CreateNoteData = typeof CreateNoteInput.Encoded;
export type UpdateNoteData = typeof UpdateNoteInput.Encoded;
export type NoteIdData = typeof NoteIdInput.Encoded;
export type ListNotesData = typeof ListNotesInput.Encoded;
export type NoteLifecycleView = NoteLifecycle;
export type NoteMutationError = {
  readonly type: Exclude<NoteError["_tag"], "note.batch_invalid"> | "note.input_invalid";
};
export type NoteRequestResult<A> =
  | UseCaseResult<A, NoteMutationError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
