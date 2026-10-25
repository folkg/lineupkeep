import { assert, it } from "@effect/vitest";
import { MachineTest } from "@typeonce/effect-machine/testing";
import { Arbitrary, DateTime, Effect, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import {
  ConnectionCredentialGeneration,
  decodeConnectionId,
} from "#contexts/connections/Connection.ts";
import { snapshotOf } from "#utilities/machine.ts";

import { ConnectionLifecycleWorkflow } from "./ConnectionLifecycleWorkflow.ts";
import { ConnectionRow, FantasyTeamRow } from "./ConnectionTables.ts";

it.effect("round-trips every explored lifecycle state through its row codec", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(ConnectionLifecycleWorkflow, {
      input,
      events: () => events,
      stateKey: ({ snapshot }) => JSON.stringify(snapshot),
    });
    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    for (const { snapshot } of explored.nodes) {
      const record = {
        id: decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"),
        userId: yield* Schema.decodeEffect(UserId)("owner"),
        requestId: "request",
        pairingCode: "ABCD2345",
        createdAt: at,
        state: snapshot.state.value,
      };
      const row = yield* Schema.encodeEffect(ConnectionRow)(record);
      const decoded = yield* Schema.decodeEffect(ConnectionRow)(row);
      const restored = yield* snapshotOf(ConnectionLifecycleWorkflow, decoded.state);

      assert.strictEqual(row.provider, record.state.provider);
      assert.deepStrictEqual(row.updatedAt, DateTime.toDateUtc(record.state.updatedAt));
      assert.deepStrictEqual(restored, snapshot);
      assert.deepStrictEqual(yield* Schema.encodeEffect(ConnectionRow)(decoded), row);
      assert.strictEqual(decoded.id, record.id);
      assert.strictEqual(decoded.userId, record.userId);
      assert.strictEqual(decoded.requestId, record.requestId);
      assert.deepStrictEqual(decoded.createdAt, record.createdAt);
    }
  }),
);

it.effect("round-trips generated lifecycle data and timestamp edges", () =>
  Effect.gen(function* () {
    const generated = Arbitrary.schema(
      Schema.Struct({
        millis: Schema.Int.check(
          Schema.isBetween({ minimum: -8_640_000_000_000_000, maximum: 8_640_000_000_000_000 }),
        ),
        generation: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
      }),
    );
    const result = yield* Arbitrary.checkEffect(
      generated,
      ({ millis, generation }) =>
        Effect.gen(function* () {
          const time = DateTime.makeUnsafe(millis);
          const record = {
            id: decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"),
            userId: yield* Schema.decodeEffect(UserId)("owner"),
            requestId: "request",
            pairingCode: "ABCD2345",
            createdAt: time,
            state: {
              _tag: "Linking" as const,
              provider: "yahoo" as const,
              expiresAt: time,
              updatedAt: at,
            },
          };
          for (const state of [
            record.state,
            {
              _tag: "Ready" as const,
              provider: "yahoo" as const,
              approvedAt: time,
              credentialGeneration: makeGeneration(generation),
              updatedAt: time,
            },
            {
              _tag: "ReconnectRequired" as const,
              provider: "yahoo" as const,
              reconnectRequiredAt: time,
              credentialGeneration: makeGeneration(generation),
              updatedAt: time,
            },
            {
              _tag: "Disconnected" as const,
              provider: "yahoo" as const,
              disconnectedAt: time,
              updatedAt: time,
            },
          ]) {
            const row = yield* Schema.encodeEffect(ConnectionRow)({ ...record, state });
            const decoded = yield* Schema.decodeEffect(ConnectionRow)(row);
            if (
              !Schema.toEquivalence(Schema.toType(ConnectionRow))(decoded, { ...record, state })
            ) {
              return false;
            }
          }
          return true;
        }),
      { seed: 20261021, runs: 100 },
    );

    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

it.effect("round-trips discovered team rows through the codec", () =>
  Effect.gen(function* () {
    const atDate = DateTime.toDateUtc(at);
    const row = {
      id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b2",
      connectionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
      userId: "owner",
      provider: "yahoo" as const,
      providerTeamKey: "461.l.1000.t.1",
      providerLeagueKey: "461.l.1000",
      league: "nfl" as const,
      sport: "football" as const,
      season: 2026,
      name: "Alpha",
      availability: "available" as const,
      automationEnabled: false,
      pausedUntil: null,
      lastSeenAt: atDate,
      createdAt: atDate,
      updatedAt: atDate,
    };
    const decoded = yield* Schema.decodeEffect(FantasyTeamRow)(row);

    assert.strictEqual(decoded.providerTeamKey, "461.l.1000.t.1");
    assert.strictEqual(decoded.league, "nfl");
    assert.strictEqual(decoded.automationEnabled, false);
    assert.deepStrictEqual(decoded.lastSeenAt, at);
    assert.isTrue(
      yield* Effect.isFailure(Schema.decodeEffect(FantasyTeamRow)({ ...row, season: 1800 })),
    );
  }),
);

it.effect("rejects incomplete lifecycle rows through the codec", () =>
  Effect.gen(function* () {
    const base = {
      id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
      userId: "owner",
      requestId: "request",
      pairingCode: "ABCD2345",
      provider: "yahoo",
      expiresAt: at,
      approvedAt: at,
      credentialGeneration: 1,
      reconnectRequiredAt: at,
      disconnectedAt: at,
      createdAt: at,
      updatedAt: at,
    };

    yield* Effect.forEach(
      [
        { ...base, status: "linking", expiresAt: null },
        { ...base, status: "ready", approvedAt: null },
        { ...base, status: "ready", credentialGeneration: null },
        { ...base, status: "reconnect-required", reconnectRequiredAt: null },
        { ...base, status: "reconnect-required", credentialGeneration: null },
      ],
      (row) =>
        Effect.gen(function* () {
          assert.isTrue(yield* Effect.isFailure(Schema.decodeUnknownEffect(ConnectionRow)(row)));
        }),
    );
  }),
);

function makeGeneration(value: number): ConnectionCredentialGeneration {
  return Schema.decodeSync(ConnectionCredentialGeneration)(value);
}

const at = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const input = {
  _tag: "Linking" as const,
  provider: "yahoo" as const,
  pairingCode: "ABCD2345",
  expiresAt: DateTime.makeUnsafe("2026-01-01T00:10:00Z"),
  updatedAt: at,
};
const events = [
  {
    _tag: "LinkCompleted" as const,
    at: DateTime.makeUnsafe("2026-01-02T00:00:00Z"),
    credentialGeneration: makeGeneration(1),
  },
  { _tag: "ReconnectRequired" as const, at: DateTime.makeUnsafe("2026-01-03T00:00:00Z") },
  {
    _tag: "Reconnected" as const,
    at: DateTime.makeUnsafe("2026-01-04T00:00:00Z"),
    credentialGeneration: makeGeneration(2),
  },
  { _tag: "Disconnected" as const, at: DateTime.makeUnsafe("2026-01-05T00:00:00Z") },
];
