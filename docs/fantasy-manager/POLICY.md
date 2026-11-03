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
and _native lineup action_, and [the research
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

1. **The period's projection**, the provider's own published projection for the period being set.
   It is the forward-looking number the owner asked for first.
2. **Percent started**, the provider's published started percentage for that period. This is the
   owner's "crowdsourcing the decision": the share of leagues that started this player.
3. **The ownership composite** for a league that declares a per-position games limit, described under
   [rung 3](#rung-3-the-ownership-composite-for-a-league-with-a-games-limit). The adapter chooses it
   by league shape rather than as a fallback, because a league whose starts are a fixed budget needs
   a basis that moves slowly.

A league uses one rung. The adapter evaluates one scheme at a time, so a plan cannot contain two
measurement kinds and a score from one scheme cannot be compared with a score from another. There is no
fallback per player: a plan priced from one rung never prices an individual player from another.

When the ladder runs out, the refusal names the last scheme it tried. A league whose provider publishes
no projection and no started percentage for any roster player is refused transiently with that
scheme's code, such as `policy:no-start-rate`, because absent published values are indistinguishable
from values the provider does not publish and a later read could change. A provider that supplies no
scheme at all is refused structurally as `policy:no-value-source`, and the worker keeps the provider's
own native lineup action. Refusing is the deliberate answer, not a gap. When a rung can be computed but
the roster cannot be legally placed, the generic planner refuses transiently and the attempt blocks; it
does not silently switch schemes, because the ladder's order is a judgement about evidence quality, not
about roster shape.

The distinction between the two refusals is narrow. A structural claim is about the league and the
provider's declarations, never about one read: absent published values are indistinguishable from
values the provider does not publish, so an empty or unreadable read is transient and blocks rather
than falling back. The observed condition in this account, where Yahoo publishes started percentages
for roster players in all five leagues, is why all five teams plan custom. The generic planner's
refusals (no legal assignment, an unscored player who cannot be parked, a roster that exceeds its
slots) are always transient: they describe this roster now, not the league.

### Rung 1: the period's projection

The projection is read for the same period the lineup is being set for, never for a window of completed
periods. It is the provider's own forward-looking number, and the recorded label names the period it
covers.

What the provider actually publishes decides what the rung can be:

- **No projected statistics, in either sport.** `stats.type=projected`, `out=projection`, and
  `out=projected_stats` all answer HTTP 400. A wide player read carries no projection key. A future
  football week returns the requested coverage with every stat value at zero rather than a projection.
  So no projected statistics exist to score with the league's rules, and this policy does not pretend
  that they do.
- **A projected week rank for football.** `out=ranks&ranks=projected_week` returns `PW` as a numeric
  rank for all fifteen football roster players. The ranks are league-scoped: the same player carries
  different values in different leagues, so `PW` is this league's own projected order for its current
  week.
- **No per-date projection for hockey.** Hockey returns `PW` as a dash, meaning not published, and
  publishes its projected ranks over seven days (`PS7`) and the rest of the season (`PSR`). A
  seven-day rank is not a day's projection, so a hockey date has none.

A player's value under this rung comes from the rank. The worst projected rank on the roster is worth
one unit and each better rank is worth one more, so one rank always equals one unit and every value is
positive. The plan's total is a sum of rank scores, not points. A player the provider did not project
has no value and is parked; the plan never substitutes a started percentage for that player, because a
plan priced from one scheme never mixes in another.

The rank is one overall order, not a rank per position. The top fifty football players by projected
week rank carry distinct values from 1 to 50, and the best rank at each position runs from 1 at running
back to 147 at defence. A player eligible at two positions therefore has one comparable value in every
slot he can fill, so there is no per-position rank to confuse for a quarterback who also qualifies at
tight end. The rank also already reflects availability: on 2026-11-03 no available player the crowd
started in at least a fifth of leagues ranked worse than 300, while every heavily started player ranked
below 600 was out or on bye. The availability tier decides those players before value, so the rank and
the tier cannot disagree about who can appear.

The rung is skipped when it cannot be computed for the roster at all. That is every hockey date, and
any football target the provider is not currently projecting: the projection is read only when the
target week is the league's current week, because the provider publishes no coverage marker beside the
rank, and a rank from another week would decide the wrong period.

Using the seven-day rank for a hockey date was considered and rejected. It covers a window, not the
date, and it counts the games each team plays in that window. In one league a player ranked 5th for
the next seven days ranked 662nd for the rest of the season while 7 % of leagues started him, and a
defenceman ranked 270th for the week ranked 57th for the season while 97 % started him. The rank also
covers players with no game that night, and it cannot say which of two goalies will start. A date
therefore has no projection, and the date's started percentage decides it.

What this replaced, and why: the earlier rung priced a player from the mean of four completed periods.
It was backward-looking, and it let a bye decide a lineup. In the owner's football flex case both
players had a bye inside the window, so the mean compared three different games each and started the
worse player by 0.43 points. The mean is gone from every lineup decision.

### Rung 2: percent started, and what it does not mean

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

The recorded label names the period, the population, and, when it fell back, the finding:

- `percent started for <period> (platinum cut)`: the cut priced the plan.
- `percent started for <period> (the platinum cut was incomplete)`: at least one measured player was
  not in the cohort, so the whole plan used the overall percentage.
- `percent started for <period> (the platinum cut was unpopulated)`: the cut was complete and entirely
  zero, so the whole plan used the overall percentage.

The cost of the rule: a cohort that genuinely excludes a player cannot price that player, so a
single omission makes the plan less narrow. The alternative — mixing the cut and the overall
percentage inside one plan — prices two players from different populations, which is not a comparison.

### Rung 3: the ownership composite, for a league with a games limit

A league that declares `max_games_played` or `max_innings_pitched` starts every start against a fixed
per-position budget, so a daily crowd signal would spend the budget on whoever the crowd liked that day.
Those leagues are priced from the ownership composite, even when the league also publishes points rules,
because a budget-start league needs a basis that moves slowly:

```
0.5 × (percent_owned − 0) + 0.5 × rankScore + bounded(percent_owned_delta)
```

- **Percent owned** is the season-long share of leagues that roster the player. It moves slowly, which
  is the point: the ordering does not churn with the crowd.
- **`rankScore`** is the provider's trailing and projected ranks, weighted per sport — football keeps
  last 4 weeks 40, projected week 35, next 4 weeks 25; hockey keeps last 30 days 40, last 14 days 30,
  next 7 days 10, rest of season 20. Each rank becomes `min(playersInLeague / rank, weight / 5) × 5`,
  where `playersInLeague` is `teamCount × standardRosterSpots` with reserve slots excluded. A rank
  better than the league's starter pool cannot run away with the plan.
- **The delta** is the week's change in percent owned, bounded to ±4 percentile points.
- **The positional offset is zero**, and the provenance label says so:
  `yahoo/ownership composite for <sport> <period> (no positional scarcity)`. Percent owned is not comparable
  across positions without a replacement-level offset, so the composite is a cross-position ranking
  weighted by the positions this league declares, and a player competes only for slots they are eligible
  for. The offset is its own provider-neutral concept — replacement level by position, useful for adds,
  drops, and trades — and it is not built here.

The constraint is **capacity, not a multiplier**. A position whose `played` has reached `max` loses a
starting unit. A position whose `projected` exceeds `max` by more than 1.5% loses one unit, marked
optional when a required unit would otherwise over-constrain the problem. Slots are reduced; scores are
never scaled. A locked player keeps their unit, so the reduction cannot make the plan infeasible. A
closed slot is absent from the problem and a player sitting there is planned out of it.

Participation is suppressed only at a position whose projection already exceeds its allowance. There the
cap forces rotation anyway, and benching a player for one off-day spends a game the league will not
refund. Below the allowance the actual scheduled fact stands.

**No league in this account declares either limit**, so no live plan has taken this path. The shape is
covered by synthetic fixtures adapted from the provider's published example: position rows under
`games_played_by_position_type`, and an `innings_pitched` row for a league whose starting slots include
a pitcher.

## Which leagues are scoreable today

| Sport    | Leagues available        | Projected week rank | Started percentage | Scoring scheme  |
| -------- | ------------------------ | ------------------- | ------------------ | --------------- |
| Football | 1 points league          | published           | published          | projected rank  |
| Hockey   | 3 category, 1 rotisserie | none for a date     | published          | percent started |

Every football player on the linked roster carries a numeric projected week rank, so the football
league is priced from its own projection for the week and the started percentage never decides it.

Every hockey league in the linked account publishes categories with no `stat_modifiers` at all, which
is what a category or rotisserie league looks like in the provider's own settings. Their realised
statistics are dense, but no league rule turns them into points, they declare no games limit, and the
provider publishes no projection for a single date, so the adapter prices them from the published
started percentage. All four plan. One roster in the account holds an injured-reserve goaltender with
no published started percentage; that player is parked on the reserve list and the league's fifteen
starting slots are filled from the players the crowd does start.

Each plan records the provider's opaque label for the scheme that produced it, prefixed with the
provider key, for example `yahoo/projected rank for week 9` or
`yahoo/percent started for 2026-11-03 (platinum cut)`. Rows written before this correction keep the
label recorded at the time; older verification records show the `yahoo:mean-points-per-period:...`
and `yahoo/community-start-rate:...` forms.

**Availability never enters this arithmetic.** The same player is worth the same number whether they
are healthy, doubtful, or out. Nothing is halved for day to day, nothing is zeroed for out, and no
status refuses a run. An unavailable player keeps their projected rank; the availability tier says
they will not use it this period.

## Availability is its own dimension

Each player carries one availability tier for the target period, drawn from an ordered ladder:

| Tier               | Meaning                                                      | Provider facts that select it                                                           |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `confirmed-start`  | in their real team's starting lineup                         | an available status, and a published starting status of `1`                             |
| `will-play`        | expected to appear                                           | an available status, a game, and no starting status, or a `0` the adapter does not read |
| `might-play`       | may appear                                                   | `D`, `DTD`, `Q`, `P`, `GTD`; any status code the adapter does not recognise             |
| `unlikely-to-play` | confirmed outside the starting lineup, where only one starts | an available status, a published `0`, and a goalie position                             |
| `will-not-play`    | will not appear, but could                                   | `O`, `IR`, `IR+`, `IR-LT`, `SUSP`, `NA`                                                 |
| `not-scheduled`    | no game to appear in                                         | no game for the player's team in the target period, including a bye                     |

The ladder is six rungs. Four of them separate the ways a player can fail to contribute; the top two
are **participation refinements** inside "will play". The provider publishes `starting_status` for a
goaltender, and percent started cannot distinguish a confirmed starter from the backup the crowd
leaves unstarted. The provider expresses three states, and the policy keeps all three:

- `is_starting: 1` is a confirmed start. A player the status table calls available is on
  `confirmed-start`, above any unconfirmed player who will play.
- `is_starting: 0` is a confirmed non-start, not a missing value. On a goalie or a starting pitcher
  that means a backup who is very unlikely to appear at all, so it is `unlikely-to-play`: below an
  unconfirmed player who might start and above a player who is out or has no game. Measured on the owner's account on 2026-10-27,
  two goalies on the same professional team returned `1` and `0` against the same opponent, which is why
  `0` cannot be read as "not announced yet".
- An absent `starting_status` is unconfirmed, and stays `will-play` where the player has a game.

Whether `0` implies absence is sport and position knowledge, so the adapter decides it and the policy
only receives the resulting tier. The adapter holds two declaration tables: each sport's positions map
to a position class, and each class maps to one of the two interpretations.

| Position class   | Provider positions                                                                     | A confirmed non-start means     |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------- |
| goalie           | hockey `G`                                                                             | `unlikely-to-play`              |
| starting pitcher | baseball `SP`                                                                          | `unlikely-to-play`, provisional |
| relief pitcher   | baseball `RP`, `P`                                                                     | no availability fact            |
| position player  | hockey skaters; baseball batters, `Util`, `DH`; every football and basketball position | no availability fact            |
| undeclared       | any sport or position                                                                  | no availability fact            |

The tables are data, not a goalie branch. Adding a sport supplies a position map; adding a class
supplies a rule. A test walks every declared sport, every position in its map, and every class's rule,
so an undecided entry is a visible gap rather than a silent default. The default for anything undeclared
is the conservative one: a starting-lineup signal never demotes a player it does not understand.
Football and basketball are the cases that keep the table honest: a receiver or a basketball bench
player outside the starting lineup still plays meaningful minutes, so the same signal must be
expressible as no availability fact. Baseball's starting-pitcher entry is **provisional**: the
reference penalised every MLB `is_starting: 0` and separately penalised SP-only pitchers, while its own
comment worried about late confirmations and never settled the reliever case. Our tables keep only the
SP rule and leave `RP` and generic `P` undemoted until the provider and the reference's evidence settle
it. [The research record](RESEARCH.md#starting-lineup-interpretation-across-four-sports-2026-10-27)
cites the reference code for every class.

Four limits keep it honest:

- It applies only where the status table already says `available`. A confirmed starter who is out is
  `will-not-play`, below every healthy player, so the refinement can never double-count injury.
- It never touches the score. Two players of equal value are ordered by the rung; the confirmed
  starter's value is the same number, and so is the confirmed backup's.
- A skater confirmed outside their real team's starting lineup is **not** demoted. A skater who starts
  the game on the bench still takes most of their shifts, so `is_starting: 0` says nothing about whether
  they appear. In every observed roster no skater carried the field at all, so the adapter reads `0`
  for a skater as no availability fact.
- The run observation records the three-state fact beside the scheduled fact, so a reader can see why a
  goalie was benched without recomputing the plan. The published fact and the tier are different
  things: the observation keeps the fact, the rung is the decision.

The ladder is six rungs because the provider distinguishes "may appear" from "will not appear",
"confirmed outside the lineup" from "injured out", and neither of those is the same fact as "there is
no game". A doubtful player takes a contested starting position ahead of a confirmed backup, a
confirmed backup takes it ahead of a suspended player, and an injured player who is dressing is
preferred over a healthy player whose team is not playing when a position would otherwise stay empty.
A shorter ladder could express only one of those orderings; collapsing participation into "will not
play" also loses the run record's ability to say why a player was benched.

[ADR 0006](adr/0006-availability-tiers.md) records the rung amendments and their evidence.

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

| Status         | Tier            | Reserve list | Note                                                       |
| -------------- | --------------- | ------------ | ---------------------------------------------------------- |
| healthy (none) | `will-play`     | no           | the provider emits no code for a healthy player            |
| `O`            | `will-not-play` | yes          | out                                                        |
| `IR`           | `will-not-play` | yes          | injured reserve                                            |
| `IR+`          | `will-not-play` | yes          | short-term injured reserve                                 |
| `IR-LT`        | `will-not-play` | yes          | long-term injured reserve                                  |
| `NA`           | `will-not-play` | yes          | not active                                                 |
| `SUSP`         | `will-not-play` | yes          | suspended                                                  |
| `D`            | `might-play`    | no           | doubtful                                                   |
| `DTD`          | `might-play`    | no           | day to day                                                 |
| `Q`            | `might-play`    | no           | questionable                                               |
| `P`            | `might-play`    | no           | probable                                                   |
| `GTD`          | `might-play`    | no           | game-time decision                                         |
| anything else  | `might-play`    | no           | recorded as an unrecognised code while the adapter maps it |

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

The adapter keeps the code while it maps the status, so extending the table is a local change. The
run observation records the scheduled and starting-lineup facts, not the injury code; the plan
provenance names the scoring scheme, not the status decision. Treating an unknown code as healthy
would let an unreadable code displace a healthy player; treating it as out would bench a healthy
player behind anyone the provider calls healthy. `might-play` is the middle that costs least.

### A negative value is not an availability fact either

A starter counts towards a tier only when their value is not negative. A player below zero is worse
than an empty starting position, which is the opposite of what a tier is for, so an available player
costing points is not credited for showing up: they stay benched in a vacant optional position while
an unavailable player worth something takes it. Zero is not negative, so a genuinely zero-valued
available player does count, and does start. The projected rank is offset so that every projected
player is positive, which keeps this rule from firing on the worst player the provider did project.

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
- **A reserve list is a legal destination only for a player published as eligible for it.** The
  provider accepted a reserve transit in both directions on 2026-10-27
  ([record](RESEARCH.md#reserve-transit-acceptance-2026-10-27)), so the plan writes reserve moves the
  same way it writes starting and bench moves. A player can be moved onto a named reserve list they
  are eligible for, and off one they are not. Nothing is inferred from the injury code. A player the
  league no longer lists as eligible for the reserve slot they hold is moved out when the rest of the
  roster has room; when it does not, the plan leaves them in place, keeps that slot occupied, and
  plans everyone else, and the run names them.

Two readings the provider evidence does not settle, stated so they can be corrected:

- **Starting positions are treated as required**, except where a declared games limit reduces a
  position's capacity: a reduced or exhausted starting slot is marked optional, and a fully closed slot
  is absent from the problem. Filling every remaining starting slot is legal under either reading of
  whether an empty starting slot is accepted, so the plan never depends on an unverified rule. The
  cost is that a negative-valued player can be forced into a starting slot.
- **Declared capacity is a hard maximum.** Whether the provider shares one standard-roster allowance
  between starters and bench instead of enforcing the advertised bench count is unverified. Treating
  the declared counts as maxima cannot invent roster space; if the retained roster does not fit, the
  solver refuses rather than dropping a player.

## Worked example: the football flex decision

The linked football league is Irish Lax and the team is $G-Money$. For week 9 the flex slot held
Khalil Shakir and Chris Olave sat on the bench, both eligible for it. These are the provider's own
published numbers for that week, read on 2026-11-03.

| Player        | Slot  | Projected week rank | Percent started | Platinum cut | Weeks 5 to 8 league points |
| ------------- | ----- | ------------------: | --------------: | -----------: | -------------------------- |
| Khalil Shakir | W/R/T |                 124 |              21 |            6 | 11.00, 13.40, bye, 11.40   |
| Chris Olave   | BN    |                  48 |              52 |           25 | 8.60, 14.30, 11.60, bye    |

**The retired rule.** It averaged the weeks each player played and skipped his bye: Shakir 11.93,
Olave 11.50. That started Shakir, by 0.43 points. Shakir's bye was week 7 and Olave's was week 8, so
the two means were built from different games and neither said anything about week 9. This is the
owner's case, and the owner's diagnosis was right: the bye weeks were the reason.

**The rule today.** The projection decides. Olave's rank is 48 and Shakir's is 124, so Olave is 76
rank units better on the roster scale set by the worst projected player. The plan moves Olave into
the flex slot and Shakir to the bench. Percent started agrees, 52 % against 21 %, but it does not
decide this plan: the projection does, and the run records `yahoo/projected rank for week 9`.

The other eight starting slots were already correct and do not move.

## Worked example: a real hockey lineup

The same policy, pointed at one of the four hockey leagues — 21 rostered players, twelve categories,
`C 2, LW 2, RW 2, D 4, G 2, BN 7, IR 2, IR+ 1, NA 2`, every player editable and no player on a
reserve list with a game to play. The league publishes no `stat_modifiers`, the raw settings body does
not contain the key at all, the league declares no games limit, and the provider publishes no
projection for a single date, so the adapter prices the plan from the published started percentage.

The provider published a started percentage for all 21 roster players (4 %–88 %, 18 distinct values,
`coverage_type: date`). This is the pre-correction run: it asked for the diamond cut, which came back
`0` for every player, so it was priced from the overall percentage and recorded the older label
`percent-started:overall:date:2026-10-26`. Today the same inputs request platinum and record
`yahoo/percent started for 2026-10-26 (platinum cut)` when the cut is complete, or
`yahoo/percent started for 2026-10-26 (the platinum cut was incomplete)` otherwise.

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
  cannot tell a confirmed starter from a backup, and a backup goalie the crowd leaves unstarted can
  win the slot on a slightly higher share. The provider publishes `starting_status` for a goalie whose
  game is near, and the plan reads all three of its states: a confirmed starter is on
  `confirmed-start`, a confirmed backup on `unlikely-to-play`, and a goalie whose starter is not yet
  announced on `will-play`. The comparison no longer depends on the crowd for the one position it
  cannot measure, and a confirmed backup cannot take a slot from a goalie who might still start.
- **Category and rotisserie formats.** The value term prices the player the crowd likes, not the
  category this team needs. For the rotisserie league in particular, a daily crowd-favourite lineup
  is not a rotisserie strategy: Roto is won on season-relative standing, so churn driven by today's
  starts can move against the standing.

The other three hockey leagues resolve the same way: 822.00, 927.00, and 988.00, with five, three,
and two changes, and every required starting slot filled. The 19-player league whose value is 927.00
is the one holding the injured-reserve goaltender. No value is invented for
them: the plan parked them on the reserve list, where they cannot reach a starting slot, and started
the two goalies the crowd starts most.

## Tradeoffs you can disagree with

1. **One source, in its own unit.** A league is valued by a projected rank, a started percentage, or
   the ownership composite, never by a converted mixture. A category league valued by the crowd is not
   priced in categories, and it is not pretending to be: the recorded label says what the number is.
2. **The projection is ordinal, not points.** Yahoo publishes no projected statistics, so the
   football projection is the provider's projected week rank. It cannot be re-scored with the
   league's 33 modifiers, and its unit is a place in the provider's order. The cost is that the
   provider computes the rank and this policy cannot inspect or re-score it. The alternative was to
   keep averaging completed periods, which is the failure this replaces.
3. **No projection for a hockey date.** Hockey publishes projected ranks over seven days and the rest
   of the season, and neither is a day's projection. A hockey day is priced by the crowd, with the
   cost that a backup goalie can out-rank a starter on a slightly higher started share. The
   availability tier's confirmed-start and unlikely-to-play rungs narrow that, and they do not read
   the projection.
4. **A missing projected rank parks the player.** The projection rung has no per-player fallback to
   the started percentage, because a plan priced from one scheme never prices a player from another.
   The cost is that a star the provider did not rank can be benched, and the plan does not say why
   beyond leaving them unscored.
5. **A crowd signal is hindsight about other people.** Percent started follows what other managers
   did for the period, not what will happen. It is stale by the time a late lineup change is
   announced, it says nothing about matchups, and it cannot tell a starting goalie from a backup.
6. **The cut is one population, chosen once.** The platinum cut prices a plan only when every
   measured player carries it; otherwise the whole plan uses the overall percentage. A uniformly zero
   cut is a recorded finding, not a valid population.
7. **A missing started percentage benches the player.** It is unknown, not zero, so the plan never
   starts them: it parks them on the bench or a reserve list and values everyone else. The team
   refuses only when that player has nowhere to sit, or is the only candidate for a required starting
   slot, which is the case where a plan would have to invent a number or leave a position empty.
8. **Availability outranks value, as a head count.** The tier terms count starters rather than adding
   their values, so availability dominance cannot be bought with value: a healthy player with the
   roster's worst projection starts ahead of an injured player with the best one, and ahead of an
   injured player the crowd starts 91 % of the time. The cost is that a doubtful star never starts
   ahead of a healthy journeyman, and that the count ignores magnitude altogether.
9. **Negative starters are not credited.** A starter counts towards a tier only when their value is
   not negative, so a healthy player costing points cannot take a position that would otherwise stay
   empty, and an unavailable player worth something can. Without this, an available but negative
   player would be started for showing up, which is worse than leaving the position empty. The rank
   scale is offset so that a projected player is never negative.
10. **Unrecognised statuses are treated as doubtful.** One new code does not disable custom
    optimisation and does not displace a known-healthy player, but it can under-rank a healthy player
    carrying that code and over-rank an absent one. The code is recorded so the mapping can be
    extended in one place.
11. **The reported total is availability-blind, and in the scheme's own unit.** It sums the starting
    values and is the objective's value term, so it is not an expected score. Under the projection it
    is rank units; under the started scheme it is hundredths of a percent; under the ownership
    composite it is ten-thousandths of the composite. It does not shrink when an injured player is
    only filling a vacant position.
12. **Starting positions are required.** Conservative against an unverified rule, at the cost of
    starting the roster's worst player when every candidate is negative.
13. **No per-game rate.** The provider publishes no games-played count, so a season total cannot
    become a rate and the policy does not invent a denominator.
14. **Bench capacity is a hard maximum.** Unverified against the provider, but it cannot invent space.

## What the generic planner does not do

- It does not read a provider, validate a session, choose a scoring scheme, or refresh period coverage.
- It does not write a lineup. It produces the assignment; the provider adapter sends the changed
  assignments as its request, and the worker verifies the readback.
- It does not know a period, a sport, or an availability status code. It receives scores and tiers.
- It does not mix score sets: one provider plan supplies one score per player, and a player without
  one is unscored rather than zero.

## What the Yahoo scoring scheme does not do

- It does not read a provider endpoint by itself; the adapter supplies the observations and shares.
- It does not consider opponents, matchups, remaining games, weather, or probable starters. The
  provider does publish a real-world `starting_status` for a goalie whose game is near, and a
  has-a-game `opponent` for every player; the adapter reads both, and neither is scoring evidence —
  they are availability facts. A skater's starting status is not published and would not matter if it
  were.
- It does not treat the provider's seven-day or rest-of-season projected rank as a date's projection.
  Hockey has no projection for a single day, and a longer window is not one.
- It uses ownership ranks only for a games-limited league's ownership composite. A projected-rank or
  crowd-priced league never mixes them in, and no value mixes a weekly total with a season total.
- It does not optimise category outcomes, rotisserie standing, or playoff leverage. A started
  percentage is a popularity ordering, not a category projection.
