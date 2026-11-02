import { Context, Schema } from "effect";
import type { Effect } from "effect";

export const RetentionSummary = Schema.Struct({
  diagnostics: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  writeIntents: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  runs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  requests: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  deliveries: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  scheduleObservations: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type RetentionSummary = typeof RetentionSummary.Type;

export class RetentionSweep extends Context.Service<RetentionSweep, RetentionSweepShape>()(
  "@lineupkeep/backend/contexts/connections/Retention/RetentionSweep",
) {}

export type RetentionSweepShape = {
  readonly run: (
    limit: number,
    at: import("effect").DateTime.Utc,
  ) => Effect.Effect<RetentionSummary, RetentionPersistenceFailed>;
};

export class RetentionPersistenceFailed extends Schema.TaggedError<
  RetentionPersistenceFailed,
  { readonly brand: unique symbol }
>()("retention.persistence_failed", {
  cause: Schema.Defect(),
}) {}
