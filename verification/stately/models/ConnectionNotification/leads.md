# ConnectionNotification: lead ledger

Source: `packages/backend/src/contexts/connections/internal/ConnectionNotificationWorkflow.ts`; neighboring test read. Native chart models one stored entity; backend callers may contend at persistence boundary, which the transition table alone cannot adjudicate.

- Retry: Reclaimed returns to pending without increment (`ConnectionNotificationWorkflow.ts:61-67`), Retried increments (`ConnectionNotificationWorkflow.ts:100-109`); repeated claims and old Sent completion require external ownership checks.
- A cancellation can occur during sending (`ConnectionNotificationWorkflow.ts:79-82`); whether the external email is already sent is not represented.

Ordering, persisted-row CAS, cancellation and retry guarantees outside this module remain questions until callers and repositories are modeled.
