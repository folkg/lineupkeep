import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";

import { decodeUserId } from "#contexts/auth/User.ts";
import {
  decodeConnectionId,
  ConnectionCredentialGeneration,
} from "#contexts/connections/Connection.ts";

import { initialConnectionIncidentState } from "./ConnectionIncidentWorkflow.ts";
import { ConnectionIncidentsRow } from "./IncidentTables.ts";

const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
const later = DateTime.makeUnsafe("2026-10-25T12:01:00Z");

it.effect("round-trips all incident fields in open and resolved rows", () =>
  Effect.gen(function* () {
    const record = {
      id: "incident-id",
      userId: decodeUserId("incident-owner"),
      connectionId: decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"),
      credentialGeneration: yield* Schema.decodeEffect(ConnectionCredentialGeneration)(1),
      operation: "discover_teams",
      providerStatus: 403,
      providerDetail: "expired session",
    };
    for (const state of [
      initialConnectionIncidentState(at),
      {
        _tag: "resolved" as const,
        openedAt: at,
        resolvedAt: later,
        resolution: "reconnected" as const,
      },
    ]) {
      const stored = yield* Schema.encodeEffect(ConnectionIncidentsRow)({ ...record, state });
      const decoded = yield* Schema.decodeEffect(ConnectionIncidentsRow)(stored);
      assert.isTrue(Schema.toEquivalence(ConnectionIncidentsRow)(decoded, { ...record, state }));
      assert.strictEqual(decoded.state._tag, stored.status);
      const repeated = yield* Schema.encodeEffect(ConnectionIncidentsRow)(decoded);
      assert.isTrue(
        Schema.toEquivalence(Schema.toEncoded(ConnectionIncidentsRow))(repeated, stored),
      );
    }
  }),
);

it.effect("rejects inconsistent open and resolved row fields", () =>
  Effect.gen(function* () {
    const open = yield* Schema.encodeEffect(ConnectionIncidentsRow)({
      id: "incident-id",
      userId: decodeUserId("incident-owner"),
      connectionId: decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"),
      credentialGeneration: yield* Schema.decodeEffect(ConnectionCredentialGeneration)(1),
      operation: null,
      providerStatus: null,
      providerDetail: null,
      state: initialConnectionIncidentState(at),
    });
    for (const row of [
      { ...open, resolution: "disconnected" },
      { ...open, status: "resolved", resolvedAt: later },
      { ...open, status: "resolved", resolution: "reconnected" },
    ]) {
      const result = yield* Effect.result(Schema.decodeUnknownEffect(ConnectionIncidentsRow)(row));
      assert.strictEqual(result._tag, "Failure");
    }
  }),
);
