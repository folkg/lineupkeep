import { SignInSessionId, SignInSessions } from "@lineupkeep/backend/auth/SignInSessions";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Effect, Schema } from "effect";

import type { SignInSessionListData } from "#contracts/auth/authContract.ts";
import {
  mapSignInSessionError,
  SignInSessionInputInvalid,
  toSignInSessionView,
} from "#server/auth/signInSessionPresentation.ts";
import { runUseCase } from "#server/backendEntry.ts";

export const listSignInSessionsServerFn = createServerFn({ method: "GET" }).handler(() =>
  runUseCase(
    getRequest(),
    "sessions.list",
    (userId, currentSessionId) =>
      SignInSessions.use((sessions) => sessions.list(userId)).pipe(
        Effect.map((listed): SignInSessionListData => ({
          sessions: listed.map((session) => toSignInSessionView(session, currentSessionId)),
        })),
      ),
    mapSignInSessionError,
  ),
);

export const endSignInSessionServerFn = createServerFn({ method: "POST" })
  .validator((raw: { readonly session: string }) =>
    Schema.decodeResult(Schema.Struct({ session: SignInSessionId }))(raw),
  )
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "sessions.end",
      (userId, currentSessionId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => SignInSessionInputInvalid.make({})),
          );
          yield* SignInSessions.use((sessions) => sessions.end(userId, [input.session]));
          const listed = yield* SignInSessions.use((sessions) => sessions.list(userId));
          return {
            sessions: listed.map((session) => toSignInSessionView(session, currentSessionId)),
          } satisfies SignInSessionListData;
        }),
      mapSignInSessionError,
    ),
  );

export const endOtherSignInSessionsServerFn = createServerFn({ method: "POST" }).handler(() =>
  runUseCase(
    getRequest(),
    "sessions.end_others",
    (userId, currentSessionId) =>
      Effect.gen(function* () {
        yield* SignInSessions.use((sessions) => sessions.endOthers(userId, currentSessionId));
        const listed = yield* SignInSessions.use((sessions) => sessions.list(userId));
        return {
          sessions: listed.map((session) => toSignInSessionView(session, currentSessionId)),
        } satisfies SignInSessionListData;
      }),
    mapSignInSessionError,
  ),
);
