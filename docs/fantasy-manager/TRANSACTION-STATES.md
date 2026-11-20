# Transaction move states

Every move read carries one `status`. The group card and the Earlier row read that same value, so
they cannot disagree. The machine is `TransactionMoveWorkflow` in
`packages/backend/src/contexts/connections/internal/TransactionMoveWorkflow.ts`; the table below is
the human-readable form of its states.

`TransactionMoveStatus` is published by `transactionMoveStatus` from the stored decision, phase,
result, run actor, and attempts. The state tags and the machine states are checked against each other
in `TransactionMoveWorkflow.test.ts`.

## Open states

These are before the league sees the move. The card owns the action; there is no outcome icon.

| Status           | Meaning                                                    | Card label           |
| ---------------- | ---------------------------------------------------------- | -------------------- |
| `open_undecided` | No decision yet, or a saved move has reached its send day. | Needs your decision  |
| `open_saved`     | Saved for a later day.                                     | Needs your decision  |
| `open_now`       | Confirmed to run now, not yet sent.                        | Running              |
| `open_confirmed` | Confirmed for a later send day.                            | Scheduled to run ... |

## Final states

| Status                    | Meaning                                                                                    | Icon                   | Label                    |
| ------------------------- | ------------------------------------------------------------------------------------------ | ---------------------- | ------------------------ |
| `ran_immediately`         | An owner or agent run wrote the move successfully.                                         | `check`                | Ran immediately          |
| `ran_on_schedule`         | The hourly run wrote the move successfully.                                                | `clock-check`          | Ran on schedule          |
| `claim_waiting`           | A waiver claim was accepted and the league is deciding.                                    | `hourglass`            | With the league          |
| `claim_won`               | The league awarded the claimed player.                                                     | `badge-check`          | Claim won                |
| `claim_lost`              | The claim was lost and no fallback ran.                                                    | `circle-slash`         | Claim lost               |
| `claim_lost_fallback_ran` | The claim was lost and a stored fallback was added.                                        | `iteration-ccw`        | Claim lost, fallback ran |
| `claim_lost_retrying`     | The claim was lost and the fallback could not be sent yet; the next check tries again.     | `rotate-cw`            | Claim lost, retrying     |
| `all_choices_failed`      | The claim was lost and every stored fallback was refused or unavailable.                   | `x`                    | All choices failed       |
| `fallback_unknown`        | The claim was lost and the fallback write got no provider answer.                          | `circle-question-mark` | Unknown outcome          |
| `offer_sent`              | A trade offer reached the league and the other manager decides.                            | `send-horizontal`      | Offer sent               |
| `failed`                  | A direct write was refused, or the move failed its check.                                  | `x`                    | Failed                   |
| `skipped`                 | The move was not attempted because another group member failed or a dependency stopped it. | `skip-forward`         | Skipped                  |
| `unknown`                 | A direct write got no provider answer.                                                     | `circle-question-mark` | Unknown outcome          |
| `discarded`               | The owner or an agent will not send the move. It is hidden from Earlier.                   | `ban`                  | Discarded                |

`withdrawn` and `expired` are not states. They were declared in an earlier model and no code path ever
wrote them. They are removed from the read model and from the open-move index.
