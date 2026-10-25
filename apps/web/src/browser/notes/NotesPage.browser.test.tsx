import { render } from "@solidjs/web";
import { QueryClientProvider, type QueryClient } from "@tanstack/solid-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/solid-router";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import type { CreateNoteData, NoteView, NotePageView } from "#contracts/notes/noteContract.ts";

import { requireNoteSuccess } from "./noteFailure.ts";
import { parseNotesSearch } from "./noteInput.ts";
import { noteQueries, refreshNoteLists, type NoteListFilter } from "./noteQueries.ts";
import type { NoteRemote } from "./noteRemote.ts";
import { NotesPage } from "./NotesPage.tsx";
it("retains loaded notes and an editor draft while a later page fails and retries", async () => {
  const later = Promise.withResolvers<NotePageView>();
  let attempts = 0;
  using _app = setupNotesPage({
    notes: [],
    remote: (remote) => ({
      ...remote,
      list: (input) => {
        if (input.cursor === undefined) {
          return Promise.resolve({ items: [makeNote("note-1", "First")], nextCursor: "next-page" });
        }
        attempts += 1;
        expect(input.cursor).toBe("next-page");
        return attempts === 1
          ? later.promise
          : Promise.resolve({ items: [makeNote("note-2", "Second")] });
      },
    }),
  });
  await expect.element(page.getByRole("heading", { name: "First" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Note body" }).fill("Unsaved draft");

  await page.getByRole("button", { name: "Load more" }).click();

  await expect
    .element(page.getByRole("button", { name: "Loading more…" }))
    .toHaveAttribute("aria-disabled", "true");
  await expect
    .element(page.getByRole("textbox", { name: "Note body" }))
    .toHaveValue("Unsaved draft");
  later.reject(new Error("unavailable"));
  await expect
    .element(
      page.getByText(
        "We could not load more notes. Your loaded notes are still here. Try Load more again.",
      ),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "Note body" }))
    .toHaveValue("Unsaved draft");
  await page.getByRole("button", { name: "Load more" }).click();

  await expect.element(page.getByRole("heading", { name: "Second" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("textbox", { name: "Note body" }))
    .toHaveValue("Unsaved draft");
  expect(attempts).toBe(2);
});

it("explains missing values beside their fields instead of submitting", async () => {
  using app = setupNotesPage({ notes: [] });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Only a title");

  await page.getByRole("button", { name: "Add note" }).click();

  await expect.element(page.getByText("Add a note.")).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "Note", exact: true })).toHaveFocus();
  expect(app.server.writes).toEqual([]);
});

it("adds a note from the note field with Control and Enter", async () => {
  using _app = setupNotesPage({ notes: [] });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Shortcut");
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Typed body");

  await userEvent.keyboard("{Control>}{Enter}{/Control}");

  await expect.element(page.getByRole("heading", { name: "Shortcut" })).toBeVisible();
});

it("sends one creation when the form is submitted again while it runs", async () => {
  const created = Promise.withResolvers<void>();
  using app = setupNotesPage({ notes: [], hold: { create: created.promise } });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Once");
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Only once");
  await page.getByRole("button", { name: "Add note" }).click();

  await page.getByRole("textbox", { name: "Note", exact: true }).click();
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  created.resolve();

  await expect.element(page.getByText("Note added.")).toBeVisible();
  expect(app.server.writes).toEqual(["create"]);
});

it("keeps input typed while a creation request is in flight", async () => {
  const created = Promise.withResolvers<void>();
  using _app = setupNotesPage({ notes: [], hold: { create: created.promise } });
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("First thought");
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Body");
  await page.getByRole("button", { name: "Add note" }).click();

  await title.fill("Second thought");
  created.resolve();

  await expect.element(page.getByRole("heading", { name: "First thought" })).toBeVisible();
  await expect.element(title).toHaveValue("Second thought");
});

it("retries an unconfirmed creation with the same request identity", async () => {
  const requests: Array<CreateNoteData> = [];
  using _app = setupNotesPage({
    notes: [],
    remote: (remote) => ({
      ...remote,
      create: (input) => {
        requests.push(input);
        return requests.length === 1 ? Promise.reject(new Error("timeout")) : remote.create(input);
      },
    }),
  });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Once only");
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Body");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect.element(page.getByText(/We could not confirm adding your note/)).toBeVisible();

  await page.getByRole("button", { name: "Retry submitted note" }).click();

  await expect.element(page.getByRole("heading", { name: "Once only" })).toBeVisible();
  expect(requests[1]).toEqual(requests[0]);
});

it("edits a note in place and returns focus to its Edit action", async () => {
  using _app = setupNotesPage({ notes: [makeNote("note-1", "Draft title")] });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Note title" })).toHaveFocus();

  await page.getByRole("textbox", { name: "Note title" }).fill("Final title");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.element(page.getByRole("heading", { name: "Final title" })).toBeVisible();
  await expect.element(page.getByText("Changes saved.")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Edit", exact: true })).toHaveFocus();
});

it("cancels editing with Escape", async () => {
  using _app = setupNotesPage({ notes: [makeNote("note-1", "Original")] });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("Discarded");

  await userEvent.keyboard("{Escape}");

  await expect.element(page.getByRole("heading", { name: "Original" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Edit", exact: true })).toHaveFocus();
});

it("keeps edited values and hides provider details when saving fails", async () => {
  using _app = setupNotesPage({
    notes: [makeNote("note-1", "Editable")],
    remote: (remote) => ({
      ...remote,
      update: () => Promise.reject(new Error("private provider error")),
    }),
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("My edited title");

  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.element(page.getByText(/We could not confirm the change/)).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Check latest" })).toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "Note title" }))
    .toHaveValue("My edited title");
  await expect.element(page.getByText("private provider error")).not.toBeInTheDocument();
});

it("removes a note at once when moving it to trash and offers Undo once confirmed", async () => {
  const trashed = Promise.withResolvers<void>();
  using _app = setupNotesPage({
    notes: [makeNote("note-1", "Old idea"), makeNote("note-2", "Kept idea")],
    hold: { moveToTrash: trashed.promise },
  });

  await page.getByRole("button", { name: "Move to trash" }).first().click();

  await expect.element(page.getByRole("heading", { name: "Old idea" })).not.toBeInTheDocument();
  await expect.element(page.getByText("Moving to trash…")).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Notes" })).toHaveFocus();

  trashed.resolve();

  await expect.element(page.getByText("Moved “Old idea” to trash.")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();

  await expect.element(page.getByRole("heading", { name: "Old idea" })).toBeVisible();
  await expect.element(page.getByText("Restored “Old idea”.")).toBeVisible();
});

it("returns a note to the list when moving it to trash fails", async () => {
  using _app = setupNotesPage({
    notes: [makeNote("note-1", "Stubborn")],
    remote: (remote) => ({
      ...remote,
      moveToTrash: () => Promise.reject(new Error("unavailable")),
    }),
  });

  await page.getByRole("button", { name: "Move to trash" }).click();

  await expect
    .element(page.getByText("We could not move “Stubborn” to trash. It is back in place."))
    .toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Stubborn" })).toBeVisible();
});

it("offers sign-in without discarding input when the session has ended", async () => {
  using _app = setupNotesPage({
    notes: [],
    remote: (remote) => ({
      ...remote,
      create: () => Promise.reject(new AuthenticationRequestFailure({ type: "auth.required" })),
    }),
  });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Unsaved thought");
  await page.getByRole("textbox", { name: "Note", exact: true }).fill("Body");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect.element(page.getByText(/Your session has ended/)).toBeVisible();

  await page.getByRole("button", { name: "Sign in again" }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect
    .element(page.getByRole("textbox", { name: "Title", exact: true }))
    .toHaveValue("Unsaved thought");
});

it("explains a rejected change without inviting a blind resubmission", async () => {
  using _app = setupNotesPage({
    notes: [makeNote("note-1", "Editable")],
    remote: (remote) => ({
      ...remote,
      update: () =>
        Promise.resolve().then(() =>
          requireNoteSuccess({ type: "error", error: { type: "note.input_invalid" } }),
        ),
    }),
  });
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect
    .element(
      page.getByText("The submitted values were rejected. Review them before submitting again."),
    )
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Check latest" })).not.toBeInTheDocument();
});

it("asks for three characters before searching", async () => {
  using app = setupNotesPage({ notes: [makeNote("note-1", "Meeting notes")] });

  await page.getByRole("searchbox", { name: "Find in your notes" }).fill("me");

  await expect.element(page.getByText("Type at least 3 characters to search.")).toBeVisible();
  expect(app.server.searches).toEqual([]);
});

it("keeps the composer usable and offers a retry when notes fail to load", async () => {
  let failing = true;
  using _app = setupNotesPage({
    notes: [makeNote("note-1", "Recovered")],
    remote: (remote) => ({
      ...remote,
      list: (input, options) =>
        failing ? Promise.reject(new Error("unavailable")) : remote.list(input, options),
    }),
  });
  await expect.element(page.getByText("We could not load your notes.")).toBeVisible();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Still typing");

  failing = false;
  await page.getByRole("button", { name: "Try again" }).click();

  await expect.element(page.getByRole("heading", { name: "Recovered" })).toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "Title", exact: true }))
    .toHaveValue("Still typing");
});

it("shows a note moved to trash when Trash is opened next", async () => {
  using _app = setupNotesPage({
    notes: [makeNote("note-1", "Archived"), makeNote("note-2", "Trash")],
  });
  await page.getByRole("link", { name: "View trash" }).click();
  await page.getByRole("link", { name: "Back to notes" }).click();

  await page.getByRole("button", { name: "Move to trash" }).first().click();
  await expect.element(page.getByText("Moved “Archived” to trash.")).toBeVisible();
  await page.getByRole("link", { name: "View trash" }).click();

  await expect.element(page.getByRole("heading", { name: "Archived" })).toBeVisible();
});

it("keeps unfinished input until leaving the collection is confirmed", async () => {
  using _app = setupNotesPage({ notes: [] });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Unfinished");

  await page.getByRole("link", { name: "View trash" }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect
    .element(page.getByRole("textbox", { name: "Title", exact: true }))
    .toHaveValue("Unfinished");

  await page.getByRole("link", { name: "View trash" }).click();
  await page.getByRole("button", { name: "Discard and leave" }).click();

  await expect.element(page.getByText("Trash is empty.")).toBeVisible();
});

it("keeps an open editor when a refresh no longer includes its note", async () => {
  using app = setupNotesPage({ notes: [makeNote("note-1", "Shared note")] });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("My unsaved edit");

  app.server.removeElsewhere("note-1");
  await app.refresh();

  await expect
    .element(page.getByRole("textbox", { name: "Note title" }))
    .toHaveValue("My unsaved edit");
});

it("leaves focus in another editor when an earlier save closes its own", async () => {
  const saved = Promise.withResolvers<void>();
  using _app = setupNotesPage({
    notes: [makeNote("note-1", "First"), makeNote("note-2", "Second")],
    hold: { update: saved.promise },
  });
  const cards = page.getByRole("region", { name: "Note results" }).getByRole("article");
  await cards.nth(0).getByRole("button", { name: "Edit", exact: true }).click();
  await cards.nth(1).getByRole("button", { name: "Edit", exact: true }).click();
  await cards.nth(0).getByRole("button", { name: "Save", exact: true }).click();
  await cards.nth(1).getByRole("textbox", { name: "Note body" }).click();

  saved.resolve();

  await expect.element(cards.nth(0).getByText("Changes saved.")).toBeVisible();
  await expect.element(cards.nth(1).getByRole("textbox", { name: "Note body" })).toHaveFocus();
});

function setupNotesPage(options: NotesPageFixture): {
  server: {
    remote: NoteRemote;
    writes: NoteWrite[];
    searches: string[];
    removeElsewhere: (id: string) => void;
  };
  refresh: () => Promise<void>;
  [Symbol.dispose](): void;
} {
  const queryClient = createQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  const server = createNotesServer(options.notes, queryClient, options.hold ?? {});
  const remote = options.remote?.(server.remote) ?? server.remote;

  const sessionRemote: SessionRemote = {
    load: () => Promise.resolve({ status: "authenticated", userId: "user-1" }),
    signOut: () => Promise.resolve(),
  };
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const notesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/notes",
    validateSearch: parseNotesSearch,
    loaderDeps: ({ search }) => ({ search: search.search, view: search.view }),
    context: ({ deps }) => {
      const filter: NoteListFilter = {
        lifecycle: deps.view === "trash" ? "trashed" : "active",
        ...(deps.search === undefined ? {} : { search: deps.search }),
      };
      return { notesFilter: filter, notesQuery: noteQueries.list(remote, filter) };
    },
    loader: ({ context }) => context.queryClient.prefetchInfiniteQuery(context.notesQuery),
    component: () => {
      const context = notesRoute.useRouteContext();
      const navigate = notesRoute.useNavigate();
      return (
        <NotesPage
          filter={() => context().notesFilter}
          notesQuery={() => context().notesQuery}
          remote={remote}
          onRefresh={() => refreshNoteLists(queryClient)}
          onSearchChange={(search) =>
            navigate({ replace: true, search: (previous) => ({ ...previous, search }) })
          }
        />
      );
    },
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>Home page</p>,
  });
  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth",
    component: () => <p>Sign-in page</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/notes"] }),
    routeTree: rootRoute.addChildren([homeRoute, notesRoute, authRoute]),
  });
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <RouterProvider router={router} />, host);

  return {
    server,
    refresh: () => refreshNoteLists(queryClient),
    [Symbol.dispose](): void {
      dispose();
      queryClient.clear();
      host.remove();
    },
  };
}

function createNotesServer(
  initial: ReadonlyArray<NoteView>,
  queryClient: QueryClient,
  hold: Partial<Record<NoteWrite, Promise<void>>>,
): {
  remote: NoteRemote;
  writes: NoteWrite[];
  searches: string[];
  removeElsewhere: (id: string) => void;
} {
  let notes = [...initial];
  const writes: Array<NoteWrite> = [];
  const searches: Array<string> = [];
  const write = async <T,>(name: NoteWrite, change: () => T): Promise<T> => {
    writes.push(name);
    await hold[name];
    const result = change();
    await queryClient.refetchQueries({ queryKey: noteQueries.all(), type: "active" });
    return result;
  };
  const setLifecycle = (id: string, lifecycle: NoteView["lifecycle"]): NoteView => {
    const note = { ...findNote(notes, id), lifecycle };
    notes = notes.map((item) => (item.id === id ? note : item));
    return note;
  };

  const remote: NoteRemote = {
    list: (input) => {
      if (input.search !== undefined) {
        searches.push(input.search);
      }
      const search = input.search?.toLowerCase();
      return Promise.resolve({
        items: notes.filter(
          (note) =>
            note.lifecycle === (input.lifecycle ?? "active") &&
            (search === undefined || note.title.toLowerCase().includes(search)),
        ),
      });
    },
    create: (input) =>
      write("create", () => {
        const note = makeNote(input.requestId, input.title);
        notes = [...notes, { ...note, body: input.body }];
        return note;
      }),
    update: (input) =>
      write("update", () => {
        const note = { ...findNote(notes, input.id), title: input.title, body: input.body };
        notes = notes.map((item) => (item.id === input.id ? note : item));
        return note;
      }),
    moveToTrash: (input) => write("moveToTrash", () => setLifecycle(input.id, "trashed")),
    restore: (input) => write("restore", () => setLifecycle(input.id, "active")),
    deletePermanently: (input) =>
      write("deletePermanently", () => {
        notes = notes.filter((note) => note.id !== input.id);
      }),
  };

  return {
    remote,
    writes,
    searches,
    removeElsewhere: (id: string) => {
      notes = notes.filter((note) => note.id !== id);
    },
  };
}

function findNote(notes: ReadonlyArray<NoteView>, id: string): NoteView {
  const note = notes.find((item) => item.id === id);
  if (note === undefined) {
    throw new Error(`Unknown note ${id}`);
  }
  return note;
}

function makeNote(id: string, title: string): NoteView {
  return {
    id,
    title,
    body: "Loaded body",
    lifecycle: "active",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  };
}

type NoteWrite = Exclude<keyof NoteRemote, "list">;

type NotesPageFixture = {
  readonly notes: ReadonlyArray<NoteView>;
  readonly hold?: Partial<Record<NoteWrite, Promise<void>>>;
  readonly remote?: (remote: NoteRemote) => NoteRemote;
};
