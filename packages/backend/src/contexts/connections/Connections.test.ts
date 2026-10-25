import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, Crypto, DateTime, Effect, Layer, Schema } from "effect";

import { connectionLinkingWindowMillis } from "#contexts/connections/ConnectionLimits.ts";

import {
  ConnectionId,
  ConnectionIdInput,
  ConnectionNotFound,
  ConnectionPersistenceFailed,
  StartLinkingInput,
} from "./Connection.ts";
import { Connections } from "./Connections.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { providerConnections } from "./internal/ConnectionTables.ts";

it("rejects missing replay keys, unknown providers, and malformed identifiers", () => {
  assert.throws(() => Schema.decodeUnknownSync(StartLinkingInput)({ provider: "yahoo" }));
  assert.throws(() => Schema.decodeUnknownSync(StartLinkingInput)({ requestId, provider: "espn" }));
  assert.throws(() =>
    Schema.decodeSync(StartLinkingInput)({ requestId: "not-a-uuid", provider: "yahoo" }),
  );
  assert.throws(() => Schema.decodeSync(ConnectionId)("not-a-uuid"));
  assert.throws(() => Schema.decodeSync(ConnectionIdInput)({ id: "not-a-uuid" }));
});

it.effect("replays concurrent linking starts without creating duplicate connections", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const input = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId,
      provider: "yahoo",
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
      { requestId, provider: "yahoo" },
      { requestId: secondRequestId, provider: "yahoo" },
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
      { requestId, provider: "yahoo" },
      { requestId: secondRequestId, provider: "yahoo" },
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

it.effect("maps UUID generation failure without inserting a connection", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const cryptoFailure = yield* Effect.flip(crypto.randomBytes(-1));
    const failingCrypto = Layer.succeed(Crypto.Crypto)(
      Crypto.Crypto.of({ ...crypto, randomUUIDv7: () => Effect.fail(cryptoFailure) }),
    );
    const input = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId,
      provider: "yahoo",
    });
    const program = Connections.use((connections) => connections.startLinking(owner, [input]));

    const error = yield* Effect.flip(
      program.pipe(
        Effect.provide(
          ConnectionsLive.pipe(
            Layer.provide(ConnectionRepository.layer),
            Layer.provide(failingCrypto),
          ),
        ),
      ),
    );
    const database = yield* ConnectionsDatabase;

    assert.instanceOf(error, ConnectionPersistenceFailed);
    assert.strictEqual(error.cause, cryptoFailure);
    assert.deepStrictEqual(yield* database.select().from(providerConnections), []);
  }).pipe(Effect.provide(Layer.merge(NodeCrypto.layer, ConnectionsDatabaseTest))),
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
      expiresAt: null,
      disconnectedAt: null,
      createdAt: yield* DateTime.nowAsDate,
      updatedAt: yield* DateTime.nowAsDate,
    });

    const error = yield* Effect.flip(
      Connections.use((connections) => connections.list(owner)).pipe(
        Effect.provide(ConnectionsLive.pipe(Layer.provide(ConnectionRepository.layer))),
      ),
    );

    assert.instanceOf(error, ConnectionPersistenceFailed);
  }).pipe(Effect.provide(Layer.merge(NodeCrypto.layer, ConnectionsDatabaseTest))),
);

const requestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";

const secondRequestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3";

const owner = decodeUserId("owner");

const other = decodeUserId("other");

const ConnectionsTestLayer = ConnectionsLive.pipe(
  Layer.provide(ConnectionRepository.layer),
  Layer.provide(ConnectionsDatabaseTest),
  Layer.provide(NodeCrypto.layer),
);
