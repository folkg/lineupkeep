import type {
  ConnectionError,
  ProviderConnection,
} from "@lineupkeep/backend/connections/Connection";
import { DateTime, Schema } from "effect";

import type {
  ConnectionMutationError,
  ConnectionView,
} from "#contracts/connections/connectionContract.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";

export function toConnectionView(connection: ProviderConnection): ConnectionView {
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    ...(connection.pairingCode === undefined ? {} : { pairingCode: connection.pairingCode }),
    ...(connection.linkingExpiresAt === undefined
      ? {}
      : { linkingExpiresAt: DateTime.formatIso(connection.linkingExpiresAt) }),
    ...(connection.approvedAt === undefined
      ? {}
      : { approvedAt: DateTime.formatIso(connection.approvedAt) }),
    ...(connection.disconnectedAt === undefined
      ? {}
      : { disconnectedAt: DateTime.formatIso(connection.disconnectedAt) }),
    createdAt: DateTime.formatIso(connection.createdAt),
    updatedAt: DateTime.formatIso(connection.updatedAt),
  };
}

export function mapConnectionError(
  error: ConnectionError | ConnectionDeviceRejected | ConnectionInputInvalid,
): ExpectedFailure<ConnectionMutationError["type"]> {
  switch (error._tag) {
    case "ConnectionDeviceRejected":
      return { type: "connection.device_rejected", outcome: "rejected" };
    case "ConnectionInputInvalid":
      return { type: "connection.input_invalid", outcome: "rejected" };
    case "connection.link_expired":
    case "connection.link_rejected":
    case "connection.not_found":
      return { type: error._tag, outcome: "rejected" };
    case "connection.create_failed":
    case "connection.persistence_failed":
      return { type: error._tag, outcome: "failure" };
  }
}

export class ConnectionDeviceRejected extends Schema.TaggedError<
  ConnectionDeviceRejected,
  { readonly brand: unique symbol }
>()("ConnectionDeviceRejected", {
  reason: Schema.String,
}) {}

export class ConnectionInputInvalid extends Schema.TaggedError<
  ConnectionInputInvalid,
  { readonly brand: unique symbol }
>()("ConnectionInputInvalid", {}) {}
