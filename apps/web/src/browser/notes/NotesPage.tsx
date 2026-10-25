import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import {
  UnsavedChangesScope,
  UnsavedNavigationGuard,
} from "#browser/navigation/UnsavedChanges.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { SidebarLayout } from "#browser/shared-ui/SidebarLayout.tsx";

import { NoteComposer } from "./NoteComposer";
import type { NoteListFilter, NoteListQueryOptions } from "./noteQueries";
import type { NoteRemote } from "./noteRemote";
import { NotesList } from "./NotesList";

export function NotesPage(props: NotesPageProps): JSX.Element {
  const list = (): JSX.Element => (
    <NotesList
      filter={props.filter}
      notesQuery={props.notesQuery}
      remote={props.remote}
      onRefresh={props.onRefresh}
      onSearchChange={props.onSearchChange}
    />
  );
  return (
    <AppShell>
      <UnsavedChangesScope>
        <UnsavedNavigationGuard
          shouldBlock={({ current, next }) =>
            current.pathname !== next.pathname ||
            ("view" in current.search ? current.search.view : undefined) !==
              ("view" in next.search ? next.search.view : undefined)
          }
        />
        <Page
          lede="Capture what matters now. Revise it when the thought gets clearer."
          title="Your notes, in reach."
        >
          {}
          <Show when={props.filter().lifecycle} keyed>
            {(lifecycle) => (
              <Show when={lifecycle === "active"} fallback={list()}>
                <SidebarLayout
                  sidebar={<NoteComposer remote={props.remote} onRefresh={props.onRefresh} />}
                >
                  {list()}
                </SidebarLayout>
              </Show>
            )}
          </Show>
        </Page>
      </UnsavedChangesScope>
    </AppShell>
  );
}

type NotesPageProps = {
  readonly filter: Accessor<NoteListFilter>;
  readonly notesQuery: Accessor<NoteListQueryOptions>;
  readonly remote: NoteRemote;

  readonly onRefresh: () => Promise<void>;
  readonly onSearchChange: (search: string | undefined) => Promise<void>;
};
