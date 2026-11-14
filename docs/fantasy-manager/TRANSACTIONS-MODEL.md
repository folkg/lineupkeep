# Transactions storage model

Status: design only. No product code changed. The owner approved discarding all existing transaction
data, so this model starts from empty tables and carries no old rows forward.

## 1. Why the current model fails

The current unit is a proposal set with an id, a request fingerprint, and items. A team's moves live
across sets. The fingerprint only stops an identical request being stored twice. It does not limit a
team to one plan, so a changed request, or a proposal that omits the set id, creates another set.

**A stale drop reads as current.** A drop is checked when the set is proposed and when a read checks it
again. A saved drop can wait days; its old check still reads as ready. When two sets each hold a drop
for the same player, each set is checked on its own, so both drops can read current. The timeline shows
both as today's work, and the second one fails only when it runs.

**Two plans claim the same player or slot.** Sets are independent. Nothing in the database says a team
has one plan, so two sets can claim the same free agent or the same reserve place. Each passes its own
check. Only one can succeed at run time, and the loser is found after review.

The set is also the review unit, so the timeline stitches sets back into teams and days. Editing means
withdraw and replace, so one move becomes two records.

## 2. Tables and the invariant

One plan per owner and team. The plan is the team's queue and is never closed. A move is the unit.

### `transaction_plans`

`user_id`, `team_id`, `run_claim`, `run_claimed_at`, `created_at`, `updated_at`.

Primary key `(user_id, team_id)`; `team_id` references the owned team. `run_claim` is empty unless a
run holds the queue. A team cannot have two plans.

### `transaction_moves`

`id` primary key, `user_id`, `team_id`, `group_id`, `position`, `run_position`, `kind`, `adds`,
`fallbacks`, `drops`, `picks`, `slot_move`, `intent`, `placement`, `counterparty_key`, `external_ref`,
`bid`, `reason`, `run_day`, `effective_date`, `decision`, `decided_at`, `validation`, `checked_at`,
`validation_reasons`, `result`, `result_detail`, `result_at`, `proposed_by`, `created_at`,
`updated_at`.

`(user_id, team_id)` references the plan. `position` is the server's append order. `run_position` is
the order for the next run. `run_day` is the day the move runs in the league's day. `effective_date` is
when the league applies it. `external_ref` is the league's reference for a pending trade or waiver.
`proposed_by` records who proposed it and from which surface. The move stores its own proposed change;
no related item table.

### `transaction_move_claims`

`user_id`, `team_id`, `claim_kind`, `claim_key`, `move_id`, `created_at`.

Unique `(user_id, team_id, claim_kind, claim_key)`, with `move_id` referencing the move and removed
with it. Kinds are `player`, `place`, and `draft_pick`. A player claim is held by any move that names
that player; a fallback counts as a named player. A place claim names the place the move will use. A
draft pick claim names its round and the team it leaves.

### `transaction_move_steps`

`id`, `move_id`, `position`, `kind`, `player_key`, `from_slot`, `to_slot`, `outcome`, `detail`,
`decided_at`.

Unique `(move_id, position)`, with `move_id` referencing the move and removed with it. One row per
recorded action inside a move.

### Keys and indexes

The plan primary key and the unique keys on moves, claims, and steps enforce identity and order. The
timeline index on `(user_id, run_day, team_id, position)` and the due index on `(run_day, decision)`
serve the reads, both limited to open moves.

### The exact invariant

While a move is open, it holds one claim per named player, per roster place, and per draft pick. The
unique key stops two open moves in one plan holding the same claim. That is the guard against two
drops, two adds, and two place claims. A propose checks each move's claims before it appends; an edit
checks the replacement claims. The plan key alone does not prevent two moves naming the same player;
the claim table does.

The plan lock makes appends, edits, discards, and runs wait for each other. The projected roster check
is the second guard: it refuses an add with no place, an illegal slot, or an order that cannot keep
the roster legal. A propose or edit rechecks the whole plan; it refuses a change that would make an
existing open move impossible and names that move.

## 3. Move lifecycle and decisions

A move has three kinds of state:

- **Decision:** `undecided`, `saved`, `now`, or `discarded`. Today starts undecided. A later day starts
  saved. `now` means chosen for the next run. `discarded` means removed by the person.
- **Validation:** `unchecked`, `current`, `stale`, or `illegal`, with a time and reasons.
- **Result:** none, `executed`, `pending`, `failed`, `skipped`, `unknown`, `withdrawn`, or `expired`.

A move is open unless discarded or its result is executed, withdrawn, or expired. A pending waiver or
trade stays open. A failed or skipped move stays open for a retry or discard. An unknown move stays
open but is never retried automatically.

### Groups

The propose input takes an optional group label for each move; the label is only input, and the server
assigns the group id. One propose call may put moves in one group by giving them the same label. A move
without a label is a group of one. A group is one or more moves attempted together in the server's
order. No group spans teams or run days. A group lands whole or not at all: if a move in it is refused,
none of that group is stored, while a move outside it can still land. A group is a marker on moves,
not a review unit. A person chooses a group whole, so a partial group cannot be submitted;
independent moves are chosen one by one. All moves in a group share one run day; editing the day
moves the group. Discarding or editing one move leaves the rest of its group together. If a move in a
group is stale before it starts, the group does not run and each move records why. If a move fails
during the run, the rest of the group is skipped and records why.

### Transitions

| Action         | What happens                                                                                        | Move after                  |
| -------------- | --------------------------------------------------------------------------------------------------- | --------------------------- |
| Propose        | Create or lock the plan, check claims and roster, append; today starts undecided, a later day saved | Undecided or saved, current |
| Save or edit   | Change in place, set a day today or later, replace claims                                           | Saved, checked again        |
| Discard        | Release claims, end the move, no write                                                              | Discarded                   |
| Submit         | Mark selected groups `now`, lock, recheck every open move, set run order, write each group          | Now, then result            |
| Run on its day | Hourly check locks, rechecks, writes each due group                                                 | Now, then result            |
| Revalidate     | Replace validation, placement, dates, claims, run order                                             | Unchanged                   |
| Settle         | Record result and steps, release claims if ended                                                    | Result set                  |

A saved move stays editable until its day is claimed. A pending move stays until the league answers; it
cannot be edited, discarded, or retried. A move with an unknown result cannot be edited or retried; the
person checks the league's site, then discards or replaces it. A trade has no future day; it starts
undecided and is sent only by a submission. A pending waiver settles on the next revalidation that
sees the league's decision. A pending trade settles when the league reports it accepted, withdrawn, or
expired, or when the owner withdraws it.

The plan's `run_claim` makes a second submission wait. A propose, edit, or discard waits for it to
clear. It clears when the run ends; the hourly sweep recovers an interrupted claim. A submission
claims each team's plan separately; a plan already running is skipped and the other teams continue.

## 4. The reads

**Timeline page.** One query for the signed-in owner over open moves, joined to plans and teams,
ordered by run day, team, and position. The application groups rows by run day and team. The read
returns the stored validation and its check time, labelled as the last check rather than the current
state; it does not read the league. A saved move is rechecked when its day is claimed.

**MCP list.** The same query with an optional team and state: today, saved, or ended. A per-plan read
takes one team and returns every move in plan order, grouped by run day, including recent ended moves.
No input or result carries a set id.

**Per-plan review.** One query for one team, ordered by `position`, grouped by run day. Team facts such
as roster, budget, trade rules, and order are read only on revalidate or before a submission. The
stored review does not contact the league.

**Counts.** One grouped count gives open, today, saved, and ended totals, optionally per team.

**Paging.** The page marker holds the last `(run_day, team_id, position, id)` and the filter. It
carries no plan identity and is valid only for its owner. The limit is 1 to 50. A move edited between
pages can change day, so the client restarts after an action.

## 5. What is deleted

- `transaction_proposal_sets`, `transaction_proposal_items`, `transaction_proposal_submissions`, and
  `transaction_proposal_steps`. The final migration drops all four.
- Set ids, fingerprints, duplicate checks, set review paths, closed state, history, and the set list.
- `ProposalSetId`, `ProposalItemId`, the set-shaped proposal types, `ListProposalSetsInput`, the `set`
  input on propose, `ProposalSubmissionInProgress` in its set form, `isClosedSet`, and the repository
  methods that create, append to, list, and close sets.
- The old review route `/transactions/{setId}`. The new route is `/transactions/{teamId}`. Old links
  stop working.
- The set-based retention sweep, replaced by one that removes ended moves after 90 days and empty
  plans.

The removal migration does not copy a row. The new tables are created earlier, slice 6 switches to
them, and slice 7 drops the old tables. Discarding the data is why no backfill is correct. The new
tables join account export and erasure from the slice that creates them.

## 6. Implementation slices

Each slice is shippable and ends with the project checks. The new path stays behind one switch until
slice 6, so no slice leaves two write paths.

| Slice                           | Work                                                                                                                                                         | Evidence                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1. Tables and repository        | Add the migration, four tables, plan lock, append, decision, run claim, result, and privacy entries.                                                         | One plan, claim collision refused, concurrent appends wait, plan removal cleans up.               |
| 2. Validation and order         | Pure functions turn team facts and open moves into claims, validation, placement, dates, and run order.                                                      | Double drop, double add, reserve place, illegal slot, stale saved move, order. Not connected yet. |
| 3. Propose, save, edit, discard | New service behind the switch: groups, whole group or none, claim collisions refused, edit in place, discard per move.                                       | Service tests against a fake league. Old path unchanged.                                          |
| 4. Reads                        | Timeline, per-plan review, MCP list, counts, and paging; stored reads show the last check.                                                                   | Grouping, paging, counts, no set ids. Not visible until the switch.                               |
| 5. Submit and run               | Plan lock, recheck, group order, league writes, steps, results, hourly run, stale claim recovery.                                                            | Success, refusal, partial group, pending, unknown, overdue move. Complete but not visible.        |
| 6. Switch over                  | Switch page, MCP, and runner to the new model; stop using old tables.                                                                                        | Page, MCP, runner acceptance. Old plans are discarded by the owner's decision.                    |
| 7. Remove old storage           | Drop the four tables. Delete the old types, repository, MCP tools, set route, timeline adapter, retention, and switch; update the glossary and MCP document. | Migration test, no remaining references, container end-to-end run.                                |

## 7. Open questions

None. The owner has ruled on the queue, the discarded data, and the review path.
