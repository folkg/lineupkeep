import { Context, Schema } from "effect";
import type { Effect } from "effect";

const AccountRetentionSummary = Schema.Struct({
  sessions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  verifications: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  consents: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  registrations: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
type AccountRetentionSummary = typeof AccountRetentionSummary.Type;

export class AccountRetention extends Context.Service<AccountRetention, AccountRetentionShape>()(
  "@lineupkeep/backend/contexts/auth/AccountRetention",
) {}

export type AccountRetentionShape = {
  readonly run: (
    limit: number,
    at: import("effect").DateTime.Utc,
  ) => Effect.Effect<AccountRetentionSummary, AccountRetentionPersistenceFailed>;
};

export class AccountRetentionPersistenceFailed extends Schema.TaggedError<
  AccountRetentionPersistenceFailed,
  { readonly brand: unique symbol }
>()("account_retention.persistence_failed", {
  cause: Schema.Defect(),
}) {}
