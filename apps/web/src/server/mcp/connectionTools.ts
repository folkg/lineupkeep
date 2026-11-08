import type { AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
import {
  ConnectionCredentialGeneration,
  ConnectionId,
  ConnectionStatus,
  ProviderKey,
  ProviderSessionAction,
  ProviderSessionRead,
} from "@lineupkeep/backend/connections/Connection";
import type {
  ConnectionError,
  ProviderConnection,
} from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

const ProviderSessionView = Schema.Struct({
  usable: Schema.Boolean.pipe(
    Schema.annotate({
      description:
        "Whether the stored provider sign-in is usable now. False means a person must act in Lineupgrade.",
    }),
  ),
  provenAt: Schema.optional(Schema.DateTimeUtc).pipe(
    Schema.annotate({ description: "When the provider last accepted this stored sign-in." }),
  ),
  rejectedAt: Schema.optional(Schema.DateTimeUtc).pipe(
    Schema.annotate({ description: "When the provider last refused this stored sign-in." }),
  ),
  action: ProviderSessionAction.pipe(
    Schema.annotate({
      description:
        "`reconnect-provider-connection` is an action in Lineupgrade's own connection settings, not in this client.",
    }),
  ),
  actionDetail: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "One sentence naming the action and the layer it belongs to." }),
  ),
});

const ConnectionView = Schema.Struct({
  id: ConnectionId,
  provider: ProviderKey,
  status: ConnectionStatus.pipe(
    Schema.annotate({
      description:
        "`linking` awaits sign-in and expires; `reconnect-required` needs a new sign-in; `disconnected` no longer grants access.",
    }),
  ),
  session: ProviderSessionView.pipe(
    Schema.annotate({
      description:
        "The provider session's health. Its action is separate from reconnecting the MCP connector in this client.",
    }),
  ),
  linkingExpiresAt: Schema.optional(Schema.DateTimeUtc),
  credentialGeneration: Schema.optional(ConnectionCredentialGeneration),
  reconnectRequiredAt: Schema.optional(Schema.DateTimeUtc),
  disconnectedAt: Schema.optional(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});

export const connectionTools = Toolkit.make(
  Tool.make("list_connections", {
    description:
      "Your league-site connections with their status. Sign-in credentials, account identity, and other people's connections are never returned.",
    parameters: Tool.EmptyParams,
    success: Schema.Struct({ connections: Schema.Array(Schema.toCodecJson(ConnectionView)) }),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "List connections")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function connectionToolHandlers(
  agent: AuthenticatedAgent,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof connectionTools>>, never, Connections> {
  return connectionTools.toLayer(
    Effect.gen(function* () {
      const connections = yield* Connections;
      return connectionTools.of({
        list_connections: () =>
          connections.list(agent.userId).pipe(
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
    session: toProviderSessionView(connection.session),
    ...(connection.linkingExpiresAt === undefined
      ? {}
      : { linkingExpiresAt: connection.linkingExpiresAt }),
    ...(connection.credentialGeneration === undefined
      ? {}
      : { credentialGeneration: connection.credentialGeneration }),
    ...(connection.reconnectRequiredAt === undefined
      ? {}
      : { reconnectRequiredAt: connection.reconnectRequiredAt }),
    ...(connection.disconnectedAt === undefined
      ? {}
      : { disconnectedAt: connection.disconnectedAt }),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function toProviderSessionView(session: ProviderSessionRead): typeof ProviderSessionView.Type {
  return {
    usable: session.usable,
    action: session.action,
    actionDetail: session.actionDetail,
    ...(session.provenAt === undefined ? {} : { provenAt: session.provenAt }),
    ...(session.rejectedAt === undefined ? {} : { rejectedAt: session.rejectedAt }),
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
        case "connection.credential_generation_stale":
        case "connection.provider_rejected":
          return reject(
            error._tag,
            "Connection not found or no longer awaiting approval. List your connections again.",
          );
        case "connection.create_failed":
        case "connection.persistence_failed":
        case "connection.provider_unavailable":
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
