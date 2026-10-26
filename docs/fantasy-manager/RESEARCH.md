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
