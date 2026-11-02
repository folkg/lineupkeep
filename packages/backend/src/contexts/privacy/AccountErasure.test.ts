import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { signInCodeQuotaKeyFor } from "@lineupkeep/backend/auth/SignInCodeQuotaKey";
import { Crypto, Duration, Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";

import { AccountErasure } from "./AccountErasure.ts";
import { AccountExport } from "./AccountExport.ts";
import { AccountDataRepository } from "./internal/AccountDataRepository.ts";
import {
  blockAccountErasureStatements,
  catalogOwnerColumnsQuery,
  catalogTablesQuery,
  countOwnedRows,
  countRowsCarryingOwnerColumn,
  ownedDataInventory,
} from "./internal/AccountDataTables.ts";
import type { OwnedAccount } from "./internal/AccountDataTables.ts";
import { AccountErasureLive } from "./internal/AccountErasureLive.ts";
import { AccountExportLive } from "./internal/AccountExportLive.ts";
import { otherOwner, owner, seedOwnedAccount } from "./internal/OwnedAccountSeedRepository.ts";
import { PrivacyDatabase } from "./internal/PrivacyDatabase.ts";
import { PrivacyDatabaseTest } from "./internal/PrivacyDatabaseTest.ts";

it.effect(
  "names every table in the catalog that carries an owner",
  () =>
    Effect.gen(function* () {
      const database = yield* PrivacyDatabase;
      const catalog = yield* database.execute(catalogTablesQuery());
      const columns = yield* database.execute(catalogOwnerColumnsQuery());
      const catalogTables = new Set(catalog.rows.map((row) => String(row["table_name"])));
      const inventoryTables = new Set(ownedDataInventory.map((entry) => entry.table));

      assert.isAbove(columns.rows.length, 0, "the catalog query found no owner columns");
      for (const row of columns.rows) {
        assert.isTrue(
          inventoryTables.has(String(row["table_name"])),
          `${String(row["table_name"])} carries ${String(row["column_name"])} but the erasure inventory does not name it`,
        );
      }
      for (const entry of ownedDataInventory) {
        assert.isTrue(
          catalogTables.has(entry.table),
          `the erasure inventory names ${entry.table}, which is not a table in the catalog`,
        );
      }
    }).pipe(Effect.provide(ErasureTestLayer)),
  30_000,
);

it.effect(
  "refuses an erasure with no export and deletes nothing",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const erasure = yield* AccountErasure;
      const account = yield* ownedAccount(owner.id, owner.email);
      const before = yield* countClasses(account);

      const refused = yield* Effect.flip(erasure.erase(owner.id));

      assert.strictEqual(refused._tag, "account_erasure.export_required");
      assert.deepStrictEqual(yield* countClasses(account), before);
    }).pipe(Effect.provide(ErasureTestLayer)),
  30_000,
);

it.effect(
  "refuses an erasure whose export is older than the freshness window",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;
      const erasure = yield* AccountErasure;
      const account = yield* ownedAccount(owner.id, owner.email);

      yield* exporter.exportData(owner.id);
      const before = yield* countClasses(account);
      yield* TestClock.adjust(Duration.hours(2));
      const refused = yield* Effect.flip(erasure.erase(owner.id));

      assert.strictEqual(refused._tag, "account_erasure.export_required");
      assert.deepStrictEqual(yield* countClasses(account), before);
    }).pipe(Effect.provide(ErasureTestLayer)),
  30_000,
);

it.effect(
  "erases with a fresh export and consumes it",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;
      const erasure = yield* AccountErasure;
      const account = yield* ownedAccount(owner.id, owner.email);

      yield* exporter.exportData(owner.id);
      const summary = yield* erasure.erase(owner.id);

      assert.isAbove(
        summary.removed.reduce((total, entry) => total + entry.count, 0),
        0,
      );
      assert.deepStrictEqual(
        [...(yield* countClasses(account))].filter(([, count]) => count > 0),
        [],
      );
      const refused = yield* Effect.flip(erasure.erase(owner.id));
      assert.strictEqual(refused._tag, "account_erasure.export_required");
    }).pipe(Effect.provide(ErasureTestLayer)),
  30_000,
);

it.effect(
  "refuses a second erasure with the same export until a fresh export is taken",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;
      const erasure = yield* AccountErasure;

      yield* exporter.exportData(owner.id);
      yield* erasure.erase(owner.id);

      const refused = yield* Effect.flip(erasure.erase(owner.id));
      assert.strictEqual(refused._tag, "account_erasure.export_required");

      yield* exporter.exportData(owner.id);
      const second = yield* erasure.erase(owner.id);
      assert.deepStrictEqual(second, { removed: [] });
    }).pipe(Effect.provide(ErasureTestLayer)),
  30_000,
);

it.effect(
  "removes every class and leaves no row carrying the owner",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;
      const database = yield* PrivacyDatabase;
      const erasure = yield* AccountErasure;
      const account = yield* ownedAccount(owner.id, owner.email);
      const other = yield* ownedAccount(otherOwner.id, otherOwner.email);
      const beforeOwner = yield* countClasses(account);
      const beforeOther = yield* countClasses(other);

      yield* exporter.exportData(owner.id);
      const summary = yield* erasure.erase(owner.id);

      const catalogColumns = yield* database.execute(catalogOwnerColumnsQuery());
      for (const row of catalogColumns.rows) {
        const remaining = yield* database.execute(
          countRowsCarryingOwnerColumn(
            String(row["table_name"]),
            String(row["column_name"]),
            owner.id,
          ),
        );
        assert.strictEqual(
          remaining.rows[0]?.["count"],
          0,
          `${String(row["table_name"])}.${String(row["column_name"])} still carries the owner`,
        );
      }

      const afterOwner = yield* countClasses(account);
      for (const [table, count] of afterOwner) {
        assert.strictEqual(count, 0, `${table} still holds an owner row`);
      }

      const afterOther = yield* countClasses(other);
      assert.deepStrictEqual(afterOther, beforeOther);

      const expectedClasses = [...beforeOwner]
        .filter(([, count]) => count > 0)
        .map(([table]) => table)
        .sort();
      assert.deepStrictEqual(summary.removed.map((entry) => entry.class).sort(), expectedClasses);
      assert.isAbove(
        summary.removed.reduce((total, entry) => total + entry.count, 0),
        0,
      );
    }).pipe(Effect.provide(ErasureTestLayer)),
  30_000,
);

it.effect(
  "reports nothing removed when the account is already erased",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;
      const erasure = yield* AccountErasure;

      yield* exporter.exportData(owner.id);
      yield* erasure.erase(owner.id);
      yield* exporter.exportData(owner.id);
      const second = yield* erasure.erase(owner.id);

      assert.deepStrictEqual(second, { removed: [] });
    }).pipe(Effect.provide(ErasureTestLayer)),
  30_000,
);

it.effect(
  "leaves the account exactly as it was when a delete fails partway through",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;
      const database = yield* PrivacyDatabase;
      const erasure = yield* AccountErasure;
      const account = yield* ownedAccount(owner.id, owner.email);
      yield* exporter.exportData(owner.id);
      const before = yield* countClasses(account);

      for (const statement of blockAccountErasureStatements) {
        yield* database.execute(statement);
      }

      const exit = yield* Effect.exit(erasure.erase(owner.id));
      assert.isTrue(Exit.isFailure(exit));

      const after = yield* countClasses(account);
      assert.deepStrictEqual(after, before);
      const storedUser = yield* database.execute(
        countRowsCarryingOwnerColumn("user", "id", owner.id),
      );
      assert.strictEqual(storedUser.rows[0]?.["count"], 1);
    }).pipe(Effect.provide(ErasureTestLayer)),
  30_000,
);

const ownedAccount = (
  userId: typeof owner.id,
  email: string,
): Effect.Effect<OwnedAccount, never, Crypto.Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const signInCodeQuotaKey = yield* signInCodeQuotaKeyFor(crypto, email).pipe(Effect.orDie);
    return { userId, email, signInCodeQuotaKey } satisfies OwnedAccount;
  });

const countClasses = (
  account: OwnedAccount,
): Effect.Effect<ReadonlyMap<string, number>, never, PrivacyDatabase> =>
  Effect.gen(function* () {
    const database = yield* PrivacyDatabase;
    const counts = new Map<string, number>();
    for (const ownedClass of ownedDataInventory) {
      const result = yield* database
        .execute(countOwnedRows(ownedClass.table, account))
        .pipe(Effect.orDie);
      counts.set(ownedClass.label, Number(result.rows[0]?.["count"]));
    }
    return counts;
  });

const ErasureTestLayer = Layer.merge(AccountExportLive, AccountErasureLive).pipe(
  Layer.provide(AccountDataRepository.layer),
  Layer.provideMerge(PrivacyDatabaseTest),
  Layer.provideMerge(NodeCrypto.layer),
  Layer.orDie,
);
