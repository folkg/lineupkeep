# Phase 1 live acceptance (2026-10-25)

This record covers the owner-authorized live checks: one real Yahoo account
linked through the product's own helper upload path, bounded reads through the
services behind the MCP tools, one native `set_lineup` run, and the deployed
smoke. Automated checks use synthetic providers; these observations are live
provider and deployed-cloud evidence.

**Privacy:** this record contains no account identifiers, team names, league or
team keys, player names, cookies, crumbs, provider payloads, or database URLs.
Retained values are counts, statuses, byte sizes, timings and outcome tags. The
local harnesses live in gitignored `.artifacts/` and are not committed.

## Method

- Pinned Node 24.22.1 and Bun 1.4.2, local development composition with its
  disposable PostgreSQL container, Playwright Chromium, and the owner's
  signed-in Chrome tab through Playwriter.
- The owner's sign-in code was delivered to the development server console; no
  inbox was read.
- The local helper's device-authorization and authenticated
  `POST /api/linking/complete` path carried the browser session. Session
  material moved from browser memory to the harness over loopback and was never
  printed, logged, committed or retained.
- Team discovery ran through the new **Refresh teams** surface against the live
  provider.
- The query services behind `list_teams`, `get_calendar`, `get_league`,
  `get_rosters`, `search_players`, `get_players`, `get_matchups` and
  `get_transactions` were called directly in the application runtime with the
  linked connection, because local MCP cannot register a client-metadata
  document on a public HTTPS origin. Byte sizes are UTF-8 JSON sizes; the
  query budget is 12,288 target / 16,384 hard-limit bytes per response.
- `set_lineup` ran through `LineupRuns.submit` (the same service the MCP tool
  calls) with the local inline delivery worker and a bounded wait.

## Local acceptance results

### Connection and discovery

| Check                                                     | Result                            |
| --------------------------------------------------------- | --------------------------------- |
| Sign-in through the development console code              | Succeeded                         |
| Device pairing, approval and authenticated session upload | Succeeded; upload `200` in 383 ms |
| Connection state after upload                             | `ready`                           |
| Teams discovered after refresh                            | 5 total: 1 football, 4 hockey     |
| Distinct provider leagues                                 | 5                                 |

The brief expected two teams sharing a league. The live account did not show
that shape on this date: all five teams resolved to distinct provider league
keys, so this record reports the observed five distinct leagues rather than the
expected example. Team identity checks (owned teams only, NFL/NHL only) passed.

### Bounded query tools

| Tool               | Status | Returned        | Bytes | ms    | Paging               |
| ------------------ | ------ | --------------- | ----- | ----- | -------------------- |
| `list_teams`       | ok     | 5 teams         | 1,805 | 26    | complete             |
| `get_calendar`     | ok     | 17 periods      | 1,315 | 630   | complete             |
| `get_league`       | ok     | 20 records      | 4,521 | 368   | 16 remaining, cursor |
| `get_rosters`      | ok     | 15 players      | 4,313 | 864   | complete             |
| `get_transactions` | ok     | 10 transactions | 4,760 | 562   | 40 remaining, cursor |
| `search_players`   | ok     | 10 players      | 2,917 | 982   | 40 remaining, cursor |
| `get_matchups`     | ok     | 6 matchups      | 2,453 | 1,332 | complete             |
| `get_players`      | ok     | 5 players       | 1,937 | 779   | complete             |

All eight responses stayed inside the query budget and returned real provider
data for the owner's team. Discovery queried only the owner's own NFL and NHL
sessions; no foreign team was requested. No transaction or premium action was
invoked.

### Native `set_lineup`

The first run **failed** with `provider_rejected` and no provider change. The
committed write shape addressed the read-only API origin, placed the coverage
selector in the path, and sent an undocumented `roster_action` element. The
target provider's own client sends an XML `action` to its read-write origin's
`team/{key}/roster` endpoint with the crumb and `format=json_f`; the adapter was
corrected and now has a redacted regression for the exact request.

After the correction:

| Field                     | Result                                       |
| ------------------------- | -------------------------------------------- |
| Delivery                  | queued, processed inline by the local worker |
| Status                    | `completed`                                  |
| Attempts                  | 1                                            |
| Duration                  | 1,583 ms                                     |
| Outcome                   | `no_op`                                      |
| Verified readback         | `true`                                       |
| Reconciled                | `false`                                      |
| Changes                   | 0                                            |
| Locked / editable players | 2 / 13                                       |

A verified no-op is the accepted result: the provider confirmed the starting
lineup already matched the native action. A direct corrected provider request
returned `200` with a `status: success` envelope before this run.

### Limitations of the local evidence

- Local MCP protocol calls were not exercised end to end: client metadata must
  be hosted on a public HTTPS origin, and the runtime correctly rejects private
  metadata destinations. The service contracts behind the tools were exercised
  instead. Hosted-client acceptance remains open.
- This was one owner account and one football team's native write. Hockey
  date-scoped native writes, reconnect races, crash recovery and queue retries
  are covered by behavioral/PostgreSQL tests, not by this live run.
- Local development uses console email delivery, not Resend.

## Deployed smoke

The public origin, MCP challenge/metadata, hourly Scheduler tick, worker IAM,
Resend acceptance and clean startup logs are recorded under
[Deployed environment](deployment.md#deployed-environment-2026-10-25).
No owner sign-in was completed and no inbox was read.

### Hosted browser stream (deployed)

The IAM-only `lineupkeep-hb` service was deployed and probed without completing
a sign-in:

- Unauthenticated requests were refused by Cloud Run IAM; the request log
  recorded the refusal and the only `roles/run.invoker` binding belongs to the
  web runtime account.
- An operator WebSocket through `gcloud run services proxy`, using a signed
  one-use descriptor, completed the handshake, streamed 7 JPEG frames (first
  frame 4,941 bytes) and reported `starting`, `loading`, `waiting` while the
  real Yahoo login page loaded through the service's egress. The operator closed
  it; the service logged `hosted_browser.session cancelled` with session id,
  outcome and duration only.
- The temporary operator `run.invoker` grant was removed immediately and the
  policy was re-read. No descriptor key, identity token, cookie, frame, or
  keystroke was printed, logged, or written to disk.
- A warm session reached the first frame in 812 ms and `waiting` in 941 ms on
  the same deploy. A cold session after the 15-minute idle window reached the
  first frame in 9,434 ms and `waiting` in 9,804 ms; the instance took 1.3 s
  from start to `hosted_browser.ready` and the startup probe passed 5.4 s after
  instance start. Cloud Logging for the day contained no cookie, keystroke, or
  password patterns.

The live Yahoo credential entry through the deployed app remains owner-only and
unperformed.

## Remaining acceptance

1. Owner sign-in on the deployed origin and hosted-browser (or helper) linking
   against that origin, followed by one live read and one native write with
   verified readback.
2. Hosted MCP client acceptance with a public client-metadata document.
3. A verified Resend sending domain before open registration; the current test
   sender only delivers to the owner's account address.
4. Backup/restore and protected-state restoration drills, and a decision on
   pruning superseded secret versions.
5. Actual billing and quota review against the CAD 5 budget.
