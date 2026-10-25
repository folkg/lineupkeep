import { Array, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { ConnectionIdInput, StartLinkingInput } from "#contexts/connections/Connection.ts";
import { Connections } from "#contexts/connections/Connections.ts";

import { ConnectionRepository } from "./ConnectionRepository.ts";

export const ConnectionsLive = Layer.effect(
  Connections,
  Effect.gen(function* () {
    const repository = yield* ConnectionRepository;

    return Connections.of({
      list: (userId: UserId) =>
        repository
          .listConnections(userId)
          .pipe(
            Effect.tap((connections) =>
              Effect.annotateCurrentSpan("connections.result_count", connections.length),
            ),
          ),
      startLinking: (userId: UserId, inputs: ReadonlyArray<StartLinkingInput>) =>
        repository
          .startLinking(userId, inputs)
          .pipe(
            Effect.tap((connections) =>
              connections.length === 1
                ? Effect.annotateCurrentSpan("connection.id", Array.getUnsafe(connections, 0).id)
                : Effect.void,
            ),
          ),
      cancelLinking: (userId: UserId, inputs: ReadonlyArray<ConnectionIdInput>) =>
        repository
          .cancelLinking(userId, inputs)
          .pipe(
            Effect.tap((connections) =>
              connections.length === 1
                ? Effect.annotateCurrentSpan("connection.id", Array.getUnsafe(connections, 0).id)
                : Effect.void,
            ),
          ),
    });
  }),
);
