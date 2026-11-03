# Planning research

Research informs proposals; it does not constitute deployment or compatibility verification.

## Existing scoring behavior

Inspected `server/core/src/common/services/playerScoreFunctions/playerStartScoreFunctions.service.ts` in AutoCoach:

- Base scoring uses started percentage, falls back to owned percentage, and coerces missing/zero values to at least one.
- Injury, non-participation, and starting status apply multiplicative penalties/boosts.
- Weekly scoring has a different rule because its comments state projections already incorporate injury effects.
- NFL scoring includes a comment questioning whether injury is counted twice.

The successor is not committed to these formulas or fallbacks. Preserve zero/missing distinctions, allow signed selection values, and separate legal eligibility from participation evidence. Decide policy explicitly and test it independently from the assignment solver. Do not use the old output as the sole correctness oracle.

## Fantasy-day boundaries and timezone handling

- The old utility module uses spacetime with the named zone `Canada/Pacific`, not an explicit fixed PST offset.
- Yahoo's [transaction and lineup deadlines](https://help.yahoo.com/kb/SLN6775.html) use PT and describe settings-dependent game-time and 11:59 PM deadlines. This supports using Pacific local calendar rules, but does not by itself prove a single universal fantasy-day rollover. Exact Yahoo pause-boundary semantics remain a verification item; the live read probes recorded below found week coverage on roster entries and an empty `weekly_deadline` on a game-time league, but reads cannot settle rollover.
- The current local starter declares Effect 4.0.5 and Node >=24.11.1 <25. The local runtime reports Node 24.21.0 and `globalThis.Temporal` is undefined under its default flags.
- Inspected Effect's DateTime source for named zones, local start-of-day, and calendar-aware addition. A network-free smoke check using the starter's installed Effect produced 23 hours between Los Angeles midnights on 2026-03-08 and 25 hours on 2026-11-01.
- Effect DateTime appears sufficient without a separate timezone dependency. Production tests must include pause expiry exactly at the boundary, DST changes, server/user timezone independence, and late queue delivery across rollover. This does not authorize a starter copy or an application implementation.

## Starter machine support and old scheduling

- The current starter already catalogs `@typeonce/effect-machine` 0.41.1 and uses Schema-defined machines in `NoteLifecycleWorkflow.ts`.
- Its machine utilities expose snapshot decoding and pure transition planning. These are useful conventions to evaluate; they do not prove a durable external-side-effect execution engine exists.
- The old AutoCoach scheduler fires at minute 55 of every hour. Additional sport/day eligibility is selected downstream. Its cadence is evidence of the incumbent behavior, not a requirement to copy it.
- Starter dependencies have changed since earlier research; inspect its current architecture and readiness before copying. Presence of updated files does not establish a copy-ready handoff.

## Old Yahoo write batching

Inspected `putLineupChanges` and `putRosterChangePromise` in `server/core/src/common/services/yahooAPI/yahooAPI.service.ts`. The public function receives an array but loops sequentially over it, assembling one XML roster body and calling `team/{teamKey}/roster` once per team. This proves only that the old app does not batch writes across teams. It does not prove Yahoo cannot support any bulk-write endpoint. No additional live Yahoo probes were made. Batch provider requests only when actual support and per-team outcome semantics are verified.

## Live Yahoo read verification (2026-10-25)

The owner authorized live read queries against their own teams and supplied a signed-in browser session for the duration of the check. A gitignored scratch harness under `.artifacts/live-yahoo/` ran the committed `YahooProvider` through `PublicInternet` with the real transport: session validation, crumb acquisition, and NFL/NHL team discovery exactly as the adapter sends them, plus bounded read-only probes for the roster and league settings shapes stage three will need. The session cookie moved from browser memory to the harness process over loopback and was never printed, written, or committed; retained evidence holds only structural shapes, byte sizes, timings, and masked identifier patterns.

| Adapter operation           | Request                                                                                   | Status | Typical size | Typical time |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------ | ------------ | ------------ |
| `validateSession`           | `GET https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1?format=json` | 200    | 501 B        | 150–650 ms   |
| `discoverTeams` (NFL)       | `GET .../users;use_login=1/games;game_keys=nfl/teams?format=json`                         | 200    | ~8.2 KB      | 200–330 ms   |
| `discoverTeams` (NHL)       | `GET .../users;use_login=1/games;game_keys=nhl/teams?format=json`                         | 200    | ~25.8 KB     | 220–280 ms   |
| `readCrumb`                 | `GET https://pub-api.fantasysports.yahoo.com/fantasy/v3/getCrumb?format=json_f`           | 200    | 87 B         | 130–210 ms   |
| roster probe, unimplemented | `GET .../fantasy/v2/team/{team_key}/roster?format=json`                                   | 200    | 105–130 KB   | 200–260 ms   |
| league probe, unimplemented | `GET .../fantasy/v2/league/{league_key}/settings?format=json`                             | 200    | 58 KB        | 160–220 ms   |

Sizes and times are from a handful of runs on one machine, not a benchmark. Confirmed live:

- Fantasy session material is the `T` and `Y` cookies; the pair the hosted browser extracts is sufficient for every request above.
- `game_keys` scopes the response to that game, so the NFL and NHL payloads differ.
- The account returned five teams — one NFL and four NHL, including two teams in one NHL league. Multiple teams per league coexist in one response, and every `team_key` matched the adapter's `^[^.]+\.l\.[^.]+\.t\.[^.]+$` pattern with four- and five-digit league ids and one- and two-digit team ids.
- `season` arrives as a numeric string, so the schema's string-to-integer transform is load-bearing.
- An invalid or expired session returns HTTP 401 with a JSON `error` envelope from the v2 read origin, which the transport reports as `provider.session_rejected`. No redirect was involved.
- `getCrumb` answers HTTP 200 with `service.crumb: null` for the same expired session, so crumb acquisition alone cannot distinguish expiry. A caller must validate the session before treating a missing crumb as a provider defect.
- A valid crumb was short, alphanumeric with punctuation, and identical across two reads inside one session.

### Payload processing defects found and fixed

Yahoo expresses a record as a positional array of attribute fragments, and two real properties were unhandled:

- A team entry nests its attribute fragments one level deeper and pads absent attributes with empty lists: `{"0": {"team": [[{team_key}, {team_id}, …, []], []]}}`. The normalizer read the outer list as a value array, so discovery rejected every real payload. Nested fragment lists now flatten and empty placeholders contribute nothing.
- Repeated single-field entries — `roster_position` entries, `stat_categories.stats`, `eligible_positions.position` — share one field across entries. Merging any record array collapsed them to the last entry, turning nine roster slots and thirty-six scoring categories into one apiece. Record arrays whose entries repeat a field now stay ordered arrays; only records with disjoint fields describe one resource.

Both rules are locked by fixtures built from the observed nesting and field names, with no captured values.

### Still unverified read-only

- All writes: native start-active XML roster actions, crumb use, readback, locks, and uncertain-outcome reconciliation. No write was attempted.
- Premium and optimal-start entitlement behavior.
- Period rollover and deadline semantics. Roster entries carry week coverage and this league reports an empty `weekly_deadline`; whether Yahoo accepts a lineup after a player's game starts is untested.
- Bench and reserve capacity enforcement. League settings declare nine starting slots, six bench, and one further reserve slot, each identified by `position` and `is_starting_position`; whether the bench count is a hard maximum needs a write test.
- Lock semantics beyond observing `is_editable: 0` on two NFL roster members.
- Query byte and fan-out budgets at league scale (opponent rosters, player pools, statistics) and any hosted-client acceptance.

## Live Yahoo read endpoints (2026-10-25)

The owner authorized live read queries against their own teams, and a second gitignored harness
(`.artifacts/live-yahoo-reads/`) exercised the committed adapter's search, matchup, transaction,
team-membership, and selected-player reads through `PublicInternet` with the real transport. The
`T`/`Y` cookies moved from browser memory to the harness process over loopback and were never
printed, written, or committed. Retained evidence holds field names, scalar classes and lengths,
masked identifier patterns, byte sizes, timings, and outcome tags only. No write, transaction, or
premium action was attempted.

| Adapter operation               | Request                                                                                                                                  | Status | Typical size                             | Typical time |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ------------ |
| `readLeagueTeams`               | `GET .../fantasy/v2/league/{league_key}/teams?format=json`                                                                               | 200    | 40–50 KB                                 | 200–240 ms   |
| `readMatchups`                  | `GET .../league/{league_key}/scoreboard;week={week}?format=json`                                                                         | 200    | 91 KB NFL, 150 KB NHL                    | 220–250 ms   |
| `readTransactions` (unbounded)  | `GET .../league/{league_key}/transactions?format=json`                                                                                   | 200    | 179–539 KB                               | 240–290 ms   |
| `readTransactions` (`count=25`) | `GET .../league/{league_key}/transactions;count=25?format=json`                                                                          | 200    | ~114 KB                                  | 200–210 ms   |
| `searchPlayers`                 | `GET .../league/{league_key}/players[;status=FA\|W];sort=NAME\|R_PO;count={≤50}[;search={term}];out=ownership,percent_owned?format=json` | 200    | 110–160 KB at 25 rows                    | 200–270 ms   |
| `readPlayerDetails`             | `GET .../league/{league_key}/players;player_keys={≤25};out=stats,ownership?format=json&stats.type=week&stats.week={week}`                | 200    | ~33 KB weekly, ~46 KB season, for 3 keys | 200–330 ms   |
| `readRoster`                    | `GET .../fantasy/v2/team/{team_key}/roster[;week={week}]?format=json`                                                                    | 200    | 107 KB NFL (15 players), 133 KB NHL (20) | 300+ ms      |

Confirmed live:

- `status=FA` returns only free agents, `status=W` only waiver players, and **omitting `status`**
  returns the whole player pool including rostered players. `status=A` means "all available"
  (free agents plus waivers), not all players; using it for an unfiltered search silently hides
  rostered players. Availability comes from `ownership.ownership_type`: `team`, `freeagents`, or
  `waivers`.
- `sort=NAME` works for both sports; `sort=R_PO` orders by percent ownership descending for both.
  `sort=PTS` is rejected for hockey (HTTP 400), so sport-specific sort codes are not assumed.
  `percent_owned` is present only for a subset of rows (20/25 free agents, 4/25 waiver rows in one
  sample), so an absent value is reported as missing, not zero.
- Weekly player statistics are **actual-only**. A completed prior week reported nonzero values
  (19/25 sampled players positive); the current week and the next week reported zero for every
  sampled player. Requesting `stats.type=projected`, `out=projection`, or `out=projected_stats`
  returns HTTP 400. No projected-statistics series is exposed through these reads, so projections
  remain typed unsupported rather than being inferred from zero-filled future weeks. Weekly hockey
  statistics were absent entirely in the samples; season statistics were present.
- A player's weekly series carries `player_stats.stats[]` (`stat_id`, numeric value) plus a
  coverage fragment (`coverage_type=week`, `week`); the dashed missing form is reported as null.
  Season coverage uses `season` instead of `week`.
- Scoreboards expose `scoreboard.week` and one entry per matchup group. Each matchup lists `week`,
  `status` (`preevent`/`midevent`/`postevent`-style labels), and two teams with `team_key`, `name`,
  and `team_points.total` as a formatted string. `team_projected_points` was present for NFL and
  absent for NHL. `;out=scoreboard` is rejected (HTTP 400).
- Transactions are ordered newest first and include `type` (`add`, `drop`, `add/drop` observed),
  `status`, epoch-second `timestamp`, and per-player `transaction_data` with movement `type` and
  `source_type`/`destination_type` in `{freeagents, waivers, team}` plus source/destination team
  key and name. No trade or commissioner transaction appeared in either league's recent history,
  so those player-level shapes stay unverified. Bounding with `;count=` is load-bearing: the
  unbounded league history was 179–539 KB. Restricting `;types=add,drop,trade` produced the same
  rows as the unfiltered sample, so filtering was not adopted.
- League team membership is a bounded `teams` collection with `team_key` and `name`; the league
  key is the prefix of each team key, as in discovery.
- NFL rosters are week-scoped (`coverage_type=week`). The inspected NHL league is **date-scoped**
  (`coverage_type=date`, `date`, per-player `selected_position.date`): requesting `;week=` did not
  convert it to weekly coverage. The adapter reports date coverage as a date and refuses to
  relabel it as a week.

### Payload processing defects found and fixed

- A one-entry nested collection such as `stat_position_types`, `team_logos`, or `managers` is a
  positional array of wrapper records, but the normalizer merged single-element arrays of records
  into one object. Real league settings then failed to decode. Collection fields now keep their
  ordered entries: an array of records merges into one resource only when its entries carry
  disjoint fields, the key does not name a plural collection, and known single-key wrappers are
  unwrapped first. Repeated fields stay ordered entries; a singular list of distinct fields
  describes one resource.
- A roster container mixes numeric player entries with coverage metadata (`coverage_type`, `week`
  or `date`, `is_prescoring`, `bye_week_sponsor`). It is not a pure count-keyed collection, so the
  normalizer exposed metadata next to numeric keys. Numeric entries are now separated into an
  `entries` array with metadata alongside, and the roster schema accepts week or date coverage.
- Category leagues omit `stat_modifiers` entirely; the adapter decodes that as an empty modifier
  list instead of rejecting the league. `stat_modifiers` only appears for points-based scoring.

Fixtures for each observed structure, without captured values, lock these rules in
`YahooJson.test.ts` and `YahooProvider.test.ts`.

### League-to-league variation across one account (2026-10-25)

Five teams in one account expose five different league-settings payloads. Structure-only capture
(field names, JSON types, cardinalities, empty placeholders; no values) found the differences that a
single-league fixture cannot cover:

- Head-to-head leagues publish `current_week`, `start_week`, `end_week`, and `matchup_week`; a
  rotisserie NHL league publishes none of them and additionally carries `password`,
  `short_invitation_url`, and a null `felo_tier`. Requiring the week window rejected that league's
  settings and, because every later read needed the settings, failed roster, calendar, matchup, and
  review-link reads for that team.
- `settings` is a positional fragment list whose length varies: one fragment for the NFL league, a
  `settings` fragment plus a `min_games_played`/`week_has_enough_qualifying_days` fragment for the
  head-to-head NHL leagues, and a second **empty list** placeholder for the rotisserie league.
- Cardinalities differ by league: 6, 9, 9, and 10 roster-position entries; 12, 12, 13, and 15 stat
  categories. Some leagues omit `max_adds`/`max_weekly_adds`; one publishes points-based
  `stat_modifiers` and the others omit it. Stat entries may carry `is_only_display_stat` at the
  stat level, inside `stat_position_type`, or not at all.
- `weekly_deadline` is an empty string on two leagues, and `num_teams` is a JSON number while
  `start_week`/`end_week`/`max_teams` are numeric strings.

The adapter therefore treats the week window as one optional unit — all three fields or none, with
a partially published window refused by field name — and the request decoder reports the failing
input path (for example `league.num_teams`) instead of an opaque invalid-response failure.

### Player statistics basis and dropped players

- Football exposes both bases: `stats.type=week&stats.week={week}` returns
  `player_stats` with `coverage_type=week`, and `stats.type=season` returns
  `coverage_type=season`. Hockey returns **no `player_stats` node at all** for a weekly request,
  and season totals for a season request. Weekly hockey statistics are not merely empty; the field
  is absent.
- Stat values arrive as numbers on a completed current week and as numeric strings or the dashed
  missing form on other reads; the adapter preserves missing as null.
- Season statistics cost roughly 44–45 KB for three player keys, so selected-player reads stay
  bounded at 25 keys.
- `league/{league_key}/players;player_keys=...` returns identity for players who are not on any
  roster (ownership `waivers` in the sample), so identity does not depend on roster membership.
- A rotation of NHL roster reads confirmed **every** inspected NHL roster is date-scoped, not just
  one league, and one team answered HTTP 400 for `;week=1` while its unqualified roster read
  succeeded. A rejected week selector is uncovered period coverage, not a provider outage.
- Transaction entries carry the dropped player's `name.full`, `display_position`, `position_type`,
  and `editorial_team_abbr` alongside `transaction_data`, but no `primary_position` or
  `eligible_positions`. That is enough to name the drop side of an add/drop without current roster
  membership.

### Still unverified or unsupported

- Projected player statistics: no read shape exposes them — `stats.type=projected`,
  `out=projection`, and `out=projected_stats` are rejected with HTTP 400, and current or future
  weekly reads report zeros rather than projections. The tool keeps a typed unsupported result
  with the provider reason.
- Trade and commissioner transaction player shapes; only add/drop was observed.
- League standings, diamond/premium statistics, and multi-week aggregation.
- All writes, crumb use, locks, and native start-active readback.

## Starter readiness observation

Read the local `rush-hour/docs/release-readiness.md`, dated 2026-10-22. It explicitly records a critical Solid Start RPC publication blocker in the installed dependency closure and an owner decision to wait for a coherent published upstream fix. It also retains other compatibility limitations. This is a local tracker observation, not a fresh independent advisory reproduction or a declaration about every current upstream release. Treat the baseline as not publication-ready until its documented gates and stable handoff are satisfied.

Read the starter deployment runbook: retained application data and protected Postgres-backed Alchemy state have different lifecycles and credentials. Do not copy its live Neon resource references. Its domain/testing guidance already requires batch-first services, Schema-defined lifecycle state, machine/codec exploration, generated sequences, and real-transport acceptance.

## Assignment and model-based testing research

Primary explanations inspected:

- https://developers.google.com/optimization/flow/assignment_min_cost_flow
- https://web.cs.dal.ca/~nzeh/Teaching/4113/book/matching/bipartite_matching_via_flows/maximum_weight_matching.html
- https://fast-check.dev/docs/advanced/model-based-testing/

Assignment/min-cost flow can represent legal player destinations, capacities, fixed assignments, and additive values. A generic mixed-integer/constraint runtime supports more coupled rules but is not necessary merely because a lineup contains FLEX positions.

The old Team implementation excludes BN from overfilled positions and separately sums standard-roster capacity. This suggests a pooled capacity distinction that must be verified against actual provider rules. Do not force negative-valued players into starters through a fictitious fixed bench cap. Min-cost flow is the leading formulation if those pools are required; Hungarian remains suitable only when the accepted model truly reduces to independent slots.

Candidate implementation sources inspected, not installed or benchmarked:

- https://github.com/havelessbemore/munkres/ — README advertises no runtime dependencies, TypeScript, rectangular assignment and bigint; Infinity is avoid-if-possible, not an absolute legal prohibition.
- https://github.com/Vages/min-cost-flow — README describes successive-shortest-path flow; exact arithmetic, negative costs, maintenance and semantics still need source/package evaluation.
- https://axelwickman.com/or-tools-wasm/network_flow_min_cost_flow.html — JS/WASM binding exists, but initialization/bundle cost and necessity are not established.

Use the starter's Effect-machine/Arbitrary test support first. Model-based test guidance explicitly warns against copying the real system into the model. Transition execution agreeing with its own definition does not establish that the domain rules are right; independent properties and tiny exhaustive oracles remain necessary.

## Hosting comparison

See [HOSTING.md](HOSTING.md) for current primary-source limits, illustrative workload calculations, and the proposed platform acceptance checks. Hosting is reopened by the user; the earlier GCP direction is not a final constraint.

## Alchemy GCP feasibility — documentation evidence

Inspected primary pages:

- https://alchemy.run/gcp/
- https://alchemy.run/blog/2026-09-29-beta-80/

Additional inspected starter facts: Cloud Run currently uses minimum one instance and `cpuIdle: false`; this is not the accepted scale-to-zero launch policy. Its Neon layer references an existing starter stack, which must not be reused as this independent product's data resource. The auth implementation provides email-code sign-in/automatic registration and optional Google, not email/password authentication. These findings shape the next decisions and must be rechecked at the stable-baseline handoff.

The GCP guide documents Effect-oriented Cloud Run runtimes, Cloud Scheduler, Pub/Sub, Cloud SQL, Secret Manager/KMS, and IAM bindings. It lists Cloud Run scale-to-zero and several website deployment paths. The release page documents GCP support and an Effect-version baseline.

This makes an Alchemy-managed GCP deployment plausible, not verified. Before recommending exact resources or installing anything, inspect the current starter dependency versions and published package/source contracts, especially Effect compatibility, the selected frontend's production build, private job invocation, Cloud Tasks support if selected, database cost, and remote infrastructure-state storage. Documentation examples show differing import conventions, so do not copy them as a compatibility guarantee.

No infrastructure was created or modified during this research.

## Live Yahoo analysis-surface verification (2026-10-25)

The owner authorized live reads on their own teams, and a disposable gitignored harness
(`.artifacts/live-capabilities/`) probed candidate endpoints for analysis capabilities, then ran
the committed `YahooProvider` through `PublicInternet` with the real transport to verify the
implemented reads. The `T`/`Y` cookies moved from browser memory to the harness over loopback and
were never printed, written, or committed. Retained evidence holds field names, JSON types,
cardinalities, byte sizes, timings, presence counts, and masked identifier patterns only. No write,
transaction, or premium action was attempted.

| Adapter operation                    | Request                                                                                                   | Status | Typical size | Typical time |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------ | ------------ | ------------ |
| `readStandings`                      | `GET .../league/{league_key}/standings?format=json`                                                       | 200    | 75–215 KB    | 230–370 ms   |
| `readMatchups` (football)            | `GET .../league/{league_key}/scoreboard;week={week}?format=json`                                          | 200    | 91–98 KB     | 220–310 ms   |
| `readMatchups` (hockey)              | same                                                                                                      | 200    | 134–181 KB   | 230–650 ms   |
| `searchPlayers` (`sort=AR`/`OR`)     | `GET .../players;status=FA;sort=AR;sort_type=season;count=10;out=ownership,percent_owned,percent_started` | 200    | 29–33 KB     | 190–340 ms   |
| `searchPlayers` (`sort={stat_id}`)   | same with a league stat id                                                                                | 200    | 28–31 KB     | 190–340 ms   |
| `searchPlayers` (`sort=PTS`, hockey) | same with `sort=PTS`                                                                                      | 400    | ~0.3 KB      | 160–220 ms   |
| `readTransactions` (team filter)     | `GET .../league/{league_key}/transactions;count=50;team_key={team_key}`                                   | 200    | 16–41 KB     | 160–240 ms   |

Confirmed live, through the adapter:

- **Standings are published for all five leagues**, including the rotisserie league, so an empty
  standings result is not a valid league state. Each team record carries `team_points` (season
  coverage), `team_standings`, and — for category and rotisserie leagues — `team_stats` season
  totals. Head-to-head leagues publish `team_standings.outcome_totals` (wins, losses, ties,
  percentage) and, in the points league, `streak`, `points_for`, and `points_against`. The
  rotisserie league publishes **no** `outcome_totals`: it reports `rank`, `points_back`,
  `points_change`, `points_for`, and per-category `team_points.stats` instead. `games_back` did not
  appear in any of the five leagues.
- **Completed and current matchups publish per-category values** (`team_stats` with week
  coverage) and `stat_winners` (`stat_id`, `winner_team_key`, occasionally `is_tied`) in category
  leagues. Football's points league publishes `team_projected_points` and `win_probability` but no
  category values.
- **`team_remaining_games` is a fantasy-team total of player-games for the scoring week**
  (`coverage_type`, `week`, `total.completed_games`, `total.live_games`, `total.remaining_games`).
  It is present for the requested week and the next week in every inspected hockey league
  (including a future week with zero completed games) and absent for football. The provider
  publishes no per-player or per-professional-team remaining-game count, so a player-level
  "games this week" cannot be derived from this read surface.
- **Projections and remaining-game blocks cover the requested week**: `team_projected_points.week`
  equalled the requested scoreboard week for weeks 6–9, and `team_remaining_games.week` did too.
  A fixture that assumed a different projection week was wrong and is corrected.
- **`percent_started` is a real `out=` value** alongside `percent_owned`; both carry
  `coverage_type` (`week` in football, `date` in hockey), a numeric value, and a `delta`. They are
  absent for some rows (8 of 10 football free agents carried a started value), so a missing signal
  is null, not zero. A Friday search returned `value: 0` for one player, proving zero is published.
- **Player search accepts provider sorts** `NAME`, `R_PO` (percent owned), `AR` (actual rank), `OR`
  (overall rank), and a numeric stat id from the league's categories, with `sort_type` season or
  week. `sort=PTS` is rejected with HTTP 400 for hockey; the adapter does not offer it. Every
  `sort_type=week` combination — rank or stat id — was also rejected with HTTP 400 for hockey while
  the same requests succeeded for football, so a weekly ranked sort is refused for hockey with the
  remedy rather than sent. Rankings are provider-derived, not local.
- **Transactions accept `team_key`** and the filtered response contains only that team's events
  (7 of 50 in football, 3 of 44 in hockey). `start` is a **pagination offset**, not a date: a large
  `start` returned an empty window, and offsets 1, 2, 50, and 100 returned successive slices. No
  documented or observed date filter exists, so date ranges are applied to the bounded window the
  provider returns.
- **Roster entries publish `editorial_team_abbr`** (with `editorial_team_key`, full name, and URL)
  for both sports; every inspected roster entry carried it. Football also publishes `bye_weeks`;
  current hockey rosters do not.

Still unsupported after this verification:

- Per-player or per-professional-team games remaining this week or next, and probable-starter
  flags: no read shape exposes either. `get_matchups` reports the fantasy-team remaining-game
  total where the provider publishes it, and football omits it rather than pretending every player
  has one game left.
- A provider-side transaction date filter. A range older than the fetched window is reported as
  truncated rather than presented as complete.
- A points-total search sort for hockey (`sort=PTS` is rejected); `actual_rank`, `overall_rank`, and
  a league stat id are available instead.

### Payload processing notes

- Standings arrive as `league: [attributes, { standings: { 0: { teams: { <n>: { team: [...] } } } } }]`.
  Each `team` is a positional fragment list holding attributes, `team_points`, and
  `team_standings`/`team_stats`; the existing normalizer flattens it into one record with those
  fields, which the new schema decodes directly.
- `team_points.total` is a formatted string in every league (`"1583.16"`, `"48"`), and
  rotisserie `team_points.stats[].stat.value` can be an empty string; values are parsed by the same
  permissive numeric helper that preserves missing as null.
- `stat_winners` entries omit `winner_team_key` when `is_tied` is set; the adapter reports the
  marker instead of inventing a winner.
- Fixtures for the new resources were added for three standings variants (head-to-head points,
  head-to-head categories, rotisserie), a hockey scoreboard with remaining games and category
  winners, and player ownership/started signals. The football scoreboard fixture was corrected to
  omit the remaining-games block the live provider does not publish.

## Live Yahoo league-scoring evidence (2026-10-26)

The owner authorized read-only access to their own linked account. A disposable gitignored harness
(`.artifacts/phase2-evidence/`) read the stored provider credential, decrypted it with the
application's own credential service, and called the committed `YahooProvider` through
`PublicInternet` with the real transport. Basis probes the adapter cannot express (weekly hockey,
date coverage, projections) were issued to the same read origin through the same transport with the
adapter's own request shape. No key, cookie, crumb, name, team key, league id, or manager identity
was printed, written, or committed; retained evidence holds request shapes, status codes, byte
sizes, counts, JSON types, and stat ids only. No write, transaction, or premium action was attempted.
Five leagues answered: one football points league and four hockey leagues (three head-to-head
category leagues and one rotisserie league).

### 1. Football player statistics, both bases

| Basis                          | Status | Coverage | Players with a stats node | Distinct stat ids    | Values per player | Value forms               |
| ------------------------------ | ------ | -------- | ------------------------- | -------------------- | ----------------- | ------------------------- |
| `stats.type=season`            | 200    | `season` | 15/15                     | 36 (the league's 36) | 6–16              | plain integers            |
| `stats.type=week&stats.week=6` | 200    | `week`   | 15/15                     | 36                   | 6–16              | integers, no nulls        |
| `stats.type=week&stats.week=7` | 200    | `week`   | 15/15                     | 36                   | 6–16              | integers for played games |

Football therefore exposes both bases, densely. A player's series contains only the stats that
apply to that player (a kicker returned six ids, a defence sixteen, offensive players fourteen), and
no value in any sampled week was the dashed missing form. Week coverage for the _current_ week
carries values for games already played, so a current-week total is a partial week, not a forecast.

The adapter's own basis rule — weekly only when the requested week is earlier than the league's
`current_week`, otherwise season — was confirmed to send the request it claims to send. The policy
never needs the current week's basis: it values a period from earlier completed periods.

### 2. Hockey player statistics, both bases

| Basis                                   | Status | Coverage | Players with a stats node  | Distinct stat ids   | Values per player | Value forms                    |
| --------------------------------------- | ------ | -------- | -------------------------- | ------------------- | ----------------- | ------------------------------ |
| `stats.type=season`                     | 200    | `season` | 21/21, 19/19, 22/22, 21/21 | 12, 12, 13, 15      | 5–8               | integers, decimals, some nulls |
| `stats.type=week&stats.week=5`          | 200    | absent   | **0/21, 0/19, 0/21**       | none                | none              | none                           |
| `stats.type=date&stats.date=2026-10-26` | 200    | `date`   | every player               | the same league ids | 5–8               | the dashed missing form only   |

Weekly hockey is not empty: the `player_stats` node is absent entirely for every player, in every
probed league. Date coverage works and mirrors season coverage per player. A date whose games have
not been played returns every value as the dashed missing form, which the adapter decodes as null —
so a future or in-progress date is _unknown_, never zero. Hockey also publishes real nulls inside a
completed series (7 of 113 values in one league were the ratio stats GAA and SV% with no games), so
"scored but unknown" is an observed hockey state, not a hypothetical one.

### 3. Modifier coverage against the stat ids players actually return

| League     | Categories | Modifiers | Returned ids | Returned with a modifier | Returned without | Modifiers with no returned stat |
| ---------- | ---------: | --------: | -----------: | -----------------------: | ---------------: | ------------------------------: |
| football-1 |         36 |        33 |           36 |                       33 |        8, 31, 78 |                               0 |
| hockey-1   |         12 |         0 |           12 |                        0 |        all of 12 |                               0 |
| hockey-2   |         12 |         0 |           12 |                        0 |        all of 12 |                               0 |
| hockey-3   |         13 |         0 |           13 |                        0 |        all of 13 |                               0 |
| hockey-4   |         15 |         0 |           15 |                        0 |        all of 15 |                               0 |

The football ids without a modifier are Rushing Attempts (`8`), Points Allowed (`31`), and Targets
(`78`); all three are declared categories that the league's own points rules do not score. Every
football modifier maps to a stat its players return, so no rule is unused.

The four hockey leagues publish **no `stat_modifiers` key at all**. Checked on the raw settings body,
not only through the adapter: the literal key occurs zero times on each hockey league and once on the
football league with 33 stat entries. Category and rotisserie leagues therefore have no additive
points rules to apply — a fact about the league format, not a missing read.

### 4. Modifier magnitudes

Quoted shapes from the football league's 33 modifiers:

- Non-negative decimals: `0.04`, `0.1` (3 rules).
- Non-negative integers: `0`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `10` (26 rules), including one
  literal `0` for Points Allowed 21-27.
- Negative integers: `-1`, `-2`, `-4` (4 rules).
- Largest magnitude is `10`; there is no exponent form, no leading `+`, no thousands separator, and
  no value with more than two fractional digits.

### 5. Games played

There is no games-played stat id to use. None of the five leagues declares a games-played category
(the football league's 36 categories are passing, rushing, receiving, return, kicking, and defensive
stats; the hockey leagues' 12–15 are goals, assists, points, plus/minus, powerplay points, shots,
hits, blocks, wins, goals against, goals against average, saves, shots against, save percentage, and
shutouts), and the stat ids players return are exactly those categories. A season total cannot
therefore be converted into a per-game rate from this read surface, and the policy does not pretend
to one.

### 6. Projections

Absent. `stats.type=projected` and `stats.type=projected&stats.week=N` both answer HTTP 400 on all
five leagues, and the adapter keeps `projected: undefined` for every player. The earlier finding is
unchanged, so selection values stay trailing and actual.

### The scoring rule the provider itself applies

For football weeks 4, 5, and 6, the sum of `stat value × modifier` over the stats each **starting**
player's series contained reproduced the provider's own `team_points.total` exactly:

| Week | Computed from starter series | Provider `team_points.total` | Difference |
| ---- | ---------------------------: | ---------------------------: | ---------: |
| 4    |                       109.14 |                       109.14 |          0 |
| 5    |                       144.60 |                       144.60 |          0 |
| 6    |                        98.02 |                        98.02 |          0 |

That identity is the evidence for two rules: a modifier applies per stat, and a scored stat absent
from a player's series contributes nothing. Bench players summed to 49.20 in week 6 and were correctly
excluded from the team total. One hand-checkable row: the week-6 quarterback scored
`253 × 0.04 + 2 × 4 + 1 × -1 + (-1) × 0.1 = 17.02`.

### Roster and slot facts used by the policy

- Declared roster positions carry a name, a count, and `is_starting_position`. The football league
  declares `QB 1, RB 2, WR 2, TE 1, W/R/T 1, K 1, DEF 1, BN 6, IR 1`; the hockey leagues declare
  between 6 and 10 entries including `BN`, `IR`, `IR+`, and `NA`, and flex names `F`, `W`, and
  `Util`. One hockey league declares 21 total slots for a 21-player roster, so capacity is exactly
  binding there.
- A roster player's `eligible_positions` contains the **slot names** that player may occupy, not only
  professional positions: `["QB"]`, `["RB","W/R/T"]`, `["C","LW","Util"]`, `["LW","RW","W","Util","IR","IR+"]`,
  `["G","IR","IR+"]`, `["DEF"]`. `BN` never appears, so bench space is open to every player. This is
  the published eligibility rule the policy uses instead of inferring slot semantics.
- `is_editable` was `false` for 13 of 15 football roster members after that week's games had started,
  and `true` for every hockey player before that day's games. It is a per-player editability flag, and
  the policy treats anything other than `true` as locked.
- Football roster entries publish `bye_weeks.week`; hockey roster entries publish no bye week, which
  matches its date-scoped schedule.
- Observed `status` codes across the roster reads: absent (field omitted), `IR`, `O`, `DTD`, and
  `IR-LT`. No other code appeared, so the adapter's one mapping table carries only those rows; any
  other code is recorded as unrecognised and treated as doubtful rather than guessed at, and it never
  refuses a lineup run. [The policy](POLICY.md#an-unrecognised-status-is-doubtful-and-it-is-recorded)
  owns that decision and its cost.

### Still unverified after this pass

- Every write path, including native start-active and explicit assignment requests. The native
  writes were verified later on 2026-10-25 and explicit assignments on 2026-10-26; see the two write
  sections below.
- Whether Yahoo accepts a starting slot left empty, and whether the declared bench count is a hard
  maximum rather than a pooled standard-roster allowance.
- Lock transitions inside a scoring day for date-scoped hockey leagues.
- Any per-player remaining-games or probable-starter signal. Projections and started percentages are
  covered by [the probes below](#live-yahoo-started-percentage-and-projection-probes-2026-10-26).

## Live Yahoo started-percentage and projection probes (2026-10-26)

Same authorization, harness, and privacy rules as the section above: a disposable gitignored harness
(`.artifacts/phase2-evidence/`) decrypted the stored credential with the application's own credential
service and issued read-only requests to the committed read origin through `PublicInternet`. Retained
evidence is request shapes, status codes, byte sizes, presence counts, JSON key paths, value kinds,
and value ranges. No token, crumb, player name, player key, team key, or league id was printed or
committed. No write was attempted.

The questions were whether the player-detail read can carry a started percentage and a diamond cut,
whether `ranks` exposes projected points, how these behave for a category-scored hockey league, what
`starting_status` returns, and what a partly unavailable response does to the whole body.

### 1. A started percentage can be added to the player-detail read

`GET .../league/{league_key}/players;player_keys={keys};out=stats,ownership,percent_started` with
`percent_started.cut_types=diamond` answers 200 for all five leagues and adds about 7 KB per 12-player
sample without a cut, and about 19 KB with one cut (football 264 KB → 271 KB → 283 KB, hockey
209 KB → 216 KB → 229 KB). After the adapter's normalizer
the node is one object:

| Path                                          | Type         | Presence in 12-player samples                     |
| --------------------------------------------- | ------------ | ------------------------------------------------- |
| `percent_started.coverage_type`               | string       | 12/12                                             |
| `percent_started.week` / `.date`              | integer/date | 12/12                                             |
| `percent_started.value`                       | integer      | 12/12                                             |
| `percent_started.delta`                       | integer      | 12/12 in the samples; 12/15–21/21 on full rosters |
| `percent_started.percent_started_cut_types[]` | array        | 12/12 when a cut is requested, 0/12 otherwise     |
| `percent_started_cut_types[].cut_type`        | string       | as requested                                      |
| `percent_started_cut_types[].value`           | integer      | as requested                                      |

The provider publishes `coverage_type` `week` for the football league (the league's current week)
and `date` for all four hockey leagues (the provider's current fantasy day), and both matched the
roster read's own coverage in every league. **The coverage cannot be steered by query parameters**:
`stats.type=date&stats.date={tomorrow}`, `stats.type=week&stats.week={current+1}`, bare `date=` and
bare `week=` all returned the provider's current period unchanged. In the same response
`percent_owned` carried `week` coverage even in the date-scoped hockey leagues, so owned percentage
is not a per-date signal there.

### 2. A cut is a distinct field, and the request literal is echoed unvalidated

A cut is not a sibling of `percent_started`; it is a fourth positional fragment inside it:
`percent_started[3] = { percent_started_cut_types: [ { percent_started_cut_type: [ {coverage}, {cut_type}, {value} ] } ] }`.
The overall percentage is `percent_started.value`; a cut percentage is
the nested `cut_type`/`value` pair, with its own `coverage_type`.

| Requested `cut_types` | Cut entries returned | Literal returned  | Distinct values across the roster         |
| --------------------- | -------------------: | ----------------- | ----------------------------------------- |
| `diamond`             |                    1 | `diamond`         | **1** — every value was `0` (5/5 leagues) |
| `diamond,gold`        |                    2 | `diamond`, `gold` | diamond 1, gold 12–20                     |
| `platinum`            |                    1 | `platinum`        | 13–19                                     |
| none                  |                    0 | —                 | —                                         |

So the literal is whatever was asked for: Yahoo does not reject or validate a cut name, and it does
not substitute a known name. **The diamond cut is published but unpopulated for this account**: 13–22
entries per league, all `0`, while the overall percentage in the same league had 15–20 distinct
non-zero values (`1`–`98`). `gold` and even the unlisted `platinum` carried discriminating values.
A cut therefore cannot be assumed to carry information just because the container came back, and a
cut value of `0` is not distinguishable from an unpopulated cut by inspection of one player alone.

### 3. `ranks` publishes ranks, and nothing publishes projected points

`out=ranks;ranks=last30days,last14days,projected_next7days,projected_season_remaining,last4weeks,projected_week,projected_next4weeks`
answers 200 for the football **and** the hockey leagues, 7 rank entries per player, each
`player_rank.rank_type` from `L30, L14, PS7, PSR, L4W, PW, PN4W` and each `rank_value` a **string
integer**. Values across 12-player samples ranged 1–859 depending on the rank type: they are ordinal
ranks, not point totals. The four `projected` names (`PS7`, `PSR`, `PW`, `PN4W`) are rank types; no
response contained a projected quantity.

Confirmed negative evidence for player-level projections:

- A recursive scan for keys matching `project` over `out=stats,ownership,percent_started,percent_owned,ranks,opponent,starting_status`
  returned no path on any of the five leagues.
- `out=stats,player_points` and `out=stats,projected_points` answer 400 (these are not `out` members).
- `stats.type=projected` and `stats.type=projected&stats.week=N` answer 400 (unchanged from the
  earlier pass).
- `player_points` does come back with `out=stats` **in the football league** (the provider's own
  realised league-scored total, alongside the stat series), and is absent in all four hockey leagues,
  which have no modifiers to score. There is no projected sibling of it.

`ranks` does degrade silently when asked for something it does not know: `ranks=notaranktype` answers
200 with the default rank types `OR` and `S` instead of an error, while `ranks=last4weeks,projected_week`
returns exactly those two.

### 4. Hockey roster players do carry a started percentage

| League     | Roster | `percent_started` node | Numeric `value` | Non-numeric `value` | Value range | `delta` present |
| ---------- | -----: | ---------------------: | --------------: | ------------------: | ----------- | --------------: |
| football-1 |     15 |                  15/15 |              15 |                   0 | 1–98        |           12/15 |
| hockey-1   |     21 |                  21/21 |              21 |                   0 | 4–88        |           21/21 |
| hockey-2   |     19 |                  19/19 |              18 |                   1 | 9–96        |           17/19 |
| hockey-3   |     22 |                  22/22 |              22 |                   0 | 3–89        |           17/22 |
| hockey-4   |     21 |                  21/21 |              21 |                   0 | 1–97        |           20/21 |

The one non-numeric case is a player in an `IR+` slot carrying `IR-LT`, whose `percent_started`
fragment had the coverage fragment but **no `value` fragment**. Its cut container likewise carried no
value. So a missing started percentage appears as _an absent fragment inside a present node_, not as
the key being absent, not as `null`, and not as an empty array. A few players also lack `delta` while
carrying a `value`, so `delta` is context and never required.

### 5. `starting_status` is goalie-only, and `opponent` means "has a game today"

Both answer 200 for football and hockey and are absent or null for most rows, which is a fact about
who the field applies to rather than a missing read.

`starting_status` appeared on **exactly one player** across the five rosters: a hockey goalie whose
team played that day, as `starting_status.is_starting: 0` — a **number**, not a string. No skater in
any league carried the key, no football player did, and a goalie whose team had no game that day did
not carry it either. It is the real-world starting status of a goalie (or pitcher), published around
game time, not a fantasy-lineup fact, and it is absent for everyone else. It can therefore never be a
value basis for a skater.

`opponent` is present as a string exactly for players whose team has a game on the read's date:
hockey 0/21, 3/19, 4/22, and 4/21 roster players in the four leagues, every sampled football player
15/15 (a scoring week always has a game), and `null` for everyone else. AutoCoach reads the same field
as `is_playing` and treats an absent or `Bye` opponent as not playing. That is a **has-a-game**
availability fact, which this adapter does not yet read.

| League     | Roster | `opponent` string | Goalie `starting_status` |
| ---------- | -----: | ----------------: | ------------------------ |
| football-1 |     15 |             15/15 | —                        |
| hockey-1   |     21 |              0/21 | 0/4                      |
| hockey-2   |     19 |              3/19 | 1/4                      |
| hockey-3   |     22 |              4/22 | 0/4                      |
| hockey-4   |     21 |              4/21 | 0/3                      |

### 6. Sub-resources fail per request member and degrade silently per value

| Request                                      | Status | Effect on the body                                    |
| -------------------------------------------- | ------ | ----------------------------------------------------- |
| `out=stats,ownership,notasubresource`        | 400    | Whole request fails with an error envelope, 0 players |
| `out=starting_status` (goalie/pitcher field) | 200    | Key omitted for every non-goalie; no error            |
| `ranks=notaranktype`                         | 200    | Default `OR`/`S` ranks instead of the request         |
| `percent_started.cut_types=platinum`         | 200    | Cut echoed, no validation                             |
| `stats.type=projected`                       | 400    | Whole request fails                                   |

An unknown **request member** is a hard failure. An unpopulated sub-resource, an unknown rank type,
and an unknown cut name all degrade silently inside a 200 body. Absence therefore cannot be detected
from the response alone: the adapter has to ask for what it needs, assert the shape it depends on, and
treat a value that stops arriving as a finding rather than as a normal empty state.

### Value-source resolution across the linked account (2026-10-26)

Read-only, same harness and privacy rules, no write attempted. For each league the committed adapter
read only what the resolved source needs — four completed weeks of statistics for a league that
publishes points rules, the target-period player detail read for a league that does not — and the
committed policy planned the lineup from that one source.

| League          | Format     | Modifiers | Source resolved | Basis                                                | Plan                            |
| --------------- | ---------- | --------: | --------------- | ---------------------------------------------------- | ------------------------------- |
| football-1 (15) | head       |        33 | scoring rules   | `mean-points-per-period:week:3,week:4,week:5,week:6` | planned, 9/9 slots, 0 changes   |
| hockey-1 (21)   | head       |         0 | started percent | `percent-started:overall:date:2026-10-26`            | planned, 12/12 slots, 6 changes |
| hockey-2 (19)   | head       |         0 | started percent | `percent-started:overall:date:2026-10-26`            | planned, 15/15 slots, 3 changes |
| hockey-3 (22)   | rotisserie |         0 | started percent | `percent-started:overall:date:2026-10-26`            | planned, 15/15 slots, 5 changes |
| hockey-4 (21)   | head       |         0 | started percent | `percent-started:overall:date:2026-10-26`            | planned, 15/15 slots, 2 changes |

The football plan is the roster the provider had already locked; it reports the same total the
recorded worked example does. Every hockey league resolved to the overall started percentage because
the diamond cut was `0` for every roster player again. The 19-player league is the one whose roster
holds the injured-reserve goaltender with no published started percentage: that player has no value
and is parked on the reserve list, so the other eighteen players price the plan.

For the 21-player category league the plan's six changes were: two centre slots swapping a bench
centre ahead of a starter, one left winger moving into a right wing slot ahead of a less-started
winger, one defenceman replacing a less-started defenceman, and the bench movements those create.
All twelve starting players were `will-play`, and every change moved a higher started percentage into
a starting slot at a position the player is eligible for. The reported value term was 758.00 — the
sum of twelve started percentages, in hundredths of a percent — over a roster whose percentages
ranged 4–88 with 18 distinct values.

Two limits are visible in that plan rather than inferred:

- **Goaltenders.** The two starting goalies in that plan were started by the crowd at different rates
  (one below 20 %). Percent started cannot distinguish a confirmed starter from a backup, and the
  provider does publish `starting_status` for a goalie whose team plays that day (section 5 above).
  Reading it is the next real improvement to goaltender selection.
- **Format.** A rotisserie league is decided by season-relative category standing, so a daily lineup
  ordered by today's crowd starts is a popularity ordering rather than a Roto strategy. The basis
  string says so; nothing pretends the number is a category projection.

Neither `opponent` (has a game today) nor `starting_status` (goalie confirmed starter) is read by the
adapter yet. Both are availability facts, not value bases: they would refine the availability tier,
not the value.

### Reporting a response that changed shape

An optional sub-resource can degrade silently — `out=percent_started` still answers 200 for a player
whose node is empty — so the adapter cannot treat every gap as a failure. It asserts the shapes it
actually consumes and names the JSON path that failed (`league.stat_modifiers`, `percent_started.value`,
`percent_started.percent_started_cut_types.0.value`), and the failure travels as one typed error rather
than as an empty value. Three signals come out of one mismatch:

1. The span carries `provider.schema_mismatch` and `provider.schema_field` with the failing path.
2. A warning is logged through the tracer logger, which attaches it to the current span as an event,
   so it travels on the OTLP trace pipeline the provider spans already use. This works from the
   hourly worker, which has no request to log against.
3. The lineup run fails with `provider_shape_changed` and a summary naming the operation and path. It
   is not retried: a decoder that no longer matches the published shape cannot be fixed by asking
   again, and the team keeps its native action. No write is attempted.

Unparsable started percentages go through the same path. An absent started percentage stays a normal
absence and parks the player; only a present value the decoder cannot read is a shape change.

## Live Yahoo projection probes (2026-11-03)

Read-only, through the same loopback harness and the committed read origin, no write attempted. The
question was whether Yahoo publishes a projection for the period being set, for football and for
hockey, before the lineup policy could depend on one. League keys, player keys, and non-public names
are not retained; the figures below are request shapes, status codes, key paths, counts, and the two
players the owner named.

### No projected statistics, in either sport

| Request, three roster players                                                                        | Status                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| `...players;player_keys=...;out=stats,ownership&stats.type=projected`                                | 400                            |
| `...&stats.type=projected&stats.week=9` (football)                                                   | 400                            |
| `...&stats.type=projected&stats.date=2026-11-03` (hockey)                                            | 400                            |
| `...players;player_keys=...;out=stats,ownership,projection`                                          | 400                            |
| `...out=stats,ownership,projected_stats`                                                             | 400                            |
| `...out=stats,projected_points`                                                                      | 400                            |
| `...out=stats,ownership,percent_started,percent_owned,ranks,opponent,starting_status,draft_analysis` | 200, 0 keys matching `project` |

A future football week is zero-filled, not projected: `stats.type=week&stats.week=9` (current) and
`week=10` each returned 70 stat values across five players with none nonzero, while `week=8` returned
23 nonzero. The only `project` key anywhere was `team_projected_points` on the football scoreboard, a
team total rather than a player one.

### The projected rank exists, and it is league-scoped

`out=ranks` with all seven rank names, for every roster player:

| Sport                             | Numeric ranks              | Dash, meaning not published |
| --------------------------------- | -------------------------- | --------------------------- |
| Football, 15 players              | `PW`, `PN4W`, `PSR`, `L4W` | `L30`, `L14`, `PS7`         |
| Hockey, 21 players in two leagues | `L30`, `L14`, `PS7`, `PSR` | `PW`, `PN4W`, `L4W`         |

`sort=PR;sort_type=week` ordered the football pool strictly by ascending `PW` (1 through 10), so `PR`
is the projected rank and `PW` is its week basis. Five players appeared in two hockey leagues and all
five carried different `PS7`, `PSR`, `L30`, and `L14` values in each, so ranks are league-scoped rather
than global.

Hockey therefore has no projection for a single date: `PW` is not published, and `PS7` covers seven
days.

### The flex case that prompted the change

Football, Irish Lax, `$G-Money$`, week 9, two players eligible for the flex slot:

| Player        | Slot  | `PW` | Started % | Platinum % | Weeks 5 to 8 league points |
| ------------- | ----- | ---: | --------: | ---------: | -------------------------- |
| Khalil Shakir | W/R/T |  124 |        21 |          6 | 11.00, 13.40, bye, 11.40   |
| Chris Olave   | BN    |   48 |        52 |         25 | 8.60, 14.30, 11.60, bye    |

The retired four-period mean, applied as the adapter applied it, started Shakir at 11.93 against
Olave's 11.50. Both players had a bye inside the window, on different weeks, which is the owner's
diagnosis of the case. `PW` and the started percentage both put Olave ahead.

The weekly `player_points.total` figures used above were checked against the league's 33 modifiers: for
four sampled player weeks the sum of `stat value x modifier` reproduced the published total exactly
(20.40, 24.00, 28.18, 21.00).

### Second pass: the API has no projected stat type

The owner asked whether projected points might exist behind a shape the first pass missed. They do not,
and the second pass names the reason:

- `stats.type=projected`, `stats.type=projections`, and `stats.type=proj` answer HTTP 400 with
  `"Invalid type <type> specified in the URI."` while `stats.type=lastweek` answers 200. The type is
  not a value the endpoint knows, which is why no shape can read a projected series. The documented
  valid types are `season`, `average_season`, `lastweek`, `lastmonth`, `date`, and `week`.
- `out=projection`, `out=projected`, `out=stats,projected`, and `out=stats,projected_points` answer
  HTTP 400 with `"Invalid player resource <name> requested."`
- The `fantasysports.yahoo.com` origin, with the same stored cookie, answers 302 to an error page for
  every path tried, including a valid `stats.type=week` read, so it is not a second read surface.
- The football scoreboard's `team_projected_points` is
  `{"coverage_type":"week","week":"9","total":"104.27"}`, a team total with no player breakdown, and
  it is the only projection-shaped key in the body.

### The projected rank is overall, and its low ranks mean unavailable

`PW` is one overall rank across the player pool, not a rank within a position. The top 50 by
`sort=PR;sort_type=week` carried distinct `PW` values 1 through 50, and across 184 rostered football
players the best `PW` per primary position was QB 5, RB 1, WR 2, TE 35, K 113, DEF 147. A per-position
rank would start every position at 1.

That matters for the reference's Taysom Hill case. AutoCoach scored NFL players as
`(percent_started / ranks.projectedWeek) * 100`, and its own fixture records Taysom Hill at
`projectedWeek` 1929 against `next4Weeks` 157 and `restOfSeason` 158 with 8 % of leagues starting him.
The reference's TODO beside that line asks whether the rank already includes injury, because its injury
factor then counted the same fact again.

A fresh scan of the linked account on 2026-11-03 shows what the extreme low ranks are. Of 184 rostered
football players, 166 were available, and every player started by at least 20 % of leagues with a `PW`
over 400 was out or on bye (`PW` 604 to 1057). No available player started by 20 % or more had a `PW`
over 300, and no roster player was missing `PW`. Percent started did not reflect those absences: a
defence on bye in week 9 was still started in 76 % of leagues.

So the one-week rank already encodes availability, and the availability tier decides those players
before value. The Taysom failure was a one-week rank far below its longer window for a player the crowd
also barely started, not a position-rank mix-up: `PW` is a single order, so a dual-eligible player's one
rank is comparable in every slot he is eligible for.

### Hockey's seven-day rank covers a window, not a date

The only hockey projection is `PS7`, the projected rank for the next seven days. It is not a date
projection, and the difference shows inside one league on 2026-11-03:

- Trevor Connelly carried `PS7` 5 with `PSR` 662 while 7 % of leagues started him.
- Jakob Chychrun carried `PS7` 270 with `PSR` 57 while 97 % of leagues started him.
- Brady Tkachuk carried `PS7` 12 with no game that night, and Rasmus Dahlin carried `PS7` 47 with no
  game, because a seven-day window does not follow the date.
- On one roster Connor Hellebuyck (`PS7` 23) and Joel Hofer (`PS7` 32) both had a game, and the rank
  did not say which one would start in goal.

The gap tracks the games each team plays in the window, so a player with four games can outrank a
better player with two. Across four hockey leagues the started percentage and `PS7` agree closely in
three (Spearman 0.55, 0.63, 0.86 on the healthy players with a game) and diverge in the fourth (0.18)
around the Connelly outlier. A date has no projection, so the date's started percentage decides, and
the availability tier handles byes and confirmed goalie starts. The reference drew the same line: its
daily NHL score used percent started and percent owned with a starting-goalie factor, while its
weekly-deadline score used `100 / next7Days`. A weekly hockey league would therefore have a matching
window, but a date does not.

## Live projected-rank delivery evidence (2026-11-03)

Read-only, through the committed adapter with the real transport and the owner's stored session; no
cookie, player name, or team key was retained.

**The scheduled runs.** The football team in the weekly head-to-head points league `470.l.70271`
planned at 21:55 and 22:55 UTC from `yahoo/percent started for week 9 (platinum cut)`. Both runs used
the current target, the league published `current_week` 9, and the roster was scoped to week 9
throughout, so the projection guard (`periodWindow.current` equals the target week) held: both values
were 9. The guard did not cause the fallback.

**What the provider publishes.** The player-details read for all fifteen roster players, with all
seven rank names requested, returned every name: `L30`, `L14`, and `PS7` as a dash (not published for
football), and `PSR`, `L4W`, `PW`, and `PN4W` as numeric ranks for all fifteen. A published entry:

```json
{ "player_ranks": [{ "rank_type": "PW", "rank_value": "44", "rank_week": "9" }] }
```

`PW` therefore exists for the target week. No projected statistics exist: `stats.type=projected`,
`stats.type=projections`, `out=projection`, `out=stats,projected`, and `out=stats,projected_points`
each answered HTTP 400, so the rank is the only projection and cannot be re-scored with the league's
modifiers.

**Why the adapter did not see it.** The adapter sent the rank list as a query value built by
`URLSearchParams`, which percent-encodes the commas. Yahoo splits the list on literal commas and does
not decode them, so it silently answers 200 with its default `OR` and `S` ranks. The same request
with three roster players, measured both ways:

| Rank list as sent              | Status | Rank types returned                             |
| ------------------------------ | ------ | ----------------------------------------------- |
| literal commas                 | 200    | `L30`, `L14`, `PS7`, `PSR`, `L4W`, `PW`, `PN4W` |
| percent-encoded commas (`%2C`) | 200    | `OR` and `S` only, the default ranks            |

The fifteen-player roster request returned `OR` 15 and `S` 45 for exactly this reason: `PW` was never
in the payload, the projection source was empty, and the ladder fell to the started percentage. The
same substitution also starved the ownership composite, whose rank score found only unweighted
`OR`/`S` entries and contributed zero. Sending the list in the path (`;ranks=last30days,...`) returns
the requested names for football and hockey alike.

After the request moved into the path, the committed adapter priced the same football team from
`yahoo/projected rank for week 9` with all fifteen players valued, and a live hockey date from
`yahoo/percent started for 2026-11-03 (platinum managers only)` with 20 of 21 players valued (the
injured-reserve goalie has no published started percentage). The adapter reads no `rank_week` tag;
the rung stays tied to the league's current scoring week.

## Live Yahoo native write verification (2026-10-25)

The owner authorized one native `set_lineup` run on their own football team and a date-scoped native
write on one of their own hockey teams. Both used the stored provider session and the committed
adapter through `PublicInternet` with the real transport; no cookie, crumb, team key, player name, or
provider body was printed, written, or committed.

- **Football.** The first committed shape addressed the read-only origin, placed the coverage
  selector in the path, and sent an undocumented `roster_action` element; the provider rejected it
  with no change. The corrected request is a `PUT` to the read-write origin's
  `/fantasy/v2/team/{team_key}/roster?format=json_f&crumb={crumb}` with
  `content-type: application/xml` and a body of
  `<fantasy_content><roster><coverage_type>week</coverage_type><week>{week}</week><action>start_active_players</action></roster></fantasy_content>`.
  The corrected run completed as a verified `no_op` in 1,583 ms with 0 changes, 2 locked and 13
  editable players; a direct corrected request returned HTTP 200 with a `status: success` envelope.
  Full counts and timings are in [the Phase 1 acceptance record](../phase-1-acceptance-2026-10-25.md#native-set_lineup).
- **Hockey, date coverage.** A `PUT` to the same endpoint with
  `<coverage_type>date</coverage_type><date>{date}</date><action>start_active_players</action>`
  was accepted. The readback kept the same date coverage and membership, reported 0 changed slots,
  and showed 5 locked and 15 editable players. The disposable harness recorded only outcome tags
  and counts in gitignored `.artifacts/live-yahoo/evidence-date-write.json`.

This establishes the read-write origin, crumb use, coverage selectors, and native action body, but
not a changed native action, an explicit assignment, or an uncertain-response reconciliation live.

## Live Yahoo explicit assignment write verification (2026-10-26)

The owner authorized read-only access plus one minimal real write on their own football team. A
disposable gitignored harness (`.artifacts/phase2-evidence/explicit-write.ts`) decrypted the stored
provider credential with the application's own credential service and called the committed
`YahooProvider` through `PublicInternet` with the real transport. It read the league settings, the
current roster, and weeks 3–6 of player statistics, planned week 7 with the committed policy and
solver, translated the plan, sent the one write, and read the roster back. Retained evidence holds
counts, slot names, status tags, and request shapes only; no key, cookie, crumb, name, team key,
league id, or provider body is recorded here.

### Request shape

```text
PUT https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/team/{team_key}/roster?format=json_f&crumb={crumb}
accept: application/json
content-type: application/xml
cookie: {session}

<?xml version="1.0" encoding="UTF-8"?>
<fantasy_content>
  <roster>
    <coverage_type>week</coverage_type>
    <week>7</week>
    <players>
      <player>
        <player_key>{player_key}</player_key>
        <position>BN</position>
      </player>
    </players>
  </roster>
</fantasy_content>
```

This is Yahoo's documented roster edit shape for the API origin, reached through the read-write
frontend origin the native action already uses. The `players` collection carries one entry per
changed assignment; no `add`, `drop`, `trade`, or `action` element is present. The live probe sent a
single assignment for an editable bench player to the bench position they already occupied, so the
lineup could not change even if the request were misinterpreted.

Official documentation states the partial-update rule: players whose position is not changed keep
their previous position, and an invalid move returns an error with no changes made. That is the
basis for sending only changed assignments rather than every roster member; the live readback
tested it with 14 unmentioned players.

### Observed outcome

| Observation            | Result                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| Target period          | Week 7, weekly roster coverage                                        |
| Window and basis       | Weeks 3–6, `yahoo:mean-points-per-period:week:3,week:4,week:5,week:6` |
| Roster                 | 15 players, 13 locked, 2 editable                                     |
| Plan                   | Zero changes; filled 9/9 required starting positions                  |
| Translation            | `no_op`; no changed editable assignment exists                        |
| Write                  | One no-op explicit assignment, accepted (HTTP 2xx)                    |
| Readback coverage      | Week 7, matching the write target                                     |
| Readback membership    | Same 15 players                                                       |
| Readback changed slots | 0                                                                     |
| Readback locks         | 13 locked, 2 editable                                                 |

What this establishes:

- The read-write origin accepts the explicit `<players><player><player_key>/<position>` body with
  the crumb and `format=json_f`, and the adapter classifies the response as accepted.
- A partial request that mentions one player leaves the other 14 roster members and their slots
  unchanged, matching the documented rule.
- The committed policy and solver plan the live football roster exactly as the
  [worked example](POLICY.md#worked-example-a-real-football-lineup) records: 114.41 points and zero
  changes because 13 players are locked.

What it does not establish:

- **A changed explicit assignment through the durable worker.** Week 7 had 13 locked players and a
  zero-change plan. A changed write was later verified on the fully editable week 8 roster through
  the committed provider seam; the worker's own changed-write path is covered by the behavioural
  fake and awaits week 8 becoming the current period. See [changed explicit assignment
  verification](#changed-explicit-assignment-verification-2026-10-26).
- **The explicit response envelope.** The adapter discards the write response body and classifies
  2xx as accepted; the harness did not retain the body for this request. The earlier native probe
  observed `fantasy_content.roster.status: success` at HTTP 200. The explicit response may carry
  the same envelope, but that was not observed and is not depended on. The roster readback is the
  authority.
- **Error codes.** No explicit-assignment rejection was observed live. The adapter maps 400 and other
  4xx responses to `invalid_request` with no retry, 404 to `not_found`, 408/429 to `not_sent`,
  5xx or an unavailable transport to `unknown`, and 401/403 to a rejected session. These mappings
  follow the native action's observed behaviour and the documented all-or-nothing rejection rule,
  not a live explicit rejection.

### Reserve transit acceptance (2026-10-27)

The owner authorized one acceptance write that moves one roster member **into** a reserve list and one
that moves them **out**. A disposable gitignored harness (`.artifacts/chunk11/reserve-transit.ts`)
decrypted the stored credential with the application's own credential service and called the committed
`YahooProvider.applyExplicitAssignments` through `PublicInternet`, reading the roster back between and
after the writes. Same roster only: the two requests name a slot for a player already on the team and
never add, drop, or trade. Retained evidence holds slot names, status classifications, and counts
only; no player name, player key, team key, league id, cookie, or crumb is recorded here.

The subject was an editable bench member of a date-scoped hockey team whose published
`eligible_positions` named the reserve list, with a free unit in that list. Every pre-condition was
read from the provider immediately before the write: the player's slot, editability, eligibility, and
the list's occupancy.

| Observation                   |   Into the reserve list | Out of the reserve list |
| ----------------------------- | ----------------------: | ----------------------: |
| Request                       | one assignment, BN → IR | one assignment, IR → BN |
| Write classified as           |                accepted |                accepted |
| Readback slot                 |                      IR |                      BN |
| Readback roster membership    |                      21 |                      21 |
| Reserve occupancy after       |                  2 of 2 |                  1 of 2 |
| Slot restored to the original |                       — |                     yes |

What this establishes:

- The read-write roster endpoint accepts a reserve-list slot label for a same-roster member, in both
  directions, with the same partial body it accepts for starting and bench slots.
- The readback is the authority and it agreed with the intended slots; membership was retained, so
  nothing was added, dropped, or traded.
- The conservative occupancy rule in the planner — “a reserve slot accepts only the player already in
  it” — is no longer needed. Reserve eligibility is back to the provider's published
  `eligible_positions`, so a plan may propose the injured-reserve shuffle the owner described.

What it does not establish:

- Reserve transit for a list the player is **not** published as eligible for. The adapter never sends
  one, and it is the provider's own rule rather than an observed rejection.
- Whether a reserve transit is accepted for a player whose game has started or whose slot is locked.
  The subject was editable at the time; the adapter still never moves a locked player.
- Whether a rejected reserve transit is reported with a specific error. No rejection was observed.

### Read-only batch-history re-verification (2026-10-26)

A second read-only harness (`.artifacts/phase2-evidence/history-read.ts`) exercised the worker's
batched `readPlayerHistory` operation against the same team after the implementation settled. It
requested the four-week observation window in one operation (one bounded request per period),
received 15 player details for each week with actual statistics, and reproduced the 114.41-point
plan, 9/9 starting positions, zero changes, and a `no_op` translation. No write was sent. This
verifies the worker's history read path live.

### Durable worker live no-op (2026-10-26)

Two custom-policy runs through the committed durable worker against the live football team
completed as verified `no_op` with `custom_policy` provenance and no provider write. Week 7 had 13
locked players and the plan had zero changes. This verifies the worker's live read, history, plan,
translation, and no-op settlement path; it does not exercise a changed worker write.

### Changed explicit assignment verification (2026-10-26)

With week 7 still locked, the owner authorized a changed explicit write on the next week's fully
editable roster. A disposable harness (`.artifacts/phase2-evidence/future-week.ts`) read the week 8
roster, planned from completed weeks 3–6, translated the plan, sent one request, and read week 8
back. It deliberately did not include the in-progress week 7 statistics. No cookie, crumb, team key,
player name, or provider body is recorded here.

| Observation         | Result                                                                |
| ------------------- | --------------------------------------------------------------------- |
| Target period       | Week 8, weekly roster coverage                                        |
| Roster              | 15 players, 15 editable, 0 locked                                     |
| Window and basis    | Weeks 3–6, `yahoo:mean-points-per-period:week:3,week:4,week:5,week:6` |
| Plan                | Four changes; filled 9/9 required starting positions; 122.31 points   |
| Request             | Four assignments: RB→BN, W/R/T→BN, BN→W/R/T, BN→RB                    |
| Write               | Accepted (HTTP 2xx)                                                   |
| Readback coverage   | Week 8, matching the write target                                     |
| Readback membership | Same 15 players                                                       |
| Readback mismatches | 0                                                                     |
| Follow-up read      | 0 changes, 122.31 points, `no_op` translation                         |

What this establishes:

- A changed explicit assignment request is accepted and persisted, not just a no-op body.
- One request can move several players between starting and bench slots; unmentioned roster members
  keep their slots, and membership is retained.
- The readback matched the intended final slots exactly, and a second read found no further change.

What it does not establish:

- **The durable worker's changed-write path for the current week.** This write used the committed
  provider operation and policy translation before week 8 became current; the worker's live runs
  proved only the no-op path. The worker's changed path is exercised against the behavioural fake.
- **The worker's week 8 plan.** The harness used completed weeks 3–6. Once week 8 is current, the
  worker will include week 7 statistics, so the production plan may differ from this record.
- **A live rejection or readback mismatch.** No explicit-assignment rejection or mismatch was
  observed live.

Still unverified after this pass:

- A changed explicit assignment through the durable worker for the current week, and whether its
  week 8 plan matches the weeks 3–6 plan recorded above.
- A live explicit-assignment rejection or readback mismatch; the adapter's failure mappings remain
  derived from documented behaviour, the native probe, and the behavioural fake.
- Whether an assignment for a locked player is rejected with a specific provider error (the adapter
  never sends one).
- Whether a reserve-list position (`IR`, `IR+`, `NA`) is accepted by this roster endpoint — verified on
  2026-10-27, see [the reserve transit acceptance](#reserve-transit-acceptance-2026-10-27).
- Whether a starting slot left empty is accepted, and whether the bench count is a hard maximum or a
  pooled allowance.
- Concurrent human edits between the pre-write read and the provider applying the request. No
  provider compare-and-set or idempotency token exists; the adapter detects edits visible in the
  pre-write re-read and relies on all-or-nothing rejection otherwise, but cannot eliminate the
  final window.

## Starting status across the linked account (2026-10-27)

Read-only, no write attempted, using the stored provider session through the committed adapter and
transport. The four hockey leagues are date-scoped and the football league is week-scoped. Every
roster was read at one instant (18:21 America/New_York, about 40 minutes before the first puck drop),
and only presence, integer flags, coverage, position, slot, and schedule are recorded here. No
provider key, team or league identifier, player name, or payload value is retained.

### The three states are distinct, and `0` means confirmed not starting

The reported team's two goalies with a game returned different states from the same request:

| Goalie state     | `starting_status` fragments                                         |
| ---------------- | ------------------------------------------------------------------- |
| confirmed backup | `{"coverage_type":"date","date":"<today>"}` and `{"is_starting":0}` |
| unconfirmed      | key absent                                                          |

Across the four hockey rosters, one roster carried two goalies on the **same** professional team with
the same opponent: one returned `is_starting: 1` and the other `is_starting: 0`. Two goalies on one
team cannot both be the announced starter, so `0` is the provider's explicit non-start, not a
placeholder for "not announced yet". A goalie whose starter had not been announced carried no key at
all. The two absent-with-game goalies on the reported team fit the same reading: their games were later
that evening, when the field had not yet arrived.

### Counts by team and position

Goalies are counted separately because they are the only position that carried the field.

| Roster     | Players | Skaters | Skaters with any flag | Goalies | Goalie `1` | Goalie `0` | Goalie absent | Absent with a game |
| ---------- | ------: | ------: | --------------------: | ------: | ---------: | ---------: | ------------: | -----------------: |
| football-1 |      15 |      15 |                     0 |       0 |          0 |          0 |             0 |                  0 |
| hockey-1   |      21 |      17 |                     0 |       4 |          1 |          2 |             1 |                  0 |
| hockey-2   |      19 |      15 |                     0 |       4 |          1 |          2 |             1 |                  0 |
| hockey-3   |      22 |      18 |                     0 |       4 |          0 |          1 |             3 |                  2 |
| hockey-4   |      22 |      19 |                     0 |       3 |          0 |          2 |             1 |                  0 |
| **Total**  |  **99** |  **84** |                 **0** |  **15** |      **2** |      **7** |         **6** |              **2** |

The reported team is hockey-3. Its confirmed backup held a starting `G` slot while the unconfirmed
goalie sat on `BN` — the outcome the owner reported.

One further goalie on a reserve list also returned `0`; an injury status and a starting-lineup fact are
independent, and the status table keeps an excluded player on `will-not-play` regardless.

### Skaters never carry the field

No skater on any of the five rosters carried `starting_status`, with or without a game. A skater who is
not in the real team's opening lineup still takes shifts, so the safe interpretation is that the field
is not an availability fact for a skater even if a future payload carries one. A synthetic fixture
already contains `is_starting: 0` on a skater, and the adapter maps it to no demotion; the regression is
covered without claiming anything about live skater data.

### Coverage is date-scoped only

Every present entry carried `coverage_type: "date"` with that date, and no `week` field. In the
date-scoped hockey leagues that matches the roster's own coverage. In the week-scoped football league
the roster declares a week, and no football player carried the field at all in this observation — so a
weekly league cannot use it to decide a whole week from a single day, and the adapter does not try. The
fact is read per roster and per target period; it is not a week-long claim.

### The league-wide "starting goalie" player filter is not a substitute

The reference project fetched a league-wide list from
`league/{key}/players;position=S_G;sort=AR;start=0`, cached it for a day, and accepted either that list
or `is_starting === 1`. The same request was replayed read-only against the reported team's league and
returned 8 players. It included a goalie whose professional team had **no game** that date, and it
omitted both the confirmed backup and the two unconfirmed goalies. It is therefore a depth-chart role
list, not a per-day confirmed-starter list, and it disagrees with the per-roster fact in both
directions.

The roster field is the reliable per-day signal for the positions it covers, so the external cached
fetch is unnecessary. Its absence on a goalie is meaningful as "unconfirmed" rather than "not
starting", which is exactly the distinction the ladder needs, and a role list cannot supply it. No
additional read, cache, or scheduled job is justified.

### Limits

- One instant on one account. Announcement timing was inferred from game clock and the same-team pair,
  not from a documented publication schedule.
- No football player carried the field, so nothing here establishes football behaviour for any
  position, and the adapter does not invent one.
- Whether the provider ever publishes `is_starting: 0` for a skater is not established. The adapter is
  built so that it would not demote one.

## Starting lineup interpretation across four sports (2026-10-27)

The interpretation is declared data in two steps: each sport's positions map to a position class, and
each class maps to one of two rules. The reference project supported NFL, NHL, MLB, and NBA, and its
code is the basis for every class below. The position maps cover all four sports now; only football and
hockey are live adapter capabilities, so this records the rule and its provenance rather than claiming
baseball or basketball request support.

| Position class   | Rule                            | Basis                                                              |
| ---------------- | ------------------------------- | ------------------------------------------------------------------ |
| goalie           | `unlikely-to-play`              | only one goalie starts; the backup rarely appears                  |
| starting pitcher | `unlikely-to-play`, provisional | reference penalises a non-starting starting-pitcher-only player    |
| relief pitcher   | no availability fact            | a reliever can appear without being the announced starter          |
| position player  | no availability fact            | skaters, batters, and football/basketball players play in rotation |
| undeclared       | no availability fact            | conservative default; a signal never demotes what it does not know |

The position maps are:

| Sport      | Class `goalie` / `starting-pitcher` / `relief-pitcher` | Everything else           |
| ---------- | ------------------------------------------------------ | ------------------------- |
| hockey     | `G`                                                    | `C`, `LW`, `RW`, `F`, `D` |
| baseball   | `SP`; `RP` and `P` are relief pitchers                 | batters, `Util`, `DH`     |
| football   | none                                                   | every position            |
| basketball | none                                                   | every position            |

### Where each rule comes from

- **Reading the field.** `server/core/src/common/services/yahooAPI/yahooPlayerProcessing.service.ts`
  lines 109–111 read `starting_status.is_starting` and fall back to `"N/A"` when the key is absent. The
  same file records eligible positions as slot names, which is why a batter and a pitcher are
  distinguishable by `SP`/`RP`/`P` in the eligibility list.
- **The cached starter lists.** `server/core/src/common/services/yahooAPI/yahooStartingPlayer.service.ts`
  fetches a league-wide list through `yahooAPI.service.ts` lines 224–251 with `position=S_G` for NHL and
  `position=S_P` for MLB, caches it for a day, and `isStartingPlayer` at
  `server/core/src/common/services/playerScoreFunctions/playerStartScoreFunctions.service.ts` lines
  299–301 accepts either the cached list or `is_starting === 1` with the comment "starters array is
  not always accurate, so we need to check both". That is the reference's workaround for unreliable
  announcement timing, not a different fact.
- **Hockey.** `scoreFunctionNHL` (same file, around lines 195–205) treats a player as a starting goalie
  only when eligible positions include `G`; it never penalises `is_starting: 0`. `applyScoreFactors`
  multiplies a confirmed start by 100. The reference therefore had no non-start demotion for skaters,
  and its goalie rung was a confirmed-start boost only.
- **Football.** `scoreFunctionNFL` (around lines 246–270) never reads `is_starting`; there is no
  participation rule to inherit. A player outside the starting lineup still plays in a rotation.
- **Basketball.** `scoreFunctionNBA` (around lines 180–184) never reads `is_starting`. The only place a
  basketball non-start appears is the games-limited churn path in `getScorePenaltyFactor` (lines
  168–170), which multiplies `is_starting === 0` by `1e-7` as a pace heuristic. That is a capacity
  device, not a claim that a bench player will not play, so it is not a starting-lineup rule.
- **Baseball.** `scoreFunctionMLB` (lines 211–237) computes
  `isNonStartingSP = eligible_positions.includes("SP") && !eligible_positions.includes("RP") && !isStartingPitcher`,
  then applies `NOT_STARTING_FACTOR` when `is_starting === 0`, when `isNonStartingSP`, or when the
  player is on the long-term injured list. Its own comment (lines 215–222) says the author was unsure
  whether to boost starting pitchers, intended the penalty to stop a non-starting SP outranking an
  appearing RP, and worried that penalising late-confirmed batters would leave a good unconfirmed
  player on the bench. The owner reports the starter/reliever logic was never quite right.

### Why the table is conservative

The reference's MLB function applied `is_starting: 0` to **every** baseball player, including batters,
despite its own comment that this was a stand-in for a different signal and that late confirmations
make it risky. We keep only the part with a clear meaning: a starting pitcher who is confirmed not to
start is unlikely to pitch today. Relief pitchers and generic pitchers can appear without being the
announced starter, and batters always can, so they are not demoted. The same reasoning is why football
and basketball are declared with no availability fact: their reference score functions never read the
field, and their games are rotations rather than nine-inning or 60-minute single-starter roles.

### What would settle baseball

A live MLB surface would need to read `starting_status` around game time for starting pitchers, relief
pitchers, and batters together, and compare it with the announced starter. The open questions are
whether Yahoo emits `0` for relievers and batters at all, whether a confirmed non-starting SP ever
pitches in relief on the same day, and whether a generic `P` primary position appears with a non-start
signal. Until then the `SP` rule stays provisional and every other baseball position stays
undemoted. That requires a baseball-capable provider read shape, which is out of scope for this
change.

The conservative default is unchanged: a sport or position absent from the table is `no availability
fact`, so a new signal can never bench a player it does not understand.

## Live player-search ordering evidence (2026-10-28)

Read-only probes of the players collection, recorded as stat ids, rank types, presence counts, and
order only:

- `out=ranks` answers on the players collection and adds `player_ranks` with `rank_type` `OR`
  (overall) and one `S` entry per season (`rank_season` 2026, 2025, 2024). A `ranks=` selector is
  rejected on this collection (HTTP 400); the defaults are the only shape available.
- Sorting with `sort=AR` orders rows by the **current season's** `S` rank: the returned order was
  exactly 1..N for `S` with `rank_season` equal to the league season. Sorting with `sort=OR` orders
  by `OR`. Neither requires a separate read, and no `AR` rank type is ever published.
- `sort=<stat_id>` orders by that league category. Adding `out=stats` returns each player's season
  stat series, including the ordered stat id. The collection accepts no weekly stat selector:
  `stats.type=week`, `stat_type=week`, and `week=` on `stats` all answer 400, and `out=stats` always
  reports `coverage_type: season` even when `sort_type=week`. The weekly sort itself is accepted for
  football, but the weekly rank or stat value it orders by is published nowhere in the response, so
  the adapter refuses the weekly basis instead of returning an unexplainable order.
- `percent_owned.delta` was present on **every** sampled row: 25/25 in each of the five leagues for
  the unfiltered, `status=FA`, and `status=W` requests (0 rows for one league's waiver filter).
  `percent_started.delta` was present on fewer rows (14/25 and 20/25 in two football samples,
  18/25–25/25 in hockey), so a missing started change is the provider's absence, not a decoder gap.
  The search payload's `percent_owned`/`percent_started` nodes carry
  `coverage_type`, `value`, `delta`, and a `week`/`date`; all four are decoded where present.

## Live rotisserie standings shape (2026-10-28)

The same read-only pass read the owner's rotisserie hockey league standings (`GET .../standings`)
and the league settings side by side, then compared every `team_points` and `team_stats` stat id
with the league's declared `stat_categories`. Retained evidence holds stat ids, value kinds,
per-team counts, and ranges only.

- The league declares 13 categories. Its `team_points.stats` carries 15 entries for every team:
  the 13 categories plus two ids with no declared category.
- **GA, SA, and SV publish no rotisserie points.** Every one of the 13 teams carries an empty-string
  value for those three category ids in `team_points`, while `team_stats` carries numeric totals for
  the same ids (for example GA 51, SA 437, SV 386). The other ten categories, including the ratio
  stats GAA and SV%, carry numeric roto points in the range 1–13. This is a provider publication
  gap for these three categories, not a decoding loss; an empty string is the only value Yahoo
  sends.
- The two extra ids (29 and 30) appear in both arrays with numeric totals and empty points, and
  appear in no `stat_categories` entry, so the provider publishes no name for them. A client cannot
  label that number; the adapter omits such ids and reports a count.
- The service now maps a numeric value to `{status: "published", value}` and a missing value to
  `{status: "not_published", detail}`, so "not published" is distinguishable from zero in both
  season totals and roto points. It filters ids outside the league scoring dictionary and reports
  the distinct omitted count in `omittedCategories`.

The fixtures now reproduce this shape: 13 declared categories, empty roto points for GA/SA/SV, and
two scored-but-undeclared ids with numeric values. A provider fixture test asserts the exact set of
stat ids and the empty-value set; a query test asserts every emitted stat reference resolves to a
league scoring category and that the omitted count matches the undeclared ids.

## Round-4 period live check (2026-10-29)

A third gitignored harness under `.artifacts/round4/` ran the committed `YahooProvider` through
`PublicInternet` with the real transport, using the owner's signed-in browser session over loopback.
Evidence holds status codes, byte sizes, request shapes with player keys masked, stat ids, and the
adapter's own refusals; no cookie, crumb, league id, team key, player name, or manager identity was
printed or written. Reads only.

Findings:

- **Football publishes no daily player series.** `stats.type=date&stats.date={past date}` answers
  HTTP 200 with **no `player_stats` node** for either sampled player, exactly as a weekly hockey read
  does. The declared `range`/`preset` refusal for football is therefore grounded in the provider's own
  behaviour, not an assumption from the hockey probes.
- **Football season and completed-week bases still work.** `{kind: "season"}` returned the season
  basis with 23 stat ids for both sampled players; `{kind: "week", week: 7}` (current week 8)
  returned the week basis with the same ids and populated counts.
- **Refusals name the kind, the declaration, and the remedy.** A football preset and a football range
  both answered `provider.period_unsupported` with `declared: "unsupported"` and the remedy listing
  `kind: "season"` and `kind: "week"` with a completed scoring week. No request was issued for either.
- **Standings shape.** The football league publishes 10 teams and no per-category totals (points
  league), matching the format rule.
- **Hockey could not be checked.** The browser session's Yahoo account now lists an `nhl` game with
  **zero teams** (its games list holds `nhl` 2022 and 2023 with no teams, and `nfl` 2026 with one), so
  no hockey league is reachable from this session. The hockey half of the period table — daily sums,
  the ratio-category exclusion, the 31-day cap, and the whole-season substitution — is verified
  against captured fixtures and the live-shaped adapter tests, but a live hockey read remains open
  until the account that owns the four hockey leagues is signed in. The same blocker covers the
  13-team rotisserie compact standings read; the compact budget is proven by the fixture test only.

The `date` key on a date-scoped `player_stats` coverage entry could not be observed for the same
reason. The adapter requires `coverage_type: "date"` and compares the published `date` only when the
provider includes one, so an entry without that key still verifies.

## Live review-link verification (2026-10-28)

The owner's existing read-only session was reused for a second gitignored harness under
`.artifacts/phase3-evidence/`. It called the committed `YahooProvider.buildReviewLink` for each
intent on all five linked leagues, then fetched each returned URL through the same transport with the
owner's session. No name, team key, league id, or cookie was printed, written, or committed; the
retained evidence holds the URL template with identifiers replaced, the page title, whether the
intended player's name occurs in the response, and the review form's action path.

| Sport    | Intent     | Verified URL template                                                               | Page result                                     |
| -------- | ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| football | `add`      | `https://football.fantasysports.yahoo.com/f1/{league}/addplayer?apid={id}`          | 200, names the added player                     |
| football | `add/drop` | same path with `&dpid={id}`                                                         | 200, names both players                         |
| football | `drop`     | `https://football.fantasysports.yahoo.com/f1/{league}/{team}/dropplayer?pid={id}`   | 200, names the dropped player and not the other |
| hockey   | `add`      | `https://hockey.fantasysports.yahoo.com/hockey/{league}/addplayer?apid={id}`        | 200, names the added player                     |
| hockey   | `add/drop` | same path with `&dpid={id}`                                                         | 200, names both players                         |
| hockey   | `drop`     | `https://hockey.fantasysports.yahoo.com/hockey/{league}/{team}/dropplayer?pid={id}` | 200, names the dropped player and not the other |

Each page carries a POST form to the same path with an explicit confirmation control, so the link is a
review page rather than a submission stage. Two negative controls: the former `/add` path answers 200
with `The document you requested was not found`, and a `dpid`-only request to `addplayer` answers 200
with `There was a problem` instead of a prefilled page.

`proposetrade` exists and requires a session, but `apid`, `dpid`, and `pid` on it leave both player
names out of the response: the trade proposal page is a client-rendered flow with no verified
parameterized prefill. The adapter therefore refuses a trade review link with
`unsupported-review-surface` and the tool reports it as unsupported. An unauthenticated probe of the
`/add` and `/trade` paths on the football, hockey, and baseball hosts answers the same "not found"
page, while `/addplayer` and `/dropplayer` redirect to sign-in: the path exists check is a protected
route, independent of any one league.

Baseball's `/b1/{league}/addplayer` is also a protected route, but baseball and basketball are not
supported league types, so no review link is generated for them. Both use the same path templates,
keyed by the league URL the provider supplies.

## Yahoo sign-in routing for a Google-identity account (2026-10-28)

The owner's Yahoo account uses a Google identity: its Yahoo ID is a Gmail address. In the deployed hosted
browser, Yahoo sends that account to Google, and Google refuses the browser. This investigation asked
whether any Yahoo password sign-in is reachable for such an address, because that would let the hosted
browser link the account without Google.

Method and limits: a fresh Playwright Chromium (headless shell build 156, no stored profile, no signed-in
state) on the developer's own machine, not the deployed Cloud Run browser. Only Gmail-shaped addresses
were entered. No password, one-time code, recovery link or Google credential was submitted, and no
account recovery was completed. Everything below is page behaviour for an address nobody owns. The
harness and screenshots are gitignored under `.artifacts/linking-research/`.

### The sign-in page refuses a Gmail-shaped identifier before any account lookup

`https://login.yahoo.com/` renders a username field, a **Next** button, "Sign in with Google" and "Create
account". As soon as the typed value ends in `gmail.com` or `googlemail.com`, the page removes **Next**,
adds an inline notice, and leaves Google as the only way forward:

| Entered value                                            | Next button | Inline notice                                  | Google button |
| -------------------------------------------------------- | ----------- | ---------------------------------------------- | ------------- |
| `…@gmail.com`                                            | removed     | "To use a Gmail address, sign in with Google." | present       |
| `…@googlemail.com`                                       | removed     | same                                           | present       |
| `…@GMAIL.COM` (uppercase)                                | removed     | same                                           | present       |
| `…@mail.gmail.com` (subdomain)                           | present     | none                                           | present       |
| `…@example.com`, `…@outlook.com`, `…@yahoo.com`, bare ID | present     | none                                           | present       |

The rule is a static client-side domain test shipped by Yahoo, not an account lookup. The login page's
own bundle (`s.yimg.com/wm/afe/…/_next/static/chunks/534-…js`, module 5401) is:

```js
let a = (e) => {
  let t = e.indexOf("@");
  return t < 0 ? "" : e.slice(t + 1);
};
let l = (e) => {
  let t = e.indexOf("@");
  return t <= 0 ? "" : e.slice(0, t);
};
let n = ["gmail.com", "googlemail.com"];
let s = (e) => {
  let t = e.trim();
  if (!l(t)) return false;
  let r = a(t).toLowerCase();
  return !!n.includes(r) || (r.startsWith("gmail") && "gmail.com".startsWith(r));
};
let i = (e) => {
  let t = e.trim();
  return !!l(t) && n.includes(a(t).toLowerCase());
};
```

(the names are the bundle's own minified identifiers; the domain array, the case-insensitive comparison
and the partial-typing prefix branch are literal). The page component
(`_next/static/chunks/app/page-…js`) consumes it with a server-supplied flag:

```js
D = useMemo(() => e.forceGoogleForGmailAddress && !e.hideCTA
  && e.socialLogins.includes("google") && S.CI(v), …)
```

and the same page data carries `"forceGoogleForGmailAddress":true`, `"socialLogins":["google"]` and
`"recommendedDomains":["yahoo.com","gmail.com","outlook.com","aol.com"]`. The notice is rendered with
`data-testid="gmail-detected-notice"`. Nothing in that branch reads account state: the decision is made
from the text of the field.

Consequences observed:

- Pressing Enter after typing a Gmail address goes straight to Google's connector, with the address
  pre-filled as `login_hint`; the address is never sent to Yahoo's own challenge endpoint. A programmatic
  `form.requestSubmit()` does nothing and no request leaves the page. Either way there is no path from
  this page to a Yahoo password challenge.
- The block is identical on an iPhone user agent at 390×844, with `?src=ym`,
  `?src=fantasysports&.done=https://football.fantasysports.yahoo.com/`, and `?.lang=en-US&.intl=us`.
- The legacy entry `https://login.yahoo.com/config/login?login=…@gmail.com&.src=ym&.done=…` answers 301 to
  `https://login.yahoo.com/?login=…&.src=ym&.done=…`, which renders the same page and the same notice.
  There is no legacy password form behind it.
- "Forgot username" and the Sign-in Helper are separate flows (below) and do not add a password option to
  this page.

### The server's own challenge choice never sees a Gmail address from the UI

The page submits through `POST https://login.yahoo.com/validate` and follows the `redirect` it returns. A
control submission for a non-Gmail address returned
`{"redirect":"/account/challenge/email-verify?authMechanism=primary&…"}`. Posting the same form directly
with a Gmail-shaped username, from a freshly loaded page, returned the same generic challenge:

| Username                       | `/validate` response                              |
| ------------------------------ | ------------------------------------------------- |
| `…@gmail.com`                  | `email-verify` challenge, `authMechanism=primary` |
| `…@googlemail.com`             | `email-verify` challenge                          |
| `…@GMAIL.COM`                  | `email-verify` challenge                          |
| `…@outlook.com`                | `email-verify` challenge                          |
| `…@yahoo.com` (nonexistent ID) | `{"error":{"message":"INVALID_IDENTIFIER"}}`      |

So, for an address nobody owns, the server does not answer "Google"; it answers the same
anti-enumeration verification challenge it gives any unrecognised email. The Gmail-to-Google routing is
the client rule above, not a server decision about the address. What a real federated account's
server-side challenge would be was not observable.

Note the asymmetry: the page accepts a Gmail address in its "Create account → Use existing email" form
with no notice at all, so Yahoo's own surfaces disagree about whether a Gmail address may be a Yahoo ID.
That submission was not completed (Yahoo's device-risk check answered `eid=3692`), so whether the signup
backend accepts a Gmail ID is not established. It does show the sign-in rule is a blanket domain rule,
not a fact about the account.

### A password challenge URL is not directly reachable

`https://login.yahoo.com/account/challenge/password` redirects to the generic failure page, with or
without query parameters:

| Request                                                                    | Result                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/account/challenge/password`                                              | 307 → `/account/challenge/fail` "Something went wrong" |
| `/account/challenge/password?sessionIndex=…&acrumb=…&done=…`               | 307 → `/account/challenge/fail`                        |
| `/account/challenge/password?username=…@gmail.com&sessionIndex=…&acrumb=…` | 307 → `/account/challenge/fail`                        |
| `/account/challenge/username?authMechanism=primary&…`                      | 307 → `/account/challenge/fail`                        |

The challenge URL is not self-contained: the server keeps challenge state per session, so a URL cannot
force a password form. A URL-shaped folklore workaround (`/config/login?login=…`, a `password` query
parameter, "use password instead") does not exist on the current page.

### The Google connector, and Google's refusal on an ordinary machine

The page's only other control navigates to Google's OAuth client for Yahoo:

```
https://accounts.google.com/v3/signin/identifier
  ?client_id=860033281504.apps.googleusercontent.com
  &redirect_uri=https%3A%2F%2Flogin.yahoo.com%2Faccount%2Fchallenge%2Ftpa%2Fredirect
  &response_type=code&scope=openid+email+profile&service=lso&prompt=select_account
  &state=acrumb%3D…%7CsessionIndex%3D…%7CauthMechanism%3Dprimary…
  &app_domain=https%3A%2F%2Flogin.yahoo.com
```

Google renders "Sign in with Google — to continue to Yahoo" with an email field. Submitting a
Gmail-shaped address in that same unmodified Chromium, on the developer's own network, produced
`/v3/signin/rejected` and the page "Couldn't sign you in — This browser or app may not be secure", before
any account lookup. The owner's deployed-browser refusal is therefore a property of the automation-driven
browser, not of the Cloud Run egress: the same refusal happens from an ordinary network outside GCP with
a stock Playwright build.

### The Sign-in Helper accepts a Gmail address, but is a recovery flow

`https://login.yahoo.com/forgot` answers 307 to
`/account/challenge/username?authMechanism=secondary&done=…&sessionIndex=Qg--`, titled "Let's find your
account", whose only field is labelled **Recovery email address** (with "Use recovery phone number"
alongside). Entering a Gmail-shaped address there is accepted without the Gmail notice and advances to
"Let's verify your account — You'll get a verification code if this email is linked to an account. Get
code / Try signing in another way". No code was requested and nothing was verified.

So a Gmail address is an accepted _starting point_ for recovery, which is what Yahoo's
[SLN6178](https://help.yahoo.com/kb/SLN6178.html) describes for accounts created with a Google or
Facebook ID, and it confirms that the recovery flow is not subject to the sign-in page's Gmail rule. It
does not confirm that the owner's account can be recovered this way, what the flow asks for next, or that
it ends in a signed-in Yahoo session rather than only a password reset. Those steps require the owner's
own account and were deliberately not attempted. The current helper asks for a **recovery email**, while
SLN6178 says to enter the Google/Facebook ID "in the Yahoo ID field"; the page text and the article do not
match, and the field's behaviour for a federated ID cannot be distinguished from the outside.

### Facebook-ID accounts

The login page's page data lists `"socialLogins":["google"]` and contains no Facebook control at all;
the only third-party buttons are Google's. SLN6178 still documents a Facebook-ID restore through the
Sign-in Helper, so a Facebook-ID account's remaining route is the recovery flow, not a connector. A
Facebook-ID Yahoo account whose ID is a Gmail address would hit the same Gmail rule on the sign-in page,
which is a wrong recommendation for that account, not a route; that combination was not observed and is
inferred from the rule and the page data.

### What this does and does not establish

Established by observation: the sign-in page will not submit a `gmail.com`/`googlemail.com` identifier,
on desktop or an iPhone user-agent viewport, on default, mail, fantasy and language entry URLs, or through
the legacy `config/login` path; its only forward control is Google's connector; the password challenge cannot be
entered by URL; the recovery flow does accept a Gmail-shaped address; Google refuses an automation-driven
Chromium for Yahoo's connector on an ordinary network.

Not established, and not claimed: whether a Yahoo password already set on a Google-ID account changes
anything (the block is a static domain rule evaluated before any account state is read, so the expected
answer is no, but this is inference from code, not a test); whether the Sign-in Helper can complete for
the owner's account and leave a signed-in session; whether the server would offer a password challenge to
a real federated account if it ever received the address.

### The five-minute test the owner can run

Only the owner's own account can settle the residual question, and only after adding a Yahoo password:

1. In a normal browser, sign in to Yahoo with Google, open `https://login.yahoo.com/account/security`,
   and under "Ways of signing in" open **Password** and set one. If that option is absent or refuses a
   Google-ID account, the question is settled: there is no password to use.
2. In a private window, open `https://login.yahoo.com/` and type the Gmail address.
3. Record whether a **Next** button and a password field appear, or whether the "To use a Gmail address"
   notice and the Google button are the only options.

A password field (or a working "use password instead" affordance) would mean the hosted browser can link
this account class without Google, and the whole password path should be revisited. The notice, as
observed on every surface tested here, means the account cannot use a Yahoo password at the sign-in page
at all, regardless of whether one is set.

## Live acquisition-usage verification (2026-10-30)

A read-only pass over the owner's five current football and hockey leagues probed the team objects
that carry acquisition usage. A disposable gitignored harness (`.artifacts/acquisition-usage/`)
decrypted the stored provider credential with the application's own credential service and issued
the reads through `PublicInternet` with the real transport. Retained evidence holds field names,
JSON types, counts, ranges, status codes, and byte sizes only; no cookie, league id, team key,
team name, or manager identity was printed or written.

- **Both counters are on the team object.** `GET /fantasy/v2/league/{league_key}/teams?format=json`
  returned `number_of_moves` and `roster_adds` on every team in all five leagues: 60 teams across
  the five reads, with no team missing either field. `number_of_moves` arrived as a JSON number.
  `roster_adds` arrived as `{ coverage_type: "week", coverage_value: <number>, value: "<integer>" }`
  on every team: the coverage value was a number, the value a numeric string. A published zero
  (`value: "0"`) is a real zero, not an empty string.
- **The standings read carries the same team object.** `GET .../standings?format=json` returned
  `number_of_moves` and `roster_adds` on 58 of 58 team rows across the same five leagues, so
  standings rows can carry per-team usage without a second upstream read.
- **The league's own limits vary as the earlier settings pass recorded.** One league declared both a
  weekly and a season limit, one declared only a season limit, one declared only a weekly limit,
  one declared neither, and the remaining league declared a weekly limit only. The counter's
  `coverage_type` was `week` in every league, including the football points league and the
  rotisserie hockey league.
- **`out=games_played` publishes no per-team count.** The query form
  `.../teams?format=json&out=games_played` answered HTTP 400, and so did
  `.../standings;out=games_played`. The collection-path form
  `.../teams;out=games_played?format=json` answered 200, and on the two leagues that returned the
  field at all it was the empty array `[]` for every team (`"games_played": []`). The other three
  leagues omitted the field entirely. No team, league, or sport in the pass published a
  games-played count, so only the league's `max_games_played` cap is known.
- **No incomplete team payload appeared in this pass.** Every current league's team and settings
  objects carried the counters, so the "provider published neither counter" state remains covered
  by synthetic fixtures rather than by today's live data. The adapter distinguishes it from a
  published zero at the provider type and at the query surface.

## Live schedule-window, status, and games-played probes (2026-10-30, round 9)

A read-only pass re-used the stored provider credential through the application's own credential
service and `PublicInternet`, then ran the committed `FantasyQueries.getTeamSummary` and
`searchPlayers` against the owner's linked teams. Retained evidence holds dates, counts, field names,
JSON types, status codes, and byte sizes only; no cookie, league id, team key, team name, player
name, or manager identity was printed or written. Nothing was written to the provider.

### The period-less league publishes a current date

- `GET .../league/{rotisserie hockey league}/settings` published `current_date: "2026-10-30"` and no
  `current_week`; its scoreboard published no week window. `current_date` is the anchor the schedule
  group uses for the rest-of-week default. Both hockey leagues published `current_date`; the sampled
  football league did not, so the adapter keeps it optional and refuses a `days` window when it is
  absent.
- `GET .../team/{team}/roster;date=YYYY-MM-DD/players;out=opponent` answered 200 for each date of
  the rest of the provider's week (Friday through Sunday) and returned one opponent or `null` per
  player, with a leading `@` for away, matching the earlier pass.
- Through `getTeamSummary`, the rotisserie league returned a three-date window
  (`2026-10-30` to `2026-11-01`, source `rest_of_week`), 23 players across two pages, and per-date
  roster counts of 4, 15, and 5. The head-to-head league returned its scoring-period window
  (`2026-10-26` to `2026-11-01`, source `period`) unchanged.

### Search rows publish the professional team, and the status vocabulary is wider

- `GET .../league/{league}/players;sort=NAME;count=50;search={letter};out=ownership` carried
  `editorial_team_abbr` on search rows as well as roster rows, so `search_players` now publishes it
  as `proTeam`. In the live tool read, ten of ten ownership-sorted rows carried one.
- Across five leagues and eighteen name queries the observed search `status` values were `O` (24),
  `Q` (18), `DTD` (12), `IR` (139), `IR-LT` (92), `IR-NR` (76), `IR-R` (5), and `NA` (2,602 across
  two wordings: "Not Active" and "Inactive: Coach's Decision or Not on Roster"). `IR+` was not
  sampled this pass but remains in the adapter's table from earlier evidence. `IR-NR` and `IR-R`
  were not in the table, so those players read `unknown`; their `status_full` wording is "Injured
  Reserve" and "Injured Reserve - Designated for Return", which is the injured-reserve shape the
  adapter already models. Both codes are now mapped to `injured_reserve`.
- An earlier observation that healthy search rows carry `status: false` was a misread of the
  payload: the boolean belongs to `is_keeper.status` on the player record. A healthy player row
  simply omits `status`, exactly as a healthy roster row does. The adapter already decoded a missing
  status as healthy; the adapter's own fixture set the boolean at the wrong level and is corrected
  through the typed provider rows rather than by trusting `is_keeper`.

### Games-played request shapes

Every shape below was requested read-only against the owner's hockey and football leagues.

| Request                                                                  | Status | Games-played result                                        |
| ------------------------------------------------------------------------ | ------ | ---------------------------------------------------------- |
| `GET /league/{league}/teams;out=games_played`                            | 200    | one `"games_played": []` per team (13 hockey, 12 football) |
| `GET /league/{league}/teams;out=games_played;type=season`                | 200    | same empty per-team node                                   |
| `GET /league/{league}/teams;team_keys={team};out=games_played`           | 200    | same empty per-team node                                   |
| `GET /league/{league}/teams;team_keys={team};out=games_played;type=date` | 200    | same empty per-team node                                   |
| `GET /league/{league}/teams;out=games_played,roster`                     | 200    | same empty per-team node                                   |
| `GET /team/{team}/roster;out=games_played`                               | 400    | unsupported output                                         |
| `GET /team/{team}/roster;date=…/players;out=games_played`                | 400    | unsupported output                                         |
| `GET /team/{team}/roster;week=…/players;out=games_played`                | 400    | unsupported output                                         |
| `GET /league/{league}/standings;out=games_played`                        | 400    | unsupported output                                         |
| `GET /league/{league}/players;out=games_played`                          | 400    | unsupported output                                         |
| `GET /team/{team}/stats;type=season`                                     | 200    | no games-played field                                      |

The node exists only as a `teams` output and is empty in every league sampled, so the per-team
usage remains `not_published`; the detail names the accepted-but-empty shape instead of implying the
field was never requested.

### Transaction timing

The settings payload for all five leagues carries `waiver_type`, `waiver_rule`, `uses_faab`,
`waiver_time`, `weekly_deadline`, `trade_end_date`, `trade_ratify_type`, and `trade_reject_time`.
The round-9 re-read found that the three leagues previously reported as `not_set` publish
`weekly_deadline: ""`; the field is present and empty, not missing. The other two publish
`"intraday"`. The published fields decode to a roster-change rule:

| Published `weekly_deadline` | Published `edit_key` vs `current_date` | Rule          | Source fields                 |
| --------------------------- | -------------------------------------- | ------------- | ----------------------------- |
| `"intraday"`                | any                                    | `same_day`    | `weekly_deadline`             |
| `"game"`                    | any                                    | `same_day`    | `weekly_deadline`             |
| `"1"` .. `"7"`              | any                                    | `weekly_lock` | `weekly_deadline`             |
| `""`                        | numeric scoring week                   | `weekly_lock` | `weekly_deadline`, `edit_key` |
| `""`                        | date equal to `current_date`           | `same_day`    | `weekly_deadline`, `edit_key` |
| `""`                        | next date after `current_date`         | `next_day`    | `weekly_deadline`, `edit_key` |
| any other value             | any                                    | not published | none                          |

The live pass on 2026-10-31 read two hockey leagues with `"intraday"` (`same_day`), one football
league with `""` and a scoring-week `edit_key` (`weekly_lock`), and two hockey leagues with `""`
and an `edit_key` one day after `current_date` (`next_day`). A value the adapter has not been
taught, or an empty deadline without a usable editable period, publishes no rule rather than a
guess. The raw value stays beside the rule in `timing.weeklyDeadline`, and the rule's `source`
names the fields and its `detail` repeats the raw values.

### Pool player schedule shapes (2026-10-31)

The roster schedule read is roster-scoped, so a free agent whose professional team has no rostered
player could not be dated by it. The shapes below were requested read-only against the owner's date-
scoped hockey league and scoring-week football league. No player name, key, team key, or league id
was retained.

| Request shape                                                            | Status | Result                                                                                         |
| ------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------- |
| `GET /league/{league}/players;out=opponent`                              | 200    | 50 rows; the same opponents as a dated read                                                    |
| `GET /league/{league}/players;out=opponent;date=YYYY-MM-DD`              | 200    | same 50 rows, same opponents on two different dates; the plain `date` is accepted and ignored  |
| `GET /league/{league}/players;type=date;date=YYYY-MM-DD;out=opponent`    | 200    | opponents moved by date: 9 non-null on one date, 26 on the next in a 50-row sample             |
| `GET /league/{league}/players;type=date;date=…;out=opponent,ownership,…` | 200    | the full search output (ownership, percent owned/started, ranks, transactions) plus `opponent` |
| `GET /league/{league}/players;week=5;out=opponent`                       | 200    | accepted but not date-addressable; the weekly cadence supplies the week's opponent             |
| `GET /league/{league}/players;type=week;week=5;out=opponent`             | 400    | `type=week` is not a supported selector                                                        |
| `GET /player/{player_key};out=opponent;date=YYYY-MM-DD`                  | 400    | invalid game key; a player resource is not addressable without a game context                  |
| `GET /league/{league}/players/{player_key};out=opponent;date=YYYY-MM-DD` | 400    | invalid player resource                                                                        |
| `GET /team/{team}/roster;date=YYYY-MM-DD/players;out=opponent`           | 200    | works, but only for players on that roster                                                     |

On a scoring-week football league the `type=date` selector is accepted but returns the week's
opponent unchanged across dates, so it is not a dated read. The adapter therefore publishes a dated
opponent only when the league's declared coverage is a date. The pool read was adopted for
`search_players`: `type=date` is requested only for a date-covered league, and the result states the
date and the `league_player_pool` source. When the provider omits the opponent field, the row
is `not_published`; a published null is `no_game`; no opponent is inferred from a player's team or
from another date.

## Live transaction-trend probes (2026-10-30, quick wins round 2)

The provider has no dedicated transaction-trend resource. Every shape below was requested read-only
against the owner's linked leagues with the stored local session.

| Request                                                                        | Status | Result                                                         |
| ------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------- |
| `GET .../league/{league}/players;out=transaction_trends`                       | 400    | `Invalid player resource transaction_trends requested`         |
| `GET .../league/{league}/players;out=transactions`                             | 200    | a `transactions` node on each player row                       |
| `GET .../team/{team}/roster/players;out=transactions`                          | 200    | the same node on each rostered player row                      |
| `GET .../team/{team}/roster;out=transactions`                                  | 400    | unsupported output on the roster resource                      |
| `GET .../team/{team}/roster;out=opponent,starting_status,transactions`         | 400    | unsupported output; the read must target `roster/players`      |
| `GET .../team/{team}/roster/players;out=opponent,starting_status,transactions` | 200    | roster rows with opponent, starting status, and the trend node |

The per-player node is:

```json
{ "transactions": { "total": "120", "adds": "37", "drops": "3", "trades": "80" } }
```

Every field arrives as a string. The adapter reads `adds` and `drops` as counts and ignores `total`
and `trades`, which count different things and are not published on the trend. A missing
`transactions` node is absence, not zero; a node with `"0"` is a real zero.

The counts matched the provider's public Transaction Trends page for the same current day, and a
league linked to the same provider account saw the same counts. They did not match the historical
counts shown for earlier dates: a `date=` read of the public buzz-index page for a prior day
returned different numbers from the API's current counts. The API payload carries no date, start
time, or window beside the counts. The published meaning is therefore the provider's current day,
across the provider's leagues, for that player. It is not a league-only count, not percent owned,
and not a change in percent owned.

The roster read adds `transactions` to the existing `players;out=opponent,starting_status` request,
so a team's roster and its trends still cost one provider read. Search already reads a bounded player
page and adds `transactions` to the same request. No second trend request exists, because the
provider rejects the dedicated resource and the node is available beside the rows the product
already reads.

## Live trade probes (2026-10-31)

A read-only pass asked whether the provider's own API can carry a trade: whether the published feed
carries proposals, what an accepted trade looks like in it, whether a proposal can be made through
the API, what each owner league's rules are, and who has to act. Every request below was a `GET`
against the stored session of the owner's linked account, issued through the application's
credential service and `PublicInternet`. **No `POST`, `PUT`, `PATCH`, or `DELETE` was sent to the
provider.** The only non-`GET` method used was `OPTIONS`, which changes nothing. The five owner
leagues are named by sport and rule rather than by key; no league key, team key, player key, player
name, manager name, transaction key, or crumb is retained here.

### The feed carries proposals, but only for the manager's own teams

`pending_trade` is a real transaction type the provider publishes, and the plain league feed never
includes it. In the one league that had a live offer, `transactions;count=50` returned 50 rows and
none of them was a `pending_trade`; the offer appeared only when the read asked for that type and
scoped it to the owner's own team.

| Request shape                                                            | Host | Status | Result                                                           |
| ------------------------------------------------------------------------ | ---- | ------ | ---------------------------------------------------------------- |
| `league/{league}/transactions;count=50`                                  | ro   | 200    | 50 rows; `add`, `add/drop`, `drop`, and in one league `trade`    |
| `league/{league}/transactions;type=trade;count=50`                       | ro   | 200    | trades only (10 in the trading league, 0 in the other four)      |
| `league/{league}/transactions;types=trade;count=50`                      | ro   | 200    | the same rows as `type=trade`; only the echoed URI differs       |
| `league/{league}/transactions;type=add;count=50`                         | ro   | 200    | the add/drop family, trades excluded; not a strict single type   |
| `league/{league}/transactions;type=bogus`                                | ro   | 200    | zero rows; an unknown type is accepted and matches nothing       |
| `league/{league}/transactions;type=pending_trade`                        | ro   | 400    | `Team key must be specified to view pending_trade transactions.` |
| `league/{league}/transactions;types=pending_trade`                       | ro   | 400    | same refusal                                                     |
| `league/{league}/transactions;type=pending_trade;team_key={own}`         | ro   | 200    | **one row: the live offer, status `proposed`**                   |
| `league/{league}/transactions;types=pending_trade;team_key={own}`        | ro   | 200    | identical                                                        |
| `league/{league}/transactions;types=waiver,pending_trade;team_key={own}` | ro   | 200    | identical; no pending waiver claim was open                      |
| `league/{league}/transactions;type=pending_trade;team_key={proposer}`    | ro   | 400    | `You are not a manager of this team.`                            |
| `league/{league}/transactions;type=trade;team_key={own};count=50`        | ro   | 200    | zero rows in the trading league; the owner is in none of its ten |
| `league/{league}/transactions;type=trade;team_key={other trader}`        | ro   | 200    | 6 rows, including the trade that team is party to                |
| `transaction/{transaction_key}` for the proposal                         | ro   | 200    | the same record as the collection row                            |
| `transaction/{transaction_key}` for a completed trade                    | ro   | 200    | the same record as the collection row                            |

Two consequences follow. A proposal is visible to the account that manages one of its two teams, and
to nobody else: the same request against the proposer's team was refused with `You are not a manager
of this team.` An owner-scoped product therefore sees its own offers and can never see the league's
other pending trade traffic. That is the correct scope for us, but it means a "league trade wire" is
not available. Only the incoming direction was observed in that pass; the read is scoped to the
owner's team, and the later write probe confirmed that an offer the owner proposed appears through the
same request, as recorded below.

### What a proposal looks like

The proposal record is not a completed transaction with a different status. It is a distinct shape:

```text
transaction_key (string), type: pending_trade, status: proposed,
trader_team_key, trader_team_name, tradee_team_key, tradee_team_name,
trade_proposed_time (epoch seconds as a string), tradee_unused_roster_spots (number),
current_login_can_respond (number), trade_roster_reflect_key (string), trade_note (string),
picks[] { pick { source_team_key, source_team_name, destination_team_key,
                 destination_team_name, original_team_key, original_team_name, round } },
players[] { player_key, player_id, name, editorial_team_abbr, display_position, position_type,
            transaction_data { type: pending_trade, source_type: team, source_team_key,
                               source_team_name, destination_type: team,
                               destination_team_key, destination_team_name } }
```

The observed offer was two players and two draft picks, each with a source and a destination team,
proposed to the owner's team (the owner is `tradee`), sixteen and a half hours old, with
`current_login_can_respond: 1` and `tradee_unused_roster_spots: 0`. Its `trade_note` was empty.

Three differences from a completed transaction matter for decoding. A proposal carries no
`timestamp` and no `transaction_id`; the time is `trade_proposed_time`. Its movements and its
transaction type are both `pending_trade`, not `trade`. And `transaction_key` uses the `pt` form
(`{game}.l.{league}.pt.{id}`), which is the key the documented accept, reject, and cancel calls take.

### What an accepted trade looks like

The trading league published ten completed trades. Every one carried `type: trade`,
`status: successful`, a `timestamp`, and both `trader_team_key` and `tradee_team_key` with inline
names. Every movement was `transaction_data.type: trade` with a source team and a destination team,
so both ends of each player are published and no direction has to be inferred. The ten trades by
players and picks:

| Players | Picks | Count |
| ------- | ----- | ----- |
| 6       | 6     | 1     |
| 4       | 4     | 1     |
| 2       | 2     | 5     |
| 2       | 4     | 1     |
| 1       | 2     | 1     |
| 0       | 4     | 1     |

Draft picks are published as `picks`, never as player movements: one trade moved four picks and no
players at all, and another moved one player for two picks. A pick carries `round` and the source,
destination, and original team keys and names. There is no draft year and no overall pick number, so
a traded pick cannot be identified beyond its round and the teams involved. This confirms the
accepted-trade decoding already in the adapter, including that a pick-only trade is complete.

The plain `count=50` window held only five of those ten trades, because it mixes all types. Reading
trades therefore needs the `type=trade` filter, and the filter's window is independent of the
all-types window.

### The write surface is documented, and untried

The provider's current published documentation describes a full trade write surface on the same v2
API the read path uses. None of it was exercised, because every one of these calls would write.

| Documented call               | Method and resource                                                          | Tried |
| ----------------------------- | ---------------------------------------------------------------------------- | ----- |
| Propose                       | `POST /fantasy/v2/league/{league_key}/transactions`                          | no    |
| Accept                        | `PUT /fantasy/v2/transaction/{key}`, `action=accept`                         | no    |
| Reject                        | `PUT /fantasy/v2/transaction/{key}`, `action=reject`                         | no    |
| Commissioner allow / disallow | `PUT /fantasy/v2/transaction/{key}`, `action=allow` or `action=disallow`     | no    |
| Vote against                  | `PUT /fantasy/v2/transaction/{key}`, `action=vote_against`, `voter_team_key` | no    |
| Cancel                        | `DELETE /fantasy/v2/transaction/{key}`, only before acceptance               | no    |

The documented proposal body, with one `<player>` per asset:

```xml
<fantasy_content>
  <transaction>
    <type>pending_trade</type>
    <trader_team_key>{team}</trader_team_key>
    <tradee_team_key>{team}</tradee_team_key>
    <trade_note>{note}</trade_note>
    <players>
      <player>
        <player_key>{player}</player_key>
        <transaction_data>
          <type>pending_trade</type>
          <source_team_key>{team}</source_team_key>
          <destination_team_key>{team}</destination_team_key>
        </transaction_data>
      </player>
    </players>
  </transaction>
</fantasy_content>
```

The responding calls `PUT` the pending trade's own key with `<action>accept</action>` (or `reject`,
`allow`, `disallow`, `vote_against`) and an optional `trade_note`.

That body carries players only. It has no `picks` element and no documented way to name a draft
pick, so a pick-inclusive proposal — every one of the ten completed trades above moved at least one
pick — has no published request shape at all.

What the read-only pass does establish about the write path:

- The write host (`pub-api-rw`) serves the same transactions collection. For `count=50`,
  `type=trade`, and `type=pending_trade;team_key={own}` in every league the two hosts returned the
  same bodies, differing only in the provider's per-request `time` field, which varies on every
  call. A trade read and a trade write can share one origin.
- The session can mint a crumb: `GET /fantasy/v3/getCrumb` on the service host answered 200 with a
  non-empty `service.crumb`. That is the same prerequisite the working lineup write already uses.
- `OPTIONS` on the transactions collection and on the roster resource answered 200 on both hosts
  with no `Allow` header, so it says nothing either way about which methods are served.

So the documented trade write surface is reachable in principle, but "the API can propose a trade" is
not an observed fact. It stays untried until someone deliberately sends one proposal.

### The authorised probe was refused before it could read the league (2026-10-31)

One trade write probe was authorised for exactly one league: the football league in the table above,
with the authorisation naming a specific team as the owner's. It proposed nothing. The linked
account is not a manager in the named league, so every read the probe needs before it can write was
refused:

| Request shape (GET, session cookie)                                     | Host | Status | Body                                                                        |
| ----------------------------------------------------------------------- | ---- | ------ | --------------------------------------------------------------------------- |
| `league/{league}/teams`                                                 | ro   | 403    | `You are not allowed to view this page because you are not in this league.` |
| `league/{league}/settings`                                              | ro   | 403    | the same refusal                                                            |
| `league/{league}/transactions;type=pending_trade;team_key={named team}` | ro   | 403    | the same refusal                                                            |

This is account membership, not an API-only rule: the same league opened in the signed-in browser
answered the same refusal as a rendered error page. `users;use_login=1/games;game_keys=nfl/leagues`
lists one 2026 football league for the account, and its rules are the football row already recorded
above: `trade_end_date` 2026-11-28, `trade_ratify_type` `vote`, `trade_reject_time` 2. The named
league is a different league, and no team in the listed league carries the named team's name.

No `POST`, `PUT`, or `DELETE` was sent to the provider, so nothing changed in that league or in the
account's own league, whose pending-trade feed was read and was empty before the attempt. A probe
cannot choose a counterparty, two players on each side, or a state to read back before it has a
roster of its own in the league, so the write surface is exactly as untested as it was: this pass
records a gate that failed, not a provider refusal of a trade proposal.

Two consequences. A trade write probe has a precondition the earlier read-only pass never needed:
`league/{league}/teams` must answer 200 for the authorised league, and the response must contain the
team the probe offers from. Without that, there is no owner half of the offer to build and nothing
for the counterparty to respond to. And the refusal is silent to the league, which is the correct
failure mode for a write probe: the door did not open, so nothing was left in front of another
person.

### The refusal belonged to the other connection, not to the stored team (2026-10-31)

The paragraph above is right about what the probe's session saw, and wrong about which connection
that session was. Re-reading the same league through each connection's own stored, encrypted session
settles it. No write was issued; every request was a `GET`.

| Stored connection | Linked     | `470.l.918636` reads                                                                                                                                                               |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| first             | 2026-10-25 | 403 `You are not allowed to view this page because you are not in this league.` on `teams`, `settings`, `standings`, `scoreboard`, `team/{key}/roster`, and the pending-trade read |
| second            | 2026-10-28 | 200 on all six of the same reads, listing `470.l.918636.t.5` in both the league's teams and `users;use_login=1/games;game_keys=nfl/teams`                                          |

The probe's browser session was the first connection's account. The team the authorisation named
belongs to the second connection, so the refusal was an account-membership fact about the probe,
not a fact about the stored team. `470.l.918636.t.5` is readable by the connection that stores it,
and the second connection also answers `settings`, `standings`, and `scoreboard` for that league.

Two consequences. A refusal must be recorded against the team and connection that produced it, with
the provider's own wording, because the same league can be refused for one linked account and
readable for another. And `403` on a league or team read is not a session rejection: the session
proved itself on `users;use_login=1`, so treating the refusal as an expired sign-in would ask the
owner to reconnect a connection that is working.

The stored row also showed the product's own gap: it said `available` from the moment it was linked,
because discovery only proves the account lists the team, and it had never been re-read. Discovery
now also reads each held league and records the team as readable or as unreadable with the reason
and the time, so a team that changes from readable to refused is visible rather than assumed.

### The trade write path is proven: propose, read back, cancel (2026-11-01T00:59Z)

One authorised write probe ran in one league, and it completed. The owner named "the football league
named something like Irish lacrosse football". The linked account has exactly one football league, and it is
`470.l.70271`, named **Irish Lax** — a name that means lacrosse and is not the literal phrase. The
hockey league named `477.l.5744` **Irish Lacrosse** is a different sport and was not touched, and
`470.l.918636` was not touched. Every other league stayed read-only; no request of any method was sent
to any other league.

The probe proposed once, read the proposal back from the owner's pending-trade feed, cancelled it once
with the published `pt` key, and read the feed empty again. The whole lifecycle is recorded here, with
no cookie or crumb retained.

#### Membership was proven before anything was written

The account's leagues were enumerated from the stored session, not assumed:

| Read (GET, session cookie)                                                    | Host | Status | Result                                                                          |
| ----------------------------------------------------------------------------- | ---- | ------ | ------------------------------------------------------------------------------- |
| `users;use_login=1/games;game_keys=nfl/leagues`                               | ro   | 200    | one football league: `470.l.70271` "Irish Lax", 12 teams, 2026                  |
| `users;use_login=1/games;game_keys=nhl/leagues`                               | ro   | 200    | four hockey leagues, one of them "Irish Lacrosse" (`477.l.5744`), none touched  |
| `users;use_login=1/games;game_keys=nfl/teams`                                 | ro   | 200    | `470.l.70271.t.4` "$G-Money$", `is_owned_by_current_login: 1`, manager Graeme F |
| `league/470.l.70271/teams`                                                    | ro   | 200    | all twelve teams, including `470.l.70271.t.4`, marked owned by this login       |
| `league/470.l.70271/settings`                                                 | ro   | 200    | the league and its trade rules                                                  |
| `league/470.l.70271/transactions;type=pending_trade;team_key=470.l.70271.t.4` | ro   | 200    | zero rows before the probe                                                      |
| `league/470.l.70271/transactions;type=trade;count=50`                         | ro   | 200    | zero completed trades                                                           |

This is the gate the previous probe failed: `league/{league}/teams` answered 200 and contained the
team the offer would come from. The pending-trade read for that team also answered 200, so the write
probe could choose a counterparty, two players on each side, and a state to read back.

Trading was open at the time of the probe: `settings` published `trade_end_date` 2026-11-28 with
`trade_ratify_type` `vote` and `trade_reject_time` 2, in the league's current week 8. An accepted
trade here therefore goes to a league vote with a two-day objection window; none of that step was
exercised.

#### The offer was deliberately low-stakes

Two bench wide receivers went each way, players only, no draft picks, no note. Neither side's
starters, best player, or obvious stash was involved; both outgoing players were the owner's bench,
both incoming players were the counterparty's bench, and no player was injured.

| Direction | Player                      | Player key    | From              | To                |
| --------- | --------------------------- | ------------- | ----------------- | ----------------- |
| out       | Khalil Shakir (WR, Buf)     | `470.p.34104` | `470.l.70271.t.4` | `470.l.70271.t.7` |
| out       | Courtland Sutton (WR, Den)  | `470.p.31010` | `470.l.70271.t.4` | `470.l.70271.t.7` |
| in        | Wan'Dale Robinson (WR, Ten) | `470.p.33998` | `470.l.70271.t.7` | `470.l.70271.t.4` |
| in        | Kendrick Bourne (WR, Ari)   | `470.p.30551` | `470.l.70271.t.7` | `470.l.70271.t.4` |

The proposer was `470.l.70271.t.4` "$G-Money$"; the receiver was `470.l.70271.t.7` "kees's Swag
Team". The published league positions make this a shape-preserving swap: both rosters keep six bench
spots and the same starting counts.

#### The exact propose request

```http
POST https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/league/470.l.70271/transactions?format=json_f&crumb=<redacted>
Accept: application/json
Content-Type: application/xml
Cookie: <redacted>

<?xml version="1.0" encoding="UTF-8"?>
<fantasy_content>
  <transaction>
    <type>pending_trade</type>
    <trader_team_key>470.l.70271.t.4</trader_team_key>
    <tradee_team_key>470.l.70271.t.7</tradee_team_key>
    <trade_note></trade_note>
    <players>
      <player>
        <player_key>470.p.34104</player_key>
        <transaction_data>
          <type>pending_trade</type>
          <source_team_key>470.l.70271.t.4</source_team_key>
          <destination_team_key>470.l.70271.t.7</destination_team_key>
        </transaction_data>
      </player>
      <player>
        <player_key>470.p.31010</player_key>
        <transaction_data>
          <type>pending_trade</type>
          <source_team_key>470.l.70271.t.4</source_team_key>
          <destination_team_key>470.l.70271.t.7</destination_team_key>
        </transaction_data>
      </player>
      <player>
        <player_key>470.p.33998</player_key>
        <transaction_data>
          <type>pending_trade</type>
          <source_team_key>470.l.70271.t.7</source_team_key>
          <destination_team_key>470.l.70271.t.4</destination_team_key>
        </transaction_data>
      </player>
      <player>
        <player_key>470.p.30551</player_key>
        <transaction_data>
          <type>pending_trade</type>
          <source_team_key>470.l.70271.t.7</source_team_key>
          <destination_team_key>470.l.70271.t.4</destination_team_key>
        </transaction_data>
      </player>
    </players>
  </transaction>
</fantasy_content>
```

The crumb came from `GET /fantasy/v3/getCrumb?format=json_f` 200. The body is the documented shape
verbatim: two-sided movements, players only, no picks, and an empty `trade_note`, which the provider
accepted. The response was **201**, and it was the full league payload with the new transaction
already inside it, so the `pt` key is available synchronously from the propose response as well as
from the pending feed.

#### Read-back

The owner-scoped pending read returned exactly one row:

```text
transaction_key: 470.l.70271.pt.10, type: pending_trade, status: proposed
trader_team_key: 470.l.70271.t.4 ($G-Money$)
tradee_team_key: 470.l.70271.t.7 (kees's Swag Team)
trade_proposed_time: 2026-11-01T00:59:58.000Z
current_login_can_respond: 0, tradee_unused_roster_spots: 0, trade_note: empty
players: Khalil Shakir t.4->t.7, Courtland Sutton t.4->t.7,
         Wan'Dale Robinson t.7->t.4, Kendrick Bourne t.7->t.4
picks: none
```

Both parties, both ends of every movement, the `pt` key form
(`{game}.l.{league}.pt.{id}`), and the empty picks array are all as the earlier read-only pass
predicted. `current_login_can_respond` is 0 because this session is the proposer; the receiver is the
one who can respond.

The read-back also confirmed that nothing else changed. The league's team list, settings, and both
rosters matched the preflight reads field-for-field; `type=trade` still returned zero rows; and the
plain `transactions;count=50` window held exactly the same fifty `tr` keys before and after. The
pending trade never appeared in the all-types feed, only in the typed, team-scoped read.

#### Cancel and final state

```http
DELETE https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/transaction/470.l.70271.pt.10?format=json_f&crumb=<redacted>
Accept: application/json
Cookie: <redacted>
```

The response was **204** with an empty body. The pending feed for the owner's team then returned zero
rows, and `GET transaction/470.l.70271.pt.10` answered **400** with `Transaction ID
470.l.70271.pt.10 does not exist.` The provider does not publish a cancelled record; the offer is
deleted. Rosters, teams, settings, and the plain transaction window were unchanged again at the final
read. No second proposal and no second cancel was sent.

#### Lifecycle and the window another manager had

| Event                               | Time (UTC)               |
| ----------------------------------- | ------------------------ |
| preflight read completed            | 2026-11-01T00:59:57.649Z |
| propose sent                        | 2026-11-01T00:59:57.894Z |
| propose 201 received                | 2026-11-01T00:59:58.552Z |
| provider `trade_proposed_time`      | 2026-11-01T00:59:58Z     |
| read-back completed (offer present) | 2026-11-01T01:00:00.475Z |
| cancel sent                         | 2026-11-01T01:00:00.476Z |
| cancel 204 received                 | 2026-11-01T01:00:00.759Z |
| final read completed (feed empty)   | 2026-11-01T01:00:02.453Z |

A counterparty could have seen the offer for at most **2.76 seconds** — from the provider's proposal
second to the cancel taking effect — and for at least 1.76 if the proposal landed at the end of that
second, because the provider publishes whole seconds. Between our own 201 and the cancel response the
observed window was 2.21 seconds. The counterparty's session was never used, and no acceptance,
rejection, vote, or commissioner action was sent, and the feed was empty again two seconds after the
cancel.

#### What this probe does and does not prove

Proven from the owner's own session, in this league:

- a two-sided, player-only `pending_trade` is accepted with 201 and a `pt` key;
- the proposer can read that offer back from `type=pending_trade;team_key={own}` with both parties,
  both ends of all four movements, `status: proposed`, the proposal time, and no picks;
- the proposer can cancel it before acceptance with `DELETE /fantasy/v2/transaction/{pt}`, which
  answers 204 and removes the record;
- an empty `trade_note` is accepted, and the propose response is a league payload carrying the new
  transaction.

Not proven, and not to be built from this pass:

- **Accept, reject, vote, allow, disallow.** None was sent; every one needs the counterparty's or a
  commissioner's session. The `vote` ratification rule was never exercised, so the objection window
  and vote counting remain unobserved.
- **The proposal as the counterparty sees it.** The read is team-scoped and we read only our own
  team. That the receiver can open and respond to the offer is the provider's documented behaviour
  and follows from the earlier finding that only a manager of one of the two teams may read the row,
  but it was not observed from the receiver's session.
- **Picks.** Only the documented players-only body was sent. A pick-inclusive proposal still has no
  published request shape, and every completed trade in the earlier sample moved at least one pick.
- **A cancelled record.** The provider deletes the offer rather than publishing a cancelled status,
  so a product must treat "absent from the pending feed" as cancelled, not expect a record.
- **A retried or duplicated propose.** Exactly one was sent. Idempotency of a repeated POST is
  unknown.

One decode detail: the pending-trade movements arrive with `transaction_data.type: pending_trade`, so
the adapter classifies them as movement kind `other`, not `trade`. The pending-offer surface uses
`from` and `to` and does not expose the kind, so this is not user-visible today; a later consumer that
filters on `kind === "trade"` would drop every proposal movement.

### Player add/drop and reserve moves (2026-10-31)

No live provider write was performed: no disposable league was available, so the request shapes
below are recorded from the adapter's fake-provider tests and the reference implementation's working
add/drop writer. They are the shapes the application sends; whether this provider accepts them on a
given league remains a live-acceptance item.

One item is one provider transaction. A swap carries the add and the drop together, with the add
before the drop, and a single-player move uses `<player>` directly rather than a `<players>` wrapper:

```xml
<fantasy_content>
  <transaction>
    <type>add/drop</type>
    <players>
      <player>
        <player_key>{add}</player_key>
        <transaction_data>
          <type>add</type>
          <destination_team_key>{team}</destination_team_key>
        </transaction_data>
      </player>
      <player>
        <player_key>{drop}</player_key>
        <transaction_data>
          <type>drop</type>
          <source_team_key>{team}</source_team_key>
        </transaction_data>
      </player>
    </players>
  </transaction>
</fantasy_content>
```

`type` is `add`, `drop`, or `add/drop` from which movements are present. A waiver claim adds the
claim's bid as `<faab_bid>{bid}</faab_bid>` before the players; a free-agent add sends no bid. The
request is `POST https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/league/{league_key}/transactions`
with `format=json_f` and the session crumb.

A reserve move is a separate request, before the add, against the roster resource:

```xml
<fantasy_content>
  <roster>
    <coverage_type>date</coverage_type>
    <date>2026-10-31</date>
    <players>
      <player>
        <player_key>{player}</player_key>
        <position>IR</position>
      </player>
    </players>
  </roster>
</fantasy_content>
```

It is `PUT .../team/{team_key}/roster` with the same `format=json_f` and crumb. A week-covered league
sends `<coverage_type>week</coverage_type><week>{week}</week>` instead. One item opens at most one
reserve slot; more than one needed spot is refused as stale rather than guessed.

Outcomes are mapped once, with no retry: 2xx is accepted; 400 is rejected with the provider's
`<description>` (or JSON `error.description`) surfaced to the person; 404 is `not_found`; 408/429 are
`not_sent`; 401/403 reject the session; 5xx and transport timeouts are `unknown` because the request
may have applied. The spans record the operation and outcome, never the crumb, cookie, or provider
body.

### League trade rules

`GET /fantasy/v2/league/{league}/settings` publishes the three trade fields in every owner league.
All five are inside their trading window on 2026-10-31.

| League             | `trade_end_date` | `trade_ratify_type` | `trade_reject_time` |
| ------------------ | ---------------- | ------------------- | ------------------- |
| football           | 2026-11-28       | `vote`              | 2                   |
| hockey, vote       | 2027-03-03       | `vote`              | 2                   |
| hockey, none       | 2027-03-03       | `none`              | 0                   |
| hockey, commish #1 | 2027-03-03       | `commish`           | 2                   |
| hockey, commish #2 | 2027-03-03       | `commish`           | 2                   |

`none` is a published value meaning no ratification step. It is the only owner league with completed
trades in the window, and the league where the live offer is waiting. The adapter currently maps it
to `unknown`, which reads as "a rule this server cannot name" rather than "no review". That is a
decode gap to close, not a missing field.

### The website routes a person uses

The league web page links three trade routes per league, which are the only verified trade
destinations the provider publishes:

| Route                                  | Purpose                                |
| -------------------------------------- | -------------------------------------- |
| `/{sport}/{league_id}/trade_hub`       | propose, review, and respond to trades |
| `/{sport}/{league_id}/playertrades`    | completed player trades                |
| `/{sport}/{league_id}/showtradedpicks` | traded draft picks                     |

None is parameterized by player, counterparty, or pending trade, so none can prefill a proposal. A
link can open the hub; it cannot open a filled-in offer.

### What this contradicts

`MCP.md` states that the provider publishes no proposals resource and that pending trade offers are
not available to any client. That is no longer true of the provider: a `pending_trade` row is
published to the managing account, with the parties, both ends of every movement, the picks, and the
key the respond calls take. Our tools now request the type: `get_pending_trade_offers` reads that
feed read-only, so the correction this paragraph asked for has been made.

### Verdict

**Supported for proposing and withdrawing from the owner's own session; every call that needs the
other side of the trade is still unproven.**

Reading is supported and observed: proposals and accepted trades are both published, with two-sided
movements, teams, and picks, and the proposal record carries the key the respond calls take. The
write half is now observed for the owner's own side. One two-sided, player-only proposal was accepted
with 201, read back from the owner's pending feed with both parties and all four movements, and
cancelled with 204 using the published `pt` key, leaving the feed empty. The offer existed for at
most 2.76 seconds.

Everything past that still belongs to the other manager. Accept, reject, and the league's `vote`
ratification were not exercised, and no design of ours can act in another manager's session. A
pick-inclusive proposal still has no documented write shape, and the provider publishes no cancelled
record, so withdrawal is confirmed by the row disappearing rather than by a status. Our app can
carry a trade through propose and withdraw on the owner's behalf, and still cannot carry one past the
handoff.

The two earlier attempts explain the gate rather than contradict this. The first never reached the
provider because its account was not a manager in the named league; the second showed the refusal
belonged to the other connection. The probe recorded above passed that gate by reading
`league/{league}/teams` 200 and finding the owner's team before writing.

### What the review screen should offer for trades

Offer, in this order:

1. **Read the owner's own proposals.** A bounded `type=pending_trade;team_key={own}` read beside the
   existing completed-trade read, decoded into the same two-sided movement and pick vocabulary, with
   `status`, `trade_proposed_time`, the two parties, and whether this session can respond. This is
   proven and is the part that makes agent-proposed trades reviewable at all.
2. **Show the league's rules beside the offer.** Ratification (`vote`, `commissioner`, or none), the
   objection window in days, and the trade end date, so the screen can say who acts next and whether
   trading is still open. `none` must read as "no review", not `unknown`.
3. **Propose a two-sided, player-only trade.** Build it from the owner's team and one counterparty's
   team, players only, through `POST /fantasy/v2/league/{league}/transactions` with the documented
   body and crumb. Keep the `pt` key from the 201, and show the stored offer from the pending feed
   before claiming it exists. This shape is now proven; pick-inclusive proposals are not.
4. **Withdraw the owner's own proposal before acceptance.** `DELETE /fantasy/v2/transaction/{pt}`
   answers 204 and removes the record. Treat the row's disappearance from the pending feed as the
   confirmation; the provider publishes no cancelled state. Withdrawal after acceptance is outside
   the documented contract.
5. **Open the league trade hub.** A verified, league-scoped link with no query parameters, labelled
   as the place to act. It cannot prefill, and the screen must say so.
6. **State the handoff plainly.** For an incoming offer, the owner accepts or rejects on the
   provider; for an offer the owner makes, the counterparty does. The screen tracks the offer's
   status; it does not claim to complete it.

Do not build: an accept, reject, or vote button; pick selection in a proposal form; a league-wide
trade feed; or a claim that the counterparty has seen an offer. Each either writes a call that needs
the other manager's session, promises a request shape the provider has not published, or asserts an
observation the team-scoped read cannot make.

A proposal control now has the evidence it was missing: one probe completed propose, read-back,
cancel, and an empty feed again, with 201 and 204 and the `pt` key form recorded above. What it still
lacks is the counterparty half — a proposal another manager actually received and answered — so the
screen may propose and withdraw, and must hand the rest to the provider. The requirement is to tell
the owner, before they send, that this puts a real offer in front of another person, and that only
their counterparty can accept or reject it.

## Live add/drop refusal (2026-11-03)

The owner authorised one controlled submission against the hockey team **Meier? I barely know her!**
in the league **Irish Lacrosse** (`477.l.5744`, team `477.l.5744.t.6`): add Sean Walker
(`477.p.7751`) and drop Kris Letang (`477.p.4064`). Two real submissions in the app had failed with
HTTP 400 while the person was shown no wording from the provider. The probe used the stored,
encrypted provider session the way the trade probe did, and its only non-`GET` request was this one
`POST`. **One submission reached the provider and nothing was retried.** The script stopped twice
before sending: once because the crumb response was an HTML page and once because the crumb payload
shape was wrong. Neither attempt reached the provider; the third run sent the one submission below.

### The exact request

```http
POST https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/league/477.l.5744/transactions?format=json_f&crumb=<redacted>
accept: application/json
content-type: application/xml
cookie: <redacted>

<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>add/drop</type><players><player><player_key>477.p.7751</player_key><transaction_data><type>add</type><destination_team_key>477.l.5744.t.6</destination_team_key></transaction_data></player><player><player_key>477.p.4064</player_key><transaction_data><type>drop</type><source_team_key>477.l.5744.t.6</source_team_key></transaction_data></player></players></transaction></fantasy_content>
```

The captured response is checked in at
[`yahoo-transaction-refusal-2026-11-03.json`](../../packages/backend/src/contexts/connections/fixtures/yahoo-transaction-refusal-2026-11-03.json).
That file records the date, the league, the team, the exact request, and the full response body. The
provider echoed the request URI in `yahoo:uri`; its crumb value is stored as `<redacted>`.

### The refusal

```text
HTTP 400 Bad Request
{
    "error": {
        "xml:lang": "en-us",
        "yahoo:uri": "\/fantasy\/v2\/league\/477.l.5744\/transactions?format=json_f&amp;crumb=<redacted>",
        "description": "Player Travis Konecny is in a IR position on your roster, but is no longer on the real-life IR.  Please edit your lineup to activate this player from your IR and then attempt your transaction again.",
        "detail": null
    }
}
```

The move did not happen: HTTP 400 is the provider refusing the whole transaction, so the roster was
unchanged and nothing needed undoing. The refusal does not name Sean Walker or Kris Letang. It names
a third player, Travis Konecny, who was sitting in an IR slot while no longer being on the real-life
IR. The provider refuses every transaction for a team that carries such a player, even a request
that does not mention him. That is why this move failed.

### What the product now does with it

- A write response is now read inside the request's own scope. Before this, the abort signal behind a
  write response was released as soon as the request call returned, so the body could not be read at
  all. A refusal that arrived with a reason looked exactly like a refusal that arrived with nothing.
  That is the production symptom: the provider did say why, and the app could not hear it.
- The adapter reads the provider's own sentence from `error.description`, and from an XML
  `description`, `message`, or `error` element when the provider answers in XML.
- When no named reason can be read, the adapter keeps the response body's own text, with crumb
  values replaced by `<redacted>`, instead of discarding it.
- A refused transaction, withdrawal, reserve move, or trade offer carries one sentence on the review
  page and in the MCP result: `The provider rejected the transaction with HTTP 400. It said: ...`
  followed by the provider's words. When the provider sent no words at all, the sentence says so.

This probe did not read the roster back, because the refusal itself establishes that nothing was
applied. It made no second submission, and no other league or team was touched.
