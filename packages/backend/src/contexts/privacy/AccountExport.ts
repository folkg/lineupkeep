import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

export const accountExportSchemaVersion = 1;

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

export class AccountExport extends Context.Service<AccountExport, AccountExportShape>()(
  "@lineupkeep/backend/contexts/privacy/AccountExport",
) {}

export type AccountExportShape = {
  readonly exportData: (
    userId: UserId,
  ) => Effect.Effect<AccountExportDocument, AccountExportPersistenceFailed>;
};

export class AccountExportPersistenceFailed extends Schema.TaggedError<
  AccountExportPersistenceFailed,
  { readonly brand: unique symbol }
>()("account_export.persistence_failed", {
  cause: Schema.Defect(),
}) {}
