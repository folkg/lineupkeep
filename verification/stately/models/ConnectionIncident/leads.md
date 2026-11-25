# ConnectionIncident: lead ledger

Source: `packages/backend/src/contexts/connections/internal/ConnectionIncidentWorkflow.ts`; neighboring test read. Native chart models one stored entity; backend callers may contend at persistence boundary, which the transition table alone cannot adjudicate.

- Concurrent resolvers: `ConnectionIncidentWorkflow.ts:36-43` accepts first event only when stored transition uses atomic state read; duplicate resolution rejected at `ConnectionIncidentWorkflow.ts:46`. No IO in workflow itself.

Ordering, persisted-row CAS, cancellation and retry guarantees outside this module remain questions until callers and repositories are modeled.
