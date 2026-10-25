import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";
import type {
  ConnectionMutationError,
  ConnectionRequestResult,
} from "#contracts/connections/connectionContract.ts";

export function requireConnectionSuccess<TData>(result: ConnectionRequestResult<TData>): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new ConnectionWriteFailure(result.error);
  }
}

class ConnectionWriteFailure extends Error {
  constructor(readonly reason: ConnectionMutationError) {
    super(reason.type);
  }
}

export function describeConnectionFailure(error: unknown): ConnectionFailure {
  if (error instanceof AuthenticationRequestFailure) {
    return {
      kind: "authentication",
      message: "Your session has ended. Sign in again to continue.",
    };
  }
  if (error instanceof ConnectionWriteFailure) {
    switch (error.reason.type) {
      case "connection.device_rejected":
        return {
          kind: "rejected",
          message:
            "The helper request was rejected, expired, or already used. Start a new pairing request from the helper.",
        };
      case "connection.link_expired":
        return {
          kind: "rejected",
          message: "This pairing attempt expired. Start a new pairing request from the helper.",
        };
      case "connection.link_rejected":
      case "connection.input_invalid":
      case "connection.not_found":
        return {
          kind: "rejected",
          message: "This connection is no longer available. Check the latest list before retrying.",
        };
      case "connection.credential_generation_stale":
        return {
          kind: "rejected",
          message: "This connection changed. Refresh the latest status before reconnecting.",
        };
      case "connection.provider_rejected":
        return {
          kind: "rejected",
          message: "The provider rejected this helper session. Reconnect to continue.",
        };
      case "connection.create_failed":
      case "connection.persistence_failed":
      case "connection.provider_unavailable":
        break;
      case "hosted_browser.unsupported":
        return {
          kind: "rejected",
          message: "Hosted sign-in is unavailable here. Use the local helper below.",
        };
      case "hosted_linking.session_active":
        return {
          kind: "rejected",
          message: "A hosted sign-in is already open. Finish or cancel it first.",
        };
      case "hosted_linking.rate_limited":
        return {
          kind: "rejected",
          message: "Too many sign-in attempts. Wait a minute and try again.",
        };
      case "hosted_linking.expired":
      case "hosted_linking.not_active":
      case "hosted_linking.not_found":
      case "hosted_linking.ticket_rejected":
      case "hosted_linking.input_invalid":
        return {
          kind: "rejected",
          message: "This hosted sign-in session ended. Start a new one.",
        };
      case "hosted_linking.persistence_failed":
        return {
          kind: "unconfirmed",
          message: "We could not start the secure browser. Try again or use the local helper.",
        };
    }
  }
  return {
    kind: "unconfirmed",
    message: "We could not confirm the change. Check the latest list before retrying.",
  };
}

export type ConnectionFailure = {
  readonly kind: "authentication" | "rejected" | "unconfirmed";
  readonly message: string;
};
