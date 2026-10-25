import { assert, it } from "@effect/vitest";
import { MachineTest } from "@typeonce/effect-machine/testing";
import { Arbitrary, DateTime, Effect, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { decodeNoteTitle, decodeNoteBody, decodeNoteId } from "#contexts/notes/Note.ts";
import { snapshotOf } from "#utilities/machine.ts";

import { NoteLifecycleWorkflow } from "./NoteLifecycleWorkflow.ts";
import { NoteRow, ReadNoteRow } from "./NotesTables.ts";

it.effect("round-trips every explored lifecycle state through its row codec", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(NoteLifecycleWorkflow, {
      input,
      events: () => [edit, trash, restore, remove],
      stateKey: ({ snapshot }) => JSON.stringify(snapshot),
    });
    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    for (const { snapshot } of explored.nodes) {
      const record = {
        id: decodeNoteId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"),
        userId: yield* Schema.decodeEffect(UserId)("owner"),
        requestId: "request",
        createdAt: at,
        state: snapshot.state.value,
      };
      const row = yield* Schema.encodeEffect(NoteRow)(record);
      const decoded = yield* Schema.decodeEffect(NoteRow)(row);
      const restored = yield* snapshotOf(NoteLifecycleWorkflow, decoded.state);

      assert.strictEqual(row.title, record.state.title);
      assert.strictEqual(row.body, record.state.body);
      assert.deepStrictEqual(row.updatedAt, DateTime.toDateUtc(record.state.updatedAt));
      assert.deepStrictEqual(restored, snapshot);
      assert.deepStrictEqual(yield* Schema.encodeEffect(NoteRow)(decoded), row);
      assert.strictEqual(decoded.id, record.id);
      assert.strictEqual(decoded.userId, record.userId);
      assert.strictEqual(decoded.requestId, record.requestId);
      assert.deepStrictEqual(decoded.createdAt, record.createdAt);
    }
  }),
);

it.effect("round-trips generated lifecycle data and timestamp edges", () =>
  Effect.gen(function* () {
    const generated = Arbitrary.schema(
      Schema.Struct({
        title: Schema.String.check(Schema.isMaxLength(199)),
        body: Schema.String.check(Schema.isMaxLength(9999)),
        millis: Schema.Int.check(
          Schema.isBetween({ minimum: -8_640_000_000_000_000, maximum: 8_640_000_000_000_000 }),
        ),
      }),
    );
    const result = yield* Arbitrary.checkEffect(
      generated,
      ({ title, body, millis }) =>
        Effect.gen(function* () {
          for (const timestamp of [
            millis,
            -8_640_000_000_000_000,
            -1,
            0,
            1,
            8_640_000_000_000_000,
          ]) {
            const time = DateTime.makeUnsafe(timestamp);
            const content = {
              title: decodeNoteTitle(`題${title}`),
              body: decodeNoteBody(`文${body}`),
              updatedAt: time,
            };
            const states = [
              { _tag: "Active" as const, ...content },
              { _tag: "Trashed" as const, ...content, trashedAt: time },
              { _tag: "Deleted" as const, ...content, deletedAt: at },
            ];
            for (const state of states) {
              const record = {
                id: decodeNoteId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"),
                userId: yield* Schema.decodeEffect(UserId)("owner"),
                requestId: "request",
                createdAt: time,
                state,
              };
              const row = yield* Schema.encodeEffect(NoteRow)(record);
              const decoded = yield* Schema.decodeEffect(NoteRow)(row);
              if (!Schema.toEquivalence(Schema.toType(NoteRow))(decoded, record)) {
                return false;
              }
              if (state._tag !== "Deleted") {
                const readable = yield* Schema.decodeEffect(ReadNoteRow)(row);
                const readRow = yield* Schema.encodeEffect(ReadNoteRow)(readable);
                if (
                  !Schema.toEquivalence(Schema.toType(NoteRow))(readable, record) ||
                  !Schema.toEquivalence(Schema.toEncoded(NoteRow))(readRow, row)
                ) {
                  return false;
                }
              }
            }
          }
          return true;
        }),
      { seed: 20261021, runs: 100 },
    );

    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

it.effect("rejects Deleted at the readable row boundary", () =>
  Effect.gen(function* () {
    const row = yield* Schema.encodeEffect(NoteRow)({
      id: decodeNoteId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"),
      userId: yield* Schema.decodeEffect(UserId)("owner"),
      requestId: "request",
      createdAt: at,
      state: { ...input, _tag: "Deleted", deletedAt: at },
    });

    assert.isTrue(yield* Effect.isFailure(Schema.decodeEffect(ReadNoteRow)(row)));
  }),
);

const at = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const input = {
  _tag: "Active" as const,
  title: decodeNoteTitle("Title"),
  body: decodeNoteBody("Body"),
  updatedAt: at,
};
const edit = {
  _tag: "EditRequested" as const,
  title: decodeNoteTitle("Changed"),
  body: input.body,
  at,
};
const trash = { _tag: "TrashRequested" as const, at };
const restore = { _tag: "RestoreRequested" as const, at };
const remove = { _tag: "DeleteRequested" as const, at };
