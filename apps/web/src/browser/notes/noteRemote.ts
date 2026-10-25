import type {
  CreateNoteData,
  ListNotesData,
  NoteIdData,
  NoteView,
  NotePageView,
  UpdateNoteData,
} from "#contracts/notes/noteContract.ts";
import {
  createNoteServerFn,
  deleteNotePermanentlyServerFn,
  listNotesServerFn,
  moveNoteToTrashServerFn,
  restoreNoteServerFn,
  updateNoteServerFn,
} from "#server-functions/notes/noteServerFunctions.ts";

import { requireNoteSuccess } from "./noteFailure";

export const noteRemote: NoteRemote = {
  list: (input, options) =>
    listNotesServerFn({ data: input, signal: options.signal }).then(requireNoteSuccess),
  create: (input) => createNoteServerFn({ data: input }).then(requireNoteSuccess),
  update: (input) => updateNoteServerFn({ data: input }).then(requireNoteSuccess),
  moveToTrash: (input) => moveNoteToTrashServerFn({ data: input }).then(requireNoteSuccess),
  restore: (input) => restoreNoteServerFn({ data: input }).then(requireNoteSuccess),
  deletePermanently: (input) =>
    deleteNotePermanentlyServerFn({ data: input }).then(requireNoteSuccess),
};

export type NoteRemote = {
  readonly list: (input: ListNotesData, options: NoteListRequestOptions) => Promise<NotePageView>;
  readonly create: (input: CreateNoteData) => Promise<NoteView>;
  readonly update: (input: UpdateNoteData) => Promise<NoteView>;
  readonly moveToTrash: (input: NoteIdData) => Promise<NoteView>;
  readonly restore: (input: NoteIdData) => Promise<NoteView>;
  readonly deletePermanently: (input: NoteIdData) => Promise<void>;
};

type NoteListRequestOptions = {
  readonly signal: AbortSignal;
};
