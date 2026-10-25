import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { UserId } from "./User.ts";

export class UserDirectory extends Context.Service<UserDirectory, UserDirectoryShape>()(
  "@lineupkeep/backend/contexts/auth/UserDirectory",
) {}

export type UserDirectoryShape = {
  readonly emailsFor: (
    userIds: ReadonlyArray<UserId>,
  ) => Effect.Effect<ReadonlyArray<UserEmail>, UserDirectoryUnavailable>;
};

export const UserEmail = Schema.Struct({
  userId: Schema.String,
  email: Schema.String.pipe(Schema.check(Schema.isMinLength(3), Schema.isMaxLength(320))),
});
export type UserEmail = typeof UserEmail.Type;

export class UserDirectoryUnavailable extends Schema.TaggedError<
  UserDirectoryUnavailable,
  { readonly brand: unique symbol }
>()("UserDirectoryUnavailable", {
  cause: Schema.Defect(),
}) {}
