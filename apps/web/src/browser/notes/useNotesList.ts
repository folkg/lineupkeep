import { useMutation, useInfiniteQuery } from "@tanstack/solid-query";
import { untrack, type Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import type { SearchFieldStatus } from "#browser/shared-ui/SearchField.tsx";
import { useWorkflow } from "#browser/workflow/useWorkflow.ts";
import type { NoteView } from "#contracts/notes/noteContract.ts";

import { describeNoteFailure, type NoteFailure } from "./noteFailure.ts";
import { normalizeNoteSearch } from "./noteInput.ts";
import { noteMutations } from "./noteMutations.ts";
import type { NoteListFilter, NoteListQueryOptions } from "./noteQueries.ts";
import type { NoteRemote } from "./noteRemote.ts";
import { createNoteSearch } from "./noteSearch.ts";
import { notesListWorkflow, type NoteChange } from "./notesListWorkflow.ts";
export function useNotesList(props: NotesListOptions): {
  isTrash: () => boolean;
  isSearch: () => boolean;
  count: () => number | undefined;
  hasMore: () => boolean;
  loadingMore: () => boolean;
  loadMore: () => Promise<undefined>;
  paginationFeedback: () => ActionFeedbackState | undefined;
  notes: () => ReadonlyArray<NoteView>;
  feedback: () => ActionFeedbackState | undefined;
  loadFailure: (error: unknown, reset: () => void) => ActionFeedbackState;
  search: {
    draft: Accessor<string>;
    setDraft: (value: string) => void;
    submit: () => void;
    clear: () => void;
    status: () => SearchFieldStatus;
  };
  pendingChange: (note: NoteView) => "delete" | "restore" | undefined;
  isChanging: () => boolean;
  moveToTrash: (note: NoteView) => Promise<void>;
  restore: (note: NoteView) => Promise<void>;
  deletePermanently: (note: NoteView) => Promise<void>;
  editingChanged: (id: string, note: NoteView | undefined) => undefined;
} {
  const notes = useInfiniteQuery(() => props.notesQuery());
  const confirmedNotes = (): NoteView[] => notes.data.pages.flatMap((page) => page.items);
  const trash = useMutation(() => noteMutations.moveToTrash(props.remote));
  const restore = useMutation(() => noteMutations.restore(props.remote));
  const deletePermanently = useMutation(() => noteMutations.deletePermanently(props.remote));
  const signIn = useSignInRecovery();
  const list = useWorkflow(notesListWorkflow, {
    onEnter: (state, send) => {
      switch (state.value) {
        case "changing": {
          const { kind, note } = state.context.change;
          const request: Promise<unknown> =
            kind === "trash"
              ? trash.mutate({ id: note.id })
              : kind === "delete"
                ? deletePermanently.mutate({ id: note.id })
                : restore.mutate({ id: note.id });
          return request.then(
            () => send({ type: "confirmed" }),
            (error: unknown) => send({ type: "failed", failure: describeNoteFailure(error) }),
          );
        }
        case "checkingLatest":
          return props.onRefresh().then(
            () => send({ type: "refreshed" }),
            () => send({ type: "refreshFailed" }),
          );
        case "ready":
          return undefined;
      }
    },
  });
  const search = createNoteSearch({
    initialSearch: untrack(() => props.filter().search),
    onApply: (value) => void props.onSearchChange(value),
  });

  const isChanging = (): boolean =>
    trash.isPending || restore.isPending || deletePermanently.isPending;
  const trashing = (): string | undefined => (trash.isPending ? trash.variables?.id : undefined);
  const count = (): number | undefined => (notes.isSuccess ? confirmedNotes().length : undefined);

  const checkLatest: RecoveryAction = {
    label: "Check latest",
    pendingLabel: "Checking latest…",
    onAction: () => list.send({ type: "checkLatest" }),
  };

  const outcomeFeedback = (): ActionFeedbackState | undefined => {
    const outcome = list.state().context.outcome;
    switch (outcome?.type) {
      case undefined:
        return undefined;
      case "confirmed":
        return confirmedFeedback(outcome.change);
      case "failed":
        return failedFeedback(outcome.change, outcome.failure);
      case "refreshFailed":
        return { type: "attention", message: "We could not refresh your notes." };
    }
  };

  const confirmedFeedback = (change: NoteChange): ActionFeedbackState => {
    switch (change.kind) {
      case "trash":
        return {
          type: "success",
          message: `Moved “${change.note.title}” to trash.`,
          recovery: {
            label: "Undo",
            pendingLabel: "Restoring…",
            onAction: () => list.send({ type: "undo" }),
          },
        };
      case "undo":
      case "restore":
        return { type: "success", message: `Restored “${change.note.title}”.` };
      case "delete":
        return { type: "success", message: `Deleted “${change.note.title}”.` };
    }
  };

  const failedFeedback = (change: NoteChange, failure: NoteFailure): ActionFeedbackState => {
    if (failure.kind === "authentication") {
      return { type: "attention", message: failure.message, recovery: signIn };
    }
    switch (change.kind) {
      case "trash":
        return {
          type: "attention",
          message: `We could not move “${change.note.title}” to trash. It is back in place.`,
          recovery: checkLatest,
        };
      case "undo":
        return {
          type: "attention",
          message: `We could not restore “${change.note.title}”. It is in Trash.`,
          recovery: checkLatest,
        };
      case "restore":
      case "delete":
        return {
          type: "attention",
          message: failure.message,
          recovery:
            failure.kind === "invalid_input" || failure.kind === "unavailable"
              ? undefined
              : checkLatest,
        };
    }
  };

  return {
    isTrash: () => props.filter().lifecycle === "trashed",
    isSearch: () => props.filter().search !== undefined,
    count,
    hasMore: () => notes.hasNextPage,
    loadingMore: () => notes.isFetchingNextPage,
    loadMore: () => notes.fetchNextPage({ cancelRefetch: false }).then(() => undefined),
    paginationFeedback: (): ActionFeedbackState | undefined =>
      notes.isFetchingNextPage
        ? { type: "pending", message: "Loading more notes…" }
        : notes.isFetchNextPageError
          ? {
              type: "attention",
              message:
                "We could not load more notes. Your loaded notes are still here. Try Load more again.",
            }
          : undefined,

    notes: (): ReadonlyArray<NoteView> => {
      const confirmed = confirmedNotes();
      const retained = list
        .state()
        .context.retained.filter((note) => !confirmed.some((item) => item.id === note.id));
      return [...confirmed, ...retained].filter((note) => note.id !== trashing());
    },
    feedback: (): ActionFeedbackState | undefined =>
      trash.isPending ? { type: "pending", message: "Moving to trash…" } : outcomeFeedback(),
    loadFailure: (error: unknown, reset: () => void): ActionFeedbackState => {
      const failure = describeNoteFailure(error);
      return failure.kind === "authentication"
        ? { type: "attention", message: failure.message, recovery: signIn }
        : {
            type: "attention",
            message:
              props.filter().search === undefined
                ? "We could not load your notes."
                : "We could not search your notes.",
            recovery: {
              label: "Try again",
              pendingLabel: "Trying again…",
              onAction: () => notes.refetch().then(reset),
            },
          };
    },
    search: {
      draft: search.draft,
      setDraft: search.setDraft,
      submit: search.submit,
      clear: search.clear,
      status: (): SearchFieldStatus => {
        const draft = search.draft();
        const normalized = normalizeNoteSearch(draft);
        if (draft.trim().length > 0 && normalized === undefined) {
          return { type: "message", message: "Type at least 3 characters to search." };
        }
        if (search.isDebouncing() || normalized !== props.filter().search) {
          return { type: "loading", message: "Searching notes…" };
        }
        const matches = count();
        if (props.filter().search !== undefined && matches !== undefined) {
          return {
            type: "message",
            message: `${matches}${notes.hasNextPage ? "+" : ""} matching ${matches === 1 ? "note" : "notes"}${notes.hasNextPage ? " shown" : ""}.`,
          };
        }
        return { type: "idle" };
      },
    },
    pendingChange: (note: NoteView) =>
      restore.isPending && restore.variables?.id === note.id
        ? "restore"
        : deletePermanently.isPending && deletePermanently.variables?.id === note.id
          ? "delete"
          : undefined,
    isChanging,
    moveToTrash: (note: NoteView) => list.send({ type: "change", kind: "trash", note }),
    restore: (note: NoteView) => list.send({ type: "change", kind: "restore", note }),
    deletePermanently: (note: NoteView) => list.send({ type: "change", kind: "delete", note }),
    editingChanged: (id: string, note: NoteView | undefined) =>
      void list.send({ type: "editingChanged", id, note }),
  };
}

type NotesListOptions = {
  readonly filter: Accessor<NoteListFilter>;
  readonly notesQuery: Accessor<NoteListQueryOptions>;
  readonly remote: NoteRemote;
  readonly onRefresh: () => Promise<void>;
  readonly onSearchChange: (search: string | undefined) => Promise<void>;
};
