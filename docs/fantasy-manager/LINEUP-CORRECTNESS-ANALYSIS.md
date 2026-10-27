# Lineup correctness: the participation regression, and the corrected design

The reported failure, the diagnosis, the gap against
[the reference knowledge record](AUTOCOACH-KNOWLEDGE.md), and the ordered correction. Architecture is
not in question. This document changes no production code; it is the design the correction follows.

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
`provider.planLineup` for the committed scores, and called the committed `planAssignments` to obtain the
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
complained about. On the fourth, the plan is refused outright (§6), so that team also changes nothing.

**The ordering is the whole explanation.** Each violation pair is one started player and one benched
player, both eligible for the same starting slot, with the scores the provider published for that date
(hundredths of a percent started):

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
working (§8, test 2).

**The roster also shows the reserve problem the owner described.** Eight players sit in reserve slots
across the four teams. Seven of them **have a game today**. One of those seven carries **no injury code
at all** — a healthy player parked on `IR+`. The reference treats that as a roster problem
(`healthyOnIL`); our planner tries to promote the healthy player, discovers the move transits a reserve
slot, and refuses the whole team. See §6.

## 4. Fact inventory against the seam

Every fact from [document A](AUTOCOACH-KNOWLEDGE.md) and the fact in this failure, each with a
disposition. "Seam" means `Provider*` contracts in
`packages/backend/src/contexts/connections/Provider.ts`.

### Present and used by the lineup decision

| Fact                                                                                                                       | Where it enters                                                                       | Used for                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| injury code (`status`)                                                                                                     | `ProviderRosterPlayer.injuryCode` → `yahooAvailability` → `PolicyPlayer.availability` | selects `available` / `uncertain` / `excluded`                                                   |
| bye week (`bye_weeks.week`)                                                                                                | `ProviderRosterPlayer.byeWeek` → `nonGamePeriods`                                     | bye is `will-not-play` for **weekly** coverage only (R2)                                         |
| eligible positions                                                                                                         | `ProviderRosterPlayer.eligiblePositions` → slot eligibility and `reserveEligible`     | which slots a player may occupy; reserve legality                                                |
| selected slot                                                                                                              | `ProviderRosterPlayer.slot` → `currentSlotId`                                         | minimum-change tie-break, comparison, write delta                                                |
| editable                                                                                                                   | `ProviderRosterPlayer.isEditable` → `lockedSlotId`                                    | locks                                                                                            |
| percent started (overall, and a cut)                                                                                       | separate `readStartRates` → `ValueSource`                                             | final score for every hockey league                                                              |
| league scoring rules                                                                                                       | `ProviderLeagueSettings.statModifiers`                                                | final score for football                                                                         |
| roster positions, counts, `is_starting_position`                                                                           | `ProviderLeagueSettings.rosterPositions`                                              | slot model, capacities, starting/bench/reserve classification                                    |
| league period window, coverage                                                                                             | `ProviderLeagueSettings`, `ProviderRoster.coverage`                                   | target resolution, period scoping                                                                |
| `weeklyDeadline`                                                                                                           | `ProviderLeagueSettings.weeklyDeadline`                                               | **read but not used to decide cadence** (see below)                                              |
| `is_undroppable`, `ownership`, `positionType`, `primaryPosition`, `displayPosition`, `proTeamAbbreviation`, `injuryDetail` | seam                                                                                  | present for the query surfaces; **unused by planning**, correctly (no drop/add, no display need) |

### Missing from the seam

| Fact                                                 | Reference source                                            | Consequence today                                                         | Disposition                                            |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| **has a game in the target period**                  | `opponent` on the roster player (string / `null` / `"Bye"`) | **the reported failure**                                                  | **in scope, first** (§5)                               |
| **real-world starting status**                       | `starting_status.is_starting` (goalies, pitchers)           | a backup goalie with a game is indistinguishable from a confirmed starter | in scope, later (§9 step 5)                            |
| games played by position, `played`/`max`/`projected` | team-level `games_played`                                   | no max-games support                                                      | deferred: unreachable in football/hockey (§7)          |
| innings pitched                                      | team-level `games_played.innings_pitched`                   | same                                                                      | deferred: not a supported sport                        |
| postponed games                                      | external schedule/scoreboard read                           | a postponed game would look like a game                                   | deferred with a named limitation (§9)                  |
| pending transactions                                 | roster `transactions` (waivers, pending trades)             | a player in a pending transaction is a free variable                      | deliberately out of scope; the lock is its future home |

### Present but wrong or unused where it should be used

| Fact               | Problem                                                                                                                                                                                                                                     | Disposition                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `weeklyDeadline`   | coverage is chosen by **sport** (`rosterCoverageBySport`), not by the league. A weekly-deadline hockey league resolves a date target and then mismatches the roster's own week coverage. The reference takes coverage from the roster read. | fix in step 6 (independent of the reported bug, but the same class of "we assumed instead of asking")       |
| `injuryCode` table | `O`, `IR`, `IR-LT`, `SUSP`, `NA`, `DTD` are mapped. `Q`, `P`, `GTD` — which the reference lists as _healthy_ — land on `unrecognised` → `might-play`. The behaviour is defensible; the mapping is an accident.                              | make it explicit in the table with the tier each code earns, and record the disagreement with the reference |
| `byeWeek`          | only consulted for weekly coverage; harmless once participation is read, redundant for football                                                                                                                                             | keep; it is the football-specific spelling of the same fact                                                 |

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

## 5. Where the participation fact belongs

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

| Rung            | Meaning                    | Facts that select it                    |
| --------------- | -------------------------- | --------------------------------------- |
| `will-play`     | expected to appear         | no status code, and scheduled           |
| `might-play`    | may appear                 | `DTD`, any unrecognised code            |
| `will-not-play` | will not appear, but could | `O`, `IR`, `IR-LT`, `SUSP`, `NA`; a bye |
| `not-scheduled` | no game to appear in       | no game in the target period            |

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

## 6. The reserve rule

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
accepts them. If that destination is a reserve list, the move requires the ability to write reserve
assignments (see the writability constraint below).
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
- **Refusing the whole team because one member's best destination is a reserve slot.** This is the
  current behaviour and it is wrong: it is a missing write capability, not a lineup contradiction.
- Dropping a player to make reserve room (document A, J9). We have no drop surface and must not acquire
  one by accident.

### The writability constraint, and why it is in scope

`LineupPlanning.assignments` refuses a plan when either endpoint of a change is a reserve slot
(`assignment:reserve-slot`, transient). One of the owner's four teams is refused on exactly this today
(§3). The refusal is honest caution — reserve writes have never been verified on our side — but it
currently converts "we cannot write one move" into "this team gets no lineup at all", every hour.

The reference writes reserve moves through the same roster PUT it uses for everything else, in
production (document A, W3), so the capability is real. Until we have verified it ourselves, the plan
must be **writable by construction**: reserve slots accept only players who already occupy them. That
is one expression change in `LineupPlanning` (`reserveEligible` becomes "may remain where they are")
and it removes the refusal without inventing a partial-write protocol. A reserve player can then still
leave (their non-reserve slots are unaffected), the displaced player lands on the bench, and a team is
never blocked by a capability gap. Step 5 of §9 turns the full shuffle back on after one authorised
acceptance write.

## 7. Max games per position and churn

**Decision: deferred, with the shape recorded.**

- It is **unreachable in our supported sports**. Yahoo's per-position games limit is a baseball and
  basketball setting; football plays one game per week and hockey has no games limit in a Yahoo league.
  Our football league publishes no such setting, and the roster read exposes no `games_played`.
- The reference's expression is **capacity, not factors** (document A, M1): a position projected above
  its cap loses a starting unit to the bench, and the ordinary overfilled rule benches the worst player
  there. That is directly expressible in our problem — reduce the starting slot's capacity, and mark the
  remaining unit optional if required capacity would otherwise over-constrain — with no new objective
  term.
- The reference's _churn_ half (M5/M6: a 0..10 boost for incumbents above the pace threshold, and a
  `1e-7` penalty below it) must **not** be ported. Its purpose is "do not churn a good player, do churn
  when the pace is slack", and our solver already has an exact version of the first half as the
  minimum-change tie-break. The second half ("slot the player who is playing today") is what the
  availability ladder now does, without a threshold.
- What it would need: a `gamesPlayed` fact on the seam — per position, `{played, max, projected}` — read
  from the team object, plus a policy decision about which games count. That is a new read, a new
  contract field, and a product decision, not a correction to this defect.

**Churn we do have.** Our scheduler creates a scheduled run per eligible team **every hour**
(`infra/hosts/cloudRun.ts`: `"0 * * * *"`), where the reference set lineups for a league only when a game
was about to start (document A, H3). The minimum-change tie-break keeps a stable plan stable, so this is
not a correctness defect — but it is more writes than the reference, and it makes "the plan is a fixed
point on unchanged inputs" a test worth having (§8, test 4).

## 8. Sanity checklist, as tests

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
14. **[integration]** No plan produced for today's write contract moves a player into a reserve slot;
    a team is never refused because such a move would have been best.
15. **[integration]** The plan places every roster member exactly once: nothing is dropped, nothing is
    invented.
16. **[integration]** The same roster with participation hidden and participation supplied produces
    different plans exactly when a no-game player occupies a slot a with-game player could fill.
17. **[evidence]** A run's observation records, per player, whether they had a game, so the plan's
    bench decisions can be explained without recomputation.
18. **[unit, provider]** The roster read requests the participation member and parses it: `null` and
    absent → not scheduled, `"Bye"` → not scheduled, any other string → scheduled; a payload without
    the member is a shape failure, not "everyone is playing".

Tests 1, 2, and 18 fail today by construction. Tests 4–8 and 12–17 fail today because the fact never
arrives. Tests 3, 9, 10, and 11 pass today and must keep passing.

## 9. The ordered correction

Six steps. Each is independently testable, and steps 1–2 are the whole fix for the reported bug. No
step changes the solver, the architecture, or the provider boundary. **Re-enable the four hockey teams'
automation after step 2 is verified against a live read, not before.**

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
- **Tests:** 1, 2, 3, 4, 5, 6, 7, 8, 16. An integration test through `planYahooLineup` +
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

### Step 4 — make the plan writable, then unblock the fourth team

- **Layer:** planner (`LineupPlanning.rosterPlayer` reserve eligibility; the `assignments` refusal).
- **Change:** reserve occupancy is "may remain where they are" until reserve writes are verified; the
  reserve-transit refusal is removed because the plan can no longer propose one. Keep the refusal
  mapped in the provider's code table until it is unreachable, then delete it deliberately.
- **Tests:** 13 (partially: leaving reserve works), 14, 12.
- **Behaviour:** the team currently refused on `assignment:reserve-slot` produces a plan again. The
  full two-way shuffle waits for step 5.

### Step 5 — verify and enable reserve writes

- **Layer:** provider write path; the planner restriction from step 4.
- **Change:** one authorised acceptance write that moves a player into a reserve list and one that moves
  them out, read back and compared, following the pattern already used for the explicit-assignment
  verification in [the write verification record](RESEARCH.md#live-yahoo-explicit-assignment-write-verification-2026-10-26).
  Then restore genuine reserve eligibility in `LineupPlanning`.
- **Tests:** 13 in full; a readback test that a reserve transit is rejected by the provider is _not_
  needed — the readback is the authority.
- **Gate:** a live write, so owner authorisation, exactly like the earlier explicit-write acceptance.
- **Behaviour:** the IR shuffle the owner described, in both directions.

### Step 6 — cadence from the league, not the sport

- **Layer:** Yahoo adapter (`rosterCoverage`) and target resolution.
- **Change:** derive coverage from the league's `weeklyDeadline` (or from the roster's own
  `coverage_type`, as the reference does), rather than from the sport. Add the `weekly_deadline`
  values the adapter cannot classify to the refusal vocabulary rather than guessing.
- **Test:** a league declaring a weekly deadline resolves a week target and reads a week roster; a
  daily league keeps resolving dates.
- **Behaviour:** a weekly-deadline hockey league stops mismatching. Not part of the reported defect;
  same class of error.

### Deferred, with the condition that would reopen them

| Item                                                  | Condition                                                                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| max games per position, and its pace arithmetic       | a supported sport that declares the limit; §7 records the shape                                                                                                |
| postponement                                          | the first observed postponed game, or a schedule read for another reason                                                                                       |
| confirmed starting goalie/pitcher (`starting_status`) | next after step 5; it is a participation refinement the reference used, and ADR 0006's premise that the provider publishes no such signal is wrong for goalies |
| `Q`/`P`/`GTD` mapping                                 | before the next season's injury-code drift; make the table explicit now                                                                                        |
| category- and rotisserie-aware scoring                | unchanged from ADR 0009; the crowd share is still the only value for our hockey leagues                                                                        |
| transaction coupling                                  | when an add/drop surface exists; pending transactions lock players                                                                                             |

## 10. What this correction does not change

- The solver, its objective, its encodings, and its proofs. The ladder length is policy data it already
  accepts.
- The provider boundary: the new field is neutral, the adapter still owns every provider-specific
  interpretation, and no Yahoo vocabulary enters generic code.
- The refusal model of ADR 0008, except that `assignment:reserve-slot` becomes unreachable by
  construction.
- [ADR 0006](../adr/0006-availability-tiers.md)'s decision, except its _Deferred_ note about real-world
  starting status, whose premise ("the provider publishes no depth-chart or snap-share signal today") is
  contradicted by `starting_status` on goalies and pitchers. That note should be corrected when step 5
  is scheduled.
