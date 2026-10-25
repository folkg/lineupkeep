import { Array, DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { NoteIdInput } from "#contexts/notes/Note.ts";
import { Notes } from "#contexts/notes/Notes.ts";

import { NoteLifecycleEvents, noteLifecycleRequests } from "./NoteLifecycleWorkflow.ts";
import type { NoteLifecycleRequest } from "./NoteLifecycleWorkflow.ts";
import { NoteRepository } from "./NoteRepository.ts";

export const NotesLive = Layer.effect(
  Notes,
  Effect.gen(function* () {
    const repository = yield* NoteRepository;

    const lifecycle = Effect.fnUntraced(function* <Input extends NoteIdInput>(
      userId: UserId,
      inputs: ReadonlyArray<Input>,
      event: (input: Input, at: DateTime.Utc) => NoteLifecycleRequest,
    ) {
      if (inputs.length === 1) {
        yield* Effect.annotateCurrentSpan("note.id", Array.getUnsafe(inputs, 0).id);
      }
      const at = yield* DateTime.now;
      const requests = yield* noteLifecycleRequests(inputs, (input) => event(input, at));
      return yield* repository.mutateNotes(userId, requests);
    });

    return Notes.of({
      list: (userId, input = {}) =>
        repository
          .listNotes(userId, input)
          .pipe(
            Effect.tap((page) =>
              Effect.annotateCurrentSpan("notes.result_count", page.items.length),
            ),
          ),
      create: (userId, inputs) =>
        repository
          .createNotes(userId, inputs)
          .pipe(
            Effect.tap((created) =>
              created.length === 1
                ? Effect.annotateCurrentSpan("note.id", Array.getUnsafe(created, 0).id)
                : Effect.void,
            ),
          ),
      update: (userId, inputs) =>
        lifecycle(userId, inputs, (input, at) =>
          NoteLifecycleEvents.cases.EditRequested.make({
            title: input.title,
            body: input.body,
            at,
          }),
        ),
      moveToTrash: (userId, inputs) =>
        lifecycle(userId, inputs, (_, at) => NoteLifecycleEvents.cases.TrashRequested.make({ at })),
      restore: (userId, inputs) =>
        lifecycle(userId, inputs, (_, at) =>
          NoteLifecycleEvents.cases.RestoreRequested.make({ at }),
        ),
      deletePermanently: (userId, inputs) =>
        lifecycle(userId, inputs, (_, at) =>
          NoteLifecycleEvents.cases.DeleteRequested.make({ at }),
        ).pipe(Effect.asVoid),
    });
  }),
);
