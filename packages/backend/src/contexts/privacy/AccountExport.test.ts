import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { AccountErasure } from "@lineupkeep/backend/privacy/AccountErasure";
import { AccountExport, AccountExportDocument } from "@lineupkeep/backend/privacy/AccountExport";
import { DateTime, Duration, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import { AccountDataRepository } from "./internal/AccountDataRepository.ts";
import { ownedDataInventory } from "./internal/AccountDataTables.ts";
import { AccountErasureLive } from "./internal/AccountErasureLive.ts";
import { AccountExportLive } from "./internal/AccountExportLive.ts";
import { otherOwner, owner, seedOwnedAccount } from "./internal/OwnedAccountSeedRepository.ts";
import { PrivacyDatabaseTest } from "./internal/PrivacyDatabaseTest.ts";

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
        document.tables.map((table) => table.table),
        ownedDataInventory.map((entry) => entry.table),
      );
      assert.deepStrictEqual(document.tables.map((table) => table.label).sort(), [
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
        "Transaction proposal sets",
        "Transaction proposal steps",
        "Transaction proposals",
      ]);

      const summary = yield* erasure.erase(owner.id);
      const exportedClasses = document.tables
        .filter((table) => table.rows.length > 0)
        .map((table) => table.label)
        .sort();
      assert.deepStrictEqual(summary.removed.map((entry) => entry.class).sort(), exportedClasses);

      const withheld = new Map(
        document.withheld.map((entry) => [`${entry.table}.${entry.field}`, entry.reason]),
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
      assert.isTrue([...withheld.values()].every((reason) => reason.length > 0));

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
        assert.isFalse(exported.includes(secret), `the export contains ${secret}`);
      }
    }).pipe(Effect.provide(ExportTestLayer)),
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

      assert.isTrue(exported.includes(owner.id));
      assert.isFalse(exported.includes(otherOwner.id));
      for (const table of document.tables) {
        for (const row of table.rows) {
          if ("user_id" in row) {
            assert.strictEqual(row["user_id"], owner.id, `${table.table} exported a foreign row`);
          }
        }
      }
    }).pipe(Effect.provide(ExportTestLayer)),
  30_000,
);

it.effect(
  "reports the export it holds and stops counting it after the freshness window",
  () =>
    Effect.gen(function* () {
      yield* seedOwnedAccount;
      const exporter = yield* AccountExport;

      assert.deepStrictEqual(yield* exporter.status(owner.id), {
        latest: undefined,
        usable: false,
      });

      const document = yield* exporter.exportData(owner.id);
      const held = yield* exporter.status(owner.id);
      assert.isTrue(held.usable);
      assert.strictEqual(
        held.latest?.records,
        document.tables.reduce((total, table) => total + table.rows.length, 0),
      );
      assert.deepStrictEqual(
        held.latest?.areas.map((area) => area.label).sort(),
        document.tables
          .filter((table) => table.rows.length > 0)
          .map((table) => table.label)
          .sort(),
      );

      yield* TestClock.adjust(Duration.hours(2));
      const stale = yield* exporter.status(owner.id);
      assert.isFalse(stale.usable);
      assert.strictEqual(
        stale.latest?.takenAt.pipe(DateTime.formatIso),
        held.latest?.takenAt.pipe(DateTime.formatIso),
      );
      assert.strictEqual(stale.latest?.records, held.latest?.records);
    }).pipe(Effect.provide(ExportTestLayer)),
  30_000,
);

const ExportTestLayer = Layer.merge(AccountErasureLive, AccountExportLive).pipe(
  Layer.provide(AccountDataRepository.layer),
  Layer.provideMerge(PrivacyDatabaseTest),
  Layer.provideMerge(NodeCrypto.layer),
  Layer.orDie,
);
