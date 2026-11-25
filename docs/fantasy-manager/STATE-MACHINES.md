# State machines and workflows

A workflow is the domain name for an explicit state machine. A machine is the generic mechanism that
defines and runs it. They are not two different concepts.

## Naming

- A domain lifecycle lives in a `*Workflow.ts` file beside the code that owns it.
- Its test lives beside it as `*Workflow.test.ts`.
- `machine.ts` stays the generic definition helper. Do not add another generic machine type.
- Do not name a domain lifecycle `*Machine.ts`. Use `*Workflow.ts`.
- `MachineTest` and `workflowTest` are test helpers, not domain workflows.

The backend already follows this for connection lifecycle, lineup runs, team automation, hosted
linking, and transaction moves. The browser sign-in machine is `signInWorkflow.ts`.

## One test helper

The graph walk, transition coverage, invariant checks, and terminal-state checks are runtime-neutral.
They belong in `@lineupkeep/machine-test` (`packages/machine-test/src/index.ts`). Its generic
`MachineAdapter<State, Event>` supplies state paths and keys, sample events, transitions,
declarations, expected targets, and final-state detection to `explore`, `run`, `verify`, and
`checkInvariants`. The runtime-specific parts are small adapters:

- `packages/backend/src/utilities/machineTest.ts` decodes Effect Schema state and calls `plan`
  and `snapshotOf`; it retains Effect `Arbitrary` scenarios and Effect results.
- `apps/web/src/browser/workflow/workflowTest.ts` uses the XState FSM state configuration and
  transition; the browser tests retain fast-check generators. `exploreWorkflow` accepts an optional
  `final` predicate (for example, `state.value === "signedIn"`) to enforce terminal rejection.
- The shared core imports neither Effect nor Node. Both adapters call it.

The Effect-specific work is schema decoding and `Arbitrary` generation. It is not the graph
algorithm. The shared core owns the graph algorithm, coverage, invariants, and the final-state rule.

The core is the only graph walker. The backend exposes the shared operations through Effect;
the browser exposes `exploreWorkflow` and `play` through the same runner.

## Required test pattern

Every workflow gets all of these before it is considered complete:

1. A tagged state schema and a tagged event schema, with terminal states marked.
2. An exploration test that reaches every state and proves every terminal state rejects every event.
3. A generated-sequence property test, seeded, with about 100 runs, through `verify` and
   `checkInvariants`.
4. A rehydration test that decodes a stored state and continues from it.
5. A codec round trip for every persisted machine state.
6. A write-path guard that plans the transition before storage and refuses an illegal one.
7. A state table in the docs with every state, its trigger, and whether it is terminal. A test
   checks the published status list and the machine states match.

The shared runner enforces the terminal-state rule automatically. A machine cannot declare a
terminal state and accept an event from it.

## What lint already checks

The `repository/workflow-tests` rule in `scripts/lintPlugin.ts` already requires:

- `exploreWorkflow` or `MachineTest.explore` in every `*Workflow.test.ts`.
- `fc.assert` with `fc.property` or `MachineTest.scenarios`.

Backend workflow tests also require `MachineTest.verify` and `MachineTest.checkInvariants`.
The rule does not require rehydration or a codec round trip. The write guard and the state table are
reviewed through the shared helper and the workflow module itself, not through a syntax-only rule.

## Rollout

Do these in order, one change at a time. Do not start a domain conversion until the shared helper and
the lint rule are green.

Phase 0, the pattern:

1. Write this convention into the docs and the testing skill.
2. Move the shared graph and invariant work into one runtime-neutral helper.
3. Make the backend and browser helpers thin adapters over it.
4. Enrich the workflow lint rule and prove every existing workflow still passes.
5. Use the transaction move workflow as the worked example.

Then one domain machine per change:

1. Lineup delivery — implemented; see [lineup delivery states](LINEUP-DELIVERY-STATES.md).
2. Connection email notification — implemented; see [connection notification states](CONNECTION-NOTIFICATION-STATES.md).
3. Lineup write intents, folded into `LineupRunWorkflow` — implemented; see [lineup write intent states](LINEUP-WRITE-INTENT-STATES.md). The unused `sent` status was removed.
4. Connection incidents — implemented; see [connection incident states](CONNECTION-INCIDENT-STATES.md).

Feedback is intentionally not converted: no code path changes a feedback report's status after creation. Its recorded status is read back as stored, so this is not a missing machine.

Each change includes the state schema, transitions, persistence mapping, write-path guard, graph and
property tests, rehydration and codec tests, the state table, and the full checks and container E2E.

The rollout uses serial sub-agents. Different machines may be independent, but they share the test
helper and the docs, so they are not converted in parallel.

## Model-checking evidence

The bounded Stately models live in [`verification/stately`](../../verification/stately/README.md)
next to the code, not in an artifact directory. `bun run verify:stately` runs the optional
native checker over the single-record and two-caller models. These are reviewed estimates of
lease, claim, queue, and email behavior, not substitutes for the generated `machine-test`
suite. A broken model rule is a lead to inspect, not an application test result. The two-caller
models for transaction moves, lineup delivery, connection notifications, and lineup runs are
the ones to consult when a change crosses a claim and an external effect.
