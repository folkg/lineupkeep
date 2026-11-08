import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { ConfigProvider, Context, DateTime, Effect, Layer, Redacted, Schema } from "effect";

import { decodeUserId } from "#contexts/auth/User.ts";
import { decodeConnectionId } from "#contexts/connections/Connection.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./ConnectionEncryptionKey.ts";
import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./ConnectionsDatabaseTest.ts";
import { providerCredentials } from "./ConnectionTables.ts";

it.effect("reseals a retained envelope under the current key when it is opened", () =>
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const database = yield* ConnectionsDatabase;
    const sealed = yield* sealWithRetainedKey();
    yield* database.insert(providerCredentials).values({
      connectionId,
      userId: owner,
      provider: decodeProviderKey("yahoo"),
      generation: 1,
      envelope: sealed,
      provenAt: yield* DateTime.nowAsDate,
    });

    const opened = yield* encryption.open({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      envelope: sealed,
    });
    const stored = yield* storedEnvelope(database);

    assert.strictEqual(Redacted.value(opened), "retained-cookie-value");
    assert.notStrictEqual(stored, sealed);
    assert.strictEqual(keyVersionOf(stored), 2);
    const reopened = yield* encryption.open({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      envelope: stored,
    });
    assert.strictEqual(Redacted.value(reopened), "retained-cookie-value");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("keeps the resealed envelope when it is opened again", () =>
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const database = yield* ConnectionsDatabase;
    const sealed = yield* sealWithRetainedKey();
    yield* database.insert(providerCredentials).values({
      connectionId,
      userId: owner,
      provider: decodeProviderKey("yahoo"),
      generation: 1,
      envelope: sealed,
      provenAt: yield* DateTime.nowAsDate,
    });

    yield* encryption.open({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      envelope: sealed,
    });
    const first = yield* storedEnvelope(database);
    const opened = yield* encryption.open({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      envelope: first,
    });
    const second = yield* storedEnvelope(database);

    assert.strictEqual(Redacted.value(opened), "retained-cookie-value");
    assert.strictEqual(second, first);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("leaves a newer envelope in place when the opened envelope has been replaced", () =>
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const database = yield* ConnectionsDatabase;
    const sealed = yield* sealWithRetainedKey();
    yield* database.insert(providerCredentials).values({
      connectionId,
      userId: owner,
      provider: decodeProviderKey("yahoo"),
      generation: 1,
      envelope: sealed,
      provenAt: yield* DateTime.nowAsDate,
    });
    const newer = yield* encryption.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext: Redacted.make("newer-cookie-value"),
    });
    yield* database
      .update(providerCredentials)
      .set({ envelope: newer })
      .where(eq(providerCredentials.connectionId, connectionId));

    const opened = yield* encryption.open({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      envelope: sealed,
    });

    assert.strictEqual(Redacted.value(opened), "retained-cookie-value");
    assert.strictEqual(yield* storedEnvelope(database), newer);
  }).pipe(Effect.provide(TestLayer)),
);

function sealWithRetainedKey(): Effect.Effect<string> {
  return Effect.gen(function* () {
    const legacy = Context.get(
      yield* Effect.scoped(Layer.build(LegacyEncryptionLayer)),
      ConnectionCredentialEncryption,
    );
    return yield* legacy.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext: Redacted.make("retained-cookie-value"),
    });
  }).pipe(Effect.orDie);
}

function storedEnvelope(
  database: ConnectionsDatabase["Service"],
): Effect.Effect<string, EffectDrizzleQueryError> {
  return Effect.gen(function* () {
    const rows = yield* database
      .select({ envelope: providerCredentials.envelope })
      .from(providerCredentials)
      .where(eq(providerCredentials.connectionId, connectionId));
    const row = rows[0];
    if (row === undefined) {
      return yield* Effect.die("the stored credential disappeared");
    }
    return row.envelope;
  });
}

function keyVersionOf(envelope: string): number {
  return Schema.decodeSync(Schema.fromJsonString(EnvelopeView))(envelope).keyVersion;
}

const owner = decodeUserId("owner");
const connectionId = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");

const retainedBytes = new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345");
const currentBytes = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZ987654");

const EnvelopeView = Schema.Struct({
  version: Schema.Literal(1),
  keyVersion: Schema.Int,
  nonce: Schema.String,
  ciphertext: Schema.String,
});

const LegacyEncryptionLayer = ConnectionCredentialEncryption.forKey(
  ConnectionEncryptionKey.fromBytes({
    bytes: retainedBytes,
    keyVersion: 1,
  }),
).pipe(Layer.provide(NodeCrypto.layer));

const EncryptionScope = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    CONNECTION_ENCRYPTION_KEY: Buffer.from(currentBytes).toString("base64"),
    CONNECTION_ENCRYPTION_KEY_VERSION: "2",
    CONNECTION_ENCRYPTION_RETAINED_KEYS: `1:${Buffer.from(retainedBytes).toString("base64")}`,
  }),
);

const TestLayer = ConnectionCredentialEncryption.layer.pipe(
  Layer.provideMerge(ConnectionsDatabaseTest),
  Layer.provide(EncryptionScope),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
