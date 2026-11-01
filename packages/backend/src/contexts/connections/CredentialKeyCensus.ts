import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { ConnectionPersistenceFailed } from "./Connection.ts";

export const CredentialKeyUsage = Schema.Struct({
  keyVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  envelopes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type CredentialKeyUsage = typeof CredentialKeyUsage.Type;

export const CredentialKeyReport = Schema.Struct({
  currentKeyVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  retainedKeyVersions: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))),
  usage: Schema.Array(CredentialKeyUsage),
  olderEnvelopes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  unreadableEnvelopes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type CredentialKeyReport = typeof CredentialKeyReport.Type;

export class CredentialKeyCensus extends Context.Service<
  CredentialKeyCensus,
  {
    readonly report: Effect.Effect<CredentialKeyReport, ConnectionPersistenceFailed>;
  }
>()("@lineupkeep/backend/contexts/connections/CredentialKeyCensus") {}
