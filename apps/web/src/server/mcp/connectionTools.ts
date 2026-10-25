import type { UserId } from "@lineupkeep/backend/auth/User";
import {
  ConnectionId,
  ConnectionStatus,
  Provider,
} from "@lineupkeep/backend/connections/Connection";
import type {
  ConnectionError,
  ProviderConnection,
} from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import { connectionScopes } from "@lineupkeep/backend/connections/ConnectionScopes";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

const ConnectionView = Schema.Struct({
  id: ConnectionId,
  provider: Provider,
  status: ConnectionStatus,
  linkingExpiresAt: Schema.optional(Schema.DateTimeUtc),
  disconnectedAt: Schema.optional(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});

export const connectionTools = Toolkit.make(
  Tool.make("list_connections", {
    description:
      "List your provider connections in ID order with safe status metadata. Linking connections await the local helper and expire; disconnected connections no longer provide access. This never returns provider credentials, account identity, or connections owned by other people.",
    parameters: Tool.EmptyParams,
    success: Schema.Struct({ connections: Schema.Array(Schema.toCodecJson(ConnectionView)) }),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, connectionScopes.read)
    .annotate(Tool.Title, "List connections")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function connectionToolHandlers(
  userId: UserId,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof connectionTools>>, never, Connections> {
  return connectionTools.toLayer(
    Effect.gen(function* () {
      const connections = yield* Connections;
      return connectionTools.of({
        list_connections: () =>
          connections.list(userId).pipe(
            Effect.map((rows) => ({ connections: rows.map(toConnectionView) })),
            mapOutcome,
          ),
      });
    }),
  );
}

function toConnectionView(connection: ProviderConnection): typeof ConnectionView.Type {
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    ...(connection.linkingExpiresAt === undefined
      ? {}
      : { linkingExpiresAt: connection.linkingExpiresAt }),
    ...(connection.disconnectedAt === undefined
      ? {}
      : { disconnectedAt: connection.disconnectedAt }),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function mapOutcome<A>(
  program: Effect.Effect<A, ConnectionError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "connection.link_expired":
        case "connection.link_rejected":
        case "connection.not_found":
          return reject(
            error._tag,
            "Connection not found or no longer awaiting approval. List your connections again.",
          );
        case "connection.create_failed":
        case "connection.persistence_failed":
          return Effect.annotateCurrentSpan({
            "app.outcome": "failure",
            "error.type": error._tag,
          }).pipe(
            Effect.andThen(
              Effect.die(
                new Error("Connection state could not be confirmed. List your connections again."),
              ),
            ),
          );
      }
    }),
  );
}

function reject(
  code: string,
  message: string,
): Effect.Effect<never, { code: string; message: string }, never> {
  return Effect.annotateCurrentSpan({ "app.outcome": "rejected", "error.type": code }).pipe(
    Effect.andThen(Effect.fail({ code, message })),
  );
}
