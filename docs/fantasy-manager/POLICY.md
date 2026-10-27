# Lineup selection policy

This document records two things that were once the same document and are now deliberately separate:

1. **The product's lineup objective** — how availability and score combine into one legal assignment.
   This is generic: the generic planner builds the problem and `@lineupkeep/lineup-solver` solves it.
2. **The Yahoo adapter's scoring policy** — how one provider turns its own published evidence into one
   final score per player. This is provider implementation detail and lives in
   `contexts/connections/internal/provider-scoring/`
   ([ADR 0009](adr/0009-provider-score-ownership.md)).

Everything below is a decision, not a discovery. The arithmetic underneath it is exact; the choices
are not. Read [the glossary](GLOSSARY.md) for _final score_, _availability tier_, _lineup optimization_,
and _native start-active action_, and [the research
record](RESEARCH.md#live-yahoo-league-scoring-evidence-2026-10-26) for the provider evidence these
decisions rest on.

## The objective

**The solver maximises a lexicographic objective over final scores, not a single score of its own.** In order:

1. Every required starting position is filled. This is legality, not a preference.
2. Starting positions are occupied by the most available tier of player, then by the next tier down.
3. The total selection value of the players in starting positions is maximal.
4. Among plans equal on that value, more zero-valued starting occupancy.
5. Then fewer slot changes, then canonical order.

Availability is a separate axis from value, and it outranks it. A player who will play starts ahead
of a player who might play, who starts ahead of a player who will not play, whatever the three are
worth. Value decides inside a tier, and then across the whole lineup. Once the values are accepted
the chosen lineup is genuinely the best one under that ordering.

The plan it returns reports a total selection value that sums the starting players' values and is
**availability-blind**. That number is the objective's value term, not an expected score: an injured
player's value is counted there even though they will probably score nothing.

That is a simplification whenever a league is not actually scored by points. A head-to-head category
league is won by taking more categories than an opponent, not by accumulating a scalar; a rotisserie
league is won by relative standing across categories. Both reward a _portfolio_ of stats rather than a
total, and no per-player scalar reproduces either. So the provisioner of scores never invents a scalar
for a league whose format it does not model. The generic layer has no opinion about where a score came
from: it receives one score per player, or the provider's refusal, and records the provider's opaque
label for the scheme it used.

## The provider's scoring schemes

Everything in this section is internal to the Yahoo adapter. Another provider constructs scores its
own way and this document does not bind it.

Every league gets exactly one scoring scheme, chosen in this order:

1. **Projected points** the provider publishes for that player and period. This is the primary the
   owner asked for. It is also the one Yahoo does not publish: an exhaustive probe of the player
   detail surface returns no projected points for any of the five leagues, only ordinal ranks
   (`PW`, `PS7`, `PSR`, `PN4W`) and fantasy-_team_ projected points on the scoreboard. Rung one is
   implemented, tested, and never selected by this adapter.
2. **League scoring rules applied to realised statistics** — the arithmetic that reproduces a points
   league's own totals exactly. This is what the football league uses.
3. **Percent started**, the provider's published started percentage for the period. This is the
   owner's "crowdsourcing the decision": the share of leagues that started this player.

A league uses one rung. The adapter evaluates one scheme at a time, so a plan cannot contain two
measurement kinds and a score from one scheme cannot be compared with a score from another. There is no
fallback per player: a league on rung 2 does not score one player by rung 3, and a league on rung 3 does
not mix in points.

When no rung yields scores the adapter returns a structural refusal with a label naming the reason, and
the worker keeps the provider's own start-active action for that team. Refusing is the deliberate
answer, not a gap. When a rung yields scores but the roster cannot be legally placed, the generic
planner refuses transiently and the attempt blocks; it does not silently switch schemes, because the
ladder's order is a judgement about evidence quality, not about roster shape.

That refusal is **structural**: it says the provider cannot value this league, with these settings, at
all, so no later attempt would find a rung either. Every other refusal is **transient** — it names a
fact that could change: the observation window has no completed period yet, the provider's published
values are missing for the roster right now, a locked player blocks a move, or the roster admits no
legal plan. A
transient refusal **blocks** the attempt with its named reason instead of quietly running the native
action; the next scheduled tick is the retry, and a person can act on the roster, lock, period, or
provider problem. The split is [ADR 0008](adr/0008-refusal-kinds-and-planner-cutover.md).

The line between the two is deliberately narrow. A structural claim is about the league and the
provider's declarations, never about one read: absent published values are indistinguishable from
values the provider does not publish, so an empty or unreadable read is transient and blocks rather
than falling back. The observed condition in this account — Yahoo publishes started percentages for
roster players in all five leagues — is why all five teams plan custom. The generic planner's refusals
(no legal assignment, an unscored player who cannot be parked, a roster that exceeds its slots) are
always transient: they describe this roster now, not the league.

### Rung 1: projected points

A projection is used only as the provider publishes it, for the target period. Its unit is points at
the provider's own scale. A realised total published alongside it is recorded as context and is
**never summed** with it: a forward-looking decision takes the projection, and the realised total
stays evidence. A player the provider publishes no projection for is `unusable` with reason
`missing`: the solver never treats a missing projection as zero and never starts that player. It
benches them while it can, and refuses only when the player has no bench or reserve slot or is the
only candidate for a required starting slot.

### Rung 2: league scoring rules

One league, one target period, one window, one scoring scheme. For a target week, the window is the
last four completed weeks. For a target date, it is the last four completed dates, once the adapter
reads dated history.

A player's value is the **mean realised points per counted period**, at the league's own scoring
scale. A period is _counted_ when the player had a game scheduled in it and the provider published a
complete total for it. A period is _skipped_ when:

- it was a published bye for that player, or
- the provider published no statistics for that player, or
- a statistic the league scores had no value, so the period's total is unknown.

A player with no counted period has no measured value. They are valued at zero, and the valuation
records the missing mean and every skipped period. Valuing them at zero keeps the roster placeable;
refusing would let one unmeasured player disable custom optimisation for the whole team. That is a
points-basis decision only: under rung 3 an absent value stays absent.

Why a trailing mean and not a season total: a season total mixes weeks already played with different
opponents, roles, and byes. A four-week mean is responsive to a role change and stable enough not to
chase one big game. It is still backward-looking, and it is the main thing to argue with.

### Rung 3: percent started, and what it does not mean

Percent started is the share of Yahoo leagues that started a player for the target period. It is
**an ordinal crowd signal, not an expected score**. Concretely:

- It cannot be added to points, multiplied by points, or normalised into points. 43 % started is not
  43 points and not 0.43 of anything.
- It is not a forecast of the player's own production. It is what other managers did, and they may be
  wrong, inattentive, or starting the player for a category this league does not score.
- It says nothing about the opponent, the scoreline, or whether a goaltender will actually get the
  start.
- Its unit is a percentage of leagues. The plan's total selection value for this scheme is therefore
  the sum of starting percentages in hundredths of a percent — the objective's value term, not a
  score.

Two facts about the published value shape matter:

- **A zero is a real value**, meaning no crowd league started the player. It is not missing.
- **A missing started percentage is unknown, not zero.** It appears as an absent fragment inside a
  present node. A player without one is `unusable` with reason `missing`: never zero, never the
  average, never a copy of a teammate's value. The plan parks them on the bench or in a reserve slot
  and starts eleven or twelve valued players; it refuses only when that player cannot be parked or is
  the only candidate for a required starting slot. The observed absence in this account is an
  injured-reserve goaltender, which the plan parks.

#### The cut: platinum, one population per plan

The provider can report a started percentage per "cut" — a subset of leagues — as well as the
overall percentage. It validates nothing: a requested literal is echoed whether or not it has data
behind it, so a returned cut is not evidence that the cut is populated.

**The diamond cut is dead and was requested anyway.** Measured on 2026-10-27 across all five teams
in this account, every player in every league carried the diamond cut with `value: 0`, while
platinum, gold, silver, and bronze were populated and differed from the overall percentage. The old
guard — prefer a cut when any roster player's cut is above zero — therefore never fired, and every
plan was priced from the overall percentage while the code appeared to prefer a narrower cohort.

The policy requests **platinum** and uses it only when it is a complete population: every player who
has an overall started percentage also has a platinum one. Otherwise the whole plan is priced from
the overall percentage. That keeps one population per plan, and it never benches a player the
provider did measure just because the cohort omitted them. A cut that comes back present, complete,
and uniformly zero is not treated as a valid population: it would rank the roster at zero, so the
policy records `cut-unpopulated` and falls back to the overall percentage. A cut that is missing for
any measured player records `cut-incomplete`.

The recorded label names the population and, when it fell back, the finding:

- `community-start-rate:cut-platinum:…` — the cut priced the plan.
- `community-start-rate:overall:platinum-cut-incomplete:…` — at least one measured player was not in
  the cohort, so the whole plan used the overall percentage.
- `community-start-rate:overall:platinum-cut-unpopulated:…` — the cut was complete and entirely zero,
  so the whole plan used the overall percentage.

The cost of the rule: a cohort that genuinely excludes a player cannot price that player, so a
single omission makes the plan less narrow. The alternative — mixing the cut and the overall
percentage inside one plan — prices two players from different populations, which is not a comparison.

## Which leagues are scoreable today

| Sport    | Leagues available        | Points rules | Started percentage | Scoring scheme  |
| -------- | ------------------------ | ------------ | ------------------ | --------------- |
| Football | 1 points league          | 33 modifiers | published          | league rules    |
| Hockey   | 3 category, 1 rotisserie | none         | published          | percent started |

Every hockey league in the linked account publishes categories with no `stat_modifiers` at all, which
is what a category or rotisserie league looks like in the provider's own settings. Their realised
statistics are dense but there is no league rule that turns them into points, so they take rung 3.
All four plan. One roster in the account holds an injured-reserve goaltender with no published started
percentage; that player is parked on the reserve list and the league's fifteen starting slots are
filled from the players the crowd does start.

Each plan records the provider's opaque label for the scheme that produced it, prefixed with the
provider key, for example `yahoo/community-start-rate:overall:date:2026-10-27`. Rows written before
this correction keep the label recorded at the time, migrated verbatim from the old `basis` field;
older verification records show the earlier `yahoo:mean-points-per-period:...` form.

**Availability never enters this arithmetic.** The same player is worth the same number whether they
are healthy, doubtful, or out. Nothing is halved for day to day, nothing is zeroed for out, and no
status refuses a run. An unavailable player keeps their mean; the availability tier says they will not
use it this period.

## Availability is its own dimension

Each player carries one availability tier for the target period, drawn from an ordered ladder:

| Tier            | Meaning                    | Provider facts that select it                                               |
| --------------- | -------------------------- | --------------------------------------------------------------------------- |
| `will-play`     | expected to appear         | no status code, and the team has a game                                     |
| `might-play`    | may appear                 | `D`, `DTD`, `Q`, `P`, `GTD`; any status code the adapter does not recognise |
| `will-not-play` | will not appear, but could | `O`, `IR`, `IR+`, `IR-LT`, `SUSP`, `NA`                                     |
| `not-scheduled` | no game to appear in       | no game for the player's team in the target period, including a bye         |

The ladder is four rungs because the provider distinguishes "may appear" from "will not appear" and
neither of those is the same fact as "there is no game". A doubtful player takes a contested starting
position ahead of a suspended one, and a player who will play takes it ahead of both. An injured
player who is dressing is preferred over a healthy player whose team is not playing, when a position
would otherwise stay empty. A three-rung ladder could express only one of those orderings; collapsing
participation into "will not play" also loses the run record's ability to say why a player was benched.

[ADR 0006](adr/0006-availability-tiers.md) records the fourth-rung amendment and its evidence.

The ordering produces the intended behaviour directly, without any discount:

- An available player starts ahead of a doubtful or unavailable one **whatever the values are**,
  because only available starters count towards the top rung. A healthy player worth 0.00 therefore
  starts ahead of an injured player worth 21.67.
- A player who will not play still fills a starting position that would otherwise stay empty, and a
  doubtful player fills it ahead of an unavailable one, because the lower tiers and then the value
  term prefer something to nothing. That is the game-time-decision case.
- Two unavailable players compete on value, so the better of them takes the place.
- A bye is an availability fact, not a zero value. A player on bye keeps their own value and is marked
  `not-scheduled`, exactly as a player whose team has no game that date.

Only the adapter interprets provider codes, and it does so in one table. This policy turns those
facts into tiers in one total function, so every fact reaches exactly one rung; a test walks every
code the adapter can emit and proves it reaches one declared tier. The solver is told only the
ordered ladder and each player's rung, so it stays provider-neutral.

### The status table, in full

The adapter's table is explicit, because the mapping is provider knowledge rather than something to
derive: every code it knows reaches one tier, and every code it does not know reaches `might-play` as
a recorded uncertainty. The `reserve list` column records the reference's reading of which statuses
normally park a player on an inactive list. It is evidence, not a rule: reserve eligibility is read
from the provider's published `eligible_positions` and is **never** inferred from a status code
([RR1](#slots-eligibility-and-locks)).

| Status         | Tier            | Reserve list | Note                                                                 |
| -------------- | --------------- | ------------ | -------------------------------------------------------------------- |
| healthy (none) | `will-play`     | no           | the provider emits no code for a healthy player                      |
| `O`            | `will-not-play` | yes          | out                                                                  |
| `IR`           | `will-not-play` | yes          | injured reserve                                                      |
| `IR+`          | `will-not-play` | yes          | short-term injured reserve                                           |
| `IR-LT`        | `will-not-play` | yes          | long-term injured reserve                                            |
| `NA`           | `will-not-play` | yes          | not active                                                           |
| `SUSP`         | `will-not-play` | yes          | suspended                                                            |
| `D`            | `might-play`    | no           | doubtful                                                             |
| `DTD`          | `might-play`    | no           | day to day                                                           |
| `Q`            | `might-play`    | no           | questionable                                                         |
| `P`            | `might-play`    | no           | probable                                                             |
| `GTD`          | `might-play`    | no           | game-time decision                                                   |
| anything else  | `might-play`    | no           | recorded as an unrecognised code with the code kept on the valuation |

The reference lists `Questionable`, `Probable`, and `Game Time Decision` as _healthy_, so its value
penalty does not touch them. This policy places them on `might-play` instead: "may appear" is what
those codes say, and a player the provider has not confirmed is not the same fact as a healthy one.
The disagreement is deliberate. It costs a doubtful star a contested position against a healthy
journeyman, and it buys the owner's stated rule that availability outranks value without arithmetic.
The reference's own `TODO` asks whether a game-time decision should count as healthy, so this is not
a settled fact there either.

### An unrecognised status is doubtful, and it is recorded

A status code the adapter has not been taught becomes an `unrecognised` availability fact carrying
the code, and this policy places it on `might-play`. It never refuses a run, and it never displaces a
player the provider calls healthy. The cost, in both directions:

- A player who is actually healthy but carries a new code loses contested starting positions to any
  known-healthy player, however much better they are.
- A player who is actually out but carries a new code is preferred to a known-out player for a
  position that would otherwise stay empty, and can start in a required position nobody else can fill.

The code is kept on the valuation, so the evidence produced with the plan names why a player was
treated as doubtful, and the adapter's table can be extended deliberately. Treating an unknown code as
healthy would let an unreadable code displace a healthy player; treating it as out would bench a
healthy player behind anyone the provider calls healthy. `might-play` is the middle that costs least.

### A negative value is not an availability fact either

A starter counts towards a tier only when their value is not negative. A player whose mean is below
zero is worse than an empty starting position, which is the opposite of what a tier is for, so an
available player costing points is not credited for showing up: they stay benched in a vacant optional
position while an unavailable player worth something takes it. Zero is not negative, so a genuinely
zero-valued available player does count, and does start.

## Slots, eligibility, and locks

Everything here comes from the provider's published facts rather than from assumptions about what a
position name means:

- **Starting, bench, and reserve areas** come from the league's declared roster positions, each with
  its count and whether it is a starting position.
- **Eligibility** comes from each roster player's published `eligible_positions`, which lists the slot
  names that player may occupy — including flex names and reserve list names. Bench space is open to
  every player.
- **Locks** come from the provider's per-player editability flag: a player who is not editable is
  pinned to the slot they already occupy. An unrecognised status does not pin anyone.
- **Reserve lists stay distinct**: a player eligible for one reserve list is not automatically
  eligible for another.
- **A reserve slot only accepts the player already in it.** Reserve writes have never been verified on
  our side, so the plan is kept writable by construction rather than by refusing the team when a
  reserve move would be best: a player can leave a reserve list for a starting or bench slot, and
  nobody is moved onto one. The displaced player goes to the bench. `IR` shuffling in both directions
  waits for one authorised acceptance write that moves a player into a reserve list and back.

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

| Player  | Slot  | Bye | Editable |    W3 |    W4 |    W5 |    W6 | Counted | Value | Week 7        |
| ------- | ----- | --: | -------- | ----: | ----: | ----: | ----: | ------: | ----: | ------------- |
| QB-1    | QB    |   9 | no       | 23.68 | 23.96 | 22.00 | 17.02 |       4 | 21.67 | will play     |
| RB-2    | RB    |  10 | no       |  7.80 |  6.10 | 31.50 |  6.90 |       4 | 13.08 | will play     |
| RB-3    | RB    |  11 | no       |  3.90 |  4.20 |  4.80 |  3.00 |       4 |  3.98 | will play     |
| WR-4    | WR    |  11 | no       | 28.40 | 14.60 | 18.80 | 12.20 |       4 | 18.50 | will play     |
| WR-5    | WR    |  11 | no       |  0.00 | 27.70 | 37.70 | 14.00 |       4 | 19.85 | will play     |
| TE-6    | TE    |  11 | no       | 24.10 | 11.70 |  1.40 |  1.90 |       4 |  9.78 | will play     |
| W/R/T-7 | W/R/T |   8 | no       | 19.70 | 19.60 |  8.60 | 14.30 |       4 | 15.55 | will play     |
| BN-8    | BN    |   7 | yes      | 17.00 | 11.10 | 11.60 | 24.70 |       4 | 16.10 | will not play |
| BN-9    | BN    |   5 | no       |  4.00 | 11.00 |   bye | 14.30 |       3 |  9.77 | will play     |
| BN-10   | BN    |  10 | no       |  7.60 |  1.40 |  9.80 |  3.90 |       4 |  5.68 | will play     |
| BN-11   | BN    |  13 | no       |  0.00 |  0.00 |  0.00 |  0.00 |       4 |  0.00 | will not play |
| BN-12   | BN    |  10 | no       | 10.70 | 19.30 |  0.70 | 14.60 |       4 | 11.33 | will play     |
| BN-13   | BN    |   7 | yes      |  1.60 | 13.20 | 11.00 | 13.40 |       4 |  9.80 | will not play |
| K-14    | K     |  11 | no       | 10.00 |  9.00 | 12.00 |  1.00 |       4 |  8.00 | will play     |
| DEF-15  | DEF   |  11 | no       | -1.00 |  5.00 |  6.00 |  6.00 |       4 |  4.00 | will play     |

Reading the table:

- `QB-1` is `(23.68 + 23.96 + 22.00 + 17.02) / 4 = 86.66 / 4 = 21.665`, kept at the league's scale
  as **21.67**. Their week-6 17.02 is itself `253 × 0.04 + 2 × 4 + 1 × −1 + (−1) × 0.1`.
- `BN-9` was on bye in week 5, so that week is excluded and the value is
  `(4.00 + 11.00 + 14.30) / 3 = 9.767` → **9.77**. Counting the bye as a zero would have produced
  7.33 and underrated them.
- `BN-8` and `BN-13` have values of 16.10 and 9.80, and week 7 _is_ their bye. They are
  `not-scheduled` for the week and their values are untouched: a bye says nothing about how well a
  player has been scoring.
- `BN-11` is on injured reserve, so week 7 is `will-not-play`. Their four recorded weeks genuinely
  scored nothing, so their value is a real **0.00**.

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

Total **121.76**, one change, `114.41 − 3.98 + 11.33`. Nothing else improves: `BN-8` is worth more
than `RB-3`, but they are on bye, and availability outranks value, so they cannot take a position from
anyone who will play. `BN-13` is on bye as well, `BN-10` is worth less than every starter it could
replace, and `BN-9`'s 9.77 cannot displace anyone it is eligible to replace. `DEF-15`'s 4.00 is kept
because the defence slot is required and they are the only defence.

## Worked example: a real hockey lineup

The same policy, pointed at one of the four hockey leagues — 21 rostered players, twelve categories,
`C 2, LW 2, RW 2, D 4, G 2, BN 7, IR 2, IR+ 1, NA 2`, every player editable and no player on a
reserve list with a game to play. The league publishes no `stat_modifiers`, and the raw settings body
does not contain the key at all, so the ladder skips rungs one and two and lands on the started
percentage.

The provider published a started percentage for all 21 roster players (4 %–88 %, 18 distinct values,
`coverage_type: date`). This run asked for the diamond cut, which came back `0` for every player, so
it was priced from the overall percentage:

- recorded label `percent-started:overall:date:2026-10-26`
- value term 758.00 — the sum of the twelve starting started percentages, in hundredths of a percent
- six slot changes, twelve of twelve required starting slots filled

Read the plan as a person who knows the sport would: every change moves a **higher started
percentage** into a starting slot and benches a lower one at the same position — two centre slots
swap a bench centre ahead of a starter, a left winger moves into a right wing slot ahead of a winger
the crowd starts less, and a defenceman replaces a less-started defenceman. The bench movements those
create follow. No player who will not play is started, because every displaced player was available
and the roster is healthy enough to fill every required slot from available players.

Where it is not obviously right:

- **Goaltenders.** The two starting goalies were started by 17 % and 54 % of leagues. Percent started
  cannot tell a confirmed starter from a backup, and a backup goalie the crowd leaves unstarted will
  lose the slot to a slightly more-started one. The provider does publish `starting_status` for a
  goalie whose team has a game that day — the one fact that would settle this — and this adapter does
  not read it.
- **Category and rotisserie formats.** The value term prices the player the crowd likes, not the
  category this team needs. For the rotisserie league in particular, a daily crowd-favourite lineup
  is not a rotisserie strategy: Roto is won on season-relative standing, so churn driven by today's
  starts can move against the standing.

The other three hockey leagues resolve the same way: 822.00, 927.00, and 988.00, with five, three,
and two changes, and every required starting slot filled. The 19-player league whose value is 927.00
is the one holding the injured-reserve goaltender from the previous section. No value is invented for
them: the plan parked them on the reserve list, where they cannot reach a starting slot, and started
the two goalies the crowd starts most.

## Tradeoffs you can disagree with

1. **One source, in its own unit.** A league is valued by points or by a started percentage, never by
   both and never by a converted mixture. A category league valued by the crowd is not priced in
   categories, and it is not pretending to be: the recorded label says what the number is.
2. **Rung two before rung three.** A league that publishes points rules uses them even though the
   crowd signal is also available. Points are what the league scores; the crowd is a proxy. The cost
   is that football never benefits from the crowd signal, even when the crowd disagrees with the
   trailing mean.
3. **Four completed periods.** Shorter is more responsive to role changes and noisier; longer is
   steadier and staler. Four weeks is a judgement.
4. **A trailing mean, not a forecast.** For rung two there are no projections. A player's first big
   game is invisible until it is behind them, and a returning starter keeps a depressed value while
   missed weeks are still inside the window.
5. **Byes excluded, injuries counted.** A published bye is a known absence of opportunity, so it is
   excluded from the mean and the player is `not-scheduled` for that period. A week a player was
   injured looks like a zero performance, because the provider's dense series cannot distinguish the
   two.
6. **A crowd signal is hindsight about other people.** Percent started follows what other managers
   did for the period, not what will happen. It is stale by the time a late lineup change is
   announced, it says nothing about matchups, and it cannot tell a starting goalie from a backup.
7. **The cut is one population, chosen once.** The platinum cut prices a plan only when every
   measured player carries it; otherwise the whole plan uses the overall percentage. A uniformly zero
   cut is a recorded finding, not a valid population.
8. **A missing started percentage benches the player.** It is unknown, not zero, so the plan never
   starts them: it parks them on the bench or a reserve list and values everyone else. The team
   refuses only when that player has nowhere to sit, or is the only candidate for a required starting
   slot — the case where a plan would have to invent a number or leave a position empty.
9. **Availability outranks value, as a head count.** The tier terms count starters rather than adding
   their values, so availability dominance cannot be bought with value: a healthy player worth 0.00
   starts ahead of an injured player worth 21.67, or ahead of an injured player the crowd starts 91 %
   of the time. The cost is that a doubtful star never starts ahead of a healthy journeyman, and that
   the count ignores magnitude altogether.
10. **Negative starters are not credited.** A starter counts towards a tier only when their value is
    not negative, so a healthy player costing points cannot take a position that would otherwise stay
    empty, and an unavailable player worth something can. Without this, an available but negative
    player would be started for showing up — worse than leaving the position empty.
11. **Unrecognised statuses are treated as doubtful.** One new code does not disable custom
    optimisation and does not displace a known-healthy player, but it can under-rank a healthy player
    carrying that code and over-rank an absent one. The code is recorded so the mapping can be
    extended in one place.
12. **An unmeasured points player is valued at zero.** Under the scoring-rules basis a player with no
    counted period does not block the run; they are priced as worthless and the gap is recorded as
    skipped periods. The cost is that a productive player whose statistics the provider omitted can
    be benched without a refusal. The started-percentage basis does not do this: there, absent stays
    absent and the player is parked without a price.
13. **The reported total is availability-blind, and in the scheme's own unit.** It sums the starting
    values and is the objective's value term, so it is not an expected score. Under the points scheme
    it is centi-points; under the started scheme it is hundredths of a percent. It does not shrink when
    an injured player is only filling a vacant position.
14. **Starting positions are required.** Conservative against an unverified rule, at the cost of
    starting a negative player when every candidate is negative.
15. **No per-game rate.** The provider publishes no games-played count, so a season total cannot
    become a rate and the policy does not invent a denominator.
16. **Bench capacity is a hard maximum.** Unverified against the provider, but it cannot invent space.

## What the generic planner does not do

- It does not read a provider, validate a session, choose a scoring scheme, or refresh period coverage.
- It does not write a lineup. It produces the assignment; the provider adapter sends the changed
  assignments as its request, and the worker verifies the readback.
- It does not know a period, a sport, or an availability status code. It receives scores and tiers.
- It does not mix score sets: one provider plan supplies one score per player, and a player without
  one is unscored rather than zero.

## What the Yahoo scoring scheme does not do

- It does not read a provider endpoint by itself; the adapter supplies the observations and shares.
- It does not consider opponents, matchups, remaining games, weather, probable starters, or whether a
  goaltender is confirmed to start. The provider does publish a real-world `starting_status` for a
  goaltender whose team plays that day, and a has-a-game `opponent` for every player; neither is read
  yet, and neither is scoring evidence — they are availability facts.
- It does not use ranks or ownership, and it will not mix a weekly total with a season total in one
  value.
- It does not optimise category outcomes, rotisserie standing, or playoff leverage. A started
  percentage is a popularity ordering, not a category projection.
