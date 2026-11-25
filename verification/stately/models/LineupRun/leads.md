# LineupRun: lead ledger

Source: `packages/backend/src/contexts/connections/internal/LineupRunWorkflow.ts`; neighboring test read. Native chart models one stored entity; backend callers may contend at persistence boundary, which the transition table alone cannot adjudicate.

- Guard checks intent existence on VerificationClaimed and ReconciliationStarted (`LineupRunWorkflow.ts:473,492`); lease ownership is not checked inside machine.
- Retries/reclaims replace lease (`LineupRunWorkflow.ts:317-325,346-354,373-381`); stale worker results may apply after replacement unless caller checks generation.
- Uncertain is nonterminal and reconciliation requires intent; optional writeIntent permits no intent (`LineupRunWorkflow.ts:192-196,489-507`).

Ordering, persisted-row CAS, cancellation and retry guarantees outside this module remain questions until callers and repositories are modeled.
