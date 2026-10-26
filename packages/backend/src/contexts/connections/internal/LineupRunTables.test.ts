import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";

import { decodeUserId } from "#contexts/auth/User.ts";
import { decodeConnectionId } from "#contexts/connections/Connection.ts";
import { decodeTeamId } from "#contexts/connections/FantasyTeam.ts";
import { LineupRequestId, LineupRunId, LineupUuid } from "#contexts/connections/LineupRun.ts";

import { LineupDeliveryRow, LineupRunRow, LineupWriteIntentRow } from "./LineupRunTables.ts";
import type {
  LineupDeliveryRecord,
  LineupRunRecord,
  LineupWriteIntentRecord,
} from "./LineupRunTables.ts";

it.effect("round-trips a queued run through the JSON row codec", () =>
  Effect.gen(function* () {
    const record: LineupRunRecord = {
      id: yield* Schema.decodeEffect(LineupRunId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"),
      userId: decodeUserId("owner"),
      requestId: yield* Schema.decodeEffect(LineupRequestId)(
        "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3",
      ),
      teamId: decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a4"),
      connectionId: decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a5"),
      trigger: "manual",
      scheduleKey: null,
      target: { coverage: "week", week: 3 },
      status: "queued",
      state: {
        _tag: "Queued",
        team: decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a4"),
        target: { coverage: "week", week: 3 },
        trigger: "manual",
        implementation: "provider_native",
        implementationVersion: "provider-native/1",
        queuedAt: at,
        updatedAt: at,
      },
      implementation: "provider_native",
      implementationVersion: "provider-native/1",
      attempts: 0,
      nextActionAt: null,
      createdAt: at,
      updatedAt: at,
    };

    const encoded = yield* Schema.encodeEffect(LineupRunRow)(record);
    const decoded = yield* Schema.decodeEffect(LineupRunRow)(encoded);

    assert.isTrue(Schema.toEquivalence(LineupRunRow)(decoded, record));
    assert.strictEqual(encoded.status, "queued");
    assert.deepStrictEqual(encoded.updatedAt, DateTime.toDateUtc(at));
    assert.strictEqual(typeof encoded.state, "object");
  }),
);

it.effect("round-trips delivery and write-intent rows", () =>
  Effect.gen(function* () {
    const runId = yield* Schema.decodeEffect(LineupRunId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");
    const delivery: LineupDeliveryRecord = {
      id: yield* Schema.decodeEffect(LineupUuid)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a6"),
      userId: decodeUserId("owner"),
      requestId: yield* Schema.decodeEffect(LineupRequestId)(
        "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3",
      ),
      status: "pending",
      attempts: 0,
      runIds: [runId],
      lastError: null,
      createdAt: at,
      updatedAt: at,
      dispatchedAt: null,
    };
    const deliveryRow = yield* Schema.encodeEffect(LineupDeliveryRow)(delivery);
    const deliveryDecoded = yield* Schema.decodeEffect(LineupDeliveryRow)(deliveryRow);
    assert.isTrue(Schema.toEquivalence(LineupDeliveryRow)(deliveryDecoded, delivery));

    const intent: LineupWriteIntentRecord = {
      id: yield* Schema.decodeEffect(LineupUuid)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a7"),
      runId,
      attempt: 1,
      userId: decodeUserId("owner"),
      teamId: decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a4"),
      connectionId: decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a5"),
      connectionGeneration: 2,
      leaseToken: yield* Schema.decodeEffect(LineupUuid)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a8"),
      leaseGeneration: 4,
      action: "start_active_players",
      target: { coverage: "week", week: 3 },
      before: [
        {
          key: "461.p.10001",
          name: "Locked Starter",
          slot: "QB",
          editable: false,
        },
      ],
      status: "intended",
      createdAt: at,
      updatedAt: at,
    };
    const intentRow = yield* Schema.encodeEffect(LineupWriteIntentRow)(intent);
    const intentDecoded = yield* Schema.decodeEffect(LineupWriteIntentRow)(intentRow);
    assert.isTrue(Schema.toEquivalence(LineupWriteIntentRow)(intentDecoded, intent));
    assert.strictEqual(intentRow.status, "intended");

    const explicit: LineupWriteIntentRecord = {
      ...intent,
      id: yield* Schema.decodeEffect(LineupUuid)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a9"),
      action: "explicit_assignments",
      status: "verified_mismatch",
      plan: {
        _tag: "explicit_assignments",
        target: { coverage: "week", week: 3 },
        connectionGeneration: 2,
        lockedPlayers: 0,
        editablePlayers: 1,
        policy: {
          kind: "planned",
          version: "trailing-mean-points/1",
          basis: "yahoo:mean-points-per-period:week:2",
        },
        assignments: [{ playerKey: "461.p.10001", slot: "BN" }],
        sourceChanged: false,
      },
    };
    const explicitRow = yield* Schema.encodeEffect(LineupWriteIntentRow)(explicit);
    const explicitDecoded = yield* Schema.decodeEffect(LineupWriteIntentRow)(explicitRow);
    assert.isTrue(Schema.toEquivalence(LineupWriteIntentRow)(explicitDecoded, explicit));
    assert.strictEqual(explicitRow.action, "explicit_assignments");
    assert.deepStrictEqual(explicitRow.plan, {
      _tag: "explicit_assignments",
      target: { coverage: "week", week: 3 },
      connectionGeneration: 2,
      lockedPlayers: 0,
      editablePlayers: 1,
      policy: {
        kind: "planned",
        version: "trailing-mean-points/1",
        basis: "yahoo:mean-points-per-period:week:2",
      },
      assignments: [{ playerKey: "461.p.10001", slot: "BN" }],
      sourceChanged: false,
    });
  }),
);

it.effect("rejects a stored run whose status disagrees with its state", () =>
  Effect.gen(function* () {
    const runId = yield* Schema.decodeEffect(LineupRunId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");
    const teamId = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a4");
    const row = {
      id: runId,
      userId: decodeUserId("owner"),
      requestId: yield* Schema.decodeEffect(LineupRequestId)(
        "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3",
      ),
      teamId,
      connectionId: decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a5"),
      trigger: "manual" as const,
      scheduleKey: null,
      target: { coverage: "week" as const, week: 3 },
      status: "completed" as const,
      state: {
        _tag: "Queued" as const,
        team: teamId,
        target: { coverage: "week" as const, week: 3 },
        trigger: "manual" as const,
        implementation: "provider_native" as const,
        implementationVersion: "provider-native/1",
        queuedAt: DateTime.toDateUtc(at),
        updatedAt: DateTime.toDateUtc(at),
      },
      implementation: "provider_native" as const,
      implementationVersion: "provider-native/1",
      attempts: 0,
      nextActionAt: null,
      createdAt: DateTime.toDateUtc(at),
      updatedAt: DateTime.toDateUtc(at),
    };

    const exit = yield* Effect.exit(Schema.decodeEffect(LineupRunRow)(row));
    assert.strictEqual(exit._tag, "Failure");
  }),
);

const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
