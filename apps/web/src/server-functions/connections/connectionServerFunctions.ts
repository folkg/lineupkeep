import { ConnectionIdInput } from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Array, Effect, Schema } from "effect";

import { runUseCase } from "#server/backendEntry.ts";
import {
  loadConnectionChange,
  loadConnectionViews,
} from "#server/connections/connectionOverview.ts";
import {
  ConnectionInputInvalid,
  mapConnectionError,
} from "#server/connections/connectionPresentation.ts";

export const listConnectionsServerFn = createServerFn({ method: "GET" }).handler(() =>
  runUseCase(
    getRequest(),
    "connections.list",
    (userId) => loadConnectionViews(userId),
    mapConnectionError,
  ),
);

export const disconnectServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof ConnectionIdInput.Encoded) => Schema.decodeResult(ConnectionIdInput)(raw))
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "connections.disconnect",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => ConnectionInputInvalid.make({})),
          );
          const disconnected = yield* Connections.use((service) =>
            service.disconnect(userId, [input]),
          );
          return yield* loadConnectionChange(userId, Array.getUnsafe(disconnected, 0));
        }),
      mapConnectionError,
    );
  });
