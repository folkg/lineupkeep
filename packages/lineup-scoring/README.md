# @lineupkeep/lineup-scoring

Exact arithmetic for a fantasy league's own scoring rules. Given a league's stat categories, its
stat modifiers, and one player's statistics for one basis, this package returns that player's
fantasy points — or a named statement that the total cannot be established.

This package contains no IO, provider code, database, clock, randomness, or Effect services. It does
not know what a league is beyond a set of rules, and it does not choose lineups.

## Boundary

The package starts once a league's scoring rules and a player's statistics have been decoded. It does
not read Yahoo, does not know stat ids by name, and does not decide whether a statistic matters for a
period. Turning a provider's league settings into a `ScoringProfile` and a provider's player stats
into `StatObservation`s is the adapter's job; this package only does the arithmetic.

Three things stay outside:

- **Projections.** The package scores values it is given. It has no notion of a forecast.
- **Ranking and ownership.** A rank, an ownership percentage, or a "percent started" number is not a
  statistic under a league rule, so it cannot enter a total.
- **Lineup selection.** Maximising a total across roster slots belongs to `@lineupkeep/lineup-solver`.

## The profile

```ts
const profile = scoringProfile({
  categories: [{ statId: 4, label: "Passing Yards" }],
  rules: [{ statId: 4, points: "0.04" }],
});
```

A category is a stat the league declares. A rule is a stat the league scores, with the points it
awards per unit. A category without a rule is a declared stat the league does not score; a rule
without a category is a scored stat the league does not list. Both are coverage facts, not errors.
`profile.scale` is the largest number of fractional digits among the rules, and it is the scale at
which the league's own arithmetic is exact.

Malformed leagues throw: a duplicate rule, a duplicate category, or a modifier that is not a plain
decimal is a caller contract failure, not a league refusal.

## Exact decimal representation

Every rule and every statistic is held as `{ units: bigint; scale: number }`, meaning
`units / 10^scale`, reduced by trailing zeros so that equal values are equal. Points are computed as
`Σ value × rule`, entirely in `bigint`, at a scale that is the sum of the two operand scales.

There is no floating-point arithmetic anywhere in a total. A modifier of `0.04` and a stat value of
`253` are exactly `10.12`; `0.1 + 0.2` equals `0.3`; three receptions at `0.1` each equal exactly
`0.3`. This matters because the solver's comparisons are integer comparisons: if the policy had
rounded intermediate points, two players could swap places on noise.

Stat values arrive as decimals in their own right — hockey goals-against average and save percentage
are published with fractional digits — so value scale and rule scale are tracked separately and never
collapsed. Values are parsed from their decimal text; a value that arrives as a JSON number is parsed
from the number's own shortest decimal form, which is exact for what the provider sent.

Converting a total to a declared integer scale rounds halves away from zero. Everything else is exact.

## Scoring one period

```ts
const score = scorePeriod(profile, [
  { statId: "4", value: 253 },
  { statId: "8", value: 1 },
]);
```

| Situation                                  | Result                                             |
| ------------------------------------------ | -------------------------------------------------- |
| A scored stat has a value                  | `value × points` is added                          |
| A scored stat is absent from the series    | contributes nothing, and is reported as `absent`   |
| A scored stat is present with a null value | the total is `unknown` and names the stat          |
| No statistics at all                       | the total is `unknown` with `no-observations`      |
| A stat the league does not score           | contributes nothing, and is reported as `unscored` |

The absent-stat rule is not a guess. For a recorded football league, summing `value × modifier` over
the stats each starting player's series _did_ contain reproduced the provider's own weekly team total
exactly for three consecutive weeks (109.14, 144.60, 98.02; difference zero each time). A scored stat
the provider omits is therefore a real zero contribution under the league's own arithmetic.

Zero stays a real value: a player whose scored stats are all present at zero scores a known zero.
Unknown never becomes zero, and zero never becomes unknown.

## Coverage

```ts
describeScoring(profile, observedStatIds);
```

reports which observed stats the league scores, which observed stats it does not, which rules no
player ever exercised, which rules have no declared category, and which categories have no rule. The
recorded football league is 36 categories, 33 rules, three unscored categories (Rushing Attempts,
Points Allowed, Targets), and no unused rules.

## Verification

The test suite covers exact decimal behaviour, negative and decimal modifiers, absent and unknown
stats, malformed leagues, and one recorded league: the real 33 modifiers and the real week-6
statistics of a nine-starter lineup reproduce the provider's own 98.02 exactly, with a hand-checkable
quarterback row of 17.02.

## Deliberately outside this package

- Availability, byes, trailing windows, aggregation across periods, and any choice of selection value.
- Provider payload decoding, slot eligibility, locks, and period coverage.
- Category outcomes, rotisserie standings, projections, ranks, and ownership.
