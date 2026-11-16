# The place, reserve, group, and submission model

Status: design only. No product code changes.

## 1. The rule

A move changes nothing until the owner confirms it. A saved move is a plan, not a permission.

Four reports led here:

- A saved move reached its day and the check ran it with no owner decision.
- A reserve move plus an add was refused, although the reserve move frees a place.
- A group ran its drop, failed its reserve move as already done, and skipped its add for no room.
- Reserve capacity and occupancy were not reported by list, so no page or agent could see what a move would free.

The first is the rule; the rest are modelling faults.

**Confirmation.** Confirming is a recorded decision by the signed-in owner. Today's confirmation authorizes the run now. A later day's confirmation authorizes the check to carry it out on that day, because the owner has already decided. The check never chooses or runs an unconfirmed move; a saved move whose day arrives waits in Today.

An earlier note said the check must never write. The owner's later ruling is recorded: the check may carry out a confirmed move; it never chooses one. The check never mutates a transaction on its own; it only carries out a submit the owner already made.

Every run records the confirmation and the moves it attempted.

## 2. Facts

**Places.** A starting or bench position is a place. Places count against the roster maximum. A team at its maximum has no free place, even with an empty reserve list.

**Reserve lists.** A reserve list is a separate area named by the league, such as IR or IR+. Each has a name, capacity, occupancy, and eligibility: it accepts named positions, an injured player, or the league does not say.

A reserve player is on the roster but does not count against the maximum. Capacity is per list, never pooled. IR and IR+ differ in eligibility and capacity.

**Eligibility.** A starting place accepts its declared positions, or any player if it declares none; a bench place accepts any player; a reserve list accepts a player only under its rule. When the roster row names reserve lists, only those lists accept the player, and an injury-based list still requires an injured player. A mismatch makes the roster illegal, and adds and drops wait for a cure. Injured means the league reports an injury.

**The maximum.** Starting and bench occupants count; reserve occupants do not. An unreported place counts as a place. A player no longer eligible for their reserve list still does not count, but the roster is illegal.

**Other facts.** Timing, the pool, the FAAB balance, draft picks, and today's editability.

## 3. Move effects

A move has a typed effect on players, places, reserve lists, and money or picks, computed against the projection at its turn.

| Move                       | Preconditions                                                                                             | Effect                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free-agent add             | Available; an active place accepts them and is free, or a reserve list accepts them and has a free place. | Joins. Uses one place, or one reserve place of the named list. Holds the player claim. No money.                                                                                                 |
| Waiver claim               | An add, with the player on waivers and the bid within the FAAB balance.                                   | Joins only when awarded. Holds a place or reserve place and the budget claim. Pending until the league answers.                                                                                  |
| Drop                       | Rostered and editable.                                                                                    | Leaves. Frees one place, or one reserve place of their list. Releases the player claim when it ends. No money or picks.                                                                          |
| Start or bench move        | Rostered and editable; a declared active place accepts them and has room.                                 | Changes active place. Frees one place and uses one. No money or picks.                                                                                                                           |
| Stash to a reserve list    | Active and editable; the named list accepts them, has a free place, and is not claimed.                   | Moves to that list. Frees one place and uses one reserve place of that list.                                                                                                                     |
| Activate                   | On a reserve list and editable; an active place accepts them and is free.                                 | Moves active. Uses one place and frees one reserve place of the list they left.                                                                                                                  |
| Slot move to a named place | Rostered and editable; the place is declared, accepts them, and has room.                                 | Same effect as the start, bench, stash, or activate case the destination falls into.                                                                                                             |
| Trade                      | A counterparty, at least one player or pick out and one in, a legal roster after, and no future day.      | Holds player and pick claims. Changes no roster until accepted. On acceptance, players and picks move and those counts change. A trade is an offer, not a mutation the owner can complete alone. |

An add marked for reserve has two league actions: the add, then the reserve move. If one request can name the destination, it is atomic. If not, the actions are recorded separately and a failure between them is a partial outcome, not a silent success.

## 4. Replay and order

Read the team's facts once per check or run: roster, places, reserve lists, pool, budget, picks, timing, and today. Build a projection and replay the open moves in run order, checking each at its turn.

**Ledger deltas.** For each move compute `placesFreed`, `placesUsed`, `reserveFreed` by list, and `reserveUsed` by list. A move's net place use must be covered by a free place before it, or by a freeing move ordered before it. The same holds per reserve list.

**Dependencies.** The order is built from four relations, then stored position, then move id:

- a move that consumes a player waits for the move that adds that player;
- a move that targets a place waits for the move that removes or moves the occupant;
- a move that uses a place with no free place waits for a move that frees one, allocated in order;
- a move that uses a reserve place with no free place in that list waits for a move that frees one in the same list.

A group's members keep their stored order unless a relation says otherwise. The whole group runs together.

**Failure.** A failed move blocks only its dependents, directly or through another move; an independent move still runs. A dependent names the failed move and its reason. A pending trade or waiver holds its claims and blocks only its dependents. A cycle is blocked with its conflict named.

**Insertion.** Adding a move rechecks the plan. A new move that would make an existing move impossible is refused and names it. An accepted move gets claims, order, placement, and validation. The plan never stores a move that cannot run.

**Edit.** An edit replaces its claims and rechecks the plan. Changing a group's day moves the whole group. A move that is running, pending, or ended cannot be edited.

**Discard.** A discard releases claims and rechecks the plan. A dependent that loses its freeing move becomes blocked and names the discarded move. A discarded member leaves its group unwhole, so the rest is invalid until the owner discards or re-forms it. Discarding the whole group is one action.

## 5. Groups

A group is one or more moves the owner asks to run together, on one day and one team. It is valid only when every member is current and every member's effect is legal at every step. If one member is stale or illegal, nothing runs, and the group names the first member and its reason.

At run time, check again. If a member is invalid, none is sent. That member is `failed`, the rest `skipped`, each with its reason.

If the league accepts one write and rejects a later one, the earlier write cannot be undone. Record what happened:

- each member gets `executed`, `failed`, `unknown`, or `skipped`;
- each action inside a member gets its own outcome, so an add that landed and a reserve move that failed are not collapsed;
- read the roster and league state and recheck the plan;
- the page says which action landed, which failed in the league's words, and which did not run;
- the failed action and the actions that did not run stay open, marked invalid, with a plain cure.

Nothing is retried automatically; the owner confirms a retry after a fresh check.

The league publishes one add/drop request, so an add and a drop can travel together. It publishes no call for a reserve move and an add, or several roster moves. Separate requests are not atomic; the record, re-read, recheck, and explanation are the fallback. A trade is its own group of one, because acceptance is not the owner's to control.

## 6. Submission and provenance

**States.** A move is `undecided` (new, today, not confirmed), `saved` (later day, not confirmed), `now` (confirmed for today), `confirmed` (confirmed for a later day), or `discarded`. A later move starts `saved`; on its day it waits in Today. It never runs without a confirmation.

**Who can confirm.** The signed-in owner on the page. An agent cannot decide. If the owner instructs an agent to submit, the instruction is the confirmation, and the run records the agent, the owner, the surface, and the instruction reference. No such submit surface exists today, so this design adds none.

**The run record.** Every run stores a run id, the plan, the trigger, who submitted, the surface and client, the time, the check time, the order, the moves attempted, each move's and action's result, and the counts. The move read exposes the confirmation and the run that carried it out. The page shows one line: "You confirmed this on 12 November. It ran on the 13 November check." or "You confirmed this on 12 November. It has not run yet."

**Repeat-safe submit and retry.** A plan runs once at a time; a second waits. The same submit twice with the same key returns the recorded run and writes nothing. Each move write is keyed by move and run. The league has no repeat-safe key, so retry only when nothing was sent or a refusal came before the write. A timeout or unreadable answer is `unknown`, never retried automatically; the owner checks the league, then discards or replaces the move. A failed move stays open until the owner confirms a retry or discards it. A pending waiver or trade is never retried. A move a stopped group did not attempt returns to `saved` for a fresh confirmation.

## 7. Reads

**Roster.** Report `places` as used, maximum, and free, split by starting and bench. Report each reserve list by name with its eligibility, capacity, occupancy, and free count. Report illegal occupants and the cure, and locked players. Plain copy: "Places: 4 of 5 used, 1 free. IR: 1 of 2 used, accepts an injured player. IR+: 0 of 1 used, accepts an injured or out player."

**Plan.** Report free places and free reserve places by list before and after each move. For each move report what it frees and uses: places, reserve lists by name, money, and picks. Report the placement, dependencies, the move that blocks it, its group, its confirmation, and its result. Plain copy: "Add Blake Coleman uses the place J.T. Miller frees. It runs after that move." or "This move needs a place. Nothing in this plan frees one. Add a drop or move a player to a reserve list."

**Groups.** Report each group's members in order, its status (ready, blocked, partly done, done), the action that landed, the action that failed, the actions that did not run, and the cure. Plain copy: "This group ran in part. The drop reached your league. The move to IR failed: the player was already there. The add did not run. Check your roster."

**MCP fields.** Use the same names on the roster read, the team summary, and the plan read: `places` with `used`, `maximum`, `free`; `reserve` as a list of `name`, `eligibility`, `capacity`, `occupied`, `free`; per move `placesFreed`, `placesUsed`, `reserveFreed`, `reserveUsed`, `dependsOn`, `blockedBy`, `group`, `confirmation`, `actions`,
`decidedBy`, `surface`, `runDecidedBy`, and `runSurface`. The team summary and the plan read also carry `canFree` as the reserve moves the lists have room for, each with the player, the list name, and the active place it frees; `addsPossible`; `addsWithFixes`; and `illegal` as each blocker with its `fact` and the plain `cure`, including the drop that clears it. The plan read also carries `snapshot` and the
league's `waiverBid` shape. No write tool.

## 8. Slices

Each slice ships alone, ends with the project checks, and keeps the live page working.

| Slice                        | Work                                                                                                                                         | Evidence                                                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Facts and reads           | Reserve lists by name, capacity, occupancy, and eligibility; place accounting; roster, summary, and plan fields; page and MCP words.         | IR and IR+ report separately. A full active roster with a free IR place shows 0 places free and 1 IR free. Page and MCP agree.                                                                                                                                        |
| 2. Effects and replay        | Typed effects; place and reserve dependencies; order; validation; blocked dependents; insert, edit, discard rechecks.                        | A stash frees a place a later add uses. An add to reserve follows the activate that frees the place. A healthy player cannot stash to an injured-only list. Two moves cannot claim one IR place. A failed freeing move blocks its dependent, not an independent move. |
| 3. Groups                    | Whole-group check; internal order; actions and partial outcome; re-read and recheck; group copy.                                             | A drop, stash, and add group runs in order. A stale member stops the group with nothing sent. The league accepts the drop and rejects the stash; the group records drop executed, stash failed, add skipped, reads the roster, and explains.                          |
| 4. Submission and provenance | Confirmation states; owner confirmation; confirmed future move on the check; run record; move read provenance; repeat-safe submit and retry. | A saved move on its day waits in Today. Confirming it runs it. A confirmed future move runs on the check after the clock advances, with the confirmation recorded. The same submit twice returns one run. An unknown outcome is not retried.                          |
| 5. Words and record          | Update the glossary, MCP document, transactions model, page copy, and the old line that a saved move runs on the check.                      | No page or document says a saved move runs without confirmation. The glossary, page, and MCP share the words for places, reserve lists, confirmation, and partial groups.                                                                                             |

## 9. Questions

1. When a group partly lands, should the remaining moves stay in the queue as invalid until the owner repairs or discards them, or should the whole group be rebuilt? This design keeps them, marked invalid, with a repair action.
2. Should a confirmation for a later day be one decision per group, or can the owner confirm a whole team's saved plan at once? This design confirms a group, because a group is the unit that runs together.

## 10. Roster fixes

To fit an add, the server may need to legalize the roster first: move a healthy player off an injury list, move an injured player onto it, or shift a bench place. The same placement engine used for lineups runs in reverse here, with the target "make the roster legal and free the places the confirmed move needs", choosing the smallest set of eligibility moves.

The generated moves appear as one group labelled "Roster fixes", editable and discardable like any other move. The agent still asks only for the add, drop, or reserve move; the server does the shuffle and shows it. Validation uses the planner to answer whether an add can fit and, when it cannot, to state the exact cure.

Roster fixes are generated for slice 3 with groups, ordered before the move they fund.
