# ConnectionLifecycle: lead ledger

Source: `packages/backend/src/contexts/connections/internal/ConnectionLifecycleWorkflow.ts`; neighboring test read. Native chart models one stored entity; backend callers may contend at persistence boundary, which the transition table alone cannot adjudicate.

- Race: LinkCompleted and Disconnected compete for Linking (`ConnectionLifecycleWorkflow.ts:57-73`); transition from Disconnected is absent (`ConnectionLifecycleWorkflow.ts:127`). Clearing requires atomic repository write.
- Expiry is stored (`ConnectionLifecycleWorkflow.ts:14`) but LinkCompleted has no expiry guard (`ConnectionLifecycleWorkflow.ts:57-64`); expiry enforcement may be external.

Ordering, persisted-row CAS, cancellation and retry guarantees outside this module remain questions until callers and repositories are modeled.
