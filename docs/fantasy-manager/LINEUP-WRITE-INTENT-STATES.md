# Lineup write intent states

The run state's `writeIntent.status` is authoritative. The `lineup_write_intents.status` column is a durable audit projection, synchronized in the same transaction as the run transition. An intent row retains its original lease even when a run is reclaimed or reconciled under another lease.

| Status              | Run states that own it                                                     | Trigger                                                                          | Terminal intent status |
| ------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------- |
| `intended`          | Applying, Uncertain; Blocked/Skipped/Superseded if interrupted             | Durable write intent inserted before sending                                     | No                     |
| `accepted`          | Verifying, Uncertain; Blocked/Skipped/Superseded if interrupted            | Provider accepts request                                                         | No                     |
| `unknown`           | Verifying, RetryWait, Uncertain; Blocked/Skipped/Superseded if interrupted | Provider response is unknown, or an applying run is recovered without a response | No                     |
| `not_sent`          | RetryWait; Blocked/Skipped/Superseded if interrupted                       | Provider confirms request was not sent; the run may retry or resume verification | No                     |
| `rejected`          | Failed                                                                     | Provider definitively rejects the request or the request is invalid              | Yes                    |
| `verified_mismatch` | Failed                                                                     | Accepted explicit assignments disagree with readback                             | Yes                    |
| `verified_changed`  | Completed                                                                  | Readback verifies a changed lineup                                               | Yes                    |
| `verified_no_op`    | Completed                                                                  | Readback or no-write explicit plan verifies no change                            | Yes                    |

Terminal runs without write intents remain valid historical records. `sent` was never written and is removed; migration maps any historical `sent` audit rows to `unknown` before backfilling stored run-state references. A retry that does not resume verification drops the run-state reference; the audit row retains `not_sent` or `unknown` for that attempt.
