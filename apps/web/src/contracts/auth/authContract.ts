import type { UseCaseResult } from "#contracts/useCaseContract.ts";

export type AuthenticationFailureResult = {
  readonly type: "error";
  readonly error: AuthenticationFailure;
};

export type AuthenticationFailure = { readonly type: "auth.required" };

export type SessionView =
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly userId: string };

export type SignInMethodsView = import("@lineupkeep/backend/auth/Auth").SignInMethods;

export type SignInSessionView = {
  readonly id: string;
  readonly device: string;
  readonly startedAt: string;
  readonly lastUsedAt: string;
  readonly current: boolean;
};

export type SignInSessionListData = {
  readonly sessions: ReadonlyArray<SignInSessionView>;
};

export type SignInSessionErrorType = "session.input_invalid" | "session.persistence_failed";

export type SignInSessionRequestResult<A> =
  | UseCaseResult<A, SignInSessionErrorType>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
