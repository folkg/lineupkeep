import { setup, types } from "xstate/fsm";

import type { SignInFailureReason } from "./signInFailure";

const codeChanges = {
  codeChanged: ({ event }: { readonly event: { readonly value: string } }) => ({
    context: { code: codeDigits(event.value), codeRejection: undefined },
  }),
};

export const signInWorkflow = setup({
  schemas: {
    context: types<SignIn>(),
    events: {
      returnedFromGoogle: types<{ readonly error: string }>(),
      emailChanged: types<{ readonly value: string }>(),
      sendCode: types<object>(),
      continueWithGoogle: types<object>(),
      codeSent: types<object>(),
      sendFailed: types<{ readonly reason: SendFailure }>(),
      googleFailed: types<{ readonly reason: SendFailure }>(),
      codeChanged: types<{ readonly value: string }>(),
      signIn: types<object>(),
      rejected: types<{ readonly reason: SignInFailureReason }>(),
      unconfirmed: types<object>(),
      accepted: types<object>(),
      signedIn: types<object>(),
      resendCode: types<object>(),
      checkSession: types<object>(),
      notSignedIn: types<object>(),
      useDifferentEmail: types<object>(),
    },
  },
  states: {
    email: {},
    sendingCode: {},
    startingGoogle: {},
    code: { schemas: { context: types<SignIn & CodeSent>() } },
    resendingCode: { schemas: { context: types<SignIn & CodeSent>() } },
    verifying: { schemas: { context: types<SignIn & CodeSent>() } },
    checkingSession: { schemas: { context: types<SignIn & CodeSent>() } },
    finishing: { schemas: { context: types<SignIn & CodeSent>() } },
    signedIn: {},
  },
}).createFSM({
  initial: "email",
  context: {
    email: "",
    showEmailProblem: false,
    emailOutcome: undefined,
    code: "",
    showCodeProblem: false,
    codeRejection: undefined,
    codeOutcome: undefined,
  },
  states: {
    email: {
      on: {
        returnedFromGoogle: ({ event }) => ({
          context: { emailOutcome: { type: "returnedFromGoogle", error: event.error } },
        }),
        emailChanged: ({ event }) => ({ context: { email: event.value } }),
        sendCode: ({ context }) =>
          emailProblem(context.email) === undefined
            ? { target: "sendingCode", context: { emailOutcome: undefined } }
            : { context: { showEmailProblem: true } },
        continueWithGoogle: { target: "startingGoogle", context: { emailOutcome: undefined } },
      },
    },
    sendingCode: {
      on: {
        codeSent: ({ context }) => ({
          target: "code",
          context: {
            sentTo: context.email.trim(),
            code: "",
            showCodeProblem: false,
            codeRejection: undefined,
            codeOutcome: undefined,
          },
        }),
        sendFailed: ({ event }) => ({
          target: "email",
          context: { emailOutcome: { type: "sendFailed", reason: event.reason } },
        }),
      },
    },
    startingGoogle: {
      on: {
        googleFailed: ({ event }) => ({
          target: "email",
          context: { emailOutcome: { type: "googleFailed", reason: event.reason } },
        }),
      },
    },
    code: {
      on: {
        ...codeChanges,
        signIn: ({ context }) =>
          isCompleteCode(context.code)
            ? { target: "verifying", context: { codeRejection: undefined, codeOutcome: undefined } }
            : { context: { showCodeProblem: true } },
        resendCode: { target: "resendingCode", context: { codeOutcome: undefined } },
        checkSession: "checkingSession",
        useDifferentEmail: { target: "email", context: { emailOutcome: undefined } },
      },
    },
    resendingCode: {
      on: {
        codeSent: {
          target: "code",
          context: {
            code: "",
            showCodeProblem: false,
            codeRejection: undefined,
            codeOutcome: { type: "resent" },
          },
        },
        sendFailed: ({ event }) => ({
          target: "code",
          context: { codeOutcome: { type: "sendFailed", reason: event.reason } },
        }),
      },
    },
    verifying: {
      on: {
        rejected: ({ event }) => ({ target: "code", context: { codeRejection: event.reason } }),
        unconfirmed: { target: "code", context: { codeOutcome: { type: "unconfirmed" } } },
        accepted: "finishing",
      },
    },
    checkingSession: {
      on: {
        unconfirmed: { target: "code", context: { codeOutcome: { type: "unconfirmed" } } },
        notSignedIn: { target: "code", context: { codeOutcome: { type: "notSignedIn" } } },
        accepted: "finishing",
      },
    },
    finishing: {
      on: {
        unconfirmed: { target: "code", context: { codeOutcome: { type: "unconfirmed" } } },
        signedIn: "signedIn",
      },
    },
    signedIn: {},
  },
});

export function emailProblem(email: string): "missing" | "malformed" | undefined {
  const value = email.trim();
  if (value.length === 0) {
    return "missing";
  }
  return emailShape.test(value) ? undefined : "malformed";
}

export function isCompleteCode(code: string): boolean {
  return codeShape.test(code);
}

export function codeDigits(value: string): string {
  return value.replaceAll(/\D/gu, "").slice(0, codeLength);
}

const codeLength = 6;

const codeShape = /^\d{6}$/u;

const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

type SignIn = {
  readonly email: string;
  readonly showEmailProblem: boolean;
  readonly emailOutcome: EmailOutcome | undefined;
  readonly code: string;
  readonly showCodeProblem: boolean;

  readonly codeRejection: SignInFailureReason | undefined;
  readonly codeOutcome: CodeOutcome | undefined;
};

type CodeSent = {
  readonly sentTo: string;
};

type SendFailure = SignInFailureReason | undefined;

type EmailOutcome =
  | { readonly type: "returnedFromGoogle"; readonly error: string }
  | { readonly type: "sendFailed" | "googleFailed"; readonly reason: SendFailure };

type CodeOutcome =
  | { readonly type: "resent" | "unconfirmed" | "notSignedIn" }
  | { readonly type: "sendFailed"; readonly reason: SendFailure };
