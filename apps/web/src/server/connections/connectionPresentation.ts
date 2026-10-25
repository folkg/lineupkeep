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
    ...(connection.linkingExpiresAt === undefined
      ? {}
      : { linkingExpiresAt: DateTime.formatIso(connection.linkingExpiresAt) }),
    ...(connection.disconnectedAt === undefined
      ? {}
      : { disconnectedAt: DateTime.formatIso(connection.disconnectedAt) }),
    createdAt: DateTime.formatIso(connection.createdAt),
    updatedAt: DateTime.formatIso(connection.updatedAt),
  };
}

export function mapConnectionError(
  error: ConnectionError | ConnectionInputInvalid,
): ExpectedFailure<ConnectionMutationError["type"]> {
  switch (error._tag) {
    case "ConnectionInputInvalid":
      return { type: "connection.input_invalid", outcome: "rejected" };
    case "connection.not_found":
      return { type: error._tag, outcome: "rejected" };
    case "connection.create_failed":
    case "connection.persistence_failed":
      return { type: error._tag, outcome: "failure" };
  }
}

export class ConnectionInputInvalid extends Schema.TaggedError<
  ConnectionInputInvalid,
  { readonly brand: unique symbol }
>()("ConnectionInputInvalid", {}) {}
