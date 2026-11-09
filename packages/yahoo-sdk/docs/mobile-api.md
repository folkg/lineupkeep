# Yahoo Android API notes

These notes come from the Yahoo Fantasy Android app (12.12.3, targetSdk 36) on a rooted Android 16 emulator. Traffic was decrypted with mitmproxy after installing the proxy CA into the system store and Android's Conscrypt runtime store. Only paths, query names, statuses, and JSON/XML shapes were retained; cookies, crumbs, tokens, request bodies for login, and player/league identifiers were not.

The app uses four separate surfaces. All are cookie-authenticated. The web `pub-api` v2/v3 surface remains the source of most fantasy data; the mobile surfaces add app-only layouts and live scoring. The app links Apollo GraphQL for community/chat features, but no fantasy-data endpoint observed during this capture used GraphQL.

## Hosts

| Host                                         | Role                                             |
| -------------------------------------------- | ------------------------------------------------ |
| `pub-api.fantasysports.yahoo.com`            | Web v3/v4 reads: crumb, Felo, subscriptions      |
| `pub-api-ro.fantasysports.yahoo.com`         | Web v2 reads                                     |
| `pub-api-rw.fantasysports.yahoo.com`         | Web v2 writes                                    |
| `pub-api-android-ro.fantasysports.yahoo.com` | Android v2 reads and aggregate resources         |
| `pub-api-android-rw.fantasysports.yahoo.com` | Android v2 writes                                |
| `api-fantasy-mobile.sports.yahoo.com`        | Android v2 JSON resources                        |
| `api-statcloud.sports.yahoo.com`             | Live scoring, brackets, league and matchup views |
| `dfyql-ro.sports.yahoo.com`                  | App config and dashboard bootstrap               |
| `wyql-ro.sports.yahoo.com`                   | Wallet summary                                   |
| `sports-fandom-api.sports.yahoo.com`         | Shop balance                                     |

## Verified reads

`{leagueKey}`, `{teamKey}`, `{playerKey}`, and `{gameKey}` are placeholders. Every request carried `format=json` or `format=json_f`.

### Android v2 aggregate reads

- `/fantasy/v2/game/{gameKey};out=game_weeks/leagues;league_keys={leagueKey};out=settings,prize_info;week=current/teams;team_keys={teamKey};out=transactions,roster_alerts,stats,standings,games_played,stats_collection,matchups;matchups.summary=1;transactions.count_only=1;transactions.types=waiver,pending_trade;stats_collection.types=season,week;stats_collection.week=current;stats.type=week;stats.week=current;stats.show_live_projected_points=1/roster;week=current/players;show_hd_images=1;images_width=200;images_height=200;crop_image=0;out=player_notes,opponent,videos,ownership,watchlist,matchup_rating/stats;type=week;week=current;show_projected_stats=1;show_live_projected_points=1`
  - 33 KB response. Contains game weeks, league settings, team standings, season/week stats, matchups, roster, player notes, opponents, ownership, watchlist, matchup rating, and live projections.
  - Date-based sports use `date=today` or `date=YYYY-MM-DD` in place of `week=...`.
- `/fantasy/v2/league/{leagueKey};out=settings,league_notes,unread_note_count/teams;out=standings,stats_collection;stats_collection.types=season`
  - League home: settings, notes, unread count, team standings and season points.
- `/fantasy/v2/league/{leagueKey};out=league_notes`
- `/fantasy/v2/league/{leagueKey};out=commish_notes`
- `/fantasy/v2/league/{leagueKey};out=teams/draftresults/players;show_hd_images=1;images_width=200;images_height=200;crop_image=0`
  - Draft results with player names.
- `/fantasy/v2/league/{leagueKey};out=settings/teams;out=players,standings,recommended_trade_partners,positional_ranks;positional_ranks.starters_only=0`
  - Adds `recommended_trade_partners` (currently only `team_key`) and positional ranks.
- `/fantasy/v2/league/{leagueKey}/teams;team_keys={teamKey},{teamKey};out=available_draft_picks,positional_ranks,standings;positional_ranks.starters_only=1;/roster;week={week}/players;...`
  - The trade builder read. `available_draft_picks.picks[].pick` is `{ round, cost, pick }`; no original-team field was observed.
- `/fantasy/v2/league/{leagueKey}/transactions;start=0;count={n};types=add,drop,trade`
- `/fantasy/v2/leagues;league_keys={leagueKey}/players;player_keys={playerKey};...`
  - Player research: game log, schedule, ranks over `last7days`, `last14days`, `last30days`, season, averages, ownership, percent started, player notes, videos, watchlist, matchup rating.
- `/fantasy/v2/league/{leagueKey}/players;...;out=opponent,transactions,ranks,ownership,player_notes,percent_owned,percent_owned_trend,videos,matchup_rating;sort=PTS;sort_type=projected_week;...`
  - Players tab, including projected stats and 26-row pages.
- `/fantasy/v3/game/{gameKey}/league/{leagueId}/felo`
  - Felo score, tier, weekly change, per-team and per-manager rows.
- `/fantasy/v3/projected_vendors/{sport}`
  - Projection vendor list; returned an empty list for the captured NHL league.
- `/fantasy/v4/achievements/getUnviewedUserAchievement`
- `/fantasy/v3/user/subscriptions`
- `/fantasy/v3/suggested_players?team_key={teamKey}&roster_key={teamKey}&context=...`

### Android JSON resources

- `GET /v2/fantasy-android/getGames?league={leagueKey}&week={week}`
  - NFL/NHL/NBA/MLB games with scores, status, venue, weather, broadcast and team records.
- `GET /v2/fantasy-android/getFantasyPlayerCards?leagueKey={leagueKey}&playerKeys={keys}&subviews=overview,gameLog,seasonStats,leagueAvailability`
  - Player card header, availability, stats, league data, destinations, and lazy-view parameters.
- `GET /v2/fantasy-android/getFantasyPlayerGameLog?leagueKey={leagueKey}&playerKey={playerKey}`
  - Headers, one row per game, cells, opponent abbreviation and a stat legend.
- `GET /v2/fantasy-android/getFantasyPlayerSeasonStats?leagueKey={leagueKey}&playerKey={playerKey}`
  - Header cells, current rows, and prior-season tables.
- `GET /v2/fantasy-android/getFantasyPlayerCardLeagueAvailability?...`
- `GET /mobile/news/v1/section/home_news`

### Statcloud

- `GET /mobile/fantasy/dashboard?game_code={sport}&include_best_ball_leagues={0|1}`
  - `my_leagues_and_team_keys` keyed by league key; each entry carries name, team keys, sport, scoring, draft config, dates, playoff settings, chat flag.
- `GET /mobile/fantasy/league_and_teams?league_key={leagueKey}`
  - Position types, roster positions, teams with managers, waiver/FAAB, streak, moves/trades, logo.
- `GET /mobile/fantasy/matchups_by_league_key-2?league_key={leagueKey}&roster_key={teamKey}`
  - Live matchup scores, win probability, current win percentage, remaining games, team map.
- `GET /mobile/fantasy/playoffs_by_league_key?league_key={leagueKey}`
  - Playoff matchup slots and bracket context. The app emitted a leading double slash; the SDK sends the single-slash path.
- `GET /mobile/fantasy/matchup_player_scores-6?league_key={leagueKey}&matchup_week={week}&team_key={teamKey}&include_other_matchups=...`
  - Per-team player scores, initial/live projections, minutes remaining, roster positions, stat scores. The `-6` suffix was observed for NFL and is exposed as `sportSuffix` rather than assumed universal.
- `GET /mobile/fantasy/matchup_players_by_team_key?...`
- `/mobile/fantasy/my_leagues_and_teams-2`, `league_events-2`, `matchup_events-2`
- `GET /mobile/editorial/{sport}/teams`

### App bootstrap

- `GET dfyql /v2/appConfig?lang=&region=&slateTypes=`
- `GET dfyql /v2/user?lang=&region=`
- `GET dfyql /v2/dashboard?lang=&region=`
- `GET wyql /fantasywallet/v2/user`
- `GET sports-fandom /v1/shop/balance`

## Draft-pick trades

The trade builder has a `Players` / `Draft Picks` toggle. Picks are available only when the league setting `can_trade_draft_picks` is true. The captured NFL league had it set to `0`; a hockey league had it set to `1` and exposed six rounds. The Android app sent this body for a Round 1 for Round 1 proposal:

```xml
<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<fantasy_content>
  <transaction>
    <type>pending_trade</type>
    <trader_team_key>{traderTeamKey}</trader_team_key>
    <tradee_team_key>{tradeeTeamKey}</tradee_team_key>
    <picks>
      <pick>
        <source_team_key>{traderTeamKey}</source_team_key>
        <destination_team_key>{tradeeTeamKey}</destination_team_key>
        <round>1</round>
      </pick>
      <pick>
        <source_team_key>{tradeeTeamKey}</source_team_key>
        <destination_team_key>{traderTeamKey}</destination_team_key>
        <round>1</round>
      </pick>
    </picks>
  </transaction>
</fantasy_content>
```

A pick's identity is its round and source team; `cost` and `pick` from `available_draft_picks` were not in the write body. When only players are traded, the app sends `<players>` and no `<picks>`; the SDK emits `<players>` first when both are present. A mixed player-and-pick body was not captured.

The first attempt was refused with HTTP 400 and this exact sentence:

> Player Devin Cooley is in a IR position on your roster, but is no longer on the real-life IR. Please edit your lineup to activate this player from your IR and then attempt your transaction again.

After the owner moved Cooley, the same Round 1 for Round 1 proposal returned HTTP 201 and a pending trade at `{leagueKey}.pt.{n}`. The response carried both picks with `source_team_key`, `destination_team_key`, and an additional `original_team_key` / `original_team_name`. The app then exposed the pending trade under **Pending Trades** with a **Cancel trade** action. Cancelling sent `DELETE /fantasy/v2/transaction/{transactionKey}` and returned 204; the pending trade disappeared. Nothing was accepted or applied.

`trades.propose` accepts `sendPicks` / `receivePicks` as `{ round }` values alongside optional player arrays. At least one player or pick is required. The same round may appear on both sides; duplicate rounds on one side are rejected before sending. `transactions.pendingTrades` already decodes the response's pick `original` field.

## Unverified or deliberately not modelled

- Draft-pick trade with both players and picks in one body.
- A pick's original team when it has been traded before; the observed shape only carries round, cost and pick.
- Statcloud `league_events`, `matchup_events`, `league_players_by_league_key`, and `matchup_players_by_team_key` payloads.
- Swipe Starter, promo/upsell, shop, wallet and news resources; these are app engagement surfaces rather than fantasy data.
- GraphQL queries. Apollo is present for community/chat, but no fantasy-data GraphQL operation was observed.
- The exact semantics of `sportSuffix` in `matchup_player_scores-{n}`; only `-6` was observed, for NFL.
