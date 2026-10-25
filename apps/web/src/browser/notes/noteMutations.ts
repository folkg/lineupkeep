import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import { noteQueries } from "./noteQueries";
import type { NoteRemote } from "./noteRemote";

export const noteMutations = {
  create: (remote: NoteRemote) =>
    mutationOptions({
      mutationKey: ["notes", "create"],
      mutationFn: remote.create,
      onSuccess: markNoteListsStale,
    }),
  update: (remote: NoteRemote) =>
    mutationOptions({
      mutationKey: ["notes", "update"],
      mutationFn: remote.update,
      onSuccess: markNoteListsStale,
    }),
  moveToTrash: (remote: NoteRemote) =>
    mutationOptions({
      mutationKey: ["notes", "move-to-trash"],
      mutationFn: remote.moveToTrash,
      onSuccess: markNoteListsStale,
    }),
  restore: (remote: NoteRemote) =>
    mutationOptions({
      mutationKey: ["notes", "restore"],
      mutationFn: remote.restore,
      onSuccess: markNoteListsStale,
    }),
  deletePermanently: (remote: NoteRemote) =>
    mutationOptions({
      mutationKey: ["notes", "delete-permanently"],
      mutationFn: remote.deletePermanently,
      onSuccess: markNoteListsStale,
    }),
};

function markNoteListsStale(
  _data: unknown,
  _variables: unknown,
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): Promise<void> {
  return context.client.invalidateQueries({ queryKey: noteQueries.all(), refetchType: "none" });
}
