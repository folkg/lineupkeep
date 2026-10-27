# @lineupkeep/lineup-policy

The opinionated layer between provider facts and lineup selection. Given a league's roster slots, a
retained roster with each player's availability, and one published value source, this package
produces the solver's `LineupProblem` — values, availability tiers, and locks — together with the
reasoning for every decision it made.

This package contains no IO, provider code, database, clock, randomness, or Effect services. It does
not read a provider and does not assign players to slots. It also does not perform the arithmetic of
scoring: that belongs to `@lineupkeep/lineup-scoring`.

## Boundary

```text
provider adapter            this package                    @lineupkeep/lineup-solver
value source        ─┐
slot declarations   ─┤
player availability ─┼──▶  LineupProblem + valuations  ──▶  plan or refusal
```

The provider adapter decides what exists: which slots a league declares, which positions a player may
occupy, what an injury code means, which periods a player has no game, whether a player is locked.
This package decides what those facts are worth, how likely each player is to appear, and which
availability rung that puts them on.

## One value source per problem

```ts
type LineupPolicyInput = {
  readonly period: Period;
  readonly source: ValueSource | undefined;
  readonly slots: ReadonlyArray<RosterSlot>;
  readonly players: ReadonlyArray<PolicyPlayer>;
};

type ValueSource =
  | { readonly kind: "projected-points"; readonly projections; readonly realised }
  | { readonly kind: "scoring-rules"; readonly window; readonly scoring; readonly observations }
  | { readonly kind: "percent-started"; readonly started };
```

The input carries **exactly one** measurement, so two basis kinds cannot be mixed by construction. The
policy derives the basis string from the source, and every player in the returned problem carries it,
so the solver cannot receive a mixed-basis problem from this layer.

`preferredValueSource` states the ladder the adapter applies: projected points, then league rules,
then the started percentage. `buildLineupProblem` refuses `no-value-source` when the caller passes
`undefined`, and `no-observed-periods` when the scoring-rules window is empty.

The scoring-rules source is also checked for internal consistency: the target period may not belong to
its own observation window, an observation outside the window is rejected rather than ignored, and a
period or player may not appear twice.

## The values

**Projected points.** A player's value is the provider's projection for the target period, in
hundredths. A realised total in the same source is recorded as context and never added to it. A player
without a projection is `unusable` with reason `missing`: never zero, and never started. The solver
benches that player while a bench or reserve slot can hold them.

**Scoring rules.** For each player, each window period is either **counted** or **skipped**:

- a period the player has no game in is skipped (a published bye, not a zero performance);
- a period with no observation for that player is skipped;
- a period whose scored total is unknown is skipped;
- every other period contributes its exact points.

The player's value is the mean of the counted periods, at the scoring profile's own scale. A player
with no counted period has no measured value; they are valued at zero and the valuation records that
the mean is absent and which periods were skipped, so one unmeasured player never disables a run.

**Started percentage.** A player's value is the published percentage for the chosen population, in
hundredths of a percent. It is an ordinal crowd signal, not an expected score: it is never added to,
multiplied by, or converted into points. The population is the first preferred cut (diamond) that
carries a value above zero for at least one roster player, otherwise the overall percentage; a
published-but-all-zero cut is treated as unpopulated. A published zero is a real value. A player
without a value in the chosen population is `unusable` with reason `missing`: the plan parks them on
the bench or in a reserve slot rather than inventing a number for them, and refuses only when they
cannot be parked or are the only candidate for a required starting slot.

Whichever source is active, availability is the same number for the same player: nothing is halved,
zeroed, or refused for a status.

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

A `PlayerValuation` records the availability tier and the fact that selected it, the selection units,
and a kind-specific `value`: the counted and skipped periods with each period's exact points and the
mean for the scoring-rules basis, the projection with its realised context for the projections basis,
or the population and percentage for the started basis. That is the evidence a person needs to
disagree with a lineup, and it makes the basis of every number explicit.

The policy refuses outright when:

- `no-value-source` — the caller has no published measurement to value the roster with;
- `no-observed-periods` — the scoring-rules window is empty.

Any further refusal comes from the solver and names its own reason.

## Verification

The suite covers each status-to-tier mapping, identical values across tiers, bye and unknown-period
skipping, an unmeasured player, a run that keeps planning despite an unrecognised status, the owner's
two availability scenarios, reserve eligibility derivation, and two worked examples on a recorded
football roster.

It also covers the value-source ladder and its cases: the ladder order, the derived basis per source,
a projection used as the value with its realised total recorded but not added, a player without a
projection left unusable instead of valued from statistics, a started percentage valued in hundredths,
a populated diamond cut preferred over the overall percentage, an all-zero cut falling back to the
overall percentage, a zero percentage kept as a real value, a missing percentage parked on the bench,
and a healthy low-percentage player ranked above an excluded high-percentage one.

## Deliberately outside this package

- Provider injury codes, bye weeks, coverage types, slot names, and editability flags.
- Reading statistics, writing lineups, provider period freshness, and lock revalidation.
- Assignment optimisation, which is `@lineupkeep/lineup-solver`'s only job.
