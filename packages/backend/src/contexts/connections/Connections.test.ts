import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { eq } from "drizzle-orm";
import { Array, DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { TestClock } from "effect/testing";

import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import layerTools from "#runtime/ProvideLayer.ts";

import {
  ConnectionId,
  ConnectionIdInput,
  ConnectionLinkRejected,
  ConnectionPersistenceFailed,
  ConnectionProviderRejected,
  LinkInput,
  decodeConnectionId,
  providerSessionReconnectDetail,
} from "./Connection.ts";
import { Connections } from "./Connections.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { providerConnections, providerCredentials } from "./internal/ConnectionTables.ts";
import { connectionIncidents } from "./internal/IncidentTables.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";

const lineupgradeUlid = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

it("accepts stored UUIDs and new ULIDs and rejects malformed connection identifiers", () => {
  assert.strictEqual(
    Effect.runSync(Schema.decodeEffect(ConnectionId)("018f79ea-7d86-7c18-9b4a-8b4d0c916001")),
    "018f79ea-7d86-7c18-9b4a-8b4d0c916001",
  );
  assert.strictEqual(
    Effect.runSync(Schema.decodeEffect(ConnectionId)("01ARZ3NDEKTSV4RRFFQ69G5FAV")),
    "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  );
  assert.throws(() => Effect.runSync(Schema.decodeEffect(ConnectionId)("not-a-uuid")));
  assert.throws(() => Effect.runSync(Schema.decodeEffect(ConnectionIdInput)({ id: "not-a-uuid" })));
  assert.throws(() =>
    Effect.runSync(
      Schema.decodeEffect(LinkInput)({ provider: decodeProviderKey("yahoo"), session: "" }),
    ),
  );
});

it.effect("links a captured session into one ready connection", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;

    const linked = yield* connections.link(owner, [linkInput]);
    const connection = Array.getUnsafe(linked, 0);

    assert.isTrue(lineupgradeUlid.test(connection.id));
    assert.strictEqual(connection.status, "ready");
    assert.strictEqual(connection.credentialGeneration, 1);
    assert.isDefined(connection.approvedAt);
    assert.isUndefined(connection.linkingExpiresAt);
    const yielded1 = yield* connections.list(owner);
    assert.deepStrictEqual(yielded1, linked);
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("reads cards once per ready connection and isolates a failed connection", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const linkedFirst = yield* connections.link(owner, [linkInput]);
    const first = Array.getUnsafe(linkedFirst, 0);
    const secondSession = Redacted.make("A1=other-session-cookie");
    const linkedSecond = yield* connections.link(owner, [{ ...linkInput, session: secondSession }]);
    const second = Array.getUnsafe(linkedSecond, 0);
    yield* fake.setTeamCards([
      {
        provider: decodeProviderKey("yahoo"),
        providerTeamKey: "470.l.2.t.1",
        providerLeagueKey: "470.l.2",
        league: "nfl",
        sport: "football",
        season: 2026,
        seasonOver: undefined,
        name: "One",
        format: "unknown",
        scoringType: "unlisted",
        scoringLabel: "Custom",
        teamCount: 12,
        weeklyDeadline: "",
        startDate: undefined,
        endDate: undefined,
        currentWeek: undefined,
        endWeek: undefined,
        maxGamesPlayed: undefined,
        maxInningsPitched: undefined,
        standing: undefined,
      },
    ]);
    yield* fake.rejectSessionFor([Redacted.value(secondSession)]);
    const result = yield* connections.readTeamCards(owner);
    assert.strictEqual(result.cards.length, 1);
    assert.strictEqual(result.cards[0]?.connectionId, first.id);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.failures[0]?.connectionId, second.id);
    const reads = yield* fake.readCount("read_team_cards");
    assert.strictEqual(reads, 2);
    const foreign = yield* connections.readTeamCards(decodeUserId("another-owner"));
    assert.deepStrictEqual(foreign, { cards: [], failures: [] });
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("leaves no connection when a link's session is rejected", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    yield* fake.rejectSession(true);

    const error = yield* Effect.flip(connections.link(owner, [linkInput]));

    assert.instanceOf(error, ConnectionProviderRejected);
    const yielded2 = yield* connections.list(owner);
    assert.deepStrictEqual(yielded2, []);
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("rejects malformed stored connections through the public service", () =>
  Effect.gen(function* () {
    const database = yield* ConnectionsDatabase;
    yield* database.insert(providerConnections).values({
      id: connectionId,
      userId: owner,
      requestId,
      provider: decodeProviderKey("yahoo"),
      status: "linking",
      expiresAt: null,
      disconnectedAt: null,
      createdAt: yield* DateTime.nowAsDate,
      updatedAt: yield* DateTime.nowAsDate,
    });

    const error = yield* Effect.flip(Connections.use((connections) => connections.list(owner)));

    assert.instanceOf(error, ConnectionPersistenceFailed);
  }).pipe(layerTools.provide(ConnectionsLayerFor(NodeCrypto.layer))),
);

it.effect("reports whether the stored session is usable and names the layer to reconnect", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;

    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-08T14:11:27.000Z")),
    );
    const yielded3 = yield* connections.link(owner, [linkInput]);
    const linked = Array.getUnsafe(yielded3, 0);
    assert.deepStrictEqual(linked.session, {
      usable: true,
      provenAt: DateTime.makeUnsafe("2026-11-08T14:11:27.000Z"),
      action: "none",
      actionDetail: "No action is needed; the stored provider sign-in is working.",
    });

    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-08T14:11:29.000Z")),
    );
    yield* connections.discoverTeams(owner, [{ id: linked.id }]);

    yield* fake.rejectSession(true);
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-08T14:11:30.455Z")),
    );
    const failure = yield* Effect.flip(connections.discoverTeams(owner, [{ id: linked.id }]));
    assert.instanceOf(failure, ConnectionProviderRejected);
    yield* fake.rejectSession(false);

    const yielded4 = yield* connections.list(owner);
    const refused = Array.getUnsafe(yielded4, 0);
    assert.strictEqual(refused.status, "reconnect-required");
    assert.deepStrictEqual(refused.session, {
      usable: false,
      provenAt: DateTime.makeUnsafe("2026-11-08T14:11:29.000Z"),
      rejectedAt: DateTime.makeUnsafe("2026-11-08T14:11:30.455Z"),
      action: "reconnect-provider-connection",
      actionDetail: providerSessionReconnectDetail,
    });
    assert.include(refused.session.actionDetail, "not the MCP connector in your client");
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("reconnects a ready connection to a new credential generation", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const yielded5 = yield* connections.link(owner, [linkInput]);
    const linked = Array.getUnsafe(yielded5, 0);

    const yielded6 = yield* connections.completeReconnect(owner, [
      { id: linked.id, provider: decodeProviderKey("yahoo"), session },
    ]);
    const reconnected = Array.getUnsafe(yielded6, 0);

    assert.strictEqual(linked.credentialGeneration, 1);
    assert.strictEqual(reconnected.status, "ready");
    assert.strictEqual(reconnected.credentialGeneration, 2);
    const yielded7 = yield* connections.list(owner);
    assert.deepStrictEqual(yielded7, [reconnected]);
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("records the provider's refusal status and wording on the incident", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const yielded8 = yield* connections.link(owner, [linkInput]);
    const linked = Array.getUnsafe(yielded8, 0);
    const detail = "You are not allowed to view this page because you are not in this league.";
    yield* fake.setSessionRejection({ status: 403, detail });
    yield* fake.rejectSession(true);

    const failure = yield* Effect.flip(connections.discoverTeams(owner, [{ id: linked.id }]));
    assert.instanceOf(failure, ConnectionProviderRejected);

    const incidents = yield* database.select().from(connectionIncidents);
    assert.strictEqual(incidents.length, 1);
    assert.strictEqual(incidents[0]?.status, "open");
    assert.strictEqual(incidents[0]?.credentialGeneration, 1);
    assert.strictEqual(incidents[0]?.operation, "discover_teams");
    assert.strictEqual(incidents[0]?.providerStatus, 403);
    assert.strictEqual(incidents[0]?.providerDetail, detail);
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("resolves the open incident when a reconnect replaces the session", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const yielded9 = yield* connections.link(owner, [linkInput]);
    const linked = Array.getUnsafe(yielded9, 0);
    yield* fake.rejectSession(true);
    yield* Effect.flip(connections.discoverTeams(owner, [{ id: linked.id }]));
    yield* fake.rejectSession(false);

    const yielded10 = yield* connections.completeReconnect(owner, [
      { id: linked.id, provider: decodeProviderKey("yahoo"), session },
    ]);
    const reconnected = Array.getUnsafe(yielded10, 0);
    assert.strictEqual(reconnected.credentialGeneration, 2);

    const incidents = yield* database.select().from(connectionIncidents);
    assert.strictEqual(incidents.length, 1);
    assert.strictEqual(incidents[0]?.status, "resolved");
    assert.strictEqual(incidents[0]?.resolution, "reconnected");
    assert.isDefined(incidents[0]?.resolvedAt);

    yield* connections.completeReconnect(owner, [
      { id: linked.id, provider: decodeProviderKey("yahoo"), session },
    ]);
    const yielded11 = yield* database.select().from(connectionIncidents);
    assert.deepStrictEqual(yielded11, incidents);
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("reconnects a connection the provider marked reconnect-required", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const yielded12 = yield* connections.link(owner, [linkInput]);
    const linked = Array.getUnsafe(yielded12, 0);
    yield* fake.rejectSession(true);
    yield* Effect.flip(connections.discoverTeams(owner, [{ id: linked.id }]));
    const yielded13 = yield* connections.list(owner);
    const required = Array.getUnsafe(yielded13, 0);

    yield* fake.rejectSession(false);
    const yielded14 = yield* connections.completeReconnect(owner, [
      { id: linked.id, provider: decodeProviderKey("yahoo"), session },
    ]);
    const reconnected = Array.getUnsafe(yielded14, 0);

    assert.strictEqual(required.status, "reconnect-required");
    assert.strictEqual(reconnected.status, "ready");
    assert.strictEqual(reconnected.credentialGeneration, 2);
    assert.isDefined(reconnected.approvedAt);
    assert.isUndefined(reconnected.reconnectRequiredAt);
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("resolves an open incident on disconnect and leaves it resolved on retry", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const yielded15 = yield* connections.link(owner, [linkInput]);
    const linked = Array.getUnsafe(yielded15, 0);
    yield* fake.rejectSession(true);
    yield* Effect.flip(connections.discoverTeams(owner, [{ id: linked.id }]));

    yield* connections.disconnect(owner, [{ id: linked.id }]);
    const incidents = yield* database.select().from(connectionIncidents);
    assert.strictEqual(incidents.length, 1);
    assert.strictEqual(incidents[0]?.status, "resolved");
    assert.strictEqual(incidents[0]?.resolution, "disconnected");
    assert.isDefined(incidents[0]?.resolvedAt);

    yield* connections.disconnect(owner, [{ id: linked.id }]);
    const yielded16 = yield* database.select().from(connectionIncidents);
    assert.deepStrictEqual(yielded16, incidents);
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("disconnects a ready connection, deletes its credentials, and is idempotent", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const yielded17 = yield* connections.link(owner, [linkInput]);
    const linked = Array.getUnsafe(yielded17, 0);

    const before = yield* database
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.connectionId, linked.id));
    assert.strictEqual(before.length, 1);

    const disconnected = yield* connections.disconnect(owner, [{ id: linked.id }]);
    const retried = yield* connections.disconnect(owner, [{ id: linked.id }]);
    const credentials = yield* database
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.connectionId, linked.id));
    const remainingConnections = yield* database
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, linked.id));
    const reconnectError = yield* Effect.flip(
      connections.completeReconnect(owner, [
        { id: linked.id, provider: decodeProviderKey("yahoo"), session },
      ]),
    );

    assert.strictEqual(Array.getUnsafe(disconnected, 0).status, "disconnected");
    assert.isUndefined(Array.getUnsafe(disconnected, 0).credentialGeneration);
    assert.deepStrictEqual(retried, disconnected);
    assert.deepStrictEqual(credentials, []);
    assert.strictEqual(remainingConnections.length, 1);
    assert.strictEqual(remainingConnections[0]?.status, "disconnected");
    assert.strictEqual(remainingConnections[0]?.credentialGeneration, null);
    assert.instanceOf(reconnectError, ConnectionLinkRejected);
    assert.strictEqual(reconnectError.status, "disconnected");
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

it.effect("rejects disconnect before a credential exists", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const at = yield* DateTime.nowAsDate;
    yield* database.insert(providerConnections).values({
      id: connectionId,
      userId: owner,
      requestId,
      provider: decodeProviderKey("yahoo"),
      status: "linking",
      expiresAt: at,
      disconnectedAt: null,
      createdAt: at,
      updatedAt: at,
    });

    const error = yield* Effect.flip(connections.disconnect(owner, [{ id: connectionId }]));

    assert.instanceOf(error, ConnectionLinkRejected);
    assert.strictEqual(error.status, "linking");
  }).pipe(layerTools.provide(ConnectionsTestLayer)),
);

function ConnectionsLayerFor(
  random: Layer.Layer<SecureRandom.SecureRandom>,
): Layer.Layer<Connections | ConnectionsDatabase | FakeProviderWorld | ProviderRegistry> {
  return ConnectionsLive.pipe(
    Layer.provide(ConnectionRepository.layer),
    Layer.provideMerge(ConnectionsDatabaseTest),
    Layer.provideMerge(ProviderFakeTest),
    Layer.provide(EncryptionTestLayer),
    Layer.provide(random),
    Layer.orDie,
  );
}

const requestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";
const connectionId = decodeConnectionId(requestId);
const owner = decodeUserId("owner");
const session = Redacted.make("A1=test-session-cookie");

const linkInput = {
  provider: decodeProviderKey("yahoo"),
  session,
};

const EncryptionTestLayer = ConnectionCredentialEncryption.forKey(
  ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
    keyVersion: 1,
  }),
).pipe(Layer.provide(NodeCrypto.layer));

const ConnectionsTestLayer = ConnectionsLayerFor(NodeCrypto.layer);
