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

- Fantasy session material is the `T` and `Y` cookies; the pair the linking helper extracts is sufficient for every request above.
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
  `IR-LT`. No other code appeared, so any other code is mapped to an unknown condition rather than
  guessed.

### Still unverified after this pass

- Every write path, including native start-active and explicit assignment requests. The native
  writes were verified later on 2026-10-25 and explicit assignments on 2026-10-26; see the two write
  sections below.
- Whether Yahoo accepts a starting slot left empty, and whether the declared bench count is a hard
  maximum rather than a pooled standard-roster allowance.
- Lock transitions inside a scoring day for date-scoped hockey leagues.
- Any per-player remaining-games, probable-starter, or projection signal.

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

- **A changed explicit assignment.** Every change the plan would make requires moving a locked
  player. The only two editable players are bench players whose remaining legal destination is the
  same bench position, so no expressible change existed at the time of the write. The changed path
  is proven against the behavioural provider fake and the documented rule, not live. A second live
  pass is needed after the week rolls, with an editable roster, to show a changed assignment and
  its readback.
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

### Read-only batch-history re-verification (2026-10-26)

A second read-only harness (`.artifacts/phase2-evidence/history-read.ts`) exercised the worker's
batched `readPlayerHistory` operation against the same team after the implementation settled. It
requested the four-week observation window in one operation (one bounded request per period),
received 15 player details for each week with actual statistics, and reproduced the 114.41-point
plan, 9/9 starting positions, zero changes, and a `no_op` translation. No write was sent. This
verifies the worker's history read path live; the changed-assignment write path remains
fake-tested only.

Still unverified after this pass:

- A changed explicit assignment accepted and verified live.
- Whether an assignment for a locked player is rejected with a specific provider error (the adapter
  never sends one).
- Whether a reserve-list position (`IR`, `IR+`, `NA`) is accepted by this roster endpoint; the
  adapter refuses reserve-list moves rather than relying on it.
- Whether a starting slot left empty is accepted, and whether the bench count is a hard maximum or a
  pooled allowance.
- Concurrent human edits between the pre-write read and the provider applying the request. No
  provider compare-and-set or idempotency token exists; the adapter detects edits visible in the
  pre-write re-read and relies on all-or-nothing rejection otherwise, but cannot eliminate the
  final window.
