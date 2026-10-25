import { AuthService } from "@lineupkeep/backend/auth/Auth";
import {
  CompleteLinkingInput,
  ConnectionIdInput,
  ReconnectInput,
  StartLinkingInput,
  StartReconnectInput,
} from "@lineupkeep/backend/connections/Connection";
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
          const all = yield* Connections.use((service) => service.list(userId));
          return {
            connection: toConnectionView(connection),
            connections: all.map(toConnectionView),
          } satisfies ConnectionChangeView;
        }),
      mapConnectionError,
    );
  });

export const completeLinkingServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof CompleteLinkingInput.Encoded) =>
    Schema.decodeResult(CompleteLinkingInput)(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "connections.complete_linking",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => ConnectionInputInvalid.make({})),
          );
          const completed = yield* Connections.use((service) =>
            service.completeLinking(userId, [input]),
          );
          const all = yield* Connections.use((service) => service.list(userId));
          return {
            connection: toConnectionView(Array.getUnsafe(completed, 0)),
            connections: all.map(toConnectionView),
          } satisfies ConnectionChangeView;
        }),
      mapConnectionError,
    );
  });

export const startReconnectServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof StartReconnectInput.Encoded) =>
    Schema.decodeResult(StartReconnectInput)(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "connections.start_reconnect",
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
          const started = yield* Connections.use((service) =>
            service.startReconnect(userId, [input]),
          );
          yield* auth.approveDeviceAuthorization(request.headers, input.pairingCode).pipe(
            Effect.catchTags({
              DeviceAuthorizationRejected: (error) =>
                error.reason === "invalid_request"
                  ? Effect.void
                  : Effect.fail(ConnectionDeviceRejected.make({ reason: error.reason })),
              AuthenticationUnavailable: (error) => Effect.die(error),
              AuthenticationInvalidResponse: (error) => Effect.die(error),
            }),
          );
          const all = yield* Connections.use((service) => service.list(userId));
          return {
            connection: toConnectionView(Array.getUnsafe(started, 0)),
            connections: all.map(toConnectionView),
          } satisfies ConnectionChangeView;
        }),
      mapConnectionError,
    );
  });

export const reconnectServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof ReconnectInput.Encoded) => Schema.decodeResult(ReconnectInput)(raw))
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "connections.reconnect",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => ConnectionInputInvalid.make({})),
          );
          const reconnected = yield* Connections.use((service) =>
            service.reconnect(userId, [input]),
          );
          const all = yield* Connections.use((service) => service.list(userId));
          return {
            connection: toConnectionView(Array.getUnsafe(reconnected, 0)),
            connections: all.map(toConnectionView),
          } satisfies ConnectionChangeView;
        }),
      mapConnectionError,
    );
  });

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
          const all = yield* Connections.use((service) => service.list(userId));
          return {
            connection: toConnectionView(Array.getUnsafe(disconnected, 0)),
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
