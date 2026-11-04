export class SignInFailure extends Error {
  constructor(readonly reason: SignInFailureReason) {
    super(reason.type);
  }
}

export type SignInFailureReason =
  | { readonly type: "code_invalid" }
  | { readonly type: "code_expired" }
  | { readonly type: "code_attempts_exhausted" }
  | { readonly type: "email_rejected" }
  | { readonly type: "email_not_deliverable" }
  | { readonly type: "email_unavailable" }
  | { readonly type: "rate_limited"; readonly retryAfterSeconds: number | undefined }
  | { readonly type: "rejected" };

export function describeWait(retryAfterSeconds: number | undefined): string {
  if (retryAfterSeconds === undefined || retryAfterSeconds <= 60) {
    return "a minute";
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `${minutes} minutes`;
}
