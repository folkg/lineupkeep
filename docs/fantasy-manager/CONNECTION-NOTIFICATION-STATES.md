# Connection email notification states

The notification row persists the workflow projection in `status`, `attempts`, `nextAttemptAt`, `lastError`, `sentAt`, and `updatedAt`. No separate state document is stored.

| State / row status | Entered by                                                                    | Exit                                                                                   | Terminal |
| ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| `pending`          | Insert; stale `Reclaimed`; `Retried` after an unavailable provider            | `Claimed` when due, or `Cancelled` when the incident resolves                          | No       |
| `sending`          | `Claimed` from pending                                                        | `Reclaimed` when stale; `Sent`, `Cancelled`, `Undeliverable`, `Rejected`, or `Retried` | No       |
| `sent`             | `Sent` after successful delivery                                              | None                                                                                   | Yes      |
| `cancelled`        | `Cancelled` when the incident no longer needs notification                    | None                                                                                   | Yes      |
| `failed`           | `Undeliverable` without a verified email, or `Rejected` by the email provider | None                                                                                   | Yes      |

Claim and reclaim do not count as delivery attempts. Sent, rejected, and retried delivery each increment attempts; undeliverable and cancelled do not. Reclaim schedules immediate eligibility. Retry schedules the existing escalating delay. A successful send records `sentAt` and clears the error; other final states have no send timestamp.
