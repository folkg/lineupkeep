import { assert, it } from "@effect/vitest";
import { MachineTest } from "@typeonce/effect-machine/testing";
import { Arbitrary, DateTime, Effect, Schema } from "effect";

import { TeamAutomationState, TeamAutomationWorkflow } from "./TeamAutomationWorkflow.ts";
import type { TeamAutomationEvent } from "./TeamAutomationWorkflow.ts";

const define = MachineTest.invariants(TeamAutomationWorkflow);
const invariants = [
  define.state(
    "only a paused team owns a resume boundary",
    ({ snapshot }) =>
      ("resumesAt" in snapshot.state.value) ===
      (snapshot.state.path === "PausedUntilFantasyDayEnd"),
  ),
  define.state(
    "a paused team owns its fantasy-day context",
    ({ snapshot }) =>
      ["timeZone", "fantasyDay", "policyVersion"].every(
        (key) => key in snapshot.state.value,
      ) === (snapshot.state.path === "PausedUntilFantasyDayEnd"),
  ),
  define.step(
    "pause expiry is accepted only at or after the stored boundary",
    ({ before, after, event }) =>
      before.state.path !== "PausedUntilFantasyDayEnd" ||
      event._tag !== "PauseExpired" ||
      DateTime.toEpochMillis(event.at) < DateTime.toEpochMillis(before.state.value.resumesAt) ||
      (after.state.path === "Enabled" &&
        DateTime.Equivalence(after.state.value.changedAt, event.at)),
  ),
];

it.effect("explores every team automation transition and branch", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(TeamAutomationWorkflow, {
      input,
      events: () => events,
      stateKey: ({ snapshot }) => snapshot.state.path,
      invariants,
    });

    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    assert.strictEqual(explored.transitionCoverage.branches.missing, 0);
  }),
);

it("round-trips every automation state through its JSON codec", () => {
  const codec = Schema.toCodecJson(TeamAutomationState);
  for (const state of states) {
    const encoded = Schema.encodeSync(codec)(state);
    const decoded = Schema.decodeUnknownSync(codec)(encoded);
    assert.deepStrictEqual(decoded, state);
  }
});

it.effect("generates event sequences without violating automation invariants", () =>
  Effect.gen(function* () {
    const generated = MachineTest.scenarios(TeamAutomationWorkflow, {
      inputArbitrary: Arbitrary.schema(Schema.Literal("disabled")).pipe(
        Arbitrary.map(() => input),
      ),
      eventsArbitrary: Arbitrary.array(
        Arbitrary.schema(
          Schema.Literals(["Enabled", "Disabled", "Paused", "PauseExpired"]),
        ).pipe(
          Arbitrary.map((kind): TeamAutomationEvent => {
            switch (kind) {
              case "Enabled":
                return { _tag: "Enabled", at };
              case "Disabled":
                return { _tag: "Disabled", at };
              case "Paused":
                return {
                  _tag: "Paused",
                  at,
                  resumesAt: nextDay,
                  timeZone: "America/Los_Angeles",
                  fantasyDay: "2026-10-25",
                  policyVersion: "yahoo-pacific-midnight/1",
                };
              case "PauseExpired":
                return { _tag: "PauseExpired", at: nextDay };
            }
          }),
        ),
        { maxLength: 30 },
      ),
    });
    const result = yield* Arbitrary.checkEffect(
      generated.arbitrary,
      (scenario) =>
        Effect.gen(function* () {
          const trace = yield* MachineTest.run(TeamAutomationWorkflow, scenario);
          yield* MachineTest.verify(TeamAutomationWorkflow, trace);
          yield* MachineTest.checkInvariants(TeamAutomationWorkflow, trace, invariants);
          return true;
        }),
      { seed: 20261025, runs: 50 },
    );

    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

it.effect("rejects an expiry before the stored fantasy-day boundary", () =>
  Effect.gen(function* () {
    const trace = yield* MachineTest.run(TeamAutomationWorkflow, {
      input,
      events: [
        { _tag: "Enabled", at },
        paused,
        { _tag: "PauseExpired", at: DateTime.subtractDuration(nextDay, "1 millis") },
      ],
    });

    assert.strictEqual(trace.final.state.path, "PausedUntilFantasyDayEnd");
  }),
);

const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
const nextDay = DateTime.makeUnsafe("2026-10-26T07:00:00Z");
const input = { _tag: "Disabled" as const, changedAt: at };
const paused: TeamAutomationEvent = {
  _tag: "Paused",
  at,
  resumesAt: nextDay,
  timeZone: "America/Los_Angeles",
  fantasyDay: "2026-10-25",
  policyVersion: "yahoo-pacific-midnight/1",
};
const events: ReadonlyArray<TeamAutomationEvent> = [
  { _tag: "Enabled", at },
  { _tag: "Disabled", at },
  paused,
  { _tag: "PauseExpired", at: nextDay },
];
const states: ReadonlyArray<TeamAutomationState> = [
  { _tag: "Disabled", changedAt: at },
  { _tag: "Enabled", changedAt: at },
  {
    _tag: "PausedUntilFantasyDayEnd",
    changedAt: at,
    pausedAt: at,
    resumesAt: nextDay,
    timeZone: "America/Los_Angeles",
    fantasyDay: "2026-10-25",
    policyVersion: "yahoo-pacific-midnight/1",
  },
];
