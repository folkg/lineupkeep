import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { parseNotesSearch } from "#browser/notes/noteInput.ts";
import { noteQueries, refreshNoteLists, type NoteListFilter } from "#browser/notes/noteQueries.ts";
import { noteRemote } from "#browser/notes/noteRemote.ts";
import { NotesPage } from "#browser/notes/NotesPage.tsx";
import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
export const Route = createFileRoute("/notes")({
  ssr: true,
  validateSearch: parseNotesSearch,
  loaderDeps: ({ search }) => ({ search: search.search, view: search.view }),

  context: ({ deps }) => {
    const filter: NoteListFilter = {
      lifecycle: deps.view === "trash" ? "trashed" : "active",
      ...(deps.search === undefined ? {} : { search: deps.search }),
    };
    return { notesFilter: filter, notesQuery: noteQueries.list(noteRemote, filter) };
  },
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),

  loader: ({ context }) => context.queryClient.prefetchInfiniteQuery(context.notesQuery),
  component: NotesRoute,
});

function NotesRoute(): JSX.Element {
  const context = Route.useRouteContext();
  const navigate = Route.useNavigate();

  return (
    <NotesPage
      filter={() => context().notesFilter}
      notesQuery={() => context().notesQuery}
      remote={noteRemote}
      onRefresh={() => refreshNoteLists(context().queryClient)}
      onSearchChange={(search) =>
        navigate({ replace: true, search: (previous) => ({ ...previous, search }) })
      }
    />
  );
}
