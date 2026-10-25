import * as fc from "fast-check";
import { expect, it } from "vitest";

import { exploreWorkflow, play } from "#browser/workflow/workflowTest.ts";

import { signInWorkflow, emailProblem, isCompleteCode } from "./signInWorkflow";

const invariants = {
  "switching addresses retains the email": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "code" && event?.type === "useDifferentEmail") {
      expect(state.value).toBe("email");
      expect(state.context.email).toBe(previous.context.email);
    }
  },
  "invalid email submission explains the problem": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (
      previous.value === "email" &&
      event?.type === "sendCode" &&
      emailProblem(previous.context.email) !== undefined
    ) {
      expect(state.value).toBe("email");
      expect(state.context.showEmailProblem).toBe(true);
    }
  },
  "incomplete code submission explains the problem": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (
      previous.value === "code" &&
      event?.type === "signIn" &&
      !isCompleteCode(previous.context.code)
    ) {
      expect(state.value).toBe("code");
      expect(state.context.showCodeProblem).toBe(true);
    }
  },
  "code delivery captures the trimmed address": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "sendingCode" && event?.type === "codeSent") {
      expect(state.value === "code" && state.context.sentTo).toBe(previous.context.email.trim());
    }
  },
  "pasting a code keeps its first six ASCII digits": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "code" && event?.type === "codeChanged") {
      expect(state.context.code).toBe(event.value.replaceAll(/\D/gu, "").slice(0, 6));
    }
  },
  "editing a refused code clears its rejection": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "code" && event?.type === "codeChanged") {
      expect(state.context.codeRejection).toBeUndefined();
    }
  },
  "codes contain at most six ASCII digits": (state: State) => {
    expect(state.context.code).toMatch(/^\d{0,6}$/u);
  },
  "sending requires a valid address": (state: State) => {
    if (state.value === "sendingCode") {
      expect(emailProblem(state.context.email)).toBeUndefined();
    }
    if (
      state.value !== "email" &&
      state.value !== "sendingCode" &&
      state.value !== "startingGoogle" &&
      state.value !== "signedIn"
    ) {
      expect(emailProblem(state.context.sentTo)).toBeUndefined();
    }
  },
  "verification requires a complete code": (state: State) => {
    if (state.value === "verifying") {
      expect(isCompleteCode(state.context.code)).toBe(true);
    }
  },
  "rejection and uncertainty preserve entered codes": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (
      (previous.value === "verifying" && event?.type === "rejected") ||
      (["verifying", "checkingSession", "finishing"].includes(previous.value) &&
        event?.type === "unconfirmed")
    ) {
      expect(state.value).toBe("code");
      expect(state.context.code).toBe(previous.context.code);
      expect(state.context.email).toBe(previous.context.email);
      if (event.type === "rejected") {
        expect(state.context.codeRejection).toEqual(event.reason);
        expect(state.context.codeOutcome).toBeUndefined();
      } else {
        expect(state.context.codeOutcome).toEqual({ type: "unconfirmed" });
      }
    }
  },
  "completion requires confirmed authentication": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (state.value === "signedIn" && previous.value !== "signedIn") {
      expect(previous.value).toBe("finishing");
      expect(event?.type).toBe("signedIn");
    }
    if (state.value === "finishing" && previous.value !== "finishing") {
      expect(["verifying", "checkingSession"]).toContain(previous.value);
      expect(event?.type).toBe("accepted");
    }
  },
};

it("explores every sign-in transition with session recovery invariants", () => {
  exploreWorkflow(signInWorkflow, { events, invariants });
});

it.each(Object.entries(invariants))(
  "preserves %s across generated sign-in events",
  (_name, invariant) => {
    fc.assert(
      fc.property(
        fc.oneof(text, fc.constant("123456")),
        fc.array(generatedEvent, { maxLength: 100 }),
        (code, sequence) => {
          play(signInWorkflow, sequence, undefined, { invariant });
          play(
            signInWorkflow,
            [
              { type: "emailChanged", value: " reader@example.test " },
              { type: "sendCode" },
              { type: "codeSent" },
              { type: "codeChanged", value: code },
              { type: "signIn" },
              ...sequence,
            ],
            undefined,
            { invariant },
          );
        },
      ),
      { seed: 20261021, numRuns: 100 },
    );
  },
);

const events: ReadonlyArray<Event> = [
  { type: "returnedFromGoogle", error: "denied" },
  { type: "emailChanged", value: " reader@example.test " },
  { type: "sendCode" },
  { type: "continueWithGoogle" },
  { type: "codeSent" },
  { type: "sendFailed", reason: undefined },
  { type: "googleFailed", reason: undefined },
  { type: "codeChanged", value: "123-456" },
  { type: "signIn" },
  { type: "rejected", reason: { type: "code_invalid" } },
  { type: "unconfirmed" },
  { type: "accepted" },
  { type: "signedIn" },
  { type: "resendCode" },
  { type: "checkSession" },
  { type: "notSignedIn" },
  { type: "useDifferentEmail" },
];
const text = fc.oneof(
  fc.string({ unit: "grapheme", maxLength: 220 }),
  fc.constantFrom("", " \n", "é漢字", "123456", "123", "reader@example.test"),
);
const generatedEvent: fc.Arbitrary<Event> = fc.oneof(
  fc.constantFrom(...events),
  fc.record({ type: fc.constant("emailChanged" as const), value: text }),
  fc.record({ type: fc.constant("codeChanged" as const), value: text }),
);

type State = typeof signInWorkflow.initialState;
type Event = Parameters<typeof signInWorkflow.transition>[1];
