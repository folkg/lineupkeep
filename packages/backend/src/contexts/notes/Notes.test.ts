import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@sourdough/backend/auth/User";
import { Array, Crypto, DateTime, Effect, Exit, Layer, Schema } from "effect";

import { makeTelemetryTest } from "#runtime/internal/TelemetryTest.ts";

import { NoteRepository } from "./internal/NoteRepository.ts";
import { NotesDatabase } from "./internal/NotesDatabase.ts";
import { NotesDatabaseTest } from "./internal/NotesDatabaseTest.ts";
import { NotesLive } from "./internal/NotesLive.ts";
import { notes as notesTable } from "./internal/NotesTables.ts";
import {
  CreateNoteInput,
  ListNotesInput,
  NoteId,
  NoteLifecycleRejected,
  NoteNotFound,
  NoteListInvalid,
  NotePersistenceFailed,
  UpdateNoteInput,
  decodeNoteTimestamp,
  NoteBatchInvalid,
  NoteCreateFailed,
} from "./Note.ts";
import { Notes } from "./Notes.ts";
it("normalizes titles and preserves body whitespace at the schema seam", () => {
  const input = Schema.decodeSync(CreateNoteInput)({
    requestId,
    title: " First note ",
    body: "  Initial body  ",
  });

  assert.strictEqual(input.title, "First note");
  assert.strictEqual(input.body, "  Initial body  ");
});

it("rejects missing replay keys and malformed identifiers, timestamps, and searches", () => {
  assert.throws(() => Schema.decodeUnknownSync(CreateNoteInput)({ title: "Title", body: "Body" }));
  assert.throws(() => Schema.decodeSync(NoteId)("not-a-uuid"));
  assert.throws(() => decodeNoteTimestamp("not-a-timestamp"));
  assert.throws(() => Schema.decodeSync(ListNotesInput)({ search: "a".repeat(201) }));
});

it("bounds list inputs at the shared schema without inserting defaults", () => {
  const decode = Schema.decodeSync(ListNotesInput);

  assert.deepStrictEqual(decode({}), {});
  assert.deepStrictEqual(decode({ limit: 1000, cursor: "a".repeat(2048) }), {
    limit: 1000,
    cursor: "a".repeat(2048),
  });
  for (const limit of [0, -1, 1.5, 1001]) {
    assert.throws(() => decode({ limit }));
  }
  assert.throws(() => decode({ cursor: "a".repeat(2049) }));
});

it.effect(
  "replays concurrent creation requests without creating duplicate notes",
  () =>
    Effect.gen(function* () {
      const notes = yield* Notes;
      const input = yield* Schema.decodeEffect(CreateNoteInput)({
        requestId,
        title: "One creation",
        body: "One body",
      });

      const [first, second] = yield* Effect.all(
        [notes.create(owner, [input]), notes.create(owner, [input])],
        { concurrency: "unbounded" },
      );

      assert.deepStrictEqual(first, second);
      assert.deepStrictEqual((yield* notes.list(owner)).items, first);
    }).pipe(Effect.provide(NotesTestLayer)),
  15_000,
);

it.effect("scopes replay identity and mutations to the verified owner", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const input = yield* Schema.decodeEffect(CreateNoteInput)({
      requestId,
      title: "Private",
      body: "Body",
    });
    const alice = Array.getUnsafe(yield* notes.create(owner, [input]), 0);
    const bob = Array.getUnsafe(yield* notes.create(other, [input]), 0);

    const error = yield* Effect.flip(
      notes.update(other, [{ id: alice.id, title: input.title, body: input.body }]),
    );
    const hidden = yield* Effect.flip(notes.moveToTrash(other, [{ id: alice.id }]));
    yield* notes.deletePermanently(other, [{ id: alice.id }]);

    assert.notStrictEqual(alice.id, bob.id);
    assert.instanceOf(error, NoteNotFound);
    assert.instanceOf(hidden, NoteNotFound);
    assert.deepStrictEqual((yield* notes.list(owner)).items, [alice]);
    assert.deepStrictEqual((yield* notes.list(other)).items, [bob]);
  }).pipe(Effect.provide(NotesTestLayer)),
);

it.effect("replays the current note after an edit regardless of submitted content", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const input = yield* Schema.decodeEffect(CreateNoteInput)({
      requestId,
      title: "Original",
      body: "Body",
    });
    const created = Array.getUnsafe(yield* notes.create(owner, [input]), 0);
    const update = yield* Schema.decodeEffect(UpdateNoteInput)({
      id: created.id,
      title: "Changed",
      body: "Changed body",
    });
    const updated = yield* notes.update(owner, [update]);

    const replay = yield* notes.create(owner, [input]);
    const changedContentReplay = yield* notes.create(owner, [{ ...input, title: update.title }]);

    assert.deepStrictEqual(replay, updated);
    assert.deepStrictEqual(changedContentReplay, updated);
    assert.deepStrictEqual((yield* notes.list(owner)).items, updated);
  }).pipe(Effect.provide(NotesTestLayer)),
);

it.effect("filters owner collections by lifecycle and literal title or body search", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const inputs = yield* Schema.decodeEffect(Schema.Array(CreateNoteInput))([
      { requestId, title: "Planning meeting", body: "Brief" },
      { requestId: secondRequestId, title: "Brief", body: "Review after the meeting" },
      { requestId: thirdRequestId, title: "100%_literal", body: "Coffee" },
    ]);
    const created = yield* notes.create(owner, inputs);

    const matches = yield* notes.list(
      owner,
      yield* Schema.decodeEffect(ListNotesInput)({ search: "MEETING" }),
    );
    const literal = yield* notes.list(
      owner,
      yield* Schema.decodeEffect(ListNotesInput)({ search: "%_" }),
    );
    yield* notes.moveToTrash(owner, [{ id: Array.getUnsafe(created, 0).id }]);

    assert.deepStrictEqual(
      matches.items.map((note) => note.id).sort(),
      created
        .slice(0, 2)
        .map((note) => note.id)
        .sort(),
    );
    assert.deepStrictEqual(literal.items, [Array.getUnsafe(created, 2)]);
    assert.strictEqual((yield* notes.list(owner)).items.length, 2);
    assert.strictEqual((yield* notes.list(owner, { lifecycle: "trashed" })).items.length, 1);
  }).pipe(Effect.provide(NotesTestLayer)),
);

it.effect(
  "makes lifecycle retries idempotent without allowing editing or deletion of active notes",
  () =>
    Effect.gen(function* () {
      const notes = yield* Notes;
      const input = yield* Schema.decodeEffect(CreateNoteInput)({
        requestId,
        title: "Recoverable",
        body: "Body",
      });
      const created = Array.getUnsafe(yield* notes.create(owner, [input]), 0);
      const ids = [{ id: created.id }];
      const rejected = yield* Effect.flip(notes.deletePermanently(owner, ids));
      const trashed = yield* notes.moveToTrash(owner, ids);
      const retryTrash = yield* notes.moveToTrash(owner, ids);
      const edit = yield* Effect.flip(
        notes.update(owner, [{ id: created.id, title: input.title, body: input.body }]),
      );
      const restored = yield* notes.restore(owner, ids);
      const retryRestore = yield* notes.restore(owner, ids);
      yield* notes.moveToTrash(owner, ids);
      yield* notes.deletePermanently(owner, ids);
      yield* notes.deletePermanently(owner, ids);

      assert.instanceOf(rejected, NoteLifecycleRejected);
      assert.strictEqual(rejected.event, "DeleteRequested");
      assert.instanceOf(edit, NoteNotFound);
      assert.deepStrictEqual(retryTrash, trashed);
      assert.deepStrictEqual(retryRestore, restored);
      assert.deepStrictEqual((yield* notes.list(owner)).items, []);
      assert.deepStrictEqual((yield* notes.list(owner, { lifecycle: "trashed" })).items, []);
    }).pipe(Effect.provide(NotesTestLayer)),
);

it.effect("maps UUID generation failure without inserting a note", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const cryptoFailure = yield* Effect.flip(crypto.randomBytes(-1));
    const failingCrypto = Layer.succeed(Crypto.Crypto)(
      Crypto.Crypto.of({ ...crypto, randomUUIDv7: () => Effect.fail(cryptoFailure) }),
    );
    const input = yield* Schema.decodeEffect(CreateNoteInput)({
      requestId,
      title: "Title",
      body: "Body",
    });
    const program = Notes.use((notes) => notes.create(owner, [input]));

    const error = yield* Effect.flip(
      program.pipe(
        Effect.provide(
          NotesLive.pipe(Layer.provide(NoteRepository.layer), Layer.provide(failingCrypto)),
        ),
      ),
    );
    const database = yield* NotesDatabase;

    assert.instanceOf(error, NotePersistenceFailed);
    assert.strictEqual(error.cause, cryptoFailure);
    assert.deepStrictEqual(yield* database.select().from(notesTable), []);
  }).pipe(Effect.provide(Layer.merge(NodeCrypto.layer, NotesDatabaseTest))),
);

it.effect(
  "retains deleted content, hides it from every public read, and never rewrites it on retries",
  () =>
    Effect.gen(function* () {
      const database = yield* NotesDatabase;
      const retained = yield* Effect.gen(function* () {
        const owner = decodeUserId("retained-row-owner");
        const service = yield* Notes;
        const input = yield* Schema.decodeEffect(CreateNoteInput)({
          requestId,
          title: "Retained 題",
          body: "  Retained body\n文  ",
        });
        const original = Array.getUnsafe(yield* service.create(owner, [input]), 0);
        const ids = [{ id: original.id }];
        yield* service.moveToTrash(owner, ids);
        yield* service.deletePermanently(owner, ids);
        const before = yield* database.select().from(notesTable);

        yield* service.deletePermanently(owner, ids);
        assert.instanceOf(yield* Effect.flip(service.restore(owner, ids)), NoteNotFound);
        assert.instanceOf(yield* Effect.flip(service.moveToTrash(owner, ids)), NoteNotFound);
        assert.instanceOf(
          yield* Effect.flip(
            service.update(owner, [{ id: original.id, title: input.title, body: input.body }]),
          ),
          NoteNotFound,
        );
        assert.instanceOf(yield* Effect.flip(service.create(owner, [input])), NoteCreateFailed);
        const after = yield* database.select().from(notesTable);

        assert.deepStrictEqual(after, before);
        const stored = Array.getUnsafe(after, 0);
        assert.strictEqual(stored.id, original.id);
        assert.strictEqual(stored.title, input.title);
        assert.strictEqual(stored.body, input.body);
        assert.strictEqual(stored.lifecycle, "deleted");
        assert.instanceOf(stored.deletedAt, Date);
        assert.deepStrictEqual(stored.updatedAt, stored.deletedAt);
        for (const lifecycle of ["active", "trashed"] as const) {
          for (const search of [undefined, input.title, "Retained body"]) {
            const filter = yield* Schema.decodeEffect(ListNotesInput)({
              lifecycle,
              search,
              limit: 1,
            });
            const page = yield* service.list(owner, filter);
            assert.deepStrictEqual(page.items, []);
            assert.isUndefined(page.nextCursor);
          }
        }
        assert.deepStrictEqual((yield* service.list(owner)).items, []);
        return before;
      }).pipe(Effect.provide(NotesLive.pipe(Layer.provide(NoteRepository.layer))));

      assert.strictEqual(retained.length, 1);
      assert.instanceOf(Array.getUnsafe(retained, 0).deletedAt, Date);
    }).pipe(Effect.provide(Layer.merge(NodeCrypto.layer, NotesDatabaseTest))),
);

it.effect("rejects malformed stored notes through the public service", () =>
  Effect.gen(function* () {
    const database = yield* NotesDatabase;
    yield* database.insert(notesTable).values({
      id: requestId,
      userId: owner,
      requestId,
      title: " ",
      body: "Body",
      lifecycle: "active",
      createdAt: yield* DateTime.nowAsDate,
      updatedAt: yield* DateTime.nowAsDate,
    });

    const error = yield* Effect.flip(
      Notes.use((notes) => notes.list(owner)).pipe(
        Effect.provide(NotesLive.pipe(Layer.provide(NoteRepository.layer))),
      ),
    );

    assert.instanceOf(error, NotePersistenceFailed);
  }).pipe(Effect.provide(Layer.merge(NodeCrypto.layer, NotesDatabaseTest))),
);

it.effect("exports failed database children without private bind parameters", () =>
  Effect.gen(function* () {
    const database = yield* NotesDatabase;
    const row = {
      id: secondRequestId,
      userId: other,
      requestId,
      title: "private-driver-title",
      body: "private-driver-body",
      lifecycle: "active" as const,
      createdAt: yield* DateTime.nowAsDate,
      updatedAt: yield* DateTime.nowAsDate,
    };
    yield* database.insert(notesTable).values(row);
    const telemetry = makeTelemetryTest();

    const exit = yield* database
      .insert(notesTable)
      .values(row)
      .pipe(
        Effect.mapError((cause) => NotePersistenceFailed.make({ cause })),
        Effect.withSpan("notes.create"),
        Effect.exit,
        Effect.provide(telemetry.layer),
      );
    const { payloads, spans } = telemetry.read();

    assert.isTrue(Exit.isFailure(exit));
    assert.isAtLeast(spans.length, 2);
    assert.isTrue(spans.some((span) => span.parentSpanId !== undefined && span.status.code === 2));
    assert.include(payloads.join(""), "exception");
    assert.notInclude(payloads.join(""), "private-driver-");
  }).pipe(Effect.provide(Layer.merge(NodeCrypto.layer, NotesDatabaseTest))),
);

const requestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";

const secondRequestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3";

const thirdRequestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a4";

const owner = decodeUserId("owner");

const other = decodeUserId("other");

const NotesTestLayer = NotesLive.pipe(
  Layer.provide(NoteRepository.layer),
  Layer.provide(NotesDatabaseTest),
  Layer.provide(NodeCrypto.layer),
);

it.effect("creates and updates heterogeneous batches in input order", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const owner = decodeUserId("batch-owner");
    const inputs = yield* Schema.decodeEffect(Schema.Array(CreateNoteInput))([
      { requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2", title: "First", body: "First body" },
      { requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3", title: "Second", body: "Second body" },
    ]);

    const created = yield* notes.create(owner, inputs);
    const updates = yield* Schema.decodeEffect(Schema.Array(UpdateNoteInput))(
      created.toReversed().map((note, index) => ({
        id: note.id,
        title: `Changed ${index}`,
        body: `Body ${index}: "{}\\\\, NULL`,
      })),
    );
    const updated = yield* notes.update(owner, updates);
    const replayed = yield* notes.create(owner, inputs);

    assert.deepStrictEqual(
      updated.map((note) => note.id),
      updates.map((input) => input.id),
    );
    assert.deepStrictEqual(
      updated.map((note) => note.title),
      ["Changed 0", "Changed 1"],
    );
    assert.deepStrictEqual(
      updated.map((note) => note.body),
      updates.map((input) => input.body),
    );
    assert.deepStrictEqual(replayed, updated.toReversed());
    assert.isTrue(created.every((note) => note.id[14] === "7"));
  }).pipe(Effect.provide(BatchTestLayer)),
);

it.effect("rolls back every update when one target belongs to another owner", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const owner = decodeUserId("batch-owner");
    const input = yield* Schema.decodeEffect(CreateNoteInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
      title: "Original",
      body: "Body",
    });
    const owned = Array.getUnsafe(yield* notes.create(owner, [input]), 0);
    const foreign = Array.getUnsafe(yield* notes.create(decodeUserId("other"), [input]), 0);
    const updates = yield* Schema.decodeEffect(Schema.Array(UpdateNoteInput))([
      { id: owned.id, title: "Changed", body: "Changed" },
      { id: foreign.id, title: "Forbidden", body: "Forbidden" },
    ]);

    const error = yield* Effect.flip(notes.update(owner, updates));

    assert.instanceOf(error, NoteNotFound);
    assert.deepStrictEqual((yield* notes.list(owner)).items, [owned]);
  }).pipe(Effect.provide(BatchTestLayer)),
);

it.effect("combines fresh creates with changed-content replays without overwriting notes", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const owner = decodeUserId("batch-owner");
    const inputs = yield* Schema.decodeEffect(Schema.Array(CreateNoteInput))([
      { requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2", title: "First", body: "Body" },
      { requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3", title: "Second", body: "Body" },
    ]);
    const original = yield* notes.create(owner, [Array.getUnsafe(inputs, 0)]);

    const result = yield* notes.create(owner, [
      Array.getUnsafe(inputs, 1),
      { ...Array.getUnsafe(inputs, 0), title: Array.getUnsafe(inputs, 1).title },
      Array.getUnsafe(inputs, 1),
    ]);

    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result[2], result[0]);
    assert.deepStrictEqual(result[1], original[0]);
    assert.strictEqual(result[0]?.title, "Second");
    assert.strictEqual((yield* notes.list(owner)).items.length, 2);
  }).pipe(Effect.provide(BatchTestLayer)),
);

it.effect("accepts empty batches and rejects conflicting update instructions atomically", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const owner = decodeUserId("bounds-owner");
    const input = yield* Schema.decodeEffect(CreateNoteInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
      title: "Original",
      body: "Body",
    });
    const [created] = yield* notes
      .create(owner, [input])
      .pipe(Effect.map((rows) => [Array.getUnsafe(rows, 0)] as const));
    const otherTitle = yield* Schema.decodeEffect(CreateNoteInput)({
      ...input,
      title: "Different",
    });

    const empty = yield* notes.create(owner, []);
    assert.deepStrictEqual(yield* notes.update(owner, []), []);
    assert.deepStrictEqual(yield* notes.moveToTrash(owner, []), []);
    assert.deepStrictEqual(yield* notes.restore(owner, []), []);
    yield* notes.deletePermanently(owner, []);
    const identical = yield* notes.update(owner, [
      { ...input, id: created.id },
      { ...input, id: created.id },
    ]);
    assert.deepStrictEqual(
      identical.map((note) => note.id),
      [created.id],
    );
    assert.deepStrictEqual((yield* notes.list(owner)).items, [created]);

    const duplicates = yield* Effect.flip(
      notes.update(owner, [
        { ...input, id: created.id },
        { ...otherTitle, id: created.id },
      ]),
    );

    assert.deepStrictEqual(empty, []);
    assert.instanceOf(duplicates, NoteBatchInvalid);
    assert.deepStrictEqual((yield* notes.list(owner)).items, [created]);
  }).pipe(Effect.provide(BatchTestLayer)),
);

it.effect("rolls back a lifecycle batch when one member cannot be deleted", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const owner = decodeUserId("lifecycle-owner");
    const inputs = yield* makeInputs(2);
    const created = yield* notes.create(owner, inputs);
    const first = Array.getUnsafe(created, 0);
    const trashed = yield* notes.moveToTrash(owner, [{ id: first.id }]);

    const error = yield* Effect.flip(
      notes.deletePermanently(
        owner,
        created.map((note) => ({ id: note.id })),
      ),
    );

    assert.instanceOf(error, NoteLifecycleRejected);
    assert.deepStrictEqual((yield* notes.list(owner, { lifecycle: "trashed" })).items, trashed);
    assert.deepStrictEqual((yield* notes.list(owner)).items, [Array.getUnsafe(created, 1)]);
  }).pipe(Effect.provide(BatchTestLayer)),
);

it.effect("rolls back a batch on a database constraint failure", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const fixedId = yield* crypto.randomUUIDv7();
    const inputs = yield* makeInputs(2);
    const failingCrypto = Layer.succeed(Crypto.Crypto)({
      ...crypto,
      randomUUIDv7: () => Effect.succeed(fixedId),
    });
    const layer = NotesLive.pipe(
      Layer.provide(NoteRepository.layer),
      Layer.provide(NotesDatabaseTest),
      Layer.provide(failingCrypto),
    );
    const result = yield* Effect.gen(function* () {
      const notes = yield* Notes;
      const owner = decodeUserId("constraint-owner");
      const error = yield* Effect.flip(notes.create(owner, inputs));
      return { error, remaining: (yield* notes.list(owner)).items };
    }).pipe(Effect.provide(layer));

    assert.instanceOf(result.error, NotePersistenceFailed);
    assert.deepStrictEqual(result.remaining, []);
  }).pipe(Effect.provide(NodeCrypto.layer)),
);

it.effect("annotates the caller's operation with shared Notes context", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const telemetry = makeTelemetryTest();
    const input = Array.getUnsafe(yield* makeInputs(1), 0);
    const created = yield* notes
      .create(owner, [input])
      .pipe(Effect.withSpan("notes.create"), Effect.provide(telemetry.layer));
    const note = Array.getUnsafe(created, 0);
    const update = { id: note.id, title: input.title, body: input.body };
    const id = [{ id: note.id }];
    yield* notes
      .update(owner, [update])
      .pipe(Effect.withSpan("notes.update"), Effect.provide(telemetry.layer));
    yield* notes.list(owner).pipe(Effect.withSpan("notes.list"), Effect.provide(telemetry.layer));
    yield* notes
      .moveToTrash(owner, id)
      .pipe(Effect.withSpan("notes.trash"), Effect.provide(telemetry.layer));
    yield* notes
      .restore(owner, id)
      .pipe(Effect.withSpan("notes.restore"), Effect.provide(telemetry.layer));
    yield* notes.moveToTrash(owner, id);
    yield* notes
      .deletePermanently(owner, id)
      .pipe(Effect.withSpan("notes.delete"), Effect.provide(telemetry.layer));

    const operations = telemetry.read().spans.filter((span) => span.name.startsWith("notes."));
    assert.strictEqual(operations.length, 6);
    for (const operation of operations) {
      assert.includeDeepMembers(
        [...operation.attributes],
        [
          operation.name === "notes.list"
            ? { key: "notes.result_count", value: { intValue: 1 } }
            : { key: "note.id", value: { stringValue: note.id } },
        ],
      );
    }
  }).pipe(Effect.provide(BatchTestLayer)),
);

it.effect("excludes deleted notes from search and keyset pages", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const created = yield* notes.create(owner, yield* makeInputs(5));
    const deleted = created.filter((_, index) => index % 2 === 0).map((note) => ({ id: note.id }));
    yield* notes.moveToTrash(owner, deleted);
    yield* notes.deletePermanently(owner, deleted);

    const first = yield* notes.list(owner, { limit: 1 });
    const second = yield* notes.list(owner, { limit: 1, cursor: first.nextCursor });
    const search = yield* notes.list(
      owner,
      yield* Schema.decodeEffect(ListNotesInput)({ search: "Note" }),
    );

    const expected = created
      .filter((_, index) => index % 2 !== 0)
      .map((note) => note.id)
      .toSorted();
    assert.deepStrictEqual(
      [...first.items, ...second.items].map((note) => note.id),
      expected,
    );
    assert.deepStrictEqual(
      search.items.map((note) => note.id),
      expected,
    );
    assert.isUndefined(second.nextCursor);
    assert.deepStrictEqual((yield* notes.list(owner, { lifecycle: "trashed" })).items, []);
  }).pipe(Effect.provide(BatchTestLayer)),
);

it.effect("defaults to 100 Notes per page", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const created = yield* notes.create(owner, yield* makeInputs(101));

    const first = yield* notes.list(owner, {});
    const next = yield* notes.list(owner, { cursor: first.nextCursor });

    assert.strictEqual(first.items.length, 100);
    assert.isDefined(first.nextCursor);
    assert.strictEqual(next.items.length, 1);
    assert.isUndefined(next.nextCursor);
    assert.deepStrictEqual(
      [...first.items, ...next.items].map((note) => note.id),
      created.map((note) => note.id).toSorted(),
    );
  }).pipe(Effect.provide(BatchTestLayer)),
);

it.effect("pages by ID without duplicates and rejects cursors from changed filters or owners", () =>
  Effect.gen(function* () {
    const notes = yield* Notes;
    const created = yield* notes.create(owner, yield* makeInputs(6));

    const first = yield* notes.list(owner, { limit: 2 });
    const second = yield* notes.list(owner, { limit: 2, cursor: first.nextCursor });
    const third = yield* notes.list(owner, { limit: 2, cursor: second.nextCursor });

    assert.isDefined(first.nextCursor);
    assert.isDefined(second.nextCursor);
    assert.isUndefined(third.nextCursor);
    assert.deepStrictEqual(
      [...first.items, ...second.items, ...third.items].map((note) => note.id),
      created.map((note) => note.id).toSorted(),
    );
    for (const filter of [{ lifecycle: "trashed" as const }, { search: "changed" }, {}]) {
      const input: ListNotesInput = yield* Schema.decodeEffect(ListNotesInput)({
        ...filter,
        cursor: first.nextCursor,
      });
      const error = yield* Effect.flip(
        notes.list(Object.keys(filter).length === 0 ? other : owner, input),
      );
      assert.instanceOf(error, NoteListInvalid);
    }
    const malformed = yield* Effect.flip(notes.list(owner, { cursor: "not-a-cursor" }));
    assert.instanceOf(malformed, NoteListInvalid);
  }).pipe(Effect.provide(BatchTestLayer)),
);

function makeInputs(
  count: number,
): Effect.Effect<
  [CreateNoteInput, ...CreateNoteInput[]],
  Effect.Error<ReturnType<Crypto.Crypto["randomUUIDv4"]>> | Schema.SchemaError,
  Crypto.Crypto
> {
  return Effect.forEach(Array.range(1, count), (index) =>
    Effect.gen(function* () {
      const requestId = yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4());
      return yield* Schema.decodeEffect(CreateNoteInput)({
        requestId,
        title: `Note ${index}`,
        body: `Body ${index}: \\"{}\\\\, NULL`,
      });
    }),
  );
}

const BatchTestLayer = NotesLive.pipe(
  Layer.provide(NoteRepository.layer),
  Layer.provide(NotesDatabaseTest),
  Layer.provideMerge(NodeCrypto.layer),
);
