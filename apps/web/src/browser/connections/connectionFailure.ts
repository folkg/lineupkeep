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
      case "connection.input_invalid":
      case "connection.not_found":
        return {
          kind: "rejected",
          message: "This connection is no longer available. Check the latest list before retrying.",
        };
      case "connection.create_failed":
      case "connection.persistence_failed":
        break;
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
