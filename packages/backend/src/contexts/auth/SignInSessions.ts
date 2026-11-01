import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { UserId } from "./User.ts";

export const SignInSessionId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  Schema.brand("SignInSessionId"),
);
export type SignInSessionId = typeof SignInSessionId.Type;

export const SignInSessionSummary = Schema.Struct({
  id: SignInSessionId,
  device: Schema.NonEmptyString,
  startedAt: Schema.DateTimeUtc,
  lastUsedAt: Schema.DateTimeUtc,
});
export type SignInSessionSummary = typeof SignInSessionSummary.Type;

export class SignInSessions extends Context.Service<SignInSessions, SignInSessionsShape>()(
  "@lineupkeep/backend/contexts/auth/SignInSessions",
) {}

export type SignInSessionsShape = {
  readonly list: (
    userId: UserId,
  ) => Effect.Effect<ReadonlyArray<SignInSessionSummary>, SignInSessionPersistenceFailed>;

  readonly end: (
    userId: UserId,
    sessionIds: ReadonlyArray<SignInSessionId>,
  ) => Effect.Effect<ReadonlyArray<SignInSessionId>, SignInSessionPersistenceFailed>;

  readonly endOthers: (
    userId: UserId,
    keptSessionId: SignInSessionId,
  ) => Effect.Effect<ReadonlyArray<SignInSessionId>, SignInSessionPersistenceFailed>;
};

export class SignInSessionPersistenceFailed extends Schema.TaggedError<
  SignInSessionPersistenceFailed,
  { readonly brand: unique symbol }
>()("session.persistence_failed", {
  cause: Schema.Defect(),
}) {}
