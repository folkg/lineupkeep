# TeamAutomation: lead ledger

Source: `packages/backend/src/contexts/connections/internal/TeamAutomationWorkflow.ts`; neighboring test read. Native chart models one stored entity; backend callers may contend at persistence boundary, which the transition table alone cannot adjudicate.

- Expiration before boundary is rejected (`TeamAutomationWorkflow.ts:84-88`); explicit Resumed can bypass boundary (`TeamAutomationWorkflow.ts:80-83`) by design per test.
- PauseExpired requires an external scheduler; without it Paused can persist indefinitely, not a workflow deadlock.

Ordering, persisted-row CAS, cancellation and retry guarantees outside this module remain questions until callers and repositories are modeled.
