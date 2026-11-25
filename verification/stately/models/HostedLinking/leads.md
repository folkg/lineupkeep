# HostedLinking: lead ledger

Source: `packages/backend/src/contexts/connections/internal/HostedLinkingWorkflow.ts`; neighboring test read. Native chart models one stored entity; backend callers may contend at persistence boundary, which the transition table alone cannot adjudicate.

- Expiry has no clock guard (`HostedLinkingWorkflow.ts:87-95,134-142`), caller supplies event. CompletionSucceeded can race Expired (`HostedLinkingWorkflow.ts:112-142`); persistent CAS is outside this module.
- Cancellation is accepted only Active (`HostedLinkingWorkflow.ts:77-85`); while Completing no cancellation (`HostedLinkingWorkflow.ts:110-144`), potential UX question.

Ordering, persisted-row CAS, cancellation and retry guarantees outside this module remain questions until callers and repositories are modeled.
