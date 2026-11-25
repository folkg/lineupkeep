# signInWorkflow: lead ledger

Source: `apps/web/src/browser/auth/signInWorkflow.ts`; neighboring test read. Native chart models one stored entity; backend callers may contend at persistence boundary, which the transition table alone cannot adjudicate.

- Async request callbacks are accepted only in their phase (`signInWorkflow.ts:71-95,109-145`), but two tabs have independent FSMs and shared server session; caller boundary not read.
- startingGoogle has only googleFailed exit (`signInWorkflow.ts:89-95`); successful redirect relies on navigation, so liveness is intentionally not guaranteed.

Ordering, persisted-row CAS, cancellation and retry guarantees outside this module remain questions until callers and repositories are modeled.
