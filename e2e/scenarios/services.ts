import { ConnectionIdInput, StartLinkingInput } from "@lineupkeep/backend/connections/Connection";
import type { ProviderConnection } from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import type { FantasyTeam } from "@lineupkeep/backend/connections/FantasyTeam";
import { Array, DateTime, Effect, Redacted, Schema } from "effect";

import type { ServiceProgram } from "#e2e/serviceContract.ts";

export const startLinking: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(StartLinkingInput)(arguments_);
    const connections = yield* Connections;
    const connection = Array.getUnsafe(yield* connections.startLinking(user.id, [input]), 0);
    return observeConnection(connection);
  });

export const startLinkingBatch: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const inputs = yield* Schema.decodeUnknownEffect(Schema.Array(StartLinkingInput))(arguments_);
    const connections = yield* Connections;
    return (yield* connections.startLinking(user.id, inputs)).map(observeConnection);
  });

export const cancelLinking: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(ConnectionIdInput)(arguments_);
    const connections = yield* Connections;
    const connection = Array.getUnsafe(yield* connections.cancelLinking(user.id, [input]), 0);
    return observeConnection(connection);
  });

export const cancelLinkingBatch: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const inputs = yield* Schema.decodeUnknownEffect(Schema.Array(ConnectionIdInput))(arguments_);
    const connections = yield* Connections;
    return (yield* connections.cancelLinking(user.id, inputs)).map(observeConnection);
  });

export const connectYahooAndDiscoverTeams: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ requestId: Schema.String, pairingCode: Schema.String }),
    )(arguments_);
    const connections = yield* Connections;
    const linking = Array.getUnsafe(
      yield* connections.startLinking(user.id, [
        yield* Schema.decodeUnknownEffect(StartLinkingInput)({
          requestId: input.requestId,
          provider: "yahoo",
          pairingCode: input.pairingCode,
        }),
      ]),
      0,
    );
    const completed = Array.getUnsafe(
      yield* connections.completeLinking(user.id, [
        { id: linking.id, provider: "yahoo", session: Redacted.make("A1=e2e-provider-session") },
      ]),
      0,
    );
    const teams = yield* connections.discoverTeams(user.id, [{ id: completed.id }]);
    return teams.map(observeTeam);
  });

export const readConnections: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.Struct({}))(arguments_);
    const connections = yield* Connections;
    return (yield* connections.list(user.id)).map(observeConnection);
  });

export const rejectOperation: ServiceProgram = (_user, arguments_) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.Struct({}))(arguments_);
    return yield* Effect.fail({ _tag: "ExpectedRejection", message: "Synthetic rejection" });
  });

export const nonJsonResult: ServiceProgram = (_user, arguments_) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.Struct({}))(arguments_);
    return 1n;
  });

function observeTeam(team: FantasyTeam): ObservedTeam {
  return {
    id: team.id,
    name: team.name,
    availability: team.availability,
    automation: {
      status: team.automation.status,
      ...(team.automation.resumesAt === undefined
        ? {}
        : { resumesAt: DateTime.formatIso(team.automation.resumesAt) }),
    },
  };
}

function observeConnection(connection: ProviderConnection): ObservedConnection {
  return {
    id: connection.id,
    status: connection.status,
    ...(connection.linkingExpiresAt === undefined
      ? {}
      : { linkingExpiresAt: DateTime.formatIso(connection.linkingExpiresAt) }),
    ...(connection.credentialGeneration === undefined
      ? {}
      : { credentialGeneration: connection.credentialGeneration }),
    ...(connection.reconnectRequiredAt === undefined
      ? {}
      : { reconnectRequiredAt: DateTime.formatIso(connection.reconnectRequiredAt) }),
    ...(connection.disconnectedAt === undefined
      ? {}
      : { disconnectedAt: DateTime.formatIso(connection.disconnectedAt) }),
  };
}

type ObservedTeam = {
  readonly id: string;
  readonly name: string;
  readonly availability: FantasyTeam["availability"];
  readonly automation: {
    readonly status: FantasyTeam["automation"]["status"];
    readonly resumesAt?: string;
  };
};

type ObservedConnection = {
  readonly id: string;
  readonly status: ProviderConnection["status"];
  readonly linkingExpiresAt?: string;
  readonly credentialGeneration?: number;
  readonly reconnectRequiredAt?: string;
  readonly disconnectedAt?: string;
};
