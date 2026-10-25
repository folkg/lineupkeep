import { ConnectionIdInput, StartLinkingInput } from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Array, Effect, Schema } from "effect";

import type { ConnectionChangeView } from "#contracts/connections/connectionContract.ts";
import { runUseCase } from "#server/backendEntry.ts";
import {
  ConnectionInputInvalid,
  mapConnectionError,
  toConnectionView,
} from "#server/connections/connectionPresentation.ts";

export const listConnectionsServerFn = createServerFn({ method: "GET" }).handler(() =>
  runUseCase(
    getRequest(),
    "connections.list",
    (userId) =>
      Connections.use((connections) => connections.list(userId)).pipe(
        Effect.map((rows) => rows.map(toConnectionView)),
      ),
    mapConnectionError,
  ),
);

export const startLinkingServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof StartLinkingInput.Encoded) => Schema.decodeResult(StartLinkingInput)(raw))
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "connections.start_linking",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => ConnectionInputInvalid.make({})),
          );
          const connections = yield* Connections.use((service) =>
            service.startLinking(userId, [input]),
          );
          const all = yield* Connections.use((service) => service.list(userId));
          return {
            connection: toConnectionView(Array.getUnsafe(connections, 0)),
            connections: all.map(toConnectionView),
          } satisfies ConnectionChangeView;
        }),
      mapConnectionError,
    ),
  );

export const cancelLinkingServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof ConnectionIdInput.Encoded) => Schema.decodeResult(ConnectionIdInput)(raw))
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "connections.cancel_linking",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => ConnectionInputInvalid.make({})),
          );
          const connections = yield* Connections.use((service) =>
            service.cancelLinking(userId, [input]),
          );
          const all = yield* Connections.use((service) => service.list(userId));
          return {
            connection: toConnectionView(Array.getUnsafe(connections, 0)),
            connections: all.map(toConnectionView),
          } satisfies ConnectionChangeView;
        }),
      mapConnectionError,
    ),
  );
