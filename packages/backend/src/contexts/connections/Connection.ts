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

export const ConnectionStatus = Schema.Literals(["linking", "ready", "disconnected"]);
export type ConnectionStatus = typeof ConnectionStatus.Type;

const ConnectionTimestamp = Schema.DateTimeUtc;

export const ProviderConnection = Schema.Struct({
  id: ConnectionId,
  userId: UserId,
  provider: Provider,
  status: ConnectionStatus,
  pairingCode: Schema.optional(Schema.String),
  linkingExpiresAt: Schema.optional(ConnectionTimestamp),
  approvedAt: Schema.optional(ConnectionTimestamp),
  disconnectedAt: Schema.optional(ConnectionTimestamp),
  createdAt: ConnectionTimestamp,
  updatedAt: ConnectionTimestamp,
});
export type ProviderConnection = typeof ProviderConnection.Type;

const ConnectionRequestId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ConnectionRequestId"),
);

const ConnectionPairingCode = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  Schema.brand("ConnectionPairingCode"),
);

export const StartLinkingInput = Schema.Struct({
  requestId: ConnectionRequestId,
  provider: Provider,
  pairingCode: ConnectionPairingCode,
});
export type StartLinkingInput = typeof StartLinkingInput.Type;

export const ConnectionIdInput = Schema.Struct({
  id: ConnectionId,
});
export type ConnectionIdInput = typeof ConnectionIdInput.Type;

export type ConnectionError =
  | ConnectionNotFound
  | ConnectionCreateFailed
  | ConnectionLinkExpired
  | ConnectionLinkRejected
  | ConnectionPersistenceFailed;

export class ConnectionNotFound extends Schema.TaggedError<
  ConnectionNotFound,
  { readonly brand: unique symbol }
>()("connection.not_found", {
  id: ConnectionId,
}) {}

export class ConnectionLinkExpired extends Schema.TaggedError<
  ConnectionLinkExpired,
  { readonly brand: unique symbol }
>()("connection.link_expired", {
  id: ConnectionId,
}) {}

export class ConnectionLinkRejected extends Schema.TaggedError<
  ConnectionLinkRejected,
  { readonly brand: unique symbol }
>()("connection.link_rejected", {
  id: ConnectionId,
  status: ConnectionStatus,
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
