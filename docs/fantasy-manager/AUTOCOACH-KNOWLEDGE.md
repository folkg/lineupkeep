# What AutoCoach knows about setting a fantasy lineup

This is a knowledge record, not a design and not a port. It states everything the AutoCoach
implementation encodes about turning a provider roster into a lineup, so that knowledge survives the
day the reference checkout is no longer consulted.

- **Source.** `/Users/graemefolk/Documents/Software/fac/auto-coach`, revision `7f380451` (2026-09-09).
  Every item cites the file that owns it; line numbers are from that revision and will drift.
- **What it is.** Accumulated operational knowledge: rules found by running this against real Yahoo
  leagues for years. Several rules exist only because something went wrong once.
- **What it is not.** It is not architecture, naming, infrastructure, credentials, data model, or
  policy worth copying. Those are decided separately in Lineupkeep.
- **How it is written.** Each item states (a) the fact and where it comes from, (b) the behaviour it
  drives, (c) why it exists where the code reveals it. Where the behaviour is wrong in my judgement,
  it is still recorded here and the judgement is in [§12](#12-behaviours-i-judge-wrong).

Reading order for a correction: [§1](#1-the-whole-algorithm-in-one-page) (the ordering that makes it
work), then [§5](#5-per-player-facts) and [§7](#7-the-decision-procedure) for the mechanics, then
[§12](#12-behaviours-i-judge-wrong) before changing anything.

## 1. The whole algorithm in one page

The reference has no availability dimension. It encodes participation and health as **value
multipliers** and then sorts players by one number, `start_score`. That single design decision is what
produces the behaviour the owner remembers as correct, and it is worth stating plainly because it is
the piece our rewrite dropped.

```
start_score(player) =
    base(player)                                  # percent started, inverse rank, or (max-games
                                                  #   leagues) the ownership score, see §5
  × injury_factor(player)                         # 1, or 1e-3, or 1e-3 × 1e-1 on long-term IR
  × participation_factor(player)                  # 1e-7 when the player has no game
  × (starting_factor if confirmed starting)       # ×100 for a starting goalie / starting pitcher
```

A league with a per-position games limit takes a different branch entirely: its base is the ownership
score — a roster-share and rank composite, not the crowd's daily start share — and its participation
penalty applies only while the position is under its games pace. Both are recorded in [§5](#5-per-player-facts)
and [§8](#8-max-games-per-position-and-churn).

The multipliers are chosen so their ranges cannot collide:
`1e-7 (no game) < 1e-3 (injured) < 1e-2 (confirmed not starting, baseball and the max-games path only)
< 1 < 100 (confirmed starting)`. A
player with a game therefore **always** outranks a player without one, however good the benched player
is, and an injured player who _is_ dressing always outranks a healthy player whose team is not playing.
(§3 S5; `scoreFunctionNHL`, `scoreFunctionMLB`, `scoreFunctionNFL`, `scoreFunctionWeeklyLineup`,
`applyScoreFactors`, `applyInjuryScoreFactors`)

Everything else in the reference is machinery to apply that ordering legally:

1. Decide the legal shape of the roster for this period (declared slots, minus max-games reductions).
2. Repair illegal or overfilled slots, worst `start_score` first.
3. Promote reserve/bench players into unfilled starting slots, best `start_score` first.
4. Swap a reserve/bench player into a starting slot when the bench player is eligible for that
   starting slot and scores higher.
5. Use three-way swaps when no direct swap exists.
6. Post only the changes that matter.

## 2. Language

Reference terms, mapped to the vocabulary Lineupkeep already uses:

| Reference term                                 | Meaning                                                                              | Lineupkeep term                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| starting player                                | selected position is not `BN` and not an inactive list                               | player in a starting position                                     |
| reserve player                                 | selected position is `BN` **or** an inactive list (a single predicate covering both) | player on the bench or on a reserve list                          |
| inactive list (`IR`, `IR+`, `IL`, `IL+`, `NA`) | restricted roster areas                                                              | reserve list                                                      |
| `is_playing`                                   | the player's real-world team has a game in the period                                | has a game (an availability fact)                                 |
| start score                                    | the one number compared inside a roster                                              | **not** a Lineupkeep concept: availability is a tier, not a score |
| ownership score                                | the number compared between a roster and the free-agent pool                         | transaction valuation, out of scope                               |
| coverage period                                | the provider period a roster read was scoped to                                      | target period                                                     |
| edit key                                       | provider identifier of the current editable period                                   | roster-cadence evidence when the deadline is ambiguous            |

The reference's conflation of bench and reserve lists into one "reserve player" predicate is
deliberate: both are non-contributing areas, and every search that promotes someone aims at a starting
slot. Lineupkeep keeps them as distinct slot kinds because reserve lists have eligibility rules; the
distinction is a refinement, not a disagreement.

## 3. Sports

`Leagues = "nba" | "nhl" | "nfl" | "mlb"` (`common/types/Leagues.ts`; `yahooAPI.service.ts`
`games;game_keys=nhl,nfl,nba,mlb`). Lineupkeep supports football and hockey; the other two are recorded
because their rules are where several general lessons came from.

- **S1. Football (`nfl`).** Weekly roster coverage; every player either plays or is on bye in the
  period. Score is `100 / ranks.projectedWeek`: the provider's projected-week rank inverted, not a
  points projection (`scoreFunctionNFL`). No max-games logic. Add/drop caps allow no extra player at
  quarterback, kicker, or defence beyond the declared capacity
  (`POSITIONAL_MAX_EXTRA_PLAYERS.nfl = { QB: 0, K: 0, DEF: 0 }`).
  Compound slots `W/T`, `W/R`, `W/R/T`, `Q/W/R/T`, `D` (`COMPOUND_POSITION_COMPOSITIONS.nfl`).
- **S2. Hockey (`nhl`).** Date roster coverage. Score is `percent_started`; a confirmed starting goalie
  is multiplied by 100; a non-participating player by `1e-7`. No max-games logic (Yahoo hockey has no
  games-played limit). Compound slots `W`, `F`, `Util`; add/drop caps `G: 2`, `D: 2`.
- **S3. Baseball (`mlb`).** Date coverage. Score is `percent_started`, with a `×1e-2` penalty when the
  provider says the player is not starting, when he is a starting pitcher who is not starting, or when
  he is on long-term injured reserve; `×100` for a confirmed starting pitcher. This is the only sport
  with **max games per position** and **max innings pitched** (`scoreFunctionMLB`,
  `scoreFunctionMaxGamesPlayed`). Compound slots `CI`, `MI`, `IF`, `OF`, `Util`, `P`; add/drop cap
  `P: 6`.
- **S4. Basketball (`nba`).** Date or weekly coverage; score is `percent_started` with the injury and
  participation factors. No max-games logic in the code even though Yahoo offers the setting for
  basketball. Compound slots `G`, `F`, `Util`.
- **S5. The multiplier ladder is global, the base score is per sport.** `applyScoreFactors` and
  `applyInjuryScoreFactors` are shared; only `getInitialScore` and the sport-specific starting bonus
  differ. One consequence: a lesson learned in one sport (participation dominates) applies to all of
  them in the reference, which is why our sport-neutral seam should carry the same fact for both of
  our sports.
- **S6. Conflict between the cap tables and the slot model.** `POSITIONAL_MAX_EXTRA_PLAYERS` is applied
  to add/drop candidates _and_ to position counting (`Team.atMaxCapPositions`), but the counts are
  computed from players' eligible positions, so a player eligible for three positions counts against
  three caps. The table is a heuristic on top of a slot model, not a rule.

## 4. League formats and lineup cadence

### Formats

- **F1. `scoring_type` is parsed and stored and then never used for lineup selection.**
  `LeagueDetailsSchema.scoring_type` is carried on every `Team`; nothing in `LineupOptimizer`,
  `Player`, `Team`, or the score functions branches on it. Head-to-head categories, head-to-head
  points, rotisserie, and points-only all rank players with the same `start_score`.
- **F2. What format actually changed was which measurement existed.** A points league has
  `stat_modifiers`, so the reference could have scored points; it chose `percent_started` anyway
  (`getInitialScore`). A category or rotisserie league has no modifiers at all. So format did not
  change the algorithm — it changed what the provider published, and the algorithm silently used the
  crowd share for all of them. This is the origin of the known weakness that a rotisserie team is run
  on a daily popularity ordering.
- **F3. The provider's own `is_game_over` / season dates.** `FlatGameDetailsSchema` reads
  `is_game_over`, `season`; `Team.start_date`/`end_date` come from the league. Season progress
  `(now - start) / (end - start)` feeds the max-games churn threshold and the transaction pace; it
  never feeds lineup selection outside that.

### Cadence

- **F4. `weekly_deadline` is the cadence fact, and it is also the algorithm switch.**
  `""` or `"intraday"` means daily; a weekday number (`"1"`..`"7"`) means the league locks once a week.
  `playerStartScoreFunctionFactory` reads it _before_ the sport: a weekly league of any sport gets
  `scoreFunctionWeeklyLineup`, `100 / ranks.next7Days`.
- **F5. Weekly leagues compare a week-ahead rank; daily leagues compare today's participation.** In a
  weekly league there is exactly one decision per week and no notion of "today's game", so the only
  available ordering is the provider's next-7-day rank. In a daily league the same player can be worth
  starting today and benching tomorrow, so participation has to be part of the ordering.
- **F6. `Team.sameDayTransactions`** is `(weekly_deadline is "" or "intraday") && edit_key ===
  coverage_period`. It gates add/drop aggressiveness only.
- **F7. `getTeamsWithSameDayTransactions`** treats `weekly_deadline === "intraday"` **or** `game_code
  === "nfl"` as same-day, because a weekly football league still has to act inside its one day.
- **F8. Coverage comes from the roster read, not from the sport.** `fetchRostersFromYahoo` takes
  `coverage_type` and `coverage_period` from `usersTeamRoster` (`'date' | 'week'`). The write uses the
  same pair. The reference never assumes a sport is daily or weekly; it asks the provider.

## 5. Per-player facts

Every roster player is flattened from the provider's `player` node by
`yahooPlayerProcessing.service.ts` into `IPlayer` (`common/types/Player.ts`). This table is the
complete set of facts the reference reads, what each drives, and the lesson.

| #   | Fact                       | Provider field                                                                    | Drives                                                              | Note                                    |
| --- | -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| P1  | has a game                 | `opponent` (string), `"Bye"`, or absent                                           | participation factor `1e-7`                                         | the fact our rewrite dropped            |
| P2  | postponed game             | external `postponedTeams` set from the Yahoo Graphite scoreboard                  | overrides P1 to "no game"                                           | separate read, not a roster field       |
| P3  | injury status              | `status_full`, default `"Healthy"`                                                | injury factor, long-term factor                                     | long name, not the code                 |
| P4  | long-term IR               | player's _eligible positions_ include `IL` or `IR`                                | extra `×0.1`                                                        | eligibility, not status                 |
| P5  | real-world starting status | `starting_status.is_starting` (`0`/`1`, else `"N/A"`)                             | `×100` when starting; `×1e-2` when explicitly not starting (MLB)    | goalies and pitchers only               |
| P6  | percent started            | `percent_started.value`, or a cut's value                                         | base score for NBA/NHL/MLB, unless the league caps games            | one cut, default `"diamond"`            |
| P7  | percent owned              | `percent_owned.value`                                                             | **max-games base score**; ownership score; percent-started fallback | the anti-churn metric, see §5           |
| P8  | percent-owned delta        | `percent_owned.delta`                                                             | ownership score adjustment, capped at +4                            | add/drop only                           |
| P9  | ranks                      | `player_ranks` for `L30, L14, PS7, PSR, L4W, PW, PN4W`                            | NFL and weekly base score; ownership score                          | ordinal, never a value                  |
| P10 | eligible positions         | `eligible_positions[].position`                                                   | slot eligibility, long-term IR, all position counting               | includes slot names, not only positions |
| P11 | display position           | `display_position` split on `,`                                                   | position-cap filter for add candidates                              | can differ from eligibility             |
| P12 | editable                   | `is_editable` (`1`/`0`)                                                           | the player is excluded from every move when false                   | the lock                                |
| P13 | undroppable                | `is_undroppable` (`1`/`0`)                                                        | never a drop candidate                                              |                                         |
| P14 | ownership type             | `ownership.ownership_type` (`waivers`/`freeagents`), `waiver_date`                | add/drop mechanics                                                  |                                         |
| P15 | selected position          | `selected_position.position`                                                      | current slot                                                        |                                         |
| P16 | bye week                   | `bye_weeks.week`                                                                  | not read; P1 covers it for football                                 |                                         |
| P17 | games played by position   | team-level `games_played.games_played_by_position` (`played`, `max`, `projected`) | max-games capacity reduction and churn                              | team-scoped, not per player             |
| P18 | innings pitched            | team-level `games_played.innings_pitched` (`pitched`, `max`, `projected`)         | the same for pitchers                                               |                                         |

Details worth keeping:

- **Facts the reference deliberately ignores.** `on_disabled_list`, `has_player_notes`,
  `player_notes_last_timestamp`, `is_keeper`, `uniform_number`, `image_url`, `url`,
  `editorial_team_key`/`_abbr` (except as the key into the postponed set), `is_flex` on
  `selected_position`, `minimum_games` and `is_prescoring` on the roster, and the team-level
  `is_editable`.
- **P1 in detail.** `is_playing = opponent is defined && opponent !== "Bye" && team not postponed`
  (`yahooPlayerProcessing.service.ts:113`). The field is a short string naming the opponent for the
  period the roster was read for; it is `null`/absent when the team has no game. In a date-scoped
  league that means "has a game today". In a week-scoped league it is the week's opponent or `"Bye"`.
  This one predicate is the entire participation model.
- **P3 in detail.** `HEALTHY_STATUS_LIST = ["Healthy", "Questionable", "Probable", "Game Time
  Decision"]` (`common/helpers/constants.ts:3`). Everything else counts as injured. The list is a
  judgement: Questionable/Probable/GTD players usually play, so they keep their full value. There is a
  standing `TODO` in the file asking whether GTD should count as healthy.
- **P4 in detail.** `LONG_TERM_IL_POSITIONS_LIST = ["IL", "IR"]` (`constants.ts:6`). `IR+` and `NA` are
  **not** long-term. So a hockey player on `IR` gets the extra penalty and a hockey player on `IR+`
  does not — a distinction that only makes sense as "Yahoo's IR is the season-long list, IR+ is the
  short-term list".
- **P5 in detail.** `is_starting` is `"N/A"` when `starting_status` is absent
  (`yahooPlayerProcessing.service.ts:109`). The reference treats `1` as starting and `0` as explicitly
  not starting, and only for players whose eligible positions include `G` (hockey) or `P`/`SP`/`RP`
  (baseball). `getNHLStartingGoalies()`/`getMLBStartingPitchers()` fetch the league-wide list of
  players at position `S_G`/`S_P` (`yahooStartingPlayer.service.ts`), cache it in a module variable,
  persist it in Firestore, and are refreshed once per day; `isStartingPlayer` accepts _either_ the
  cached list _or_ `is_starting === 1` because "starters array is not always accurate".
- **P6 in detail.** `getPercentValueForCut(percentData, cut = "diamond")` returns the value of the
  requested cut when present and `percentData.value` (the overall percentage) otherwise. A missing node
  becomes `-22200` with the comment "Is this the right default?". That sentinel is a live bug
  (`J4`).
- **P9's rank map** (`yahooPlayerProcessing.service.ts:getPlayerRanks`): `L30→last30Days`,
  `L14→last14Days`, `PS7→next7Days`, `PSR→restOfSeason`, `L4W→last4Weeks`, `PW→projectedWeek`,
  `PN4W→next4Weeks`; a rank of `"-"` becomes `-1`.
- **P10 in detail.** Yahoo publishes _slot names_ in `eligible_positions`, not just professional
  positions: `["QB"]`, `["RB","W/R/T"]`, `["C","LW","Util"]`, `["LW","RW","W","Util","IR","IR+"]`,
  `["G","IR","IR+"]`. `BN` never appears; `Player` appends it to every player so bench is always
  legal (`Player.ts:61`). Reserve eligibility is therefore a **published fact**, not an inference from
  injury status.
- **P17/P18 are team-scoped.** `games_played` and `innings_pitched` live on the user's team object
  (`teams;out=transactions,games_played`), not on a player or on league settings. League settings do
  carry `max_games_played` and `max_innings_pitched`; the reference parses them and uses neither.
- **P6 and the cut literals.** The reference requests `percent_started.cut_types=diamond` and reads the
  requested cut when present, falling back to the node's own `value` (the overall percentage) when the
  cut is missing. The default cut is hard-coded as `"diamond"` in `getPercentValueForCut`. **Which cut
  is populated is a provider fact, not a code fact**: on the owner's account `diamond` is published and
  `0` for every player in every league, while `platinum`, `gold`, `silver`, and `bronze` are populated
  and differ from the overall value. The evidence and the resulting recommendation are in
  [the correctness analysis](LINEUP-CORRECTNESS-ANALYSIS.md#5-percent-cuts-platinum-is-populated-diamond-is-dead).
  So the reference's `"diamond"` default silently degrades to the overall percentage, which is why its
  results looked plausible.

### The ownership score, in full

The ownership score is the base for every league with a games limit, and the comparison used for every
add, drop, and swap. `ownershipScoreFunctionFactory` (`playerOwnershipScoreFunctions.service.ts`) builds
it from four parts:

```
ownershipScore(player) =
    0.5 × (percent_owned − positionalScarcityOffset(player))
  + 0.5 × rankScore(player)
  + min(percent_owned_delta, 4)
```

- **Percent owned, weighted 0.5 (`OWNERSHIP_FACTOR`).** The share of leagues that roster the player. It
  is a season-long, slow-moving signal: it changes when a player is picked up or dropped across the
  provider's whole population, not when a crowd makes a daily lineup choice. Half the score is
  therefore stable from day to day.
- **Rank score, weighted 0.5.** For every rank type present, add
  `min(numPlayersInLeague / rank, weight / 5)`, then multiply the sum by 5, so each rank contributes at
  most its declared weight and the total is on a 0–100 scale. `numPlayersInLeague` is
  `num_teams × numStandardRosterSpots` (every declared slot except the inactive lists). The weights are
  per sport and are the only per-sport part of the composite: `last30Days 40, last14Days 30, next7Days
  10, restOfSeason 20` for NHL/MLB/NBA, and `last4Weeks 40, projectedWeek 35, next4Weeks 25` for NFL.
  Absent ranks are `-1` and skipped. These are trailing-form and forward-looking _orderings_, so they
  also move slowly — a rank is not recomputed on a per-date basis.
- **Ownership delta, bounded at +4 (`OWNERSHIP_DELTA_ADJUSTMENT_BOUND`).** `min(percent_owned_delta, 4)`
  is a small nudge toward players being picked up right now. The bound is one-sided: a drop in
  ownership is not penalised.
- **Positional scarcity offset.** `percent_owned − offset`, where the offset is the percent owned of the
  _replacement-level_ player at the position. `getReplacementLevels` allocates the league's starting
  slots × teams across positions, distributes bench and flex capacity proportionally (capped by
  `POSITIONAL_MAX_EXTRA_PLAYERS`), and the offset is the ownership of that Nth-best available player,
  read raw from the provider's top-players list. A player with several eligible positions takes the
  _minimum_ offset, i.e. the most favourable comparison. The purpose is comparability across
  positions: a league whose defence pool is deep has a high replacement-level ownership at defence, so
  a 20 %-owned defenceman scores below a 20 %-owned centre in a shallow pool.

**Why a max-games league uses this and not percent started.** Two independent anti-churn devices:

1. **A stable base.** Percent owned plus trailing rank barely moves between days; percent started is
   _by construction_ a daily number ("share of leagues that started him for this date"). A games limit
   turns every unnecessary start into a spent game from a fixed budget, so a daily-moving ordering
   churns the lineup and burns the budget on whoever the crowd liked that day. The owner's recollection
   — that the max-games path used percent owned "to encourage less churning of positions" — is
   exactly what the code does: `scoreFunctionMaxGamesPlayed` takes
   `base = ownershipScoreFunction(player)` and never touches percent started.
2. **A pace-dependent participation rule** (`M5`/`M6`): above the position's games pace, incumbents get
   a bounded boost and participation is ignored; below it, a player with no game is multiplied by
   `1e-7` and the lineup churns freely to bank games.

## 6. Roster slot semantics

- **R1. Slot labels the reference recognises.** Starting slots are whatever the league declares with
  `is_starting_position = 1` plus every flex/compound name in `COMPOUND_POSITION_COMPOSITIONS`.
  Bench is `BN`. Inactive lists are `INACTIVE_POSITION_LIST = ["IR", "IR+", "IL", "IL+", "NA"]`
  (`constants.ts:5`) — both sports' spellings plus `NA`.
- **R2. Slot capacity** is `roster_positions[position]`, from league settings
  (`getPositionCounts`). The reference treats it as a hard maximum in the sense that it never assigns
  two players to one slot unit, but it also never refuses a roster that does not fit; it repairs by
  benching.
- **R3. Eligibility** is `player.eligible_positions.includes(slot)` plus the injected `BN`. A player may
  occupy a slot when the published list names it. No position inference, no sport knowledge, no
  aliasing (`C` does not "also mean" `Util` unless the provider says so).
- **R4. Reserve lists are distinct.** `IR` accepts only players whose eligibility names `IR`; `IR+`
  only `IR+`; `NA` only `NA`. `isInactiveListEligible()` is "eligible for _some_ inactive list";
  `isInactiveList()` is "currently _in_ some inactive list". The asymmetry matters: a player can be
  eligible for IR+ and sitting on the bench.
- **R5. Locked players are removed from the search space.** `Team._editablePlayers` is the only array
  the optimiser moves; it is `players.filter(p => p.is_editable)`. Locked players still count towards
  slot occupancy (`unfilledPositionCounter` iterates all players), so they hold their place without
  being movable. This is how the reference never moves a locked player: it cannot see them as
  candidates.
- **R6. A player in a pending transaction is locked.** `processPendingTransactions` adds every player
  named in a pending or proposed transaction to `_lockedPlayers` and strips their inactive-list
  eligibility (`makeInelliglbeForIL`), so a player being dropped cannot be moved into IR first.
- **R7. Illegal state = selected position that is null or not in `eligible_positions`.** `Team.
  illegalPlayers` is the worklist; `resolveIllegalPlayer` repairs them (see D4).
- **R8. Overfilled state = more players in a slot than its capacity.** Because capacity can be reduced
  for max-games leagues, a position can become overfilled without the roster changing. `overfilled`
  means `unfilledPositionCounter[position] < 0`.
- **R9. Underfilled state = `unfilledPositionCounter[position] > 0`** for a starting slot; the
  optimiser may leave such a slot empty only if nobody eligible exists, and `isSuccessfullyOptimized`
  reports it as a suboptimal lineup.
- **R10. Compound positions are expanded for counting, not for assignment.** `getPlayerCapacityAt
  Position` adds child capacities into the parent (`W = LW + RW`, `F = LW + RW + C`, `Util = all`) so
  "how many players can I start at this position" is right, while assignment still uses the literal
  declared slot names.
- **R11. Repair order inside `resolveIllegalPlayer`.** Inactive-list player → try to move them to the
  active roster → else to an unfilled inactive slot → else swaps. Active player → unfilled starting
  slot → else swaps → else three-way move. Every attempt ends with a legal position or the player is
  left illegal and `isSuccessfullyOptimized` fails loudly.
- **R12. `shouldPostLineupChanges` is a churn guard on the write, not on the plan.** Even a changed plan
  is not posted unless it involves an inactive list, or it turns a non-starting player into a starting
  player **and** that player has a game. Re-ordering starters among themselves is never posted.

## 7. The decision procedure

`LineupOptimizer.optimizeStartingLineup()` runs exactly three phases, in this order
(`LineupOptimizer.ts:50`):

- **D1. Resolve overfilled positions.** While a position has more players than capacity, bench the
  worst `start_score` at that position (`resolveOverfilledPositions`). This is the max-games lever and
  the post-add lever; it runs first because it is the only phase that can _empty_ a starting slot.
- **D2. Resolve every illegal player**, best `start_score` first (`resolveAllIllegalPlayers`), via
  direct move, swap, or three-way (`D4`).
- **D3. Promote reserve players into starting slots**, worst first so the best end up placed
  (`optimizeReserveToStaringPlayers` pops from an ascending sort). For each reserve player: if they are
  not starting, try an unfilled starting slot; else try to swap with a starting player who scores
  lower and whose slot they are eligible for; else try a three-way swap; else leave them. A player
  swapped back to the bench is pushed back onto the worklist so the newly benched player gets their own
  chance — the single most important line for "the best lineup, not one pass".
- **D4. `resolveIllegalPlayer`'s ladder.** (1) If the player is in an inactive list, try
  `moveILPlayerToUnfilledALPosition`, which first opens a roster spot by moving an
  inactive-list-eligible player from the bench into an empty inactive slot, then puts the player on
  `BN`. (2) Otherwise move to an unfilled position in the target list (`unfilledInactivePositions` for
  an inactive-list player, `unfilledStartingPositions` otherwise). (3) Otherwise swap with any editable,
  non-pending player where each is eligible for the other's slot (`isEligibleToSwapWith`). (4)
  Otherwise a three-way swap: find player C such that A→B→C→A are each eligible for the next one's
  slot. (5) Otherwise `threeWayMoveIllegalToUnfilledPosition`: move B to an unfilled slot, then A into
  B's old slot.
- **D5. Choosing between two candidates is always `start_score`.** There is no second key. Ties are
  broken by the comparison tolerance `1e-12` returning `0` and by array order.
- **D6. A player is only compared with players they can legally swap with.** `isEligibleToSwapWith`
  requires _mutual_ eligibility for each other's current slot; `getEligibleTargetPlayers` requires only
  that the challenger is eligible for the incumbent's slot. The pair is deliberate: a swap must be
  legal both ways, a challenge only has to be legal one way (the incumbent lands on the bench).
- **D7. Bench and reserve are treated as interchangeable destinations.** Because `isReservePlayer()` is
  "not starting", a bench player and an IR player are both candidates for promotion, and a player
  displaced from the lineup can be sent to either. The choice of which is not decided by the score —
  it falls out of which slot was legal for whom.
- **D8. Reserve shuffling is a consequence, not a rule.** The owner's description — a hurt player who
  has a game swapped with a healthy player parked on IR — is produced by `start_score` alone: an
  injured player who is playing scores `1e-3 × base`, a healthy player who is not playing scores
  `1e-7 × base`, and a healthy player parked on IR who _is_ playing scores `1 × base`. So the healthy
  reserve player is promoted over the injured starter, and the injured starter is a legal destination
  for the reserve slot they just vacated. No rule says "swap IR players"; the ordering does it.
- **D9. `isSuccessfullyOptimized` is the post-condition, run on every team in production and logged as
  an error when false** (`setLineups.service.ts`, `processLineupChanges`). It checks: no unfilled
  starting position that a reserve player was eligible for; no overfilled position; no illegal player
  among the moved ones; and no reserve player who is eligible for and outranks a starting player. This
  is a self-check, not a correctness proof.
- **D10. `generateDeltaPlayerPositions`** records only players whose slot changed, and that delta is the
  write payload. Unchanged players are not mentioned.
- **D11. The three-way swap exists because eligibility is many-to-many.** Example from the reference
  tests: a bench winger is only `RW`-eligible, the `RW` starter is `RW,LW`-eligible, and the open slot is
  `LW`. Neither a direct promote nor a direct swap works; a rotation does.
- **D12. The optimiser is deterministic and idempotent on its own output.** Running it twice on the same
  roster produces the same slots the second time (the delta becomes empty). It is not stable against
  _score_ changes: any change in `percent_started` re-orders the roster.
- **D13. Ordering within the two working sorts.** Ascending sort + `pop()` for promotion (best last),
  descending sort + index 0 for repair (best first). Both are "best first" once the mechanics are
  followed.
- **D14. Nothing in the decision procedure knows the sport, the format, or the week.** Sport and cadence
  enter only through the score function; format enters not at all.

## 8. Max games per position and churn

Applies to baseball (and would apply to basketball). League declares `max_games_played` /
`max_innings_pitched`; the _team_ object publishes per-position `played`, `max`, `projected`.

- **M1. The constraint is expressed by shrinking slot capacity, not by penalising players.** For each
  position whose `projected > max × 1.015`, `artificiallyReduceRosterSpots` reduces that position's
  declared count by one and gives the unit to `BN` (`Team.ts:134`). With `max = 82` the buffer yields a
  83.23-game allowance, "to allow for some day-to-day variance" — so you stop starting at that position
  once you are projected to exceed the cap, rather than being forced to bench at the cap.
- **M1a. The base score on this path is the ownership score, not percent started.**
  `scoreFunctionMaxGamesPlayed` starts from `ownershipScoreFunction(player)` — percent owned minus the
  positional scarcity offset, half-weighted, plus a half-weighted rank composite, plus a bounded
  ownership delta — and applies the injury factors to that. `getInitialScore`, the percent-started
  base every other sport path uses, is never called here. That is the concrete form of "leagues with
  max games played used percent owned to encourage less churning": the metric is slow-moving by
  construction, where percent started is a daily figure. See
  [the ownership score](#the-ownership-score-in-full).
- **M2. The reduction is repeated per position** (`reduceAvailableRosterSpots` called once per
  over-cap position), and for innings pitched it falls back from `P` to `RP` to `SP` because the
  innings cap is recorded per position type.
- **M3. After the shrink, D1 benches the worst player at that position.** The capacity change is what
  makes the position overfilled; the ordinary overfilled rule does the rest.
- **M4. Churn threshold.** `churnThreshold = 0.9 + min(seasonProgress × 0.09, 0.09)`, so it moves from
  0.90 at the start of the season to 0.99 at the end (`scoreFunctionMaxGamesPlayed`).
- **M5. Above the threshold, incumbents are protected.** If a player's position pace
  (`projected / max`) is above the threshold and the player is _not_ reserve-eligible, they get
  `+((pace - threshold) / (1 - threshold)) × 10` added to their score — a boost between 0 and 10 on a
  base that runs roughly 0–104, so up to about a tenth of the scale, explicitly "to make it harder to
  replace players that are currently in the lineup". Note what is absent while the pace is above the
  threshold: **no participation penalty at all**. A good player who is not playing today keeps his
  full score and his boost, because the point is to stop spending games on him unnecessarily.
- **M6. Below the threshold, participation decides.** The score is multiplied by `1e-7` when the player
  has no game, "to introduce more churn by swapping in players with games more regularly". A player
  playing today beats a better player who is not, and the better player is saved for a day they play.
- **M7. The pace owner is chosen per player.** `getPaceKeeper` uses the games-played row matching the
  player's _current slot_; if the player is on the bench or an inactive list, it uses the eligible
  position with the _lowest_ pace. The comment says this is "really only used to determine if a
  player's position current pace is above or below the churn threshold".
- **M8. Reserve-eligible players never get the boost.** They are the ones you want to churn, so the
  protection is deliberately withheld.

## 9. Transaction coupling

The lineup optimiser and the transaction generator are the same object; listing what depends on what:

- **T1. Order of operations in `createPlayersTransactions`:** generate drops first, then adds, then
  swaps, then read the lineup delta. `postTransactions` sends drops → lineup changes → add/drops,
  because a healthy player on IR must be dropped before they can be moved to the bench, and injured
  players must reach IR before an add creates a roster squeeze.
- **T2. `generateDropPlayerTransactions`** finds players who are healthy _and_ in an inactive list
  (`healthyOnIL`) and tries to move each off IR; if there is no room in the active roster, it drops
  them. So the reference treats "healthy player parked on IR" as a roster problem to be solved, by
  dropping someone if necessary.
- **T3. `drop` and `add` candidates are gated by `isCurrentTransactionPaceOK`:** current adds plus new
  adds compared against `progress × max + 0.1 × (max - current)` for the week and the season, and no
  new transaction when only one is left. `TOLERANCE = 0.1` shrinks as the budget is used.
- **T4. Add candidates are filtered:** not already pending, not long-term-IR eligible, not from waivers
  when the league does not allow waiver adds, deduplicated, and sorted by ownership score.
- **T5. Add candidates are then shaped by the lineup:** prefer players eligible for an underfilled
  position; exclude players eligible for — or displaying — a position already at its
  `POSITIONAL_MAX_EXTRA_PLAYERS` cap; add `+5` ownership score to any player eligible for a "critical"
  position (under-filled or exactly-filled). The last rule is the one that says "do not let a position
  run dry".
- **T6. A swap must beat a drop by `SCORE_THRESHOLD = 6`** ownership score, "a conservative bias to
  avoid making bad drops". Same threshold for add-versus-drop.
- **T7. Criticality is computed from players, not slots.** `criticalPositions` counts each player once
  per eligible position, includes pending adds and excludes pending drops and long-term-IR players. So
  dropping a player who is the team's only third-base eligibility is refused even if a better player is
  available.
- **T8. `sameDayTransactions && !player.is_editable` means too late to drop** — the lock is reused as a
  transaction deadline.
- **T9. Pending transactions change the lineup problem:** pending adds are counted as available for
  their positions, pending drops are excluded from position counts and locked, and pending trades lock
  every named player.

For Lineupkeep, all of this is out of scope today: there is no add, drop, or trade surface, and the
retained roster is the whole player set. What must not be lost is **T9**: once transactions exist, a
player in a pending transaction is not a free variable, and the solver's lock is the natural place to
say so.

## 10. Scheduling and cadence of runs

- **H1. An hourly Cloud Scheduler trigger at `55 * * * *`** calls `scheduleSetLineup`
  (`scheduleSetLineup.ts`). The 55th minute exists because the reference wanted the run close to, but
  before, the next hour's game starts.
- **H2. The midnight run is skipped** (Pacific hour 0), because waiver claims had not finished
  processing by 00:55. The **first real run of the day is Pacific 01:00**, and `isFirstRunOfTheDay()`
  is exactly `hour === 1`.
- **H3. Which leagues get a run depends on the schedule, not on the clock.** On the first load of the
  day, all leagues with games today are set. On later runs, only leagues with a game starting within
  the next hour (`findLeaguesPlayingNextHour`). This is a deliberate reduction: rewriting a lineup when
  no game is about to start is churn with no benefit.
- **H4. Game start times come from a non-fantasy API** (`graphite.sports.yahoo.com`,
  `leagueGameIdsByDate`), with a Sportsnet ticker as fallback, and are cached per day in Firestore
  (`schedule/today`). Postponed games are read from the same surface (`scoreboardGame`,
  `status === "POSTPONED"`) and stored as a set of team ids used by `is_playing` (P2).
- **H5. Starting goalies and pitchers are fetched once per day** before the runs, from a league-wide
  `players;position=S_G` query using one user's session, then cached in memory and in Firestore; the
  module-level variable is why the comment asks "how many times is it called".
- **H6. Per-user fan-out through a task queue** with 5 retries, 5 dispatches/second, 40 concurrent
  (`dispatchSetLineup.ts`), so one slow team does not block the rest.

The lesson that transfers: the _scheduler_ decides how often a decision is remade, and the churn
guards (R12, D12) only help if the roster did not actually change. A run per team per hour against
provider data that has not changed is the shape that produces repeated writes.

## 11. Write contract

- **W1. Roster write shape.** `PUT /fantasy/v2/team/{team}/roster` with a `roster` element carrying
  `coverage_type` plus `week` or `date`, and a `players` collection of
  `player/player_key/position` entries; only changed players are listed (`putLineupChanges`,
  `explicitAssignmentsBody`). `position` carries a _slot label_, including `BN`, `IR`, `IR+`, and
  `IL`.
- **W2. Partial updates are all-or-nothing.** Players not named keep their slot; an invalid move rejects
  the whole request. This is why the reference can send a delta and why a single illegal move poisons
  the entire post.
- **W3. Inactive-list moves are ordinary positions in the write.** The reference moves players into and
  out of `IR`/`IR+`/`IL` through the same body, in production. Reserve transit is therefore a supported
  write in the provider this was built against.
- **W4. Errors are classified, not swallowed.** Rate limits and authorization errors are re-thrown
  immediately (the whole batch stops); other errors are collected and the rest of the batch continues;
  Yahoo's "you cannot add a player you dropped until the waiver period ends" is treated as a handled
  outcome rather than a failure.
- **W5. Lineup changes and transactions share one `LineupOptimizer` instance per team**, so the delta
  sent reflects the state after the planned transactions (T1).
- **W6. Team-level editability was checked before planning** (`is_editable` on the roster, skipped when
  false) in addition to per-player locks.

## 12. Behaviours I judge wrong

Recorded so they are not copied by accident. Severity is my reading; each is separable from the rest.

- **J1. Participation is a value multiplier (`1e-7`) instead of a separate dimension.** It works, but
  it makes the score meaningless as a number, makes "why did this player start?" unanswerable without
  arithmetic, and forces every later rule (injury, starting status, churn protection) into the same
  dimensionless product. Lineupkeep's availability ladder
  ([ADR 0006](../adr/0006-availability-tiers.md)) is the better expression of the same ordering. Keep
  the _order_, drop the multiplication.
- **J2. Injury is counted multiplicatively, twice for long-term IR.** `×1e-3` for injured and `×1e-1`
  more on IL/IR. A healthy scratch and a season-ending injury differ by two orders of magnitude with no
  evidence behind either number, and an injured player's own value is destroyed rather than deferred.
  This is the double-count ADR 0006 was written to remove.
- **J3. Percent owned is used as a percent-started fallback.** `(percent_started ?? percent_owned) ||
  1` mixes "share of leagues that started him" with "share of leagues that rostered him" and then
  floors the result at 1. The comment admits percent started "has been broken before". A fallback that
  silently substitutes a different measurement is worse than an explicit absence.
- **J4. The `-22200` sentinel for a missing percent started.** It is a number, so it flows through every
  factor and every comparison as if it were evidence; `-22200 × 1e-7` is still a number. A missing
  value must be `unusable`, which is what Lineupkeep already does.
- **J5. `rank` arithmetic mixes units.** `100 / ranks.projectedWeek`, `100 / ranks.next7Days`, and the
  ownership score's `min(numPlayersInLeague / rank, weight / 5) × 5` treat an ordinal position in a
  list as a quantity. A rank of 1 and a rank of 2 differ by 50 points; a rank of 400 and 401 differ by
  0.0006. Any monotone transform would be as defensible and none is a projection.
- **J6. Inverted ranks as a stand-in for projections.** `100 / projectedWeek` is the only NFL value
  available, so it was used. It is a popularity/ordering proxy, and the reference's own tests name the
  uncertainty ("Does rank_projected_week factor in injury status already? We might be double counting").
  The reference's own NFL fixture records Taysom Hill at `projectedWeek` 1929 against `next4Weeks` 157
  and `restOfSeason` 158 while 8 % of leagues started him, which is the skew the owner remembers. The
  skew is a one-week rank far below the longer windows; `projectedWeek` is a single overall order, not
  a separate quarterback and tight-end rank.
- **J7. The "starting goalie" bonus is `×100`, eyeballed.** `STARTING_FACTOR = 100` is calibrated
  against `percent_started` values in the 1–100 range so a confirmed starter usually beats a
  non-starter outright (a one-percent starter at `×100` ties a hundred-percent non-starter). It is a dominance hack expressed as arithmetic, and it breaks if the base unit changes.
  The _intent_ is right (a backup goalie should not start ahead of a confirmed starter); the mechanism
  is not.
- **J8. Score multipliers make the algorithm unorderable without arithmetic.** "Which of these two
  players is better" cannot be answered by inspecting any single number; the answer lives in a product
  whose factors are `1e-7` and `100`. Every debugging session in that codebase starts by reconstructing
  the product.
- **J9. The optimiser drops healthy players to solve an IR problem.** `generateDropPlayerTransactions`
  will drop a player because a healthy player is parked on IR and the active roster is full. That is a
  roster decision taken by a lineup routine, and it cannot be undone.
- **J10. `max_games_played` is read from league settings and never used;** the real constraint comes
  from the team's `games_played`. Two sources of the same fact, one of them dead.
- **J11. Three-way swap search is unbounded in principle.** `attemptIllegalPlayerSwaps` iterates every
  other editable player for every illegal player, and each candidate attempt may go on to move players
  itself (`threeWayMoveIllegalToUnfilledPosition`). It works, and one reference test is annotated
  "Problematic test! Infinite loop?" — the search keeps no visited set.
- **J12. The churn threshold and its +10 boost are arbitrary but load-bearing.** They are the only
  thing preventing daily churn in a max-games league, and they are the reason a better player can be
  benched: the boost is added _after_ the value, in the value's units.
- **J13. The percent-started cut literal `"diamond"` is dead and the fallback hides it.** Every cut
  request is validated only by the fact that the response echoes it, so `diamond` returns `0` for every
  player in every one of the owner's leagues while `platinum`, `gold`, `silver`, and `bronze` are
  populated. Because `getPercentValueForCut` falls back to the overall `value` when the cut value is
  missing — and because `0` is a number, not missing — the code has two ways to silently end up on the
  overall percentage and no way to tell. A wrong literal should be an observed empty population, not a
  quiet fall back; pick the literal from evidence and fail the read when it is uniformly zero.
- **J14. Two different base metrics behind one name.** `start_score` means "percent started with
  factors" in three paths and "ownership composite with factors" in the max-games path. The branch is
  invisible in the type, the name, and the call site; only the max-games entry point reveals it. It
  works because the two metrics live in disjoint leagues, but it is the kind of overload that makes a
  score unexplainable later.

## 13. Facts the reference does not establish

Kept so nobody mistakes absence for a decision.

- **U1. Whether a postponed game shows an `opponent`.** AutoCoach overrides P1 from a separate
  scoreboard read; it never says what the field itself contains for a postponed game. Untested.
- **U2. Lock timing inside a scoring day.** `is_editable` is read per player and trusted; when Yahoo
  flips it, and whether it flips per player or per game start, is not recorded.
- **U3. Whether the provider accepts an empty required starting slot.** The reference always fills what
  it can and reports suboptimal lineups rather than testing the rule.
- **U4. Whether declared bench capacity is a hard maximum or a pooled allowance.** The reference never
  validates it; it repairs by benching.
- **U5. Whether a `starting_status: 0` is "not starting" or "not yet announced".** The reference
  applies `×1e-2` for it in baseball, `×1e-7` in the max-games path, and no `×100` bonus in hockey;
  which of the two readings the provider means is not established.
- **U6. Whether the cached starting-goalie list can be a day stale at the moment it matters.**
  `isStartingPlayer` accepts either source, which papers over the question.
- **U7. Whether `IR` eligibility disappears when the player is healthy.** The reference uses
  `isHealthy() && isInactiveList()` to find them, which implies eligibility can still be published for
  a healthy player on IR; it does not say which one drives the provider's own enforcement.
- **U8. Nothing about multiple lineups per day.** The reference rewrites the current period and has no
  notion of a decision per game.
- **U9. What a cut population _is_.** The provider publishes `platinum`, `diamond`, `gold`, `silver`,
  and `bronze` cuts of the started and owned percentages. Which leagues each cohort contains is not
  documented here and was not established; only which literals are populated, and that they differ
  from the overall value, is measured (see
  [the cut evidence](LINEUP-CORRECTNESS-ANALYSIS.md#5-percent-cuts-platinum-is-populated-diamond-is-dead)).
  A request that names several cuts at once is not honoured: the cut container is omitted entirely, so
  one literal per request is the only reliable shape.

## 14. Index

Files that own the knowledge, in reading order:

| File                                                                                            | Owns                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/core/src/dispatchSetLineup/classes/LineupOptimizer.ts`                                  | the three phases, illegal repair, swaps, promotion, posted-change guard, self-check                                                                     |
| `server/core/src/dispatchSetLineup/classes/Team.ts`                                             | slot capacity arithmetic, critical/underfilled/overfilled, editable and illegal sets, max-games capacity shrink, transaction pace, pending transactions |
| `server/core/src/common/classes/Player.ts`                                                      | slot and reserve predicates, eligibility, swap rules                                                                                                    |
| `server/core/src/common/helpers/constants.ts`                                                   | healthy statuses, inactive lists, long-term lists, compound positions, positional add caps                                                              |
| `server/core/src/common/services/playerScoreFunctions/playerStartScoreFunctions.service.ts`     | the multiplier ladder, all four sport scores, max-games churn                                                                                           |
| `server/core/src/common/services/playerScoreFunctions/playerOwnershipScoreFunctions.service.ts` | ownership score, rank score, scarcity offset (transactions only)                                                                                        |
| `server/core/src/common/services/yahooAPI/yahooPlayerProcessing.service.ts`                     | every per-player field, `is_playing`, percent cuts, ranks                                                                                               |
| `server/core/src/common/services/yahooAPI/yahooStartingPlayer.service.ts`                       | starting goalies/pitchers, caching                                                                                                                      |
| `server/core/src/common/services/yahooAPI/yahooLineupBuilder.service.ts`                        | roster request shape, coverage, what is assembled per team                                                                                              |
| `server/core/src/common/services/yahooAPI/yahooTeamProcesssing.services.ts`                     | league settings, roster positions, games played, transactions                                                                                           |
| `server/core/src/common/services/yahooAPI/yahooAPI.service.ts`                                  | request shapes, `out=` members, write bodies, error classification                                                                                      |
| `server/core/src/dispatchSetLineup/services/setLineups.service.ts`                              | orchestration, engine selection, what is posted and when                                                                                                |
| `server/core/src/scheduleSetLineup/**`                                                          | when an hour's runs happen and for which leagues                                                                                                        |
| `server/core/src/dispatchSetLineup/spec/**`                                                     | the encoded expectations, including the injured-bench/not-playing-starter case                                                                          |
