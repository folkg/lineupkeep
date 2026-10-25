import { randomUUID } from "node:crypto";

import { Schema } from "effect";

import {
  addNote,
  expect,
  noteCard,
  noteTitles,
  recordServerRequests,
  signUp,
  test,
} from "./support";
import { captureCheckpoint } from "./verify/capture";

const singleFlightWrite = ["POST server function single-flight"];

test("adds a note with one single-flight request and keeps the confirmation", async ({
  page,
}, info) => {
  await test.step("Setup: sign in through the delivered email code and establish an empty list", async () => {
    await signUp(page);
    await expect(noteTitles(page)).toHaveCount(0);
    await captureCheckpoint(page, info, "empty-workspace");
  });
  const requests = recordServerRequests(page);
  await test.step("Baseline: enter a title and body; nothing has been submitted", async () => {
    await expect(noteTitles(page)).toHaveCount(0);
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("First cue");
    await page.getByRole("textbox", { name: "Note", exact: true }).fill("Something to remember.");
    await captureCheckpoint(page, info, "draft-before-submit");
  });

  await test.step("Action: add the note and check the confirmed single-flight result", async () => {
    const made = await requests.during(async () => {
      await page.getByRole("button", { name: "Add note" }).click();
      await expect(noteTitles(page)).toHaveText(["First cue"]);
    });
    expect(made).toEqual(singleFlightWrite);
    await expect(page.getByText("Note added.")).toBeVisible();
    await captureCheckpoint(page, info, "server-confirmed-note");
  });
  await test.step("Persistence: reload and check one saved note with the original body", async () => {
    await page.reload();
    await expect(noteTitles(page)).toHaveText(["First cue"]);
    await expect(
      noteCard(page, "First cue").getByText("Something to remember.", { exact: true }),
    ).toBeVisible();
    await captureCheckpoint(page, info, "persisted-after-reload");
  });
});

test("renders persisted notes before client scripts and hydrates single-flight writes", async ({
  page,
}) => {
  await signUp(page);
  await addNote(page, "Server-rendered cue", "Available before JavaScript.");
  const hydrationWarnings: string[] = [];
  page.on("console", (message) => {
    if (/hydration|unclaimed/i.test(message.text())) {
      hydrationWarnings.push(message.text());
    }
  });
  const scripts = Promise.withResolvers<void>();
  await page.route("**/*.js", async (route) => {
    await scripts.promise;
    await route.continue();
  });

  try {
    await page.goto("/notes", { waitUntil: "commit" });

    await expect(noteTitles(page)).toHaveText(["Server-rendered cue"]);
    await expect(page.getByText("Available before JavaScript.", { exact: true })).toBeVisible();
  } finally {
    scripts.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }

  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeEnabled();
  const requests = recordServerRequests(page);
  const made = await requests.during(() =>
    addNote(page, "Hydrated cue", "Reactive after hydration."),
  );

  expect(made).toEqual(singleFlightWrite);
  await expect(noteTitles(page)).toHaveText(["Server-rendered cue", "Hydrated cue"]);
  expect(hydrationWarnings).toEqual([]);
  await page.getByRole("link", { name: "View trash" }).click();
  await expect(page.getByText("Trash is empty.")).toBeVisible();
  await page.getByRole("link", { name: "Back to notes" }).click();
  await expect(noteTitles(page)).toHaveText(["Server-rendered cue", "Hydrated cue"]);
  await page.reload();
  await expect(noteTitles(page)).toHaveText(["Server-rendered cue", "Hydrated cue"]);
});

test("saves an edit with one single-flight request and keeps the confirmation", async ({
  page,
}) => {
  await signUp(page);
  await addNote(page, "Draft title", "Body text.");
  const requests = recordServerRequests(page);
  await noteCard(page, "Draft title").getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("Final title");

  const made = await requests.during(async () => {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(noteTitles(page)).toHaveText(["Final title"]);
  });

  expect(made).toEqual(singleFlightWrite);
  await expect(page.getByText("Changes saved.")).toBeVisible();
});

test("keeps an open editor's unsaved input when another write lands", async ({ page }) => {
  await signUp(page);
  await addNote(page, "Being edited", "Original body.");
  await noteCard(page, "Being edited").getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("Unsaved draft title");

  await addNote(page, "Added meanwhile", "Another note.");

  await expect(noteTitles(page)).toContainText(["Added meanwhile"]);
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "Unsaved draft title",
  );
});

test("moves a note to trash and undoes it with one single-flight request each", async ({
  page,
}) => {
  await signUp(page);
  await addNote(page, "Keep me", "Stays.");
  await addNote(page, "Trash me", "Goes, then returns.");
  const requests = recordServerRequests(page);

  const trashRequests = await requests.during(async () => {
    await noteCard(page, "Trash me").getByRole("button", { name: "Move to trash" }).click();
    await expect(page.getByText("Moved “Trash me” to trash.")).toBeVisible();
  });
  const undoRequests = await requests.during(async () => {
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Restored “Trash me”.")).toBeVisible();
  });

  expect(trashRequests).toEqual(singleFlightWrite);
  expect(undoRequests).toEqual(singleFlightWrite);
  await expect(noteTitles(page)).toHaveText(["Keep me", "Trash me"]);
});

test("restores and permanently deletes from the trash with one single-flight request each", async ({
  page,
  services,
}) => {
  await signUp(page);
  const seeded = await services.arrange(page, "two Notes in Trash", "seedTrash", [
    {
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
      title: "Bring back",
      body: "Restored from trash.",
    },
    {
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3",
      title: "Remove forever",
      body: "Deleted from trash.",
    },
  ]);
  const { ids } = Schema.decodeUnknownSync(
    Schema.Struct({ ids: Schema.Tuple([Schema.String, Schema.String]) }),
  )(seeded);
  const titles = [
    { id: ids[0], title: "Bring back" },
    { id: ids[1], title: "Remove forever" },
  ]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((note) => note.title);
  await page.goto("/notes?view=trash");
  await expect(noteTitles(page)).toHaveText(titles);
  const requests = recordServerRequests(page);

  const restoreRequests = await requests.during(async () => {
    await noteCard(page, "Bring back").getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Restored “Bring back”.")).toBeVisible();
  });
  await noteCard(page, "Remove forever").getByRole("button", { name: "Delete" }).click();
  const deleteRequests = await requests.during(async () => {
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Deleted “Remove forever”.")).toBeVisible();
  });

  expect(restoreRequests).toEqual(singleFlightWrite);
  expect(deleteRequests).toEqual(singleFlightWrite);
  await expect(page.getByText("Trash is empty.")).toBeVisible();
  await page.getByRole("link", { name: "Back to notes" }).click();
  await expect(noteTitles(page)).toHaveText(["Bring back"]);
});

test("pages persisted Notes through MCP and the browser without reusing a changed filter's cursor", async ({
  page,
  services,
  mcp,
}) => {
  await signUp(page);
  const seeded = await services.arrange(
    page,
    "more Notes than one page",
    "createNotes",
    Array.from({ length: 102 }, (_, index) => ({
      requestId: randomUUID(),
      title: `Page note ${String(index + 1).padStart(2, "0")}`,
      body: "Persisted pagination example",
    })),
  );
  const expected = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  )(seeded).toSorted((left, right) => left.id.localeCompare(right.id));
  const client = await mcp(["notes:read"], page);
  const decodePage = Schema.decodeUnknownSync(
    Schema.Struct({
      notes: Schema.Array(Schema.Struct({ id: Schema.String })),
      nextCursor: Schema.optional(Schema.String),
    }),
  );

  await test.step("Result: MCP defaults to 100 Notes and accepts a limit of 1,000", async () => {
    const first = decodePage((await client.callTool("list_notes", {})).structuredContent);
    expect(first.notes.map((note) => note.id)).toEqual(
      expected.slice(0, 100).map((note) => note.id),
    );
    expect(first.nextCursor).toBeDefined();
    const next = decodePage(
      (await client.callTool("list_notes", { cursor: first.nextCursor })).structuredContent,
    );
    expect(next.notes.map((note) => note.id)).toEqual(expected.slice(100).map((note) => note.id));
    expect(next.nextCursor).toBeUndefined();
    const all = decodePage(
      (await client.callTool("list_notes", { limit: 1000 })).structuredContent,
    );
    expect(all.notes.map((note) => note.id)).toEqual(expected.map((note) => note.id));
    expect(all.nextCursor).toBeUndefined();
  });

  await test.step("Result: MCP follows an opaque cursor and rejects changed filters", async () => {
    const first = decodePage((await client.callTool("list_notes", { limit: 2 })).structuredContent);
    expect(first.notes.map((note) => note.id)).toEqual(expected.slice(0, 2).map((note) => note.id));
    expect(first.nextCursor).toBeDefined();
    const next = decodePage(
      (await client.callTool("list_notes", { limit: 2, cursor: first.nextCursor }))
        .structuredContent,
    );
    expect(next.notes.map((note) => note.id)).toEqual(expected.slice(2, 4).map((note) => note.id));
    const changed = await client.callTool("list_notes", {
      limit: 2,
      cursor: first.nextCursor,
      search: "Page note 27",
    });
    expect(changed.isError).toBe(true);
  });

  await test.step("Result: the browser appends the remaining persisted page in ID order", async () => {
    await page.goto("/notes");
    await expect(noteTitles(page)).toHaveText(expected.slice(0, 100).map((note) => note.title));
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(noteTitles(page)).toHaveText(expected.map((note) => note.title));
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  });

  await test.step("Persistence: a changed filter starts at the first page and survives reload", async () => {
    await page.getByRole("searchbox", { name: "Find in your notes" }).fill("Page note 27");
    await expect(noteTitles(page)).toHaveText(["Page note 27"]);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/notes" && url.searchParams.get("search") === "Page note 27",
    );
    await expect(page.getByText("1 matching note.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
    await page.reload();
    await expect(noteTitles(page)).toHaveText(["Page note 27"]);
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page).toHaveURL("/notes");
    await expect(noteTitles(page)).toHaveText(expected.slice(0, 100).map((note) => note.title));
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
  });
});
