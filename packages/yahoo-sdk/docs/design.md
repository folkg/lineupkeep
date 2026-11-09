# Yahoo SDK design

This document records the design decisions behind `@lineupkeep/yahoo-sdk`, the
read-only review of the AutoCoach reference, the batching answers, and the
separate integration refactor that will follow. The operational surface is in
[the package README](../README.md); the Android-only endpoints and captures are
in [the Android API notes](mobile-api.md).

## What this package owns

The SDK owns the Yahoo boundary and intentionally exposes only free features:

- fixed origins, browser-session credentials, the crumb handshake, redirect
  refusal, byte and time bounds;
- typed operation inputs and named response values;
- XML write bodies and the provider's own error wording;
- read retry policy, while writes are never retried;
- the distinction between accepted, refused, not sent, and unknown outcomes.

The application keeps policy: scoring, lineup legality, capability
declarations, period resolution, provider registration, persistence, queueing,
session encryption, and the public-internet guard. The SDK never imports
application code.

## Evidence labels

The audit uses four labels, and they are not interchangeable:

- **live-captured** — observed in a real response from the owner's account,
  with credentials and personal values removed before retention.
- **reference-audited** — read from AutoCoach's source or its recorded tests;
  it proves the shape the reference used, not that our current origin accepts
  it today.
- **synthetic** — a package fixture that exercises our decoder or builder.
- **unverified** — no recorded evidence yet.

## AutoCoach reference audit

Reviewed read-only on 2026-11-07 at `fac/auto-coach`. No AutoCoach code,
architecture, credentials, data, or deployment material was copied. AutoCoach
uses two transports: an older OAuth transport on
`fantasysports.yahooapis.com`, and the same browser-session transport on
`pub-api*` that this SDK uses. The OAuth calls below are recorded as call shapes,
not as a recommendation to adopt OAuth. A shape is only a candidate for this
package after it is verified on the browser-session origin.

### Reference calls and their SDK operations

These are the reference calls that now shape the batch-first operations.

#### 1. All leagues, teams, settings, and standings in one read

```
GET https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl,nhl,nba,mlb/leagues;out=settings/teams;out=standings?format=json
```

- **Request shape:** one signed-in user read across four game keys. The first
  `out=settings/teams` selects league settings and teams; the second
  `out=standings` adds team standings.
- **Response shape:** `users[0].user[1].games.{n}.game[1].leagues.{i}.league`
  contains the base league, settings, teams, and standings.
- **What it achieves:** discovers every league and team owned by the user, with
  settings and standings, in one request. It avoids one request per league and
  one settings read per league.
- **Corroboration:** reference-audited only. The SDK implements this shape as
  `leagues.discover`; `session.validate` still uses the plain
  `users;use_login=1` read. No live capture of the four-game aggregate exists,
  and the package test is synthetic.

#### 2. Multi-team rosters with pending transactions and games played

```
GET https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl,nhl,nba,mlb/leagues;league_keys={leagueKeys};out=settings/teams;out=transactions,games_played;transactions.types=waiver,pending_trade/roster;date={date}/players;out=percent_started,percent_owned,ranks,opponent,starting_status;ranks=last30days,last14days,projected_next7days,projected_season_remaining,last4weeks,projected_week,projected_next4weeks;percent_started.cut_types=diamond;percent_owned.cut_types=diamond
```

- **Request shape:** one read for several leagues and their owned teams, with an
  optional date on the roster. It selects settings and teams, then transactions
  limited to waivers and pending trades, then `games_played`, then the roster
  and players with rank, opponent, starting status, and trimmed ownership
  percentages.
- **Response shape:** the same `users → games → leagues → teams` nesting, where
  each team carries `roster`, `transactions`, and `games_played` beside the
  league settings.
- **What it achieves:** one request supplies everything needed to decide and
  apply a lineup for several teams: roster editability, coverage, player
  eligibility and starting status, pending transactions, and remaining
  games/innings limits. It avoids a roster read, a pending-trade read, and a
  games-played read per team.
- **Corroboration:** partial. Our Android capture contains a team aggregate
  with `out=transactions,roster_alerts,stats,standings,games_played,...` plus
  roster and player subresources, so those fields exist on the browser-session
  API. The SDK implements the batch request as `rosters.forLeagues`; it decodes
  rosters, pending transaction identity, and games-played limits from the same
  response. The transaction and games-played shapes were decoded against the
  reference MLB fixtures for that request. The exact multi-league
  `users;use_login` response is reference-audited only.

#### 3. Available players across several leagues in one read

```
GET https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl,nhl,nba,mlb/leagues;league_keys={leagueKeys}/players;status={A|FA|W};sort=R_PO;out=ownership,percent_started,percent_owned,ranks,opponent,starting_status;ranks=last30days,last14days,projected_next7days,projected_season_remaining,last4weeks,projected_week,projected_next4weeks;percent_started.cut_types=diamond;percent_owned.cut_types=diamond
```

- **Request shape:** a player pool scoped by several league keys, one
  availability status, a provider sort, and rich rank/ownership outputs.
- **Response shape:** `users → games → leagues → league → players`, with each
  player carrying ownership, percent started/owned, ranks, opponent, and
  starting status.
- **What it achieves:** compares the same free-agent or waiver pool across
  every league in one request, without repeating the query per league.
- **Corroboration:** reference-audited only. The SDK implements this shape as
  `players.search`, which now takes several league keys and returns grouped
  results. The package test is synthetic.

#### 4. Game-wide player pool with paging and position expansion

```
GET https://fantasysports.yahooapis.com/fantasy/v2/games;game_keys={gameKey}/players;status={A|FA|W};position={positions};sort={R_PO|AR_L30|AR_L14|AR_L4W};count=25;start={offset};out=ownership,percent_started,percent_owned,ranks,opponent,starting_status;ranks=last30days,last14days,projected_next7days,projected_season_remaining,last4weeks,projected_week,projected_next4weeks;percent_started.cut_types=diamond;percent_owned.cut_types=diamond
```

- **Request shape:** a game-wide pool rather than a league-scoped pool, with a
  position filter, page size, offset, and the same rich outputs. AutoCoach
  expands combination roster slots before sending: for example, `W/R/T`
  becomes `WR,RB,TE`.
- **Response shape:** `games → game → players`, with the same player fields as
  the league-scoped player read.
- **What it achieves:** paginates a whole sport's available-player pool
  independently of any one league, which is useful for cross-league research
  and early-season discovery.
- **Corroboration:** reference-audited only. The SDK implements this shape as
  `players.available`, with a required game key, optional position, and a
  bounded page. AutoCoach's helper begins its string with `/games`; the endpoint
  above records the intended path, not its double-slash construction.

#### 5. Starting goalies and pitchers, two pages

```
GET https://fantasysports.yahooapis.com/fantasy/v2/league/{leagueKey}/players;position=S_G;sort=AR;start=0
GET https://fantasysports.yahooapis.com/fantasy/v2/league/{leagueKey}/players;position=S_G;sort=AR;start=25
```

MLB uses `position=S_P` in the same two-call shape.

- **Request shape:** league-scoped player reads filtered to starting goalies
  (`S_G`) or starting pitchers (`S_P`), ordered by actual rank, with two pages
  because the reference expects at most 32 starters and uses 25 per page.
- **Response shape:** `league → players`; the reference reads only each
  player's `player_key`.
- **What it achieves:** identifies the confirmed or probable starters used for
  daily lineup decisions in hockey and baseball. The second page is required
  when a league has more than 25 starters.
- **Corroboration:** reference-audited only. The SDK implements the two-page
  read as `players.starters`; the package test uses the same synthetic page
  twice to prove the offsets and de-duplication.

#### 6. Schedule by date from Graphite

```
GET https://graphite.sports.yahoo.com/v1/query/shangrila/leagueGameIdsByDate?lang=en-US&region=US&tz=America%2FEdmonton&ysp_platform=next-app-sports&leagues={nfl|nhl|nba|mlb}&dates={YYYY-MM-DD}&season={YYYY}
```

- **Request shape:** sport, date, season, language, region, time zone, and the
  app platform. No fantasy session or cookie.
- **Response shape:** `data.leagues[].games[].{gameId,startTime,status}`.
- **What it achieves:** schedules and start times for a sport on a date, plus a
  status that can identify postponed games. AutoCoach uses it to avoid setting
  a lineup around a postponed game.
- **Corroboration:** reference-audited only. The SDK implements this shape as
  `schedule.byDate`. Our recorded game feed is the mobile
  `api-fantasy-mobile` `getGames` resource, which carries different fields on a
  different host; no live Graphite capture exists.

#### 7. Scoreboard for a postponed game

```
GET https://graphite.sports.yahoo.com/v1/query/shangrila/scoreboardGame?lang=en-US&region=US&tz=America%2FEdmonton&ysp_platform=next-app-sports&gameId={gameId}&season={YYYY}
```

- **Request shape:** the same locale/platform parameters with one graph game ID
  and season.
- **Response shape:**
  `data.games[].{awayTeamId,homeTeamId,startTime,gameStatus}`.
- **What it achieves:** resolves the two team IDs for a game whose status is
  postponed, so the caller can mark those teams as unavailable.
- **Corroboration:** reference-audited only. The SDK implements this shape as
  `schedule.game`; no live Graphite capture exists.

### Calls already aligned

- **Add/drop:** AutoCoach posts one `POST /fantasy/v2/league/{leagueKey}/transactions`
  with one `<transaction>` containing an add player and a drop player. Our
  `transactions.apply` already sends one request; the captured add/drop refusal
  is the live evidence for this body. No change was needed.
- **Lineup moves:** AutoCoach builds one
  `PUT /fantasy/v2/team/{teamKey}/roster?format=json` per team containing every
  player move for that team. Our `lineups.assign` already sends the same
  `<roster><players><player>…` shape. The answer to the multi-move question is
  below.
- **Identity:** AutoCoach reads `users;use_login=1` to find the signed-in
  account's GUID. Our `session.validate` reads the same path but only checks
  that a user is present; the GUID is not needed by the current product.
- **OAuth refresh:** AutoCoach refreshes a Yahoo OAuth token. This SDK is
  deliberately session-only and does not model OAuth or refresh tokens.

### Reference conclusions

The reference's efficiency comes from three habits, in descending order of
impact:

1. One `users;use_login` read per user, not one read per league, team, roster,
   pending trade, or games-played limit.
2. One write per team for all lineup moves; one transaction for an add/drop
   pair.
3. A lightweight, unauthenticated schedule service for game start times and
   postponements.

All three habits are now represented in the SDK: aggregate discovery and
rosters, multi-league player search, two-page starter reads, and Graphite
schedule reads. The remaining gap is evidence on the browser-session origin,
not a missing operation.

## Batching answers

### Add/drop

**One transaction.** `transactions.apply` accepts an add and a drop together
and sends `type=add/drop` with both players under one `<players>` wrapper. The
captured provider refusal proves the two-player body reached Yahoo and was
refused for roster state, not for being split. No second request is made.

### Lineup moves

**Yes, one PUT can carry several player moves.** The endpoint accepts a
`<roster>` body with one `<players>` wrapper and multiple `<player>` children,
each with a `player_key` and target `position`. Both the reference and this SDK
send all moves for a team in one body.

The reference is the corroborating evidence for the provider shape: its
`putLineupChanges` path builds one body for every move on a team and calls the
roster endpoint once per team; its transport test asserts one PUT. Our
`lineups.assign` has the same shape, and its test asserts one crumb request plus
one write with two players.

A new live write was not made. There was no safely available browser session
for an idempotent multi-move probe, and changing a real roster merely to prove
a shape would be a worse trade than recording the limitation. Provider
acceptance on the browser-session write origin is therefore
**reference-corroborated, not live-reproduced**. A future safe probe can send
the current assignments unchanged and restore them if needed.

### Trade counter offers

**No provider counter action exists.** Yahoo's transaction resource supports
`accept` and `reject` on a pending trade and a new `pending_trade` proposal;
the guide's "Make Counter Offer" flow builds a new offer. `trades.counter`
therefore sends one proposal POST from the original recipient back to the
original proposer. It does not send a reject for the original. A caller that
also rejects the original is making two writes, which are not atomic;
`trades.respond` exposes that separate action.

`trades.respond` uses the reference-audited `PUT /transaction/{key}` body with
`<action>accept</action>` or `<action>reject</action>`. No live accept or reject
was performed; the body is covered by the XML test.

### Cross-team and cross-league moves

No batch across teams is attempted. The reference also calls the roster
endpoint once per team, and the browser-session endpoint is addressed by team
key. The multi-team efficiency comes from the aggregate reads above, not from a
multi-team write. Do not invent a multi-team write.

## Integration plan

This is a plan for a separate refactor. Nothing here is started by this
package, and no application code imports the SDK yet.

### What swaps

1. **Transport and protocol.** Replace the Yahoo transport inside
   `packages/backend/src/contexts/connections/internal/yahoo/` with the SDK's
   `FetchClient`, `Credentials`, and `YahooProtocol` layers. The adapter stops
   constructing URLs, crumbs, retry schedules, redirect checks, and byte
   bounds.
2. **Payloads and XML.** Delete the adapter's Yahoo JSON normalisation,
   positional payload schemas, and XML builders after the SDK operations cover
   the same calls. Keep a thin mapping layer that turns SDK values into
   `ProviderShape` values.
3. **Errors.** Map the SDK's tagged errors into the adapter's
   `ProviderReadFailure` and `ProviderWriteResult` unions. Preserve Yahoo's
   sentence in `detail` and keep the existing accepted/refused/not-sent/unknown
   distinction. `Unauthorized` and `Forbidden` mark whether the sentence came
   from a structured provider envelope, so an adapter that withholds raw body
   text can keep doing so.
4. **Session material.** Decrypt the owner-scoped hosted-browser session at the
   adapter boundary and pass it to `Yahoo.makeSession`. The SDK does not store,
   refresh, or persist the session.
5. **Public-internet guard.** Supply the application's `PublicInternet`
   implementation to the SDK's HTTP client layer. The SDK records that it does
   not provide this guard; the application must not lose it during the swap.

### What the application gains

- **Batch-first discovery and rosters.** One `leagues.discover` call replaces a
  game-by-game discovery loop, one `rosters.forLeagues` call replaces repeated
  league roster reads, and `players.search` groups several leagues in one
  request. The application can adopt these without a new product surface.
- **Draft-pick trades.** `trades.propose` already accepts `sendPicks` and
  `receivePicks`; the provider body and a successful pending-trade round trip
  are recorded. `ProviderLeagueSettings.tradeDraftPicks` already records the
  league switch, but `ProviderShape.proposeTrade` carries only player key
  arrays. The integration needs a pick asset type, validation against
  `available_draft_picks`, and review UI before this becomes a product
  feature.
- **Mobile-only reads.** Player cards, game logs, season tables, live game
  feeds, statcloud dashboards/matchups/playoffs, Felo, recommended trade
  partners, available draft picks, and team analysis are available for
  product decisions. The current adapter supports football and hockey; adding
  basketball, baseball, or additional mobile surfaces is a separate product
  decision, not an automatic swap.
- **More precise provider failures.** The SDK preserves Yahoo's own sentence
  and separates not-sent from unknown writes. The adapter can stop flattening
  those outcomes.
- **Bounded, retry-safe transport.** Reads have a deadline, response bound, and
  jittered transient retry; writes are never retried. Those guarantees move
  out of the adapter.

### What stays with the application

- scoring, lineup policy, legality, optimizer, and category strategy;
- capability declarations, provider keys, sport mapping, and period
  resolution;
- persistence, queues, task dispatch, rate coordination across users, and
  retry of whole jobs;
- hosted-browser lifecycle, session encryption, consent, and reconnection;
- the public-internet guard and any deployment/network policy;
- product surfaces, feature gates, and the decision to expose a provider
  resource;
- the existing adapter's public `ProviderShape`, which the mapping layer
  preserves.

### Rollout gates

1. **Parity before deletion.** Run the adapter boundary tests against the SDK
   mapping and compare exact URLs, bodies, acceptance, refusal wording, and
   write outcomes. The SDK's tests cover the same facts on synthetic fixtures;
   the captured refusal remains the provider-wording guard.
2. **Reads first.** Swap read operations behind a flag, compare normalized
   `ProviderShape` values on the same team and period, then remove the flag.
3. **Writes second.** Build the same write body through both paths and compare
   it before enabling the SDK path. Start with one team, keep the adapter path
   available, and do not enable writes that have no recorded acceptance or
   refusal evidence.
4. **Delete transport only after no caller remains.** Keep the provider-wording
   fixture and its test with the SDK.
5. **Product features separately.** Draft-pick trading and mobile-only reads
   each need their own contract, UI, and acceptance tests. They do not ride
   along with the transport swap.

### Explicitly not part of the integration

- AutoCoach code, architecture, credentials, data, deployment, or Firebase
  resources;
- OAuth token storage or refresh;
- GraphQL, because no fantasy-data GraphQL operation was observed;
- a multi-team write endpoint;
- automatic acceptance of trades or automatic add/drop moves;
- Plus-gated statistics and features; this SDK is restricted to free features.

## Open evidence gaps

- The multi-league `users;use_login` reads are reference-audited, not
  live-captured on the browser-session host.
- The game-wide and starting-pitcher/goalie player reads are reference-audited;
  their browser-session behaviour and field shapes are not recorded.
- Graphite schedule and scoreboard responses are reference-audited; no live
  capture exists in this package.
- A multi-move lineup PUT is reference-corroborated but not live-reproduced on
  the current write host.
- Trade accept/reject is reference-audited; no live response write is recorded.
  A counter offer is a new proposal and does not itself reject the original.
