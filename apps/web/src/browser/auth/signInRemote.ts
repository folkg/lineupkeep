import {
  AuthEndpointFailure,
  authClient,
  requireAuthSuccess,
} from "#browser/session/authClient.ts";
import type { SignInMethodsView } from "#contracts/auth/authContract.ts";
import {
  getAuthSessionServerFn,
  getSignInMethodsServerFn,
} from "#server-functions/auth/authServerFunctions.ts";

import { SignInFailure } from "./signInFailure";
import type { SignInFailureReason } from "./signInFailure";

export const signInRemote: SignInRemote = {
  loadMethods: () => getSignInMethodsServerFn(),
  isSignedIn: () => getAuthSessionServerFn().then((session) => session.status === "authenticated"),
  sendCode: (email) => {
    let retryAfter: string | null = null;
    return authClient.emailOtp
      .sendVerificationOtp(
        { email, type: "sign-in" },
        {
          onError: (context) => {
            retryAfter = context.response.headers.get("X-Retry-After");
          },
        },
      )
      .then(requireAuthSuccess)
      .catch((error: unknown) => {
        throw toSignInFailure(error, retryAfter);
      });
  },
  signInWithCode: (input) =>
    authClient.signIn
      .emailOtp({ email: input.email, otp: input.code })
      .then((result) => {
        requireAuthSuccess(result);
        return result.data !== null && "redirect" in result.data && result.data.redirect === true
          ? ("redirecting" as const)
          : undefined;
      })
      .catch((error: unknown) => {
        throw toSignInFailure(error, null);
      }),
  continueWithGoogle: (input) =>
    authClient.signIn
      .social({
        provider: "google",
        callbackURL: input.returnTo,
        errorCallbackURL: input.errorReturnTo,
      })
      .then(requireAuthSuccess)
      .catch((error: unknown) => {
        throw toSignInFailure(error, null);
      }),
};

export type SignInRemote = {
  readonly loadMethods: () => Promise<SignInMethodsView>;

  readonly isSignedIn: () => Promise<boolean>;

  readonly sendCode: (email: string) => Promise<void>;
  readonly signInWithCode: (input: {
    readonly email: string;
    readonly code: string;
  }) => Promise<"redirecting" | void>;

  readonly continueWithGoogle: (input: {
    readonly returnTo: string;
    readonly errorReturnTo: string;
  }) => Promise<void>;
};

function toSignInFailure(error: unknown, retryAfter: string | null): unknown {
  if (!(error instanceof AuthEndpointFailure)) {
    return error;
  }
  const reason = reasonFor(error, retryAfter);
  return reason === undefined ? error : new SignInFailure(reason);
}

function reasonFor(
  error: AuthEndpointFailure,
  retryAfter: string | null,
): SignInFailureReason | undefined {
  if (error.status === 429) {
    const seconds = Number(retryAfter);
    return {
      type: "rate_limited",
      retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
    };
  }
  const known = error.code === undefined ? undefined : knownReasons[error.code];
  if (known !== undefined) {
    return known;
  }
  return error.status < 500 ? { type: "rejected" } : undefined;
}

const knownReasons: Readonly<Record<string, SignInFailureReason>> = {
  INVALID_OTP: { type: "code_invalid" },
  OTP_EXPIRED: { type: "code_expired" },
  TOO_MANY_ATTEMPTS: { type: "code_attempts_exhausted" },
  INVALID_EMAIL: { type: "email_rejected" },
  EMAIL_REJECTED: { type: "email_rejected" },
  EMAIL_RECIPIENT_NOT_ALLOWED: { type: "email_not_deliverable" },
  EMAIL_UNAVAILABLE: { type: "email_unavailable" },
};
