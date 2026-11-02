# Schedule sources

What the professional-team schedule can come from, what each candidate actually publishes, what its terms
permit, and how a schedule observation should be stored, refreshed, joined, and served. This is an investigation and a
recommendation; it implements nothing. The decision it supports is recorded in
[ADR 0011](fantasy-manager/adr/0011-schedule-observations-and-schedule-sources.md) and the work is sliced in
[ROADMAP F1](ROADMAP.md#f1--the-professional-team-calendar).

Probed 2026-11-01. Every request below was read-only, unauthenticated unless stated, and issued from this
workstation. No provider was written to. No cookie, session, key, or account identifier appears here.

## The answer

**Caching is what makes our reads efficient; an external source is what gives us facts the provider does not
publish.** Those are two different problems and the owner's request bundles them.

The fantasy provider publishes no season or team schedule at all: the only schedule fact it carries is one
opponent abbreviation per rostered player per date or scoring week, and only for players on a linked roster
([DECISIONS round 13](fantasy-manager/DECISIONS.md#round-13--schedule-cache-source-and-identity),
[RESEARCH](fantasy-manager/RESEARCH.md#pool-player-schedule-shapes-2026-10-31)). Today that fact costs one
roster read per linked team per date in the window. Five linked teams over a three-date window is fifteen
provider reads per automation tick, and an hourly tick makes that up to 360 reads a day for the same handful
of answers. Storing what we already read drops that to five reads a day with no new source, no new contract,
and no new failure mode. That is the first slice and it is not the interesting part of this document.

The interesting part is that the provider's fact is thin. It has no key for the opponent, no start time, no
venue, no cancellation state, and no reach beyond the current period. Anything that needs "does this team
play next Tuesday", "when does the game start", "has it been postponed", or "which of these two games is
first" needs a source the provider does not offer.

Of the sources probed, exactly one is both usable today and good at the job: **the NHL's own public API,
`api-web.nhle.com`**. It is free, needs no key, publishes a whole league week in one 100 KB request with
`startTimeUTC`, `venueTimezone`, and a `gameScheduleState` field, and its `robots.txt` allows the site with a
`use=reference` content signal. It covers one of the two sports the owner's leagues actually use.

**The Yahoo endpoint the owner means is `graphite-secure.sports.yahoo.com`, and it is technically the best
candidate by a wide margin — and it is the one we must not use.** It publishes every game of every season for
every sport, and its team identifiers are literally the fantasy provider's own `editorial_team_key` values
(`nhl.t.6`), so it joins with no mapping at all. Yahoo's Universal Terms of Service prohibit exactly this use
in two separate clauses, quoted below. It is not a grey area and it is not a rate-limit question.

So the recommendation is three-part:

1. **Cache our own reads now**, in a schedule-observation store with a per-observation freshness policy. This is the
   efficiency win the owner asked for and it needs no external dependency.
2. **Add the NHL's own API as the first external source**, for the facts the provider does not publish, using
   the same store and the same identity rule.
3. **Do not add Yahoo graphite without written permission, and do not add an NFL source yet.** The provider's
   own opponent fact already answers the question automation asks about NFL games, and no current feature
   needs NFL start times or a full NFL season. If one does, the cheapest licensed option is TheSportsDB at
   $20/month, which is a real monthly cost for one sport's worth of facts we do not yet need.

If the owner wants graphite specifically, the request is a written permission from Yahoo, not a technical
change: the integration shape is already known and is recorded in this document so that a permission grant
does not need a second investigation.

## Method

- Every URL below was requested with `curl`, a desktop browser user agent, and `Accept: application/json`,
  with no cookie, no token, and no session. Nothing was authenticated.
- Status, byte size, and wall time are as measured from this workstation on 2026-11-01 between 11:20 and 11:45
  CST. Timings are single samples, not benchmarks.
- Payload shapes are trimmed to the fields that matter. Logo URLs, ticket URLs, and colour fields are omitted.
- Sources that were not probed are labelled **unprobed** and are not used in the comparison.
- The fantasy provider's own API was not re-probed: its schedule surface is established in
  [RESEARCH](fantasy-manager/RESEARCH.md#pool-player-schedule-shapes-2026-10-31) and
  [round 13](fantasy-manager/DECISIONS.md#round-13--schedule-cache-source-and-identity).

## Candidates

### 1. Yahoo "graphite" — `graphite-secure.sports.yahoo.com`

**What it is.** Yahoo Sports' GraphQL gateway for its public site and apps. It exposes persisted queries
under `/v1/query/shangrila/{queryName}`, called with plain query parameters rather than a GraphQL body. It is
not the Fantasy Sports API: different host, different service, different terms. `graphite.sports.yahoo.com`
serves the same queries over HTTPS and returned byte-identical results.

The query names are not published by Yahoo. They are enumerated by third parties; the shape of
`teamScheduleBySeason` below was found through the [sportsdataverse Yahoo reference][sdv-yahoo] and confirmed
by probing. Every query name in this document was executed, not copied.

| Request                                                                                                                          | Status | Bytes   | Time   |
| -------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------ |
| `GET /v1/query/shangrila/teamScheduleBySeason?season=2026&teamId=nhl.t.6`                                                        | 200    | 267,159 | 0.27 s |
| `GET /v1/query/shangrila/teamScheduleBySeason?season=2026&teamId=nfl.t.12`                                                       | 200    | 62,412  | 0.20 s |
| `GET /v1/query/shangrila/teamScheduleBySeason?season=2026&teamId=nba.t.2`                                                        | 200    | 253,100 | 0.26 s |
| `GET /v1/query/shangrila/teamScheduleBySeason?season=2026&teamId=mlb.t.10`                                                       | 200    | 594,408 | 0.32 s |
| `GET /v1/query/shangrila/leagueGameIdsByDate?leagues=nhl&week=&dates=2026-11-01&startRange=&endRange=&season=2026&seasonPhases=` | 200    | 805     | 0.13 s |
| `GET /v1/query/shangrila/leaguesSeasonStates?leagues=nhl,nfl,nba,mlb`                                                            | 200    | 7,555   | 0.14 s |
| `GET /v1/query/shangrila/teamSearch?name=Oilers&imageHeight=40&imageWidth=40`                                                    | 200    | 2,955   | 0.13 s |
| `GET /v1/query/shangrila/teamScheduleBySeason?season=2026&teamId=nhl.t.999`                                                      | 200    | 37      | 0.14 s |

**What a game carries.** One `teamScheduleBySeason` response is the whole season for one team. A game node,
trimmed:

```json
{
  "gameId": "nhl.g.2026091906",
  "homeTeamId": "nhl.t.6",
  "awayTeamId": "nhl.t.28",
  "homeTeam": { "teamId": "nhl.t.6", "abbreviation": "EDM", "fullName": "Edmonton Oilers" },
  "awayTeam": { "teamId": "nhl.t.28", "abbreviation": "WPG", "fullName": "Winnipeg Jets" },
  "season": 2026,
  "seasonPhase": "PRESEASON",
  "startDate": "2026-09-19-07:00",
  "startTime": "2026-09-19T17:00:00-07:00",
  "status": "FINAL",
  "statusDisplayName": "Final",
  "venue": { "displayName": "Rogers Place" },
  "week": null
}
```

The team node also carries `leagues[]` with `currentSeason`, `currentSeasonPhase`, and every `leagueSeasons`
entry, so one request establishes the season numbering it is reporting against.

**Per sport, what it provides.**

| Sport            | Season games observed    | Horizon of the 2026 read | Start time       | Home/away keys  | Venue          | Status codes seen                            |
| ---------------- | ------------------------ | ------------------------ | ---------------- | --------------- | -------------- | -------------------------------------------- |
| NHL (`nhl.t.6`)  | 88 (preseason + regular) | 2026-09-19 → 2027-04-10  | yes, with offset | yes, both sides | yes, name only | `FINAL`, `PREGAME`                           |
| NFL (`nfl.t.12`) | 20 (preseason + regular) | 2026-08-15 → 2027-01-10  | yes, with offset | yes, both sides | yes, name only | `FINAL`, `PREGAME`                           |
| NBA (`nba.t.2`)  | 84                       | 2026-10-08 → 2027-04-11  | yes, with offset | yes, both sides | yes, name only | `FINAL`, `PREGAME`                           |
| MLB (`mlb.t.10`) | 203 (spring + regular)   | 2026-02-20 → 2026-10-07  | yes, with offset | yes, both sides | yes, name only | `FINAL`, `PREGAME`, `POSTPONED`, `CANCELLED` |

The whole next season is published well before it starts: `teamScheduleBySeason?season=2027&teamId=mlb.t.10`
returned 194 games beginning 2027-02-19, on 2026-11-01.

**Postponement and cancellation.** Observed, not inferred. The 2026 Yankees schedule carried six such games:

```json
{
  "gameId": "mlb.g.460523110",
  "startTime": "2026-05-23T10:35:00-07:00",
  "status": "POSTPONED",
  "statusDisplayName": "Ppd",
  "displayResult": "Ppd",
  "venue": { "displayName": "Yankee Stadium" }
}
```

The status is a machine code (`POSTPONED`, `CANCELLED`) with a short display name (`Ppd`, `Canc`). The
original `startTime` is retained; the make-up game is a separate `gameId` on a new date, so a postponement
shows as a status flip on the existing game, not as a removal. The 2025 season carried `POSTPONED` and
`CANCELLED` too, so the vocabulary is not new.

**How quickly a postponement appears: unprobed.** No game flipped status during this pass. What is known:
the response is served with `cache-control: max-age=60, public, stale-while-revalidate=1200`, so Yahoo itself
refreshes at most once a minute and serves up to twenty minutes of stale data; and the status is the same
field the Yahoo Sports site renders. How long after a league announcement the field changes is unmeasured.

**The start-time offset is not the venue's timezone.** Every offset observed was US Pacific: the Carolina
home game on 2026-11-01 is `2026-11-01T10:00:00-08:00`, and the same game from the MLB Stats API is
`2026-11-01T18:00Z`. A Yankee Stadium game on 2026-06-06 is `2026-06-06T16:35:00-07:00` here and
`2026-06-06T23:35:00Z` there — the same instant. Treat `startTime` as an absolute instant and ignore the
offset for display. No venue timezone is published at all: the venue node has `displayName` and nothing else.

**Two silent wrong answers, both observed.**

- An unknown team key returns `200` with `{"teams":[]}` — an empty array, not an error. The caller must read
  an empty `teams` as "no such team" and must never read it as "no games".
- A valid team key from a different league is accepted and answered: `season=2026&teamId=nfl.t.12` returned
  Kansas City's NFL schedule in full. The `season` parameter does not constrain the league, so the adapter
  must verify the returned `teamId` and league before storing anything.

A team whose season is not yet published returns `200` with `games: []` and `byeWeeks: []` — a real empty,
distinguishable from the unknown-team case only by the presence of the team node.

**Terms — decisive against use.** Yahoo's Universal Terms of Service, read 2026-11-01 at
<https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html>, prohibit both halves of what a schedule cache is:

> access or collect data, or attempt to access or collect data, from our Services using any automated means,
> devices, programs, algorithms or methodologies, including but not limited to robots, spiders, scrapers, data
> mining tools, or data gathering or extraction tools, for any purpose without our express, prior permission.

> use any material or content from, including without limitation any data, (a) to create any database,
> archive, mobile application, data feed, widget or any other aggregated data source that competes with or
> constitutes a material substitute for the Services, in whole or in part, offered on any of our Services or
> the services offered by our data providers, or (b) to provide any service that competes with or constitutes
> a material substitute for our Services or data offered by Yahoo or our data providers.

`https://sports.yahoo.com/robots.txt` additionally disallows `/api/` for every agent and disallows the whole
site for a list of agents that includes `anthropic-ai` and `ClaudeBot`. The gateway host publishes no
`robots.txt` (404), which is not a grant.

**Rate limiting: none observed.** Ten sequential and five concurrent gateway requests completed in
0.13–0.70 s with no `429` and no `Retry-After`; the one non-200 in that batch was a `400` for a malformed
date parameter of my own, not a refusal. That is a sample, not a guarantee; there is no published limit.

**Documented or versioned: no.** No public documentation, no version negotiation beyond the `version = 1` in
the error text, no deprecation policy. The query names are internal, and Yahoo has changed them without
notice before (the third-party reference tracks 107 of them). A rename returns
`UnknownQueryException: Unknown Query: version = 1, namespace = shangrila, queryName = ...` with status 400.

**Cost: zero.**

### 2. Sportsnet — `stats-api.sportsnet.ca/ticker`

**What it is.** The scoreboard feed behind Sportsnet's site and apps, found by reading
`https://www.sportsnet.ca/wp-content/themes/sportsnet-nhl/js/lib/snet.scoresDatav2/snet.scoresDatav2.js`,
which names the host directly. The WordPress JSON API on the site itself (`/wp-json/snapi/v0.1/games`)
returns 200 with a zero-byte body and is not the data path.

| Request                                                     | Status | Bytes     | Time   |
| ----------------------------------------------------------- | ------ | --------- | ------ |
| `GET https://stats-api.sportsnet.ca/ticker`                 | 200    | 2,017,480 | 0.33 s |
| `GET https://stats-api.sportsnet.ca/ticker?date=2026-11-01` | 200    | 2,017,480 | —      |

The `date` parameter is ignored: both requests returned the identical payload.

**What it provides.** 822 games across 16 leagues in the sample — `nhl` 60, `nba` 58, `nfl` 14, `mlb` 1,
`ncaamb` 440, `ahl` 54, `whl` 35, `ohl` 31, `qmjhl` 27, `mls` 30, `epl` 15, plus `chlg`, `fran`, `liga`,
`seri`, `wnba`. It is a **live window**, not a schedule: the observed span was 2026-10-31T08:30-04:00 to
2026-11-08T03:00:00Z, about eight days, and the same window is returned whatever date is asked for.

A game node carries `game_status` (`Final`, `In-Progress`, `Pre-Game`, `time-tbd`, `Cancelled`, `unnecessary`),
`datetime` (mixed `Z` and offset forms), `location`, `city`, `league`, `sport`, `tba`, and `visiting_team` /
`home_team` with a UUID `id`, `name`, `short_name`, `city`, and score.

**What it does not provide.** No season schedule. No horizon beyond about a week. No game identifier that
corresponds to anything the fantasy provider publishes. No venue timezone. No documented postponement state
(`Cancelled` was observed; `Postponed` was not).

**Terms.** The site's `robots.txt` disallows `/wp-json/` for all agents and sets `Crawl-delay: 10`. The data
host publishes no `robots.txt` (404) and no terms page. Nothing in this pass establishes permission.

**Reliability.** Undocumented, unversioned, no SLA. The response advertises `cache-control: max-age=11` and
`access-control-allow-origin: *`; the site polls it every 10.5 seconds. **Rate limiting: unprobed.**

**Cost: zero.**

**Verdict: unusable as a schedule source.** Two megabytes per request for an eight-day window is the wrong
shape for a cache, and it cannot answer "does this team play in three weeks". It could serve as corroboration
for "is tonight's game still on", but it is too heavy and too undocumented to be worth that.

### 3. NHL — `api-web.nhle.com`

**What it is.** The NHL's own public data API, the one behind NHL.com and the NHL app.

| Request                                     | Status            | Bytes   | Time   |
| ------------------------------------------- | ----------------- | ------- | ------ |
| `GET /v1/schedule/2026-11-01`               | 200               | 100,477 | 0.15 s |
| `GET /v1/club-schedule-season/EDM/20262027` | 200               | 176,185 | 0.16 s |
| `GET /v1/club-schedule-season/EDM/now`      | 307 → `/20262027` | 0       | —      |

The `/now` alias redirects. Our `PublicInternet` client rejects redirects by design
(`PublicInternetUnavailable`, reason `blocked_redirect`), so the adapter must ask for the concrete season,
which it can learn from `leaguesSeasonStates` or from `club-schedule-season` with an explicit season id.

**What it provides.** `GET /v1/schedule/{date}` returns **seven days of the entire league** — `gameWeek[]`
with `date` plus `games[]`, 50 games in the observed week — and a `nextStartDate` / `previousStartDate`
cursor, so a whole season pages in about 30 requests. Each game carries `id`, `startTimeUTC`,
`venueTimezone` (`US/Eastern`), `venue.default`, `gameState` (`PRE`, `LIVE`, `FINAL`, `OFF`), `gameType`,
`season`, `homeTeam` / `awayTeam` with `abbrev` and `id`, and `gameScheduleState`.

**Identity.** NHL team `id` values are numeric NHL ids, and the abbreviation (`CAR`, `WPG`, `EDM`) is the
league's own. Neither is the fantasy provider's key. The bridge is the provider's own roster rows, which
publish `editorial_team_key` (`nhl.t.26`) and `editorial_team_abbr` together — a provider-published pair, not
a guess. NHL abbreviations are unique within the league, so the mapping is one-to-one and can be verified.

**Postponement.** `gameScheduleState` is the field that carries it. Every game in the 2025-26 and 2026-27
Edmonton schedules carried `OK`, so no postponed example was read from the API. The vocabulary is nevertheless
published by the league's own web client: `wsr.nhle.com/static/js/main.bundle.js` decodes `gameScheduleState`
as `OK` (scheduled), `TBD`, `PPD` (postponed), `SUSP` (suspended), and `CNCL` (cancelled), and `gameState` as
`FUT`, `PRE`, `LIVE`, `CRIT`, `OVER`, `FINAL`, and `OFF` (read 2026-11-01). The adapter decodes those named
values and turns anything else into "unknown", never "on". `gameState` and `startTimeUTC` are the fields a
reschedule would change.

**Terms.** `https://api-web.nhle.com/robots.txt` returns a Cloudflare content-signal block:

```
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /
```

Our use is not AI training and not search indexing; it is reference use of game facts to decide when to run
a lineup check. That is within `use=reference` and allowed by `Allow: /`. No API-specific terms page was
found on the host (**unprobed**: whether a separate data-licence page governs the API).

**Reliability.** Undocumented as an API, but stable enough that the official site and app depend on it. No
key, no rate limit observed, no version negotiation. **Rate limiting: unprobed beyond ordinary use.**

**Cost: zero.**

### 4. MLB — `statsapi.mlb.com`

| Request                                                                  | Status | Bytes     | Time   |
| ------------------------------------------------------------------------ | ------ | --------- | ------ |
| `GET /api/v1/schedule?sportId=1&date=2026-10-01`                         | 200    | 1,716     | 0.15 s |
| `GET /api/v1/schedule?sportId=1&startDate=2026-03-01&endDate=2026-11-01` | 200    | 3,748,432 | 0.54 s |

The most efficient schedule endpoint probed: a **whole season in one request** (2,858 games, 3.7 MB) or a
single day in 1.7 KB. Each game carries `gamePk`, `gameDate` in UTC, `officialDate`, `status.detailedState`,
`venue.name`, numeric team ids, and `doubleHeader`.

**Terms — decisive against use.** Every response carries a `copyright` field:

> Copyright 2026 MLB Advanced Media, L.P. Use of any content on this page acknowledges agreement to the terms
> posted here http://gdx.mlb.com/components/copyright.txt

and that page reads:

> Only individual, non-commercial, non-bulk use of the Materials is permitted and any other use of the
> Materials is prohibited without prior written authorization from MLBAM.

A product that caches a season for its users is not individual, non-commercial, non-bulk use. **Not usable
without a licence.**

### 5. NBA — `cdn.nba.com`

| Request                                               | Status | Bytes |
| ----------------------------------------------------- | ------ | ----- |
| `GET /static/json/staticData/scheduleLeagueV2.json`   | 403    | 425   |
| `GET /static/json/staticData/scheduleLeagueV2_1.json` | 403    | 431   |

Akamai returns an HTML "Access Denied" page for both, with browser-shaped headers, a `Referer`, and an
`Origin` from `nba.com`. **Unusable from our egress without an undocumented workaround**, which is not a
thing to build. No further NBA candidate was probed.

### 6. ESPN — `site.api.espn.com`

| Request                                                           | Status | Bytes   | Time   |
| ----------------------------------------------------------------- | ------ | ------- | ------ |
| `GET /apis/site/v2/sports/hockey/nhl/scoreboard?dates=20261101`   | 200    | 105,632 | 0.19 s |
| `GET /apis/site/v2/sports/football/nfl/scoreboard?dates=20261101` | 200    | 222,099 | —      |
| `GET /apis/site/v2/sports/baseball/mlb/scoreboard?dates=20261001` | 200    | 20,471  | —      |

One shape covers every league: `events[]` with `id`, `date` in UTC, `name`, `shortName`,
`status.type.name` (`STATUS_SCHEDULED`), `competitions[0].venue.fullName`, and `competitors[]` with
`homeAway`, numeric `team.id`, `team.abbreviation`, `team.displayName`. Postponement codes exist in this
vocabulary but were not observed in this pass (**unprobed**).

**Terms.** `https://site.api.espn.com/robots.txt` returns 403. `https://www.espn.com/robots.txt` disallows a
list of paths for `*` and the whole site for several agents. No API terms page was located. **Unlicensed and
undocumented** — the same objection as Yahoo, without Yahoo's clarity.

### 7. TheSportsDB — `thesportsdb.com`

| Request                                                        | Status | Bytes  | Time   |
| -------------------------------------------------------------- | ------ | ------ | ------ |
| `GET /api/v1/json/123/eventsseason.php?id=4380&s=2026-2027`    | 200    | 17,199 | 0.27 s |
| `GET /api/v1/json/123/eventsday.php?d=2026-11-01&s=Ice_Hockey` | 200    | 4,242  | —      |

The vendor's published shared test key `123` works. `eventsseason` returned only **15 events** for the NHL season — the free
tier truncates returned data, which the pricing page states as "Most queries limited". Each event carries
`idEvent`, `idHomeTeam` / `idAwayTeam` (TheSportsDB's own ids), `strTimestamp` in UTC, `strTimeLocal`,
`dateEventLocal`, `strVenue`, `strStatus` (`FT`, `AOT`, `AP`), and **`strPostponed`: `"no"`** — a clean
postponement flag.

**Cost.** Free at $0 with truncated results; $9/month for higher limits; **$20/month for "No limit on returned
data"**, which is what a full season needs. A real recurring charge for one sport's worth of facts.

**Terms.** `https://www.thesportsdb.com/docs_terms_of_use.php` is mostly about artwork licences; no clause
prohibiting automated data access was found in it. Not a full legal read.

**Verdict: the best licensed option if a paid source is wanted**, because one subscription covers NHL, NFL,
NBA, MLB and soccer in a consistent shape with a postponement flag. It costs $20/month and still needs an
identity mapping from TheSportsDB team ids to the provider's keys.

### 8. nflverse open dataset

| Request                                                                       | Status | Bytes     |
| ----------------------------------------------------------------------------- | ------ | --------- |
| `GET github.com/nflverse/nflverse-data/releases/download/schedules/games.csv` | 200    | 2,187,795 |

The 2026 NFL season is complete in the file (272 games through 2027-01-10) with `gameday`, `gametime`,
`away_team`, `home_team`, `location`, `roof`, `surface`, and a game id. Licensed **CC-BY-4.0**, so commercial
use is permitted with attribution.

**The blockers are structural, not legal.** It carries team **abbreviations only** — no numeric ids — and
`gametime` is a bare local time with no offset. Joining on an abbreviation is exactly what
[round 13 decision 2](fantasy-manager/DECISIONS.md#round-13--schedule-cache-source-and-identity) forbids. It is
also a weekly release artefact, not a live schedule, so it cannot carry a same-day postponement.

**Verdict: not a schedule source.** It could serve as a season skeleton if an NFL feature ever needs one, with
the abbreviation mapping derived from provider rows as described below.

### 9. Not probed

Named so they are not rediscovered as gaps: the NFL's own API (no public endpoint is known), any paid
enterprise feed other than the second-hand Sportradar figures below, and any league-run schedule page as HTML.
Sportradar publishes no price; third-party directories estimate **$200 to $1,000+ per month** for this class
of feed, which is second-hand and unverified. It is not recommended.

## Comparison

|                         | Yahoo graphite                         | Sportsnet             | NHL api-web                      | MLB Stats API                | ESPN                      | TheSportsDB                            | nflverse          |
| ----------------------- | -------------------------------------- | --------------------- | -------------------------------- | ---------------------------- | ------------------------- | -------------------------------------- | ----------------- |
| Key needed              | no                                     | no                    | no                               | no                           | no                        | free key `123`, paid key for full data | no                |
| Documented              | no                                     | no                    | no                               | partly (community)           | no                        | yes                                    | yes (schema)      |
| Versioned               | no                                     | no                    | no                               | yes (`/api/v1`)              | no                        | yes (`/api/v1`)                        | release tag       |
| Season schedule         | **yes, all four**                      | no (8-day window)     | yes                              | yes                          | **unprobed**              | yes (paid)                             | NFL only          |
| Start time + zone       | instant, Pacific offset, no venue zone | mixed `Z`/offset      | `startTimeUTC` + `venueTimezone` | UTC + `officialDate`         | UTC                       | UTC + local                            | local, no offset  |
| Home/away               | keys + abbreviations                   | UUIDs + abbreviations | abbrev + numeric id              | numeric ids                  | numeric ids               | own ids                                | abbreviations     |
| Venue                   | name                                   | name + city           | name + timezone                  | name                         | name                      | name                                   | name              |
| Postponed / cancelled   | `POSTPONED`, `CANCELLED`               | `Cancelled` only      | field exists, **unprobed**       | `status.detailedState`       | code exists, **unprobed** | `strPostponed`                         | none              |
| Joins to provider key   | **yes, identical**                     | no                    | via provider rows                | via provider rows            | via provider rows         | via provider rows                      | abbreviation only |
| Bytes per league-season | 62 KB–594 KB per team                  | 2.0 MB per 8 days     | 100 KB per league-week           | 3.7 MB whole season          | 20–222 KB per day         | 17 KB (truncated) / full on paid       | 2.1 MB per season |
| Terms                   | **prohibited**                         | none found            | `Allow: /`, `use=reference`      | **non-commercial, non-bulk** | unlicensed                | no prohibition found                   | CC-BY-4.0         |
| Cost                    | $0                                     | $0                    | $0                               | $0                           | $0                        | $0 / $9 / **$20 per month**            | $0                |

## Freshness policy per aspect

A single sweep cadence is the wrong shape: a fixture that was published in July does not need re-reading
every hour, and a postponement announced at 4 pm is worthless at 7 pm. Each aspect gets its own maximum
age, and the cost is counted in requests per day for the owner's two leagues and five linked teams.

| Aspect              | What it is                                          | Maximum age                       | When it is re-read                       | Requests per day                            |
| ------------------- | --------------------------------------------------- | --------------------------------- | ---------------------------------------- | ------------------------------------------- |
| League season state | current season, phase, week                         | 24 h                              | once daily                               | 1 (both leagues in one call)                |
| Game fixture        | a game exists, its date, home and away              | 7 days                            | weekly, and on season rollover           | 0.4 in season (32 + 32 team-seasons a year) |
| Start time          | the game's instant                                  | 6 h inside 48 h; 7 days beyond    | with the league-week sweep               | 2                                           |
| Game status         | scheduled, in progress, final, postponed, cancelled | 30 min inside 12 h; 6 h otherwise | league-day sweep when a game is imminent | 0–2                                         |
| Venue               | the game's venue                                    | 7 days                            | with the league-week sweep               | 0                                           |
| Provider opponent   | the provider's own opponent for a fantasy date      | the fantasy day boundary          | once per fantasy day per linked team     | 5                                           |

Steady state is **8 to 10 requests a day** against today's 120 to 360 for the same answers. The arithmetic:
one league-season call, one league-week call per league, up to two imminent-game calls, five provider roster
reads, and a fraction of a season skeleton.

Two constraints on those numbers. The 30-minute status age only applies while a game starts within twelve
hours, so the cheap daily sweep is enough most of the time. And the 6-hour start-time age is a ceiling, not a
target: the league-week sweep that supplies it runs once a day, so in practice a time change is picked up
within a day unless a game is imminent.

What this deliberately does not do: it does not poll a live scoreboard, does not chase in-game state, and does
not re-read an observation merely because a page was viewed.

### Measured cost of the declared game policy

The professional-game observation stores one row per game and covered window, and **one league-week request
refreshes every game and every aspect in that week**. That makes the cost of a read independent of how many fantasy leagues share the
sport: the source is the NHL's league week, not a fantasy team. Measured 2026-11-01 against the real
`2026-11-01` league week checked in as the adapter fixture:

| Read pattern                                           | Requests over one week | Requests per day |
| ------------------------------------------------------ | ---------------------- | ---------------- |
| A daily calendar sweep (`freshness: calendar`)         | 7                      | 1                |
| An hourly calendar read, the automation tick's cadence | 28                     | 4                |

The hourly number is the start-time aspect doing its job: games are inside the 48-hour window most of a
playing week, so an observation older than 6 hours is re-read. The status aspect is separate and tighter —
30 minutes inside 12 hours — so a caller that asks for status every hour on a game day re-reads every hour
(24 requests that day), which is one league-week request per read rather than a poll of a scoreboard. A caller
that only needs "is this game still on today" should read status at the league-day sweep, not on every tick.

The earlier per-aspect rows below count _reads_ under the assumption that each aspect is fetched separately. That
assumption is wrong for this source: the league-week response carries all of them.

A league week with no games stores no professional-game observation, because an observation is stored per
game. Reading such a week is still a read — the week is served with an empty games list — but the next read of
that week re-requests it
rather than serving nothing as if it were stored. That is one request per read during a break or the
off-season, and it is the honest cost of having no row to point at.

## Failure behaviour

**The source is down, slow, or returns an error.** Serve the newest observation that is still inside its
maximum age, and show the observation instant so a reader can see the age. Outside the maximum age, refuse the
fact with a named reason rather than serving an unmarked stale value. For work gating, refuse **open**: an
unknown answer to "does this team play today" runs the check rather than skipping it, because a wrong skip is
worse than a wasted read ([round 13 decision 4](fantasy-manager/DECISIONS.md#round-13--schedule-cache-source-and-identity)).

**The source disagrees with the provider's own roster-scoped read.** Split by question, because the two
sources are not authorities over the same thing:

- "Does this player's team have a game on this fantasy date" — the provider wins. It is what the league
  scores, and a lineup decision must follow it. The disagreement is recorded, not resolved silently.
- "When does the game start, where is it, has it been postponed" — the external source wins, because the
  provider publishes nothing for those questions.
- The sources disagree on whether a game exists at all — the provider wins for the current fantasy date, the
  conflict is stored with both observations and surfaced in the observation's detail, and neither observation is
  deleted. A conflict that repeats for the same fixture is a mapping error and stops that fixture being
  served until it is fixed.

**The source returns a team we cannot map.** The observation is stored against the source's own identifier with the
canonical team left unset, and it is **not** served for any canonical team. No name match, no abbreviation
match, no prefix match, no cross-league inference. The consumer receives a refusal that names the unmapped
source team.

**The source returns a shape the adapter does not recognise.** Fail the read with a named error and keep the
last good observation. A renamed field must not decode as "no games": an empty games array is a valid empty week, a
missing games key is a fault. The graphite gateway makes this distinction load-bearing in both directions —
`{"teams":[]}` means the team key is wrong, `games: []` means the season is genuinely empty — and it accepts a
team key from another league without complaint, so the adapter must verify the returned team and league before
storing anything.

## Identity matching

The canonical key is the fantasy provider's own professional-team key — `editorial_team_key`, observed as
`nhl.t.26`. It is stored once per professional team and never derived. Abbreviations are display text: the
provider's own abbreviations differ from the leagues' (`LAK` against `LA`), and a stored abbreviation is a
rendering choice, not an identity.

**A new source's identifiers are mapped only through a pair the provider itself publishes.** The provider
prints `editorial_team_key` and `editorial_team_abbr` on the same roster row, so a league abbreviation that
matches a provider abbreviation can be attached to the provider's key, together with the observation instant
and the source. That is a published pairing, not a guess. Where a source publishes its own stable numeric id
and a matching name or abbreviation, the same rule applies: the pairing is recorded as an observation with a
confidence, and it becomes usable once it is unambiguous within its league.

Three rules make that safe:

1. **A mapping is scoped to a league.** `CAR` is Carolina in the NHL and something else elsewhere. The
   mapping key is (source, league, source identifier), and a lookup outside its league returns nothing.
2. **A mapping is one-to-one or it is not used.** The same source identifier observed against two canonical
   teams is a recorded error; neither team is served from that source until it is resolved.
3. **An unmatched identifier stays unresolved.** It is stored, visible, and never guessed. A missing
   observation is an honest refusal; a wrong observation is a wrong lineup.

### The professional-team map

Learning pairs from roster rows was too narrow. Measured in production on 2026-11-02: 54 identity rows over 29
provider keys, which left seven clubs (Boston, San Jose, Tampa Bay, New Jersey, Edmonton, Anaheim, Los Angeles)
with no identity, so every game involving them was unattributed and the schedule gate had to fail open.

The complete map is now checked in as `hockeyProfessionalTeamMap` in
`packages/backend/src/contexts/connections/internal/ProfessionalTeamMap.ts`: one row per club, carrying the
league, the provider's professional-team key, the league's team identifier, the league's abbreviation, and the
club name. The calendar resolves a club from that table by league and league identifier and never from a stored
pair, so the table is data rather than a cache.

Every pair was read from two recorded source reads.

| Side     | Request                                                                                        | Requests | Bytes     |
| -------- | ---------------------------------------------------------------------------------------------- | -------- | --------- |
| Provider | `GET https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nhl/players;start=0;count=200` | 9        | 6,985,226 |
| League   | `GET https://api-web.nhle.com/v1/schedule/2026-11-01`                                          | 1        | 98,285    |

The provider URL above is the first page; the read paged `start` by 200 through `start=1600`. It needed no
session, which is what makes one request per league affordable for a reference table. It is not affordable at
run time, and it is not read at run time: the table is checked in, and the read was a one-off.

The provider side is its hockey game player pool, which prints `editorial_team_key`, `editorial_team_abbr`, and
`editorial_team_full_name` on every player row. It is one pool rather than five rosters: 1,608 player rows, and
the first page of 100 named only 28 clubs. That read is recorded with its URL, instant, request count, and byte
count in `packages/backend/src/contexts/connections/internal/fixtures/provider-hockey-teams.json`. The league
side is recorded in `game-sources/nhl/fixtures/league-week.json`.

The two lists share no identifier. The provider's `nhl.t.1` is Boston and the league's Boston is `6`, and the
numbering has no relation in either direction. The club name is the only vocabulary both reads share, and it
pairs the two lists 32 to 32 with nothing left over. Abbreviations cannot do that job: the league spells four
clubs `LAK`, `NJD`, `SJS`, and `TBL` where the provider spells them `LA`, `NJ`, `SJ`, and `TB`. A test records
those four disagreements so nobody replaces the identifier lookup with an abbreviation match.

A club the map does not hold, or holds with a different abbreviation or name from the one the read publishes,
stays unresolved. The read reports which of the two it is (`no_map_entry` or `map_disagrees`), so a club that
moved or was renamed is a visible defect instead of an old pairing repeated quietly. The map is never rewritten
from a read, and a stored identity row is never used to fill a gap in it.

A source that publishes the provider's own key — as graphite does — needs no mapping at all, and that is the
single strongest technical argument for it.

## The architecture

The owner asked for a view that generalises, because the same machinery should carry any useful fact we want
upfront and cached. The shape is four small pieces, and nothing else.

### A store for schedule observations

Schedule observations are stored as **observations**, not as truth. Every row says what was seen, when, from where, how
strongly, and what window it covers.

| Column                     | Meaning                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| `subject_kind`             | `professional_team`, `professional_game`, or `fantasy_team`                      |
| `subject_key`              | the canonical subject: a provider team key, a game id, or a fantasy team key     |
| `observation_kind`         | `league_season`, `professional_game`, or `provider_opponent`                     |
| `covers_from`, `covers_to` | the window the observation covers: a date, a game, or a season                   |
| `value`                    | the typed payload for the observation kind                                       |
| `observed_at`              | when we learned it                                                               |
| `source`                   | the source key that produced it                                                  |
| `confidence`               | `authoritative`, `corroborated`, or `reported`                                   |
| `source_reference`         | the upstream identifier, so a later observation can be matched to the same thing |

Confidence is defined by rule, not by feel:

- **authoritative** — the provider for facts it owns, or the league's own service for league facts.
- **corroborated** — two independent sources agree on the same fact for the same window.
- **reported** — one non-authoritative source.

Each source, subject, observation kind, and covered window has one stored observation; a newer observation replaces
an older one for that window, and an older observation cannot overwrite a newer one. The read path takes that
row, so "when did we learn this" is answerable but "what did it used to say" is not. A disagreement between two
authoritative sources is not recorded; conflict reporting is not implemented. Retention prunes a window once it
ended more than 30 days ago, so growth is bounded by live and recent windows rather than by polling.

### A freshness policy per aspect

Each aspect declares its maximum age, its refresh trigger, and its failure behaviour, as the table above.
The policy lives beside the aspect, not beside a table and not in a job: professional-game freshness applies to every sport and every game source, and the provider-opponent policy is the fantasy-day
boundary. A source may narrow a policy it cannot satisfy — a weekly dataset cannot promise a 30-minute status —
and the narrower bound is what the reader sees.

### Identity matching

As above: provider keys, league-scoped mappings, one-to-one or unused, unmatched stays unresolved.

### A hook point

This is the target shape from ADR 0011, still roadmap F1.4; the current read path is
`ProfessionalCalendar.readGames` and `ProviderOpponentFacts.read`, with no generic hook. One application
service answers a question a consumer asks, and the consumer never names a source:

```
ScheduleObservations.require({
  subject,            // professional team, game, or fantasy team
  observationKind,    // professional_game or provider_opponent
  window,             // the dates or the game it covers
  maximumAge,         // how stale the answer may be, or a named policy
})
```

The service resolves the canonical subject, reads the newest observation inside the requested age, and — only
if none qualifies — asks the source registry for it, batching across every subject the caller asked about in
one call. It records what came back and returns the observation with `observedAt`, `source`, `confidence`, and
the window, or a named refusal that says which of those was missing.

The source registry mirrors the provider registry from [ADR 0007](fantasy-manager/adr/0007-provider-registry-and-planner-capability.md):
a `ScheduleSource` shape with declared capabilities — which sports and observation kinds it serves, its coverage horizon,
whether it publishes start times or venue time zones, and its own request budget — injected at the composition
root. Adding a source is a new module plus one registry entry. Generic code never names a source, and no
generic module imports a source module.

### What this deliberately does not do

- **It is not a general cache.** It stores schedule observations a feature asked for, with the window they
  cover. It is not a key-value store, not an HTTP cache, and not a place to put anything that is convenient.
- **It is not a live scoreboard.** It does not poll in-game state, and it has no subscription or push path.
- **It is not an archive.** It keeps what was asked for, not everything every source publishes, and it does
  not retain an observation nobody reads.
- **It is not a scheduler.** It does not decide when to run. The existing tick and the per-observation policy
  decide,
  and a read either satisfies the age or triggers a refresh.
- **It is not an identity-resolution engine.** No fuzzy matching, no name normalisation, no cross-league
  inference, no fallback to an abbreviation.
- **It is not a plugin system.** One registry entry per source, compiled in, no runtime loading.
- **It carries no odds, projections, or editorial content**, even though graphite would serve them.

## What is left

- **Written permission from Yahoo for graphite.** If it is granted, graphite becomes the primary source for
  every sport at once, with no identity mapping. Without it, it is not a candidate at any volume.
- **An NFL source, when a feature needs one.** Today nothing does: the provider's own opponent fact answers
  the automation question, and the cheapest licensed option is $20/month for facts we would not yet use.
- **How fast a postponement actually appears.** Not observable on a quiet day. It needs an observation during
  a real postponement, which is a standing verification rather than a task.
- **A real postponed NHL game.** The vocabulary is established from the league's own client, but no live game
  has been read in a postponed state, so the latency from announcement to status flip is still unmeasured.
- **Whether the NHL publishes a separate data-licence page** for the API distinct from `robots.txt`.
- **Whether the owner accepts the same automated-access posture for the Fantasy Sports API** that the product
  already depends on. That is a pre-existing question, not one this investigation changes, and it belongs to
  the owner rather than to this document.

[sdv-yahoo]: https://py.sportsdataverse.org/docs/yahoo/reference/yahoo_shangrila/team
