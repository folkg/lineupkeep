# @lineupkeep/yahoo-sdk

An Effect-native Yahoo Fantasy Sports SDK. It owns Yahoo's hosts, session and crumb handling, request and response schemas, XML write bodies, provider wording, bounds, and retries. A caller never handles a raw `Response`.

The package lives in this monorepo for now and is shaped as if it were already a standalone package: it imports only `effect`, uses package-internal `#yahoo/*` imports, and does not import application code. Nothing imports it yet; the existing adapter remains the production path.

The design follows the `@distilled.cloud/*` provider SDKs: resource modules in `services/`, operations built with a shared `API.makeRead`/`API.makeWrite`, Effect Schema inputs, a protocol service, a credentials service, typed provider errors, and an optional retry service. The reference audit, batching answers, and integration plan are in [docs/design.md](docs/design.md).

## Quick start

```ts
import * as Yahoo from "@lineupkeep/yahoo-sdk";
import { Effect, Layer } from "effect";

export const program = Effect.gen(function* () {
  const session = yield* Yahoo.makeSession(cookieFromHostedBrowser);

  const Live = Layer.mergeAll(
    Yahoo.FetchClient,
    Yahoo.CredentialsFromSession(session),
    Yahoo.YahooProtocol,
  );

  return yield* Yahoo.rosters
    .forTeam({
      teamKey: "466.l.4000.t.1",
      coverage: { type: "week", week: 7 },
    })
    .pipe(Effect.provide(Live));
});
```

`Yahoo.FetchClient` provides `HttpClient` through `effect/http/FetchHttpClient` with `redirect: "manual"`. `CredentialsFromSession` supplies the Yahoo cookie. `YahooProtocol` supplies the Yahoo wire protocol. Operations require exactly those three services (`Yahoo.YahooOpContext`).

The cookie is held as `Redacted`. If you have a raw cookie string, use `Yahoo.CredentialsFromCookie(cookie)` or `Yahoo.makeSession(cookie)`; both validate that it is a single, non-empty header line. A missing or malformed cookie fails with `ConfigError`.

## Operations

Every operation is a callable, pipeable, and yieldable `OperationMethod`, mirroring the distilled SDKs. Calling it runs the request. Yielding it first captures the services in scope and returns a callable that needs no further context:

```ts
const settings = yield * Yahoo.leagues.settings;
const league = yield * settings({ leagueKey: "466.l.4000" });
```

| Module               | Operation           | Input                                                                                                      |
| -------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Yahoo.session`      | `validate`          | `{}`                                                                                                       |
| `Yahoo.teams`        | `list`              | league key                                                                                                 |
| `Yahoo.leagues`      | `settings`          | league key                                                                                                 |
|                      | `discover`          | optional game keys; defaults to every game                                                                 |
|                      | `felo`              | league key                                                                                                 |
|                      | `tradePartners`     | league key                                                                                                 |
|                      | `teamAnalysis`      | league and 1–12 team keys                                                                                  |
| `Yahoo.rosters`      | `forTeam`           | one team, optional week/date coverage                                                                      |
|                      | `forLeagues`        | the signed-in manager's team in one or more leagues, with coverage, pending transactions, and games played |
| `Yahoo.players`      | `search`            | one or more league keys, query, availability, sort, stat, limit                                            |
|                      | `available`         | game key, position, page, offset, sort, availability                                                       |
|                      | `starters`          | league key and starting position, reads at most two pages                                                  |
|                      | `details`           | league, up to 25 player keys, one stat basis                                                               |
| `Yahoo.matchups`     | `week`              | league key, week                                                                                           |
| `Yahoo.schedule`     | `byDate`            | sport, date, time zone                                                                                     |
|                      | `game`              | graph game ID, season, time zone                                                                           |
| `Yahoo.mobile`       | `games`             | league and optional week                                                                                   |
|                      | `playerCards`       | league, up to 25 player keys, optional subviews                                                            |
|                      | `playerGameLog`     | league and player                                                                                          |
|                      | `playerSeasonStats` | league and player                                                                                          |
| `Yahoo.statcloud`    | `dashboard`         | optional sport and best-ball flag                                                                          |
|                      | `league`            | league key                                                                                                 |
|                      | `matchups`          | league and optional roster/team key                                                                        |
|                      | `playoffs`          | league key                                                                                                 |
|                      | `matchupScores`     | league, week, team, optional sport suffix                                                                  |
| `Yahoo.draft`        | `results`           | league key                                                                                                 |
| `Yahoo.transactions` | `list`              | league, optional team, limit, offset                                                                       |
|                      | `pendingTrades`     | league and team                                                                                            |
|                      | `apply`             | league, team, add and/or drop, optional FAAB                                                               |
| `Yahoo.lineups`      | `setNative`         | team, coverage                                                                                             |
|                      | `assign`            | team, coverage, player/position pairs                                                                      |
|                      | `reserve`           | team, coverage, player, reserve slot                                                                       |
| `Yahoo.trades`       | `propose`           | league, both teams, optional player arrays and draft-pick rounds, note                                     |
|                      | `counter`           | incoming offer, new player/pick assets, note                                                               |
|                      | `respond`           | pending trade key, accept or reject, note                                                                  |
|                      | `withdraw`          | transaction key                                                                                            |

Inputs are decoded with an Effect Schema before any request is built. Keys, limits, cross-league team keys, duplicate player keys, and the add/drop pairing are checked locally; a bad input fails with `YahooRequestInvalid` and sends nothing.

Batch first. `leagues.discover` requests every league and team, with settings and standings, in one aggregate read and returns league identity, full settings, trade-pick flag, teams, and team standings. `rosters.forLeagues` returns the signed-in manager's roster in each league, with pending-transaction summaries and games-played limits, from the same request. `players.search` takes arrays and returns grouped results, and `players.available` pages a whole sport's pool rather than repeating a league-scoped query. Single-team `rosters.forTeam` and per-league settings/details remain for the cases where one resource is genuinely the whole request.

The multi-league roster read is owned-team scoped because Yahoo's `users;use_login` collection returns only the signed-in manager's team. A root `leagues;league_keys=…/teams;out=roster` request does return every team in those leagues, but its five-league live response was 19.5 MB against the SDK's 4 MiB read bound. Full-league rosters therefore stay one read per league.

### What is typed, and what is not

Request schemas and response types are public. Wire payloads are not: every decoder takes `unknown`, validates the provider's positional JSON shape, and returns the named response type. Unknown or absent fields are documented where they matter; missing statistics stay `null`, never zero. The package does not export raw wire schemas.

A transaction player's movement kind is one of `add`, `drop`, `trade`, or `pending_trade`, with `other` for a movement type the SDK does not know.

## Writes and outcomes

Writes use the `pub-api-rw` host with `format=json_f` and a crumb. The SDK fetches the crumb from `pub-api/fantasy/v3/getCrumb` before each write; callers never pass a crumb. The crumb is held as `Redacted`, is not returned, and is scrubbed from provider messages.

| Outcome  | Error               | Meaning                                                          |
| -------- | ------------------- | ---------------------------------------------------------------- |
| accepted | _(success)_         | 2xx; `{ status: "accepted" }` or a trade key                     |
| refused  | provider 4xx class  | Yahoo answered and its own sentence is in `message`              |
| not sent | `YahooNotSent`      | Missing crumb/session, crumb failure, 408, or 429                |
| unknown  | `YahooWriteUnknown` | No response, 5xx, oversized/unreadable response, or no trade key |

A trade proposal is only `accepted` when the response contains a `pt` transaction key. If Yahoo accepts the call without a key, the result is `YahooWriteUnknown`, never a claimed success.

`trades.propose` accepts `sendPicks` and `receivePicks` as `{ round }` values. A pick is identified by its round and source team; at least one player or pick is required, and duplicate rounds on one side are rejected before sending. The captured draft-pick body is in [the Android API notes](docs/mobile-api.md#draft-pick-trades).

Yahoo has no separate counter-offer action. `trades.counter` takes the incoming offer's key and the two teams, then sends one new pending proposal from the original recipient back to the original proposer. It does not itself reject the original offer; call `trades.respond` with `action: "reject"` when the old offer should be cleared. `trades.respond` uses the provider's `PUT /transaction/{key}` action body for accept and reject.

## Errors

All errors are `Schema.TaggedError` classes. When Yahoo supplies a sentence, it is carried verbatim in `message`: no paraphrase, no truncation, and no whitespace normalisation. Only crumb values are redacted.

Status errors carry the provider's HTTP `status`. `GatewayTimeout` omits it only when the SDK's own deadline fired, so a caller can tell a 408 or 504 from a local timeout. `Unauthorized` and `Forbidden` also carry `structured`: `true` when `message` came from a provider JSON or XML envelope, and `false` when it is raw body text. A caller that publishes refusal detail should use `structured` rather than echo an arbitrary body.

| Error                                                                                    | Meaning                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `ConfigError`                                                                            | The cookie or provider configuration is missing or malformed  |
| `YahooRequestInvalid`                                                                    | Locally rejected input; nothing was sent                      |
| `Unauthorized` / `Forbidden`                                                             | The provider rejected the session or access                   |
| `BadRequest`, `NotFound`, `Conflict`, `UnprocessableEntity`, `Locked`, `TooManyRequests` | The matching 4xx, carrying Yahoo's wording                    |
| `InternalServerError`, `BadGateway`, `ServiceUnavailable`, `GatewayTimeout`              | The matching 5xx/408/504                                      |
| `YahooPremiumRequired`                                                                   | A 4xx whose provider sentence names premium                   |
| `YahooHttpError`                                                                         | Any other status, a refused redirect, or an unreadable body   |
| `YahooParseError`                                                                        | A 2xx body is absent, not JSON, or does not match its decoder |
| `YahooCoverageMismatch`                                                                  | A read covers a different week or date than requested         |
| `YahooNotSent`                                                                           | A write failed before transmission                            |
| `YahooWriteUnknown`                                                                      | A write may have reached Yahoo                                |

`YahooReadError` and `YahooWriteError` are the public unions used by the two operation builders.

## Retry policy

Reads retry transient failures by default: `TooManyRequests`, `InternalServerError`, `BadGateway`, `ServiceUnavailable`, `GatewayTimeout`, and `HttpClientError`, with a jittered exponential schedule capped at two retries. Writes never retry.

Provide `Yahoo.Retry` to replace the policy, or disable retries:

```ts
program.pipe(Yahoo.Retry.none);

program.pipe(
  Yahoo.Retry.policy({
    while: (error) => error._tag === "TooManyRequests",
    schedule: Schedule.recurs(1),
  }),
);
```

If a policy has no `while`, no retry is installed.

## Bounds and transport

- Reads use `pub-api-ro`, the crumb uses `pub-api`, and writes use `pub-api-rw`; all are `fantasysports.yahoo.com`. Graphite schedule reads use `graphite.sports.yahoo.com`.
- Paths are exact, relative, and validated to stay on their fixed origin. Queries and fragments in a path are refused.
- Reads have a 30-second deadline and a 4 MiB response bound. Writes have a 30-second deadline and a 256 KiB bound.
- Redirects are not followed: `FetchClient` sets `redirect: "manual"`, and a 3xx becomes `YahooHttpError`.
- The crumb request has its own 30-second deadline. A crumb failure is `YahooNotSent` and the write is never attempted.
- The SDK does not provide a public-internet guard. The application layer must supply a fetch implementation that refuses non-public destinations.

## Provider facts this package records rather than hides

- A single-player transaction body is emitted without a `<players>` wrapper because that is what the adapter sends. Only the two-player add/drop body has a recorded live refusal; the single-player form is unverified.
- A date-qualified team roster read (`roster;date=…`) is accepted by the same endpoint the schedule read uses, but only the week-qualified roster read has recorded live evidence.
- `trades.propose` accepts the recorded full-league response shape and returns the first `pt` key. The absence of a key is `YahooWriteUnknown`.
- Android draft-pick trades are enabled by the league setting `can_trade_draft_picks`; the captured NFL league had it off and a hockey league had it on. The draft-pick body uses `picks/pick` with source team, destination team and round.
- A draft-pick proposal was first refused because a player was left in an IR slot after losing real-life IR eligibility; that sentence is preserved verbatim, including its double space, in `BadRequest.message`. After the roster was fixed, the same proposal returned 201 with a `pt` key, and cancelling it returned 204. The response's picks include `original_team_key`, which `transactions.pendingTrades` exposes as `original`.
- The Android app exposes mobile-only live scoring, player game logs, season tables, Felo ratings, recommended trade partners and draft-pick availability. Their verified paths and shapes are catalogued in [the Android API notes](docs/mobile-api.md).
- Premium and entitlement refusals are recognised only by HTTP 4xx status and Yahoo's wording; no premium action is implemented. The package intentionally exposes only free features.
- A stat value that is not a finite number or a numeric string becomes `null`. The package does not distinguish `"-"` from an absent node.
- The captured add/drop refusal is asserted word-for-word, including its double space, with the crumb redacted.
- An add and its drop share one transaction and one request. Several lineup moves share one roster PUT for that team; the multi-move provider shape is reference-corroborated, not independently live-reproduced.
- The aggregate discovery, multi-league roster, multi-league player, game-wide player, starter-page, and Graphite schedule calls are implemented as `leagues.discover`, `rosters.forLeagues`, `players.search`, `players.available`, `players.starters`, and `schedule`. `rosters.forLeagues` decodes pending transaction keys/types/statuses and games-played position limits from the same aggregate response. The aggregate league entries are accepted both directly and under the single-key `league` fragment, because live responses use the direct form. Player summaries and roster players carry the provider's `editorial_team_key` as `proTeamKey` beside the abbreviation. Recorded live evidence is summarized in [the design document](docs/design.md#autocoach-reference-audit), and the remaining live-evidence gaps stay recorded there.

## Integration plan

The package stays unreferenced by the application until a separate integration refactor. The design document records the transport swap, what the application gains, what stays with the application, and the rollout gates: [Integration plan](docs/design.md#integration-plan).

The AutoCoach reference audit, the batching answers, and the remaining evidence gaps are in [the design document](docs/design.md#autocoach-reference-audit).

## Android capture investigation

The owner asked whether an Android emulator and mitmproxy could capture Yahoo app traffic for shapes the web API does not expose. This is research only. The SDK is complete without it, and no captured app traffic, credentials, or identifiers are committed.

The working path is a rooted non-Play `google_apis` AVD with the mitmproxy CA in both `/system/etc/security/cacerts` and Android's Conscrypt runtime store. Android 16 moved runtime trust to `/apex/com.android.conscrypt/cacerts`, which is read-only and private to each app's mount namespace; the Zygote namespace needs a bind mount after each boot. The Play image cannot be rooted and the Yahoo app rejects the proxy CA there. The non-Play image accepts it.

The app is `com.yahoo.mobile.client.android.fantasyfootball` 12.12.3 (targetSdk 36). Its API traffic uses `pub-api-android-ro`, `api-fantasy-mobile.sports.yahoo.com`, `api-statcloud.sports.yahoo.com`, `dfyql-ro.sports.yahoo.com`, and `wyql-ro.sports.yahoo.com` in addition to the web hosts. Cookies are shared with the hosted web session; writes use the Android `pub-api-android-rw` host and a crumb.

Capture used shape-only logging: method, host, path, query names, status, content type, byte count, and field names/types to a bounded depth. Cookies, authorization headers, crumbs, tokens, and login bodies were redacted or skipped. A separate body capture was used only for the draft-pick write; its crumb was redacted before storage.

The full endpoint catalogue, draft-pick XML body, provider refusal, and the list of unverified resources are in [docs/mobile-api.md](docs/mobile-api.md).

## Tests

```sh
bunx vitest run --project node packages/yahoo-sdk
```

The suite covers session validation, discovery, settings, rosters, search, details, matchups, draft, transactions, pending trades, every write, the crumb handshake, provider wording, crumb redaction, not-sent and unknown outcomes, retry-free test layers, path escape, redirects, byte bounds, mobile player cards/game logs/games, Felo, draft-pick availability, recommended trade partners, draft-pick trade bodies and refusals, aggregate league discovery, multi-league rosters with pending transactions and games-played limits, multi-league and game-wide player searches, starter pages, Graphite schedules, trade counters, and accept/reject responses. Fixtures are synthetic, plus recorded live aggregate payloads and the captured add/drop refusal and draft-pick IR refusal, with personal values and crumbs replaced.

## Boundaries

The package imports only `effect` and its own `#yahoo/*` modules. It does not import the application, backend runtime, persistence, browser code, AutoCoach, or a raw HTTP client. Provider names and wire vocabulary are owned here; the repository lint rule treats this directory as a provider implementation.

## Extraction

Nothing in the package depends on the monorepo. To extract it:

1. Copy `packages/yahoo-sdk` to its own repository.
2. Replace the workspace `catalog:` dependency with a released `effect` version.
3. Keep the `#yahoo/*` package imports; they already describe the package-internal boundary.
4. Move the provider-wording fixture and its test with the package.
5. Publish under the final package name; the current `private: true` and `@lineupkeep` scope are the only monorepo-specific metadata.
