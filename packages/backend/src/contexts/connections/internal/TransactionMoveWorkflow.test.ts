import { assert, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit } from "effect";
import { Array as EffectArray } from "effect";

import {
  TransactionMoveStatus,
  transactionMoveStatus,
} from "#contexts/connections/TransactionPlans.ts";
import { plan } from "#utilities/machine.ts";
import * as MachineTest from "#utilities/machineTest.ts";

import {
  TransactionMoveEvent,
  TransactionMoveState,
  TransactionMoveWorkflow,
} from "./TransactionMoveWorkflow.ts";
import type { TransactionMoveRequest } from "./TransactionMoveWorkflow.ts";

const events: ReadonlyArray<TransactionMoveRequest> = [
  { _tag: "Save" },
  { _tag: "Undecide" },
  { _tag: "ConfirmNow" },
  { _tag: "ConfirmLater" },
  { _tag: "Discard" },
  { _tag: "Write", result: "executed", kind: "free_agent_add", bySystem: false },
  { _tag: "Write", result: "executed", kind: "free_agent_add", bySystem: true },
  { _tag: "Write", result: "pending", kind: "waiver_claim", bySystem: false },
  { _tag: "Write", result: "pending", kind: "trade", bySystem: false },
  { _tag: "Write", result: "failed", kind: "free_agent_add", bySystem: false },
  { _tag: "Write", result: "skipped", kind: "free_agent_add", bySystem: false },
  { _tag: "Write", result: "unknown", kind: "free_agent_add", bySystem: false },
  { _tag: "ClaimWon" },
  { _tag: "ClaimLost", result: "executed", attemptedFallback: false },
  { _tag: "ClaimLost", result: "pending", attemptedFallback: true },
  { _tag: "ClaimLost", result: "failed", attemptedFallback: false },
  { _tag: "ClaimLost", result: "failed", attemptedFallback: true },
  { _tag: "ClaimLost", result: "unknown", attemptedFallback: true },
  { _tag: "FallbackOutcome", result: "executed" },
  { _tag: "FallbackOutcome", result: "pending" },
  { _tag: "FallbackOutcome", result: "failed" },
  { _tag: "FallbackOutcome", result: "unknown" },
];

const finalStates: ReadonlyArray<string> = [
  "discarded",
  "ran_immediately",
  "ran_on_schedule",
  "claim_won",
  "claim_lost",
  "claim_lost_fallback_ran",
  "all_choices_failed",
  "fallback_unknown",
  "offer_sent",
];

const define = MachineTest.invariants(TransactionMoveWorkflow);
const invariants = [
  define.state("a final status accepts no event", ({ snapshot }) => {
    if (!finalStates.includes(snapshot.state.path)) {
      return true;
    }
    return EffectArray.every(events, (event) =>
      Exit.isFailure(
        Effect.runSync(
          Effect.exit(plan(TransactionMoveWorkflow, { state: snapshot.state.value }, event)),
        ),
      ),
    );
  }),
  define.step(
    "only a system write lands on schedule",
    ({ before, after, event }) =>
      before.state.path === after.state.path ||
      after.state.path !== "ran_on_schedule" ||
      (event._tag === "Write" && event.bySystem && event.result === "executed"),
  ),
  define.step(
    "an immediate run never comes from a system write",
    ({ before, after, event }) =>
      before.state.path === after.state.path ||
      after.state.path !== "ran_immediately" ||
      (event._tag === "Write" && !event.bySystem && event.result === "executed"),
  ),
  define.step(
    "a waiting claim is a waiver write",
    ({ before, after, event }) =>
      before.state.path === after.state.path ||
      after.state.path !== "claim_waiting" ||
      (event._tag === "Write" && event.result === "pending" && event.kind === "waiver_claim"),
  ),
  define.step(
    "an offer is a trade write",
    ({ before, after, event }) =>
      before.state.path === after.state.path ||
      after.state.path !== "offer_sent" ||
      (event._tag === "Write" && event.result === "pending" && event.kind === "trade"),
  ),
  define.step(
    "a fallback outcome leaves a retrying claim",
    ({ before, after, event }) =>
      event._tag !== "FallbackOutcome" ||
      before.state.path === "claim_lost_retrying" ||
      after.state.path === before.state.path,
  ),
];

it.effect("explores every transaction status and transition", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(TransactionMoveWorkflow, {
      input: { _tag: "open_undecided" },
      events: () => events,
      stateKey: ({ snapshot }) => snapshot.state.path,
      invariants,
    });

    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    assert.strictEqual(explored.transitionCoverage.branches.missing, 0);
    assert.deepStrictEqual(
      EffectArray.map(explored.nodes, (node) => node.snapshot.state.path).sort(),
      [...TransactionMoveStatus.literals].sort(),
    );
  }),
);

it.effect("holds the graph invariants for generated event sequences", () =>
  Effect.gen(function* () {
    const generated = MachineTest.scenarios(TransactionMoveWorkflow, {
      inputArbitrary: Arbitrary.schema(TransactionMoveState),
      eventsArbitrary: Arbitrary.array(Arbitrary.schema(TransactionMoveEvent), {
        maxLength: 50,
      }),
    });
    const result = yield* Arbitrary.checkEffect(
      generated.arbitrary,
      (scenario) =>
        Effect.gen(function* () {
          const trace = yield* MachineTest.run(TransactionMoveWorkflow, scenario);
          yield* MachineTest.verify(TransactionMoveWorkflow, trace);
          yield* MachineTest.checkInvariants(TransactionMoveWorkflow, trace, invariants);
          return true;
        }),
      { seed: 20261120, runs: 100 },
    );

    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

it("keeps the machine states and the published statuses in step", () => {
  assert.deepStrictEqual(
    Object.keys(TransactionMoveState.cases).sort(),
    [...TransactionMoveStatus.literals].sort(),
  );
});

it("derives every status from the move facts", () => {
  const cases: ReadonlyArray<{
    readonly status: (typeof TransactionMoveStatus.literals)[number];
    readonly move: Parameters<typeof transactionMoveStatus>[0];
  }> = [
    {
      status: "open_undecided",
      move: facts({ decision: "undecided" }),
    },
    {
      status: "open_saved",
      move: facts({ decision: "saved" }),
    },
    {
      status: "open_now",
      move: facts({ decision: "now" }),
    },
    {
      status: "open_confirmed",
      move: facts({ decision: "confirmed" }),
    },
    {
      status: "discarded",
      move: facts({ decision: "discarded" }),
    },
    {
      status: "ran_immediately",
      move: facts({ result: "executed", runDecidedBy: "owner" }),
    },
    {
      status: "ran_on_schedule",
      move: facts({ result: "executed", runDecidedBy: "system" }),
    },
    {
      status: "claim_waiting",
      move: facts({ kind: "waiver_claim", phase: "with_league", result: "pending" }),
    },
    {
      status: "claim_won",
      move: facts({ kind: "waiver_claim", phase: "won", result: "executed" }),
    },
    {
      status: "claim_lost",
      move: facts({ kind: "waiver_claim", phase: "lost", result: "failed" }),
    },
    {
      status: "claim_lost_fallback_ran",
      move: facts({ kind: "waiver_claim", phase: "lost", result: "executed" }),
    },
    {
      status: "claim_lost_retrying",
      move: facts({ kind: "waiver_claim", phase: "lost", result: "pending" }),
    },
    {
      status: "all_choices_failed",
      move: facts({
        kind: "waiver_claim",
        phase: "lost",
        result: "failed",
        attempts: [{ kind: "fallback" }],
      }),
    },
    {
      status: "fallback_unknown",
      move: facts({ kind: "waiver_claim", phase: "lost", result: "unknown" }),
    },
    {
      status: "offer_sent",
      move: facts({ kind: "trade", result: "pending" }),
    },
    {
      status: "failed",
      move: facts({ result: "failed" }),
    },
    {
      status: "skipped",
      move: facts({ result: "skipped" }),
    },
    {
      status: "unknown",
      move: facts({ result: "unknown" }),
    },
  ];

  assert.deepStrictEqual(
    EffectArray.map(cases, (entry) => entry.status).sort(),
    [...TransactionMoveStatus.literals].sort(),
  );
  for (const entry of cases) {
    assert.strictEqual(transactionMoveStatus(entry.move), entry.status);
  }
});

function facts(
  overrides: Partial<Parameters<typeof transactionMoveStatus>[0]>,
): Parameters<typeof transactionMoveStatus>[0] {
  return {
    decision: "confirmed",
    kind: "drop",
    attempts: [],
    ...overrides,
  };
}
