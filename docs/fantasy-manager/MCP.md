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

| Tool                  | Purpose and important limits                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_connections`    | Safe owned provider connection metadata/status only                                                                                                                                   |
| `list_teams`          | Compact owned team discovery with season/sport/connection filters; stable paging                                                                                                      |
| `get_calendar`        | Valid current/historical periods and relevant fantasy-day/lock context; no guessed week equivalence                                                                                   |
| `get_league`          | Selected league settings, scoring definitions, roster rules, standings with records, season points, and category totals, and completed draft history; bounded groups/pages            |
| `get_rosters`         | Exact selected team/period rosters, or every team's roster in a linked league paged by whole teams; professional-team abbreviation on every entry; full detail carries the owner note |
| `search_players`      | Bounded league/sport-context player search with ownership/started signals, validated sorts, and optional professional games remaining                                                 |
| `get_players`         | Explicit-list hydration of up to 25 selected-player references, returned whole; stats, availability and the week's projection where the provider publishes one                        |
| `get_matchups`        | Selected matchup/scoreboard data with explicit period, category values/winners, and remaining player-games                                                                            |
| `get_transactions`    | Bounded transaction history with team scope and date filtering, two-sided player movements, trade parties, traded draft picks, and explicit incompleteness; no execution              |
| `get_team_summary`    | One bounded per-team snapshot: league, standing and record, standings, current matchup, and compact roster                                                                            |
| `set_lineup`          | The sole roster mutation operation; creates durable team runs and returns verified or pending outcomes                                                                                |
| `set_team_automation` | Enable, disable, pause for the rest of the fantasy day, or resume owned team automation; reports resulting state                                                                      |
| `get_lineup_runs`     | Owned run status, safe concise explanations, observed changes, and unresolved conditions                                                                                              |

Do not expose a general policy-mode selector, native/premium action selector, custom formula, or fallback override. Return the implementation actually used. The MCP surface covers automation enrollment, pause, and resume because an agent must be able to manage a team it owns; it still does not expose registration, provider session upload, or every frontend control as tools.

A league/opponent read requires verified access through the user's connection; it does not permit managing another team's lineup. Tool annotations and scopes do not replace ownership enforcement in backend services.

## `set_lineup` behavior

Inputs: explicit owned team references and validated target periods, plus stable request identity. MCP's protocol request ID is not assumed to be a durable retry identity. Decide one stable client request field with clear same-key/different-intent rejection.

Phase 1 uses the provider's native lineup action; Phase 2 uses the custom optimizer after direct cutover. No MCP-initiated transaction execution and no provider-premium optimization: a signed-in person may submit a reviewed transaction set from the web review page.

Response includes per-team run reference, status, implementation, target period, observation time, and safe change/no-op/blocked/pending explanations. A bounded wait may return pending work; `get_lineup_runs` retrieves the result later. Do not report success merely because work was queued or a provider returned HTTP 200 with invalid coverage.

Manual authorized requests may run while paused/disabled without enabling automation. They still obey ownership, connection availability, legal/locked assignments, and unresolved-write protection.

## `set_team_automation` behavior

Inputs: a bounded batch of owned private team ids, each with exactly one action: `enable`, `disable`, `pause-today`, or `resume`. Provider team keys, league ids, and connection ids are never accepted here.

`enable` and `disable` change enrollment without deleting team configuration. `pause-today` suspends scheduled work until the end of the team's provider fantasy day, computed with Effect DateTime named-zone arithmetic, and returns the resulting `resumesAt`, time zone, and fantasy day. `resume` clears an active pause. A repeated action is an `unchanged` no-op with the same resulting state, not an error; an action that contradicts the current state is `rejected` with the reason and the unchanged state.

Availability is separate from enrollment. An unavailable team keeps the requested automation setting, reports `availability: "unavailable"`, and remains skipped by scheduled checks. Ownership is enforced in the team service, so another owner's id is `not_found`, not a forbidden-with-details response. Responses report each input in order with its outcome, enrollment, availability, and full automation state, so an agent does not need to re-read before the next action.

This tool changes only durable Lineupgrade automation state; it never contacts the provider. `set_lineup` remains the sole provider mutation and continues to bypass enrollment for a manual run while honoring ownership, connection readiness, availability, locks, and uncertain-write protection.

## Feedback behavior

Feedback is one owner-scoped record for a bug, data issue, friction report, or wishlist item. `submit_feedback` records the acting account's report and returns its id and `open` status; `list_feedback` returns that account's reports in newest-first order with optional status, kind, and start-time filters.

Filing a report and reading back what happened to it both need only `fantasy:read`, the scope every client holds; a submitter could otherwise never confirm what happened to what it filed, which is the channel's whole purpose. Ownership is the boundary: every query is filtered to the acting account, so a submitter sees their own items and never anyone else's, and a foreign report id is `not_found`, not a forbidden-with-details response. There is no agent-wide, operator, or support queue.

The surface is submit and read-back only. A report is filed `open`; a report's status is set when the work lands, not through a tool, so no client can acknowledge, resolve, close, or otherwise change a report. `feedback:manage` is therefore retired: no tool requires it, it is absent from both discovery documents, and a token minted while it existed keeps working for every tool it holds another scope for.

Status is `open`, `acknowledged`, `resolved`, or `wontfix`, and it is stored history. A stored status, optional resolution note, and closure time are read back as they were recorded; nothing in the application writes them now.

Submission is bounded and rate-limited: title ≤ 120 characters, body ≤ 4000, control characters removed, and user text always returned as plain text. An account may submit 20 reports per clock hour and one acting client label may submit 10; the per-account limit is the backstop, so a client that renames itself cannot exceed it, and a refusal names the retry delay in seconds. Reports must never contain passwords, provider cookies, account identifiers, or raw provider payloads. Open reports are retained; resolved and not-planned reports already stored are deleted 180 days after closure.

## Budgets and paging

Initial service policy: aim for about 12 KiB and enforce a 16 KiB model-facing application-result ceiling. These are our proposed application budgets, not claimed Muse/MCP limits. The measurement counts both representations a client receives: `structuredContent` and the JSON text copy that a text-only client reads. Keeping the text copy follows the specification's backwards-compatibility recommendation, so a structured page fills about half the ceiling instead of dropping the copy and halving what a text-only client can use.

`get_team_summary` is the one deliberate exception because it composes up to six sections into one snapshot: it aims for 20 KiB and enforces a 28 KiB hard ceiling, with the same double-counting of structured and text copies. The ordinary six-group call fits a 13-team league inside that ceiling. A request that still cannot fit one player row refuses with the largest sections and the groups to drop, so the exception does not turn a genuinely oversized snapshot into a silent truncation or an unbounded result. `get_players` is the second deliberate exception: an explicit list of at most 25 player references is returned whole in one response, so it is bounded by a 256 KiB hard ceiling instead of paging at the pool size. A caller that deliberately passes `limit` can still request a smaller page. Every other tool keeps the 12 KiB target and 16 KiB hard ceiling.

- Bound both row counts and encoded UTF-8 bytes, including metadata and continuation information.
- Return complete records. Do not truncate strings midway, silently drop requested fields, or mark omitted values zero.
- If a requested record cannot fit, return an actionable narrowing-required result naming the groups or filters that can narrow it. `get_team_summary` lists its selectable groups and pages the roster with a cursor it issues and accepts; a paged resource never presents a record token as a cursor.
- Continuations bind the owner, query, selection, period, stable ordering, and expiry; they are not arbitrary database offsets or raw provider URLs. The published `cursor` description says so in every tool that takes one, and a reuse with different arguments is refused as a mismatch naming that binding rather than as an expired cursor.
- Distinguish an internally paged upstream collection from a stable application snapshot. If the provider cannot provide snapshot consistency, disclose that concurrent upstream changes may affect traversal.
- No silent subset success for exact requested teams/player keys. Return explicit per-resource failures/omissions with reasons and meaningful completion metadata.
- Keep per-record failures and page metadata bounded; many failures must not bypass the byte budget.

Starting adapter bounds can reuse verified selected-player batches of at most 25 keys and bounded upstream search pages. These are configuration proposals informed by research, not universal provider limits. Agent pages can be much smaller than upstream pages.

Upstream response caps are separate from agent-output caps. The adapter may fetch a bounded megabyte-scale response, decode and select fields, then return a small page. Filtering statistics upstream was not demonstrated by earlier Yahoo probes; local projection must not pretend it saved upstream bytes.

## Tool-call limits

Every authenticated `tools/call` spends a durable allowance before the tool runs. The limit sits in
`mcpEndpoint` beside the bearer and scope checks, so a tool cannot be added without inheriting it.
Tools are priced by the MCP annotations they already publish: a tool marked `destructiveHint: true`
spends the smallest allowance, a `readOnlyHint: true` tool spends the generous one, and everything else
spends the write allowance. An unannotated tool defaults to destructive, so forgetting to describe a
new tool bounds it more tightly rather than leaving it unlimited.

| Class         | Tools                                                                                                                                          | Window | Per client | Per owner |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------- |
| `read`        | every `readOnlyHint: true` tool, including the summaries, searches, and proposal read-back                                                     | 1 min  | 60         | 180       |
| `write`       | `submit_feedback`, `propose_transactions`, `revalidate_transaction_proposal_set`, `withdraw_transaction_proposal_items`, `set_team_automation` | 1 hour | 20         | 60        |
| `destructive` | `set_lineup`                                                                                                                                   | 1 hour | 6          | 18        |

The numbers are a product judgement, not a measurement. A polling agent reading a team summary a few
times a minute uses well under a tenth of the read allowance; 60 reads a minute still lets one client
enumerate a league, search a pool, and poll several teams. A write is rare by nature, so 20 an hour is
far above a person revising and revalidating a proposal set, and bounds a machine loop to one change
every three minutes. `set_lineup` is the one upstream mutation, so it gets the smallest bucket: six
requests an hour is a handful, and one request already covers up to ten teams. Each class has its own
window and its own counters, so a read loop can never spend a write's allowance. The owner allowance is
three client allowances, which means one client at its own limit leaves a full share for a second and a
third client of the same person, while a client that mints more clients still meets the owner's ceiling.

The counters live in the `tool_call_quota` table: one row per owner and class, and one per owner,
acting client, and class. Each row stores its window's start and a count, and a call increments both
rows atomically in one statement, resetting a row whose window has passed. Nothing lives in process
memory, so scale-to-zero, a deploy, or a restart does not hand back an allowance. The key is the owner
id from the access token and the `client_id` claim of that token — never the client address, which the
[security audit](../SECURITY-AUDIT.md#f9--rate-limit-buckets-are-keyed-by-client-address-so-one-account-can-spend-anothers)
records as a cross-account problem elsewhere. A token without a client claim spends only the owner
allowance, so it gets no extra room.

A refused call is a spend like any other: the counters increment before the decision, so a failing tool
cannot be hammered for free, and a malformed call or an unknown tool name still spends its class (an
unknown name spends the write allowance). An unauthenticated or insufficiently scoped call is refused
before the allowance is touched, because it never reaches a tool.

When the allowance is spent the server answers `429 Too Many Requests` with a `Retry-After` header in
seconds and a JSON-RPC error, so a client sees a named refusal rather than a 500 or a truncated result:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "The read tool-call allowance for this client is spent: 60 calls per 60 seconds. Another client of the same account has its own allowance. Retry in 37 seconds; a refused call also counts, so wait rather than retrying immediately.",
    "data": {
      "reason": "tool_call_quota_exhausted",
      "class": "read",
      "bucket": "client",
      "limit": 60,
      "windowSeconds": 60,
      "retryAfterSeconds": 37
    }
  }
}
```

A client should wait the stated seconds and retry once, then slow down: poll less often, batch teams
into one call, and read `get_lineup_runs` rather than re-submitting a lineup. It must not retry in a
tight loop, rotate its client registration, or open a second connection to get a fresh allowance: the
owner ceiling is shared by every client, and a refused call still counts. The `bucket` field says
whether the account or the client is the one that is spent, so a client can tell "slow down" from
"another client of mine is busy".

The numbers and windows are one constant: `toolCallLimits` in
`packages/backend/src/contexts/toolCalls/ToolCallQuota.ts`. Changing a number needs no migration; change
the constant and this table. `apps/web/src/server/mcp/mcpScopes.test.ts` pins the class of every shipped
tool and the ordering of the three allowances, so neither can drift silently. Changing which allowance a
tool spends is the declaration the tool already makes: correct its `Tool.Readonly` and `Tool.Destructive`
annotations, and that test fails until its table agrees.

## Analysis surface behaviour

`get_league` with the `standings` group reports each team's rank, the format inferred from the
provider's scoring type and modifiers, and the record the provider actually publishes. Its `scoring`
group lists the league's **configured** categories in provider order and marks each one with
`scoring: "scoring"` or `scoring: "informational"`, plus a `detail` on every informational entry
naming the provider flag that decided it. A provider lists categories it displays without scoring
them — Yahoo sets `enabled` on every entry and distinguishes a display-only category separately —
so the enabled flag alone cannot tell a client which numbers count. The result is verified against
the live league described under [live scoring evidence](#live-scoring-evidence-2026-10-29): fifteen
categories arrive from the provider, thirteen are scored, and Saves and Shots Against are
informational. Every category entry carries `scoring: "informational"` exactly when the league
publishes but does not score it; the field is absent for a scored category, so a client never has to
read a display-only number as a scored one.
A stat reference that is informational is refused as a stat-sort key with a message saying the
league does not score it, and `get_players` `scoringContext` lists scoring categories only. A
rotisserie league publishes rank, season points, points back, and per-category rotisserie points
but no win-loss record; the row simply omits `record`, and `record` in `get_team_summary` says so
with a reason. Every category entry is `{ stat, name, value }` with
`scoring: "informational"` only when the league publishes the number without scoring it, and
`detail` only when `value` is null. The stat name is inlined so a client can read the number
without a dictionary call, and a category the provider tracks but publishes no value for is stated
as `value: null` with a `detail`, never returned as a silent null and never flattened to zero. A
configured category the provider omits from a totals or points array entirely is still listed, with
`value: null` and a detail, so a reader never has to infer "absent" from a category that vanished.
A present stat whose provider value is `null` is the same case: the adapter accepts the published
null, keeps the category, and publishes it as unpublished instead of failing the read that
contained it. A provider stat id with no league scoring definition cannot be labelled, so it is
omitted from both category arrays and counted in the section-level `omittedCategories`
declaration. The `categoryTotals`/`categoryPoints` coverage states whether any value was published,
so an empty array is never read as zero.

The standings group has two forms, selected by `standingsDetail`. `compact` is the default: it
returns every team's rank, points, points back, games back, the record the format publishes, and the
team's acquisition usage, with no per-category arrays. A 13-team fixture whose league sets no
acquisition limits arrives in one result inside the 12 KiB target; a league that sets limits adds
each team's remaining counts and can therefore page, and a table over the budget pages with a cursor
instead of dropping rows. `detailed` adds the per-category season totals and rotisserie points; that
form genuinely does not fit a league in one result, so it pages teams and says so in the section's
`detailNote` instead of paging silently. Both forms inline each category's name in a row, so the
scoring dictionary is included only when the `scoring` group is requested; asking for detailed
standings and scoring together can exceed the result budget, and the refusal names the groups to
drop. `get_matchups` uses the same `{ stat, name, value, scoring?, detail? }` category entry per side, so
a scoring-week category with no published value is stated the same way. The summary's matchup
section pairs both sides into one row per category — `{ stat, name, own, opponent, scoring?, detail? }`
— so the same category name, stat reference, and scoring marking are not repeated twice.

Each standings row carries `acquisitionUsage`, so a waiver decision compares against league rivals
without a second read. `status: "published"` reports `seasonMovesUsed`, `weeklyAddsUsed`, and the
`coverage` those adds count over (the scoring week in every league verified). `status:
"not_published"` carries a reason and is what a team payload with neither provider counter reports;
it is never zero used. The section's `acquisitionLimits` states the league's weekly and season limits
once, `not_set` when the league declares none. `seasonMovesRemaining` and `weeklyAddsRemaining`
appear only where the league declares the matching limit, so no remaining count is manufactured
against no limit. The provider publishes no per-team games-played count — its
`teams;out=games_played` read returns an empty per-team node, and its roster, standings, and players
reads refuse that output — so only the league's games cap is known, and the standings `detailNote`
says so.

`get_matchups` carries per-category values and the category winner (or a tie) for category
leagues, plus `remainingGames` for the scoring week where the provider publishes it. Its `schedule`
section states the unit or declares the capability unsupported with the reason: Yahoo publishes
that remaining-game count only as a fantasy-team total of player-games (National Hockey League),
and a football player plays at most one game per scoring week. The provider publishes no
per-professional-team remaining-game count and no probable-starter field; Lineupgrade counts the
professional team's games from the league's own schedule instead. `get_rosters` reports `proTeam`,
injury, and the bye week where published, and a player row states whether his professional team plays
in the current scoring week and against whom; `get_team_summary`'s `schedule` group publishes the
games themselves and each player's games remaining. With `roster` selected, the summary also carries
`illegalSlots`: rostered players whose eligible positions do not include the slot the league declares
for them, each with the league's own slot name, the positions the player does hold, and one sentence.
It compares the league's slot rules with the provider's eligible positions and nothing else, and it is
absent rather than empty when the roster was not read. With `detail: full`, `get_rosters` also carries
the team's `ownerNote`, while the compact default omits it; the note is the owner's stated intent
for that team, not a provider or league fact, and it belongs with the roster facts a trade or lineup
decision reads. `search_players` reports provider
ownership/started percentages without inventing either, and publishes the player's professional team
as `proTeam`, the same abbreviation a roster entry carries. Pass `includeGames: true` to add
`gamesRemaining` to each pool row, joined from the row's professional-team key against the same
professional games over the scoring window, so a pool player needs no roster row and no second
read; a row with no key reports `unavailable` with the reason instead of a guessed count, and the
result's `gamesRemaining` section states the window and observation time or why the league has no
game source. Omit `includeGames` for a cheaper search that does not read the league window or the
professional calendar. The provider’s dated pool selector is not exposed: it projected one date’s
opponent rather than filtering the pool, and no client used it. The probe and its results remain in
[RESEARCH.md](RESEARCH.md#pool-player-schedule-shapes-2026-10-31).

Every roster row carries `slot` as a marked value rather than a bare string: `{ status:
"verified", slot }` when the provider published a slot, or `{ status: "unverified", rawValue,
reason }` when it published a value — such as an empty selected position — that names no slot the
league declares. The unverified form keeps exactly what the provider sent, says why it could not be
verified, and is published in both `get_rosters` and the summary's roster group instead of failing
the read. A slot decides position eligibility, so an unverified slot is never treated as any known
position and is excluded from value and scoring decisions. A player whose slot is unverified is left
where they are: lineup planning skips them, and no explicit assignment is ever written for them,
because a guess could move a player out of a slot the provider never named. One such row does not
affect any other row or any other roster read.

`get_rosters` also reads a whole league with `scope: "league"`. A linked team supplies the league and
ownership boundary; every team in that league is returned, including teams the account does not own.
The read uses the provider's league teams read with roster output: one provider request for a
twelve-team league, for the provider's current coverage only. An exact `period` is refused for the
league scope rather than fanned out into one read per team, and the result states the current week
or date. Pages are whole teams, not players: each team row carries a private `team` reference, its
`name`, `owned`, and the complete `players`, so a page boundary never splits a roster and a client
never correlates two arrays by index. `page.size` states the team page bound and `page.total` the
league's team count; `page.returned` is the actual count after the result budget, and the cursor is
bound to the league scope and its arguments. The league page uses the explicit-list result budget,
so a twelve-team league fits in one page. League player rows carry the same identity, positions,
`proTeam`, slot, injury/availability, bye week, and undroppable fields the provider publishes in
that shape; the shape publishes no add/drop counts, so `transactionTrend` is `not_published` with a
reason and never zero. `ownerNote` belongs to a linked team read and is not published for a league page;
games are read through `get_team_summary`. If the provider refuses the league roster shape, the result is
`unsupported` or `failed` with a coverage entry and no team rows, never a successful empty roster.

`search_players` and the `get_team_summary` roster publish `transactionTrend` where a player row
carries it. A published trend is `{ status: "published", adds, drops, window: "provider_current_day" }`:
the provider's add and drop counts for its current day, across all of the provider's leagues. The
counts are manager moves, not percent owned, and the window is the provider's day rather than a
league scoring period or a caller-selected range. The provider does not publish a date with the
counts, so coverage is the current day only and no historical window is implied. When the provider
omits the transaction node, the trend is `{ status: "not_published", reason }`; a real count of zero
is published as zero. The counts are plain numbers with their window: no derived score, ranking, or
colour coding is attached.

`search_players` rows carry the provider's screening status, because a client choosing between
available players needs to see an injured-reserve free agent before recommending them. `status.value`
is `healthy`, `day_to_day`, `out`, `injured_reserve`, or `unknown`; `status.code` keeps the provider's
own code (for example `IR-LT`, `IR-NR`, or `IR-R`) and `status.detail` its own wording where it
publishes one, such as an injury note. `status.observedAt` is the instant the status was read, so a client can judge staleness
against its own clock. The provider publishes no separate expected-return field, so none is invented;
any such text appears in the note. `unknown` is a real answer: a code this adapter has not been
taught is reported as unknown and never as healthy, because the two lead to opposite
recommendations. The provider's boolean status flag follows the same rule: `false` is healthy, while
`true` says the provider flagged the player without naming why and is therefore `unknown`. A healthy
row omits `code` and `detail` rather than filling them with placeholders.

`search_players` rows carry the value each provider-ordered sort uses: `actualRank` (the provider's
current-season rank, which orders `actual_rank`), `overallRank` (which orders `overall_rank`), and
`statValue` (the season value of the requested `stat`, present only for a `stat` sort). A client can
therefore check the order it received without a second read. Provider ownership and started
percentages and their changes are null only when the provider published no value for that row, and
the field descriptions say so. There is exactly one ownership-change field, `percentOwnedDelta`; an
earlier response shape carried a second, always-null `percentOwnedChange`, which is removed rather
than published beside it. `percentOwnedDelta` is the provider's delta over its current ownership
week, and `percentStartedChange` is its delta over its current started-percentage window (a scoring
week in football, the provider's fantasy day in hockey); both windows are stated in the field
descriptions. Weekly rank and stat sorts are refused with the remedy because the provider's search
payload publishes only season values for them; offering the sort would return an order the rows
cannot explain.

`get_transactions` maps `scope: team` onto the provider's team filter. `since` and `until` are ISO
8601 instants such as `2026-09-20T00:00:00Z`. The provider has no date filter, but its history is
newest-first and offset-addressable, so a date-bounded read pages back until the bound is reached or
a bounded event cap stops it; without a date bound it fetches the most recent page. `window` reports
how many events were fetched across those pages, the oldest and newest timestamps, and whether the
cap was reached. A requested `since` older than the oldest event the provider publishes is reported
as `transaction_history_starts_after_range` with degraded coverage, and a capped read as
`transaction_window_truncated`; neither is a silently incomplete success. The bounded read is capped
at 500 events (ten pages of 50), which covers a full owner-season history observed so far without
one unbounded provider response.

Every transaction player row is a movement with two named ends. `from` is the team the player left
and `to` is the team it joined, each a private counterparty reference plus the provider's inline
name where published. A trade player therefore carries both ends, and an added or dropped player
carries exactly one: an add has `to` and a null `from`, a drop has `from` and a null `to`. The raw
`direction` field is gone because it could not express a trade: every traded player has a
destination, so a single direction labelled both sides incoming and hid the outgoing half. Each row
still carries the provider's inline identity where published — name, primary and display position,
eligible positions, and professional team — beside the private player reference, so identifying who
moved needs no second `get_players` call. The references and dictionaries remain the canonical form
for detail.

A trade also carries `parties`. When the provider publishes the proposing and receiving team keys,
they appear as `proposer` and `receiver` with `source: "provider"`. When it does not, the parties
are the teams the movements involve, as `participant` entries with `source: "player_movements"`;
the adapter never assigns a proposer or receiver role the payload does not establish.

A trade also carries `picks`: each traded draft pick with its round and the teams that sent,
received, and originally owned it. The provider publishes no draft year or overall pick number for a
traded pick, so neither is reported. A pick's `from`, `to`, and `original` are the same private
counterparty references as a player movement, so a player-for-pick trade shows both sides without a
second read. The live Elite League 25 read on 2026-10-29 found this array in the plain
`transactions;count=50` payload; no extra query parameter was needed, and an earlier adapter simply
did not decode it.

A transaction whose movements cannot be reconstructed is marked, not omitted and not presented as
an empty success. `completeness` is `{ status: "complete" }` or `{ status: "incomplete", code,
detail }`, and the reason says what the client can act on. A trade the provider returns with no
player rows and no traded picks is `incomplete` with code `no_movements` and its `players` array
stays empty; a pick-only trade is complete because its picks carry both sides. A movement missing
its required end is `movement_missing_party`; a movement type the adapter cannot place on a team is
`unknown_movement`; and a trade with no returning player and no traded pick is
`trade_return_unpublished`, because the return side cannot be reconstructed from the payload. An
incomplete record is never a comp a client should price against.

The provider does publish pending trade offers, but only to the account that manages one of the two
teams: `transactions;type=pending_trade;team_key={own}` returns a `pending_trade` row with
`status: proposed`, both parties, both ends of every player, the traded picks, the proposal time,
and whether the session can respond. The plain league feed never carries them and another team's
request is refused, so there is no league-wide trade wire and no offer data is inferred.
`get_pending_trade_offers` reads that feed for one owned team, marks the result `readOnly: true`,
and states that this product cannot accept, reject, or vote on a trade. It also carries `ownerNote`,
the linked team's note from Lineupgrade, so an offer can be read against the owner's stated intent;
the note is owner context, not a provider fact. It returns an opaque reference
a signed-in person can use on the review page to withdraw an offer this account made. It never exposes
a provider team key, player key, or pending-trade key; parties and players arrive as private references. A provider that
publishes no such feed reports `status: "unsupported"` with the reason instead of an empty success.

`get_league`'s `draft_history` group returns the provider's `draftresults` read: every published
pick in provider order with its round, pick number, the team that made it, the provider's inline
player name where it publishes one, and a private player reference, beside the league's published
draft status. The name comes from the same `draftresults;out=players` read, so no second player
hydration is needed; a pick the provider returns without a name keeps only the reference. It is
history, not current or future pick ownership; the provider publishes no pick-ownership read, so
the group does not pretend to know who owns an upcoming pick. A traded pick appears on the trade transaction that moved it, not in this
pick history. Team names come from one batched league-teams read and are omitted when that
read fails while the picks remain. The group pages picks inside the result budget, and the section's
detail note repeats that this is completed draft history rather than pick ownership.

`get_league`'s `overview` carries `transactionRules`, the league's transaction rules in our
vocabulary rather than the provider's field names. It groups the waiver rules (type, rule, and FAAB
flag), timing (the weekly deadline and the days a dropped player stays on waivers), acquisition
limits (per week and per season), trade rules (end date, ratification as `vote` or `commissioner`,
and the objection window in days), and games caps (games played, and innings pitched where the
sport declares one). Every rule is `{ status: "published", value }` or `{ status: "not_set" }`: a
league that sets no such limit reports `not_set` rather than zero or an omitted field, and a cap
that does not apply to the league's sport is not manufactured. An unfamiliar provider ratification
rule is `unknown`, never guessed as one of the named forms. `timing.weeklyDeadline` keeps the
provider's raw value, including an empty string, and `timing.rosterChange` decodes it into
`same_day`, `next_day`, or `weekly_lock`. A published rule names its source fields and repeats the
raw values in `detail`; `not_published` means the published settings do not establish a rule, and no
rule is stated. `intraday` and a game-time deadline are same-day; a weekday number is a weekly
lock; an empty deadline is read together with the provider's editable period — a scoring week is a
weekly lock, the current date is same-day, and the next date is next-day. Per-team usage is published with the
team objects the provider returns: every standings row carries it, and `get_team_summary` repeats
the owning team's usage beside the league limits. The provider publishes no per-team games-played
count, so `transactionRules.detailNote` states that only the league's games cap is known.

`get_team_summary` composes the league overview, the linked team's standing and record, league
standings, the owning team's acquisition usage, the current matchup, this week's and next week's
remaining player-games, and, only when the `roster` group is selected, a compact roster. The team
object also carries the owner's own note as `ownerNote`: `{ status: "provided", text, updatedAt }`
when one is stored or `{ status: "not_set" }` otherwise. It is owner context, not league or provider
data, and the field description says so; it is never sent to the provider. A note is limited to
2,000 characters, is stored with the team, and is editable only on the team page. Text that looks
like a credential is refused with an explanation rather than stored or echoed. Roster entries in
this summary carry the same `transactionTrend` shape as `search_players`, with the same current-day
window and the same `not_published` rule. Its league section is the compact static context
(name, team count, scoring type, week window, and dates) and deliberately omits `transactionRules`,
which belongs to `get_league`; the rules would consume the summary's bounded result budget without
changing a per-team snapshot. The `acquisitionUsage` section carries the same row usage as the
standings group beside the league limits, because the summary omits `transactionRules`; it is
available when the `standings` group is selected and the league settings could be read, and it states
the same no-per-team-games-played boundary. `groups` selects `league`, `standings`,
`categories`, `matchup`, `schedule`, and `roster`; the default is league, standings, matchup, and
roster, `categories` adds season category totals and points plus the matchup's paired per-category
values, and `schedule` adds the period's per-player games. The six-group call is the ordinary full
snapshot and fits a 13-team league inside the summary's 20 KiB target and 28 KiB hard ceiling; the
roster and schedule rows page with the returned cursor. Each section states its own availability, so a
failed standings read leaves the roster and matchup intact. `remainingPlayerGames` names its unit
(`fantasy_team_player_games`), because that is the only granularity Yahoo publishes for a fantasy
team; football declares it unsupported with the bye-week alternative in its place.

The `schedule` group answers what a client cannot otherwise compute: which games a candidate has in
a stated window, how many games their professional team has left in it, and which nights are light.
For every rostered player it reports the dates they play, the opponent abbreviation, whether the game
is home or away, and a game count for the window; `dates` carries a per-date count across the roster,
so a light night needs no client-side arithmetic and no second schedule source. Each player also
carries `gamesRemaining` with the source of its own count: `professional_games` when it was counted
from the league's professional games, `provider_opponent` when those games were unavailable and the
provider's own roster schedule supplied it; the section aggregates the sources used. A count is
never zero because a source was missing; when neither source can answer, the player or section says
why.
The section states its own `window` — the inclusive `start` and `end` dates and a `source` — and
`observedAt`. The `gamesRemaining` section adds the exact dates its counts cover in `window` when
the provider publishes them (otherwise the schedule's `period` bounds the count), and
`gamesRemaining.observedAt` is the oldest observation among the sources used, so a client never has
to assume which dates were covered or how old the count is.

Off nights are declared once, in `offNights`: a date on which fewer than half of the league's
professional teams play (`league_off_night`, maximum team share `0.5`). The per-date entries in
`dates` publish `leagueGames` and `teamsPlaying` beside the roster count, so a client can apply a
different threshold; each scheduled game carries `offNight` against the same definition. Hockey is
the only sport whose professional games make this computable today. A football, baseball, or
basketball league reports `offNights: { status: "unsupported", detail }`, and the `leagueGames` and
`offNight` fields are absent with that reason, never false.
`source` is `period` when the window is the league's own scoring period, `requested` when the call
passed `window` or `days`, and `rest_of_week` when a league with no scoring period was read from the
provider's current date through the end of that week. A player who does not play in the window is
`status: "no_games"` with a count of zero, never an empty success that reads as unsupported.

A league the provider gives no period window is no longer a dead end: `get_team_summary` accepts a
date `window` or a `days` count for the schedule, and a period-less date-scoped league defaults to
the rest of the provider's current week. There is no scoring period to count, so games remaining is
counted over the stated rest-of-week window instead, and games per date are published too. When the
provider publishes neither a period nor a current date and the call passed neither argument, the
section says so in one sentence and names `window`/`days` instead of inventing dates. An explicit
`window` or `days` takes precedence over a scoring period and is marked `requested`. Coverage
follows what the league declares: a date-scoped league is read once per date of the window, from the
provider's own scoring-week dates or the requested/default window, while a league whose cadence is a
scoring week reports that week's opponent as the honest equivalent, refuses a date window, and is
never given invented dates. The provider publishes no start time and no season-long schedule, and
`detail` repeats both boundaries in the result; one schedule read covers at most 21 dates, and a
wider window is refused with that limit rather than silently truncated.

The roster and schedule sections are one paged player list, and they exist only when requested: with
neither `roster` nor `schedule` selected the response carries no `roster` key at all, a complete
page, and no player read. An absent key is deliberate, because an empty array is not the same as
absent and a client cannot tell them apart. Schedule rows only ever appear under `schedule`, and
roster rows only under `roster`, so a player who entered the window's dated reads without being on
the roster page cannot be mistaken for a roster member. Each call that does select them returns
every requested fixed section, a page of those players, and `page.next`; the tool accepts that
cursor on the next call, and a player carries one reference across both sections. The summary's
28 KiB ceiling fits a 22-player, three-game schedule in one page and the default snapshot without
dropping league, standing, record, standings, or matchup; when a selection or an explicit `limit`
does not fit, the cursor carries the rest instead of truncating. A budget refusal names the largest
sections that consumed the result, in bytes, before it names the groups to drop, so a client is
never told only to ask for fewer groups.
The result never emits a record token as a substitute cursor.

### Live scoring evidence (2026-10-29)

A read-only pass over the owner's head-to-head hockey league recorded stat ids and flags only.
Fifteen categories arrive, every one with `enabled: "1"`, which is exactly why the enabled flag cannot
be published as the answer to "does this count". Two of the fifteen carry
`is_only_display_stat: "1"` at both the stat level and inside `stat_position_types`: Saves (25) and
Shots Against (24). The other thirteen — goals, assists, points, plus/minus, powerplay points, shots
on goal, hits, blocks, wins, goals against, goals-against average, save percentage, and shutouts —
carry no display-only marking. The provider still publishes season totals for all fifteen, so the
numbers for Saves and Shots Against look real while not scoring. The league's scoring surface now
reports thirteen scoring categories and two informational ones.

The same pass confirmed the search payload shape the status rests on: every sampled row carried
`status` as the JSON boolean `false` when healthy and as a code (`IR`, `IR-LT`, `NA`, `DTD`) when not,
with `status_full` and `injury_note` on some rows. A roster row differs: a healthy rostered player
omits `status` entirely. Both shapes are decoded from the fields the provider already returns, so
reading a page of search results still costs one upstream request.

### Live schedule evidence (2026-10-30)

A read-only pass over the owner's hockey leagues and one football league confirmed the schedule
shapes and their boundaries. Counts and kinds only; no player, team, or league identifiers were
retained.

- `GET /fantasy/v2/team/{team}/roster;date=YYYY-MM-DD/players;out=opponent` answers 200 for every
  date of the current scoring week. Each player row carries `selected_position` with
  `coverage_type: "date"` and the requested date, and one `opponent` that is an abbreviation, a
  leading `@` for an away game, or `null` when the player's team does not play. The committed
  provider read the seven dates of one hockey league's current week and returned 0, 19, 3, 17, 5,
  13, and 9 opponents for a roster of 21 players on any one date; the union across the week was 22
  players because one roster change happened during it, which is why the schedule group unions
  players by key across the dates it reads.
- The roster wrapper on a dated read still declares `coverage_type: "week"`: it names the roster's
  own cadence, while each player row declares the read's coverage. The adapter takes the coverage
  from the player rows and uses the wrapper only to cross-check the date or week value.
- `GET /fantasy/v2/league/{league}/scoreboard;week=N` on a head-to-head hockey league published
  `week_start` and `week_end` for the current scoring week, which is the dated period window the
  schedule group reads. The rotisserie hockey league's scoreboard published no `week`, `week_start`,
  or `week_end`, and its league settings published no `current_week` either. It does publish
  `current_date` (`2026-10-30` in this pass), which is the anchor for the rest-of-week default
  described below; a league with neither a period nor a current date is refused rather than given an
  invented window.
- On a weekly football league, `roster;week=N/players;out=opponent` returned 14 opponents and one
  `Bye` across 15 rostered players, so the week's opponent is the published equivalent when the
  league's coverage is a week rather than dates.
- A roster row identifies the player's own professional team with a provider key
  (`editorial_team_key`, observed as `nhl.t.26`) beside the abbreviation and full name, while the
  opponent arrives only as an abbreviation. Any stored schedule therefore joins the player's team by
  provider key and learns an opponent's key from the abbreviation-to-key pairs roster rows publish,
  rather than matching abbreviations or prefixes; an unlearned abbreviation stays unresolved. A
  non-null opponent already establishes that the player's team plays, which is what scheduled-work
  gating needs.
- The league players collection is date-addressable through its `type=date` selector, not through a
  plain `date` parameter. `players;out=opponent` and `players;out=opponent;date=YYYY-MM-DD` returned
  the same 50 players with identical opponents across two dates, so the plain date is accepted and
  ignored. `players;type=date;date=YYYY-MM-DD;out=opponent,…` moved the opponents: on one hockey
  league 50 rows carried 9 non-null opponents on one date and 26 on the next. The same selector
  works beside the full search output (`ownership`, `percent_owned`, `percent_started`, `ranks`,
  `transactions`), keeping every field and adding `opponent`. The shape was probed for a pool
  candidate, but the public tool does not expose it: the selector projected one date’s opponent
  rather than filtering the pool, and no client used it. On a scoring-week football league the
  selector is accepted but returns the week's opponent unchanged across dates, which is one reason
  the projection was not exposed. A player
  resource with a date is not addressable: `/player/{key}` and
  `/league/{league}/players/{key}` answer `400`, the former naming an invalid game key and the
  latter an invalid player resource. The shapes and outcomes are recorded in
  [RESEARCH.md](RESEARCH.md#pool-player-schedule-shapes-2026-10-31).

### Live tool read for the date-window schedule (2026-10-30, round 9)

A read-only pass ran the committed `FantasyQueries.getTeamSummary` and `searchPlayers` against the
owner's linked teams through the committed Yahoo provider. It recorded counts, dates, field presence,
and statuses only; no player names, team names, identifiers, or session material were retained.

- The rotisserie hockey league (13 teams, 15 categories, date coverage, no scoring period) returned
  `schedule.status: "available"` for groups `["schedule"]` with
  `window: { start: "2026-10-30", end: "2026-11-01", source: "rest_of_week" }`, a three-date
  `dates` array (4, 15, and 5 roster games), one page of 16 players and a second of 7, and the full
  23-player roster across the two pages. `period` was absent, as it must be for a league with no
  period, and no row lacked a professional team.
- The head-to-head hockey league returned the period behaviour unchanged:
  `period: { week: 5 }`, `window: { start: "2026-10-26", end: "2026-11-01", source: "period" }`, the
  same seven-date per-date counts as the earlier pass, and `observedAt` beside the window.
- The client's exact failing group set (`league`, `standings`, `categories`, `matchup`, `roster`)
  returned `narrowing_required` at the 16 KiB ceiling. The default groups (`league`, `standings`,
  `matchup`, `roster`) returned `ok` with a ten-player first page. The later round-9 follow-up
  changed the category shape, paired the summary's matchup categories, and gave the summary its own
  budget; the same 13-team six-group call now succeeds (see below).
- A single-group `["league"]` call returned keys `status`, `team`, `league`, `coverage`, `failures`,
  `page`, and `budget`, with no `roster` key.
- Ten search rows sorted by ownership all carried a `proTeam` string.

The same pass recorded the provider status vocabulary that `search_players` decodes: `O`, `Q`,
`DTD`, `IR`, `IR-LT`, `IR-NR` (wording "Injured Reserve"), `IR-R` (wording "Injured Reserve -
Designated for Return"), and two `NA` wordings ("Not Active" and "Inactive: Coach's Decision or Not
on Roster"); `IR+` remains in the adapter's table from the earlier pass. `IR-NR` and `IR-R` were
previously untaught and read `unknown`; both are injured-reserve shapes, so the adapter now maps them
to `injured_reserve`. A boolean `status` seen in a search payload belongs to `is_keeper.status`, not
the player's injury status, so a row with no injury simply omits `status` and reads healthy for the
right reason. A player-level boolean is still decoded conservatively: `false` is healthy and `true`
is `unknown`, never healthy.

### Live roster and category evidence (2026-10-31)

A read-only pass over the owner's date-scoped hockey league found the two shapes that had
previously failed whole collections. Counts and field shapes only; no team or player identifiers
were retained.

- The week-scoped roster row for a player the provider had not placed carried
  `selected_position.position: ""` (and `is_flex: ""`). The decoder required a non-empty string, so
  one row failed `team.roster.entries.0.players.15.selected_position.position` and took the whole
  roster read, the summary roster group, and every analysis that needed the roster with it. The
  adapter now accepts the published empty value, marks the row's slot `unverified`, keeps the raw
  `""`, and states the reason; the other 20 rows in that read were unaffected. The current-date
  roster published 19 players with no empty slot, and `get_rosters` and the summary roster group
  returned every one of them with no failures. The league is date-scoped, so a requested week is
  served by the provider as a date roster and the tool falls back to the date roster rather than
  presenting the week view.
- The same league's scoreboard published `stat.value: null` for one configured category. The stat
  entry previously required a finite number or a string, so that single null failed the whole
  matchups read. The adapter now reads a null value as no value and publishes the category entry as
  `value: null` with a detail; a fixture pins the shape and the other categories still arrive.

### Live round-9 follow-up reads (2026-10-31)

A read-only pass ran the committed `FantasyQueries.getLeague`, `searchPlayers`, and `getTeamSummary`
against all five of the owner's linked teams. It recorded raw settings values, rule values, dates,
counts, field presence, and byte sizes only; no player names, team names, league identifiers, or
session material were retained.

- Every league reported a raw `weeklyDeadline` and a decoded `rosterChange`. Two hockey leagues
  published `"intraday"` and decoded `same_day` from `weekly_deadline` alone. A football league
  published `""` with a scoring-week editable period and decoded `weekly_lock` from
  `weekly_deadline` and `edit_key`. Two hockey leagues published `""` with an editable date one day
  after the provider's current date and decoded `next_day` from the same pair. No league reported
  `not_set` for the raw field; the three that previously read `not_set` published an empty string.
- A dated pool read was probed on the date-scoped hockey league: of five sampled rows, two carried a
  scheduled opponent and three were `no_game` because the provider published a null opponent. The
  same call on the scoring-week football league returned the week's opponent unchanged. The public
  `search_players` tool does not expose that selector; it was a date projection, not a filter, and no
  client used it.
- The full six-group call (`league`, `standings`, `categories`, `matchup`, `schedule`, `roster`) on
  the 13-team rotisserie hockey league (12 standing rows returned in this pass) returned `ok` with
  seven roster rows, a next cursor, and these sections: `standings` (2,469 bytes), `schedule`
  (2,863), `matchup` (1,440, with paired categories),
  `categoryTotals` (1,009), `acquisitionUsage` (512), `coverage` (851), and `roster` (1,531)
  inside a 28,672-byte hard ceiling. The measured result was 12,439 structured
  bytes and 27,504 wire bytes, where wire counts the structured copy, its escaped text copy, and
  1,024 bytes of envelope. `categoryPoints` was unsupported because this league's provider
  published no rotisserie points for the current team in this pass.

### Games-played read shapes tried (2026-10-30, round 9)

Every shape below was requested read-only against the owner's hockey and football leagues. The
provider accepts `out=games_played` only as a teams output, and every per-team node it returns is
empty, so no per-team games-played count is published:

| Request                                                                  | Result                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `GET /league/{league}/teams;out=games_played`                            | 200; one `"games_played": []` per team (13 hockey, 12 football) |
| `GET /league/{league}/teams;out=games_played;type=season`                | 200; same empty per-team node                                   |
| `GET /league/{league}/teams;team_keys={team};out=games_played`           | 200; same empty per-team node                                   |
| `GET /league/{league}/teams;team_keys={team};out=games_played;type=date` | 200; same empty per-team node                                   |
| `GET /league/{league}/teams;out=games_played,roster`                     | 200; same empty per-team node                                   |
| `GET /team/{team}/roster;out=games_played`                               | 400; unsupported output                                         |
| `GET /team/{team}/roster;date=…/players;out=games_played`                | 400; unsupported output                                         |
| `GET /team/{team}/roster;week=…/players;out=games_played`                | 400; unsupported output                                         |
| `GET /league/{league}/standings;out=games_played`                        | 400; unsupported output                                         |
| `GET /league/{league}/players;out=games_played`                          | 400; unsupported output                                         |
| `GET /team/{team}/stats;type=season`                                     | 200; no games-played field                                      |

The per-team usage field therefore keeps its honest `not_published` status, and its detail now names
the shapes the provider accepts but leaves empty.

## Coverage correctness

A period reference must be resolved against the provider calendar, sport, season, and league. Day, scoring-period/week, and season datasets are not interchangeable. Ancillary coverage is retained or explicitly distinguished.

Do not advertise multi-week aggregation, advanced-stat availability, diamond data, all legacy sorts, or NHL projection completeness without proof. Rates, percentages, ratios, and time-on-ice averages are not summed like counts. Missing games/stats are not automatically zero.

Separate roster membership reads from bounded player hydration. `get_players` takes an explicit list of at most 25 references and returns the whole list in one response; its `team` is league context, not the subject, so a reference to a player on another team in the same league resolves normally and a reference sealed for another owner or league is refused in `failures`. The provider publishes no projected-statistics series: completed weeks report actual values, while the
current and future weeks report zero. It does publish a league-scoped projected week rank for football, which the
lineup policy reads as the period's projection, so the `projections` group publishes that rank with its basis and
the week it covers for football and reports the absence compactly for a sport the provider serves no projection
for. Pool and roster rows also carry whether the player's pro team plays in the current scoring week, against
whom, and its bye week where published, so a client never has to infer a bye from ownership movement. See
[live read endpoints](RESEARCH.md#live-yahoo-read-endpoints-2026-10-25).

Actual statistics state their basis: `week` with the covered period when the provider declares a weekly player series for the sport, `date_range` with the covered dates when the provider served a window by aggregation, otherwise `season`. A client must not compare a season total against a weekly or window value, and the read reports the basis it used rather than relabelling one as the other. Player identity resolves from the roster, then selected-player hydration, then transaction history, so a player who is no longer rostered anywhere is still named by the drop side of an add/drop; a transaction player row carries its inline identity beside the reference, and its primary position is omitted where the provider does not publish one.

### Player-statistics periods

`get_players` accepts exactly four period shapes for `actual_stats`: `{kind: "season"}` (the default),
`{kind: "week", week}` with `{week}` as its short form, `{kind: "preset", preset}` with
`last_7_days`, `last_14_days`, or `last_30_days`, and `{kind: "range", start, end}` with inclusive
`YYYY-MM-DD` dates. The provider declares, as data beside its other capabilities, how it serves each
kind for each sport — `native`, `aggregated`, or `unsupported` — plus the preset windows and the range
length cap. The published period schema lists the shapes and the result repeats the declaration in
`periodSupport`, so a client can read the boundary instead of probing it.

| Provider | Sport    | season | week                          | preset      | range       | Notes                                                                                            |
| -------- | -------- | ------ | ----------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------ |
| Yahoo    | football | native | native (completed weeks only) | unsupported | unsupported | No daily player series; a preset or range is refused with the week or season remedy              |
| Yahoo    | hockey   | native | unsupported                   | aggregated  | aggregated  | Daily reads summed; range capped at 31 days; the window's rate categories are listed, not summed |

A refusal names the period kind, whether the provider serves that kind at all, and the kinds it can
serve instead; season totals are never substituted silently. Yahoo's hockey preset windows and
ranges are one batched request per day for every requested player reference (25 references at most),
run with bounded concurrency, so a 7-day window for 25 players is 7 upstream reads rather than 175.
A range that covers the league's declared season is served as the season series instead of daily
calls, and a range longer than the declared cap is refused with the cap and the alternative windows.
An aggregated group states its covered dates, its `daily_sum` method, and a `notAggregated` list for
categories the provider publishes as rates or percentages (Yahoo hockey goals against average and
save percentage): a rate is never summed across days, and an unpublished day stays null rather than
becoming zero.

A coverage entry has one of three states. `available` means the resource was read and verified. `unsupported` means the provider or league does not establish it, and the entry, or a typed group result beside it, carries the reason. `degraded` means a dependency could not be verified while the read still returned what does not depend on it: the entry names the failed field, the affected resource lists a bounded failure, and roster and matchup reads are not erased because league settings failed. A calendar that needs the scoring-week window reports the degraded dependency instead of inventing periods. A group that declares itself unsupported never also reports a period failure; the two statements would contradict each other.

## Transaction proposals

`propose_transactions` stores what an agent proposes; it writes nothing to the provider. Before it
stores anything, it reads current state once per team the request touches and validates every declared
item against the set's end state, the roster projected through the order the set would run. An item
that cannot run is never stored: it is returned in `refused` with its 1-based position in the request,
a plain reason, and what would make it valid, while the valid items in the same call are stored as
usual. When no item can run, the call refuses and stores nothing. One call covers every team the
account has, and the set is grouped by team, so teams with nothing proposed still appear as an empty
section on the review. Each item names
one team, a kind (`free_agent_add`, `waiver_claim`, `drop`, `slot_move`, or `trade`), the players to
add and drop or the player and destination slot of a slot move, an optional FAAB bid, and a required
reason. A slot move names one rostered player and one slot the league declares, into a reserve list
or back out of one; it adds and drops nobody and carries no bid. The client declares intent per team;
the server owns the order of that team's moves, the effective date, and the timing, and validates the
items against the roster projected through that order. A trade names
`counterparty` from the league's teams read, the players going out in `drops`, and the players coming
back in `adds`; it carries players only in this version, no bid, and no draft pick. The linked provider
declares the assets its own trade proposal request can name, and a draft pick it cannot name is
refused with that provider's declared reason rather than a bare "unsupported"; a trade item that
carries `picks` is refused, never silently ignored. For Yahoo, that reason is that its published
proposal request names a trader team, a tradee team, a trade note and players, with no element for a
draft pick, while its web trade hub does trade picks: the limit is the request shape, not the
product.
Staging a trade reads the league settings, both rosters, and the league's teams, and refuses the item
when the counterparty is not another team in the same league, a player is not on the roster they
would leave, or the trade window has closed. A free-agent add carries no bid, a waiver claim carries one of 0 or more, and a
drop item only drops. The result carries the set id, the review link
(`https://{origin}/transactions/{setId}`), the surface (`mcp`) and acting client, and each item's
outcome by position: accepted with its stored state, or refused with a code and a sentence that
names the item. A reference from another account or league, a team the account does not have, a
player named in both adds and drops, a kind and bid that disagree, or the same move repeated are
refused and named. Repeating the identical set returns the existing set with `created: false`
rather than stacking a duplicate. Once a set is extended or a stored move is withdrawn, its contents
no longer match the original request, so proposing the original items again creates a new set.

Passing `set` appends the items after an existing set that is still open. A set is open until it has
been submitted and every move in it has settled: a move settles when it executed, its trade offer
is no longer available, or it was skipped for a reason that cannot change. A set whose submission
left a move failed, or that was never submitted, is open. Every team that receives an item is
validated again against the current roster together with the moves in the set that are still proposed,
and that team's stored order is recomputed. A move whose attempt failed or that was skipped is replaced
by a new item, so proposing that move again in the same set is accepted; the earlier item stays as a
record. If an added item makes an existing unrun item impossible, nothing is stored; the refusal
names the existing item to withdraw. `withdraw_transaction_proposal_items` takes a set and one to
twenty item ids, removes the moves that are still proposed, revalidates the remaining moves as a set, and
returns the set with its new order and review link. Removing the last move for a team is allowed. A
move that already ran, is pending, failed, or was skipped cannot be withdrawn: it keeps its outcome
and is replaced by a new item. A set that stayed open after a submission still accepts a withdrawal
of a move that is still proposed; a set whose moves have all settled is an audit record and refuses both
new moves and withdrawals.

A set expires 24 hours after creation. `revalidate_transaction_proposal_set` re-reads current state
once per team (its roster, its league rules, the pool state of the players it adds, and its FAAB
balance when a bid is present) and marks each open item `current`, `stale`, or `illegal` with
reasons: the added player is no longer in the pool, a dropped player is no longer on the roster, the
set has no way to give the add a roster place, a rostered player sits in a slot that does not accept
him and the set cannot resolve it, the league's period has closed, the bid exceeds the team's
remaining budget, the league has no FAAB budget, or the team's state could not be read. It validates
one team's set as a set: it first chooses the team's order, then walks that team's items against a
roster projected through the earlier ones. A drop already in the set is gone, an add is already
rostered, and a declared slot move into or out of reserve has already changed what counts against
the team's non-reserve places. A later add therefore relies on the drop or slot move that funds it
instead of being judged against the roster as it stood before the set. Stale and illegal are
different states: stale means the facts behind the item changed or the set itself cannot make it
legal, while illegal means the roster cannot be submitted as it stands. An add that no operation in
the set frees a place for stays stale with `roster_full`, and its reason names the missing operation:
a drop for a player outside a reserve slot, or a slot move into a reserve slot. An illegal item names
the offending player, his slot, and what resolves it, and the check covers every rostered player
because one illegal player blocks any transaction for that team. When a slot the set opens accepts
the offending player, the item carries a roster move, before the transaction when the slot is
already open or after it when the transaction frees it, and the review reports that move as its own
step. The slot can be opened by a drop in the same item or an earlier item.
When no slot in the set is open, the item refuses and names the choice only the person can make,
which is who to drop, and the drop or slot move that would resolve it in this set. Every team with
roster moves also carries its `order`: the sequence the server chose so each move leaves the roster
legal under the league's slots and published roster-change timing, with a `position` for every move
that is still proposed. The set read returns that sequence before submission, with the position every move
holds, and the review says when the league applies the moves. When no order exists, that team's whole set is refused at the check: every move in it is
illegal, the reason names the operations that conflict in plain words, and nothing in that team's
set can be submitted. An item that no operation in the set can make legal is named on its own and
does not make the rest of the team's plan illegal. A trade follows the roster moves in the
published sequence, because it changes no roster until the other manager accepts. A trade is
re-checked against both
rosters, the counterparty's continuing place in the league, and the trade window, and carries its
current state back to the review. Staleness and illegality are recorded beside the item's state and
are never failures; a move that is still proposed stays `proposed`. A set stores only moves that passed the check when they
were proposed, so a fresh set is current; a later check can still make a stored move stale. A team
whose state cannot be read marks only its own items, and the review reports the failure beside that
team. An expired set refuses re-validation
instead of re-checking or executing, so a set that sat overnight cannot be executed from facts nobody
re-checked. `get_transaction_proposal_set` reads the set back with every team, including the teams
that had nothing proposed, each item's state and `settled` flag, last check, each team's planned
`order` with its positions, an item's server roster move as `reserveMove`, every submission in
order, and each move's position and step outcomes, and the same review link. It contacts no
provider: the order is the one the last check planned and saved. A rejected write carries the provider's exact wording, and that wording reaches
both the review page and this tool result. Another account's set is reported as not
found.

The item state vocabulary is `proposed`, `executed`, `pending`, `failed`, `skipped`, and `unknown`.
No MCP tool submits, accepts, or spends anything. Execution happens only when a signed-in owner
submits the moves that are still proposed from the review page. Each submission claims the set in the
database, re-runs the same revalidation immediately before writing, and skips an item that went stale
with its reason rather than attempting it. It sends only the included moves that are still
`proposed`; a move that already ran, failed, or was skipped keeps its outcome. The included moves for
each team then run in the order the server computed for that submission, never in the order the
client sent, and in the same positions the review published. Each executed item records its position
in that order and its steps, so the review shows afterwards that the drop ran before the reserve
move. Each item is
one provider transaction carrying its add and drop together, sent once with no retry; an optional
reserve move is its own recorded step before the add, and a declared slot move is one recorded step on
its own. A waiver claim is `pending` until the provider processes it, and `unknown` means a request
may or may not have applied and is never retried automatically. The set records each submission in
order, with who submitted it and when, the position and outcome of every move it sent, and the
outcome of every step. A move carries `settled`: true when it will not run again because it
executed, its trade offer ended, or it was skipped for a reason that cannot change. A set whose
submission left a move failed stays open for a replacement, and a later submission sends only the
moves that are still proposed; the failed move keeps its own state, outcome, and the provider's
wording beside the retry. A set whose moves have all settled is an audit record and refuses new moves and
another submission. A failed, unknown, or pending item, or one refused before anything was sent,
stops the later steps for that team only, because their checks no longer describe the roster; other
teams continue. A
skipped step keeps the failed step's own wording and says it followed it. A submitted trade stays
`pending` as an offer and is never sent as though the roster had already changed. A trade is sent
once with no retry: an `unknown` propose is recorded as unknown and the person is told to check the
provider's trade page before trying again, because a repeated propose has no proven idempotency. The
review page reads the provider's pending feed and completed trades to show
the trade as pending, accepted, withdrawn, or expired, and can withdraw an offer before acceptance
from our own record or from the provider's pending feed. It never accepts, rejects, votes, counters,
or selects a pick for another manager or the league.

## Client onboarding and scopes

### Per-tool scopes

Every tool enforces one scope, and only that scope. Holding a scope no tool needs, or
lacking a scope a different tool needs, does not change whether a call succeeds.

| Tool                                  | Required scope        |
| ------------------------------------- | --------------------- |
| `list_connections`                    | `fantasy:read`        |
| `list_teams`                          | `fantasy:read`        |
| `get_calendar`                        | `fantasy:read`        |
| `get_league`                          | `fantasy:read`        |
| `get_rosters`                         | `fantasy:read`        |
| `search_players`                      | `fantasy:read`        |
| `get_players`                         | `fantasy:read`        |
| `get_matchups`                        | `fantasy:read`        |
| `get_team_summary`                    | `fantasy:read`        |
| `get_transactions`                    | `fantasy:read`        |
| `get_pending_trade_offers`            | `fantasy:read`        |
| `get_lineup_runs`                     | `fantasy:read`        |
| `submit_feedback`                     | `fantasy:read`        |
| `list_feedback`                       | `fantasy:read`        |
| `propose_transactions`                | `transactions:review` |
| `get_transaction_proposal_set`        | `transactions:review` |
| `revalidate_transaction_proposal_set` | `transactions:review` |
| `withdraw_transaction_proposal_items` | `transactions:review` |
| `set_lineup`                          | `lineups:write`       |
| `set_team_automation`                 | `teams:manage`        |
| `add_team_agent_note`                 | `notes:write`         |

A scope-coverage test derives this table from the tool declarations, so a tool that omits a
scope fails the test suite instead of becoming an open endpoint.

Five resource scopes cover the surface, and each exists because a tool needs exactly that risk:

- `fantasy:read` is one read scope over everything the owner owns. Reading a connection and
  reading a team are the same act of reading the owner's own data, so they are not separate
  scopes. It also covers a lineup run's status, because a run read is a read, and feedback
  submission and read-back, because reporting a problem must stay possible under the scope every
  client holds and it writes only the acting account's own report.
- `transactions:review` stages proposals, reads them back, revalidates them, and withdraws stored
  moves before submission. It writes nothing to the provider and submits nothing.
- `lineups:write` is the roster mutation: `set_lineup` and only `set_lineup`. A lineup change and
  a transaction submission are not the same risk, so they are not the same scope.
- `teams:manage` changes team-level state the owner keeps in Lineupgrade: automation enrollment,
  pause, and resume, and the owner note on the team page. It never contacts the provider.
- `notes:write` appends agent notes to a team the account owns. Each note records the authenticated
  client that wrote it and the time it was written; notes are append-only, and none of them changes
  the owner's note, a lineup, an automation setting, or a transaction.

`submit_feedback` and `list_feedback` require `fantasy:read` rather than a manage grant.
Submission creates only the acting account's own report under the same rate limits and owner
scoping as before, and it is the channel for reporting the scope problem itself, so it cannot sit
behind a scope the client cannot request. Read-back follows submission for the same reason: a
submitter that cannot read its own report's status cannot confirm the report was received or
resolved. Both are owner-filtered, so neither widens access to another account's reports. There is
no tool that changes a report's status; a report closes when the work lands, as the Feedback
behavior section states.

### Retired scope names

Two earlier scope names are gone. A retired name that has a successor is **accepted but never
advertised**: a token or authorization request that carries one is resolved to the current scope at
the enforcement boundary, and neither discovery document nor the onboarding baseline names one. A
new client registration may ask for one, and the registration records it as a capability beside the
current scopes.

| Retired name       | Accepted as    | Why it went                                                                                                             |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `connections:read` | `fantasy:read` | Reading a connection and reading a team are the same act of reading the owner's own data.                               |
| `feedback:manage`  | none           | The feedback surface is submit-and-read only. A token that still holds it keeps working for every other scope it holds. |

`connections:read` is accepted in a token's `scope` claim, in an authorization request, at dynamic
client registration, and on the consent screen; the consent screen shows the description of the
scope it resolves to. A stored client registration keeps the scopes it was granted, so a client
that still requests `connections:read` receives a token whose claim names that scope and every read
tool answers it.
`feedback:manage` has no successor: no tool requires it, and the authorization server no longer
grants it, so a new registration cannot request it.

### First authorization

Request this minimal baseline first:

```text
fantasy:read offline_access
```

It reads connections, teams, leagues, players, matchups, transaction history, and lineup-run
status, submits and reads back feedback, and buys a refresh token. Every other tool answers `403
insufficient_scope` naming the one scope it needs; authorize again for that scope and keep the
existing grant. The complete authorization-server set is
`fantasy:read transactions:review lineups:write teams:manage notes:write offline_access`.
A client platform that refuses `teams:manage` or `transactions:review` still reads, submits
feedback, and runs the tools it was granted.

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
registration records the advertised set and each accepted retired name as a client's capability
ceiling, and the application widens a stored dynamic registration that predates a newly advertised
scope, so an existing client can step up without re-registering. An authorization grant remains
exactly the scope the authorize request asks for.

A client that requests a newly advertised scope and receives `invalid_scope` is hitting a stored
registration ceiling, not a metadata cache: the authorization server validates the request
against the scopes persisted when the client registered, and Client ID Metadata Document clients
refresh that record from their own document on every authorization. The step-up failure reported
against the earlier seven-scope request was this ceiling, amplified by the old `401` telling the
client to request the whole set in one authorization. That seven-scope request was also the
friction the smaller set removes: a client that holds a subset now holds the read scope that
covers every read.

### Manage-scope connection failure (2026-10-29 investigation)

Status note: the feedback surface is submit-and-read only, so `feedback:manage` is retired. The
investigation below is the record of what was tested at the time; `teams:manage` is still advertised.

A client reported that a connect flow asking for `teams:manage` and `feedback:manage` reached the
hosted consent page and then failed with a generic error that named no scope. The investigation did
not reproduce a rejection anywhere on our side, and no scope path refuses either manage scope:

- Both scopes are in `resourceScopes`, so authorization-server metadata, protected-resource metadata,
  and the consent page's own list all carry them.
- A fresh dynamic registration against the deployed origin stores the full seven-scope set as the
  client ceiling, and `/authorize` with `teams:manage feedback:manage` — alone and beside the read
  scopes — answers `302` to the sign-in step, which is past client-scope validation, resource policy,
  and PKCE checks. A rejected scope would instead answer `invalid_scope` naming it.
- The consent path was exercised end to end against a local instance with a signed-in session: the
  full seven-scope request produced the consent page and its confirm step returned a signed redirect
  with an authorization code.
- The delegated table in `BetterAuthAdapter` resolves a request's scopes from the same advertised
  array, and the `/mcp` resource row is seeded with no scope allowlist (`insertOnly` seeding never
  rewrites one), so a resource policy is not dropping the manage scopes.

What remains is on the client side, and telling the two candidates apart needs one observation we do
not have: whether the failing client registers dynamically or as a Client ID Metadata Document
client, and what its own `scope`/`scopes_supported` declares. A Client ID Metadata Document that
omits the manage scopes produces exactly this shape — consent renders, then the authorization fails
— with the error travelling to the client's redirect rather than to our page.

Two honest limits are ours and are recorded rather than silently fixed: the consent page's invalid
state says only that the request is invalid, and the confirm step maps any failure to "we couldn't
confirm your decision". Either could be made to render the authorization server's own `error` and
`error_description` where it supplies them, which would turn a generic failure into a named one. That
is a diagnostics improvement, not a scope fix, so it waits for evidence that a real client still
fails after the client-side questions below are answered.

**Next step.** Ask the reported client for the failing authorization URL's `error` and
`error_description`, whether it uses a metadata document, and that document's declared scopes. If a
metadata document omits either manage scope, the fix belongs in the client; if the error names a
scope while our metadata advertises it, the mismatch is ours and the stored registration is the first
place to look.

### Discovery documents

Authorization-server metadata publishes all six scopes above. Protected-resource metadata
publishes the five resource scopes and omits `offline_access`. That difference is deliberate:
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

A deployment or restart does not invalidate an access token, rotate the signing key, or revoke a
grant. Signing keys and grants are persisted in the service database, and access tokens are
verified against the persisted key. The round-3 deploy on 2026-10-28 accepted a pre-deploy access
token and then a pre-deploy refresh token, which rotated normally; the `jwks` table still held its
single 2026-10-25 EdDSA key. A client that appears to need reauthorization after a deploy is
discarding or replaying its rotated refresh token, not observing server-side invalidation. Persist
the rotated token before using the new access token. Access tokens expiring after five minutes is
by design.

Invalid `tools/call` arguments return HTTP 400 with JSON-RPC `-32602` and name the offending field
path, for example `Invalid tool arguments: Expected a value greater than or equal to 1 at
["limit"]`; `error.data.field` repeats the path. Optional feedback context fields that the published JSON
schema marks nullable accept `null`, which is normalized to absent before the service sees it.

Complete first-request examples, header and `_meta` requirements, and the registration fallback
are in the [client setup](../../README.md#connecting-an-mcp-client).

## Client acceptance

Use actual hosted Muse with a harmless read first: discovery, OAuth/consent, correct scopes, egress, an access-token expiry followed by a public-client refresh rather than a reconnect, structured/text output, continuation use, and bounded-run waiting. The hosted browser runs on our origin, so the client only needs to authorize MCP.

The shared scope check is `bun run mcp:accept`. Its local flow starts a disposable stack and proves discovery, dynamic registration, PKCE, browser sign-in and consent, the full advertised grant, the onboarding baseline, and a legacy grant minted with a retired scope name, with a per-tool table for each. Its provided-token mode checks a deployed origin's metadata, 401 baseline, and per-tool enforcement for the token's scopes without writing. Each tool's required scope comes from the server's own unauthenticated 401 challenge, so the command cannot drift from the declaration the handler enforces. The local flow registers a fresh dynamic client per modern grant; the legacy grant authorizes through the client whose own metadata document still asks for the retired name, which is how a grant minted before the rename looks. See [MCP proof](../../.agents/skills/verify-app/references/mcp.md) for both modes and the report.

OpenCode is a possible fallback after an actual test. Pi compatibility can improve later; retain the starter's stateless/serverless transport rather than adding a legacy/stateful branch.

Acceptance requires actual protocol tests, not only direct handlers. Preserve Effect-free browser/universal runtime contracts and request-scoped identity across simultaneous users.
