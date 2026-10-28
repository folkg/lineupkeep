# Lineup correctness: the participation regression, and the corrected design

The reported failure, the diagnosis, the gap against
[the reference knowledge record](AUTOCOACH-KNOWLEDGE.md), and the ordered correction. Architecture is
not in question. This document changes no production code; it is the design the correction followed.

**Status: shipped, 2026-10-27.** Sections 1–8 record the diagnosis and the evidence that drove it.
The current implementation carries the participation fact, the `not-scheduled` rung, the platinum cut,
the three-state starting-lineup fact, reserve transits in both directions, and the games-limited
ownership composite. The ordered correction in §10 is retained as the delivery record; its
intermediate reserve rule (a reserve slot accepting only its current occupant) is no longer current.
The test-status paragraph in §9 describes the state at diagnosis, not the suite today.

## 1. The report, restated as testable claims

The owner reported, in substance:

1. The planner moved players off their starting slots because their crowd **start percentage** was
   higher, although those players **were not playing a game**.
2. Players who **were** playing that day were left on the bench as a result.
3. The reference behaves correctly on this point, and it also handles related cases we have dropped:
   shuffling players between injured-reserve slots and the active roster, and doing less churn in
   leagues with a per-position games limit.

Claims 1 and 2 are one defect with a single fact at its root, and they reproduce. Claim 3 is two
separate capabilities; one is reachable through the same seam change and one is not reachable in our
supported sports. The rest of this document is the evidence for that reading.

## 2. Root cause

Three defects in series. Each must be fixed; fixing two of them changes nothing observable.

### R1. The roster read never asks for the participation field

`YahooProvider.readRoster` requests `/fantasy/v2/team/{team}/roster` (plus `;week=N` for weekly
coverage) and its `RosterPlayerPayload` schema (`YahooProvider.ts`) has no `opponent` member. The field
exists and is cheap:

| Request (one hockey roster, read-only)        | Status | Players |                              `opponent` key present |
| --------------------------------------------- | -----: | ------: | --------------------------------------------------: |
| `roster` (what we send)                       |    200 |      21 |                                            **0/21** |
| `roster;out=opponent`                         |    400 |       — | error: "Invalid roster resource opponent requested" |
| `roster/players;out=opponent`                 |    200 |      21 |                                           **21/21** |
| `roster/players;out=opponent,starting_status` |    200 |      21 |                                               21/21 |

So the fact is one path segment away, returns the identical envelope (`team.roster.entries[].players[]`,
confirmed by inspecting both bodies), and is absent from every roster read we have ever made. The
reference asks for it on the same call it uses for everything else
(`.../roster;…/players;out=percent_started,percent_owned,ranks,opponent,starting_status`).

### R2. The only consumer of "no game" can only fire for weekly coverage

`YahooLineup.nonGamePeriods` returns a bye period only when the period is a week **and** the player has
a `byeWeek`:

```ts
function nonGamePeriods(player, period) {
  if (period.kind !== "week" || player.byeWeek === null) return [];
  return [{ kind: "week", week: player.byeWeek }];
}
```

All four of the owner's hockey leagues are date-scoped (`rosterCoverageBySport = { hockey: "date" }`), so
this function returns `[]` for every player, `hasGame` in `Valuation.ts` is always `true`, and
`assessAvailability` falls through to the injury table. The availability tier — the one dimension the
objective ranks above value — therefore carries **injury only**. A player with no game is tiered
`will-play` and competes on crowd share alone. That is exactly the reported behaviour, and it is the
whole of it.

`AvailabilityAssessment` already has a `{ fact: "no-game" }` branch. It is unreachable for date coverage;
nothing else had to be wrong.

### R3. Nothing in the run record could reveal it

`LineupPlanning.rosterPlayer` derives `reserveEligible` and `lockedSlotId` from the roster and takes the
tier verbatim. `LineupWorkerLive.observe` records `{key, name, slot, editable}` per player. The plan's
provenance names the scoring scheme (`yahoo/community-start-rate:overall:date:…`). No layer records
whether a player had a game, so the run that damaged the owner's lineups is recorded as a correct run
of a scoring scheme, with no field that could contradict it. The failure was invisible as well as
wrong.

## 3. Reproduction, with the owner's real data (read-only)

**Method.** A disposable harness (`.artifacts/chunk9/reproduce-games.ts`, gitignored) decrypted the
stored provider credential with the application's own credential service, then, for each of the four
hockey teams: read the league settings, read the roster for the current date, made **one** additional
read-only request (`roster/players;out=opponent`) for the game fact, called the committed
`provider.scoreRoster` for the committed scores, and called the committed `planAssignments` to obtain the
plan the worker would write. No write was issued. Retained evidence holds slot labels, counts, injury
codes and scores only: no player names, no team or league identifiers, no session material.

**Observed** 2026-10-27T18:17:53Z, fantasy date 2026-10-27, for all four hockey teams in the account:

| Team     | Format                  | Coverage | Roster | Starting units | Starters with a game |            Starters **without** a game | Bench players with a game | Eligible (starter, bench) violations | Plan                          |
| -------- | ----------------------- | -------- | -----: | -------------: | -------------------: | -------------------------------------: | ------------------------: | -----------------------------------: | ----------------------------- |
| hockey-1 | head-to-head categories | date     |     21 |             12 |                   11 |                            **1** (`G`) |                         6 |                                    0 | **refused** (reserve transit) |
| hockey-2 | head-to-head categories | date     |     19 |             15 |                   12 |            **3** (`F`, `Util`, `Util`) |                         2 |                                **5** | planned, **0 changes**        |
| hockey-3 | rotisserie              | date     |     22 |             15 |                   10 | **5** (`RW`, `D`, `D`, `Util`, `Util`) |                         4 |                                **8** | planned, **0 changes**        |
| hockey-4 | head-to-head categories | date     |     22 |             15 |                    9 |  **6** (`C`, `LW`, `W`, `D`, `D`, `D`) |                         0 |                                    0 | planned, **0 changes**        |

Across the four teams: **15 of 57 starting units are occupied by players whose team has no game**, and
**12 bench players whose team is playing** are not started. The two affected teams contribute thirteen
eligible (started slot, benched player) pairs, i.e. thirteen swaps that a participation-aware ordering
would have made. The plan the worker would write changes
**nothing** on three of the four teams, i.e. the algorithm is _satisfied_ with the lineup the owner
complained about. On the fourth, the plan is refused outright (§7), so that team also changes nothing.

**The ordering is the whole explanation.** Each violation pair is one started player and one benched
player, both eligible for the same starting slot, with the scores the provider published for that date
(hundredths of a percent started). The recorded provenance names the population as `overall`, which is
the second half of the story: the requested cut (`diamond`) is published and zero for every player, so
the plan silently used the overall percentage — see §5:

| Team     | Starting slot | Started player's score | Best eligible benched player's score | Started player has a game? |
| -------- | ------------- | ---------------------: | -----------------------------------: | -------------------------- |
| hockey-2 | `F`           |                  47.00 |                                13.00 | no                         |
| hockey-2 | `Util`        |                  36.00 |                        13.00 / 30.00 | no                         |
| hockey-2 | `Util`        |                  18.00 |                        13.00 / 30.00 | no                         |
| hockey-3 | `RW`          |                  35.00 |                         11.00 / 9.00 | no                         |
| hockey-3 | `Util`        |                  42.00 |                  11.00 / 9.00 / 7.00 | no                         |
| hockey-3 | `Util`        |                  71.00 |                  11.00 / 9.00 / 7.00 | no                         |

The planner is not choosing badly given its inputs. It is choosing _exactly_ by crowd share, and the
crowd starts players other than in this league, on other dates, and in leagues that do not have to
field a player who is not playing. The missing input is not a weight or a tie-break: it is the fact.

**What did not reproduce.** hockey-4 has six no-game starters and **no** bench player with a game, so no
swap exists and the lineup is the best available from that roster. hockey-1's single no-game starter is
a goaltender, and no benched goaltender has a game, so again no swap exists. Neither is evidence
against the bug; both are the "player who cannot play must fill a required slot" case that must keep
working (§9, test 2).

**The roster also shows the reserve problem the owner described.** Eight players sit in reserve slots
across the four teams. Seven of them **have a game today**. One of those seven carries **no injury code
at all** — a healthy player parked on `IR+`. The reference treats that as a roster problem
(`healthyOnIL`); our planner tries to promote the healthy player, discovers the move transits a reserve
slot, and refuses the whole team. See §7.

## 4. Fact inventory against the seam

Every fact from [document A](AUTOCOACH-KNOWLEDGE.md) and the fact in this failure, each with a
disposition. "Seam" means `Provider*` contracts in
`packages/backend/src/contexts/connections/Provider.ts`.

### Present and used by the lineup decision

| Fact                                                                                                                       | Where it enters                                                                       | Used for                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| injury code (`status`)                                                                                                     | `ProviderRosterPlayer.injuryCode` → `yahooAvailability` → `PolicyPlayer.availability` | selects `available` / `uncertain` / `excluded`                                                         |
| confirmed real-world start (`starting_status.is_starting`)                                                                 | `ProviderRosterPlayer.startingLineup` → `PolicyPlayer.startingLineup`                 | lifts a confirmed starter to `confirmed-start`, places a confirmed backup goalie on `unlikely-to-play` |
| bye week (`bye_weeks.week`)                                                                                                | `ProviderRosterPlayer.byeWeek` → `nonGamePeriods`                                     | bye is `will-not-play` for **weekly** coverage only (R2)                                               |
| eligible positions                                                                                                         | `ProviderRosterPlayer.eligiblePositions` → slot eligibility and `reserveEligible`     | which slots a player may occupy; reserve legality                                                      |
| selected slot                                                                                                              | `ProviderRosterPlayer.slot` → `currentSlotId`                                         | minimum-change tie-break, comparison, write delta                                                      |
| editable                                                                                                                   | `ProviderRosterPlayer.isEditable` → `lockedSlotId`                                    | locks                                                                                                  |
| percent started (overall, and a cut)                                                                                       | separate `readStartRates` → `ValueSource`                                             | final score for every hockey league                                                                    |
| league scoring rules                                                                                                       | `ProviderLeagueSettings.statModifiers`                                                | final score for football                                                                               |
| roster positions, counts, `is_starting_position`                                                                           | `ProviderLeagueSettings.rosterPositions`                                              | slot model, capacities, starting/bench/reserve classification                                          |
| league period window, coverage                                                                                             | `ProviderLeagueSettings`, `ProviderRoster.coverage`                                   | target resolution, period scoping                                                                      |
| `weeklyDeadline`                                                                                                           | `ProviderLeagueSettings.weeklyDeadline`                                               | **read but not used to decide cadence** (see below)                                                    |
| `is_undroppable`, `ownership`, `positionType`, `primaryPosition`, `displayPosition`, `proTeamAbbreviation`, `injuryDetail` | seam                                                                                  | present for the query surfaces; **unused by planning**, correctly (no drop/add, no display need)       |

### Missing from the seam

| Fact                                                 | Reference source                                            | Consequence today                                                        | Disposition                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **has a game in the target period**                  | `opponent` on the roster player (string / `null` / `"Bye"`) | **the reported failure**                                                 | **in scope, first** (§6)                                                                                                                |
| **real-world starting status**                       | `starting_status.is_starting` (goalies and pitchers)        | a backup goalie with a game is indistinguishable from an unconfirmed one | **in scope, done**: three-state seam fact, `confirmed-start` / `unlikely-to-play` rungs, and a declared four-sport interpretation table |
| games played by position, `played`/`max`/`projected` | team-level `games_played`                                   | capacity reduction and participation suppression                         | provider fact; only when the league declares a limit (§8)                                                                               |
| innings pitched                                      | team-level `games_played.innings_pitched`                   | same                                                                     | pitcher slot only; same gate (§8)                                                                                                       |
| postponed games                                      | external schedule/scoreboard read                           | a postponed game would look like a game                                  | deferred with a named limitation (§10)                                                                                                  |
| pending transactions                                 | roster `transactions` (waivers, pending trades)             | a player in a pending transaction is a free variable                     | deliberately out of scope; the lock is its future home                                                                                  |

### Present but wrong or unused where it should be used

| Fact               | Problem                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Disposition                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weeklyDeadline`   | coverage was chosen by **sport** (`rosterCoverageBySport`), not by the league, so a weekly-deadline hockey league resolved a date target and then mismatched the roster's own week coverage. Measured 2026-10-27, the deadline alone is not enough: `intraday` is daily, `1`–`7` weekly, and the empty deadline appears on both a weekly football league and two daily hockey leagues. The league's `edit_key` is the provider's own identifier of the current editable period and names the same cadence in the same units. | **fixed**: coverage now comes from the league's declared deadline, falling back to the edit key's shape, and an unclassifiable pair refuses the read |
| `injuryCode` table | `O`, `IR`, `IR-LT`, `SUSP`, `NA`, `DTD` are mapped. `Q`, `P`, `GTD` — which the reference lists as _healthy_ — land on `unrecognised` → `might-play`. The behaviour is defensible; the mapping is an accident.                                                                                                                                                                                                                                                                                                               | make it explicit in the table with the tier each code earns, and record the disagreement with the reference                                          |
| percent cut        | we request `diamond`, which is published and **zero for every player in every league**. The roster-level guard ("prefer the cut when any player's cut is above zero") therefore never fires, so every plan silently uses the overall percentage.                                                                                                                                                                                                                                                                             | §5; switch the literal to the populated cut                                                                                                          |
| `byeWeek`          | only consulted for weekly coverage; harmless once participation is read, redundant for football                                                                                                                                                                                                                                                                                                                                                                                                                              | keep; it is the football-specific spelling of the same fact                                                                                          |

### Deliberately rejected, with the reason

| Reference behaviour                                                                                       | Why we reject it                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| participation as a `1e-7` value multiplier                                                                | availability is a dimension, not a discount ([ADR 0006](../adr/0006-availability-tiers.md)); the intent is preserved by the ladder, the mechanism is not |
| injury as `1e-3`, long-term as another `×0.1`                                                             | double-counts injury and destroys the player's value instead of deferring it                                                                             |
| percent-owned fallback for percent-started; the `-22200` sentinel                                         | mixes units, and a missing value must be `unusable`, not a number                                                                                        |
| `100 / rank` as a projection                                                                              | ordinal units; our football league has real scoring rules                                                                                                |
| `STARTING_FACTOR = 100` for confirmed starters                                                            | dominance by arithmetic; a tier or a tie-break expresses it                                                                                              |
| dropping players to clear a healthy player off IR                                                         | roster management is not a lineup decision, and we have no drop surface                                                                                  |
| per-position add caps and scarcity offsets                                                                | transactions, out of scope                                                                                                                               |
| the +10 pace boost and the `1.0`-scaled churn threshold                                                   | a value adjustment standing in for "do not churn equal players"; our solver's minimum-change tie-break does it exactly, without units                    |
| the team-level `is_editable`, `edit_key`, `is_flex`, `on_disabled_list`, `minimum_games`, `is_prescoring` | redundant with per-player locks, or unused by the reference too                                                                                          |

## 5. Percent cuts: platinum is populated, diamond is dead

The value basis for every hockey league is the crowd's started percentage. The provider can publish that
percentage for several populations, called cuts, and a cut is requested per read. Which cut we request is
therefore a real decision, and our current choice is wrong.

**What the reference does.** It requests `percent_started.cut_types=diamond` and reads the requested
cut when present, falling back to the node's overall `value` when the cut is absent
(`getPercentValueForCut`, default `"diamond"`). So the reference's behaviour is "diamond, or overall".

**What the provider actually publishes.** Read-only, all five teams, 2026-10-27, one cut literal per
request, percent started (percent owned behaves the same way). `positive/total` is the number of players
with a value above zero out of those carrying the cut; `distinct` is the number of distinct values.

| Team       | Overall                   | Platinum                 | Diamond                   | Gold               | Silver             | Bronze             |
| ---------- | ------------------------- | ------------------------ | ------------------------- | ------------------ | ------------------ | ------------------ |
| football-1 | 15/15, distinct 13, 1–98  | 14/14, distinct 12, 1–98 | **0/14, distinct 1, 0–0** | 14/14, distinct 14 | 14/14, distinct 14 | 15/15, distinct 14 |
| hockey-1   | 21/21, distinct 18, 5–97  | 21/21, distinct 20, 1–96 | **0/21, distinct 1, 0–0** | 21/21, distinct 17 | 21/21, distinct 18 | 21/21, distinct 20 |
| hockey-2   | 18/18, distinct 16, 13–99 | 18/18, distinct 17, 2–98 | **0/18, distinct 1, 0–0** | 18/18, distinct 13 | 18/18, distinct 16 | 18/18, distinct 18 |
| hockey-3   | 22/22, distinct 19, 3–97  | 22/22, distinct 16, 1–96 | **0/21, distinct 1, 0–0** | 22/22, distinct 16 | 22/22, distinct 15 | 22/22, distinct 17 |
| hockey-4   | 22/22, distinct 19, 2–95  | 20/20, distinct 18, 1–94 | **0/19, distinct 1, 0–0** | 20/20, distinct 15 | 20/20, distinct 19 | 22/22, distinct 20 |

Four further measurements:

- **Diamond is zero for percent owned as well as percent started**, in every league, for every player.
  It is a published literal with no data behind it in this account.
- **Platinum, gold, silver, and bronze are all populated** and all differ from the overall value. On the
  four hockey teams, 81 of 83 players carry both values, and **no** player's platinum value equals their
  overall value: these are different populations, not a rescaling.
- **A cut can omit a player.** Football's platinum cut carries 14 of 15 roster players, hockey-4's 20
  of 22. A cut is a narrower population, so absence means "not measured in this cohort", not
  "unmeasured".
- **Asking for several cuts in one request returns no cut container at all.** One literal per request is
  the only reliable shape; a comma-separated list silently yields nothing.

**Does the choice matter?** Re-planning the four hockey rosters with the same scores and the same
availability tiers, changing only the population, moves **0 to 2 of 15 starting assignments** per team
(two on the 19-player team, none on the two 22-player teams). It is a real but modest effect on these
rosters — not the difference between a sane and an insane lineup.

**Recommendation: request `platinum`.** Precisely:

1. **Stop asking for `diamond`.** It costs a request parameter and a guard that can never fire, and it
   hides the fact that we are on the overall population. A cut whose every value is zero is a finding to
   record, not a state to normalise.
2. **Prefer `platinum` for the plan**, keeping the existing roster-level guard in a corrected form: use
   the cut only when every player who has an overall value also has a cut value; otherwise use the
   overall percentage for the whole plan. That keeps one population per plan (the current policy's rule)
   and avoids benching a player the provider _did_ measure, just not in that cohort.
3. **Record the population on the plan**, as the provenance label already does (`overall` today), so a
   later reader can tell which cohort priced the lineup.
4. **Fail loudly if the chosen cut becomes uniformly zero.** That is the guard that would have caught
   `diamond` immediately.

Why platinum rather than gold, silver, or bronze: the populated cuts all carry signal, and the two
decision-relevant facts are that platinum is populated and that the owner's recollection of the old
app's behaviour points at it. The cohort definitions are not documented by the provider and this pass
did not establish them; picking the cut the reference's own operators remember is a better use of the
available evidence than picking the one with the widest spread today. This is a value-basis choice
inside the provider: no seam change, no solver change, and it does not touch availability.

## 6. Where the participation fact belongs

The rule this project applies: **a fact crosses the seam as a neutral concept when the application needs
it for a decision that is not provider-specific and a second provider could plausibly supply it
differently; otherwise it stays inside the provider.**

Test the candidate fact against the rule:

1. _Does the application need it?_ Yes. The objective's second term counts starting players per
   availability rung, and the rung is decided from this fact. The application also needs to record it:
   §2 R3 is the reason the failure was invisible.
2. _Is the decision provider-specific?_ No. "Is this player scheduled to appear in this period" means
   the same thing at every provider. What differs is the field — Yahoo's `opponent`, another provider's
   fixture list or a `bye` flag.
3. _Could a second provider supply it differently?_ Yes, and that is an argument _for_ the neutral fact,
   because it keeps the interpretation in the adapter and the meaning at the seam.

So the fact crosses. Concretely:

- `ProviderRosterPlayer` gains one field: `scheduled: boolean` — the player's real-world team has a game
  in the roster's coverage period. The adapter computes it from `opponent` (`undefined`/`null` → false,
  `"Bye"` → false, any other string → true) and later from postponement too. It is a fact, not a
  judgement, so it carries no reason vocabulary.
- The adapter turns it into a tier in its own policy table, exactly as it does for injury codes
  (ADR 0006 item 2). The generic planner keeps taking the tier verbatim and learns nothing new.
- `LineupWorkerLive.observe` records it per player, so a run can explain why a player was benched.

**The tier it earns is the new bottom rung.** The reference's ordering is
`no game (1e-7) < injured (1e-3) < … < healthy (1)`: a player who will not appear because of a status is
still _able_ to appear, and the reference prefers them over a player whose team is not playing. That
ordering is worth keeping, and it needs a fourth rung `not-scheduled` below `will-not-play`:

| Rung               | Meaning                                                       | Facts that select it                                               |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `confirmed-start`  | in their real team's starting lineup                          | an available status, and a published starting status of `1`        |
| `will-play`        | expected to appear                                            | no status code, scheduled, and no starting status or an unread `0` |
| `might-play`       | may appear                                                    | `D`, `DTD`, `Q`, `P`, `GTD`, any unrecognised code                 |
| `unlikely-to-play` | confirmed outside the starting lineup where one player starts | an available status, a published `0`, and a goalie position        |
| `will-not-play`    | will not appear, but could                                    | `O`, `IR`, `IR+`, `IR-LT`, `SUSP`, `NA`; a bye                     |
| `not-scheduled`    | no game to appear in                                          | no game in the target period                                       |

**Decided:** on 2026-10-27 the owner approved adding the fourth rung, `not-scheduled`, below
`will-not-play`. That amends [ADR 0006](../adr/0006-availability-tiers.md)'s three-rung decision, so the
correction must also add the ADR note that records it; the solver is unaffected either way.

The ladder is declared by policy (`LineupPlanning.availabilityLadder`) and carried on the problem; the
solver compares rungs by declared order and needs no change. The fourth rung only arbitrates between
players who cannot contribute, so it can never displace a contributor — the first three terms decide
those.

**This confirms and sharpens the reading in the brief.** Participation is a neutral per-player fact
feeding the availability tier; a player with no game never beats a player with a game and can still
fill an otherwise-empty slot. The sharpening is that "will not play" and "cannot play because the team
is not playing" are different facts and deserve adjacent rungs, because the reference — which the owner
holds as correct — prefers the former when a required slot must be filled by someone who cannot
contribute.

**Alternative considered and rejected: fold it into `will-not-play` with no seam field.** It is smaller
(no `Provider*` change, no ladder change) and produces the same fix for the reported bug. It is rejected
because the run record stays unable to distinguish "benched: injured" from "benched: no game", which is
the failure mode this document exists to correct, and because the reference's ordering is then lost.

## 7. The reserve rule

### The facts

- **Reserve eligibility is published, per player.** Yahoo puts slot names in `eligible_positions`; a
  player whose list contains `IR`, `IR+`, `NA`, `IL`, or `IL+` may occupy that reserve slot. Bench space
  is open to every player. We already read this (`eligiblePositions`), and `LineupPlanning` already
  derives `reserveEligible` from it.
- **Reserve capacity** is the league's declared count per reserve slot name, already in
  `ProviderLeagueSettings.rosterPositions` with `kind: "reserve"`.
- **Reserve lists are distinct.** `IR` accepts only `IR`-eligible players; `IR+` only `IR+`; `NA` only
  `NA`. A player eligible for one is not eligible for another.
- **A reserve slot contributes nothing.** A player there has no starting credit, whatever their value.

### The rule that makes it correct

**RR1.** Reserve eligibility is read from the provider's published eligibility and never inferred from
the injury code. A player the provider stops listing as `IR`-eligible may not be placed on `IR`.
**RR2.** A player may be placed in a reserve slot only when eligible for that named list, and may occupy
only that list.
**RR3.** A reserve player who will play competes for starting slots on the same terms as a bench player:
the availability ladder decides contested slots, then value. Being on a reserve list is not a reason to
be skipped, and never adds or removes value.
**RR4.** When a reserve player takes a starting slot, the displaced player must go to a slot that
accepts them. A reserve destination is written like any other changed assignment; the provider accepted
both directions on 2026-10-27 (see the writability record below).
**RR5.** A player currently in a reserve slot who is no longer eligible for it must be moved out: the
solver's reserve edge is derived from current published eligibility, so it disappears.
**RR6.** Which of several eligible players sits in reserve is **not** a lineup decision: it changes no
starting slot and no value. The minimum-change tie-break leaves the incumbent. We deliberately do not
optimise it.
**RR7.** The moved player is recorded with the fact that drove the move (no game, out, day to day), so
the run explains itself.

### How this expresses the shuffle the owner described

Abstracted to labels. A team holds `A` on `IR+` (no injury code, has a game), `B` in a starting slot
(`O`, has a game), `C` on the bench (healthy, has a game). With participation unread, `A` and `C` are
`will-play`/`will-play` by injury and compete on crowd share only, and `B` is `will-not-play` — so the
plan already wants `A` in and `B` out; it is refused because the move transits `IR+`. With the
corrected facts: `A` is `will-play`, `B` is `will-not-play`, `C` is `will-play`. The objective prefers
`A` and `C` in starting slots; `B` is the one who cannot contribute and is a legal `IR+` destination
because the provider still publishes `IR+` eligibility for them. The shuffle is the _consequence_ of
the ordering, exactly as in the reference (document A, D8) — there is no "shuffle rule" to write.

### The rules that would make it wrong

- Inferring reserve eligibility from the injury code, so a `DTD` player cannot enter `IR+` or an
  `O` player cannot be parked on `IR`.
- Treating a reserve slot as a starting slot, so a parked player is credited with a start.
- Treating reserve membership as value, so parking a player costs or gains points.
- Letting a plan move any player into any reserve list, so the provider rejects the write.
- **Refusing the whole team because one member's best destination is a reserve slot.** This was the
  behaviour and it was wrong: it was a missing write capability, not a lineup contradiction.
- Dropping a player to make reserve room (document A, J9). We have no drop surface and must not acquire
  one by accident.

### The writability constraint, and how it was closed

`LineupPlanning.assignments` once refused a plan when either endpoint of a change was a reserve slot
(`assignment:reserve-slot`, transient). One of the owner's four teams was refused on exactly this
(§3). The refusal was honest caution — reserve writes had never been verified on our side — but it
converted "we cannot write one move" into "this team gets no lineup at all", every hour.

The reference writes reserve moves through the same roster PUT it uses for everything else, in
production (document A, W3). On 2026-10-27 the owner authorized one acceptance write into a reserve
list and one out, and the provider accepted both with a clean readback
([record](RESEARCH.md#reserve-transit-acceptance-2026-10-27)). Reserve eligibility is therefore back
to the provider's published `eligible_positions`, in both directions. The conservative intermediate
rule — a reserve slot accepting only its current occupant — is gone, and with it the last reason a
team could be refused for a move the operation was able to write all along.

## 8. Max games per position and churn

**Decision: deferred, with the shape recorded.**

Three parts, decided separately, because they have three different fates.

**(a) The value basis: percent owned, not percent started.** This is the part the owner remembered, and
the code confirms it: `scoreFunctionMaxGamesPlayed` starts from `ownershipScoreFunction(player)` and
never calls the percent-started base at all (document A, M1a, and its §5 _The ownership score, in full_). The reason is anti-churn. Percent started is a **daily** figure — the share of leagues that
started the player _for that date_ — so an ordering built on it changes every day. In a league where
every start consumes a game from a fixed per-position budget, daily re-ordering spends the budget on
whoever the crowd liked that day. Percent owned is a **season-long roster share**, half the composite,
with trailing rank as the other half: both move slowly, so the ordering is stable and the lineup stops
churning. That is exactly "used percent owned as the metric there to encourage less churning of
positions".

For us this is a **value-basis decision inside the provider**, not an objective change: the seam carries
one final score per player, so a max-games provider policy would construct its score from percent owned,
ranks, the bounded ownership delta and the positional-scarcity offset — and publish it. Nothing about
availability, the ladder, or the solver is involved. Two consequences if we ever support such a sport:
the score is no longer "crowd start share" and the provenance label must say so; and the positional
scarcity offset becomes load-bearing, because percent owned is not comparable across positions without
it.

**(b) The constraint: shrink capacity.** This part transfers exactly (document A, M1). A position
projected above its cap loses a starting unit to the bench and the ordinary overfilled rule benches the
worst player there. In our problem that is a reduced starting slot capacity — the remaining unit marked
optional if required capacity would otherwise over-constrain — with no new objective term and no
factor multiplication.

**(c) The churn mechanics: do not port the arithmetic.** The reference adds a 0..10 boost to incumbents
above the pace threshold and multiplies by `1e-7` for a player with no game below it. Both are value
adjustments standing in for two rules we can express directly and exactly: "do not churn equal players"
is already the solver's minimum-change tie-break, and "slot the player who is playing today" is the
availability ladder — except that the reference _suppresses_ participation above the pace threshold to
conserve games. That suppression is the one behaviour with no current equivalent, and it is a real
product question, not a port: it means deliberately benching a player who is playing, to save his games
for later. Recorded as a decision for whoever adds the sport.

**Status: shipped without the positional-scarcity offset (2026-10-27).** The owner asked for the
capacity work now, and accepted that percent owned may be sufficient without the offset. The seam gained
a `gamesPlayed` fact — per position `{played, max, projected}`, from the team's `games_played` member —
and the provider uses it in three ways.

**Which leagues take this path.** A league takes it when its settings declare `max_games_played` or
`max_innings_pitched`. Every other league keeps the scoring-rules and community-start-rate ladder, so no
football or hockey league in this account changes behaviour. The declaration is read from settings; the
per-position allowance is read from the team object only when a limit is declared, because the read
costs a request and answers nothing otherwise.

**The value basis.** When a limit is declared the plan prices players from the ownership composite,
published as provenance `yahoo/ownership-composite:no-positional-scarcity:<sport>:<period>`:

```
0.5 × (percent_owned − 0) + 0.5 × rankScore + bounded(percent_owned_delta)
```

`rankScore` is the reference's shape with the weights it uses per sport (football: last4Weeks 40,
projectedWeek 35, next4Weeks 25; hockey: last30Days 40, last14Days 30, next7Days 10, restOfSeason 20),
each rank converted to `min(playersInLeague / rank, weight / 5) × 5` so a rank better than the league's
starter pool cannot run away. `playersInLeague` is `teamCount × standardRosterSpots`, reserve slots
excluded. The delta term is clamped to `±4` percentile points, matching the reference's bound. All
arithmetic is exact; nothing is rounded until the selection units are formed.

The offset is recorded as zero and named in the provenance label rather than silently omitted. Percent
owned is not comparable across positions without it, so the composite ranks the positions the league
declares with the weight the league gives them, and a player only competes for slots they are eligible
for. Two forward consequences are unchanged from §8a: the score is no longer "crowd start share", and
the label says so.

**The constraint.** A position whose `played` has reached `max` loses its starting unit; a position
whose `projected` exceeds `max` by more than 1.5% loses one unit, marked optional when required capacity
would otherwise over-constrain. Capacity is reduced, never multiplied: no new objective term, no factor
applied to a score. A slot the reduction closes is absent from the planning problem, and a player
currently sitting there is planned out of it — except that locked players keep their units, so a locked
player can never make the problem infeasible. A league with no declared limit is unaffected.

**The churn mechanic.** Participation is ignored at a position whose projection exceeds its allowance:
there, the plan treats every player as scheduled, because the cap already forces rotation and benching a
player for a single off-day spends a game the league will not refund. Below the allowance — and when no
row is published for the player's slot or any position they are eligible for — the actual `scheduled`
fact stands. This is the reference's suppression rule, expressed as the availability ladder instead of a
`0..10` value boost: the owner's "maybe percent owned is sufficient" is answered by the stable value
basis, not by porting the boost arithmetic.

**What was deliberately left out.** The positional-scarcity offset is a separate, provider-neutral
concept: replacement level by position, useful for add/drop and trade valuation, portable beyond Yahoo.
It is not a lineup question and it is not built here. Without it the composite is a cross-position
ranking with a zero offset; with it, the same composite would price positions against replacement. The
owner's instruction was to keep it out of this chunk and treat it as its own work.

**What the live account could not show.** No linked league declares either limit, so the shipped path is
covered by tests and fixtures rather than a live plan. The `games_played` shape is synthetic, adapted
from the reference's captured baseball fixture: the position rows under `games_played_by_position_type`
and an `innings_pitched` row for the pitcher slot. A hockey team's `team/{key};out=games_played` returns
no `games_played` member, which the adapter treats as "no allowance published", not as a failure. The
first real games-limited league is therefore the first live exercise of this path; its plan provenance
will say `ownership-composite` and its capacity reductions will be visible as bench moves.

**Churn we do have.** Our scheduler creates a scheduled run per eligible team **every hour**
(`infra/hosts/cloudRun.ts`: `"0 * * * *"`), where the reference set lineups for a league only when a game
was about to start (document A, H3). The minimum-change tie-break keeps a stable plan stable, so this is
not a correctness defect — but it is more writes than the reference, and it makes "the plan is a fixed
point on unchanged inputs" a test worth having (§9, test 4).

## 9. Sanity checklist, as tests

Each is a statement a correct algorithm must satisfy, phrased to become a test. The layer in brackets is
where the test belongs.

1. **[policy]** A player whose team has no game in the target period is on the lowest rung, and the
   recorded fact is "no game", not an injury code.
2. **[policy]** A player whose team has a game, and whose status is `O`/`IR`/`SUSP`/`NA`, outranks a
   player with no game at all.
3. **[policy]** A player with no status code and a game outranks both.
4. **[solver, integration]** No player without a game starts ahead of a player with a game in a slot
   both are eligible for, whatever their values.
5. **[solver, integration]** A required starting slot is filled by a player who cannot play when nobody
   else is eligible for it; the run is planned, not refused.
6. **[solver]** A player who will not play never displaces one who will — for every pair of adjacent
   rungs, a plan that swaps them is worse under the objective.
7. **[solver]** Availability dominance cannot be bought: starting an available player of value 0 beats
   starting an unavailable player of value 100 for the same slot.
8. **[integration]** A player with no game keeps their final score: the score published for them is
   unchanged by the no-game fact (availability is not a discount).
9. **[integration]** Consecutive runs on unchanged inputs produce the same plan: the second run's
   change set is empty, including when the roster contains interchangeable bench players.
10. **[solver]** A locked player (`isEditable !== true`) never changes slot, and no other player's
    assignment depends on moving them.
11. **[integration]** A bye player does not displace an active player in a weekly league, and
    displaces nobody when every alternative is also on bye.
12. **[solver]** A player in a reserve slot who is no longer eligible for that list is assigned
    elsewhere; a player not eligible for a list is never assigned to it.
13. **[integration]** A reserve player who will play and can fill a starting slot held by a player who
    will not play is started there, and the displaced player is retained in a legal slot.
14. **[integration]** A plan may move a player onto a reserve list they are published as eligible for,
    and never onto one they are not; a team is never refused because a reserve move would have been
    best.
15. **[integration]** The plan places every roster member exactly once: nothing is dropped, nothing is
    invented.
16. **[integration]** The same roster with participation hidden and participation supplied produces
    different plans exactly when a no-game player occupies a slot a with-game player could fill.
17. **[evidence]** A run's observation records, per player, whether they had a game, so the plan's
    bench decisions can be explained without recomputation.
18. **[unit, provider]** The roster read requests the participation member and parses it: `null` and
    absent → not scheduled, `"Bye"` → not scheduled, any other string → scheduled; a payload without
    the member is a shape failure, not "everyone is playing".
19. **[policy]** The started-percentage read requests the populated cut (`platinum`), not `diamond`, and
    a cut that comes back present, complete, and uniformly zero is treated as a finding rather than
    silently replaced by the overall value.
20. **[policy]** A plan uses one population: either the cut for every player who has one, or the overall
    percentage for all, chosen once per roster and recorded in the provenance; a player the cut omits is
    priced from the overall percentage rather than benched as unmeasured.
21. **[policy, deferred sport]** If a league declares a per-position games limit, its final score is
    built from the ownership composite (percent owned, ranks, bounded delta, zero positional offset) and
    never from percent started; its games limit is expressed as starting-slot capacity, and no
    availability or value factor is multiplied by a pace threshold.

At diagnosis, tests 1, 2, 18, and 19 failed by construction; tests 4–8 and 12–17 failed because the
participation fact never arrived; test 20 failed because the diamond guard always fell through to the
overall value. Tests 3, 9, 10, and 11 passed and had to keep passing. All of them now pass. Test 21 is
implemented as the games-limited ownership composite; no linked league declares a limit yet, so it is
covered synthetically rather than by a live plan.

## 10. The ordered correction

Seven steps, retained as the delivery record. Each was independently testable, and steps 1–2 were the
whole fix for the reported bug. No step changed the solver, the architecture, or the provider boundary.
All seven are complete; the hockey teams were re-enabled only after the live read confirmed the fact.

### Step 1 — read the fact

- **Layer:** Yahoo adapter (`YahooProvider.readRoster`, `RosterPlayerPayload`, `toRosterPlayer`).
- **Change:** request `roster/players;out=opponent` (keeping `;week=N` for weekly coverage) and parse
  `opponent` into a boolean. The envelope is unchanged; only the path and one schema member are.
- **Test:** test 18, plus a fixture case for `"Bye"` and for a missing member. Existing roster fixtures
  must be re-recorded with the new path.
- **Does not yet change behaviour.** Nothing consumes the field.

### Step 2 — carry the fact and tier it

- **Layer:** seam (`ProviderRosterPlayer`), adapter policy (`YahooLineup`, provider-scoring
  `Valuation`), planner ladder (`LineupPlanning`).
- **Change:** add `scheduled: boolean` to the seam and the fake; add the `not-scheduled` rung to
  `ProviderAvailabilityTier` and the declared ladder; extend `AvailabilityAssessment` to be produced
  for it (`fact: "no-game"` already exists); map `scheduled === false` to that rung in `YahooLineup`
  rather than through `nonGamePeriods`, which stays for football byes.
- **Tests:** 1, 2, 3, 4, 5, 6, 7, 8, 16. An integration test through `scoreYahooRoster` +
  `planAssignments` on a synthetic hockey roster with two eligible players, one with a game and a lower
  score, is the regression.
- **Behaviour:** the reported failure stops. A no-game player can still fill a required slot nobody else
  can.

### Step 3 — record it

- **Layer:** generic worker observation (`LineupWorkerLive.observe`) and its schema.
- **Change:** record `scheduled` per observed player; include the availability fact in the plan's
  evidence where the plan already records provenance.
- **Test:** test 17, plus a redaction check (the observation must stay free of names in retained
  evidence per the repository's evidence policy — names are already present in `observe`, so this step
  adds a field, not a leak).
- **Behaviour:** none; the next failure is diagnosable.

### Step 4 — price from the populated population

- **Layer:** Yahoo adapter (`readStartRates` request literal; the cut-preference rule in the provider's
  scoring modules).
- **Change:** request `percent_started.cut_types=platinum` instead of `diamond`; keep the roster-level
  completeness guard, corrected to "every player with an overall value also has a cut value"; record
  the population actually used in the plan provenance; treat a uniformly zero cut as a recorded finding
  and fall back to the overall percentage, not as a silent success.
- **Tests:** 19, 20.
- **Behaviour:** three of the owner's five teams would price from platinum and two from the overall
  percentage, moving at most two starting assignments per team today. No seam change, no solver change,
  and it is independent of availability, so it can land before or after step 2.

### Step 5 — make the plan writable, then unblock the fourth team

- **Layer:** planner (`LineupPlanning.rosterPlayer` reserve eligibility; the `assignments` refusal).
- **Change (historical intermediate step):** reserve occupancy was "may remain where they are" until
  reserve writes were verified; the reserve-transit refusal was removed because the plan could no
  longer propose one. Step 6 restored the full two-way rule.
- **Tests:** 13 (partially: leaving reserve works), 14, 12.
- **Behaviour:** the team currently refused on `assignment:reserve-slot` produces a plan again. The
  full two-way shuffle waits for step 6.

### Step 6 — verify and enable reserve writes

- **Layer:** provider write path; the planner restriction from step 5.
- **Change:** one authorised acceptance write that moves a player into a reserve list and one that moves
  them out, read back and compared, following the pattern already used for the explicit-assignment
  verification in [the write verification record](RESEARCH.md#live-yahoo-explicit-assignment-write-verification-2026-10-26).
  Then restore genuine reserve eligibility in `LineupPlanning`.
- **Tests:** 13 in full; a readback test that a reserve transit is rejected by the provider is _not_
  needed — the readback is the authority.
- **Gate:** a live write, so owner authorisation, exactly like the earlier explicit-write acceptance.
- **Done:** both transits accepted and read back on 2026-10-27; reserve eligibility restored.
- **Behaviour:** the IR shuffle the owner described, in both directions.

### Step 7 — cadence from the league, not the sport

- **Layer:** Yahoo adapter (`rosterCoverage`) and target resolution.
- **Change:** derive coverage from the league's declared `weekly_deadline` and `edit_key`, rather than
  from the sport. A daily deadline (`intraday`, `game`) is date coverage; a weekday deadline (`1`–`7`)
  is week coverage; an empty deadline follows the edit key, which is a date for a daily league and a
  scoring-week number for a weekly one. A pair the adapter cannot classify refuses the league read
  with `provider.operation_unsupported` and a reason naming both values.
- **Test:** a league declaring a weekly deadline resolves a week target and reads a week roster; a
  daily league keeps resolving dates; an unclassifiable deadline refuses.
- **Behaviour:** a weekly-deadline hockey league stops mismatching. Not part of the reported defect;
  same class of error.
- **Evidence:** read-only, all five teams, 2026-10-27 — `intraday` with a date edit key on two hockey
  teams, an empty deadline with a date edit key on the other two, and an empty deadline with the week
  number `8` on the football team. Roster reads declared `date` for the four hockey teams and `week`
  for football. The deadline alone therefore cannot decide: the empty literal appears on both
  cadences.

### Deferred, with the condition that would reopen them

| Item                                            | Condition                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| positional scarcity for the ownership composite | a provider-neutral replacement-level definition; §8 records why it is separate                    |
| postponement                                    | the first observed postponed game, or a schedule read for another reason                          |
| confirmed starting goalie (`starting_status`)   | **done**: three-state seam fact; `confirmed-start` above `will-play`, `unlikely-to-play` below it |
| ``Q`/`P`/`GTD` mapping                          | **done**: the explicit status table records the tier and its disagreement with the reference      |
| category- and rotisserie-aware scoring          | unchanged from ADR 0009; the crowd share is still the only value for our hockey leagues           |
| transaction coupling                            | when an add/drop surface exists; pending transactions lock players                                |

## 11. What this correction does not change

- The solver, its objective, its encodings, and its proofs. The ladder length is policy data it already
  accepts.
- The provider boundary: the new field is neutral, the adapter still owns every provider-specific
  interpretation, and no Yahoo vocabulary enters generic code.
- The refusal model of ADR 0008. `assignment:reserve-slot` was deleted once reserve transits were
  verified; reserve moves are ordinary assignments now.
- [ADR 0006](adr/0006-availability-tiers.md)'s decision, except its _Deferred_ note about real-world
  starting status, whose premise ("the provider publishes no depth-chart or snap-share signal today")
  was contradicted by `starting_status` on goalies. That note is corrected, the fact now crosses the
  seam in three states, and the rungs are `confirmed-start` and `unlikely-to-play`.
