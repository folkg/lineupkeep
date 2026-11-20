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
They belong in one shared helper. The runtime-specific parts are small adapters:

- The backend adapter decodes Effect Schema state and events and calls `plan` and `snapshotOf`.
- The browser adapter uses the XState FSM transition and fast-check generators.
- The shared core imports neither Effect nor Node. Both adapters call it.

The Effect-specific work is schema decoding and `Arbitrary` generation. It is not the graph
algorithm. The shared core owns the graph algorithm, coverage, invariants, and the final-state rule.

The public test files should have one shape. After the migration, the backend and browser adapters
both expose the same operations: explore, run, verify, check invariants, and generate scenarios.

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

It does not yet require `verify`, `checkInvariants`, a rehydration test, or a codec round trip. The
pattern above extends the rule where a call can be checked. The write guard and the state table are
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

1. Lineup delivery.
2. Connection email notification.
3. Lineup write intents, folded into `LineupRunWorkflow`.
4. Connection incidents.
5. Feedback, only if its status changes stay in this codebase.

Each change includes the state schema, transitions, persistence mapping, write-path guard, graph and
property tests, rehydration and codec tests, the state table, and the full checks and container E2E.

The rollout uses serial sub-agents. Different machines may be independent, but they share the test
helper and the docs, so they are not converted in parallel.
