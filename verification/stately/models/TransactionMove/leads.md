# TransactionMove: lead ledger

Source: `packages/backend/src/contexts/connections/internal/TransactionMoveWorkflow.ts`; neighboring test read. Native chart models one stored entity; backend callers may contend at persistence boundary, which the transition table alone cannot adjudicate.

- Event order: two settlement writers could use stale derived status; `TransactionMoveWorkflow.ts:252-270` plans against row facts, not an atomic row write. Question pending persistence read.
- Unhandled pending result for non-waiver/non-trade kinds: `TransactionMoveWorkflow.ts:105-115`; transition rejects, verify caller behavior.

Ordering, persisted-row CAS, cancellation and retry guarantees outside this module remain questions until callers and repositories are modeled.
