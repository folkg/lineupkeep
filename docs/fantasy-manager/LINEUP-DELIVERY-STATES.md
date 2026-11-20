# Lineup delivery states

The delivery row projects the workflow state into `status`, `attempts`, `lastError`, `dispatchedAt`, and `updatedAt`. No separate state document is stored.

| State / row status | Entered by                                                      | Exit                                                 | Terminal |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------------------- | -------- |
| `pending`          | Insert; `Released` after a held or failed enqueue               | `Claimed`                                            | No       |
| `dispatching`      | `Claimed` from pending or stale dispatching; increases attempts | `Dispatched`, `Released`, or another stale `Claimed` | No       |
| `dispatched`       | `Dispatched` after a successful enqueue                         | None                                                 | Yes      |

`Claimed` retains the last failure. `Released` records the failure if supplied, otherwise clears it. `Dispatched` clears the error and records the dispatch timestamp. A dispatched delivery refuses all further transitions.
