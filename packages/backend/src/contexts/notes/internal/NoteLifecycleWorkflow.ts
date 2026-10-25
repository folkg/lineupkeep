import { Machine } from "@typeonce/effect-machine";
import { Effect, Schema } from "effect";

import { NoteBatchInvalid, NoteBody, NoteTitle, NoteId } from "#contexts/notes/Note.ts";

export function noteLifecycleRequests<Input extends { readonly id: NoteId }>(
  inputs: ReadonlyArray<Input>,
  event: (input: Input) => NoteLifecycleRequest,
): Effect.Effect<ReadonlyMap<NoteId, NoteLifecycleRequest>, NoteBatchInvalid> {
  return Effect.gen(function* () {
    const requests = new Map<NoteId, NoteLifecycleRequest>();
    for (const input of inputs) {
      const request = event(input);
      const previous = requests.get(input.id);
      if (previous !== undefined && !eventEquals(previous, request)) {
        return yield* NoteBatchInvalid.make({
          reason: "Each target must have one update instruction",
        });
      }
      requests.set(input.id, request);
    }
    return requests;
  });
}

const Content = {
  title: NoteTitle,
  body: NoteBody,
  updatedAt: Schema.DateTimeUtc,
};
export const NoteLifecycleState = Schema.TaggedUnion({
  Active: Content,
  Trashed: { ...Content, trashedAt: Schema.DateTimeUtc },
  Deleted: { ...Content, deletedAt: Schema.DateTimeUtc },
});

export const NoteLifecycleStates = Machine.state({
  states: {
    Active: NoteLifecycleState.cases.Active,
    Trashed: NoteLifecycleState.cases.Trashed,
    Deleted: { type: "final", schema: NoteLifecycleState.cases.Deleted },
  },
});

export const NoteLifecycleEvents = Schema.TaggedUnion({
  EditRequested: { title: NoteTitle, body: NoteBody, at: Schema.DateTimeUtc },
  TrashRequested: { at: Schema.DateTimeUtc },
  RestoreRequested: { at: Schema.DateTimeUtc },
  DeleteRequested: { at: Schema.DateTimeUtc },
});

const eventEquals = Schema.toEquivalence(NoteLifecycleEvents);

export const NoteLifecycleWorkflow = Machine.make({
  root: NoteLifecycleStates,
  input: NoteLifecycleState.cases.Active,
  events: Machine.eventsFromSchemas(NoteLifecycleEvents),
}).handle({
  initial: { target: "Active", data: ({ input }) => input },
  states: {
    Active: {
      on: {
        EditRequested: {
          update: "Active",
          data: ({ event }) => ({ title: event.title, body: event.body, updatedAt: event.at }),
        },
        TrashRequested: {
          target: "Trashed",
          data: ({ state, event }) => ({
            title: state.title,
            body: state.body,
            updatedAt: event.at,
            trashedAt: event.at,
          }),
        },
        RestoreRequested: { none: true },
      },
    },
    Trashed: {
      on: {
        RestoreRequested: {
          target: "Active",
          data: ({ state, event }) => ({
            title: state.title,
            body: state.body,
            updatedAt: event.at,
          }),
        },
        TrashRequested: { none: true },
        DeleteRequested: {
          target: "Deleted",
          data: ({ state, event }) => ({
            title: state.title,
            body: state.body,
            updatedAt: event.at,
            deletedAt: event.at,
          }),
        },
      },
    },
    Deleted: {},
  },
});

export type NoteLifecycleRequest = Machine.Machine.InputEvent<typeof NoteLifecycleWorkflow>;
