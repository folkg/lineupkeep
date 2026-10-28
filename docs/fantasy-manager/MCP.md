# MCP contract plan

Status: proposed surface and acceptance criteria. Names other than the agreed generic `set_lineup` are working names for final review, not an implementation registry.

## Interface principles

- Generic domain operations; resolve provider behavior from owned connection/team/league references.
- Minimal current-use-case fields, no diamond/cohort interface, Yahoo endpoint selectors, arbitrary URLs, query languages, raw payloads, or agent code execution.
- Backend services are batch-first. Tool schemas expose bounded collections where useful; no upstream N+1 work hidden behind a bulk tool.
- Progressive discovery: list compact resources, then select fields and bounded players/teams for detail.
- Explicit actual/projected meaning, period coverage, scoring context, freshness, missingness, and partial failure.
- App-user OAuth and provider linking are separate. Tools never return credentials or internal manager/account identity data.
- MCP transport remains stateless even though runs, linking, and authorization grants are durable.

## Proposed tool families

| Tool                                | Purpose and important limits                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_connections`                  | Safe owned provider connection metadata/status only                                                                                               |
| `list_teams`                        | Compact owned team discovery with season/sport/connection filters; stable paging                                                                  |
| `get_calendar`                      | Valid current/historical periods and relevant fantasy-day/lock context; no guessed week equivalence                                               |
| `get_league`                        | Selected league settings, scoring definitions, roster rules, and standings with records, season points, and category totals; bounded groups/pages |
| `get_rosters`                       | Exact selected team/period rosters, compact by default; professional-team abbreviation on every entry                                             |
| `search_players`                    | Bounded league/sport-context player search with ownership/started signals and validated sorts                                                     |
| `get_players`                       | Bounded selected-player hydration including generic stats/projections/availability groups                                                         |
| `get_matchups`                      | Selected matchup/scoreboard data with explicit period, category values/winners, and remaining player-games                                        |
| `get_transactions`                  | Bounded transaction history with team scope and date filtering; no execution                                                                      |
| `get_team_summary`                  | One bounded per-team snapshot: league, standing and record, standings, current matchup, and compact roster                                        |
| `generate_transaction_review_links` | Typed add/add-drop/drop/trade review intents; return provider human-review URLs only                                                              |
| `set_lineup`                        | The sole roster mutation operation; creates durable team runs and returns verified or pending outcomes                                            |
| `set_team_automation`               | Enable, disable, pause for the rest of the fantasy day, or resume owned team automation; reports resulting state                                  |
| `get_lineup_runs`                   | Owned run status, safe concise explanations, observed changes, and unresolved conditions                                                          |

Do not expose a general policy-mode selector, native/premium action selector, custom formula, or fallback override. Return the implementation actually used. The MCP surface covers automation enrollment, pause, and resume because an agent must be able to manage a team it owns; it still does not expose registration, helper secret upload, or every frontend control as tools.

A league/opponent read requires verified access through the user's connection; it does not permit managing another team's lineup. Tool annotations and scopes do not replace ownership enforcement in backend services.

## `set_lineup` behavior

Inputs: explicit owned team references and validated target periods, plus stable request identity. MCP's protocol request ID is not assumed to be a durable retry identity. Decide one stable client request field with clear same-key/different-intent rejection.

Phase 1 uses the provider's native lineup action; Phase 2 uses the custom optimizer after direct cutover. No transaction execution or provider-premium optimization.

Response includes per-team run reference, status, implementation, target period, observation time, and safe change/no-op/blocked/pending explanations. A bounded wait may return pending work; `get_lineup_runs` retrieves the result later. Do not report success merely because work was queued or a provider returned HTTP 200 with invalid coverage.

Manual authorized requests may run while paused/disabled without enabling automation. They still obey ownership, connection availability, legal/locked assignments, and unresolved-write protection.

## `set_team_automation` behavior

Inputs: a bounded batch of owned private team ids, each with exactly one action: `enable`, `disable`, `pause-today`, or `resume`. Provider team keys, league ids, and connection ids are never accepted here.

`enable` and `disable` change enrollment without deleting team configuration. `pause-today` suspends scheduled work until the end of the team's provider fantasy day, computed with Effect DateTime named-zone arithmetic, and returns the resulting `resumesAt`, time zone, and fantasy day. `resume` clears an active pause. A repeated action is an `unchanged` no-op with the same resulting state, not an error; an action that contradicts the current state is `rejected` with the reason and the unchanged state.

Availability is separate from enrollment. An unavailable team keeps the requested automation setting, reports `availability: "unavailable"`, and remains skipped by scheduled checks. Ownership is enforced in the team service, so another owner's id is `not_found`, not a forbidden-with-details response. Responses report each input in order with its outcome, enrollment, availability, and full automation state, so an agent does not need to re-read before the next action.

This tool changes only durable Lineupkeep automation state; it never contacts the provider. `set_lineup` remains the sole provider mutation and continues to bypass enrollment for a manual run while honoring ownership, connection readiness, availability, locks, and uncertain-write protection.

## Feedback behavior

Feedback is one owner-scoped record for a bug, data issue, friction report, or wishlist item. `submit_feedback` records the acting account's report and returns its id and `open` status; `list_feedback` returns that account's reports in newest-first order with optional status, kind, and start-time filters; `triage_feedback` acknowledges, resolves with a note, or closes as not planned.

An agent acting for a person may read and close that person's reports, because the account granted `feedback:manage` and every query is filtered to its owner. Filing a report needs only `connections:read`, so the person's agent can always report a problem; reading and closing existing reports needs the manage scope. There is no agent-wide, operator, or support queue, and no tool widens access to another account's reports: a foreign report id is `not_found`, not a forbidden-with-details response. The owner's intent is that the person's own agent can file, follow up, and close without the product owner relaying messages by hand.

Status is `open`, `acknowledged`, `resolved`, or `wontfix`. `resolve` requires a resolution note and sets the closure time; `wontfix` accepts an optional note. Repeating the current action is an `unchanged` no-op with the resulting record, and an action that contradicts a closed report is `rejected`: closure is final, so report the problem again if it returns. Results echo each requested action in order with its outcome, status, note, and a safe explanation.

Submission is bounded and rate-limited: title ≤ 120 characters, body ≤ 4000, note ≤ 2000, control characters removed, and user text always returned as plain text. An account may submit 20 reports per clock hour and one acting client label may submit 10; the per-account limit is the backstop, so a client that renames itself cannot exceed it, and a refusal names the retry delay in seconds. Reports must never contain passwords, provider cookies, account identifiers, or raw provider payloads. Open and acknowledged reports are retained as current work; resolved and not-planned reports are deleted 180 days after closure.

## Budgets and paging

Initial service policy: aim for about 12 KiB and enforce a 16 KiB model-facing application-result ceiling. These are our proposed application budgets, not claimed Muse/MCP limits. The measurement counts both representations a client receives: `structuredContent` and the JSON text copy that a text-only client reads. Keeping the text copy follows the specification's backwards-compatibility recommendation, so a structured page fills about half the ceiling instead of dropping the copy and halving what a text-only client can use.

- Bound both row counts and encoded UTF-8 bytes, including metadata and continuation information.
- Return complete records. Do not truncate strings midway, silently drop requested fields, or mark omitted values zero.
- If a requested record cannot fit, return an actionable narrowing-required result listing the requested group/record causing the issue.
- Continuations bind the owner, query, selection, period, stable ordering, and expiry; they are not arbitrary database offsets or raw provider URLs.
- Distinguish an internally paged upstream collection from a stable application snapshot. If the provider cannot provide snapshot consistency, disclose that concurrent upstream changes may affect traversal.
- No silent subset success for exact requested teams/player keys. Return explicit per-resource failures/omissions with reasons and meaningful completion metadata.
- Keep per-record failures and page metadata bounded; many failures must not bypass the byte budget.

Starting adapter bounds can reuse verified selected-player batches of at most 25 keys and bounded upstream search pages. These are configuration proposals informed by research, not universal provider limits. Agent pages can be much smaller than upstream pages.

Upstream response caps are separate from agent-output caps. The adapter may fetch a bounded megabyte-scale response, decode and select fields, then return a small page. Filtering statistics upstream was not demonstrated by earlier Yahoo probes; local projection must not pretend it saved upstream bytes.

## Analysis surface behaviour

`get_league` with the `standings` group reports each team's rank, the format inferred from the
provider's scoring type and modifiers, and the record the provider actually publishes. A
rotisserie league publishes rank, season points, points back, and per-category rotisserie points
but no win-loss record; the row simply omits `record`, and `record` in `get_team_summary` says so
with a reason. Every category entry is `{ stat, status: "published", value }` or
`{ stat, status: "not_published", detail }`: a category the provider tracks but publishes no value
for is stated, never returned as a silent null and never flattened to zero. A provider stat id
with no league scoring definition cannot be labelled, so it is omitted from both category arrays
and counted in the section-level `omittedCategories` declaration. The
`categoryTotals`/`categoryPoints` coverage states whether any value was published, so an empty
array is never read as zero. When standings are requested, that response pages teams; otherwise it
pages scoring categories. `get_matchups` and the summary's matchup section use the same
`{ stat, status, value }` category entry, so a scoring-week category with no published value is
stated the same way.

`get_matchups` carries per-category values and the category winner (or a tie) for category
leagues, plus `remainingGames` for the scoring week where the provider publishes it. Its `schedule`
section states the unit or declares the capability unsupported with the reason: Yahoo publishes
that remaining-game count only as a fantasy-team total of player-games (National Hockey League),
and a football player plays at most one game per scoring week. The provider publishes no per-player
or per-professional-team remaining-game count and no probable-starter field, so `get_rosters`
returns a `playerSchedule` declaration saying so and reports `proTeam`, injury, and the bye week
where published; `search_players` reports provider ownership/started percentages without inventing
either.

`search_players` rows carry the value each provider-ordered sort uses: `actualRank` (the provider's
current-season rank, which orders `actual_rank`), `overallRank` (which orders `overall_rank`), and
`statValue` (the season value of the requested `stat`, present only for a `stat` sort). A client can
therefore check the order it received without a second read. Provider ownership and started
percentages and their changes are null only when the provider published no value for that row, and
the field descriptions say so. Weekly rank and stat sorts are refused with the remedy because the
provider's search payload publishes only season values for them; offering the sort would return an
order the rows cannot explain.

`get_transactions` maps `scope: team` onto the provider's team filter. The provider has no date
filter: `since`/`until` filter the bounded window the provider returns, `window` reports how many
events were fetched, the oldest and newest timestamps, and whether the window was exhausted, and a
range older than the window is reported as `transaction_window_truncated` with degraded coverage
instead of a silently incomplete success.

`get_team_summary` composes the league overview, the linked team's standing, record, category
totals, league standings, current matchup, this week's and next week's remaining player-games, and
a compact roster. Each section states its own availability, so a failed standings read leaves the
roster and matchup intact. The schedule section names its unit (`fantasy_team_player_games`),
because that is the only granularity Yahoo publishes; football declares the section unsupported
with the bye-week alternative, and probable starters are always declared unsupported because no
read shape exposes them. The roster section pages inside the same 12 KiB target and 16 KiB ceiling
as every other read.

## Coverage correctness

A period reference must be resolved against the provider calendar, sport, season, and league. Day, scoring-period/week, and season datasets are not interchangeable. Ancillary coverage is retained or explicitly distinguished.

Do not advertise multi-week aggregation, advanced-stat availability, diamond data, all legacy sorts, or NHL projection completeness without proof. Rates, percentages, ratios, and time-on-ice averages are not summed like counts. Missing games/stats are not automatically zero.

Separate roster membership reads from bounded player hydration. Live verification found no projected-statistics series in the provider's read surface: completed weeks report actual values, while the current and future weeks report zero rather than projections. Projections therefore stay typed unsupported unless a future verified read proves otherwise. See [live read endpoints](RESEARCH.md#live-yahoo-read-endpoints-2026-10-25).

Actual statistics state their basis: `week` with the covered period when the provider publishes weekly series, otherwise `season`. A client must not compare a season total against a weekly value, and the read reports the basis it used rather than relabelling one as the other. Player identity resolves from the roster, then selected-player hydration, then transaction history, so a player who is no longer rostered anywhere is still named by the drop side of an add/drop; the transaction payload carries the name, display position, and editorial team, but no primary position, so identity there may omit it.

A coverage entry has one of three states. `available` means the resource was read and verified. `unsupported` means the provider or league does not establish it, and the entry, or a typed group result beside it, carries the reason. `degraded` means a dependency could not be verified while the read still returned what does not depend on it: the entry names the failed field, the affected resource lists a bounded failure, and roster and matchup reads are not erased because league settings failed. A calendar that needs the scoring-week window reports the degraded dependency instead of inventing periods. A group that declares itself unsupported never also reports a period failure; the two statements would contradict each other.

## Review-link safety

Generate links from typed domain intents and verified relationships. Users may choose players/counterparty, not origins, endpoint stages, or submission parameters. Validate provider, league, owning team, membership, and numeric-ID mapping privately.

Return a clear human-review instruction and no guarantee of add/drop/trade eligibility. No POST/PUT execution, final confirmation automation, waivers/bid submission, or multi-add/drop behavior not validated by the adapter.

Every result carries `linkTemplate: { provider, version }`, so a client can detect a stale link
template after an upgrade without guessing from URL shape. The Yahoo template
(`yahoo-review-links-v2`) emits an `addplayer` review page for `add` and `add/drop`, and a
team-scoped `dropplayer` page for `drop`; each was verified against the provider as the intended
review page for the named player. The provider publishes no parameterized trade proposal page, so a
`trade` intent returns `unsupported` with that reason instead of a link that opens an empty form.
Review links are season-independent; a provider template change requires a version change and a new
per-sport URL fixture test.

## Client onboarding and scopes

### Per-tool scopes

Every tool enforces one scope, and only that scope. Holding a scope no tool needs, or
lacking a scope a different tool needs, does not change whether a call succeeds.

| Tool                                | Required scope        |
| ----------------------------------- | --------------------- |
| `list_connections`                  | `connections:read`    |
| `list_teams`                        | `fantasy:read`        |
| `get_calendar`                      | `fantasy:read`        |
| `get_league`                        | `fantasy:read`        |
| `get_rosters`                       | `fantasy:read`        |
| `search_players`                    | `fantasy:read`        |
| `get_players`                       | `fantasy:read`        |
| `get_matchups`                      | `fantasy:read`        |
| `get_team_summary`                  | `fantasy:read`        |
| `get_transactions`                  | `fantasy:read`        |
| `generate_transaction_review_links` | `transactions:review` |
| `set_lineup`                        | `lineups:write`       |
| `get_lineup_runs`                   | `lineups:write`       |
| `set_team_automation`               | `teams:manage`        |
| `submit_feedback`                   | `connections:read`    |
| `list_feedback`                     | `feedback:manage`     |
| `triage_feedback`                   | `feedback:manage`     |

A scope-coverage test derives this table from the tool declarations, so a tool that omits a
scope fails the test suite instead of becoming an open endpoint.

`submit_feedback` requires `connections:read` rather than `feedback:manage`. Submission creates
only the acting account's own report under the same rate limits and owner scoping as before, and
it is the channel for reporting the scope problem itself, so it cannot sit behind a manage grant.
Listing and triage remain `feedback:manage`: a client with only read scopes can file a report and
can neither read nor change one.

### First authorization

Request this minimal baseline first:

```text
connections:read fantasy:read offline_access
```

It reads connections and fantasy data, submits feedback, and buys a refresh token. Every other
tool answers `403 insufficient_scope` naming the one scope it needs; authorize again for that
scope and keep the existing grant. The complete authorization-server set is
`connections:read fantasy:read transactions:review lineups:write teams:manage feedback:manage offline_access`.
A client platform that refuses `teams:manage` or `feedback:manage` still reads, submits feedback,
and runs the tools it was granted.

An unauthenticated request gets `401` with the protected-resource metadata link and a `scope`
naming only what the request needs: the called tool's scope for `tools/call`, and the baseline
above for a request that names no tool (`initialize`, `tools/list`). The body repeats the
plain-language remedy and never asks for the whole advertised set. A `403` names the called tool's
missing scope in both the `WWW-Authenticate` challenge and the body. `server/discover` answers
without a token and publishes only the product name, supported protocol versions, and
capabilities.

### Adding a scope

Scope enforcement is per tool, so a token issued before a new scope existed keeps working for
every tool whose scope it already holds; only a tool that declares the new scope answers `403`.
Adding a scope is an additive change to the advertised set, not a grant reset. Dynamic
registration records the whole advertised set as a client's capability ceiling, and the
application widens a stored dynamic registration that predates a newly advertised scope, so an
existing client can step up without re-registering. An authorization grant remains exactly the
scope the authorize request asks for.

A client that requests a newly advertised scope and receives `invalid_scope` is hitting a stored
registration ceiling, not a metadata cache: the authorization server validates the request
against the scopes persisted when the client registered, and Client ID Metadata Document clients
refresh that record from their own document on every authorization. The step-up failure reported
against the seven-scope request was this ceiling, amplified by the old `401` telling the client
to request the whole set in one authorization.

### Discovery documents

Authorization-server metadata publishes all seven scopes above. Protected-resource metadata
publishes the six resource scopes and omits `offline_access`. That difference is deliberate:
[RFC 9728 §2](https://www.rfc-editor.org/rfc/rfc9728#section-2) defines protected-resource
`scopes_supported` as the scope values used to request access to that resource, while
[OpenID Connect Core §11](https://openid.net/specs/openid-connect-core-1_0.html#OfflineAccess)
defines `offline_access` as a request to the authorization server for a refresh token, not an
access right on the resource. A test pins both lists and this single difference.

Access tokens last five minutes; refresh tokens last 30 days from issue or last rotation. The
refresh grant rotates on every use. A client must request `offline_access` on the first
authorization and persist each returned `refresh_token`; a rotated-out token is accepted for 30
seconds so a retried refresh can recover, then reuse is treated as replay and revokes the whole
grant for that client and person. A client that keeps reusing an already-rotated token therefore
loses the connection at its next renewal and must authorize again. The full request and response
shape, including the public-client refresh with no secret, is in the
[client setup](../../README.md#token-lifetime-and-renewal).

Complete first-request examples, header and `_meta` requirements, and the registration fallback
are in the [client setup](../../README.md#connecting-an-mcp-client).

## Client acceptance

Use actual hosted Muse with a harmless read first: discovery, OAuth/consent, correct scopes, egress, an access-token expiry followed by a public-client refresh rather than a reconnect, structured/text output, continuation use, and bounded-run waiting. Do not assume Muse's managed browser can execute the local helper.

OpenCode is a possible fallback after an actual test. Pi compatibility can improve later; retain the starter's stateless/serverless transport rather than adding a legacy/stateful branch.

Acceptance requires actual protocol tests, not only direct handlers. Preserve Effect-free browser/universal runtime contracts and request-scoped identity across simultaneous users.
