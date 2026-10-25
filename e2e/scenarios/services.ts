import { ConnectionIdInput, StartLinkingInput } from "@lineupkeep/backend/connections/Connection";
import type { ProviderConnection } from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import { Array, DateTime, Effect, Schema } from "effect";

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

function observeConnection(connection: ProviderConnection): ObservedConnection {
  return {
    id: connection.id,
    status: connection.status,
    ...(connection.linkingExpiresAt === undefined
      ? {}
      : { linkingExpiresAt: DateTime.formatIso(connection.linkingExpiresAt) }),
    ...(connection.disconnectedAt === undefined
      ? {}
      : { disconnectedAt: DateTime.formatIso(connection.disconnectedAt) }),
  };
}

type ObservedConnection = {
  readonly id: string;
  readonly status: ProviderConnection["status"];
  readonly linkingExpiresAt?: string;
  readonly disconnectedAt?: string;
};
