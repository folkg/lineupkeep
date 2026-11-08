import { UserId } from "@lineupkeep/backend/auth/User";
import { Schema } from "effect";
import type { DateTime } from "effect";

import { ProviderKey } from "./ProviderKey.ts";

export { ProviderKey };

const LineupgradeId = Schema.Union([
  Schema.String.pipe(Schema.check(Schema.isUUID())),
  Schema.String.pipe(Schema.check(Schema.isULID())),
]);

export const ConnectionId = LineupgradeId.pipe(Schema.brand("ConnectionId"));
export type ConnectionId = typeof ConnectionId.Type;
export const decodeConnectionId = Schema.decodeUnknownSync(ConnectionId);

export const ConnectionStatus = Schema.Literals([
  "linking",
  "ready",
  "reconnect-required",
  "disconnected",
]);
export type ConnectionStatus = typeof ConnectionStatus.Type;

export const ProviderSessionAction = Schema.Literals([
  "none",
  "reconnect-provider-connection",
  "finish-linking",
  "relink",
]);
export type ProviderSessionAction = typeof ProviderSessionAction.Type;

export const ConnectionCredentialGeneration = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.brand("ConnectionCredentialGeneration"),
);
export type ConnectionCredentialGeneration = typeof ConnectionCredentialGeneration.Type;

const ConnectionTimestamp = Schema.DateTimeUtc;

export type ProviderSessionEvidence = {
  readonly operation: string;
  readonly status?: number;
  readonly detail?: string;
};

export const ProviderSessionRead = Schema.Struct({
  usable: Schema.Boolean,
  provenAt: Schema.optional(ConnectionTimestamp),
  rejectedAt: Schema.optional(ConnectionTimestamp),
  action: ProviderSessionAction,
  actionDetail: Schema.NonEmptyString,
});
export type ProviderSessionRead = typeof ProviderSessionRead.Type;

export const ProviderConnection = Schema.Struct({
  id: ConnectionId,
  userId: UserId,
  provider: ProviderKey,
  status: ConnectionStatus,
  session: ProviderSessionRead,
  linkingExpiresAt: Schema.optional(ConnectionTimestamp),
  approvedAt: Schema.optional(ConnectionTimestamp),
  credentialGeneration: Schema.optional(ConnectionCredentialGeneration),
  reconnectRequiredAt: Schema.optional(ConnectionTimestamp),
  disconnectedAt: Schema.optional(ConnectionTimestamp),
  createdAt: ConnectionTimestamp,
  updatedAt: ConnectionTimestamp,
});
export type ProviderConnection = typeof ProviderConnection.Type;

export const providerSessionReconnectDetail =
  "The provider rejected the stored sign-in; reconnect this connection in Lineupgrade, not the MCP connector in your client.";

export function providerSessionOf(input: {
  readonly status: ConnectionStatus;
  readonly provenAt?: DateTime.Utc;
  readonly rejectedAt?: DateTime.Utc;
}): ProviderSessionRead {
  const action = sessionActionOf(input.status);
  return {
    usable: input.status === "ready",
    action,
    actionDetail: sessionActionDetail(action),
    ...(input.provenAt === undefined ? {} : { provenAt: input.provenAt }),
    ...(input.rejectedAt === undefined ? {} : { rejectedAt: input.rejectedAt }),
  };
}

export function providerSessionRefusal(status: ConnectionStatus | "missing"): string {
  return status === "missing"
    ? "This team's connection is no longer available; link the provider again in Lineupgrade."
    : providerSessionOf({ status }).actionDetail;
}

function sessionActionOf(status: ConnectionStatus): ProviderSessionAction {
  switch (status) {
    case "ready":
      return "none";
    case "linking":
      return "finish-linking";
    case "reconnect-required":
      return "reconnect-provider-connection";
    case "disconnected":
      return "relink";
  }
}

function sessionActionDetail(action: ProviderSessionAction): string {
  switch (action) {
    case "none":
      return "No action is needed; the stored provider sign-in is working.";
    case "reconnect-provider-connection":
      return providerSessionReconnectDetail;
    case "finish-linking":
      return "The sign-in has not finished; finish linking this connection in Lineupgrade.";
    case "relink":
      return "This connection was disconnected; link the provider again in Lineupgrade.";
  }
}

const ConnectionRequestId = LineupgradeId.pipe(Schema.brand("ConnectionRequestId"));

const ProviderSessionValue = Schema.RedactedFromValue(
  Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(8_192))),
);

export const StartLinkingInput = Schema.Struct({
  requestId: ConnectionRequestId,
  provider: ProviderKey,
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

export const LinkInput = Schema.Struct({
  provider: ProviderKey,
  session: ProviderSessionValue,
});
export type LinkInput = typeof LinkInput.Type;

export const CompleteReconnectInput = Schema.Struct({
  id: ConnectionId,
  provider: ProviderKey,
  session: ProviderSessionValue,
});
export type CompleteReconnectInput = typeof CompleteReconnectInput.Type;

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
