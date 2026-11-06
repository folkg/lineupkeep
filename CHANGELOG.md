# Changelog

MCP-facing behaviour changes, newest first. Deployment revisions name the web and worker Cloud Run
revisions that carried each change.

## Unreleased — round-11 MCP fixes (explicit player lists, owner note, draft names)

- `get_players` returns every reference in an explicit list in one response instead of paging at the
  pool page size. The schema states the 25-reference cap and that `team` is league context rather
  than the subject of the read, so a player on another team in the same league resolves normally.
  A live five-reference call with identity, availability, eligibility, actual stats, and scoring
  context returned 1 of 5 players on football and 2 of 5 on hockey under the shared 16 KiB ceiling;
  on those leagues the same call now returns 5 players complete at 10,059 and 7,482 structured
  bytes, and a 9-player roster returns 9 complete at 15,776 and 11,633.
- `get_rosters` with `detail: full` carries the team's `ownerNote`; the compact default still omits
  it. `get_pending_trade_offers` also carries the linked team's `ownerNote`, so a trade decision
  sees the owner's stated intent without a separate `get_team_summary` call. The note remains owner
  context, never a provider or league fact.
- `get_league`'s `draft_history` group carries the provider's inline player name where its
  `draftresults;out=players` read publishes one, beside the private player reference. A pick the
  provider returns without a name keeps only the reference. On the owner's football league the first
  page of draft picks now carries names beside their references instead of references alone.

## Unreleased — refresh grant survival and refusal telemetry

- A refresh token replayed inside the rotation reuse window is replayed for five minutes instead of
  thirty seconds. A retried `POST /api/auth/oauth2/token` whose first response was lost therefore
  recovers the same grant across a slow network or a client restart; a replay after five minutes is
  still refused with `invalid_grant` and still revokes the client-and-person grant family.
- The token endpoint's refusal wide event now carries the OAuth `error` code, `grant_type`, `client_id`,
  and whether a refresh token was presented, so a spend refusal is distinguishable from a failed
  authorization-code exchange without logging any token, code, secret, or email.
- An authorization-code or refresh exchange that omits `resource` is issued for the MCP resource.
  Previously it minted an opaque access token with no audience, which `POST /mcp` could only reject
  with `401 auth.state: invalid` even though the exchange returned 200. An explicit resource is never
  replaced, and an unknown resource is still refused.

## Unreleased — round-10 MCP fixes (ISO instants, free-agent availability, transaction history)

- `get_transactions` `since`/`until` and `list_feedback` `since` accept ISO 8601 instants such as
  `2026-09-20T00:00:00Z`, `...000Z`, `...+00:00`, and `...0000000Z`. They previously required an
  internal `DateTime.Utc` value that a JSON client cannot produce, so every ISO string was refused
  as `Expected DateTime.Utc`; a malformed string is now refused with `Expected a valid UTC DateTime
  string` naming the field.
- `get_transactions` pages the provider's newest-first history when `since` or `until` is given,
  instead of stopping at the newest 50 events. A bounded read fetches up to 500 events (ten pages of
  50); `window.fetched` counts every page, `window.truncated` is true only when that cap stopped the
  read before the requested range began, and a `since` older than the oldest published event is
  reported as `transaction_history_starts_after_range` with degraded coverage. An unbounded read
  still fetches one recent page. On the owner's football league a September bound now reads 138
  events back to 2 September instead of 50 events back to 23 October.
- `get_players` hydrates the `availability` group for references that are not on the current roster,
  such as a free agent or waiver player, with one selected-player provider read for those references.
  It no longer requires `actual_stats` to produce a free agent's `availability`, and the group is
  documented as that read. A player the provider publishes no status for is named in `failures`.
- A player reference that cannot be opened is reported in `failures` with its 1-based input position
  in the message, so a client can match a refused reference to its request. References from a roster
  read resolve in `get_players` for the same team and league; a reference sealed for another owner or
  league is refused there rather than omitted.

## Unreleased — four resource scopes, retired names accepted

- The advertised set is now `fantasy:read transactions:review lineups:write teams:manage offline_access`.
  `connections:read` merged into `fantasy:read`, which is one read scope over the owner's
  connections, teams, leagues, players, transaction history, lineup-run status, and feedback
  reports. `get_lineup_runs` moved from `lineups:write` to `fantasy:read` because reading a run is a
  read; `submit_feedback` and `list_feedback` moved with the connections read scope.
- `feedback:manage` and the public `triage_feedback` tool are gone, along with the internal triage
  operation. A report is filed `open`, read back with its stored status, and closed when the work
  lands; no tool or scope changes it. Submission and read-back stay under `fantasy:read`.
- Retired names are accepted but never advertised: a token whose claim says `connections:read`
  reaches every `fantasy:read` tool, and a stored registration that still asks for it authorizes and
  consents normally. A token that still holds `feedback:manage` keeps working for every other scope
  it holds. Neither discovery document, the onboarding baseline, nor a new client registration
  names a retired scope.

## Unreleased — round-9 MCP fixes (schedule window, roster key, search team)

- `get_team_summary` accepts a `window` of inclusive dates or a `days` count for the `schedule`
  group, so a league whose provider publishes no scoring period still gets a usable schedule. A
  period-less date-scoped league defaults to the rest of the provider's current week. The schedule
  section states its `window` (`start`, `end`, and `source` of `period`, `requested`, or
  `rest_of_week`) and `observedAt`, and a league with neither a period nor a current date is refused
  in one sentence naming `window`/`days` instead of being given invented dates. Authorizing: the
  owner's rotisserie hockey league now returns `2026-10-30` to `2026-11-01` with per-date roster
  counts of 4, 15, and 5, and a 23-player roster across two pages; the head-to-head league's
  scoring-period window is unchanged.
- `get_team_summary` omits the `roster` key entirely when the `roster` group was not requested;
  an empty array is not the same as absent. Schedule rows appear only under `schedule`, so they
  cannot be read as roster rows in either direction.
- A budget refusal now names the largest sections in bytes (`standings`, `categoryPoints`,
  `categoryTotals` for the owner's 13-team league) before naming the groups to drop, instead of only
  asking for fewer groups. The default summary groups and a roster page fit a 13-team hockey league;
  the exact `league`/`standings`/`categories`/`matchup`/`roster` set names the three sections that
  consume the result.
- `search_players` rows carry `proTeam`, the same professional-team abbreviation a roster entry
  carries, so a pool player joins a schedule without another read. Authorizing: ten of ten live
  ownership-sorted rows carried one.
- `search_players` decodes the provider's `IR-NR` and `IR-R` status codes as injured reserve
  instead of `unknown`, and a player-level boolean status flag is `unknown` when `true` rather than
  healthy. A code the adapter has not been taught is still `unknown`.
- `get_league` states that the provider's settings do not say whether an add or drop takes effect
  the same day or the next day, and reports the published waiver and deadline fields as they are.
  The no-per-team-games-played boundary now names every request shape tried: `teams;out=games_played`
  answers with an empty per-team node, and the roster, standings, and players reads refuse that
  output.

## Unreleased — round-8 MCP fixes, part 2 (scoring-period schedule)

- `get_team_summary` accepts a `schedule` group that reports each rostered player's scheduled games
  in the current scoring period: the dates they play, the opponent abbreviation, whether the game is
  home or away, and a games-in-period count, plus a per-date count across the roster so a light
  night needs no client-side arithmetic. A player who does not play in the period is `no_games` with
  a count of zero, never an empty success. Authorizing: a live dated hockey roster read published
  one opponent per player per date, with `null` on a night that player's team did not play.
- The schedule group follows the league's declared coverage. A date-scoped league is read once per
  date of the current scoring period, whose window comes from the provider's own scoring-week dates;
  a league whose cadence is a scoring week reports that week's opponent instead and is never given
  invented dates.
- The gaps are stated in the tool description and in the result: the provider publishes no start
  time and no season-long schedule, a league with no published period window (a rotisserie hockey
  league publishes neither `current_week` nor a week window) says so instead of returning an empty
  list, and one schedule read is capped at 21 dates so a wider window is refused with that limit
  rather than silently truncated.
- `get_team_summary`'s weekly remaining-player-games section is renamed `remainingPlayerGames` so it
  cannot be confused with the new per-player `schedule` section. The roster and schedule sections
  share one player page and cursor; a 22-player, three-game hockey schedule returns in two pages.
- The league players collection is not date-addressable: `players;out=opponent;date=…` returned the
  same opponents as the undated read across different dates, so the date parameter is accepted and
  ignored. The plain collection form therefore cannot carry a per-date schedule into search rows,
  and this change is restricted to the roster.

## Unreleased — round-5 and round-6 MCP fixes

- `get_league` scoring lists the league's configured categories and marks each one `scoring` or
  `informational`, with a `detail` on every informational entry naming the provider flag that
  decided it. The provider sets `enabled` on every category it lists, so a display-only category
  such as Saves or Shots Against in a league that does not score them previously looked scored.
  Authorizing: a live head-to-head hockey league publishes fifteen categories, thirteen scored, with
  Saves and Shots Against display-only.
- Every published category value now carries the same `scoring` marking, in standings totals,
  rotisserie points, and matchup categories, so no surface presents a displayed number as a scored
  one. `get_players` scoring context lists scoring categories only, and an informational stat used as
  a `stat` sort key is refused with the reason.
- `search_players` rows carry `status`: `healthy`, `day_to_day`, `out`, `injured_reserve`, or
  `unknown`, with the provider's own `code` and `detail` where it publishes them and the
  `observedAt` instant. An unrecognised code is `unknown` and never healthy. The provider already
  sends these fields in the search payload; the adapter now decodes them.
- `get_team_summary` includes a roster page only when the `roster` group is requested. A budget
  refusal names what consumed the budget: the roster page when one was requested, otherwise
  `team_summary` with the selected groups listed.
- A continuation cursor reused with different request arguments is refused as a mismatch that names
  the binding instead of "invalid or expired", and a genuinely expired cursor says so. The published
  `cursor` description states the binding in every tool that accepts one.
- `list_feedback` requires `connections:read`, the same scope as `submit_feedback`, so a submitter
  can read back its own reports and their statuses. Triage still needs `feedback:manage`, and every
  query remains owner-filtered, so a submitter never sees another account's reports.
- A rotisserie category the provider publishes no points for is stated per category, including a
  configured category the provider omits from the points array entirely, rather than being absent or
  reading as zero.

## Unreleased — round-4 MCP fixes, part 3 (traded draft picks)

- `get_transactions` trade rows carry `picks`: each traded draft pick's round and the private
  counterparty references for the team that sent it, the team that received it, and the team that
  originally owned it. The live Elite League 25 payload already contained a top-level `picks` array
  on trade transactions; no request parameter was needed, and the adapter had been dropping it. A
  player-for-pick trade now shows both sides.
- A pick-only trade is complete rather than an empty transaction: `players` may be empty while
  `picks` and `teams` carry both sides. `no_movements` now means neither players nor picks, and
  `trade_return_unpublished` means no returning player and no traded pick.
- The provider publishes no draft year or overall pick number for a traded pick, and the field
  descriptions say so; none is inferred.
- The `get_league` draft-history note now points traded picks at the trade transaction instead of
  claiming trade payloads omit them.

## Unreleased — round-4 MCP fixes, part 2 (two-sided trades and draft history)

- `get_transactions` player rows are movements with both ends: `from` is the team the player left
  or null and `to` is the team it joined or null. A trade player carries both teams, so both sides
  of a trade are reconstructible; an add or drop keeps exactly one end. The raw `direction` field is
  removed because it labelled every traded player incoming, hiding the outgoing half.
- A trade carries `parties` with the provider's proposing and receiving team keys when the payload
  publishes them, and otherwise the teams involved as `participant` entries derived from the
  movements, without inventing proposer/receiver roles.
- A transaction that cannot be reconstructed is marked `completeness: {status: "incomplete", code,
  detail}` instead of being served as a complete record. A trade the provider returns with no
  player movements is `no_movements` with an empty `players` array, never a complete empty trade.
  A trade whose published movements only go from one team to the other is `trade_return_unpublished`;
  part 3 below refines that flag once traded picks are decoded.
- The `get_transactions` description states that the provider publishes no proposals resource, so
  pending and rejected trade offers are unavailable, and that a trade transaction carries no draft
  picks. The `transactions:review` description now says the scope cannot review offers it cannot
  see.
- `get_league` adds the `draft_history` group: the provider's `draftresults` read, one row per pick
  with round, pick number, team, and private player reference, beside the league's draft status.
  It is completed draft history, not current or future pick ownership, and the detail note says so.

## Unreleased — round-4 MCP fixes, part 1 (periods, standings, stat names, ownership)

- `get_players` accepts four `period` shapes for `actual_stats`: `{kind: "season"}`, `{kind: "week",
  week}` (with `{week}` still accepted as its short form), `{kind: "preset", preset}` with
  `last_7_days`, `last_14_days`, `last_30_days`, and `{kind: "range", start, end}` with inclusive
  dates. Each provider declares per sport whether it serves each kind `native`, by `aggregated`
  daily reads, or `unsupported`, and the result repeats that in `periodSupport`. An unsupported kind
  is refused naming the kind, whether the provider serves it at all, and what it can serve instead.
  A weekly basis is refused for a week the provider has not completed, instead of silently returning
  season totals as round 3 did.
- Hockey preset windows and explicit ranges are served by summing the provider's daily player
  statistics: one batched request per day for all requested player references, at most 31 days for a
  range, and a whole-season range served as the season series. Aggregated groups report their covered
  dates, the `daily_sum` method, and a `notAggregated` list for average and percentage categories,
  which are never summed. Hockey scoring weeks stay refused.
- `get_league` defaults the `standings` group to `standingsDetail: compact`, which returns every
  team's rank, points, and record in one result (a 13-team table fits inside the budget).
  `standingsDetail: detailed` keeps the per-category totals and rotisserie points and pages teams,
  which the section's `detailNote` states. The compact form omits the scoring dictionary because its
  rows carry no stat references.
- Category values in `get_league`, `get_matchups`, and `get_team_summary` now inline the league's
  stat `name` beside the reference, so a total or rotisserie point needs no dictionary call.
- `search_players` publishes one ownership-change field, `percentOwnedDelta`. The always-null
  `percentOwnedChange` is gone; both delta fields state the provider window in their descriptions.

## 2026-10-28 — round-3 MCP fixes (web `00027-kwq`, worker `00028-29h`)

- `get_team_summary` accepts `groups`, defaults to league, standings, matchup, and roster, and
  pages the roster with a cursor it issues and accepts. A 22-player hockey roster returns every
  fixed section plus a roster page instead of `narrowing_required`; `categories` adds season
  category totals and points. A narrowing result now lists the selectable groups and the remedy.
- `submit_feedback` accepts `null` for optional context fields, matching the published JSON
  schema, and stores only the provided fields. Invalid tool arguments return HTTP 400 with
  JSON-RPC `-32602` naming the field path in the message and `error.data.field`.
- `get_players` refuses a supplied `period` when the provider has no weekly player series for the
  sport, naming the reason and the remedy. Football completed weeks keep the weekly basis; hockey
  weekly series are absent. Date-scoped recent-window splits are deferred in the roadmap.
- `get_transactions` player rows carry inline identity (name, positions, professional team) beside
  the private reference and direction, so the common what-changed query needs no extra join.
- Deploys do not invalidate access tokens, rotate signing keys, or revoke grants. A pre-deploy
  access token and refresh token both worked after the round-3 deploy, and the single 2026-10-25
  signing key was unchanged. Access tokens expire in five minutes by design; clients must persist
  each rotated refresh token. See [the MCP contract](docs/fantasy-manager/MCP.md#discovery-documents).
