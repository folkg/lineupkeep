# @lineupkeep/lineup-policy

The opinionated layer between observed statistics and lineup selection. Given a league's roster
slots, a retained roster with each player's availability, and one observation per completed period,
this package produces the solver's `LineupProblem` — values, availability tiers, and locks — together
with the reasoning for every decision it made.

This package contains no IO, provider code, database, clock, randomness, or Effect services. It does
not read a provider and does not assign players to slots. It also does not perform the arithmetic of
scoring: that belongs to `@lineupkeep/lineup-scoring`.

## Boundary

```text
provider adapter            this package                    @lineupkeep/lineup-solver
league rules        ─┐
slot declarations   ─┤
player availability ─┼──▶  LineupProblem + valuations  ──▶  plan or refusal
period observations ─┘
```

The provider adapter decides what exists: which slots a league declares, which positions a player may
occupy, what an injury code means, which periods a player has no game, whether a player is locked.
This package decides what those facts are worth, how likely each player is to appear, and which
availability rung that puts them on.

## The input states its basis

```ts
type LineupPolicyInput = {
  readonly selectionBasis: SelectionBasis;
  readonly period: Period;
  readonly window: ReadonlyArray<Period>;
  readonly scoring: ScoringProfile;
  readonly slots: ReadonlyArray<RosterSlot>;
  readonly players: ReadonlyArray<PolicyPlayer>;
  readonly observations: ReadonlyArray<PeriodObservation>;
};
```

One league, one target period, one window, one basis string. The policy rejects a problem that could
mix bases:

- the target period may not belong to its own observation window, so a partial current-period total
  can never be averaged with completed periods;
- an observation outside the declared window is rejected rather than silently ignored;
- the same period may not appear twice in the window or in the observations.

Every player in the returned problem carries the caller's one `selectionBasis`, so the solver cannot
receive a mixed-basis problem from this layer.

## The value

For each player, each window period is either **counted** or **skipped**:

- a period the player has no game in is skipped (a published bye, not a zero performance);
- a period with no observation for that player is skipped;
- a period whose scored total is unknown is skipped;
- every other period contributes its exact points.

The player's value is the mean of the counted periods, at the scoring profile's own scale, and it is
the same number whatever the player's availability is. Nothing is halved, zeroed, or refused for a
status. A player with no counted period has no measured value; they are valued at zero and the
valuation records that the mean is absent and which periods were skipped, so one unmeasured player
never disables a run.

## The availability tier

Availability is a separate fact, not a discount on the value. Each player is placed on one rung of an
ordered ladder that the problem declares:

| Tier            | Selected by                                                      |
| --------------- | ---------------------------------------------------------------- |
| `will-play`     | no status code                                                   |
| `might-play`    | day to day; an unrecognised status code                          |
| `will-not-play` | out, injured reserve, suspended, not active; a bye in the period |

The ladder is exported as `availabilityLadder` and handed to the solver unchanged; the solver knows
only that it is ordered from most to least available. `assessAvailability` is the single total
function from provider-reported fact to tier, and the valuation records both, including the code of an
unrecognised status so the plan's evidence can explain itself.

A bye wins over a status: a player with no game in the target period cannot appear no matter what the
provider says about their health, so they are `will-not-play` and the fact is recorded as `no-game`.
An unrecognised status is placed on `might-play`: it never blocks a run, and it never displaces a
player the provider calls healthy. The cost is stated in [the policy document](../../docs/fantasy-manager/POLICY.md#an-unrecognised-status-is-doubtful-and-it-is-recorded).

Values are integers in the scoring profile's own scale, so a league whose modifiers carry two decimal
places produces centi-points. The solver's comparisons are then exact.

## Slots and locks

Slots arrive fully described: starting positions with capacity and a required or optional
requirement, bench areas, and reserve lists, each with an eligibility rule. This package adds two
derived facts:

- **Reserve eligibility** is true when the player's positions satisfy at least one declared reserve
  list. A league that distinguishes two reserve lists keeps them apart, because each list's own name
  is part of its eligibility rule.
- **Locks** come from the caller's per-player lock flag, which pins the player to their current slot.
  Availability never adds a lock: an unrecognised status moves like any other tier.

Slot capacity is treated as a hard maximum, and a roster that does not fit is the solver's refusal,
not a policy guess.

## Results

```ts
type LineupPolicyResult =
  | {
      readonly kind: "problem";
      readonly problem: LineupProblem;
      readonly valuations: ReadonlyArray<PlayerValuation>;
    }
  | { readonly kind: "refusal"; readonly refusal: LineupPolicyRefusal };
```

A `PlayerValuation` records the availability tier and the fact that selected it, which periods were
counted and skipped, each counted period's exact points, the mean (absent when nothing could be
counted), and the selection units. That is the evidence a person needs to disagree with a lineup.

The policy refuses outright when:

- `no-scoring-rules` — the league publishes no additive points rules, so no comparable value exists;
- `no-observed-periods` — the window is empty.

Any further refusal comes from the solver and names its own reason.

## Verification

The suite covers each status-to-tier mapping, identical values across tiers, bye and unknown-period
skipping, an unmeasured player, a run that keeps planning despite an unrecognised status, the owner's
two availability scenarios, basis-mixing rejection, reserve eligibility derivation, and two worked
examples on a recorded football roster: the provider-locked lineup the policy must leave alone, and the
same roster when editable, where the solver replaces the second running back with a bench player worth
7.35 more points.

## Deliberately outside this package

- Provider injury codes, bye weeks, coverage types, slot names, and editability flags.
- Reading statistics, writing lineups, provider period freshness, and lock revalidation.
- Assignment optimisation, which is `@lineupkeep/lineup-solver`'s only job.
