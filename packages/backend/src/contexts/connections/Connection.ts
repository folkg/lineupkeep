import { UserId } from "@lineupkeep/backend/auth/User";
import { Schema } from "effect";

import { ProviderKey } from "./ProviderKey.ts";

export { ProviderKey };

export const ConnectionId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ConnectionId"),
);
export type ConnectionId = typeof ConnectionId.Type;
export const decodeConnectionId = Schema.decodeUnknownSync(ConnectionId);

export const ConnectionStatus = Schema.Literals([
  "linking",
  "ready",
  "reconnect-required",
  "disconnected",
]);
export type ConnectionStatus = typeof ConnectionStatus.Type;

export const ConnectionCredentialGeneration = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("ConnectionCredentialGeneration"),
);
export type ConnectionCredentialGeneration = typeof ConnectionCredentialGeneration.Type;

const ConnectionTimestamp = Schema.DateTimeUtc;

export const ProviderConnection = Schema.Struct({
  id: ConnectionId,
  userId: UserId,
  provider: ProviderKey,
  status: ConnectionStatus,
  pairingCode: Schema.optional(Schema.String),
  linkingExpiresAt: Schema.optional(ConnectionTimestamp),
  approvedAt: Schema.optional(ConnectionTimestamp),
  credentialGeneration: Schema.optional(ConnectionCredentialGeneration),
  reconnectRequiredAt: Schema.optional(ConnectionTimestamp),
  disconnectedAt: Schema.optional(ConnectionTimestamp),
  reconnectCode: Schema.optional(Schema.String),
  reconnectExpiresAt: Schema.optional(ConnectionTimestamp),
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

const ProviderSessionValue = Schema.RedactedFromValue(
  Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(8_192))),
);

export const StartLinkingInput = Schema.Struct({
  requestId: ConnectionRequestId,
  provider: ProviderKey,
  pairingCode: ConnectionPairingCode,
});
export type StartLinkingInput = typeof StartLinkingInput.Type;

export const ConnectionIdInput = Schema.Struct({
  id: ConnectionId,
});
export type ConnectionIdInput = typeof ConnectionIdInput.Type;

export const CompleteLinkingInput = Schema.Struct({
  id: ConnectionId,
  provider: ProviderKey,
  session: ProviderSessionValue,
});
export type CompleteLinkingInput = typeof CompleteLinkingInput.Type;

export const StartReconnectInput = Schema.Struct({
  requestId: ConnectionRequestId,
  id: ConnectionId,
  pairingCode: ConnectionPairingCode,
});
export type StartReconnectInput = typeof StartReconnectInput.Type;

export const CompleteReconnectInput = Schema.Struct({
  id: ConnectionId,
  provider: ProviderKey,
  session: ProviderSessionValue,
});
export type CompleteReconnectInput = typeof CompleteReconnectInput.Type;

export const ReconnectInput = Schema.Struct({
  id: ConnectionId,
  provider: ProviderKey,
  session: ProviderSessionValue,
  expectedGeneration: ConnectionCredentialGeneration,
});
export type ReconnectInput = typeof ReconnectInput.Type;

export type ConnectionError =
  | ConnectionNotFound
  | ConnectionCreateFailed
  | ConnectionLinkExpired
  | ConnectionLinkRejected
  | ConnectionProviderRejected
  | ConnectionProviderUnavailable
  | ConnectionCredentialGenerationStale
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

export class ConnectionProviderRejected extends Schema.TaggedError<
  ConnectionProviderRejected,
  { readonly brand: unique symbol }
>()("connection.provider_rejected", {
  id: ConnectionId,
}) {}

export class ConnectionProviderUnavailable extends Schema.TaggedError<
  ConnectionProviderUnavailable,
  { readonly brand: unique symbol }
>()("connection.provider_unavailable", {
  id: ConnectionId,
  reason: Schema.Literals(["unavailable", "invalid_response"]),
}) {}

export class ConnectionCredentialGenerationStale extends Schema.TaggedError<
  ConnectionCredentialGenerationStale,
  { readonly brand: unique symbol }
>()("connection.credential_generation_stale", {
  id: ConnectionId,
  expectedGeneration: ConnectionCredentialGeneration,
  actualGeneration: ConnectionCredentialGeneration,
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
