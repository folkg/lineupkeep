import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";
import type {
  AccountErasureErrorType,
  AccountErasureRequestResult,
} from "#contracts/account/accountContract.ts";

export function requireAccountErasureSuccess<TData>(
  result: AccountErasureRequestResult<TData>,
): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new AccountErasureRequestFailure(result.error.type);
  }
}

export function describeAccountErasureFailure(error: unknown): AccountErasureFailure {
  if (error instanceof AuthenticationRequestFailure) {
    return {
      kind: "authentication",
      message: "Your session has ended. Sign in again to erase your account.",
    };
  }
  if (error instanceof AccountErasureRequestFailure) {
    switch (error.reason) {
      case "account.confirmation_mismatch":
        return { kind: "rejected", message: "That phrase did not match. Nothing was deleted." };
      case "account.persistence_failed":
        break;
    }
  }
  return {
    kind: "unconfirmed",
    message:
      "We could not confirm the account was erased. Sign in again to check before trying again.",
  };
}

export type AccountErasureFailure = {
  readonly kind: "authentication" | "rejected" | "unconfirmed";
  readonly message: string;
};

class AccountErasureRequestFailure extends Error {
  constructor(readonly reason: AccountErasureErrorType) {
    super(reason);
  }
}
