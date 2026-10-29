# Changelog

MCP-facing behaviour changes, newest first. Deployment revisions name the web and worker Cloud Run
revisions that carried each change.

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
