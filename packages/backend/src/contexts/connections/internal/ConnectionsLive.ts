import { Array, Crypto, DateTime, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import {
  ConnectionLinkExpired,
  ConnectionLinkRejected,
  ConnectionNotFound,
  ConnectionPersistenceFailed,
  ConnectionProviderRejected,
  ConnectionProviderUnavailable,
  StartLinkingInput as StartLinkingInputSchema,
} from "#contexts/connections/Connection.ts";
import type { ConnectionStatus } from "#contexts/connections/Connection.ts";
import type {
  CompleteLinkingInput,
  CompleteReconnectInput,
  ConnectionError,
  ConnectionId,
  ConnectionIdInput,
  LinkInput,
  ProviderConnection,
  StartLinkingInput,
} from "#contexts/connections/Connection.ts";
import { Connections } from "#contexts/connections/Connections.ts";
import type { FantasyTeam } from "#contexts/connections/FantasyTeam.ts";
import type { ProviderFailure } from "#contexts/connections/Provider.ts";
import type { ProviderKey } from "#contexts/connections/ProviderKey.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import type { ConnectionLifecycleState } from "./ConnectionLifecycleWorkflow.ts";
import { ConnectionRepository } from "./ConnectionRepository.ts";
import type {
  CompleteLinkingCommand,
  ReadyCredential,
  ReconnectCommand,
  TeamDiscovery,
} from "./ConnectionRepository.ts";

export const ConnectionsLive = Layer.effect(
  Connections,
  Effect.gen(function* () {
    const repository = yield* ConnectionRepository;
    const registry = yield* ProviderRegistry;
    const encryption = yield* ConnectionCredentialEncryption;
    const crypto = yield* Crypto.Crypto;

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

    const disconnect = (
      userId: UserId,
      inputs: ReadonlyArray<ConnectionIdInput>,
    ): Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError> =>
      repository.disconnect(userId, inputs).pipe(Effect.tap(annotateOneConnection));

    const validateSession = (
      id: ConnectionId,
      input: {
        readonly provider: ProviderKey;
        readonly session: Parameters<typeof encryption.encrypt>[0]["plaintext"];
      },
    ): Effect.Effect<void, ConnectionError> =>
      registry.requireProvider(input.provider).pipe(
        Effect.mapError(() => ConnectionProviderRejected.make({ id })),
        Effect.flatMap((provider) =>
          provider
            .validateSession({ provider: input.provider, session: input.session })
            .pipe(Effect.mapError((error) => connectionProviderError(id, error))),
        ),
      );

    const encryptCredential = (
      userId: UserId,
      id: ConnectionId,
      input: {
        readonly provider: ProviderKey;
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

    const link = (
      userId: UserId,
      inputs: ReadonlyArray<LinkInput>,
    ): Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError> =>
      Effect.gen(function* () {
        if (inputs.length === 0) {
          return [];
        }
        const starts = yield* Effect.forEach(inputs, (input) =>
          crypto.randomULID.pipe(
            Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
            Effect.flatMap((requestId) =>
              Schema.decodeEffect(StartLinkingInputSchema)({
                requestId,
                provider: input.provider,
              }).pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause }))),
            ),
          ),
        );
        const started = yield* startLinking(userId, starts);
        const startedIds = started.map((connection) => connection.id);
        return yield* completeLinking(
          userId,
          inputs.map((input, index) => ({
            id: Array.getUnsafe(started, index).id,
            provider: input.provider,
            session: input.session,
          })),
        ).pipe(
          Effect.onError(() => repository.discardLinking(userId, startedIds).pipe(Effect.ignore)),
        );
      });

    const completeReconnect = (
      userId: UserId,
      inputs: ReadonlyArray<CompleteReconnectInput>,
    ): Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError> =>
      Effect.gen(function* () {
        const owned = yield* repository.loadOwned(
          userId,
          inputs.map((input) => input.id),
        );
        const byId = new Map(owned.map((record) => [record.id, record]));
        for (const input of inputs) {
          const record = byId.get(input.id);
          if (record === undefined) {
            return yield* ConnectionNotFound.make({ id: input.id });
          }
          if (record.state._tag !== "Ready" && record.state._tag !== "ReconnectRequired") {
            return yield* ConnectionLinkRejected.make({
              id: input.id,
              status: statusOf(record),
            });
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
        const commands: ReadonlyArray<ReconnectCommand> = inputs.map((input, index) => {
          const record = byId.get(input.id);
          if (record?.state._tag !== "Ready" && record?.state._tag !== "ReconnectRequired") {
            throw new Error("A reconnect target lost its generation before it was persisted");
          }
          return {
            id: input.id,
            provider: input.provider,
            envelope: Array.getUnsafe(encrypted, index),
            expectedGeneration: record.state.credentialGeneration,
          };
        });
        return yield* repository
          .reconnect(userId, commands)
          .pipe(Effect.tap(annotateOneConnection));
      });

    const listTeams = (
      userId: UserId,
    ): Effect.Effect<ReadonlyArray<FantasyTeam>, ConnectionError> =>
      repository
        .listTeams(userId)
        .pipe(
          Effect.tap((teams) => Effect.annotateCurrentSpan("connections.team_count", teams.length)),
        );

    const discoverTeams = (
      userId: UserId,
      inputs: ReadonlyArray<ConnectionIdInput>,
    ): Effect.Effect<ReadonlyArray<FantasyTeam>, ConnectionError> =>
      Effect.gen(function* () {
        const ids = [...new Set(inputs.map((input) => input.id))];
        if (ids.length === 0) {
          return [];
        }
        const owned = yield* repository.loadOwned(userId, ids);
        const byId = new Map(owned.map((record) => [record.id, record]));
        for (const id of ids) {
          const record = byId.get(id);
          if (record === undefined) {
            return yield* ConnectionNotFound.make({ id });
          }
          if (record.state._tag !== "Ready") {
            return yield* ConnectionLinkRejected.make({
              id,
              status: statusOf(record),
            });
          }
        }
        const credentials = yield* repository.loadCredentials(userId, ids);
        for (const credential of credentials) {
          const record = byId.get(credential.connectionId);
          if (
            record?.state._tag !== "Ready" ||
            record.state.credentialGeneration !== credential.generation
          ) {
            return yield* credentialPersistenceFailure();
          }
        }
        const at = yield* DateTime.now;
        const discoveries = yield* Effect.forEach(
          credentials,
          (credential) => discoverConnection(userId, credential, at),
          { concurrency: 1 },
        );
        yield* repository.recordDiscoveries(userId, discoveries, at);
        const teams = yield* repository.listTeamsForConnections(userId, ids);
        yield* Effect.annotateCurrentSpan("connections.team_count", teams.length);
        return teams;
      });

    const discoverConnection = (
      userId: UserId,
      credential: ReadyCredential,
      at: DateTime.Utc,
    ): Effect.Effect<TeamDiscovery, ConnectionError> =>
      Effect.gen(function* () {
        const session = yield* encryption
          .open({
            userId,
            connectionId: credential.connectionId,
            provider: credential.provider,
            envelope: credential.envelope,
          })
          .pipe(Effect.mapError(() => credentialPersistenceFailure()));
        const provider = yield* registry
          .requireProvider(credential.provider)
          .pipe(Effect.mapError(() => credentialPersistenceFailure()));
        const teams = yield* provider
          .discoverTeams({ provider: credential.provider, session })
          .pipe(
            Effect.catch((error) => {
              if (error._tag !== "provider.session_rejected") {
                return Effect.fail(connectionProviderError(credential.connectionId, error));
              }
              return Effect.gen(function* () {
                const marked = yield* Effect.result(
                  repository.markReconnectRequired(userId, [
                    {
                      id: credential.connectionId,
                      expectedGeneration: credential.generation,
                    },
                  ]),
                );
                if (marked._tag === "Failure") {
                  if (marked.failure._tag !== "connection.credential_generation_stale") {
                    return yield* marked.failure;
                  }
                  return yield* ConnectionProviderRejected.make({
                    id: credential.connectionId,
                  });
                }
                yield* repository.recordDiscoveries(
                  userId,
                  [{ connectionId: credential.connectionId, teams: [] }],
                  at,
                );
                return yield* ConnectionProviderRejected.make({ id: credential.connectionId });
              });
            }),
          );
        return { connectionId: credential.connectionId, teams };
      });

    return Connections.of({
      list,
      link,
      completeReconnect,
      disconnect,
      discoverTeams,
      listTeams,
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
