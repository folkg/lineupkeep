import { Context, Schema } from "effect";
import type { Effect } from "effect";

import { CredentialKeyReport } from "./CredentialKeyCensus.ts";
import { RetentionSummary } from "./Retention.ts";

export const AutomationSummary = Schema.Struct({
  pausesExpired: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  eligibleTeams: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  scheduledRuns: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  delivered: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  pending: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  approvedDue: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  approvedIncluded: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  approvedWaiting: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  approvedRefused: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  approvedInProgress: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  retention: RetentionSummary,
  credentialKeys: CredentialKeyReport,
});
export type AutomationSummary = typeof AutomationSummary.Type;

export class Automation extends Context.Service<Automation, AutomationShape>()(
  "@lineupkeep/backend/contexts/connections/Automation",
) {}

export type AutomationShape = {
  readonly run: (limit: number) => Effect.Effect<AutomationSummary, AutomationFailed>;
};

export class AutomationFailed extends Schema.TaggedError<
  AutomationFailed,
  { readonly brand: unique symbol }
>()("automation.failed", {
  cause: Schema.Defect(),
}) {}
