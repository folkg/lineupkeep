import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, DateTime, Effect, Layer, Redacted, Ref } from "effect";
import { Array as EffectArray } from "effect";

import { UserDirectory } from "#contexts/auth/UserDirectory.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { EmailDelivery, EmailDeliveryFailed } from "#email/EmailDelivery.ts";
import type { EmailMessage } from "#email/EmailDelivery.ts";
import { EmailDeliveryTest, EmailOutbox } from "#email/internal/EmailDeliveryTest.ts";
import layerTools from "#runtime/ProvideLayer.ts";

import type { ProviderConnection } from "./Connection.ts";
import { Connections } from "./Connections.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { connectionIncidents, notifications } from "./internal/IncidentTables.ts";
import { NotificationsLive } from "./internal/NotificationsRepository.ts";
import { ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { Notifications } from "./Notifications.ts";

const owner = decodeUserId("notification-owner");
const session = Redacted.make("A1=test-session-cookie");

const UserDirectoryTest = Layer.succeed(UserDirectory)({
  emailsFor: (userIds) =>
    Effect.succeed(EffectArray.map(userIds, (userId) => ({ userId, email: "owner@example.com" }))),
});

const EncryptionTestLayer = ConnectionCredentialEncryption.forKey(
  ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
    keyVersion: 1,
  }),
).pipe(Layer.provide(NodeCrypto.layer));

const DatabaseLayer = ConnectionsDatabaseTest.pipe(Layer.orDie);
const RepositoryLayer = ConnectionRepository.layer.pipe(Layer.provide(DatabaseLayer));
const ConnectionsLayer = ConnectionsLive.pipe(
  Layer.provide(RepositoryLayer),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provide(NodeCrypto.layer),
);
const NotificationsLayer = NotificationsLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(UserDirectoryTest),
  Layer.provide(EmailDeliveryTest),
);
const TestLayer = Layer.mergeAll(
  ConnectionsLayer,
  NotificationsLayer,
  RepositoryLayer,
  EmailDeliveryTest,
).pipe(Layer.provideMerge(DatabaseLayer), Layer.provide(NodeCrypto.layer), Layer.orDie);

it.effect("opens one incident and sends one email for a connection expiration", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const repository = yield* ConnectionRepository;
    const notificationRunner = yield* Notifications;
    const outbox = yield* EmailOutbox;
    const ready = yield* connect(connections);

    yield* repository.markReconnectRequired(owner, [
      { id: ready.id, expectedGeneration: credentialGeneration(ready) },
    ]);
    const now = yield* DateTime.now;
    const first = yield* notificationRunner.run(10, now);
    const repeated = yield* notificationRunner.run(10, now);
    const messages = yield* outbox.messages;

    assert.strictEqual(first.sent, 1);
    assert.strictEqual(repeated.sent, 0);
    assert.strictEqual(messages.length, 1);
    const message = messages[0];
    if (message === undefined) {
      throw new Error("Expected one delivered email");
    }
    assert.strictEqual(message.to, "owner@example.com");
    assert.match(message.subject, /reconnect/i);
    assert.isDefined(message.idempotencyKey);
    assert.notInclude(message.text, "A1=test-session-cookie");
    const database = yield* ConnectionsDatabase;
    const rows = yield* database.select().from(notifications);
    assert.strictEqual(rows[0]?.status, "sent");
    assert.strictEqual(rows[0]?.attempts, 1);
    assert.isNotNull(rows[0]?.sentAt);
    assert.isNull(rows[0]?.lastError);
  }).pipe(layerTools.provide(TestLayer)),
);

it.effect("cancels the notification when the connection is reconnected", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const repository = yield* ConnectionRepository;
    const notificationRunner = yield* Notifications;
    const outbox = yield* EmailOutbox;
    const database = yield* ConnectionsDatabase;
    const ready = yield* connect(connections);
    yield* repository.markReconnectRequired(owner, [
      { id: ready.id, expectedGeneration: credentialGeneration(ready) },
    ]);

    yield* connections.completeReconnect(owner, [
      { id: ready.id, provider: decodeProviderKey("yahoo"), session },
    ]);
    const yielded1 = yield* DateTime.now;
    const summary = yield* notificationRunner.run(10, yielded1);
    const messages = yield* outbox.messages;

    assert.strictEqual(summary.sent, 0);
    assert.strictEqual(messages.length, 0);
    const incidents = yield* database.select().from(connectionIncidents);
    assert.strictEqual(incidents[0]?.status, "resolved");
    assert.strictEqual(incidents[0]?.resolution, "reconnected");
    const rows = yield* database.select().from(notifications);
    assert.strictEqual(rows[0]?.status, "cancelled");
    assert.strictEqual(rows[0]?.attempts, 0);
    assert.isNull(rows[0]?.sentAt);
  }).pipe(layerTools.provide(TestLayer)),
);

it.effect("cancels a pending incident notification when the connection is disconnected", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const repository = yield* ConnectionRepository;
    const notificationRunner = yield* Notifications;
    const outbox = yield* EmailOutbox;
    const database = yield* ConnectionsDatabase;
    const ready = yield* connect(connections);
    yield* repository.markReconnectRequired(owner, [
      { id: ready.id, expectedGeneration: credentialGeneration(ready) },
    ]);

    yield* connections.disconnect(owner, [{ id: ready.id }]);
    const yielded2 = yield* DateTime.now;
    const summary = yield* notificationRunner.run(10, yielded2);

    assert.strictEqual(summary.sent, 0);
    const yielded3 = yield* outbox.messages;
    assert.deepStrictEqual(yielded3, []);
    const incidents = yield* database.select().from(connectionIncidents);
    assert.strictEqual(incidents[0]?.resolution, "disconnected");
    const rows = yield* database.select().from(notifications);
    assert.strictEqual(rows[0]?.status, "cancelled");
  }).pipe(layerTools.provide(TestLayer)),
);

it.effect("retries an unavailable email without creating a second notification", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const repository = yield* ConnectionRepository;
    const notificationRunner = yield* Notifications;
    const ready = yield* connect(connections);
    yield* repository.markReconnectRequired(owner, [
      { id: ready.id, expectedGeneration: credentialGeneration(ready) },
    ]);

    const now = yield* DateTime.now;
    const first = yield* notificationRunner.run(10, now);
    const tooSoon = yield* notificationRunner.run(10, DateTime.addDuration(now, 30_000));
    const retried = yield* notificationRunner.run(10, DateTime.addDuration(now, 61_000));

    assert.strictEqual(first.retried, 1);
    assert.strictEqual(tooSoon.retried, 0);
    assert.strictEqual(retried.sent, 1);
    const database = yield* ConnectionsDatabase;
    const rows = yield* database.select().from(notifications);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.status, "sent");
    assert.strictEqual(rows[0]?.attempts, 2);
    assert.isNull(rows[0]?.lastError);
  }).pipe(layerTools.provide(FlakyTestLayer)),
);

it.effect("fails without a verified recipient without counting a delivery attempt", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const repository = yield* ConnectionRepository;
    const runner = yield* Notifications;
    const database = yield* ConnectionsDatabase;
    const ready = yield* connect(connections);
    yield* repository.markReconnectRequired(owner, [
      { id: ready.id, expectedGeneration: credentialGeneration(ready) },
    ]);

    const yielded4 = yield* DateTime.now;
    const summary = yield* runner.run(10, yielded4);
    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.sent, 0);
    const rows = yield* database.select().from(notifications);
    assert.strictEqual(rows[0]?.status, "failed");
    assert.strictEqual(rows[0]?.attempts, 0);
    assert.strictEqual(rows[0]?.lastError, "No verified email address for the account");
    assert.isNull(rows[0]?.sentAt);
  }).pipe(layerTools.provide(MissingEmailTestLayer)),
);

function credentialGeneration(connection: {
  readonly credentialGeneration?: ProviderConnection["credentialGeneration"];
}): NonNullable<ProviderConnection["credentialGeneration"]> {
  if (connection.credentialGeneration === undefined) {
    throw new Error("The test connection has no credential generation");
  }
  return connection.credentialGeneration;
}

function connect(
  connections: Connections["Service"],
): Effect.Effect<ProviderConnection, never, never> {
  return connections.link(owner, [{ provider: decodeProviderKey("yahoo"), session }]).pipe(
    Effect.map((linked) => Array.getUnsafe(linked, 0)),
    Effect.orDie,
  );
}

const FlakyEmailDelivery = Layer.effect(EmailDelivery)(
  Effect.gen(function* () {
    const failNext = yield* Ref.make(true);
    return {
      send: (message: EmailMessage) =>
        Effect.gen(function* () {
          const shouldFail = yield* Ref.getAndSet(failNext, false);
          if (shouldFail) {
            return yield* EmailDeliveryFailed.make({ reason: "unavailable" });
          }
          yield* Effect.annotateCurrentSpan("email.purpose", message.purpose);
        }),
      sendMany: (messages: ReadonlyArray<EmailMessage>) =>
        Effect.forEach(
          messages,
          (message) =>
            Effect.gen(function* () {
              const shouldFail = yield* Ref.getAndSet(failNext, false);
              if (shouldFail) {
                return { _tag: "failed" as const, reason: "unavailable" as const };
              }
              yield* Effect.annotateCurrentSpan("email.purpose", message.purpose);
              return { _tag: "sent" as const };
            }),
          { concurrency: 1 },
        ),
    };
  }),
);
const FlakyNotificationsLayer = NotificationsLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(UserDirectoryTest),
  Layer.provide(FlakyEmailDelivery),
);
const FlakyTestLayer = Layer.mergeAll(
  ConnectionsLayer,
  FlakyNotificationsLayer,
  RepositoryLayer,
).pipe(Layer.provideMerge(DatabaseLayer), Layer.provide(NodeCrypto.layer), Layer.orDie);

const MissingEmailDirectory = Layer.succeed(UserDirectory)({
  emailsFor: () => Effect.succeed([]),
});
const MissingEmailNotificationsLayer = NotificationsLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(MissingEmailDirectory),
  Layer.provide(EmailDeliveryTest),
);
const MissingEmailTestLayer = Layer.mergeAll(
  ConnectionsLayer,
  MissingEmailNotificationsLayer,
  RepositoryLayer,
).pipe(Layer.provideMerge(DatabaseLayer), Layer.provide(NodeCrypto.layer), Layer.orDie);
