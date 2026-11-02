import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";
import type { UseCaseResult } from "#contracts/useCaseContract.ts";

const erasureConfirmationPhrase = "erase my account";

export function isErasureConfirmation(value: string): boolean {
  return value.trim() === erasureConfirmationPhrase;
}

export const accountExportPath = "/api/account/export";

export type AccountErasureSummaryView = {
  readonly removed: ReadonlyArray<{
    readonly class: string;
    readonly count: number;
  }>;
};

export type AccountErasureErrorType =
  | "account.confirmation_mismatch"
  | "account.persistence_failed";

export type AccountErasureRequestResult<A> =
  | UseCaseResult<A, AccountErasureErrorType>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
