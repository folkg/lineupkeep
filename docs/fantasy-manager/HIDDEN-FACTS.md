# Hidden facts: what we hold and never publish

The owner asked for a full pass over information the server already reads or computes and never
publishes where a decision is made. This is that pass. Two "publish now" candidates needed no new
read; the owner approved both and a following change publishes them.

## What counts as a hidden fact

A fact is in scope only if all four hold:

1. We already decode it from a provider response, or compute it from values we decode.
2. It is absent from every MCP response a client would use for that decision, not merely absent from
   one page.
3. It changes a concrete decision: which player to start, add, drop, bench, keep, propose, or how
   much to bid.
4. A client cannot state it today without either guessing or a read we would have to add.

"Could be useful" is not a reason. A fact we would have to fetch with a new provider read, decode
from a payload we do not normally request, or infer from a field's name is not in scope; those are
listed under [what is deliberately not claimed](#what-is-deliberately-not-claimed), because naming
them honestly is more useful than dressing them as candidates.

The audit compared every field of the provider port (`ProviderLeagueSettings`, `ProviderRosterPlayer`,
`ProviderPlayerDetail`, `ProviderLeagueTeam`, `ProviderPendingTrade`, `ProviderMatchup`,
`ProviderRosterSchedule`, `ProviderCapabilities`) with the response schemas in `QueryResults.ts`,
`TransactionProposals.ts`, `LineupRun.ts`, and `LineupRuns.ts`, then checked live reads on
2026-11-08 against the owner's hockey league for shape, counts, and cost. Counts and byte sizes are
reported; no player, team, or league identifier is repeated here.

## The inventory

| #   | Fact we hold                                               | Held where                                                                            | Read that would carry it                              | Decision it would change                                     | Another way today                                              | Verdict        |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- | -------------- |
| 1   | Goalie/pitcher confirmed starting status                   | `ProviderRosterPlayer.startingLineup`                                                 | `get_rosters` team rows; summary roster rows          | Start or bench a goalie on a game day                        | None                                                           | Published      |
| 2   | A pool player's injury note                                | `ProviderPlayerDetail.availabilityDetail`                                             | `get_players` `availability.injury.detail` off-roster | Add a free agent whose note explains the absence             | `search_players` `status.detail`, a second read                | Published      |
| 3   | The receiving team's unused roster spots on an offer       | `ProviderPendingTrade.unusedRosterSpots`                                              | `get_pending_trade_offers` offer row                  | Accept or propose a two-for-one without a drop               | Count the rival's roster and the league maximum, then subtract | Do not publish |
| 4   | The custom lineup's per-player value and availability tier | Computed in `LineupScore`/`Valuation`                                                 | `get_lineup_runs` outcome, as a labelled ranking      | Trust, override, or audit an automated lineup                | None; stats and ranks can only approximate it                  | Do not publish |
| 5   | The league's provider web address                          | `ProviderLeagueSettings.webUrl`                                                       | `get_league` overview                                 | None established                                             | The person can use the provider itself                         | Do not publish |
| 6   | A roster player's eligibility class                        | `ProviderRosterPlayer.positionType`                                                   | `get_rosters` row                                     | None; the effective categories are already published         | `get_players` `scoringContext`                                 | Do not publish |
| 7   | The normalised roster injury status                        | `ProviderRosterPlayer.status`                                                         | `get_rosters` row                                     | None; severity is in the published code and note             | Roster `injury.code`/`detail`; `search_players` status         | Do not publish |
| 8   | The league's current fantasy date and day boundary         | `ProviderLeagueSettings.currentDate`, `fantasyDay`                                    | Any read that already resolves a window               | None; the resolved window and its source are published       | `get_rosters` coverage date; `schedule.window`                 | Do not publish |
| 9   | Roster-construction flags                                  | `rosterConstraints.startingSlotsMayStandEmpty`, `benchCapacity`, `reserveEligibility` | `get_league` roster rules                             | None a client acts on; the server plans and refuses          | Published slot counts and per-player eligible positions        | Do not publish |
| 10  | The roster state a run recorded before writing             | `lineup_run_diagnostics` observation                                                  | `get_lineup_runs` outcome                             | None; the live roster and the verified outcome are published | `get_rosters`; the run's `changes` and `leftInPlace`           | Do not publish |
| 11  | The exact assignments a run intended                       | `lineup_write_intents.before`/`plan`                                                  | `get_lineup_runs` outcome                             | None; `changes` and `differences` publish what happened      | The verified outcome                                           | Do not publish |
| 12  | A provider refusal's status and wording                    | `connection_incidents.providerStatus`/`providerDetail`                                | `list_connections`                                    | None; the reconnect remedy is the same either way            | The published reconnect-required status                        | Do not publish |

### 1. Goalie/pitcher starting status — published

Every team roster read already requests `out=opponent,starting_status,transactions`, and the adapter
decodes `starting_status.is_starting` into `confirmed-starting`, `confirmed-not-starting`, or
`unconfirmed`. Before publication the only consumer was the lineup score, so a client could not tell
a confirmed starter from a goalie whose status was simply not out yet, and those two lead to opposite
start/sit advice. Team roster rows and summary roster rows now publish `startingStatus` with those
three values. This is not a new read and it is not a projection: it is the provider's own real-world
starting status, published near game time.

The recorded 2026-10-26 probe found the key on exactly one of five rosters' goalies
(`is_starting: 0`), absent for every skater and for goalies whose team had no game that day. It is
absent for most rows because the field applies to goalies and pitchers only, not because the read is
broken; `unconfirmed` is the honest answer for everyone else. Carrying it on `get_rosters` team rows
and the summary roster costs no provider read, because both already read that roster. The league
roster page requests only `out=roster`, so its rows say `not_requested`; carrying it there would add
an output to that request shape rather than publish a fact already held, and remains a separate
decision. The schedule read requests only `out=opponent` and has no starting status. It is named as
the provider's starting status, not as "will play": a confirmed non-starter can still play.

### 2. A pool player's injury note — published

`read_player_details` already decodes `injury_note`/`status_full` into `availabilityDetail`. For a
rostered player the roster row's own `injury` fields already carry the code and note. For a player
off the roster, `get_players` `availability` used to publish `injury: { reported: false }` and drop
the note it had just read. That was worse than a missing field: a free agent with a published injury
note was reported as having none. It now publishes the note in `injury.detail` and sets `reported`
from it, from the read that already performed the lookup. `search_players` still publishes the same
note as `status.detail`; a client no longer needs that second read to learn why a free agent is out.

### 3. The receiving team's unused roster spots — publish later

The pending-trade payload carries `tradee_unused_roster_spots`, the adapter decodes it into
`unusedRosterSpots`, and no response publishes it. The recorded 2026-10-31 offer carried the field as
`0` while the offer was two players for two, which does not establish whether the count is the
receiver's spots before or after the offered players arrive. Publishing a number whose meaning we
would be guessing is worse than leaving it out, so this waits for one recorded offer with a nonzero
count, checked against the receiving roster the league page already reads. If it then means open
spots, it belongs on the offer row: it decides whether a trade can be accepted without a drop, and
counting the rival's roster by hand is exactly the kind of arithmetic this product exists to avoid.

### 4. The custom lineup's per-player value — publish later

The lineup run already computes a signed value and an availability tier for every rostered player,
and discards them after choosing an assignment. The outcome publishes the changes, the differences,
and the players left in place with a reason, but not the ranking that chose between two available
players. That ranking would let a client audit or override an automated lineup instead of trusting
it; the published stats, ranks, and projections only approximate it. It is "later" rather than
"now" because it is our policy, not a league fact: publishing it needs an explicit basis label, a
decision about how much of the ranking to keep, and the owner's agreement that freezing a number we
may tune is better than a stable outcome. It is also the one candidate that touches the solver
boundary, so it should not ride a query-results change.

### 5–12. Do not publish

The league web address is a provider URL that embeds the league key, invites bypassing the product,
and changes no decision the product supports. The eligibility class is an encoding the effective
scoring categories already answer. The normalised roster status is a re-encoding of the published
code and note, and the pool surface already publishes the enum. The league's current fantasy date is
already stated as the roster coverage date and as the schedule window and its source; the exact
day-boundary rule is our pause arithmetic, not a lock instant the provider publishes. The
roster-construction flags are inputs the solver and proposal checks apply, and a client can read the
resulting legality from the published slot rules and eligible positions; publishing the flags would
invite a client to re-implement a rule the server owns. The run observation, the write intent, and
the incident detail are recovery and operations state, retained for a short period: the live roster,
the verified outcome, and the reconnect remedy are the client-facing facts.

## Role facts and advanced statistics

### What our own reads carry

| Question                               | Provider surface we read                                                                                  | Held?                 | Published?                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ |
| Goalie confirmed starter               | Roster `out=opponent,starting_status,transactions`                                                        | Yes, `startingLineup` | Yes, `startingStatus`                                  |
| Time on ice or minutes                 | Only if the league scores it as a category                                                                | Only as a league stat | Yes, through `actual_stats`, when the league scores it |
| Shifts                                 | Not requested, not decoded                                                                                | No                    | —                                                      |
| Line, pair, or depth                   | No field seen in any read or recorded capture                                                             | No                    | —                                                      |
| Usage                                  | Percent owned/started, transaction trend, acquisition usage                                               | Yes                   | Yes                                                    |
| Advanced statistics                    | Only league-scored categories; the live league's thirteen carry none of Corsi, Fenwick, or expected goals | Only as league stats  | Yes, through `actual_stats`                            |
| Live projections and minutes remaining | Android app only (`matchup_player_scores`)                                                                | No                    | —                                                      |

The live check on 2026-11-08 is the strongest evidence that player statistics are league-shaped
rather than provider-shaped: the hockey league declared thirteen categories (goals, assists, points,
power-play points, shots, hits, blocks, wins, goals against, goals-against average, saves, shots
against, save percentage), and a roster-wide `actual_stats` read returned only seven stat ids, all of
them named by that league's scoring definitions. There were no unnamed stat ids, so there was no
"extra" statistic the dictionary could not label. Nothing in the read carries a line, a pair, a shift
count, or time on ice unless the league itself scores time on ice.

### What the mobile surfaces expose

The Yahoo SDK's Android API notes, at `~/Documents/Software/lineupkeep-sdk/packages/yahoo-sdk/docs/mobile-api.md`,
are a recorded capture of app traffic, and they are the reference for what exists beyond our channel.
Read as evidence, not imported:

- App-only aggregate reads carry live projections, live projected points, player notes, opponents,
  ownership, watchlist, matchup rating, positional ranks, and recommended trade partners. The
  statcloud `matchup_player_scores` resource adds initial and live projections, minutes remaining,
  detailed player stat scores, and a sport-specific suffix; the `-6` suffix was observed for the NFL.
- App-only JSON resources carry a player card, a per-game log with a stat legend, and a season-stats
  table with prior seasons. These are layouts over the same league-scored statistics, not a distinct
  role feed.
- The draft-pick trade builder exposes `available_draft_picks.picks[].pick` as `{ round, cost, pick }`
  with no original-team field; the write body itself sends only a round and a source team.
- No captured endpoint carried a line, pair, depth chart, shift count, or time-on-ice field for a
  player. "Minutes remaining" is a live-scoring game clock, not time on ice.

Two mobile-only facts are role-adjacent and cannot be used from our channel: live projections and the
live game clock. Using them would require a mobile session and a new adapter, which is a separate
decision, not a hidden-fact publication. Yahoo also publishes no player-level projected statistics on
the web API we use: the recorded 2026-11-03 probe found projected _ranks_ only, and the app's live
projection is a different resource.

## What is deliberately not claimed

- **`draft_analysis`.** A 2026-11-03 probe recorded that the player-detail read accepts
  `out=…,draft_analysis` with HTTP 200, but the response's nested keys were never retained. It might
  carry average draft position or percent drafted, which would matter for a keeper rule; we do not
  know that it does. It is not in the inventory, and it is not a publish-now candidate, until one
  recorded payload shows the keys. It is the most valuable unknown for pricing draft history, so it
  should be recorded before any keeper feature depends on it.
- **`player_points` and the other rank types.** The football player-detail payload carries the
  provider's realised league-scored total, and the `ranks` response carries up to seven rank types
  (last 30/14 days, last four weeks, projected week and season). We request both shapes and decode
  only `projected_week`; the rest is not "held" because it never reaches a provider type. The client
  can compute the realised total from published stats and published scoring points, and recent form
  from published week or range stats, so neither is hidden information even though it is on the wire.
- **`available_draft_picks`'s `cost`.** The mobile capture shows a `cost` beside the round and pick.
  Its meaning — auction cost, keeper cost, or something else — is not recorded, and the Android draft
  builder did not send it. Publishing it would be a guess about a league's house rule.
- **Manager names.** The provider port has an optional `managerName`, but the adapter never sets it
  from the league-teams payload, so it is not held. Reading it is a new decode, not a hidden fact.
- **A league's remaining FAAB balance.** It is held on the league-teams read and published in a
  proposal set's `budget.remaining`, which is where the bid decision is checked. It is not on the
  analysis reads, but it is published somewhere a bid decision is made, so it fails the "never
  published" test. If the owner wants it beside the acquisition limits in `get_team_summary`, that is
  a small follow-up, not an inventory entry.
- **Per-team games played.** The provider publishes no per-team count (its `teams;out=games_played`
  read returns an empty per-team node), so the absence is stated as `not_published` rather than
  filled from a guess.

## Proposal

1. Publish the goalie/pitcher starting status on the roster surfaces. No new read; decode already
   done. Highest value: it separates "confirmed sitting" from "not published yet" for the one
   position where that flips a start decision.
2. Publish the pool player's injury note in `get_players` `availability`. No new read; it fixes a
   `reported: false` that contradicts a note the same read already fetched.
3. Wait for one recorded offer with a nonzero `tradee_unused_roster_spots` before publishing it, and
   publish it only with a stated meaning.
4. Treat the lineup ranking as a separate policy proposal, not a query field.

Items 1–2 are published; items 3–4 remain proposals, and the owner decides whether and when to
publish them. The report ships with the draft-provenance change so the keeper question and the wider
hidden-facts question are read together.
