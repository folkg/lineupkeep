import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AccountErasure } from "@lineupkeep/backend/privacy/AccountErasure";
import { AccountExport, AccountExportDocument } from "@lineupkeep/backend/privacy/AccountExport";
import { EffectString } from "@lineupkeep/collections";
import { DateTime, Duration, Effect, Layer, Schema } from "effect";
import { Array as EffectArray } from "effect";
import { Order as EffectOrder } from "effect";
import { TestClock } from "effect/testing";

import layerTools from "#runtime/ProvideLayer.ts";

import { AccountDataRepository } from "./internal/AccountDataRepository.ts";
import { ownedDataInventory } from "./internal/AccountDataTables.ts";
import { AccountErasureLive } from "./internal/AccountErasureLive.ts";
import { AccountExportLive } from "./internal/AccountExportLive.ts";
import { otherOwner, owner, seedOwnedAccount } from "./internal/OwnedAccountSeedRepository.ts";
import { PrivacyDatabaseTest } from "./internal/PrivacyDatabaseTest.ts";

function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(value: A, f: (value: A) => B): B;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined {
  return value === undefined || value === null ? undefined : f(value);
}

it.effect(
  "exports every class, round-trips through its schema, and withholds credentials explicitly",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;
      const erasure = yield* AccountErasure;

      const document = yield* exporter.exportData(owner.id);
      const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(AccountExportDocument))(
        document,
      );
      const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(AccountExportDocument))(
        encoded,
      );

      assert.deepStrictEqual(decoded, document);
      assert.deepStrictEqual(
        EffectArray.map(document.tables, (table) => table.table),
        EffectArray.map(ownedDataInventory, (entry) => entry.table),
      );
      assert.deepStrictEqual(EffectArray.map(document.tables, (table) => table.label).sort(), [
        "Account",
        "Agent access tokens",
        "Agent client registrations",
        "Agent client resources",
        "Agent grants",
        "Agent rate limits",
        "Agent refresh tokens",
        "Agent team notes",
        "Connection incidents",
        "Exports you downloaded",
        "Fantasy teams",
        "Feedback rate limits",
        "Feedback reports",
        "Hosted sign-in locks",
        "Hosted sign-in sessions",
        "Lineup deliveries",
        "Lineup requests",
        "Lineup run attempts",
        "Lineup run diagnostics",
        "Lineup runs",
        "Lineup write attempts",
        "Linked sign-in accounts",
        "Notifications",
        "Provider connections",
        "Provider sign-ins",
        "Sign-in code rate limits",
        "Sign-in codes",
        "Sign-in sessions",
        "Team run locks",
        "Transaction move claims",
        "Transaction move steps",
        "Transaction moves",
        "Transaction plans",
        "Transaction runs",
      ]);

      const summary = yield* erasure.erase(owner.id);
      const exportedClasses = EffectArray.map(
        EffectArray.filter(document.tables, (table) => table.rows.length > 0),
        (table) => table.label,
      ).sort();
      assert.deepStrictEqual(
        EffectArray.map(summary.removed, (entry) => entry.class).sort(),
        exportedClasses,
      );

      const withheld = new Map(
        EffectArray.map(document.withheld, (entry) => [
          `${entry.table}.${entry.field}`,
          entry.reason,
        ]),
      );
      for (const key of [
        "provider_credentials.envelope",
        "session.token",
        "account.access_token",
        "account.refresh_token",
        "account.id_token",
        "account.password",
        "verification.value",
        "sign_in_code_quota.key",
        "hosted_linking_sessions.ticket_hash",
        "oauth_client.client_secret",
        "oauth_client.software_statement",
        "oauth_refresh_token.token",
        "oauth_refresh_token.rotation_replay_response",
        "oauth_access_token.token",
      ]) {
        assert.isString(withheld.get(key), `${key} was not named as withheld`);
      }
      assert.isTrue(EffectArray.every([...withheld.values()], (reason) => reason.length > 0));

      const exported = encoded;
      for (const secret of [
        owner.sessionToken,
        owner.providerEnvelope,
        owner.refreshToken,
        owner.accessToken,
        owner.clientSecret,
        owner.ticketHash,
        owner.codeValue,
        "identity-token-owner",
        "password-hash-owner",
        "rotation-replay-owner",
        "software-statement-owner",
        otherOwner.sessionToken,
        otherOwner.providerEnvelope,
        otherOwner.agentNoteBody,
      ]) {
        assert.isFalse(EffectString.includes(exported, secret), `the export contains ${secret}`);
      }
    }).pipe(layerTools.provide(ExportTestLayer)),
  30_000,
);

it.effect(
  "exports only the signed-in owner's rows",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;

      const document = yield* exporter.exportData(owner.id);
      const exported = yield* Schema.encodeEffect(Schema.fromJsonString(AccountExportDocument))(
        document,
      );

      assert.isTrue(EffectString.includes(exported, owner.id));
      assert.isFalse(EffectString.includes(exported, otherOwner.id));
      for (const table of document.tables) {
        for (const row of table.rows) {
          if ("user_id" in row) {
            assert.strictEqual(row["user_id"], owner.id, `${table.table} exported a foreign row`);
          }
        }
      }
    }).pipe(layerTools.provide(ExportTestLayer)),
  30_000,
);

it.effect(
  "reports the export it holds and stops counting it after the freshness window",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;

      const yielded1 = yield* exporter.status(owner.id);
      assert.deepStrictEqual(yielded1, {
        latest: undefined,
        usable: false,
      });

      const document = yield* exporter.exportData(owner.id);
      const held = yield* exporter.status(owner.id);
      assert.isTrue(held.usable);
      assert.strictEqual(
        held.latest?.records,
        EffectArray.reduce(document.tables, 0, (total, table) => total + table.rows.length),
      );
      assert.deepStrictEqual(
        optionalArrayValue(
          optionalArrayValue(held.latest?.areas, (value) =>
            EffectArray.map(value, (area) => area.label),
          ),
          (value) => EffectArray.sort(value, EffectOrder.String),
        ),
        EffectArray.map(
          EffectArray.filter(document.tables, (table) => table.rows.length > 0),
          (table) => table.label,
        ).sort(),
      );

      yield* TestClock.adjust(Duration.hours(2));
      const stale = yield* exporter.status(owner.id);
      assert.isFalse(stale.usable);
      assert.strictEqual(
        stale.latest?.takenAt.pipe(DateTime.formatIso),
        held.latest?.takenAt.pipe(DateTime.formatIso),
      );
      assert.strictEqual(stale.latest?.records, held.latest?.records);
    }).pipe(layerTools.provide(ExportTestLayer)),
  30_000,
);

const ExportTestLayer = Layer.merge(AccountErasureLive, AccountExportLive).pipe(
  Layer.provide(AccountDataRepository.layer),
  Layer.provideMerge(PrivacyDatabaseTest),
  Layer.provideMerge(NodeCrypto.layer),
  Layer.orDie,
);
