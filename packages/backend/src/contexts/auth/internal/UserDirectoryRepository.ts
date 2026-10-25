import { Array, Effect, Layer, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import {
  UserDirectory,
  UserDirectoryUnavailable,
  UserEmail,
} from "#contexts/auth/UserDirectory.ts";
import { anyOf } from "#database/dbUtilities.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { user } from "./AuthTables.ts";

export const UserDirectoryLive = Layer.effect(
  UserDirectory,
  Effect.gen(function* () {
    const database = yield* AuthDatabase;

    const emailsFor = Effect.fn("UserDirectory.emailsFor")(function* (
      userIds: ReadonlyArray<UserId>,
    ) {
      const ids = [...new Set(userIds)];
      if (!Array.isArrayNonEmpty(ids)) {
        return [];
      }
      const rows = yield* Effect.tryPromise({
        try: () =>
          database
            .select({ userId: user.id, email: user.email })
            .from(user)
            .where(anyOf(user.id, ids)),
        catch: (cause) => UserDirectoryUnavailable.make({ cause }),
      });
      return yield* Effect.forEach(rows, (row) =>
        Schema.decodeEffect(UserEmail)(row).pipe(
          Effect.mapError((cause) => UserDirectoryUnavailable.make({ cause })),
        ),
      );
    });

    return UserDirectory.of({ emailsFor });
  }),
);
