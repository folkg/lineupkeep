import { AuthService } from "@lineupkeep/backend/auth/Auth";
import { ConnectionIdInput, StartLinkingInput } from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Array, Effect, Schema } from "effect";

import type { ConnectionChangeView } from "#contracts/connections/connectionContract.ts";
import { runUseCase } from "#server/backendEntry.ts";
import {
  ConnectionDeviceRejected,
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
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "connections.start_linking",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => ConnectionInputInvalid.make({})),
          );
          const auth = yield* AuthService;
          yield* auth.claimDeviceAuthorization(request.headers, input.pairingCode).pipe(
            Effect.catchTags({
              DeviceAuthorizationRejected: (error) =>
                Effect.fail(ConnectionDeviceRejected.make({ reason: error.reason })),
              AuthenticationUnavailable: (error) => Effect.die(error),
              AuthenticationInvalidResponse: (error) => Effect.die(error),
            }),
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
    );
  });

export const approveLinkingServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof ConnectionIdInput.Encoded) => Schema.decodeResult(ConnectionIdInput)(raw))
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "connections.approve_linking",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => ConnectionInputInvalid.make({})),
          );
          const existing = yield* Connections.use((service) => service.list(userId));
          const connection = existing.find((candidate) => candidate.id === input.id);
          if (connection?.pairingCode === undefined) {
            return yield* ConnectionInputInvalid.make({});
          }
          const auth = yield* AuthService;
          yield* auth.approveDeviceAuthorization(request.headers, connection.pairingCode).pipe(
            Effect.catchTags({
              DeviceAuthorizationRejected: (error) =>
                error.reason === "invalid_request"
                  ? Effect.void
                  : Effect.fail(ConnectionDeviceRejected.make({ reason: error.reason })),
              AuthenticationUnavailable: (error) => Effect.die(error),
              AuthenticationInvalidResponse: (error) => Effect.die(error),
            }),
          );
          const approved = yield* Connections.use((service) =>
            service.approveLinking(userId, [input]),
          );
          const all = yield* Connections.use((service) => service.list(userId));
          return {
            connection: toConnectionView(Array.getUnsafe(approved, 0)),
            connections: all.map(toConnectionView),
          } satisfies ConnectionChangeView;
        }),
      mapConnectionError,
    );
  });

export const cancelLinkingServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof ConnectionIdInput.Encoded) => Schema.decodeResult(ConnectionIdInput)(raw))
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "connections.cancel_linking",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => ConnectionInputInvalid.make({})),
          );
          const existing = yield* Connections.use((service) => service.list(userId));
          const connection = existing.find((candidate) => candidate.id === input.id);
          if (connection?.pairingCode !== undefined) {
            const auth = yield* AuthService;
            yield* auth
              .denyDeviceAuthorization(request.headers, connection.pairingCode)
              .pipe(Effect.ignore);
          }
          const cancelled = yield* Connections.use((service) =>
            service.cancelLinking(userId, [input]),
          );
          const all = yield* Connections.use((service) => service.list(userId));
          return {
            connection: toConnectionView(Array.getUnsafe(cancelled, 0)),
            connections: all.map(toConnectionView),
          } satisfies ConnectionChangeView;
        }),
      mapConnectionError,
    );
  });
