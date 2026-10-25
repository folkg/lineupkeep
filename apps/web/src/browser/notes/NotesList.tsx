import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show, onSettled } from "solid-js";
import type { Accessor } from "solid-js";

import { Badge } from "#browser/brand-ui/Badge.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { ButtonLink } from "#browser/shared-ui/ButtonLink.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { ArrowLeftIcon, Trash2Icon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Nav } from "#browser/shared-ui/Nav.tsx";
import { SearchField } from "#browser/shared-ui/SearchField.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import type { NoteView } from "#contracts/notes/noteContract.ts";

import { NoteCard } from "./NoteCard";
import type { NoteListFilter, NoteListQueryOptions } from "./noteQueries";
import type { NoteRemote } from "./noteRemote";
import { useNotesList } from "./useNotesList";

export function NotesList(props: NotesListProps): JSX.Element {
  const list = useNotesList(props);
  let heading: HTMLHeadingElement | undefined;

  const keepFocusInCollection = (): void =>
    onSettled(() => {
      const focused = document.activeElement;
      if (focused === null || focused === document.body) {
        heading?.focus();
      }
    });
  const moveToTrash = (note: NoteView): void => {
    heading?.focus();
    void list.moveToTrash(note);
  };
  const removeFromCollection = (change: Promise<void>) => void change.then(keepFocusInCollection);

  return (
    <Stack as="section" gap="md" labelledBy="notes-list-title">
      <Box rule="bottom" ruleTone="ink" space="lg">
        <Stack gap="md">
          <Inline gap="md" justify="between">
            <Inline gap="sm">
              <Heading
                ref={(element) => {
                  heading = element;
                }}
                focusable
                id="notes-list-title"
                level={2}
                size="section"
              >
                {list.isTrash() ? "Trash" : "Notes"}
              </Heading>
              <Show when={list.count()}>
                {(count) => (
                  <Badge size="caption">
                    {count()}
                    {list.hasMore() ? "+" : ""} {count() === 1 ? "note" : "notes"}
                  </Badge>
                )}
              </Show>
            </Inline>
            <Nav label="Note collection">
              <Show
                fallback={
                  <ButtonLink
                    search={(previous) => ({
                      ...previous,
                      search: undefined,
                      view: "trash" as const,
                    })}
                    to="/notes"
                    variant="secondary"
                  >
                    <Trash2Icon size="sm" />
                    View trash
                  </ButtonLink>
                }
                when={list.isTrash()}
              >
                <ButtonLink
                  search={(previous) => ({ ...previous, search: undefined, view: undefined })}
                  to="/notes"
                  variant="secondary"
                >
                  <ArrowLeftIcon size="sm" />
                  Back to notes
                </ButtonLink>
              </Show>
            </Nav>
          </Inline>
          <SearchField
            ariaLabel="Find in your notes"
            name="search"
            placeholder={list.isTrash() ? "Search trash" : "Search your notes"}
            status={list.search.status()}
            value={list.search.draft()}
            onClear={list.search.clear}
            onSubmit={list.search.submit}
            onValueChange={list.search.setDraft}
          />
        </Stack>
      </Box>

      <ActionFeedback feedback={list.feedback()} />

      <Errored
        fallback={(error, reset) => <ActionFeedback feedback={list.loadFailure(error(), reset)} />}
      >
        <Loading fallback={<NotesLoadingState isTrash={list.isTrash()} />}>
          <Stack as="section" gap="md" label="Note results">
            <Show when={list.notes().length === 0}>
              <NotesEmptyState isTrash={list.isTrash()} isSearch={list.isSearch()} />
            </Show>
            <For each={list.notes()} keyed={(note) => note.id}>
              {(note, index) => (
                <NoteCard
                  index={index()}
                  note={note()}
                  remote={props.remote}
                  pendingChange={list.pendingChange(note())}
                  changesDisabled={list.isChanging()}
                  onEditingChange={(retained) => list.editingChanged(note().id, retained)}
                  onMoveToTrash={() => moveToTrash(note())}
                  onRestore={() => removeFromCollection(list.restore(note()))}
                  onDeletePermanently={() => removeFromCollection(list.deletePermanently(note()))}
                  onRefresh={props.onRefresh}
                />
              )}
            </For>
            <Show when={list.hasMore()}>
              <Button
                variant="secondary"
                pending={list.loadingMore()}
                pendingLabel="Loading more…"
                onClick={() => void list.loadMore()}
              >
                Load more
              </Button>
            </Show>
            <ActionFeedback feedback={list.paginationFeedback()} />
          </Stack>
        </Loading>
      </Errored>
    </Stack>
  );
}

function NotesEmptyState(props: {
  readonly isTrash: boolean;
  readonly isSearch: boolean;
}): JSX.Element {
  return (
    <Show
      fallback={
        <Show
          fallback={
            <EmptyState title="Nothing here yet.">
              Add a title and a note to begin your working set.
            </EmptyState>
          }
          when={props.isTrash}
        >
          <EmptyState title="Trash is empty.">
            Notes you move to trash will stay recoverable here.
          </EmptyState>
        </Show>
      }
      when={props.isSearch}
    >
      <EmptyState title="No matching notes.">
        Try a different search or clear the filter to see this full collection.
      </EmptyState>
    </Show>
  );
}

function NotesLoadingState(props: { readonly isTrash: boolean }): JSX.Element {
  return (
    <LoadingState label="Loading notes">
      Loading {props.isTrash ? "your trash" : "your working set"}…
    </LoadingState>
  );
}

type NotesListProps = {
  readonly filter: Accessor<NoteListFilter>;
  readonly notesQuery: Accessor<NoteListQueryOptions>;
  readonly remote: NoteRemote;
  readonly onRefresh: () => Promise<void>;
  readonly onSearchChange: (search: string | undefined) => Promise<void>;
};
