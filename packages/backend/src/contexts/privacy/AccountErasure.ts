import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

export const AccountErasureSummary = Schema.Struct({
  removed: Schema.Array(
    Schema.Struct({
      class: Schema.NonEmptyString,
      count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
});
export type AccountErasureSummary = typeof AccountErasureSummary.Type;

export class AccountErasure extends Context.Service<AccountErasure, AccountErasureShape>()(
  "@lineupkeep/backend/contexts/privacy/AccountErasure",
) {}

export type AccountErasureShape = {
  readonly erase: (
    userId: UserId,
  ) => Effect.Effect<AccountErasureSummary, AccountErasurePersistenceFailed>;
};

export class AccountErasurePersistenceFailed extends Schema.TaggedError<
  AccountErasurePersistenceFailed,
  { readonly brand: unique symbol }
>()("account_erasure.persistence_failed", {
  cause: Schema.Defect(),
}) {}
