import { UserId } from "@lineupkeep/backend/auth/User";
import { Schema } from "effect";

export const ConnectionId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ConnectionId"),
);
export type ConnectionId = typeof ConnectionId.Type;
export const decodeConnectionId = Schema.decodeUnknownSync(ConnectionId);

export const Provider = Schema.Literals(["yahoo"]);
export type Provider = typeof Provider.Type;

export const ConnectionStatus = Schema.Literals(["linking", "disconnected"]);
export type ConnectionStatus = typeof ConnectionStatus.Type;

const ConnectionTimestamp = Schema.DateTimeUtc;

export const ProviderConnection = Schema.Struct({
  id: ConnectionId,
  userId: UserId,
  provider: Provider,
  status: ConnectionStatus,
  linkingExpiresAt: Schema.optional(ConnectionTimestamp),
  disconnectedAt: Schema.optional(ConnectionTimestamp),
  createdAt: ConnectionTimestamp,
  updatedAt: ConnectionTimestamp,
});
export type ProviderConnection = typeof ProviderConnection.Type;

const ConnectionRequestId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ConnectionRequestId"),
);

export const StartLinkingInput = Schema.Struct({
  requestId: ConnectionRequestId,
  provider: Provider,
});
export type StartLinkingInput = typeof StartLinkingInput.Type;

export const ConnectionIdInput = Schema.Struct({
  id: ConnectionId,
});
export type ConnectionIdInput = typeof ConnectionIdInput.Type;

export type ConnectionError =
  | ConnectionNotFound
  | ConnectionCreateFailed
  | ConnectionPersistenceFailed;

export class ConnectionNotFound extends Schema.TaggedError<
  ConnectionNotFound,
  { readonly brand: unique symbol }
>()("connection.not_found", {
  id: ConnectionId,
}) {}

export class ConnectionCreateFailed extends Schema.TaggedError<
  ConnectionCreateFailed,
  { readonly brand: unique symbol }
>()("connection.create_failed", {}) {}

export class ConnectionPersistenceFailed extends Schema.TaggedError<
  ConnectionPersistenceFailed,
  { readonly brand: unique symbol }
>()("connection.persistence_failed", {
  cause: Schema.Defect(),
}) {}
