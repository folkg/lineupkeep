import type { ConnectionError } from "@lineupkeep/backend/connections/Connection";
import type {
  HostedLinkingError,
  HostedLinkingSession,
} from "@lineupkeep/backend/connections/HostedLinking";
import { DateTime, Schema } from "effect";

import type {
  HostedLinkingMutationError,
  HostedLinkingSessionView,
} from "#contracts/connections/connectionContract.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";

export function toHostedLinkingSessionView(
  session: HostedLinkingSession,
): HostedLinkingSessionView {
  return {
    id: session.id,
    connectionId: session.connectionId,
    provider: session.provider,
    status: session.status,
    startedAt: DateTime.formatIso(session.startedAt),
    expiresAt: DateTime.formatIso(session.expiresAt),
    ...(session.completedAt === undefined
      ? {}
      : { completedAt: DateTime.formatIso(session.completedAt) }),
    ...(session.cancelledAt === undefined
      ? {}
      : { cancelledAt: DateTime.formatIso(session.cancelledAt) }),
    ...(session.expiredAt === undefined
      ? {}
      : { expiredAt: DateTime.formatIso(session.expiredAt) }),
    ...(session.failedAt === undefined ? {} : { failedAt: DateTime.formatIso(session.failedAt) }),
    ...(session.failureReason === undefined ? {} : { failureReason: session.failureReason }),
  };
}

export function mapHostedLinkingError(
  error:
    | HostedLinkingError
    | ConnectionError
    | HostedBrowserUnsupported
    | HostedLinkingInputInvalid,
): ExpectedFailure<HostedLinkingMutationError["type"]> {
  if (Schema.is(HostedBrowserUnsupported)(error)) {
    return { type: "hosted_browser.unsupported", outcome: "rejected" };
  }
  if (Schema.is(HostedLinkingInputInvalid)(error)) {
    return { type: "hosted_linking.input_invalid", outcome: "rejected" };
  }
  switch (error._tag) {
    case "hosted_linking.not_found":
    case "hosted_linking.ticket_rejected":
    case "hosted_linking.expired":
    case "hosted_linking.not_active":
    case "hosted_linking.session_active":
    case "hosted_linking.rate_limited":
      return { type: error._tag, outcome: "rejected" };
    case "hosted_linking.persistence_failed":
      return { type: error._tag, outcome: "failure" };
    case "connection.create_failed":
    case "connection.persistence_failed":
    case "connection.provider_unavailable":
      return { type: error._tag, outcome: "failure" };
    case "connection.credential_generation_stale":
    case "connection.link_expired":
    case "connection.link_rejected":
    case "connection.not_found":
    case "connection.provider_rejected":
      return { type: error._tag, outcome: "rejected" };
  }
}

export class HostedBrowserUnsupported extends Schema.TaggedError<
  HostedBrowserUnsupported,
  { readonly brand: unique symbol }
>()("HostedBrowserUnsupported", {}) {}

export class HostedLinkingInputInvalid extends Schema.TaggedError<
  HostedLinkingInputInvalid,
  { readonly brand: unique symbol }
>()("HostedLinkingInputInvalid", {}) {}
