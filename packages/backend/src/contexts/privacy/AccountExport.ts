import { Context, DateTime, Duration, Schema } from "effect";
import type { Effect } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

export const accountExportSchemaVersion = 1;

export const accountExportFreshnessWindow = Duration.hours(1);

export const AccountExportArea = Schema.Struct({
  label: Schema.NonEmptyString,
  records: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type AccountExportArea = typeof AccountExportArea.Type;

const AccountExportTable = Schema.Struct({
  table: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  rows: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
});

const AccountExportWithheldField = Schema.Struct({
  table: Schema.NonEmptyString,
  field: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
});

export const AccountExportDocument = Schema.Struct({
  schemaVersion: Schema.Literal(accountExportSchemaVersion),
  exportedAt: Schema.NonEmptyString,
  tables: Schema.Array(AccountExportTable),
  withheld: Schema.Array(AccountExportWithheldField),
});
export type AccountExportDocument = typeof AccountExportDocument.Type;

type AccountExportRecord = {
  readonly takenAt: DateTime.Utc;
  readonly records: number;
  readonly areas: ReadonlyArray<AccountExportArea>;
};

export type AccountExportStatus = {
  readonly latest: AccountExportRecord | undefined;
  readonly usable: boolean;
};

export class AccountExport extends Context.Service<AccountExport, AccountExportShape>()(
  "@lineupkeep/backend/contexts/privacy/AccountExport",
) {}

export type AccountExportShape = {
  readonly exportData: (
    userId: UserId,
  ) => Effect.Effect<AccountExportDocument, AccountExportPersistenceFailed>;
  readonly status: (
    userId: UserId,
  ) => Effect.Effect<AccountExportStatus, AccountExportPersistenceFailed>;
};

export function isAccountExportUsable(takenAt: DateTime.Utc, now: DateTime.Utc): boolean {
  const age = DateTime.toEpochMillis(now) - DateTime.toEpochMillis(takenAt);
  return age >= 0 && age <= Duration.toMillis(accountExportFreshnessWindow);
}

export class AccountExportPersistenceFailed extends Schema.TaggedError<
  AccountExportPersistenceFailed,
  { readonly brand: unique symbol }
>()("account_export.persistence_failed", {
  cause: Schema.Defect(),
}) {}
