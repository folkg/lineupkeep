import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { Array as EffectArray } from "effect";
import { Digest } from "effect/crypto";

import { signInCodeQuotaKeyFor } from "#contexts/auth/SignInCodeQuotaKey.ts";
import type { UserId } from "#contexts/auth/User.ts";
import {
  AccountErasureExportRequired,
  AccountErasurePersistenceFailed,
} from "#contexts/privacy/AccountErasure.ts";
import type { AccountErasureSummary } from "#contexts/privacy/AccountErasure.ts";
import {
  AccountExportArea,
  AccountExportPersistenceFailed,
  accountExportSchemaVersion,
  isAccountExportUsable,
} from "#contexts/privacy/AccountExport.ts";
import type {
  AccountExportDocument,
  AccountExportStatus,
} from "#contexts/privacy/AccountExport.ts";

import {
  deleteOwnerExport,
  deleteOwnedRows,
  ownedDataInventory,
  recordOwnerExport,
  selectLatestExport,
  selectOwnedRows,
  selectStoredEmail,
} from "./AccountDataTables.ts";
import type { OwnedAccount } from "./AccountDataTables.ts";
import { PrivacyDatabase } from "./PrivacyDatabase.ts";

export class AccountDataRepository extends Context.Service<
  AccountDataRepository,
  AccountDataRepositoryShape
>()("@lineupkeep/backend/contexts/privacy/internal/AccountDataRepository") {
  static readonly layer = Layer.effect(
    AccountDataRepository,
    Effect.gen(function* () {
      const database = yield* PrivacyDatabase;
      const digest = yield* Digest.Digest;

      const erase = Effect.fn("AccountDataRepository.erase")(function* (userId: UserId) {
        const outcome = yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const latest = yield* tx.execute(selectLatestExport(userId));
              const takenAt = latest.rows[0]?.["taken_at"];
              if (
                !(takenAt instanceof Date) ||
                !isAccountExportUsable(DateTime.fromDateUnsafe(takenAt), yield* DateTime.now)
              ) {
                return { refused: true } as const;
              }
              yield* tx.execute(deleteOwnerExport(userId));

              const stored = yield* tx.execute(selectStoredEmail(userId));
              const email = stored.rows[0]?.["email"];
              const identity: OwnedAccount | undefined =
                typeof email === "string"
                  ? {
                      userId,
                      email,
                      signInCodeQuotaKey: yield* signInCodeQuotaKeyFor(digest, email),
                    }
                  : undefined;
              const owner: OwnedAccount = identity ?? {
                userId,
                email: "",
                signInCodeQuotaKey: "",
              };
              const removed: Array<{ class: string; count: number }> = [];
              for (const ownedClass of ownedDataInventory) {
                if (ownedClass.needsAccountIdentity && identity === undefined) {
                  continue;
                }
                const deleted = yield* tx.execute(deleteOwnedRows(ownedClass.table, owner));
                if (deleted.rowCount > 0) {
                  removed.push({ class: ownedClass.label, count: deleted.rowCount });
                }
              }
              return { refused: false, removed } as const;
            }),
          )
          .pipe(Effect.mapError((cause) => AccountErasurePersistenceFailed.make({ cause })));

        if (outcome.refused) {
          return yield* AccountErasureExportRequired.make({});
        }
        return { removed: outcome.removed } satisfies AccountErasureSummary;
      });

      const exportData = Effect.fn("AccountDataRepository.exportData")(function* (userId: UserId) {
        const document = yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const exportedAt = yield* DateTime.now;
              const stored = yield* tx.execute(selectStoredEmail(userId));
              const email = stored.rows[0]?.["email"];
              const identity: OwnedAccount | undefined =
                typeof email === "string"
                  ? {
                      userId,
                      email,
                      signInCodeQuotaKey: yield* signInCodeQuotaKeyFor(digest, email),
                    }
                  : undefined;
              const account: OwnedAccount = identity ?? {
                userId,
                email: "",
                signInCodeQuotaKey: "",
              };
              const tables: Array<AccountExportDocument["tables"][number]> = [];
              const withheld: Array<AccountExportDocument["withheld"][number]> = [];
              for (const ownedClass of ownedDataInventory) {
                const rows =
                  ownedClass.needsAccountIdentity && identity === undefined
                    ? []
                    : (yield* tx.execute(selectOwnedRows(ownedClass.table, account))).rows;
                const hiddenFields = new Set(
                  EffectArray.map(ownedClass.withheld, (entry) => entry.field),
                );
                tables.push({
                  table: ownedClass.table,
                  label: ownedClass.label,
                  rows: EffectArray.map(rows, (row) => exportedRow(row, hiddenFields)),
                });
                if (rows.length > 0) {
                  for (const entry of ownedClass.withheld) {
                    withheld.push({
                      table: ownedClass.table,
                      field: entry.field,
                      reason: entry.reason,
                    });
                  }
                }
              }
              yield* tx.execute(
                recordOwnerExport(
                  userId,
                  DateTime.toDateUtc(exportedAt),
                  EffectArray.map(
                    EffectArray.filter(tables, (table) => table.rows.length > 0),
                    (table) => ({ label: table.label, records: table.rows.length }),
                  ),
                ),
              );
              return {
                schemaVersion: accountExportSchemaVersion,
                exportedAt: DateTime.formatIso(exportedAt),
                tables,
                withheld,
              } satisfies AccountExportDocument;
            }),
          )
          .pipe(Effect.mapError((cause) => AccountExportPersistenceFailed.make({ cause })));
        return document;
      });

      const status = Effect.fn("AccountDataRepository.status")(function* (userId: UserId) {
        const latest = yield* database
          .execute(selectLatestExport(userId))
          .pipe(Effect.mapError((cause) => AccountExportPersistenceFailed.make({ cause })));
        const row = latest.rows[0];
        if (row === undefined) {
          return { latest: undefined, usable: false } satisfies AccountExportStatus;
        }
        const takenAt = row["taken_at"];
        if (!(takenAt instanceof Date)) {
          return yield* AccountExportPersistenceFailed.make({
            cause: new Error("The export record has no timestamp."),
          });
        }
        const areas = yield* Schema.decodeUnknownEffect(Schema.Array(AccountExportArea))(
          row["contents"],
        ).pipe(Effect.mapError((cause) => AccountExportPersistenceFailed.make({ cause })));
        const record = DateTime.fromDateUnsafe(takenAt);
        return {
          latest: {
            takenAt: record,
            records: EffectArray.reduce(areas, 0, (total, area) => total + area.records),
            areas,
          },
          usable: isAccountExportUsable(record, yield* DateTime.now),
        } satisfies AccountExportStatus;
      });

      return { erase, exportData, status } as const;
    }),
  );
}

function exportedRow(
  row: Record<string, unknown>,
  hiddenFields: ReadonlySet<string>,
): Record<string, unknown> {
  const exported: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(row)) {
    if (hiddenFields.has(field)) {
      continue;
    }
    exported[field] = jsonValue(value);
  }
  return exported;
}

function jsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (EffectArray.isArray(value)) {
    return EffectArray.map(value, jsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      EffectArray.map(Object.entries(value), ([field, entry]) => [field, jsonValue(entry)]),
    );
  }
  return value;
}

type AccountDataRepositoryShape = {
  readonly erase: (
    userId: UserId,
  ) => Effect.Effect<
    AccountErasureSummary,
    AccountErasureExportRequired | AccountErasurePersistenceFailed
  >;
  readonly exportData: (
    userId: UserId,
  ) => Effect.Effect<AccountExportDocument, AccountExportPersistenceFailed>;
  readonly status: (
    userId: UserId,
  ) => Effect.Effect<AccountExportStatus, AccountExportPersistenceFailed>;
};
