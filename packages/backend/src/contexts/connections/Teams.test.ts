import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { and, eq } from "drizzle-orm";
import { Array, Crypto, DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

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
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { TeamAutomationState } from "./internal/TeamAutomationWorkflow.ts";
import type { ProviderTeam } from "./Provider.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";

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
    assert.isTrue(discovered.every((row) => row.id.length > 0));
    assert.strictEqual(new Set(discovered.map((row) => row.id)).size, 2);
    assert.isTrue(discovered.every((row) => row.league === "nhl"));
    assert.isTrue(discovered.every((row) => row.providerLeagueKey === "nhl"));
    assert.isTrue(discovered.every((row) => row.automation.status === "disabled"));
    assert.isTrue(discovered.every((row) => row.availability.status === "available"));
    assert.deepStrictEqual(yield* connections.listTeams(owner), discovered);
    assert.deepStrictEqual(yield* connections.listTeams(other), []);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
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
    assert.strictEqual(renamed.availability.status, "available");
    assert.strictEqual(renamed.automation.status, "enabled");
    assert.strictEqual(unavailable.name, "Second Skate");
    assert.deepInclude(unavailable.availability, {
      status: "unavailable",
      reason: "not_listed",
      detail: "The provider no longer lists this team through its connection.",
    });
    assert.strictEqual(unavailable.automation.status, "disabled");

    const third = team("nhl.l.1.t.3", "Third Skate");
    yield* fake.setTeams([first, second, third]);
    const restored = yield* connections.discoverTeams(owner, [{ id: ready.id }]);

    assert.isTrue(restored.every((row) => row.availability.status === "available"));
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
    assert.deepInclude(Array.getUnsafe(retained, 0).availability, {
      status: "unavailable",
      reason: "connection_unavailable",
      detail:
        "The provider rejected this connection's sign-in, so Lineupkeep cannot read this team.",
    });

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
    assert.strictEqual(Array.getUnsafe(rediscovered, 0).availability.status, "available");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("records a provider refusal with its wording and keeps the team", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    const refusedTeam = team("nhl.l.1.t.1", "First Skate");
    yield* fake.setTeams([refusedTeam]);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    const stored = findTeam(yield* connections.listTeams(owner), refusedTeam.providerTeamKey);
    yield* database
      .update(providerTeams)
      .set({ ownerNote: "Keeper league: hold the second-round pick." })
      .where(eq(providerTeams.id, stored.id));
    const checkedAt = yield* DateTime.now;

    yield* fake.refuseLeague("nhl", refusal);
    const checked = yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    const refused = findTeam(checked, refusedTeam.providerTeamKey);

    assert.strictEqual(checked.length, 1);
    assert.strictEqual(refused.id, stored.id);
    assert.strictEqual(refused.ownerNote, "Keeper league: hold the second-round pick.");
    assert.strictEqual(refused.availability.status, "unavailable");
    if (refused.availability.status === "unavailable") {
      assert.strictEqual(refused.availability.reason, "provider_refused");
      assert.strictEqual(refused.availability.detail, refusal);
      assert.strictEqual(refused.availability.consecutiveRefusals, 1);
      assert.isAtLeast(
        DateTime.toEpochMillis(refused.availability.observedAt),
        DateTime.toEpochMillis(checkedAt),
      );
    }
    const again = findTeam(
      yield* connections.discoverTeams(owner, [{ id: ready.id }]),
      refusedTeam.providerTeamKey,
    );
    assert.deepInclude(again.availability, {
      status: "unavailable",
      reason: "provider_refused",
      consecutiveRefusals: 2,
    });
    assert.strictEqual(again.id, stored.id);
    assert.strictEqual(again.ownerNote, "Keeper league: hold the second-round pick.");
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("returns a refused team to available when the provider's refusal clears", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    const target = team("nhl.l.1.t.1", "First Skate");
    yield* fake.setTeams([target]);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);
    const stored = findTeam(yield* connections.listTeams(owner), target.providerTeamKey);
    yield* database
      .update(providerTeams)
      .set({ ownerNote: "Hold the second-round pick." })
      .where(eq(providerTeams.id, stored.id));
    yield* fake.refuseLeague("nhl", refusal);
    yield* connections.discoverTeams(owner, [{ id: ready.id }]);

    yield* fake.refuseLeague("nhl", undefined);
    const checkedAt = yield* DateTime.now;
    const recovered = findTeam(
      yield* connections.discoverTeams(owner, [{ id: ready.id }]),
      target.providerTeamKey,
    );

    assert.strictEqual(recovered.availability.status, "available");
    if (recovered.availability.status === "available") {
      assert.isAtLeast(
        DateTime.toEpochMillis(recovered.availability.observedAt),
        DateTime.toEpochMillis(checkedAt),
      );
    }
    assert.strictEqual(recovered.ownerNote, "Hold the second-round pick.");
    assert.strictEqual(recovered.id, stored.id);
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("reports a team nobody has observed as unobserved, not available", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    yield* fake.setTeams([team("nhl.l.1.t.1", "First Skate")]);
    const discovered = Array.getUnsafe(
      yield* connections.discoverTeams(owner, [{ id: ready.id }]),
      0,
    );
    yield* database
      .update(providerTeams)
      .set({ availabilityObservedAt: null })
      .where(eq(providerTeams.id, discovered.id));

    const listed = Array.getUnsafe(yield* connections.listTeams(owner), 0);

    assert.deepStrictEqual(listed.availability, { status: "unobserved" });
  }).pipe(Effect.provide(ConnectionsTestLayer)),
);

it.effect("reports an observation older than three hours as stale with its time", () =>
  Effect.gen(function* () {
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const ready = yield* connect(connections);
    yield* fake.setTeams([team("nhl.l.1.t.1", "First Skate")]);
    const discovered = Array.getUnsafe(
      yield* connections.discoverTeams(owner, [{ id: ready.id }]),
      0,
    );
    assert.strictEqual(discovered.availability.status, "available");
    if (discovered.availability.status !== "available") {
      return;
    }

    yield* TestClock.adjust(4 * 3_600_000);
    const stale = Array.getUnsafe(yield* connections.listTeams(owner), 0);

    assert.deepStrictEqual(stale.availability, {
      status: "stale",
      observedAt: discovered.availability.observedAt,
    });
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

    assert.deepInclude(Array.getUnsafe(teams, 0).availability, {
      status: "unavailable",
      reason: "connection_unavailable",
      detail: "The connection is disconnected, so Lineupkeep cannot read this team.",
    });
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
    assert.strictEqual(Array.getUnsafe(teams, 0).availability.status, "available");
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

const refusal = "You are not allowed to view this page because you are not in this league.";
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
