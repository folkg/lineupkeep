import { Array, DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import {
  ConnectionCredentialGenerationStale,
  ConnectionLinkExpired,
  ConnectionLinkRejected,
  ConnectionPersistenceFailed,
  ConnectionProviderRejected,
  ConnectionProviderUnavailable,
} from "#contexts/connections/Connection.ts";
import type { ConnectionStatus } from "#contexts/connections/Connection.ts";
import type {
  CompleteLinkingInput,
  ConnectionError,
  ConnectionId,
  ConnectionIdInput,
  ProviderConnection,
  ReconnectInput,
  StartLinkingInput,
} from "#contexts/connections/Connection.ts";
import { Connections } from "#contexts/connections/Connections.ts";
import { ProviderGateway } from "#contexts/connections/Provider.ts";
import type { ProviderFailure } from "#contexts/connections/Provider.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import type { ConnectionLifecycleState } from "./ConnectionLifecycleWorkflow.ts";
import { ConnectionRepository } from "./ConnectionRepository.ts";
import type { CompleteLinkingCommand, ReconnectCommand } from "./ConnectionRepository.ts";

export const ConnectionsLive = Layer.effect(
  Connections,
  Effect.gen(function* () {
    const repository = yield* ConnectionRepository;
    const provider = yield* ProviderGateway;
    const encryption = yield* ConnectionCredentialEncryption;

    const list = (
      userId: UserId,
    ): Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError> =>
      repository
        .listConnections(userId)
        .pipe(
          Effect.tap((connections) =>
            Effect.annotateCurrentSpan("connections.result_count", connections.length),
          ),
        );

    const startLinking = (
      userId: UserId,
      inputs: ReadonlyArray<StartLinkingInput>,
    ): Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError> =>
      repository.startLinking(userId, inputs).pipe(Effect.tap(annotateOneConnection));

    const cancelLinking = (
      userId: UserId,
      inputs: ReadonlyArray<ConnectionIdInput>,
    ): Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError> =>
      repository.cancelLinking(userId, inputs).pipe(Effect.tap(annotateOneConnection));

    const disconnect = (
      userId: UserId,
      inputs: ReadonlyArray<ConnectionIdInput>,
    ): Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError> =>
      repository.disconnect(userId, inputs).pipe(Effect.tap(annotateOneConnection));

    const validateSession = (
      id: ConnectionId,
      input: {
        readonly provider: "yahoo";
        readonly session: Parameters<typeof encryption.encrypt>[0]["plaintext"];
      },
    ): Effect.Effect<void, ConnectionError> =>
      provider
        .validateSession({ provider: input.provider, session: input.session })
        .pipe(Effect.mapError((error) => connectionProviderError(id, error)));

    const encryptCredential = (
      userId: UserId,
      id: ConnectionId,
      input: {
        readonly provider: "yahoo";
        readonly session: Parameters<typeof encryption.encrypt>[0]["plaintext"];
      },
    ): Effect.Effect<string, ConnectionError> =>
      encryption
        .encrypt({
          userId,
          connectionId: id,
          provider: input.provider,
          plaintext: input.session,
        })
        .pipe(Effect.mapError(() => credentialPersistenceFailure()));

    const completeLinking = (
      userId: UserId,
      inputs: ReadonlyArray<CompleteLinkingInput>,
    ): Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError> =>
      Effect.gen(function* () {
        const owned = yield* repository.loadOwned(
          userId,
          inputs.map((input) => input.id),
        );
        const byId = new Map(owned.map((record) => [record.id, record]));
        const now = yield* DateTime.now;
        for (const input of inputs) {
          const record = byId.get(input.id);
          if (record !== undefined) {
            const rejection = completionRejection(record, now);
            if (rejection !== undefined) {
              return yield* rejection;
            }
          }
        }

        yield* Effect.forEach(inputs, (input) => validateSession(input.id, input), {
          concurrency: 1,
        });

        const encrypted = yield* Effect.forEach(
          inputs,
          (input) => encryptCredential(userId, input.id, input),
          { concurrency: 1 },
        );

        const commands: ReadonlyArray<CompleteLinkingCommand> = inputs.map((input, index) => ({
          id: input.id,
          provider: input.provider,
          envelope: Array.getUnsafe(encrypted, index),
        }));
        return yield* repository
          .completeLinking(userId, commands)
          .pipe(Effect.tap(annotateOneConnection));
      });

    const reconnect = (
      userId: UserId,
      inputs: ReadonlyArray<ReconnectInput>,
    ): Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError> =>
      Effect.gen(function* () {
        const owned = yield* repository.loadOwned(
          userId,
          inputs.map((input) => input.id),
        );
        const byId = new Map(owned.map((record) => [record.id, record]));
        for (const input of inputs) {
          const record = byId.get(input.id);
          if (record !== undefined) {
            const rejection = reconnectRejection(record, input);
            if (rejection !== undefined) {
              return yield* rejection;
            }
          }
        }

        yield* Effect.forEach(inputs, (input) => validateSession(input.id, input), {
          concurrency: 1,
        });

        const encrypted = yield* Effect.forEach(
          inputs,
          (input) => encryptCredential(userId, input.id, input),
          { concurrency: 1 },
        );

        const commands: ReadonlyArray<ReconnectCommand> = inputs.map((input, index) => ({
          id: input.id,
          provider: input.provider,
          envelope: Array.getUnsafe(encrypted, index),
          expectedGeneration: input.expectedGeneration,
        }));
        return yield* repository
          .reconnect(userId, commands)
          .pipe(Effect.tap(annotateOneConnection));
      });

    return Connections.of({
      list,
      startLinking,
      cancelLinking,
      completeLinking,
      reconnect,
      disconnect,
    });
  }),
);

type OwnedConnection = {
  readonly id: ConnectionId;
  readonly state: typeof ConnectionLifecycleState.Type;
};

function completionRejection(
  record: OwnedConnection,
  now: DateTime.Utc,
): ConnectionError | undefined {
  if (record.state._tag !== "Linking") {
    return ConnectionLinkRejected.make({ id: record.id, status: statusOf(record) });
  }
  if (DateTime.toEpochMillis(record.state.expiresAt) <= DateTime.toEpochMillis(now)) {
    return ConnectionLinkExpired.make({ id: record.id });
  }
  return undefined;
}

function reconnectRejection(
  record: OwnedConnection,
  input: ReconnectInput,
): ConnectionError | undefined {
  if (record.state._tag !== "Ready" && record.state._tag !== "ReconnectRequired") {
    return ConnectionLinkRejected.make({ id: input.id, status: statusOf(record) });
  }
  if (record.state.credentialGeneration !== input.expectedGeneration) {
    return ConnectionCredentialGenerationStale.make({
      id: input.id,
      expectedGeneration: input.expectedGeneration,
      actualGeneration: record.state.credentialGeneration,
    });
  }
  return undefined;
}

function statusOf(record: OwnedConnection): ConnectionStatus {
  switch (record.state._tag) {
    case "Linking":
      return "linking" as const;
    case "Ready":
      return "ready" as const;
    case "ReconnectRequired":
      return "reconnect-required" as const;
    case "Disconnected":
      return "disconnected" as const;
  }
}

function connectionProviderError(id: ConnectionId, error: ProviderFailure): ConnectionError {
  switch (error._tag) {
    case "provider.session_rejected":
      return ConnectionProviderRejected.make({ id });
    case "provider.request_failed":
      return ConnectionProviderUnavailable.make({ id, reason: "unavailable" });
    case "provider.response_invalid":
      return ConnectionProviderUnavailable.make({ id, reason: "invalid_response" });
  }
}

function credentialPersistenceFailure(): ConnectionPersistenceFailed {
  return ConnectionPersistenceFailed.make({
    cause: new Error("Provider credential could not be encrypted"),
  });
}

function annotateOneConnection(
  connections: ReadonlyArray<ProviderConnection>,
): Effect.Effect<void> {
  return connections.length === 1
    ? Effect.annotateCurrentSpan("connection.id", Array.getUnsafe(connections, 0).id)
    : Effect.void;
}
