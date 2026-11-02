import { Context, Crypto, DateTime, Effect, Layer } from "effect";

import { signInCodeQuotaKeyFor } from "#contexts/auth/SignInCodeQuotaKey.ts";
import type { UserId } from "#contexts/auth/User.ts";
import { AccountErasurePersistenceFailed } from "#contexts/privacy/AccountErasure.ts";
import type { AccountErasureSummary } from "#contexts/privacy/AccountErasure.ts";
import {
  AccountExportPersistenceFailed,
  accountExportSchemaVersion,
} from "#contexts/privacy/AccountExport.ts";
import type { AccountExportDocument } from "#contexts/privacy/AccountExport.ts";

import {
  deleteOwnedRows,
  ownedDataInventory,
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
      const crypto = yield* Crypto.Crypto;

      const erase = Effect.fn("AccountDataRepository.erase")(function* (userId: UserId) {
        const removed = yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const stored = yield* tx.execute(selectStoredEmail(userId));
              const email = stored.rows[0]?.["email"];
              const account: OwnedAccount | undefined =
                typeof email === "string"
                  ? {
                      userId,
                      email,
                      signInCodeQuotaKey: yield* signInCodeQuotaKeyFor(crypto, email),
                    }
                  : undefined;
              const owner: OwnedAccount = account ?? {
                userId,
                email: "",
                signInCodeQuotaKey: "",
              };
              const removedClasses: Array<{ class: string; count: number }> = [];
              for (const ownedClass of ownedDataInventory) {
                if (ownedClass.needsAccountIdentity && account === undefined) {
                  continue;
                }
                const deleted = yield* tx.execute(deleteOwnedRows(ownedClass.table, owner));
                if (deleted.rowCount > 0) {
                  removedClasses.push({ class: ownedClass.label, count: deleted.rowCount });
                }
              }
              return removedClasses;
            }),
          )
          .pipe(Effect.mapError((cause) => AccountErasurePersistenceFailed.make({ cause })));
        return { removed } satisfies AccountErasureSummary;
      });

      const exportData = Effect.fn("AccountDataRepository.exportData")(function* (userId: UserId) {
        const exportedAt = DateTime.formatIso(yield* DateTime.now);
        const document = yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const stored = yield* tx.execute(selectStoredEmail(userId));
              const email = stored.rows[0]?.["email"];
              if (typeof email !== "string") {
                return yield* AccountExportPersistenceFailed.make({
                  cause: new Error("The account has no stored identity."),
                });
              }
              const account: OwnedAccount = {
                userId,
                email,
                signInCodeQuotaKey: yield* signInCodeQuotaKeyFor(crypto, email),
              };
              const tables: Array<AccountExportDocument["tables"][number]> = [];
              const withheld: Array<AccountExportDocument["withheld"][number]> = [];
              for (const ownedClass of ownedDataInventory) {
                const selected = yield* tx.execute(selectOwnedRows(ownedClass.table, account));
                const hiddenFields = new Set(ownedClass.withheld.map((entry) => entry.field));
                tables.push({
                  table: ownedClass.table,
                  label: ownedClass.label,
                  rows: selected.rows.map((row) => exportedRow(row, hiddenFields)),
                });
                if (selected.rows.length > 0) {
                  for (const entry of ownedClass.withheld) {
                    withheld.push({
                      table: ownedClass.table,
                      field: entry.field,
                      reason: entry.reason,
                    });
                  }
                }
              }
              return {
                schemaVersion: accountExportSchemaVersion,
                exportedAt,
                tables,
                withheld,
              } satisfies AccountExportDocument;
            }),
          )
          .pipe(Effect.mapError((cause) => AccountExportPersistenceFailed.make({ cause })));
        return document;
      });

      return { erase, exportData } as const;
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
  if (Array.isArray(value)) {
    return value.map(jsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([field, entry]) => [field, jsonValue(entry)]),
    );
  }
  return value;
}

type AccountDataRepositoryShape = {
  readonly erase: (
    userId: UserId,
  ) => Effect.Effect<AccountErasureSummary, AccountErasurePersistenceFailed>;
  readonly exportData: (
    userId: UserId,
  ) => Effect.Effect<AccountExportDocument, AccountExportPersistenceFailed>;
};
