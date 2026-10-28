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

The current ladder is six rungs, ordered `confirmed-start`, `will-play`, `might-play`,
`unlikely-to-play`, `will-not-play`, `not-scheduled`. The original decision below had three; the
amendments record how the other three were added and why.

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
7. A player with no counted period is valued at zero instead of refusing the run. The absent periods
   stay inside the provider adapter; only the final score crosses the seam.

## Consequences

- A healthy player starts ahead of a doubtful or unavailable one whatever the values are, which is the
  behaviour the owner asked for.
- An unavailable player still fills a position that would otherwise stay empty, and competing
  unavailable players are ranked by value.
- Availability dominance cannot be bought with points, so a doubtful star can be benched for a healthy
  journeyman, and the reported plan total is availability-blind: it is the objective's value term, not
  an expected score.
- An unrecognised code can under-rank a healthy player, and can over-rank an absent one, until the
  adapter's table is extended. The code stays inside the adapter; the run observation records the
  scheduled and starting-lineup facts, not the code.
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

## Amended: a top rung for a confirmed real-world start

**2026-10-27.** The ladder gains `confirmed-start` above `will-play`. The premise this ADR first
recorded in its _Deferred_ note — that the provider publishes no depth-chart or snap-share signal —
was wrong for goalies: the roster publishes `starting_status` on them, and measured on the owner's
account it carries `is_starting: 1` for the goalie who will start and `0` for the backup. Percent
started cannot tell those two apart, so a backup the crowd leaves unstarted could take a starting
slot from the confirmed starter.

It is a participation refinement, not a fourth kind of absence, and it is expressed the only way this
ADR allows: as a rung. The fact crosses the seam as `ProviderRosterPlayer.startingLineup`, the adapter
turns it into a rung, and the solver still compares rungs by declared order. The refinement applies
**only** to a player the status table already calls available, so it can never lift an injured or
suspended player above a healthy one, and it never adjusts a value. A confirmed starter who is out
stays on `will-not-play`, below every player who will play.

The trailing mean of realised points already prices the role a player actually had, and this rung does
not touch it: expected opportunity stays in the value basis, and the ladder only says who will appear.

## Amended: confirmed non-starting is its own state

**2026-10-27.** The first amendment collapsed three provider states into two: `1` became confirmed
starting and both `0` and an absent field became "not confirmed starting". A goalie confirmed to be
the backup and a goalie whose starter had not been announced therefore landed on the same rung, and
their scores decided the slot. The owner reported exactly that: a goalie the provider marked as not
starting started ahead of an unconfirmed goalie, because percent started is not a participation
signal.

The seam keeps the provider's three states as `confirmed-starting`, `confirmed-not-starting`, and
`unconfirmed`, and says nothing about what a non-start means. The adapter resolves that meaning from a
declared, data-driven table keyed by sport and position rather than from a goalie branch:

| Position class   | Provider positions                                                                     | A confirmed non-start means     |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------- |
| goalie           | hockey `G`                                                                             | `unlikely-to-play`              |
| starting pitcher | baseball `SP`                                                                          | `unlikely-to-play`, provisional |
| relief pitcher   | baseball `RP`, `P`                                                                     | not an availability fact        |
| position player  | hockey skaters; baseball batters, `Util`, `DH`; every football and basketball position | not an availability fact        |
| undeclared       | any sport or position                                                                  | not an availability fact        |

The two interpretations are the whole vocabulary, and the tables are data so the four sports the
reference supported are all declared before any of them is a live adapter capability. A hockey goalie
is the first class because only one goalie starts and the backup almost never appears. A baseball
starting pitcher is the second because only today's announced starter takes the ball; a relief pitcher
or a batter can appear without starting, so a non-start says nothing. Football and basketball are the
cases that keep the table safe: a receiver or a bench player still plays in a rotation, so a non-start
is not an availability fact. An undeclared sport maps to the `position player` class, whose rule is not
an availability fact, so it can never silently bench a player. Adding a sport requires a position map
and adding a class requires a rule; both are type-checked, and one test walks every declared sport,
position, and class so an undecided entry is a visible gap rather than a default.

Baseball is **provisional**. The reference read `is_starting` for every MLB player, applied a penalty
when it was `0`, and separately penalised starting-pitcher-only eligibility, while its own comment
worried about late confirmations and never settled the reliever case. This ADR keeps only the
starting-pitcher rule; relief pitchers and generic pitchers are not demoted until a live baseball
surface and the provider's own evidence settle it. [The research
record](../RESEARCH.md#starting-lineup-interpretation-across-four-sports-2026-10-27) cites the
reference code for every row.

The ladder gains `unlikely-to-play` between `might-play` and `will-not-play`.

The rung is a participation refinement below "might play" and above "will not play" because the two
facts differ: a doubtful player might start, and a confirmed backup might still be pulled into the
crease if the starter is injured in warmup, while an injured-out player has no path to appearing. A
value still never buys a rung, and a starting-lineup fact never changes a value.

Evidence, measured read-only on the owner's five linked teams on 2026-10-27: `starting_status`
appeared on goalies only; two goalies on the same professional team carried `1` and `0` against the
same opponent, which rules out reading `0` as "not announced"; a reported team carried one `0` and two
absent goalies, all with a game; and no skater carried the field. The dated record is in
[RESEARCH.md](../RESEARCH.md#starting-status-across-the-linked-account-2026-10-27).

## Deferred

Real-world starting status is **implemented for the players the provider publishes it for** — see the
amendments above. The remaining scope is a provider that publishes a starting signal for every
position, which Yahoo does not: the roster carries `starting_status` only for goalies and pitchers, and
a skater's or batter's non-start is not an availability fact. The four-sport interpretation table is
declared and tested, but full baseball and basketball request, scoring, and limits support remains
deferred.
