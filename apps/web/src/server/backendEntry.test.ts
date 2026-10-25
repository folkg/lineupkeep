import { assert, it } from "@effect/vitest";
import { AuthService } from "@lineupkeep/backend/auth/Auth";
import {
  Note,
  NoteBatchInvalid,
  NoteCreateFailed,
  NoteLifecycleConflict,
  NoteLifecycleRejected,
  NoteNotFound,
  NotePersistenceFailed,
  decodeNoteId,
  type NoteError,
} from "@lineupkeep/backend/notes/Note";
import {
  makeRequestContext,
  requestContextLayer,
} from "@lineupkeep/backend/runtime/RequestContext";
import { Effect, Layer, Schema, DateTime, Cause, Exit } from "effect";

import type { NoteMutationError } from "#contracts/notes/noteContract.ts";

import { authenticatedUseCase } from "./backendEntry.ts";
import { mapNoteError, NoteInputInvalid, toNoteView } from "./notes/notePresentation";

it.effect("rejects anonymous invalid input before reporting validation failure", () =>
  Effect.gen(function* () {
    const result = yield* execute(false);

    assert.deepStrictEqual(result, { type: "error", error: { type: "auth.required" } });
  }),
);

it.effect("preserves defects instead of classifying them as expected rejections", () =>
  Effect.gen(function* () {
    const program = authenticatedUseCase(() => Effect.die("private defect"), mapNoteError);
    const exit = yield* program.pipe(Effect.provide(yield* authentication(true)), Effect.exit);

    assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
  }),
);

it.effect("returns ownership-free ISO dates through the authenticated result", () =>
  Effect.gen(function* () {
    const timestamp = DateTime.makeUnsafe("2026-01-02T03:04:05Z");
    const note = yield* Schema.decodeEffect(Note)({
      id: "0fbcaf9b-f3bd-4b27-952b-d80ad6383b99",
      userId: "signed-in-user",
      title: "Title",
      body: "Body",
      lifecycle: "trashed",
      trashedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const result = yield* authenticatedUseCase(
      () => Effect.succeed(toNoteView(note)),
      mapNoteError,
    ).pipe(Effect.provide(yield* authentication(true)));

    assert.deepStrictEqual(result, {
      type: "success",
      data: {
        id: note.id,
        title: "Title",
        body: "Body",
        lifecycle: "trashed",
        trashedAt: "2026-01-02T03:04:05.000Z",
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:05.000Z",
      },
    });
  }),
);

it.effect("projects every expected note failure to a safe code and business outcome", () =>
  Effect.gen(function* () {
    const id = decodeNoteId("0fbcaf9b-f3bd-4b27-952b-d80ad6383b99");
    const failures: ReadonlyArray<
      readonly [NoteError | NoteInputInvalid, NoteMutationError["type"], string]
    > = [
      [NoteInputInvalid.make({}), "note.input_invalid", "rejected"],
      [NoteBatchInvalid.make({ reason: "private reason" }), "note.input_invalid", "rejected"],
      [NoteNotFound.make({ id }), "note.not_found", "rejected"],
      [NoteCreateFailed.make({}), "note.create_failed", "failure"],
      [
        NotePersistenceFailed.make({ cause: "private database failure" }),
        "note.persistence_failed",
        "failure",
      ],
      [
        NoteLifecycleConflict.make({ id, expected: "active" }),
        "note.lifecycle_conflict",
        "conflict",
      ],
      [
        NoteLifecycleRejected.make({ id, lifecycle: "active", event: "private event" }),
        "note.lifecycle_rejected",
        "rejected",
      ],
    ];
    const layer = yield* authentication(true);
    for (const [error, code, outcome] of failures) {
      const observation = yield* authenticatedUseCase(() => Effect.fail(error), mapNoteError).pipe(
        Effect.flatMap((result) =>
          Effect.map(Effect.currentSpan, (span) => ({
            result,
            outcome: span.attributes.get("app.outcome"),
            status: span.attributes.get("http.response.status_code"),
          })),
        ),
        Effect.withSpan("test.expected_failure"),
        Effect.provide(layer),
      );

      assert.deepStrictEqual(observation, {
        result: { type: "error", error: { type: code } },
        outcome,
        status: 200,
      });
    }
  }),
);

function execute(signedIn: boolean): Effect.Effect<
  | import("#contracts/auth/authContract.ts").AuthenticationFailureResult
  | {
      type: "error";
      error: {
        type:
          | "note.create_failed"
          | "note.input_invalid"
          | "note.lifecycle_conflict"
          | "note.lifecycle_rejected"
          | "note.list_invalid"
          | "note.not_found"
          | "note.persistence_failed";
      };
    }
  | {
      type: "success";
      data: string;
    },
  | import("@lineupkeep/backend/auth/Auth").AuthenticationInvalidResponse
  | import("@lineupkeep/backend/auth/Auth").AuthenticationUnavailable,
  never
> {
  const decoded = Schema.decodeUnknownResult(Schema.String)(42);
  return authenticatedUseCase(
    () => Effect.fromResult(decoded).pipe(Effect.mapError(() => NoteInputInvalid.make({}))),
    mapNoteError,
  ).pipe(Effect.provide(authentication(signedIn).pipe(Layer.unwrap)));
}

function authentication(
  signedIn: boolean,
): Effect.Effect<
  Layer.Layer<
    AuthService | import("@lineupkeep/backend/runtime/RequestContext").RequestContext,
    never,
    never
  >,
  never,
  never
> {
  return Effect.gen(function* () {
    const context = yield* makeRequestContext(
      new Request("https://example.test/notes", { headers: { "x-request-id": "use-case-test" } }),
    );
    return Layer.merge(
      requestContextLayer(context),
      Layer.succeed(AuthService)(
        AuthService.of({
          signInMethods: { google: false },
          oauthResource: "https://example.test/mcp",
          resolveAccessToken: () => Effect.succeed({ status: "invalid" as const }),
          getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
          consent: () => Effect.succeed("https://client.test/callback"),
          handle: () => Effect.succeed(new Response()),
          getSession: () =>
            Effect.succeed(
              signedIn
                ? {
                    user: { id: "signed-in-user", email: "person@example.test", name: "Person" },
                  }
                : undefined,
            ),
        }),
      ),
    );
  });
}
