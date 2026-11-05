import { productName } from "@lineupkeep/brand/product";
import { useQuery } from "@tanstack/solid-query";
import { untrack } from "solid-js";
import type { Accessor } from "solid-js";

import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import { createCountdown, formatCountdown } from "#browser/timing/countdown.ts";
import { useWorkflow } from "#browser/workflow/useWorkflow.ts";

import { SignInFailure, describeWait } from "./signInFailure";
import type { SignInFailureReason } from "./signInFailure";
import type { SignInMethodsQueryOptions } from "./signInQueries";
import type { SignInRemote } from "./signInRemote";
import { codeDigits, emailProblem, isCompleteCode, signInWorkflow } from "./signInWorkflow";

export function useSignInForm(props: SignInFormOptions): {
  step: () => "email" | "code";
  offersGoogle: () => boolean;
  isBusy: () => boolean;
  isSendingCode: () => boolean;
  isStartingGoogle: () => boolean;
  isVerifying: () => boolean;
  isResendingCode: () => boolean;
  email: () => string;
  emailError: () =>
    | "Enter an email address like name@example.com."
    | "Enter your email address."
    | undefined;
  emailFeedback: () => ActionFeedbackState | undefined;
  sentTo: () => string;
  code: () => string;
  codeError: () => string | undefined;
  codeFeedback: () => ActionFeedbackState | undefined;
  canResend: () => boolean;
  resendLabel: () => string;
  changeEmail: (value: string) => undefined;
  sendCode: () => Promise<void>;
  continueWithGoogle: () => undefined;
  changeCode: (value: string) => string;
  signIn: () => undefined;
  resendCode: () => Promise<void>;
  useDifferentEmail: () => undefined;
} {
  const methods = useQuery(() => props.methodsQuery());
  const resendCountdown = createCountdown();
  const signIn = useWorkflow(signInWorkflow, {
    initialState: untrack(() => returnedFromGoogle(props.googleError)),
    onEnter: (state, send) => {
      switch (state.value) {
        case "sendingCode":
          return props.remote.sendCode(state.context.email.trim()).then(
            () => {
              resendCountdown.start(resendDelaySeconds);
              return send({ type: "codeSent" });
            },
            (error: unknown) => send({ type: "sendFailed", reason: refusal(error) }),
          );
        case "resendingCode":
          return props.remote.sendCode(state.context.sentTo).then(
            () => {
              resendCountdown.start(resendDelaySeconds);
              return send({ type: "codeSent" });
            },
            (error: unknown) => send({ type: "sendFailed", reason: refusal(error) }),
          );
        case "startingGoogle":
          return props.remote
            .continueWithGoogle({
              returnTo: props.returnTo,
              errorReturnTo: props.googleErrorReturnTo,
            })
            .catch((error: unknown) => send({ type: "googleFailed", reason: refusal(error) }));
        case "verifying":
          return props.remote
            .signInWithCode({ email: state.context.sentTo, code: state.context.code })
            .then(
              (outcome) => (outcome === "redirecting" ? undefined : send({ type: "accepted" })),

              (error: unknown) =>
                send(
                  error instanceof SignInFailure
                    ? { type: "rejected", reason: error.reason }
                    : { type: "unconfirmed" },
                ),
            );
        case "checkingSession":
          return props.remote.isSignedIn().then(
            (signedIn) => send(signedIn ? { type: "accepted" } : { type: "notSignedIn" }),
            () => send({ type: "unconfirmed" }),
          );
        case "finishing":
          return props.onAuthenticated().then(
            () => send({ type: "signedIn" }),
            () => send({ type: "unconfirmed" }),
          );
        case "email":
        case "code":
        case "signedIn":
          return undefined;
      }
    },
  });
  const state = (): typeof signInWorkflow.initialState => signIn.state();
  const context = (): (typeof signInWorkflow.initialState)["context"] => state().context;

  return {
    step: (): "email" | "code" => {
      switch (state().value) {
        case "email":
        case "sendingCode":
        case "startingGoogle":
          return "email";
        case "code":
        case "resendingCode":
        case "verifying":
        case "checkingSession":
        case "finishing":
        case "signedIn":
          return "code";
      }
    },

    offersGoogle: () => methods.data.google,
    isBusy: () => !["email", "code"].includes(state().value),
    isSendingCode: () => state().value === "sendingCode",
    isStartingGoogle: () => state().value === "startingGoogle",
    isVerifying: () => state().value === "verifying" || state().value === "finishing",
    isResendingCode: () => state().value === "resendingCode",
    email: () => context().email,
    emailError: () => {
      if (!context().showEmailProblem) {
        return undefined;
      }
      switch (emailProblem(context().email)) {
        case "missing":
          return "Enter your email address.";
        case "malformed":
          return "Enter an email address like name@example.com.";
        case undefined:
          return undefined;
      }
    },
    emailFeedback: (): ActionFeedbackState | undefined => {
      const outcome = context().emailOutcome;
      switch (outcome?.type) {
        case undefined:
          return undefined;
        case "returnedFromGoogle":
          return {
            type: "attention",
            message:
              outcome.error === "access_denied"
                ? "Google sign-in was cancelled. Try again, or get a code by email."
                : "We couldn't sign you in with Google. Try again, or get a code by email.",
          };
        case "sendFailed":
          return sendFailureFeedback(outcome.reason);
        case "googleFailed":
          return {
            type: "attention",
            message:
              outcome.reason?.type === "rate_limited"
                ? `Too many sign-in attempts. Try again in ${describeWait(outcome.reason.retryAfterSeconds)}.`
                : "We couldn't open Google sign-in. Try again, or get a code by email.",
          };
      }
    },
    sentTo: () => {
      const current = state();
      return "sentTo" in current.context ? current.context.sentTo : "";
    },
    code: () => context().code,
    codeError: () => {
      const rejection = context().codeRejection;
      if (rejection !== undefined) {
        return codeRejectionMessage(rejection);
      }
      return context().showCodeProblem && !isCompleteCode(context().code)
        ? "Enter the 6-digit code from the email."
        : undefined;
    },
    codeFeedback: (): ActionFeedbackState | undefined => {
      const outcome = context().codeOutcome;
      switch (outcome?.type) {
        case undefined:
          return undefined;
        case "resent":
          return {
            type: "success",
            message: "A new code is on its way. Earlier codes no longer work.",
          };
        case "sendFailed":
          return sendFailureFeedback(outcome.reason);
        case "notSignedIn":
          return {
            type: "attention",
            message: "You're not signed in yet. Enter the code again, or send a new one.",
          };
        case "unconfirmed":
          return {
            type: "attention",
            message: "We couldn't confirm sign-in.",
            recovery: {
              label: "Check again",
              onAction: () => signIn.send({ type: "checkSession" }),
            },
          };
      }
    },
    canResend: () => resendCountdown.remaining() === 0,
    resendLabel: () =>
      resendCountdown.remaining() > 0
        ? `Resend code in ${formatCountdown(resendCountdown.remaining())}`
        : "Resend code",
    changeEmail: (value: string) => void signIn.send({ type: "emailChanged", value }),
    sendCode: () => signIn.send({ type: "sendCode" }),
    continueWithGoogle: () => void signIn.send({ type: "continueWithGoogle" }),

    changeCode: (value: string) => {
      void signIn.send({ type: "codeChanged", value });
      return codeDigits(value);
    },
    signIn: () => void signIn.send({ type: "signIn" }),
    resendCode: () => signIn.send({ type: "resendCode" }),
    useDifferentEmail: () => void signIn.send({ type: "useDifferentEmail" }),
  };
}

function returnedFromGoogle(error: string | undefined): typeof signInWorkflow.initialState {
  return error === undefined
    ? signInWorkflow.initialState
    : signInWorkflow.transition(signInWorkflow.initialState, {
        type: "returnedFromGoogle",
        error,
      })[0];
}

function refusal(error: unknown): SignInFailureReason | undefined {
  return error instanceof SignInFailure ? error.reason : undefined;
}

function sendFailureFeedback(reason: SignInFailureReason | undefined): ActionFeedbackState {
  switch (reason?.type) {
    case undefined:
      return {
        type: "attention",
        message:
          "We couldn't confirm the code was sent. Try again; a new code replaces the old one.",
      };
    case "rate_limited":
      return {
        type: "attention",
        message: `Too many codes were requested. Try again in ${describeWait(reason.retryAfterSeconds)}.`,
      };
    case "email_rejected":
      return {
        type: "attention",
        message: "We can't send a code to that address. Check it and try again.",
      };
    case "email_not_deliverable":
      return {
        type: "attention",
        message: "Sign-in email cannot reach that address yet. Try a different address.",
      };
    case "email_unavailable":
      return {
        type: "attention",
        message: "We couldn't send the code just now. Try again in a moment.",
      };
    case "code_invalid":
    case "code_expired":
    case "code_attempts_exhausted":
    case "rejected":
      return { type: "attention", message: "We couldn't send a code. Try again." };
  }
}

function codeRejectionMessage(reason: SignInFailureReason): string {
  switch (reason.type) {
    case "code_invalid":
      return `That code isn't right. Check the latest email from ${productName} and try again.`;
    case "code_expired":
      return "That code has expired. Send a new code.";
    case "code_attempts_exhausted":
      return "Too many incorrect attempts. Send a new code.";
    case "rate_limited":
      return `Too many attempts. Try again in ${describeWait(reason.retryAfterSeconds)}.`;
    case "email_rejected":
    case "email_not_deliverable":
    case "email_unavailable":
    case "rejected":
      return "We couldn't sign you in with that code. Send a new code.";
  }
}

const resendDelaySeconds = 30;

type SignInFormOptions = {
  readonly remote: SignInRemote;
  readonly methodsQuery: Accessor<SignInMethodsQueryOptions>;
  readonly returnTo: string;
  readonly googleErrorReturnTo: string;
  readonly googleError: string | undefined;
  readonly onAuthenticated: () => Promise<void>;
};
