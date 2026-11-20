# One team projection and one time authority for transaction groups

Status: implementation model. It replaces any earlier reading of run day, effective date, and
revalidation.

## 1. The failure it fixes

A person dropped Anton Frondell and activated Jake Neighbours in one group. The league applies roster
changes the next day, so both legs were effective 19 November. The propose checked the group against
the 19 November projection, where the drop had landed, and accepted it. Moments later the run read the
host roster again, which for that league still showed 20 of 20 places used, revalidated the activation
without the drop its own group had already submitted, refused it, and stopped. The drop had already
reached the league and cannot be undone.

Two clocks, one group. Propose validated a projected roster; execution validated a raw one. Nothing in
the record said which date either was validating.

## 2. The team projection and its date

There is one projection function: `evaluateTransactionPlan`. It replays moves, in dependency order, from
a roster read, and reports each move's validation, placement, projected roster, and the places used,
maximum, and free. No other surface computes free places, placement, or roster legality.

Every projection is anchored to **one effective date**. The projection of a team on a date is:

- the host roster as read, plus
- every submitted leg for that date that the host roster does not yet show, plus
- the open legs for that date, in dependency order.

A submitted leg is one the league accepted (`executed`) for that same effective date. It is counted
only while the host roster does not show its effect: a drop whose player is still listed, an add whose
player is not listed yet, an activate whose player still sits on a reserve list. Once the roster shows
it, counting it again would free or use a place twice. That is why the projection takes the roster and
the submitted legs together, and why the same function serves propose, review, execution, and reads.

No surface re-derives roster state. No surface uses "today" as a stand-in for a move whose effective
date is later. Placement, `rosterMaximum`, reserve list capacity, and eligibility come from the solver
and the roster read, never from a second local rule.

## 3. The send day and the effective date

A move has two dates, and they answer different questions.

- The **send day** (`runDay`) is the league day Lineupgrade sends the move to the provider. It is the
  only day that gates execution. A move with no send day is due today.
- The **effective date** is the league day the provider applies the roster change. It is derived once
  from the send day and the league's published rule, stored on the move, and never gates sending.

| League rule   | Effective date of a move sent on day D                                   |
| ------------- | ------------------------------------------------------------------------ |
| `same_day`    | D                                                                        |
| `next_day`    | the calendar day after D                                                 |
| `weekly_lock` | the start of the scoring week D falls in                                 |
| not published | unknown, so the move is sent without a promised date                     |
| a trade       | unknown: the other manager decides, so a trade carries no effective date |

For a next-day league, confirming a move today sends it today and the league applies it tomorrow.
Scheduling the same move for tomorrow sends it tomorrow and the league applies it the day after. The
person chooses the send day; the league's rule decides the effective date. The app never asks the
league to hold a move until its effective date, because that would submit the move a day late.

**A group shares one send day and one effective date.** A group is proposed on one day, so its legs
derive one date. A generated roster fix takes the effective date of the move it funds. An edit that
changes the group's day re-derives it for every leg. A group whose legs somehow carry different dates
is invalid and does not run.

**The confirmation decides when the person sends, not when the league applies.** Confirming records
the owner's decision and authorises the run. It does not move the effective date, and it does not make
the group wait for the effective date.

### Waiting

A group waits only for its send day. It is not partly run, and it is not run early.

- A group whose send day is today runs when confirmed. A same-day league applies it today; a next-day
  league applies it tomorrow; a weekly-lock league applies it at the start of the locked week.
- A group whose send day is later records the decision (`confirmed`), sends nothing, and reports the
  exact first hourly check on that day (`sendsAt`). On that day the check sends every leg in one run.
- A send day that has passed is picked up at the next check, never discarded.

The card states both facts in plain words:

- `Runs when you confirm. Takes effect November 21.`
- `Runs November 21 at 9:55 a.m. Takes effect November 22.`

Both times are rendered in the reader's local zone by the browser. `sendsAt` is the exact check; the
card never borrows today's check time for a later day.

## 4. The three phases of a submitted claim

A waiver claim is not a move that waits on a clock. It has three separate facts.

**Submission is ours.** A claim was sent to the league, and its stored phase is `with_league`. It has no
hourly run, no invented processing clock, and no projected processing time. It is not an open move,
it does not appear in Today, and it does not count towards the nav badge. Confirming a future claim
schedules the date it is sent; it never borrows the hourly check's time.

**League processing is the league's.** The next hourly check reconciles each submitted claim to `won`
or `lost` from the provider's own facts. A claim is `won` when the team's roster now shows the claimed
player. It is `lost` when the provider reports the player as a free agent or rostered by another
team. It stays `with_league` while the provider still lists the player on waivers, or publishes no
outcome. The check time is never evidence of a processing time; a claim card names the league's own
waiver rule, or says it settles before the next check.

**Roster effect is the provider's.** A move's effective date is the date the league applies the roster
change, stored separately from the claim's phase. A `won` phase records what the league decided; the
effective date records when the acquired player reached the roster.

**A lost claim tries its fallbacks.** The first stored fallback becomes a real straight add and runs
through the same dated projection and provider write path as any other add. Each attempt and the
league's reason are stored on the move. A fallback that fails or is already taken tries the next
stored fallback. When none are left, the group ends `failed` with a plain account of what was tried,
what the league did, and that nothing is waiting. A won claim is `done`, and no fallback runs.

**One reconciliation per claim.** The hourly check settles a claim once; the stored phase leaves
`with_league` as it settles, so a later check neither retries the claim nor repeats its fallback.

**Counts and labels.** The count of open moves and the nav badge include only moves that need the
person's decision. A submitted claim lives in Earlier as `With the league` until it reconciles, then as
`Claim won`, `Claim lost, fallback ran`, or `All choices failed`.

## 5. Group atomicity across legs and time

Ordering protects the legs from each other; the shared send day and effective date keep them on one
league date. Both are required.

- An irreversible leg never runs before the leg that funds it, on the same effective date. A drop that
  frees a place runs before the activate that uses it, and both are sent in the same run for the same
  date.
- If the league cannot apply the legs together, the group is refused at propose, and the refusal names
  the fact. Nothing is stored and nothing is sent, so no irreversible leg can land alone.
- Two facts can make the legs unable to land together: the target date's roster cannot hold them (the
  roster is full and the group frees no place), or the provider cannot accept the dependent write for
  that date (the league publishes no roster date or scoring week to place a slot move in).
- A run that the league splits anyway (one write accepted, a later one refused) is recorded leg by leg
  and step by step, and the remaining moves stay open with a plain cure. The record never claims the
  group ran whole.
- A dependent leg is never sent on the strength of a roster read that omits the leg that funds it.

The `this plan does not free one` refusal is computed only against the projection the plan was accepted
on: the roster read plus the same date's submitted and open legs. A revalidation against a different
roster is the defect this model removes.

## 6. Where authority sits

| Decision                                  | Authority                                          |
| ----------------------------------------- | -------------------------------------------------- |
| Placement, free places, roster legality   | the lineup solver, through `placeIntentItems`      |
| Reserve list eligibility and capacity     | the league's declared roster, interpreted once     |
| The league's timing rule and current date | the provider's league read                         |
| Whether a write is accepted for a date    | the provider's write                               |
| The effective date of a move              | derived once from the provider's rule, then stored |
| Whether a group may be sent now           | its send day against the league day, computed once |

Lineupgrade does not invent a second placement rule and does not invent a second timing rule. It does
not predict that a league will accept a write; it asks. When the provider publishes no roster date or
scoring week for a slot move, the fact is carried as a fact, and a group that needs one is refused.

## 7. The dependency graph

A group is a set of legs with one run day and one effective date.

- **Legs.** Each member is one move with one provider write, or one grouped write (an activate with its
  funding drop travels as one move's two provider calls).
- **Ordering.** A leg waits for the leg that adds the player it consumes, the leg that removes the
  occupant of the place it targets, and the leg that frees the place or reserve place it uses.
  Allocation is in stored order. A cycle is blocked with its conflict named.
- **Blockers.** A failed leg blocks only its dependents. A pending leg holds its claims and blocks only
  its dependents. A leg whose dependency is outside the run, or has not produced, is skipped with the
  dependency named.
- **Recorded on submit.** The decision, its actor and surface, the time, and the runs's key.
- **Recorded on apply.** Per leg: `executed`, `pending`, `failed`, `skipped`, or `unknown`, its reason,
  its time, the run that carried it out, and one row per action inside it (add, drop, reserve move,
  slot move). Per leg, the run position it took and the effective date it ran for.
- **Recorded on refusal.** The refusing leg names the first fact that stopped it, and its dependents
  record that they were skipped because of it. A refusal at propose records the refusal and stores
  nothing.

## 8. Every place that derives roster state or timing

| Place                                               | What it derives                                                        | Date it uses                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `TransactionPlanEvaluation.evaluateTransactionPlan` | validation, placement, projected roster, free places, order            | the evaluation's own roster plus the moves it is given            |
| `ProposalOrder.placeIntentItems`                    | placement and free active or reserve places via the solver             | none; the caller passes the roster for the date                   |
| `TransactionPlanService.propose`                    | validates and stores the group                                         | the group's derived effective date                                |
| `TransactionPlanService.save` / `edit`              | revalidates the plan after a change                                    | the group's effective date, re-derived only on a day change       |
| `TransactionPlanService.confirm`                    | decides whether a group runs now or waits for its send day             | the stored send day against the league day                        |
| `TransactionPlanService.runMoves`                   | rechecks a group, orders legs, and settles each write                  | the group's stored effective date, with submitted legs            |
| `TransactionPlanService.runDue`                     | selects plans with a confirmed leg whose send day has arrived          | send day, never the effective date                                |
| `TransactionPlanService.checkTeams`                 | the live check behind the list and plan reads                          | each open move's send day and effective date, with submitted legs |
| `TransactionPlanService.reconcileClaims`            | whether a submitted claim is `won`, `lost`, or still `with_league`     | the provider's roster and player status, never the check          |
| `TransactionPlanService.planViewOf`                 | the plan view at propose, save, edit, and submit                       | the same, from the plan's stored moves                            |
| `TransactionPlanRead.moveReadView` / `moveDays`     | the day a move is sent, the exact check, and the day it applies        | the evaluated send day, `sendsAt`, and effective date             |
| `TransactionPlanWrites.apply`                       | the roster coverage a write is sent for                                | the league's own date or week for that write                      |
| `TransactionPlanFacts.read`                         | the host roster, the league rule, and whether a slot write is accepted | the league day, never a substitute for an effective date          |

The defects this model corrects, and where they lived:

- `runMoves` re-read the roster after each accepted leg and revalidated the rest of the group against
  that read alone, dropping the group's own submitted legs. A next-day drop was invisible there, so the
  dependent leg was refused after the drop had landed.
- `checkTeams` and `planViewOf` projected only open moves, so the plan read showed an executed drop and
  a refused dependent leg for a group it had accepted as ready.
- `runDue` and `isDueMove` required the effective date to arrive before sending, so a next-day move
  confirmed today was sent tomorrow and applied the day after. The confirmation now puts the move on
  the wire on its send day.
- The page exposed `runsOn` as the later of the send day and the effective date, and used it as the
  card's action and status date. A move that would run today therefore looked scheduled for tomorrow.
  `runsOn` is gone; the card names the send moment and the effective date separately.
- Nothing recorded that a slot move cannot be sent when the league publishes no such date, so a group
  could send its irreversible drop first and discover the fact afterwards.
