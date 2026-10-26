# Lineup selection policy

This is the opinionated layer that decides what a starting position is worth. It is deliberately
small, deliberately documented, and meant to be disagreed with: everything below is a decision, not a
discovery. The arithmetic underneath it is exact; the choices are not.

Read [the glossary](GLOSSARY.md) for _selection value_, _lineup optimization_, and _native start-active
action_, and [the research record](RESEARCH.md#live-yahoo-league-scoring-evidence-2026-10-26) for the
provider evidence these decisions rest on.

## The objective

**Maximise the expected points of the starting lineup**, given one value per roster player for one
period. The solver is exact, so once the values are accepted the chosen lineup is genuinely the best
one available under them.

That is a simplification whenever a league is not actually scored by points. A head-to-head category
league is won by taking more categories than an opponent, not by accumulating a scalar; a rotisserie
league is won by relative standing across categories. Both reward a _portfolio_ of stats rather than a
total, and no per-player scalar reproduces either. So this policy does not attempt it:

- A league that publishes additive points rules is scored, and the objective is honest.
- A league that publishes no points rules is **refused** with `no-scoring-rules`, and the worker keeps
  the provider's own start-active action for that team.

Refusing is the deliberate answer, not a gap. A category league scored by an invented scalar would
look like optimisation while optimising something nobody is playing for.

## Which leagues are scoreable today

| Sport    | Leagues available        | Points rules | Scoreable |
| -------- | ------------------------ | ------------ | --------- |
| Football | 1 points league          | 33 modifiers | yes       |
| Hockey   | 3 category, 1 rotisserie | none         | no        |

Every hockey league in the linked account publishes categories with no `stat_modifiers` at all, which
is what a category or rotisserie league looks like in the provider's own settings. Their statistics
are real, dense, and complete — including decimal ratio stats and genuine nulls — but there is no
league rule that turns them into points. Hockey custom optimisation is therefore not ready, on
evidence rather than on missing data, and those teams continue to use the native action.

The pipeline itself is basis-agnostic: hockey date coverage is available and behaves like a season
series per date, so a dated _points_ league would be scored the same way. No such league exists here,
so that path is exercised only by fixtures.

## What a value means

One league, one target period, one window, one basis string. For a target week, the window is the
last four completed weeks. For a target date, it is the last four completed dates.

A player's value is the **mean realised points per counted period**, at the league's own scoring
scale. A period is _counted_ when the player had a game scheduled in it and the provider published a
complete total for it. A period is _skipped_ when:

- it was a published bye for that player, or
- the provider published no statistics for that player, or
- a statistic the league scores had no value, so the period's total is unknown.

A player with no counted period has no value. They are not valued at zero; the policy returns an
unusable selection so the solver refuses.

Why a trailing mean and not a season total: there is no projections surface, and a season total mixes
weeks already played with different opponents, roles, and byes. A four-week mean is responsive to a
role change and stable enough not to chase one big game. It is still backward-looking, and it is the
main thing to argue with.

## Availability, applied once

Each condition is a fact with one stated effect. Conditions are ordered; only the first that applies
is applied, so a player is never penalised twice for one fact.

| Condition                                          | Effect                             |
| -------------------------------------------------- | ---------------------------------- |
| Out, injured reserve, suspended, or not active     | value 0, named                     |
| The player's team has no game in the target period | value 0, named                     |
| The status is not recognised                       | unusable, held in the current slot |
| No counted period                                  | unusable, `missing`                |
| Day to day                                         | the mean, halved                   |
| Healthy                                            | the mean                           |

Three consequences worth stating plainly:

- An excluded player's zero **replaces** the mean. It is not the mean multiplied by zero, and it is
  not also discounted for a bye.
- A bye is a known absence of opportunity, so it is zero for the target period and excluded from the
  mean. Football rosters publish `bye_weeks`; hockey does not need it, being date-scoped.
- An unrecognised status is neither healthy nor injured. The player keeps the slot the provider has
  them in, and their value is unusable. If that slot is a starting slot, the solver refuses and the
  worker falls back to the native action. A new provider status code therefore costs custom
  optimisation for that team until it is mapped in one place, in the provider adapter. That is the
  conservative trade, and it is intentional.

The half for day-to-day is a coin-flip assumption about whether the player appears. It is a discount,
not a measurement. It lives as one named constant in the policy so it can be changed or dropped
without touching anything else.

## Slots, eligibility, and locks

Everything here comes from the provider's published facts rather than from assumptions about what a
position name means:

- **Starting, bench, and reserve areas** come from the league's declared roster positions, each with
  its count and whether it is a starting position.
- **Eligibility** comes from each roster player's published `eligible_positions`, which lists the slot
  names that player may occupy — including flex names and reserve list names. Bench space is open to
  every player.
- **Locks** come from the provider's per-player editability flag: a player who is not editable is
  pinned to the slot they already occupy.
- **Reserve lists stay distinct**: a player eligible for one reserve list is not automatically
  eligible for another.

Two readings the provider evidence does not settle, stated so they can be corrected:

- **Starting positions are treated as required.** Filling every starting slot is legal under either
  reading of whether an empty starting slot is accepted, so the plan never depends on an unverified
  rule. The cost is that a negative-valued player can be forced into a starting slot.
- **Declared capacity is a hard maximum.** Whether the provider shares one standard-roster allowance
  between starters and bench instead of enforcing the advertised bench count is unverified. Treating
  the declared counts as maxima cannot invent roster space; if the retained roster does not fit, the
  solver refuses rather than dropping a player.

## Worked example: a real football lineup

The league's own 33 modifiers, a real 15-player roster, target week 7, window weeks 3–6. Values are
means in points; the solver works in centi-points.

| Player  | Slot  | Bye | Editable |    W3 |    W4 |    W5 |    W6 | Counted | Value |
| ------- | ----- | --: | -------- | ----: | ----: | ----: | ----: | ------: | ----: |
| QB-1    | QB    |   9 | no       | 23.68 | 23.96 | 22.00 | 17.02 |       4 | 21.67 |
| RB-2    | RB    |  10 | no       |  7.80 |  6.10 | 31.50 |  6.90 |       4 | 13.08 |
| RB-3    | RB    |  11 | no       |  3.90 |  4.20 |  4.80 |  3.00 |       4 |  3.98 |
| WR-4    | WR    |  11 | no       | 28.40 | 14.60 | 18.80 | 12.20 |       4 | 18.50 |
| WR-5    | WR    |  11 | no       |  0.00 | 27.70 | 37.70 | 14.00 |       4 | 19.85 |
| TE-6    | TE    |  11 | no       | 24.10 | 11.70 |  1.40 |  1.90 |       4 |  9.78 |
| W/R/T-7 | W/R/T |   8 | no       | 19.70 | 19.60 |  8.60 | 14.30 |       4 | 15.55 |
| BN-8    | BN    |   7 | yes      | 17.00 | 11.10 | 11.60 | 24.70 |       4 |  0.00 |
| BN-9    | BN    |   5 | no       |  4.00 | 11.00 |   bye | 14.30 |       3 |  9.77 |
| BN-10   | BN    |  10 | no       |  7.60 |  1.40 |  9.80 |  3.90 |       4 |  5.68 |
| BN-11   | BN    |  13 | no       |  0.00 |  0.00 |  0.00 |  0.00 |       4 |  0.00 |
| BN-12   | BN    |  10 | no       | 10.70 | 19.30 |  0.70 | 14.60 |       4 | 11.33 |
| BN-13   | BN    |   7 | yes      |  1.60 | 13.20 | 11.00 | 13.40 |       4 |  0.00 |
| K-14    | K     |  11 | no       | 10.00 |  9.00 | 12.00 |  1.00 |       4 |  8.00 |
| DEF-15  | DEF   |  11 | no       | -1.00 |  5.00 |  6.00 |  6.00 |       4 |  4.00 |

Reading the table:

- `QB-1` is `(23.68 + 23.96 + 22.00 + 17.02) / 4 = 86.66 / 4 = 21.665`, kept at the league's scale
  as **21.67**. Their week-6 17.02 is itself `253 × 0.04 + 2 × 4 + 1 × −1 + (−1) × 0.1`.
- `BN-9` was on bye in week 5, so that week is excluded and the value is
  `(4.00 + 11.00 + 14.30) / 3 = 9.767` → **9.77**. Counting the bye as a zero would have produced
  7.33 and underrated them.
- `BN-8` and `BN-13` have values of 16.10 and 9.80, but week 7 _is_ their bye, so their target value
  is a known **0.00**. The mean is still reported beside it, so the reason is visible.
- `BN-11` is on injured reserve and valued a known **0.00** however their past weeks scored.

**As the provider has it.** Thirteen of fifteen players are locked, including the two bench players on
bye and the starting running back `RB-3`. Nothing can legally move, so the plan is the current lineup:

| Slot   | QB    | RB    | RB   | WR    | WR    | TE   | W/R/T   | K    | DEF    |
| ------ | ----- | ----- | ---- | ----- | ----- | ---- | ------- | ---- | ------ |
| Player | QB-1  | RB-2  | RB-3 | WR-4  | WR-5  | TE-6 | W/R/T-7 | K-14 | DEF-15 |
| Value  | 21.67 | 13.08 | 3.98 | 18.50 | 19.85 | 9.78 | 15.55   | 8.00 | 4.00   |

Total **114.41**, zero changes. The solver reports the locked lineup rather than pretending an
improvement it cannot make.

**If the same roster were editable.** `BN-12` is eligible at running back and worth 11.33, while
`RB-3` is worth 3.98. The plan starts `BN-12` at the second running back slot and benches `RB-3`:

| Slot   | QB    | RB    | RB    | WR    | WR    | TE   | W/R/T   | K    | DEF    |
| ------ | ----- | ----- | ----- | ----- | ----- | ---- | ------- | ---- | ------ |
| Player | QB-1  | RB-2  | BN-12 | WR-4  | WR-5  | TE-6 | W/R/T-7 | K-14 | DEF-15 |
| Value  | 21.67 | 13.08 | 11.33 | 18.50 | 19.85 | 9.78 | 15.55   | 8.00 | 4.00   |

Total **121.76**, one change, `114.41 − 3.98 + 11.33`. Nothing else improves: `BN-8` and `BN-13` are
on bye, `BN-10` is worth less than every starter it could replace, and `BN-9`'s 9.77 cannot displace
anyone it is eligible to replace. `DEF-15`'s 4.00 is kept because the defence slot is required and
they are the only defence.

## Worked example: a real hockey lineup

The same policy, pointed at one of the four hockey leagues — 21 rostered players, twelve categories,
`C 2, LW 2, RW 2, D 4, G 2, BN 7, IR 2, IR+ 1, NA 2`, all players editable before that day's games.
The provider publishes no `stat_modifiers` for the league, and the raw settings body does not contain
the key at all.

The policy returns `no-scoring-rules`. Nothing is valued, nothing is written, and the team keeps the
provider's native start-active action. The evidence that this is a league-format fact rather than a
missing read is in [the research record](RESEARCH.md#live-yahoo-league-scoring-evidence-2026-10-26):
the four hockey leagues each publish categories and no modifiers, while the football league publishes
one modifier list and no category without a rule.

What remains available for those teams is what already shipped: exact rosters, statistics, schedules,
and the provider's own start-active action. What is missing for custom optimisation is a scoring rule
the league actually plays under.

## Tradeoffs you can disagree with

1. **Points over categories.** Maximising points is right for a points league and wrong in kind for a
   category or rotisserie league, so the policy refuses the latter instead of approximating it.
2. **Four completed periods.** Shorter is more responsive to role changes and noisier; longer is
   steadier and staler. Four weeks is a judgement.
3. **A trailing mean, not a forecast.** There are no projections. A player's first big game is
   invisible until it is behind them, and a returning starter keeps a depressed value while missed
   weeks are still inside the window.
4. **Byes excluded, injuries counted.** A published bye is a known absence of opportunity, so it is
   excluded from the mean. A week a player was injured looks like a zero performance, because the
   provider's dense series cannot distinguish the two.
5. **Day-to-day halves.** A coin flip on appearing, expressed as a factor. Defensible, arbitrary, and
   easily changed.
6. **Unrecognised statuses refuse.** One unknown code disables custom optimisation for that team until
   the adapter's mapping is extended. The alternative — assuming health — is worse.
7. **Starting positions are required.** Conservative against an unverified rule, at the cost of
   starting a negative player when every candidate is negative.
8. **No per-game rate.** The provider publishes no games-played count, so a season total cannot become
   a rate and the policy does not invent a denominator.
9. **Bench capacity is a hard maximum.** Unverified against the provider, but it cannot invent space.

## What this policy does not do

- It does not read a provider, validate a session, or refresh period coverage.
- It does not write a lineup, and it does not translate a plan into provider requests.
- It does not consider opponents, matchups, remaining games, weather, or probable starters.
- It does not use ranks, ownership, or percent-started values, and it will not mix a weekly total with
  a season total in one value.
- It does not optimise category outcomes, rotisserie standing, or playoff leverage.
