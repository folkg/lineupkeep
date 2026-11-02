import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";
import type {
  AccountErasureErrorType,
  AccountErasureRequestResult,
  AccountExportStatusRequestResult,
} from "#contracts/account/accountContract.ts";

export function requireAccountErasureSuccess<TData>(
  result: AccountErasureRequestResult<TData>,
): TData {
  return requireAccountSuccess(result);
}

export function requireAccountExportStatusSuccess<TData>(
  result: AccountExportStatusRequestResult<TData>,
): TData {
  return requireAccountSuccess(result);
}

export function describeAccountErasureFailure(error: unknown): AccountFailure {
  if (error instanceof AuthenticationRequestFailure) {
    return {
      kind: "authentication",
      message: "Your session has ended. Sign in again to erase your account.",
    };
  }
  if (error instanceof AccountRequestFailure) {
    switch (error.reason) {
      case "account.confirmation_mismatch":
        return { kind: "rejected", message: "That phrase did not match. Nothing was deleted." };
      case "account.export_required":
        return {
          kind: "rejected",
          message: "Nothing was deleted. Take a fresh export, then erase.",
        };
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

export function describeAccountExportStatusFailure(error: unknown): AccountFailure {
  if (error instanceof AuthenticationRequestFailure) {
    return {
      kind: "authentication",
      message: "Your session has ended. Sign in again to check your export.",
    };
  }
  return {
    kind: "unconfirmed",
    message: "We could not check whether you have a usable export. Refresh the page to try again.",
  };
}

function requireAccountSuccess<TData>(
  result: AccountErasureRequestResult<TData> | AccountExportStatusRequestResult<TData>,
): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new AccountRequestFailure(result.error.type);
  }
}

export type AccountFailure = {
  readonly kind: "authentication" | "rejected" | "unconfirmed";
  readonly message: string;
};

class AccountRequestFailure extends Error {
  constructor(readonly reason: AccountErasureErrorType) {
    super(reason);
  }
}
