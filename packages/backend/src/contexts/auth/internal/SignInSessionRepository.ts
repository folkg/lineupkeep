import { and, desc, eq, gt, ne } from "drizzle-orm";
import { Array, Context, DateTime, Effect, Layer, Schema } from "effect";

import { SignInSessionPersistenceFailed, SignInSessionId } from "#contexts/auth/SignInSessions.ts";
import type { UserId } from "#contexts/auth/User.ts";
import { anyOf } from "#database/dbUtilities.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { session } from "./AuthTables.ts";

export type SignInSessionRecord = typeof SignInSessionRow.Type;

const SignInSessionRow = Schema.Struct({
  id: SignInSessionId,
  userAgent: Schema.NullOr(Schema.String),
  startedAt: Schema.DateTimeUtcFromDate,
  lastUsedAt: Schema.DateTimeUtcFromDate,
});

export class SignInSessionRepository extends Context.Service<SignInSessionRepository>()(
  "@lineupkeep/backend/contexts/auth/internal/SignInSessionRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* AuthDatabase;

      const query = <A>(
        run: () => Promise<A>,
      ): Effect.Effect<A, SignInSessionPersistenceFailed, never> =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => SignInSessionPersistenceFailed.make({ cause }),
        });

      const decodeIds = (
        ids: ReadonlyArray<string>,
      ): Effect.Effect<ReadonlyArray<SignInSessionId>, SignInSessionPersistenceFailed> =>
        Schema.decodeEffect(Schema.Array(SignInSessionId))(ids).pipe(
          Effect.mapError((cause) => SignInSessionPersistenceFailed.make({ cause })),
        );

      const list = Effect.fn("SignInSessionRepository.list")(function* (userId: UserId) {
        const now = DateTime.toDateUtc(yield* DateTime.now);
        const rows = yield* query(() =>
          database
            .select({
              id: session.id,
              userAgent: session.userAgent,
              startedAt: session.createdAt,
              lastUsedAt: session.updatedAt,
            })
            .from(session)
            .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
            .orderBy(desc(session.updatedAt), desc(session.createdAt)),
        );
        return yield* Schema.decodeEffect(Schema.Array(SignInSessionRow))(rows).pipe(
          Effect.mapError((cause) => SignInSessionPersistenceFailed.make({ cause })),
        );
      });

      const end = Effect.fn("SignInSessionRepository.end")(function* (
        userId: UserId,
        sessionIds: ReadonlyArray<SignInSessionId>,
      ) {
        if (!Array.isReadonlyArrayNonEmpty(sessionIds)) {
          return [];
        }
        const ended = yield* query(() =>
          database
            .delete(session)
            .where(and(eq(session.userId, userId), anyOf(session.id, sessionIds)))
            .returning({ id: session.id }),
        );
        return yield* decodeIds(ended.map((row) => row.id));
      });

      const endOthers = Effect.fn("SignInSessionRepository.endOthers")(function* (
        userId: UserId,
        keptSessionId: SignInSessionId,
      ) {
        const ended = yield* query(() =>
          database
            .delete(session)
            .where(and(eq(session.userId, userId), ne(session.id, keptSessionId)))
            .returning({ id: session.id }),
        );
        return yield* decodeIds(ended.map((row) => row.id));
      });

      return { list, end, endOthers } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
