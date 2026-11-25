# LineupDelivery: lead ledger

Source: `packages/backend/src/contexts/connections/internal/LineupDeliveryWorkflow.ts`; neighboring test read. Native chart models one stored entity; backend callers may contend at persistence boundary, which the transition table alone cannot adjudicate.

- Retry: dispatching accepts another Claimed and increments attempts (`LineupDeliveryWorkflow.ts:54-61`); separate overlapping attempts are not identified by state.
- Stale completion: Released/Dispatched depend only on dispatching state (`LineupDeliveryWorkflow.ts:63-79`); old worker may finish after a new claim. Question until persistence CAS read.

Ordering, persisted-row CAS, cancellation and retry guarantees outside this module remain questions until callers and repositories are modeled.
