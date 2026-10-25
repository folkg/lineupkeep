import { Machine } from "@typeonce/effect-machine";
import { and, asc, eq, ilike, ne, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { Array, Context, Crypto, DateTime, Effect, Layer, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import {
  NoteCreateFailed,
  NoteId,
  NoteListInvalid,
  NoteNotFound,
  NoteLifecycleRejected,
  NotePersistenceFailed,
  decodeNoteId,
} from "#contexts/notes/Note.ts";
import type { CreateNoteInput, ListNotesInput, Note, NoteError } from "#contexts/notes/Note.ts";
import { anyOf, maxInsertRows, keysetPage, mutateRows } from "#database/dbUtilities.ts";
import { chunked } from "#utilities/collections.ts";
import { planBatch, snapshotOf } from "#utilities/machine.ts";

import { NoteLifecycleWorkflow } from "./NoteLifecycleWorkflow.ts";
import type { NoteLifecycleRequest, NoteLifecycleStates } from "./NoteLifecycleWorkflow.ts";
import { NotesDatabase } from "./NotesDatabase.ts";
import { notes, NoteRow, ReadNoteRow } from "./NotesTables.ts";

export class NoteRepository extends Context.Service<NoteRepository>()(
  "@sourdough/backend/contexts/notes/internal/NoteRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* NotesDatabase;
      const crypto = yield* Crypto.Crypto;
      const generateNoteId = crypto.randomUUIDv7().pipe(
        Effect.map(decodeNoteId),
        Effect.mapError((cause) => NotePersistenceFailed.make({ cause })),
      );

      const listNotes = Effect.fn("NoteRepository.listNotes")(function* (
        userId: UserId,
        input: ListNotesInput,
      ) {
        const page = yield* keysetPage({
          key: notes.id,
          after: input.cursor,
          limit: input.limit ?? 100,
          filters: { userId, lifecycle: input.lifecycle ?? "active", search: input.search ?? null },
          query: (after, limit) =>
            database
              .select()
              .from(notes)
              .where(and(buildListNotesWhere(userId, input), after))
              .orderBy(asc(notes.id))
              .limit(limit)
              .pipe(Effect.mapError((cause) => NotePersistenceFailed.make({ cause }))),
        }).pipe(Effect.catchTag("KeysetCursorInvalid", () => NoteListInvalid.make({})));
        return { ...page, items: yield* Effect.forEach(page.items, toNote) };
      });

      const createNotes = Effect.fn("NoteRepository.createNotes")(function* (
        userId: UserId,
        inputs: ReadonlyArray<CreateNoteInput>,
      ) {
        if (!Array.isReadonlyArrayNonEmpty(inputs)) {
          return [];
        }
        const now = yield* DateTime.nowAsDate;
        const rows = yield* Effect.forEach(inputs, (input) =>
          Effect.map(generateNoteId, (id) => ({
            ...input,
            userId,
            id,
            createdAt: now,
            updatedAt: now,
            trashedAt: null,
            deletedAt: null,
            lifecycle: "active" as const,
          })),
        );
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const sortedRows = rows.toSorted((left, right) =>
                left.requestId.localeCompare(right.requestId),
              );
              const inserted = yield* chunked(sortedRows, maxInsertRows(notes), (chunk) =>
                tx
                  .insert(notes)
                  .values(chunk)
                  .onConflictDoNothing({ target: [notes.userId, notes.requestId] })
                  .returning(),
              );
              const results = new Map(inserted.map((row) => [row.requestId, row]));
              const skipped = inputs
                .filter((input) => !results.has(input.requestId))
                .map((input) => input.requestId);
              if (Array.isArrayNonEmpty(skipped)) {
                const existing = yield* tx
                  .select()
                  .from(notes)
                  .where(
                    and(
                      eq(notes.userId, userId),
                      ne(notes.lifecycle, "deleted"),
                      anyOf(notes.requestId, skipped),
                    ),
                  );
                for (const row of existing) {
                  results.set(row.requestId, row);
                }
              }
              const ordered: Array<typeof notes.$inferSelect> = [];
              for (const input of inputs) {
                const row = results.get(input.requestId);
                if (row === undefined) {
                  return yield* NoteCreateFailed.make({});
                }
                ordered.push(row);
              }
              yield* Effect.annotateCurrentSpan({
                "notes.created_count": inserted.length,
                "notes.replayed_count": inputs.length - inserted.length,
              });
              return yield* Effect.forEach(ordered, toNote);
            }),
          )
          .pipe(mapTransactionError);
      });

      const mutateNotes = Effect.fn("NoteRepository.mutateNotes")(function* (
        userId: UserId,
        requests: ReadonlyMap<NoteId, NoteLifecycleRequest>,
      ) {
        const ids = [...requests.keys()];
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        return yield* database
          .transaction((transaction) =>
            mutateRows(transaction, notes, {
              where: and(eq(notes.userId, userId), ne(notes.lifecycle, "deleted")),
              ids,
              codec: NoteRow,
              plan: (locked) =>
                Effect.gen(function* () {
                  const targets: Array<{
                    readonly id: NoteId;
                    readonly record: typeof NoteRow.Type;
                    readonly event: NoteLifecycleRequest;
                    readonly snapshot: Machine.Snapshot<typeof NoteLifecycleStates>;
                  }> = [];
                  for (const [id, event] of requests) {
                    const row = locked.get(id);
                    if (row === undefined) {
                      if (event._tag === "DeleteRequested") {
                        continue;
                      }
                      return yield* NoteNotFound.make({ id });
                    }
                    targets.push({
                      id,
                      record: row,
                      event,
                      snapshot: yield* snapshotOf(NoteLifecycleWorkflow, row.state).pipe(
                        Effect.mapError((cause) => NotePersistenceFailed.make({ cause })),
                      ),
                    });
                  }
                  const planned = yield* planBatch(
                    NoteLifecycleWorkflow,
                    targets,
                    (target) => target.event,
                  ).pipe(
                    Effect.catchTag(
                      "TransitionRejected",
                      ({
                        id,
                        event,
                        state,
                      }): Effect.Effect<never, NoteNotFound | NoteLifecycleRejected> =>
                        event._tag === "EditRequested"
                          ? NoteNotFound.make({ id })
                          : NoteLifecycleRejected.make({
                              id,
                              lifecycle: state.state.path === "Active" ? "active" : "trashed",
                              event: event._tag,
                            }),
                    ),
                    Effect.mapError((cause) =>
                      cause._tag === "note.not_found" || cause._tag === "note.lifecycle_rejected"
                        ? cause
                        : NotePersistenceFailed.make({ cause }),
                    ),
                  );
                  const next = new Map(
                    planned.map(({ id, row, snapshot }) => [
                      id,
                      { ...row.record, state: snapshot.state.value },
                    ]),
                  );
                  return targets.map((target) => next.get(target.id) ?? target.record);
                }),
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              cause._tag === "SchemaError" ? NotePersistenceFailed.make({ cause }) : cause,
            ),
            mapTransactionError,
            Effect.map((rows) => {
              const byId = new Map(rows.map((row) => [row.id, row]));
              return ids.flatMap((id) => {
                const row = byId.get(id);
                return row === undefined || row.state._tag === "Deleted"
                  ? []
                  : [recordToNote(row, row.state)];
              });
            }),
          );
      });

      return { listNotes, createNotes, mutateNotes };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

function mapTransactionError<A, R>(
  effect: Effect.Effect<
    A,
    NoteError | { readonly _tag: "SqlError" | "EffectDrizzleQueryError" },
    R
  >,
): Effect.Effect<A, NoteError, R> {
  return effect.pipe(
    Effect.mapError((cause) => {
      switch (cause._tag) {
        case "SqlError":
        case "EffectDrizzleQueryError":
          return NotePersistenceFailed.make({ cause });
        case "note.batch_invalid":
        case "note.create_failed":
        case "note.lifecycle_conflict":
        case "note.lifecycle_rejected":
        case "note.list_invalid":
        case "note.not_found":
        case "note.persistence_failed":
          return cause;
      }
    }),
  );
}

function buildListNotesWhere(userId: UserId, input: ListNotesInput): SQL | undefined {
  const collection = and(
    eq(notes.userId, userId),
    eq(notes.lifecycle, input.lifecycle ?? "active"),
  );
  if (input.search === undefined) {
    return collection;
  }
  const pattern = `%${escapeLikePattern(input.search)}%`;
  return and(collection, or(ilike(notes.title, pattern), ilike(notes.body, pattern)));
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

const toNote: (note: unknown) => Effect.Effect<Note, NotePersistenceFailed> = Effect.fnUntraced(
  function* (note: unknown) {
    const row = yield* Schema.decodeUnknownEffect(ReadNoteRow)(note);
    return recordToNote(row, row.state);
  },
  (effect) => effect.pipe(Effect.mapError((cause) => NotePersistenceFailed.make({ cause }))),
);

function recordToNote(
  { id, userId, createdAt }: Pick<typeof NoteRow.Type, "id" | "userId" | "createdAt">,
  state: typeof ReadNoteRow.Type.state,
): Note {
  const { _tag, ...fields } = state;
  return {
    id,
    userId,
    createdAt,
    ...fields,
    lifecycle: _tag === "Active" ? "active" : "trashed",
  };
}
