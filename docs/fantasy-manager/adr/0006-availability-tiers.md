# Availability tiers in the lineup objective

## Context

The selection policy first treated availability as an adjustment to a player's value: out, injured
reserve, suspended, and not-active players were valued at zero, a bye was valued at zero, day to day
was halved, and an unrecognised status refused the whole team. That conflated two different facts — how
much a player is expected to contribute, and whether they will appear at all — and it produced three
consequences the owner rejected:

1. An injured star and a healthy player who genuinely scores nothing were indistinguishable.
2. Day to day became a scoring discount, so a doubtful player could not compete on value with a
   healthy one, and vice versa.
3. One unmapped status code disabled custom optimisation for an entire team.

The owner's correction: an injured player should not take a starting position from anyone healthy, but
if a position would otherwise stay empty, an injured player should fill it in case they come off as a
game-time decision — and injury should not be counted twice by also discounting the score.

[Round 3](../DECISIONS.md#round-3-decisions) item 5 already asked for exactly this behaviour, and
[Round 4](../DECISIONS.md#round-4-decisions) item 3 put participation preference in the league
policy rather than the provider-agnostic solver.

## Decision

**Availability is a separate dimension that the objective orders against value.**

1. A player carries one availability tier per period, from a ladder declared by the policy:
   `will-play`, `might-play`, `will-not-play`. Three rungs match the provider's own grain (`DTD` is
   distinct from `O`/`IR`/`IR-LT`/`SUSP`/`NA`); a two-rung ladder would either treat day to day as
   healthy or lose the ordering of "may appear" above "will not appear".
2. The pure solver learns only that the ladder is ordered from most to least available, and each
   player's rung. It learns no injury vocabulary, so Round 4 item 3 still holds: which fact means
   which rung is a policy decision made in a single total function.
3. The objective is lexicographic: required positions filled; then the count of starting players in
   the most available tier, then the next tier down; then total starting value; then the existing
   tie-breaks. Availability dominance is a comparison between tiers, never an adjustment to a value.
4. Availability never modifies a selection value. The same player is worth the same number in every
   tier. A bye is an availability fact, not a zero.
5. A starter counts towards its tier only when its value is not negative, so an available player who
   is expected to cost points does not take a position that would otherwise stay empty, and an
   unavailable player worth something can.
6. A provider status code the adapter does not recognise becomes a recorded `unrecognised` fact on the
   `might-play` rung. It never refuses a run and never displaces a player the provider calls healthy.
7. A player with no counted period is valued at zero, with the absent mean and skipped periods
   recorded, instead of refusing the run.

## Consequences

- A healthy player starts ahead of a doubtful or unavailable one whatever the values are, which is the
  behaviour the owner asked for.
- An unavailable player still fills a position that would otherwise stay empty, and competing
  unavailable players are ranked by value.
- Availability dominance cannot be bought with points, so a doubtful star can be benched for a healthy
  journeyman, and the reported plan total is availability-blind: it is the objective's value term, not
  an expected score.
- An unrecognised code can under-rank a healthy player, and can over-rank an absent one, until the
  adapter's table is extended; the code is kept on the valuation so the plan's evidence names it.
- A productive player whose statistics the provider omitted is priced at zero rather than blocking the
  team, so a data gap can silently bench a player instead of falling back to the native action.
- The exact assignment encoding grows one weight per rung, each larger than everything below it plus a
  full ladder of counts, so tier dominance is proved rather than approximated.

## Amended: a fourth rung for a player with no game

**2026-10-27, owner-approved.** The ladder gains `not-scheduled` below `will-not-play`. The original
three rungs were drawn from the provider's status codes alone, and that was the whole problem: a
player whose team is not playing carries no status code, so a ladder selected only by status could not
see the fact at all. Measured on the owner's account, the planner started fifteen of fifty-seven
players whose teams had no game that date, because the only consumer of "no game" could fire for a
weekly period and every hockey league is date-scoped.

The two facts are different and deserve adjacent rungs. `will-not-play` says the player will not appear
though they could; `not-scheduled` says there is no game to appear in. The reference prefers the
former when a position must be filled by someone who cannot contribute, and that ordering is kept
here. Availability is still a dimension and never a discount: a player with no game keeps their value.

The rung is declared by policy with the rest of the ladder, so the solver is unchanged — it compares
rungs by declared order and needs no new rung, weight, or objective term.

## Deferred

Real-world starting status (for example a backup quarterback) is not on the ladder. The provider
publishes no depth-chart or snap-share signal today, and the trailing mean of realised points already
prices the role a player actually had. When such a signal exists it belongs to the value basis, where
expected opportunity is priced once, not to the availability ladder, which only says whether a player
appears at all.
