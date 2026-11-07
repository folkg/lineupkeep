import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { and, eq } from "drizzle-orm";
import { Array, Crypto, DateTime, Effect, Layer, Redacted, Schema } from "effect";

import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

import {
  type ConnectionError,
  type ConnectionId,
  ConnectionNotFound,
  ConnectionProviderRejected,
  ConnectionProviderUnavailable,
} from "./Connection.ts";
import { Connections } from "./Connections.ts";
import type { FantasyTeam } from "./FantasyTeam.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { providerCredentials, providerTeams } from "./internal/ConnectionTables.ts";
import { LineupRunRepository } from "./internal/LineupRunRepository.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { TeamAutomationState } from "./internal/TeamAutomationWorkflow.ts";
import { TeamRepository } from "./internal/TeamRepository.ts";
import { TeamsLive } from "./internal/TeamsLive.ts";
import type { ProviderTeam } from "./Provider.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";
import { Teams } from "./Teams.ts";

const lineupgradeUlid = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

it.effect("discovers multiple teams in one league and persists them disabled", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    const teams = [team("nhl.l.1.t.1", "First Skate"), team("nhl.l.1.t.2", "Second Skate")];
    yield* fake.setTeams(teams);

    const discovered = yield* connections.discoverTeams(owner, [{ id: ready.id }]);

    assert.strictEqual(discovered.length, 2);
    assert.deepStrictEqual(
      discovered.map((row) => row.providerTeamKey),
      ["nhl.l.1.t.1", "nhl.l.1.t.2"],
    );
    assert.isTrue(discovered.every((row) => lineupgradeUlid.test(row.id)));
    assert.strictEqual(new Set(discovered.map((row) => row.id)).size, 2);
    assert.isTrue(discovered.every((row) => row.league === "nhl"));
    assert.isTrue(discovered.every((row) => row.providerLeagueKey === "nhl"));
    assert.isTrue(discovered.every((row) => row.automation.status === "disabled"));
    assert.isTrue(discovered.every((row) => row.availability === "available"));
    assert.deepStrictEqual(yield* connections.listTeams(owner), discovered);
    assert.deepStrictEqual(yield* connections.listTeams(other), []);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("keeps the fantasy league name and provider url discovered for each team", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    const named = {
      ...team("nhl.l.1.t.1", "First Skate"),
      leagueName: "Irish Lax",
      providerUrl: "https://provider.example/hockey/1/1",
    };
    yield* fake.setTeams([named]);

    const discovered = yield* connections.discoverTeams(owner, [{ id: ready.id }]);

    assert.strictEqual(Array.getUnsafe(discovered, 0).leagueName, "Irish Lax");
    assert.strictEqual(
      Array.getUnsafe(discovered, 0).providerUrl,
      "https://provider.example/hockey/1/1",
    );
    const listed = yield* connections.listTeams(owner);
    assert.strictEqual(Array.getUnsafe(listed, 0).leagueName, "Irish Lax");
    assert.strictEqual(
      Array.getUnsafe(listed, 0).providerUrl,
      "https://provider.example/hockey/1/1",
    );

    yield* fake.setTeams([
      {
        ...named,
        leagueName: "Irish Lax Renamed",
        providerUrl: "https://provider.example/hockey/1/2",
      },
    ]);
    const refreshed = yield* connections.discoverTeams(owner, [{ id: ready.id }]);

    assert.strictEqual(Array.getUnsafe(refreshed, 0).leagueName, "Irish Lax Renamed");
    assert.strictEqual(
      Array.getUnsafe(refreshed, 0).providerUrl,
      "https://provider.example/hockey/1/2",
    );
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("names a stored team's league on the teams list read", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    yield* fake.setTeams([team("nhl.l.1.t.1", "First Skate")]);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    assert.strictEqual(
      findTeam(yield* connections.listTeams(owner), "nhl.l.1.t.1").leagueName,
      undefined,
    );

    yield* fake.setTeams([
      {
        ...team("nhl.l.1.t.1", "First Skate"),
        leagueName: "Elite League 25",
        providerUrl: "https://provider.example/hockey/1/1",
      },
    ]);

    const summary = Array.getUnsafe(yield* teams.list(owner), 0);

    assert.strictEqual(summary.team.leagueName, "Elite League 25");
    assert.strictEqual(summary.team.providerUrl, "https://provider.example/hockey/1/1");
    assert.strictEqual(summary.connectionCount, 1);
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("does not rediscover a team whose league is already named", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    yield* fake.setTeams([
      {
        ...team("nhl.l.1.t.1", "First Skate"),
        leagueName: "Elite League 25",
        providerUrl: "https://provider.example/hockey/1/1",
      },
    ]);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    const before = yield* fake.providerReads;

    const summary = Array.getUnsafe(yield* teams.list(owner), 0);

    assert.strictEqual(summary.team.leagueName, "Elite League 25");
    assert.strictEqual((yield* fake.providerReads) - before, 0);
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("lists a team whose league name cannot be read", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    yield* fake.setTeams([team("nhl.l.1.t.1", "First Skate")]);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    yield* fake.failRequests("unavailable");

    const summary = Array.getUnsafe(yield* teams.list(owner), 0);

    assert.strictEqual(summary.team.name, "First Skate");
    assert.strictEqual(summary.team.leagueName, undefined);
    assert.strictEqual(summary.connectionStatus, "ready");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("refreshes availability, restores teams, and preserves configuration", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    const first = team("nhl.l.1.t.1", "First Skate");
    const second = team("nhl.l.1.t.2", "Second Skate");
    yield* fake.setTeams([first, second]);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    const originalId = findTeam(yield* connections.listTeams(owner), first.providerTeamKey).id;
    yield* database
      .update(providerTeams)
      .set({
        automationState: yield* Schema.encodeEffect(Schema.toCodecJson(TeamAutomationState))({
          _tag: "Enabled",
          changedAt: DateTime.makeUnsafe("2026-10-25T12:00:00Z"),
        }),
        automationStatus: "enabled",
      })
      .where(
        and(
          eq(providerTeams.userId, owner),
          eq(providerTeams.connectionId, ready.id),
          eq(providerTeams.providerTeamKey, first.providerTeamKey),
        ),
      );

    yield* fake.setTeams([{ ...first, name: "Renamed Skate" }]);
    const refreshed = yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    const renamed = findTeam(refreshed, first.providerTeamKey);
    const unavailable = findTeam(refreshed, second.providerTeamKey);

    assert.strictEqual(renamed.name, "Renamed Skate");
    assert.strictEqual(renamed.id, originalId);
    assert.strictEqual(renamed.availability, "available");
    assert.strictEqual(renamed.automation.status, "enabled");
    assert.strictEqual(unavailable.name, "Second Skate");
    assert.strictEqual(unavailable.availability, "unavailable");
    assert.strictEqual(unavailable.automation.status, "disabled");

    const third = team("nhl.l.1.t.3", "Third Skate");
    yield* fake.setTeams([first, second, third]);
    const restored = yield* connections.discoverTeams(owner, [{ id: ready.id }]);

    assert.isTrue(restored.every((row) => row.availability === "available"));
    assert.strictEqual(findTeam(restored, first.providerTeamKey).automation.status, "enabled");
    assert.strictEqual(findTeam(restored, third.providerTeamKey).automation.status, "disabled");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("requires a new credential generation after the provider rejects discovery", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    yield* fake.setTeams([team("nhl.l.1.t.1", "First Skate")]);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    yield* fake.rejectSession(true);

    const rejected = yield* Effect.flip(connections.discoverTeams(owner, [{ id: ready.id }]));
    const reconnectRequired = Array.getUnsafe(yield* connections.list(owner), 0);
    const retained = yield* connections.listTeams(owner);

    assert.instanceOf(rejected, ConnectionProviderRejected);
    assert.strictEqual(reconnectRequired.status, "reconnect-required");
    assert.strictEqual(reconnectRequired.credentialGeneration, 1);
    assert.strictEqual(retained.length, 1);
    assert.strictEqual(Array.getUnsafe(retained, 0).availability, "unavailable");

    yield* fake.rejectSession(false);
    const recovered = Array.getUnsafe(
      yield* connections.completeReconnect(owner, [
        { id: ready.id, provider: decodeProviderKey("yahoo"), session },
      ]),
      0,
    );
    const rediscovered = yield* connections.discoverTeams(owner, [{ id: ready.id }]);

    assert.strictEqual(recovered.status, "ready");
    assert.strictEqual(recovered.credentialGeneration, 2);
    assert.strictEqual(Array.getUnsafe(rediscovered, 0).availability, "available");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rejects discovery for another owner", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const ready = yield* connect(connections);

    const foreign = yield* Effect.flip(connections.discoverTeams(other, [{ id: ready.id }]));

    assert.instanceOf(foreign, ConnectionNotFound);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("marks teams unavailable when their connection is disconnected", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    yield* fake.setTeams([team("nhl.l.1.t.1", "First Skate")]);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);

    yield* connections.disconnect(owner, [{ id: ready.id }]);
    const teams = yield* connections.listTeams(owner);

    assert.strictEqual(Array.getUnsafe(teams, 0).availability, "unavailable");
    assert.strictEqual(Array.getUnsafe(teams, 0).automation.status, "disabled");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("rejects tampered credentials without exposing their contents", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const ready = yield* connect(connections);
    yield* database
      .update(providerCredentials)
      .set({ envelope: "tampered-envelope" })
      .where(eq(providerCredentials.connectionId, ready.id));

    const error = yield* Effect.flip(connections.discoverTeams(owner, [{ id: ready.id }]));

    assert.strictEqual(error._tag, "connection.persistence_failed");
    assert.notInclude(String(error), "tampered-envelope");
    assert.deepStrictEqual(yield* connections.listTeams(owner), []);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("leaves stored teams unchanged when the provider is unavailable", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    yield* fake.setTeams([team("nhl.l.1.t.1", "First Skate")]);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    yield* fake.failRequests("unavailable");

    const error = yield* Effect.flip(connections.discoverTeams(owner, [{ id: ready.id }]));
    const teams = yield* connections.listTeams(owner);

    assert.instanceOf(error, ConnectionProviderUnavailable);
    assert.strictEqual(Array.getUnsafe(teams, 0).availability, "available");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

function connect(
  connections: Connections["Service"],
): Effect.Effect<{ readonly id: ConnectionId }, ConnectionError> {
  return connections
    .link(owner, [{ provider: decodeProviderKey("yahoo"), session }])
    .pipe(Effect.map((linked) => ({ id: Array.getUnsafe(linked, 0).id })));
}

function team(providerTeamKey: string, name: string): ProviderTeam {
  return {
    provider: decodeProviderKey("yahoo"),
    providerTeamKey,
    providerLeagueKey: "nhl",
    league: "nhl",
    sport: "hockey",
    season: 2026,
    name,
  };
}

function findTeam(teams: ReadonlyArray<FantasyTeam>, providerTeamKey: string): FantasyTeam {
  const found = teams.find((row) => row.providerTeamKey === providerTeamKey);
  if (found === undefined) {
    throw new Error(`missing team ${providerTeamKey}`);
  }
  return found;
}

function ConnectionsLayerFor(
  crypto: Layer.Layer<Crypto.Crypto>,
): Layer.Layer<Connections | ConnectionsDatabase | FakeProviderWorld | ProviderRegistry> {
  return ConnectionsLive.pipe(
    Layer.provide(ConnectionRepository.layer),
    Layer.provideMerge(ConnectionsDatabaseTest),
    Layer.provideMerge(ProviderFakeTest),
    Layer.provide(EncryptionTestLayer),
    Layer.provide(crypto),
    Layer.orDie,
  );
}

const owner = decodeUserId("owner");
const other = decodeUserId("other");
const session = Redacted.make("A1=test-session-cookie");
const EncryptionTestLayer = ConnectionCredentialEncryption.forKey(
  ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
    keyVersion: 1,
  }),
).pipe(Layer.provide(NodeCrypto.layer));

const ConnectionsTestLayer = ConnectionsLayerFor(NodeCrypto.layer);
const TeamRepositoryTest = TeamRepository.layer.pipe(
  Layer.provide(ConnectionsDatabaseTest),
  Layer.provide(ProviderFakeTest),
);
const LineupRepositoryTest = LineupRunRepository.layer.pipe(Layer.provide(ConnectionsDatabaseTest));
const TeamsTestLayer = TeamsLive.pipe(
  Layer.provide(TeamRepositoryTest),
  Layer.provide(LineupRepositoryTest),
  Layer.provideMerge(ConnectionsTestLayer),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
