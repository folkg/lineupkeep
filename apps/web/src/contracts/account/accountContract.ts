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
  | "account.export_required"
  | "account.persistence_failed";

export type AccountErasureRequestResult<A> =
  | UseCaseResult<A, AccountErasureErrorType>
  | { readonly type: "error"; readonly error: AuthenticationFailure };

export type AccountExportStatusView = {
  readonly latest:
    | {
        readonly takenAt: string;
        readonly records: number;
        readonly areas: ReadonlyArray<{
          readonly label: string;
          readonly records: number;
        }>;
      }
    | undefined;
  readonly usable: boolean;
  readonly freshForMinutes: number;
};

export type AccountExportStatusErrorType = "account.persistence_failed";

export type AccountExportStatusRequestResult<A> =
  | UseCaseResult<A, AccountExportStatusErrorType>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
