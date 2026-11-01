import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { Context, Effect, Layer, Redacted } from "effect";

import { decodeUserId } from "#contexts/auth/User.ts";
import { decodeConnectionId } from "#contexts/connections/Connection.ts";
import { CredentialKeyCensus } from "#contexts/connections/CredentialKeyCensus.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { ConnectionCredentialRepository } from "./ConnectionCredentialRepository.ts";
import { ConnectionEncryptionKey } from "./ConnectionEncryptionKey.ts";
import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./ConnectionsDatabaseTest.ts";
import { providerCredentials } from "./ConnectionTables.ts";
import { CredentialKeyCensusLive } from "./CredentialKeyCensusLive.ts";

it.effect("counts stored envelopes by key version", () =>
  Effect.gen(function* () {
    const census = yield* CredentialKeyCensus;
    const database = yield* ConnectionsDatabase;
    yield* database
      .insert(providerCredentials)
      .values([
        yield* credential(1, firstConnection),
        yield* credential(2, secondConnection),
        yield* credential(2, thirdConnection),
      ]);

    const report = yield* census.report;

    assert.strictEqual(report.currentKeyVersion, 2);
    assert.deepStrictEqual(report.retainedKeyVersions, [1]);
    assert.deepStrictEqual(report.usage, [
      { keyVersion: 1, envelopes: 1 },
      { keyVersion: 2, envelopes: 2 },
    ]);
    assert.strictEqual(report.olderEnvelopes, 1);
    assert.strictEqual(report.unreadableEnvelopes, 0);
  }).pipe(Effect.provide(CensusTestLayer)),
);

it.effect("separates readable older versions from versions the ring no longer holds", () =>
  Effect.gen(function* () {
    const census = yield* CredentialKeyCensus;
    const database = yield* ConnectionsDatabase;
    yield* database
      .insert(providerCredentials)
      .values([yield* credential(1, firstConnection), yield* credential(7, secondConnection)]);

    const report = yield* census.report;

    assert.deepStrictEqual(report.usage, [
      { keyVersion: 1, envelopes: 1 },
      { keyVersion: 7, envelopes: 1 },
    ]);
    assert.strictEqual(report.olderEnvelopes, 2);
    assert.strictEqual(report.unreadableEnvelopes, 1);
  }).pipe(Effect.provide(CensusTestLayer)),
);

it.effect("reports an empty census when no credentials are stored", () =>
  Effect.gen(function* () {
    const census = yield* CredentialKeyCensus;

    const report = yield* census.report;

    assert.deepStrictEqual(report.usage, []);
    assert.strictEqual(report.olderEnvelopes, 0);
    assert.strictEqual(report.unreadableEnvelopes, 0);
  }).pipe(Effect.provide(CensusTestLayer)),
);

function credential(
  keyVersion: number,
  connectionId: ReturnType<typeof decodeConnectionId>,
): Effect.Effect<{
  connectionId: ReturnType<typeof decodeConnectionId>;
  userId: ReturnType<typeof decodeUserId>;
  provider: ReturnType<typeof decodeProviderKey>;
  generation: number;
  envelope: string;
}> {
  return Effect.gen(function* () {
    const envelope = yield* seal(keyVersion);
    return {
      connectionId,
      userId: owner,
      provider: decodeProviderKey("yahoo"),
      generation: 1,
      envelope,
    };
  });
}

function seal(keyVersion: number): Effect.Effect<string> {
  return Effect.gen(function* () {
    const encryption = Context.get(
      yield* Effect.scoped(
        Layer.build(
          ConnectionCredentialEncryption.forKey(
            ConnectionEncryptionKey.fromBytes({
              bytes: keyVersion === 2 ? currentBytes : retainedBytes,
              keyVersion,
            }),
          ).pipe(Layer.provide(NodeCrypto.layer)),
        ),
      ),
      ConnectionCredentialEncryption,
    );
    return yield* encryption.encrypt({
      userId: owner,
      connectionId: firstConnection,
      provider: decodeProviderKey("yahoo"),
      plaintext: Redacted.make("canary-cookie-value"),
    });
  }).pipe(Effect.orDie);
}

const owner = decodeUserId("owner");
const firstConnection = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");
const secondConnection = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a3");
const thirdConnection = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a4");

const retainedBytes = new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345");
const currentBytes = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZ987654");

const RotatedEncryptionLayer = ConnectionCredentialEncryption.forKeyring({
  current: { bytes: currentBytes, keyVersion: 2 },
  retained: [{ bytes: retainedBytes, keyVersion: 1 }],
}).pipe(Layer.provide(NodeCrypto.layer));

const DatabaseLayer = ConnectionsDatabaseTest;
const CredentialRepositoryLayer = ConnectionCredentialRepository.layer.pipe(
  Layer.provide(DatabaseLayer),
);
const CensusLayer = CredentialKeyCensusLive.pipe(
  Layer.provide(CredentialRepositoryLayer),
  Layer.provide(RotatedEncryptionLayer),
);
const CensusTestLayer = Layer.mergeAll(CensusLayer, DatabaseLayer).pipe(Layer.orDie);
