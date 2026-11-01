import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";
import type {
  SignInSessionErrorType,
  SignInSessionRequestResult,
} from "#contracts/auth/authContract.ts";

export function requireSignInSessionSuccess<TData>(
  result: SignInSessionRequestResult<TData>,
): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new SignInSessionRequestFailure(result.error.type);
  }
}

export function describeSignInSessionFailure(error: unknown): SignInSessionFailure {
  if (error instanceof AuthenticationRequestFailure) {
    return {
      kind: "authentication",
      message: "Your session has ended. Sign in again to manage your sessions.",
    };
  }
  if (error instanceof SignInSessionRequestFailure) {
    switch (error.reason) {
      case "session.input_invalid":
        return {
          kind: "rejected",
          message: "That session is no longer listed. Refresh the list.",
        };
      case "session.persistence_failed":
        break;
    }
  }
  return {
    kind: "unconfirmed",
    message: "We could not confirm that the session ended. Refresh the list before trying again.",
  };
}

export type SignInSessionFailure = {
  readonly kind: "authentication" | "rejected" | "unconfirmed";
  readonly message: string;
};

class SignInSessionRequestFailure extends Error {
  constructor(readonly reason: SignInSessionErrorType) {
    super(reason);
  }
}
