# Yahoo call audit

This audit covers every read and write on the provider surface in
`packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.ts`.
The question is not whether an app-level feature makes one call, but how many
HTTP requests reach Yahoo for a given input, and whether a larger batch is
available at the provider.

The provider surface is intentionally thin. `YahooSdk.ts` maps one provider
operation to one SDK aggregate where Yahoo publishes one, and the SDK owns the
URL shape and the provider limits. The audit therefore records the number of
upstream requests, not the number of services or query groups a tool uses.

## Summary

- Player details are batched. `get_players` accepts at most 25 player
  references, and `readPlayerDetails` sends all of them in one
  `players;player_keys=...` request for a season or week period.
- A date-range player-stat read is one request per day, with every requested
  player key in each request. Yahoo has no ranged player-stat endpoint. A
  seven-day window for 25 players is 7 requests, not 175.
- Player-week facts are chunked at 25 keys per request. A missing future
  opponent may add one league-game request, shared by every chunk in that
  operation.
- Player history is one request per period per 25 players.
- League discovery, league rosters, draft picks, and available draft picks are
  already one aggregate request each.
- Player game logs are the one deliberate per-player read. The mobile endpoint
  accepts one player key and publishes no batch form.
- `get_team_snapshot` composes separate public reads. A request-scoped cache
  now shares the same provider read across its sections and the queued plan.
  The cache is created for one snapshot call, is scoped to the connection, and
  does not persist across requests.
- Time on ice is only available when the league itself scores it as a
  category. See [HIDDEN-FACTS.md](HIDDEN-FACTS.md).

## Read operations

`N` is the number of requested player keys. `ceil(N / 25)` is the player-key
chunk count. The provider rejects a player-detail input above 25 keys; the
batch readers that accept more keys chunk internally.

| Provider operation                 | Upstream requests                              | Batching note                                                                                  |
| ---------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `discoverTeams`                    | 1                                              | One aggregate discovery call across the supported games, leagues, and teams.                   |
| `readTeamCards`                    | 1 discovery + 1 scoreboard per active league   | Scoreboards are league-scoped. Reads run with concurrency 4 and a 3 second timeout per league. |
| `readLeague`                       | 1                                              | One league settings request.                                                                   |
| `readStandings`                    | 1                                              | One league standings request.                                                                  |
| `readRoster`                       | 1                                              | One team roster request.                                                                       |
| `readLeagueRosters`                | 1                                              | Every team and every player in the league in one request.                                      |
| `readLeagueGames`                  | 1                                              | One league game list for one scoring week.                                                     |
| `readRosterSchedule`, week period  | 1                                              | One team schedule request.                                                                     |
| `readRosterSchedule`, date period  | 1 per date                                     | Yahoo has no ranged team-schedule endpoint. Dates run with bounded concurrency.                |
| `readPlayerDetails`, single period | 1                                              | Up to 25 player keys in one request.                                                           |
| `readPlayerDetails`, date range    | 1 per day                                      | Every player key is in each daily request. There is no ranged player-stat endpoint.            |
| `readPlayerWeeks`                  | `ceil(N / 25)` + at most 1 league game request | The league game fallback is read once and shared when a future week has no player opponent.    |
| `readPlayerWeekOpponents`          | `ceil(N / 25)` + at most 1 league game request | Same shape as `readPlayerWeeks`.                                                               |
| `readPlayerHistory`                | `periods × ceil(N / 25)`                       | One request per period and player-key chunk.                                                   |
| `readPlayerFacts`                  | `ceil(N / 25)`                                 | Ownership, started percentage, and ranks. Chunked at the provider's 25-key detail limit.       |
| `readPlayerGameLog`                | 1 per player                                   | The mobile game-log endpoint accepts one player key and has no batch form.                     |
| `readGamesPlayed`                  | 1                                              | One team games-played request.                                                                 |
| `readTransactions`                 | 1 per page                                     | The caller supplies limit and offset; pagination is explicit.                                  |
| `readCompletedTrades`              | 1                                              | One league transaction page filtered to trades.                                                |
| `readPendingTrades`                | 1                                              | One team pending-trade request.                                                                |
| `readDraftResults`                 | 1                                              | One league draft-results request.                                                              |
| `readLeagueTeams`                  | 1                                              | One league teams request.                                                                      |
| `readAvailableDraftPicks`          | 1                                              | Every requested team's available picks in one request.                                         |

## Writes

Every write operation is one request: native action, explicit assignments,
transaction execution, trade proposal, trade response, trade withdrawal, and
draft-pick trade. The write surface does not fan out.

## Tool-level call counts

These counts include the context reads a query needs, not only the group the
caller asked for. They are the counts a caller should expect.

### `get_players`

- League and roster context: 1 league read and 1 roster read.
- `actual_stats`, season or week: `ceil(N / 25)` player-detail reads.
- `actual_stats`, last-N-days or a date range: `days × ceil(N / 25)` daily
  player-detail reads. A season-sized range is served as the season series
  rather than daily reads.
- `schedule`: 1 player-week read per 25 players, plus a league game fallback
  when the player endpoint omits an opponent, plus a professional-game source
  read only when the requested window needs one.
- `projections`: 1 player-week read per 25 players. When `schedule` already
  read the same week, the projection path reuses that result. This is the
  change made with this audit.
- `game_log`: 1 mobile request per player, on top of the context reads.

For 25 players and a seven-day hockey window, the call count is 1 league +
1 roster + 7 daily detail reads. For the same 25 players with `schedule` and
`projections` in the current week, the call count is 2 context reads and 1
player-week read, not 2.

### `search_players`

One league-scoped players request for up to 50 rows, plus the league read and,
when a window or schedule is requested, player-week and professional-game
reads. The pool request is not one request per row.

### `get_team_snapshot`

The snapshot is deliberately a composition of summary, league, roster,
transactions, pool, player stats, plan, and offers. Its sections ask for the
same league, roster, standings, draft, matchups, and player weeks. The snapshot
handler provides a request-scoped `ProviderReadCache`, so the first successful
or failed read is reused by every later section and by the queued plan. The
cache is keyed by connection and request shape, never by a session value, and
it is discarded when that snapshot call ends. There is no cross-request cache.
A roster and a free-agent pool ask about different player sets, so each still
gets one player-week read of its own.

## Deliberate exceptions

The following are provider limits, not missing batching:

- One scoreboard request per league in `readTeamCards`.
- One player-stat request per day for a date range.
- One team-schedule request per date for a date period.
- One game-log request per player.
- One request per transaction page.

An app-level batch cannot remove these calls without a Yahoo endpoint that
accepts the wider shape. The audit did not add per-item loops where a batch
exists, and it did not pretend a per-day or per-player endpoint was batched.

## Changes made

- `readPlayerFacts` now chunks player keys at 25 before calling the detail
  endpoint. The previous input bound allowed more than 25 keys while the
  endpoint accepts 25, so a large roster read could have failed instead of
  being split into valid requests.
- `get_players` now reuses the same-week player-week result for projections
  when the schedule group already read it. This removes one 25-player request
  from the common `schedule` plus `projections` call.
- `get_team_snapshot` now provides a request-scoped provider read cache. Its
  summary, league, roster, pool, player-stat, and plan sections share one read
  per distinct request instead of repeating the same Yahoo call.
- `get_players` now asks for the current scoring-week roster when the league
  publishes one, and falls back to the provider's default roster for a
  date-scoped or unavailable period. This lets the snapshot's player hydration
  reuse the summary and roster read instead of making a third roster request.
- Tests pin the 25-player detail read to one request, the same-week reuse to
  one player-week request, and a cached composition to one league read and one
  roster read.

## Verification

- `packages/backend/src/contexts/connections/FantasyQueries.test.ts`,
  "returns every explicitly requested player reference in one response":
  asserts one `read_player_details` request for 25 references.
- `packages/backend/src/contexts/connections/FantasyQueries.test.ts`,
  "reads one player-week batch when schedule and projections cover the same
  week": asserts one `player_weeks` request.
- `packages/backend/src/contexts/connections/FantasyQueries.test.ts`,
  "reuses provider reads across one cached query composition": asserts a
  repeated composition makes no extra provider reads.
- `packages/backend/src/contexts/connections/FantasyQueries.test.ts`,
  "shares league and roster reads across a cached composition": asserts one
  league read and one roster read across summary, league, roster, and player
  hydration queries.
- `apps/web/src/server/mcp/mcpServer.test.ts`, "composes the team snapshot from
  the reads in one tool call": asserts the snapshot provides the request-scoped
  read cache to its query composition.
- `packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.test.ts`
  contains the existing six-player batched URL and seven-daily-read hockey
  window tests.
- `packages/yahoo-sdk/src/efficiency.test.ts` contains the aggregate
  discovery, league-roster, league-search, and paging efficiency tests.
