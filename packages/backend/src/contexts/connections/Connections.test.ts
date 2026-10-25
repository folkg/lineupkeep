import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { eq } from "drizzle-orm";
import { Array, Crypto, DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { connectionLinkingWindowMillis } from "#contexts/connections/ConnectionLimits.ts";

import {
  CompleteLinkingInput,
  ConnectionCredentialGeneration,
  ConnectionCredentialGenerationStale,
  type ConnectionError,
  ConnectionId,
  ConnectionIdInput,
  ConnectionLinkExpired,
  ConnectionLinkRejected,
  ConnectionNotFound,
  ConnectionPersistenceFailed,
  ConnectionProviderRejected,
  ProviderConnection,
  ReconnectInput,
  StartLinkingInput,
  StartReconnectInput,
} from "./Connection.ts";
import { Connections } from "./Connections.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { providerConnections, providerCredentials } from "./internal/ConnectionTables.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { ProviderGateway } from "./Provider.ts";

it("rejects missing replay keys, unknown providers, and malformed identifiers", () => {
  assert.throws(() => Schema.decodeUnknownSync(StartLinkingInput)({ provider: "yahoo" }));
  assert.throws(() =>
    Schema.decodeUnknownSync(StartLinkingInput)({ requestId, provider: "espn", pairingCode }),
  );
  assert.throws(() =>
    Schema.decodeSync(StartLinkingInput)({
      requestId: "not-a-uuid",
      provider: "yahoo",
      pairingCode,
    }),
  );
  assert.throws(() =>
    Schema.decodeSync(StartLinkingInput)({ requestId, provider: "yahoo", pairingCode: "  " }),
  );
  assert.throws(() =>
    Schema.decodeSync(StartLinkingInput)({
      requestId,
      provider: "yahoo",
      pairingCode: "A".repeat(65),
    }),
  );
  assert.throws(() => Schema.decodeSync(ConnectionId)("not-a-uuid"));
  assert.throws(() => Schema.decodeSync(ConnectionIdInput)({ id: "not-a-uuid" }));
  assert.throws(() =>
    Schema.decodeSync(CompleteLinkingInput)({ id: connectionId, provider: "yahoo", session: "" }),
  );
  assert.throws(() =>
    Schema.decodeSync(ReconnectInput)({
      id: connectionId,
      provider: "yahoo",
      session: "A1=cookie",
      expectedGeneration: 0,
    }),
  );
});

it.effect("replays concurrent linking starts without creating duplicate connections", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const input = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId,
      provider: "yahoo",
      pairingCode,
    });

    const [first, second] = yield* Effect.all(
      [connections.startLinking(owner, [input]), connections.startLinking(owner, [input])],
      { concurrency: "unbounded" },
    );

    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(yield* connections.list(owner), first);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("scopes replay identity and cancellation to the verified owner", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const input = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId,
      provider: "yahoo",
      pairingCode,
    });
    const mine = Array.getUnsafe(yield* connections.startLinking(owner, [input]), 0);
    const theirs = Array.getUnsafe(yield* connections.startLinking(other, [input]), 0);

    const error = yield* Effect.flip(connections.cancelLinking(other, [{ id: mine.id }]));

    assert.notStrictEqual(mine.id, theirs.id);
    assert.instanceOf(error, ConnectionNotFound);
    assert.deepStrictEqual(yield* connections.list(owner), [mine]);
    assert.deepStrictEqual(yield* connections.list(other), [theirs]);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("cancels a linking connection once and replays the disconnected result", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const input = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId,
      provider: "yahoo",
      pairingCode,
    });
    const linking = Array.getUnsafe(yield* connections.startLinking(owner, [input]), 0);

    const cancelled = yield* connections.cancelLinking(owner, [{ id: linking.id }]);
    const retried = yield* connections.cancelLinking(owner, [{ id: linking.id }]);
    const replayed = yield* connections.startLinking(owner, [input]);
    const disconnected = Array.getUnsafe(cancelled, 0);

    assert.strictEqual(disconnected.status, "disconnected");
    assert.isDefined(disconnected.disconnectedAt);
    assert.isUndefined(disconnected.linkingExpiresAt);
    assert.deepStrictEqual(retried, cancelled);
    assert.deepStrictEqual(replayed, cancelled);
    assert.deepStrictEqual(yield* connections.list(owner), cancelled);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rolls back a cancel batch containing another owner's connection", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const inputs = yield* Schema.decodeEffect(Schema.Array(StartLinkingInput))([
      { requestId, provider: "yahoo", pairingCode },
      { requestId: secondRequestId, provider: "yahoo", pairingCode: secondPairingCode },
    ]);
    const owned = yield* connections.startLinking(owner, inputs);
    const foreign = Array.getUnsafe(
      yield* connections.startLinking(other, [Array.getUnsafe(inputs, 0)]),
      0,
    );

    const error = yield* Effect.flip(
      connections.cancelLinking(owner, [{ id: Array.getUnsafe(owned, 0).id }, { id: foreign.id }]),
    );

    assert.instanceOf(error, ConnectionNotFound);
    assert.deepStrictEqual(
      yield* connections.list(owner),
      owned.toSorted((left, right) => left.id.localeCompare(right.id)),
    );
    assert.isTrue(
      (yield* connections.list(owner)).every((connection) => connection.status === "linking"),
    );
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("creates and cancels heterogeneous batches in input order", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const inputs = yield* Schema.decodeEffect(Schema.Array(StartLinkingInput))([
      { requestId, provider: "yahoo", pairingCode },
      { requestId: secondRequestId, provider: "yahoo", pairingCode: secondPairingCode },
    ]);

    const created = yield* connections.startLinking(owner, inputs);
    const replayed = yield* connections.startLinking(owner, inputs);
    const cancelled = yield* connections.cancelLinking(
      owner,
      created.toReversed().map((connection) => ({ id: connection.id })),
    );

    assert.deepStrictEqual(replayed, created);
    assert.deepStrictEqual(
      cancelled.map((connection) => connection.id),
      created.toReversed().map((connection) => connection.id),
    );
    assert.isTrue(created.every((connection) => connection.id[14] === "7"));
    assert.isTrue(cancelled.every((connection) => connection.status === "disconnected"));
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("bounds the linking window from the creation time", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const input = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId,
      provider: "yahoo",
      pairingCode,
    });
    const connection = Array.getUnsafe(yield* connections.startLinking(owner, [input]), 0);
    const expiresAt = connection.linkingExpiresAt;
    if (expiresAt === undefined) {
      return yield* Effect.die("a linking connection exposes its expiry");
    }

    assert.strictEqual(
      DateTime.toEpochMillis(expiresAt) - DateTime.toEpochMillis(connection.createdAt),
      connectionLinkingWindowMillis,
    );
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rejects malformed stored connections through the public service", () =>
  Effect.gen(function* () {
    const database = yield* ConnectionsDatabase;
    yield* database.insert(providerConnections).values({
      id: requestId,
      userId: owner,
      requestId,
      provider: "yahoo",
      status: "linking",
      pairingCode,
      expiresAt: null,
      disconnectedAt: null,
      createdAt: yield* DateTime.nowAsDate,
      updatedAt: yield* DateTime.nowAsDate,
    });

    const error = yield* Effect.flip(Connections.use((connections) => connections.list(owner)));

    assert.instanceOf(error, ConnectionPersistenceFailed);
  }).pipe(Effect.provide(ConnectionsLayerFor(NodeCrypto.layer))),
);

it.effect("completes one linking connection, validates its session, and rejects replay", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const linking = yield* startLinking(connections);

    const approved = yield* connections.completeLinking(owner, [completeInput(linking.id)]);
    const ready = Array.getUnsafe(approved, 0);
    const replay = yield* Effect.flip(
      connections.completeLinking(owner, [completeInput(linking.id)]),
    );
    const replayed = yield* connections.startLinking(owner, [startInput]);

    assert.strictEqual(ready.status, "ready");
    assert.isDefined(ready.approvedAt);
    assert.strictEqual(ready.credentialGeneration, 1);
    assert.isUndefined(ready.linkingExpiresAt);
    assert.instanceOf(replay, ConnectionLinkRejected);
    assert.strictEqual(replay.status, "ready");
    assert.deepStrictEqual(replayed, approved);
    assert.deepStrictEqual(yield* connections.list(owner), approved);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rejects provider session validation without moving the connection to ready", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const linking = yield* startLinking(connections);
    yield* fake.rejectSession(true);

    const error = yield* Effect.flip(
      connections.completeLinking(owner, [completeInput(linking.id)]),
    );
    const stillLinking = Array.getUnsafe(yield* connections.list(owner), 0);

    assert.instanceOf(error, ConnectionProviderRejected);
    assert.strictEqual(stillLinking.status, "linking");
    assert.isUndefined(stillLinking.credentialGeneration);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rejects an approval after the linking window expires", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const linking = yield* startLinking(connections);

    yield* TestClock.adjust(connectionLinkingWindowMillis + 1);
    const error = yield* Effect.flip(
      connections.completeLinking(owner, [completeInput(linking.id)]),
    );

    assert.instanceOf(error, ConnectionLinkExpired);
    assert.deepStrictEqual(yield* connections.list(owner), [linking]);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("scopes completion to the verified owner", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const linking = yield* startLinking(connections);

    const error = yield* Effect.flip(
      connections.completeLinking(other, [completeInput(linking.id)]),
    );

    assert.instanceOf(error, ConnectionNotFound);
    assert.strictEqual(Array.getUnsafe(yield* connections.list(owner), 0).status, "linking");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rolls back a completion batch containing another owner's connection", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const inputs = yield* Schema.decodeEffect(Schema.Array(StartLinkingInput))([
      { requestId, provider: "yahoo", pairingCode },
      { requestId: secondRequestId, provider: "yahoo", pairingCode: secondPairingCode },
    ]);
    const owned = yield* connections.startLinking(owner, inputs);
    const foreign = Array.getUnsafe(
      yield* connections.startLinking(other, [Array.getUnsafe(inputs, 0)]),
      0,
    );

    const error = yield* Effect.flip(
      connections.completeLinking(owner, [
        completeInput(Array.getUnsafe(owned, 0).id),
        completeInput(foreign.id),
      ]),
    );

    assert.instanceOf(error, ConnectionNotFound);
    assert.isTrue(
      (yield* connections.list(owner)).every((connection) => connection.status === "linking"),
    );
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("reconnects to a new credential generation and rejects a stale generation", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const linking = yield* startLinking(connections);
    const ready = Array.getUnsafe(
      yield* connections.completeLinking(owner, [completeInput(linking.id)]),
      0,
    );
    const reconnected = Array.getUnsafe(
      yield* connections.reconnect(owner, [reconnectInput(linking.id, 1)]),
      0,
    );
    const stale = yield* Effect.flip(connections.reconnect(owner, [reconnectInput(linking.id, 1)]));
    const current = Array.getUnsafe(yield* connections.list(owner), 0);

    assert.strictEqual(ready.credentialGeneration, 1);
    assert.strictEqual(reconnected.status, "ready");
    assert.strictEqual(reconnected.credentialGeneration, 2);
    assert.instanceOf(stale, ConnectionCredentialGenerationStale);
    assert.strictEqual(stale.actualGeneration, 2);
    assert.strictEqual(current.credentialGeneration, 2);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rejects reconnect from a linking connection", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const linking = yield* startLinking(connections);

    const error = yield* Effect.flip(connections.reconnect(owner, [reconnectInput(linking.id, 1)]));

    assert.instanceOf(error, ConnectionLinkRejected);
    assert.strictEqual(error.status, "linking");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("disconnects a ready connection, deletes its credentials, and is idempotent", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const linking = yield* startLinking(connections);
    yield* connections.completeLinking(owner, [completeInput(linking.id)]);

    const disconnected = yield* connections.disconnect(owner, [{ id: linking.id }]);
    const retried = yield* connections.disconnect(owner, [{ id: linking.id }]);
    const credentials = yield* database
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.connectionId, linking.id));
    const reconnectError = yield* Effect.flip(
      connections.reconnect(owner, [reconnectInput(linking.id, 1)]),
    );

    assert.strictEqual(Array.getUnsafe(disconnected, 0).status, "disconnected");
    assert.isUndefined(Array.getUnsafe(disconnected, 0).credentialGeneration);
    assert.deepStrictEqual(retried, disconnected);
    assert.deepStrictEqual(credentials, []);
    assert.instanceOf(reconnectError, ConnectionLinkRejected);
    assert.strictEqual(reconnectError.status, "disconnected");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rejects disconnect before a credential exists", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const linking = yield* startLinking(connections);

    const error = yield* Effect.flip(connections.disconnect(owner, [{ id: linking.id }]));

    assert.instanceOf(error, ConnectionLinkRejected);
    assert.strictEqual(error.status, "linking");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rejects cancelLinking after credentials are ready", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const linking = yield* startLinking(connections);
    yield* connections.completeLinking(owner, [completeInput(linking.id)]);

    const error = yield* Effect.flip(connections.cancelLinking(owner, [{ id: linking.id }]));

    assert.instanceOf(error, ConnectionLinkRejected);
    assert.strictEqual(error.status, "ready");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

function startLinking(
  connections: Connections["Service"],
): Effect.Effect<ProviderConnection, ConnectionError | Schema.SchemaError> {
  return connections
    .startLinking(owner, [startInput])
    .pipe(Effect.map((created) => Array.getUnsafe(created, 0)));
}

function completeInput(id: ConnectionId): CompleteLinkingInput {
  return { id, provider: "yahoo", session };
}

function reconnectInput(id: ConnectionId, expectedGeneration: number): ReconnectInput {
  return {
    id,
    provider: "yahoo",
    session,
    expectedGeneration: makeGeneration(expectedGeneration),
  };
}

function makeGeneration(value: number): ConnectionCredentialGeneration {
  return Schema.decodeSync(ConnectionCredentialGeneration)(value);
}

function ConnectionsLayerFor(
  crypto: Layer.Layer<Crypto.Crypto>,
): Layer.Layer<Connections | ConnectionsDatabase | FakeProviderWorld | ProviderGateway> {
  return ConnectionsLive.pipe(
    Layer.provide(ConnectionRepository.layer),
    Layer.provideMerge(ConnectionsDatabaseTest),
    Layer.provideMerge(ProviderFakeTest),
    Layer.provide(EncryptionTestLayer),
    Layer.provide(crypto),
    Layer.orDie,
  );
}

const requestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";
const connectionId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";
const pairingCode = "ABCD2345";
const secondPairingCode = "WXYZ6789";
const secondRequestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3";
const owner = decodeUserId("owner");
const other = decodeUserId("other");
const session = Redacted.make("A1=test-session-cookie");

const startInput = Schema.decodeSync(StartLinkingInput)({
  requestId,
  provider: "yahoo",
  pairingCode,
});

const EncryptionTestLayer = ConnectionCredentialEncryption.forKey(
  ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
    keyVersion: 1,
  }),
).pipe(Layer.provide(NodeCrypto.layer));

const ConnectionsTestLayer = ConnectionsLayerFor(NodeCrypto.layer);

it.effect("starts one explicit reconnect intent and completes it through a new session", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const ready = Array.getUnsafe(yield* connections.startLinking(owner, [startInput]), 0);
    const linked = Array.getUnsafe(
      yield* connections.completeLinking(owner, [
        { id: ready.id, provider: "yahoo", session },
      ]),
      0,
    );
    const intent = yield* Schema.decodeEffect(StartReconnectInput)({
      requestId: secondRequestId,
      id: linked.id,
      pairingCode: "WXYZ6789",
    });

    const started = Array.getUnsafe(yield* connections.startReconnect(owner, [intent]), 0);
    const replayed = Array.getUnsafe(yield* connections.startReconnect(owner, [intent]), 0);
    const completed = Array.getUnsafe(yield* connections.completeReconnect(owner, [
      { id: linked.id, provider: "yahoo", session },
    ]), 0);

    assert.strictEqual(started.reconnectCode, "WXYZ6789");
    assert.isDefined(started.reconnectExpiresAt);
    assert.deepStrictEqual(replayed, started);
    assert.strictEqual(completed.status, "ready");
    assert.strictEqual(completed.credentialGeneration, 2);
    assert.isUndefined(completed.reconnectCode);
    assert.isUndefined(completed.reconnectExpiresAt);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rejects reconnect intent for a linking connection and another owner", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const linking = Array.getUnsafe(yield* connections.startLinking(owner, [startInput]), 0);
    const intent = yield* Schema.decodeEffect(StartReconnectInput)({
      requestId: secondRequestId,
      id: linking.id,
      pairingCode: "WXYZ6789",
    });

    const error = yield* Effect.flip(connections.startReconnect(owner, [intent]));

    assert.instanceOf(error, ConnectionLinkRejected);
    assert.strictEqual(error.status, "linking");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);
