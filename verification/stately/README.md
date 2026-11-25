# Stately verification models

These are bounded XState-v6 models of Lineupgrade's explicit workflows. They are
source-linked estimates, not application proofs. Keep them beside the code so a
workflow or repository change can be checked against the same invariants.

They are not part of `bun checks`: the checker is optional tooling and the models
are manually reviewed abstractions. Run them when a change touches a workflow
transition, a run claim, a lease, a queue effect, or an email send.

## Install and run

```sh
npx skills add statelyai/skills --skill stately -g
bun run verify:stately
```

The runner uses `~/.agents/skills/stately/scripts/stately-check` by default. Set
`STATELY_SKILL_DIR` to another checkout and `STATELY_OUT` to change the output
directory. It writes each run under `.artifacts/stately-runs/`.

Each model directory contains:

- `Flow.json`: the statechart.
- `Flow.rules.json`: bounded context, guards, actions, event payloads, rules,
  citations, and assumptions.
- `leads.md`: the source sweep that produced the model.

`concurrent/` models represent two independent callers. They are the useful
ones for races across a claim and an external effect, and they need to be read
with their assumptions.

## Current baseline

The two-caller models for transaction moves, lineup delivery, connection
notifications, and lineup runs now include the claim checks added after the first
spike.

| Model                               | Holds                                                 | Broken                                    | Meaning                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TransactionMove/concurrent`        | `StaleSettlement`, `LostUpdate`, `CanSettle`          | `EventuallySettles`                       | Settlement requires the current run claim. Progress needs an external scheduling assumption.                                                                    |
| `LineupDelivery/concurrent`         | `StaleCompletion`, `LostNewClaim`, `CanSettle`        | `DoubleExternalSend`, `EventuallySettles` | A finish requires the claim attempt it observed. A reclaim can still enqueue twice; the downstream run lease is the execution guard.                            |
| `ConnectionNotification/concurrent` | `StaleCompletion`, `LostNewClaim`, `CanSettle`        | `DoubleExternalSend`, `EventuallySettles` | A late send result is ignored after another claim. A second send attempt can still occur; the per-incident idempotency key is the provider deduplication guard. |
| `LineupRun/concurrent`              | `NoDoubleProviderWrite`, `NoStaleCommit`, `CanSettle` | `RetryEventuallySettles`                  | Same-run durable completion is protected by the lease token and generation. Retry has no source bound.                                                          |

`DoubleExternalSend` and the liveness rules stay broken on purpose. They record
real limits or missing external progress assumptions; changing the model to make
them pass would hide the risk. The first-pass models are kept for the single
record view. The `reproducer/` model documents a native-checker `leads-to`
witness defect: the checker can report a lasso that never visits the trigger.

The checker's result is model evidence. The existing `machine-test` suite is the
application evidence for pure workflow transitions. When a model reports a
cross-transaction race, inspect the cited repository and service lines, then add
an application test that reproduces the ordering before changing the model.
