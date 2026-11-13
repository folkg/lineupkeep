# Roadmap

Long-term work for Lineupgrade. Phases 1 and 2 are deployed; this file tracks what remains, grouped so one
group can be handed to one agent as a unit.

**An item is checked only when it is verified, not when it is written.** Every item names how it will be
verified, because "done" has meant different things at different times here. Work closed before this
restructuring is summarised in the [appendix](#appendix--closed-work).

## How to read this

- **Groups** are delivery units. A group should be small enough for one agent, except where it says `XL`.
- **Size**: `S` is hours, `M` is a day or two, `L` is a multi-day chunk, `XL` must be split before delegating.
- **Depends** names what must land first. Empty means it can start now.
- **decide** marks an owner decision that gates the work.
- Where the owner has already ruled, the decision is recorded inline so it is not reopened.

## Current state

| Area                 | State                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Phase 1 (stages 0–6) | Complete, deployed, live-accepted                                                                 |
| Phase 2 (stages 7–8) | Complete, deployed, hourly automation verified                                                    |
| Lineup algorithm     | Custom solver live for all five owner teams                                                       |
| Provider boundary    | Every provider request lives in `packages/yahoo-sdk`; the adapter is policy and port mapping only |
| MCP surface          | 21 tools; four resource scopes plus `notes:write`; descriptions budgeted and tested               |
| Client feedback      | Round 9 client notes closed on 5 November: structure, copy, local time, action states             |
| Connections          | Hosted browser only; local helper and device flow deleted                                         |
| Interface            | Technical sheet, renamed to Lineupgrade; nav is Teams and Account; actions own their states       |
| Deployment           | Cloud Run web, worker and hosted browser on GCP; CI on a clean Linux runner, container target     |
| Publication gate     | Blocked on upstream: a temporary backport of the TanStack advisory is in force                    |
| Restore              | Drill passed 2026-10-29; RPO 15 minutes, RTO 4 hours, owner executes recovery (ruled 10 November) |
| Dependencies         | Fresh audit and disposition in [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md)                         |
| Security             | Audit and disposition in [SECURITY-AUDIT.md](SECURITY-AUDIT.md); deferred work is group J         |
| Checks               | 1994 node, 218 browser, 10 chromium; container end to end 59 passed, nothing skipped              |

---

## Ship log

### 13 November 2026

- **A plan move can name the date it waits for, and the hourly clock runs it.** An item may carry one
  calendar date read in the league's own fantasy day. Submitting the plan is the approval: a selected
  move whose date is still ahead stays in the plan with an approval time, and a move with no window or
  whose date has arrived runs on that submission. The hourly tick selects approved moves whose date has
  arrived, in the league's own day, and runs them through the ordinary submission, so ordering,
  revalidation, settling, and the single-slot claim stay one path. A failure that settles the move stops
  it; a transient failure leaves it proposed for the next tick, so a missed tick is late rather than lost.
- **A scheduled add can name ordered fallbacks, and the server promotes one when the first choice is
  gone.** The draft carries fallbacks only for a one-player add or waiver claim. At submission, when the
  first choice can no longer be added, the server uses the facts it already read to take the first
  fallback the pool lists as available, re-evaluates the team once, and records the chosen player and
  why. Nothing promotes on a read; the review and the plan list show the fallbacks a person is approving.

### 12 November 2026

- **A team's plans are one list, on a page and over MCP.** A plan no longer needs its review link to be
  found: the team transactions page lists every open plan with its moves, a stale section that names why,
  per-move dismissal, and closed plans in history. The same read is `list_transaction_proposals`, filtered
  by open or closed in one SQL pass and paged by cursor, so an agent sees the plan a person sees. The page
  reads its lists and controls on the client; server-rendered, the hydrated disclosure and dismissal
  controls kept the markup they arrived with, so that route opts out of server rendering.
- **A closed plan is swept after 90 days, by the same policy table as everything else.** The retention
  policy gains one rule for closed transaction plans; the hourly sweep deletes a plan whose moves have all
  ended and whose last change is older than 90 days, with its moves, submissions, and steps. An open plan is
  current work and stays. No feature-specific expiry code and no second clock.
- **A ready connection always carries the time it was approved.** Rows written before the approval column
  existed decoded as ready with a null approval time, and reading that connection refused the whole team
  list. The migration records the row's last write as its approval time; every other state keeps its null
  because it was never approved.
- **A pool row can count game days over a window the client chooses.** A pool search takes
  `gamesWindow: { start, end }` and returns each row's `gameDays` as the dates its professional team plays,
  instead of a count over the scoring window. A window wider than one schedule read is refused with the
  limit rather than silently truncated, and a row whose team key is unknown or unresolved says so instead of
  publishing an empty list. The roster side needed nothing new: every rostered player's games already carry
  their dates and the window's per-date rows already count them, so a second copy of the same player
  references was not published; it would have spent the summary's byte budget and pushed roster rows onto
  another page.

### 11 November 2026

- **A frozen team is no longer possible.** A scheduled run created while an action run held the team's lease
  was declined by the worker and never offered again; the scheduler then read the unfinished run as busy and
  stopped checking the team. Bread Roller, Skinner? I barely know her!, Meier? I barely know her! and
  $G-Money$ were frozen between 9 and 11 November. The four stranded runs were delivered by hand, completed,
  and the cause was closed rather than papered over.
- **One run at a time is a database rule.** A partial unique index allows one running run per team and one
  waiting run per team and target period; a second request joins the waiting run. A finished run releases its
  lease and dispatches whatever was waiting, so the hand-off is seconds rather than the next hour. Cloud Tasks
  retries a failed delivery itself, and the hourly tick repairs whatever a crash can still strand, so there is
  no second clock and the worker still returns to zero between hours.
- **A queued run no longer claims to be checking.** The team row said "Checking now. This usually takes under a
  minute" for any unfinished run, including one that had never started; it now says a check is waiting to start.

### 6 November 2026

- **Team rows carry a status line that always exists**: next check at the hour's :55 in the reader's zone,
  the pause sentence with its resume time, an off sentence, or `Checking now` while the run's own status says
  it is in flight. One line, one height, so pausing no longer moves the list below it.
- **The mark is lowercase lu**, corrected geometry, at favicon, masthead and brand-document level; the l-k
  drawing is gone.
- **A refresh tick stands alone**: the glyph yields completely, the tick draws alone, then the glyph returns.
- **The provider popout sits beside the team name** on the team page, matching the list.
- **Round 19 MCP feedback closed.** Registration accepts the retired `connections:read` scope while advertising
  only current ones, verified against the deployed origin (`201`, grant carries the name; `connections:write`
  still `400`). `generate_transaction_review_links` and everything that existed only for it are deleted.
  Proposal sets are validated through their own planned order and that order is published before submission.
- **A roster position is judged by published positions and nothing else.** The first answer to the reserve-slot
  feedback looked at player statistics and the injury report to guess that a player should not be sitting where
  he sits. The owner rejected it: the rule was already there. A player is illegal where he sits when none of the
  positions the league allows for that slot is among the positions the provider publishes for him, a reserve slot
  being one slot among others. That reply is deleted, along with the statistics read, the suspicion state and the
  provider reads the team page spent on load. The team summary now publishes each roster entry's
  `eligiblePositions` beside his `slot`, and names the mismatches as `illegalSlots`, so the comparison is
  visible instead of inferred.
- **Switch colours unchanged** by the owner's ruling; the similarity between a disabled switch and an off
  switch is recorded and accepted rather than fixed.

### 5 November 2026

- **Renamed the product to Lineupgrade.** Product-visible strings changed; the cloud stack names, the
  repository, the database and the package scope keep their deployed names, because renaming a stack is a
  redeploy of production for no user-visible gain. A deploy failed once for exactly that reason and the
  identities were restored.
- **Client feedback round 9 closed.** Masthead is Teams and Account; connections and one session list live on
  the Account page, between appearance and your data; feedback is a quiet footer link. The teams list names
  the fantasy league, and a read fills a missing league name instead of waiting for a refresh. Activity speaks
  in the reader's time zone. Report buttons sit at the bottom of the page.
- **Action states belong to the design system.** Button, ButtonLink, IconButton and Switch take
  `idle`, `working`, or `done`; the component owns the hairline, the tick, the durations and the reduced-motion
  rule. A control that shows a value changes it on press, disables itself, and rolls back on refusal.
- **Landing page rewritten** around what the product does for a person and how an agent helps, with claims
  checked against what the code actually does.
- **CI** allows forty minutes and caches Playwright browsers, after a run was cancelled during the install.

### 4 November 2026

- **Design language.** Technical sheet, chosen from rendered studies: paper light, tinted dark, one
  grotesk, 680 measure, hairlines instead of boxes, square controls, one solid action per view.
  Account page now owns appearance (System by default, following the device), data, sign out and
  erasure. Deployed.
- **MCP read fixes from client feedback.** ISO 8601 instants accepted for transaction and feedback
  bounds with the format named in the schema; date bounded transaction reads page back to the bound
  instead of stopping at the newest fifty; free-agent availability hydrates without a stats read; an
  unresolvable player reference names its input position.
- **MCP grants.** A replayed refresh token past the grace revoked the whole grant family; the grace is
  now five minutes and a refused exchange names its OAuth error, grant type and whether a refresh token
  was presented. A resource-less token exchange defaulted to an opaque token the MCP endpoint could
  never verify; it now defaults to the MCP resource.
- **League rosters.** A read across every team in a league the account plays in, paged by team.
- **Owner frictions.** Explicit player lists return whole; the owner note rides the roster and trade
  surfaces; draft picks carry their player's name.
- **Container end-to-end is the only E2E target**, now that the artifact is what ships.

### Open after this log

- Declarative proposal sets with reserve moves and server-owned ordering (R15), and draft picks in
  trades only if the provider can express them (R17-2).
- Whether a stale replay may spare a grant minted after it (family revocation policy).
- The live erasure proof still needs a signed-in account whose address can receive mail.

---

## A. Quick wins

Independent, small, visible. Each ships on its own.

### A3 — Transaction trends on player rows

What other managers are doing with a player is a signal for lineup and waiver decisions.

- [x] Establish what the provider actually publishes: check the reference implementation, probe the API,
      and test a few players with known movement. Trend counts and percent change are different things.
- [x] Expose whatever exists on search and player rows, stating the window it covers.
- [x] Where the provider publishes nothing, say so rather than implying zero interest.

**Verify**: a live read on three players, plus a fixture test. `S`

Shipped as adds and drops for the provider's current day, across its leagues, never percent owned.
Rows without a provider node say `not_published` with the reason and never show zero. The request
shapes are recorded in [RESEARCH.md](fantasy-manager/RESEARCH.md).

### A4 — Per-team context note for agents

League settings cannot express keeper rules, dynasty details, salary implications, or a player kept for
sentimental reasons.

- [x] Add an owner-scoped note per team, bounded in length, with guidance that it is not a secret store.
- [x] Edit it on the team page, in the product's voice.
- [x] Return it wherever a single team is read over MCP, described as owner context rather than provider
      fact.

**Verify**: round-trip through the UI and an MCP read; a password-shaped value is rejected or warned. `S`

Shipped with a 2,000-character limit, explicit save, unsaved-change protection, and a refusal for
credential-shaped text. The MCP team summary labels the note as owner context and never sends it to
the provider.

### A5 — Ship the existing spans to Cloud Logging

Shipped, then superseded by group D: spans leave the process as traces and the log carries one wide event per
unit of work instead of one line per span.

- [x] Confirm the spans and annotations are present and useful in the worker, the web app and the hosted
      browser.
- [x] Inject a tracer that exports them in a queryable format.
- [x] Document the queries worth knowing in the deployment runbook.
- [x] Add an alert on failed and uncertain runs. It keys off the wide event, and it is enabled.

### A6 — Round 9 follow-ups

What the client filed after retesting the deploy, minus the emergency handled separately.

- [x] Populate the roster transaction deadline for every league. Two of the owner's leagues report
      `intraday`; three report `not_set` where the provider does have a value, so the decode is incomplete.
- [x] Interpret it into a provider-neutral rule, `same_day | next_day | weekly_lock`, so a client does not
      need provider folklore to know that `intraday` means same-day.
- [x] Look at dating a pool candidate's schedule. Our schedule read is roster-scoped, so a free agent whose
      professional team has no rostered player cannot be dated. Find out whether any request shape covers it
      and record the verdict either way.
- [x] Reduce the ordinary summary group set so a six-group call fits instead of narrowing.

**Verify**: every owner league reports a timing rule, and the schedule verdict is written down. `S`

Shipped: the three leagues reported as `not_set` publish `weekly_deadline: ""`; the raw value is kept
and `timing.rosterChange` publishes a sourced rule. The league player pool is date-addressable through
`type=date`; the shape was probed and recorded in
[RESEARCH.md](fantasy-manager/RESEARCH.md#pool-player-schedule-shapes-2026-10-31), but the public
pool selector was removed because it projected one date's opponent rather than filtering the pool and
no client used it. Pool rows carry game days or scoring weeks only when `gamesWindow` asks for them. The summary
compacts category rows, pairs matchup categories, and has its own 20 KiB target/28 KiB hard ceiling;
the six-group call returns seven roster rows on the 13-team league.

### A7 — Reserve-slot eligibility

The client wants to find an injured player sitting in an active slot while a reserve slot stands open, which
is a free roster spot.

- [ ] **decide** how eligibility is expressed: per-player eligibility on roster rows, or accepted status codes
      per reserve position in the roster rules. Their proposal is either; ours should be one, not both.
- [ ] Publish it, so a client can tell that a day-to-day player qualifies for one reserve type and not
      another, and check it against the owner's real cases.

**Verify**: the owner's four known cases classify correctly, including the one that must not qualify. `M`

- [x] **Owner's ruling, 2026-11-02**: a player in a slot he is no longer eligible for may stay there, and must
      never block the rest of the lineup. He is named in the run summary for information.
- [ ] The ruling also says he is not frozen: if a legal slot for him exists, including swapping him with a
      player who qualifies for the reserve slot, the plan moves him. Only when no complete legal plan exists
      does he stay. Nothing may hardcode a reserve slot's name, because other sports call theirs IL or IL+.

Proven in production on 2026-11-02 for the team **Meier? I barely know her!**, which had refused every
scheduled write with "No complete legal assignment of this roster exists" because one player made a complete
assignment impossible. After the change the same run reports `left_in_place = "Travis Konecny (IR)"`, sets
everyone else, and the provider accepts the write. That also answers what the code could not: the provider
accepts roster changes while an ineligible player sits in reserve.

## B. GCP configuration and cost

Settings changes, not projects.

### B1 — Cloud Run configuration and cost

The container appearing to live fifteen minutes after each tick turned out to be a scaled-to-zero instance
throttled and unbilled, not work. Seven days of Monitoring data: 2,451 worker instance-minutes against 2,716.9
billable instance-seconds, and no request inside a tail. One warm instance would cost $9.86 a month and one warm
hosted browser $19.72, against $0.53 and $0.11 of actual work, to remove a five-second cold start once an hour.
Memory peaks at 41 to 42 percent of the limits and 849 MiB in a real Chromium session; peak concurrency is 4.0,
1.9 and 1.7; the project uses 32 percent of the free vCPU-seconds.

- [x] Find what keeps it alive: nothing does. Request-based billing with minimum instances at zero makes the
      window throttled and free, and neither image holds a timer or keepalive.
- [x] Review memory, CPU and concurrency against measured usage. All stay as they are.
- [x] Review the worker's minimum instances and the hosted browser's scaling. Both stay at zero.
- [x] Record the monthly cost per service. The one setting the measurements rejected was the worker's 900 s
      timeout, which outlived the scheduler's 300 s and Cloud Tasks' ten-minute deadline while the tick is 17.8 s
      at p50. It is 300 s now.

`S`, done. Measurements and counters are in the [deployment runbook](deployment.md).

### B2 — Skip runs that cannot do anything

- [x] Return early only when the cached calendar says no rostered player has a game before the next tick
      **and** that date was observed after the fantasy day began.
- [x] Return early only when the team already has a verified run for the fantasy day: a team with no run
      today, or whose last run was blocked or unverified, runs even when the calendar is quiet.
- [x] Fail open: an unknown, stale or incomplete calendar runs as usual, and a manual `set_lineup` bypasses
      the gate.
- [x] Record a skipped outcome with its reason.

**Verify**: a fixture whose game moves into today after the sweep proves the run happens, because a wrong
skip is worse than a wasted read. The counters measure one ordinary check at four provider reads, one gate read
on a busy day, and a quiet day of 24 hourly ticks at one read, so 95 provider reads are saved per team per quiet
day at the cost of one extra read on a busy day. The gate's own tests cover a quiet day, a busy day, stale and
missing schedules, an unmapped roster team, and a sport with no game source. `M`, done.

---

## C. Foundations

### C1 — Repository remote and CI

Staging, dual deployments and review workflows all wait on this.

- [x] Create the repository and push the history. It lives under the personal account `folkg`, which owns
      the author identity `graemefolk@gmail.com` these commits carry. An earlier copy under the work account
      `graemefolk` still exists and needs a token with the `delete_repo` scope to remove.
- [ ] **Never repoint `origin` at an empty repository and fetch.** Jujutsu treats the missing remote bookmark
      as a deletion, reconciles the working copy against an empty remote, and removes tracked files from
      disk. Recover with `jj op log` then `jj op restore <operation>`, raising
      `snapshot.max-new-file-size` for that command if untracked build output is too large to snapshot. Push
      to a fresh repository by removing and re-adding the remote instead.
- [ ] CI runs checks and all three end-to-end targets on a clean Linux runner.
- [ ] **decide** the staging model: a long-lived environment, or one per branch destroyed after review.
- [ ] Deploy production only from a merge, preserving the traffic-pinning step.
- [ ] Keep secrets, including the state database URL, in CI and out of the repository.

**Verify**: a pull request runs checks, a merge deploys staging, and production requires the documented
approval. `M`

### C2 — `bun checks` is too slow

A first attempt rearranged the entry point into parallel steps and measured 142 s against a 128 s baseline. It
was reverted. The real cost was inside the node suite: every storage test built a fresh Postgres cluster and
replayed 21 migrations, about 590 ms per test, and one file spent 45 of its 46 s doing only that.

- [x] Measure per-project and per-file timings and name the long poles.
- [x] Cut what is measurable: one migrated template image per file, and each test still opens its own instance
      from it, so isolation is unchanged.
- [x] Keep the discipline: no retries, no skips, no inflated timeouts, and the test count went up.

**Verify**: 128 s to 86 s, 1420 node tests passing, measured before and after in the commit message. `M`, done.

## E. Cold start and the edge question

### E1 — Cold start is a white page

Shipped 2026-10-31. [The runbook](deployment.md#cold-start-and-the-waking-shell-2026-10-31) owns the
numbers and the reproduction. Most of the wait was a five-second startup-probe interval, not rendering:
the web container now probes every second, and a render that stalls past two seconds answers with a static
waking document instead of a blank tab. Median cold TTFB fell from 6.53 s to 3.37 s and first contentful
paint from 6.81 s to 3.65 s. The residue is Cloud Run's container start plus the network round trip; the
owner kept the Cloud Run origin rather than adding an edge cache, so a genuinely cold visit still cannot
paint before the container starts.

- [x] Measure cold start, p50 and p95, from a cold revision and after scale-to-zero.
- [x] Render a static shell immediately with an honest "waking" state, rather than a blank page or a
      spinner that never resolves.
- [x] Consider showing the last read from local storage while waiting, marked as stale rather than
      presented as current. Rejected: local storage is empty on a first visit, which is the case that
      matters, and a roster read shown beside a live action would compete with the action it describes.

**Verify**: measured time to first paint from a genuinely cold state, and the shell never claims data it
cannot substantiate. `M`

### E2 — Evaluate a Cloudflare split

Separate from the GCP settings wins above, because it is a real project with real complexity.

- [ ] Evaluate the free tier honestly: request cost, worker CPU limits, database access from the edge, and
      whether the MCP surface works there.
- [ ] Judge the split on its merits: live UI and MCP where cold start is negligible, scheduled work on GCP
      where cold start does not matter.
- [ ] Define the shared-code boundary and how one repository expresses two deployments.
- [ ] **decide** whether the split is worth it; if not, record why so it is not reopened without evidence.

**Verify**: one read path served from the edge, with measured latency and a cost comparison against B1's
numbers. `M`, depends on C1.

### E3 — Alchemy idiom audit

- [ ] Review the stacks against how Alchemy expects resources, outputs and state to be expressed.
- [ ] Fix what is not idiomatic, particularly anything that would make E2 awkward.
- [ ] Keep the state-database rules from the deployment runbook intact.

**Verify**: a review with each deviation fixed or justified, and a clean deploy with no drift. `M`

---

## F. Schedule cache

The provider publishes no season or team schedule; the only schedule data is one opponent per rostered
player per date or scoring week.

### F1 — The professional-team calendar

**The source decision is settled** ([SCHEDULE-SOURCES.md](SCHEDULE-SOURCES.md), [ADR 0011](fantasy-manager/adr/0011-schedule-observations-and-schedule-sources.md)):

- Cache what our own reads already publish, as schedule observations with a per-observation freshness
  policy. Caching is what makes the reads efficient — up to 360 provider reads a day for the same answers
  becomes five.
- Add the **NHL's own API** (`api-web.nhle.com`) as the first external source, for start times, venues, a
  horizon beyond the current period, and postponement state. It is free, keyless, one 100 KB request per
  league week, and its `robots.txt` allows the site with `use=reference`.
- **Do not use Yahoo graphite** without written permission: it is technically the best candidate and Yahoo's
  Universal Terms of Service prohibit both the automated collection and the database it would create.
- **Do not add an NFL source yet.** The provider opponent answers the automation question. If a feature
  needs one, TheSportsDB at $20/month is the cheapest licensed option, and that cost is stated before it is
  recommended.
- **Never join on an abbreviation.** Roster rows carry a professional-team key, observed as `nhl.t.26`. League
  abbreviations differ from the provider's (`LAK` against `LA`). A mapping comes only from a pair the provider
  publishes on one roster row, is scoped to its league, is one-to-one or is unused, and an unmatched team stays
  unresolved rather than guessed.

### F1.1 — Schedule-observation store and read view

- [x] Add the observation store: subject, observation kind, the window it covers, value, observation instant,
      source, confidence (`authoritative` / `corroborated` / `reported`), and the upstream reference.
- [ ] Add the read view that reports a disagreement between two authoritative observations as a conflict; the
      current read takes the stored newest observation and cannot reconstruct a disagreement.
- [x] Keep one row per source, subject, observation kind, and window, and prune windows that ended more than 14 days
      ago.

**Verify**: a fixture that changes value leaves one row with the newer observation, an older observation cannot
replace it, and retention removes a window after 14 days. Conflict reporting remains open. `S`.

### F1.2 — Record the provider's own scheduled games

- [x] Record the provider opponent the roster reads already publish, one observation per fantasy team per
      date, with the fantasy-day maximum age.
- [x] Serve the schedule window from the store, refreshing once per fantasy day per linked team instead of
      once per automation tick.

**Verify**: a week of live reads matches the direct provider read for every rostered player's dates, opponents
and home or away, and the request count over the same week is recorded. `M`.

Measured before the store existed: 360 provider reads a day became 5. Production holds one
`provider_opponent` observation per linked team per fantasy day, last written at 08:55 UTC on 2026-11-02.

### F1.3 — Professional-team identity from provider-published pairs

- [x] Store the canonical professional team on the provider's key, with the league and the display
      abbreviation kept as display text only.
- [x] Attach a source identifier only through a key/abbreviation pair observed on one roster row, recorded
      with its source and instant; scope it to the league and refuse a one-to-many mapping.
- [x] Leave an unmatched source team unresolved and unserved for any canonical team.
- [x] Learn the pairs from a wider provider read instead of only from rosters we happen to read. Only pairs
      seen on a roster row were known, so 7 of the league's clubs (Boston, San Jose, Tampa Bay, New Jersey,
      Edmonton, Anaheim, Los Angeles) had no identity, every game involving them stayed unattributed, and the
      gate had to fail open with `provider_game_missing_from_source`. The complete 32-club map is now checked
      in, paired from the provider's whole hockey player pool against the league's own week read; the calendar
      resolves every club from it and reports a club it cannot match as `no_map_entry` or `map_disagrees`.
- [x] Resolve a stored game's clubs when it is read, not when it is written. A week written before the map
      existed kept its unresolved clubs until its fantasy day ended, so the gate still reported
      `provider_game_missing_from_source` after the map shipped. The observation now keeps the source's own
      identifier, abbreviation, and name, and every read resolves it through the map.

**Verify**: a deliberate one-to-many mapping is refused, and an unknown abbreviation produces no canonical
team. `S`. Produced 54 identity rows over 29 distinct provider keys in production.

### F1.4 — The schedule read and the source registry

- [x] Read a stored observation with its instant, source, confidence, and window, or a named refusal. This
      is `ScheduleObservationRepository`, whose typed reads validate the stored value and return the window
      with it, rather than a single generic `require`.
- [x] Add the source registry injected at the composition root, with declared sport coverage, horizon, and
      what the source publishes. This is `GameSourceRegistry`, keyed by league, registered once in
      `ApplicationLayer`; no generic module names or imports a source.
- [x] Move the existing schedule reads onto the store, so a caller asks for an observation and not for a
      read.

**Verify**: a fake source with different coverage and horizon needs no generic edit, and the provider adapter
is the only module that names the provider. `M`. `SecondProviderFakeTest` proves the fake source needs no
generic edit; the two lint and dependency rules prove no generic module names a sport or provider vocabulary.

### F1.5 — The NHL external source

- [x] Add the `api-web.nhle.com` source: the league-week read for start times, venue and status.
- [ ] The team-season read for the fixture skeleton is not built; nothing needs it yet.
- [x] Ask for a concrete date, one league week per request, never the `/now` alias, which redirects and is
      refused by our egress policy.
- [x] Decode the status field so an unrecognised value is `unknown`, never `on`, and an empty games array is
      an empty week while a missing one is a fault.

**Verify**: one live week matches the league's own page for every NHL team's dates, start times, venues and
home or away, and the request count for a week is recorded. `M`, depends on F1.1, F1.3, F1.4.

Verified in production on 2026-11-02: 51 games stored for the week of 2 to 8 November, one request for the
whole league week. The first attempt failed for a reason worth recording: the source closed the request scope
and then read the response body, and the transport ties the body to that scope, so every read died with a
request error carrying no status and the gate could only say unavailable. A throwaway Cloud Run job proved the
network was never at fault, reading the same URL in 112 ms with a 200 over IPv6.

### F1.6 — Coverage, conflicts, and the postponed signal

- [ ] Publish coverage: games beyond the current period, games remaining, and how far the source reaches,
      each stating when it was observed.
- [ ] Split a disagreement by question: the provider wins on whether a game exists on a fantasy date, the
      external source wins on when, where, and whether it is still on. Record the conflict and surface it.
- [ ] Mark a postponed game as postponed from an observed case, and leave it unresolved until one is observed.

**Verify**: a week where the two sources agree publishes no conflict; a deliberately conflicting fixture is
recorded and surfaced with both observations; a postponed game stays unresolved until an observed case proves
the marking. `M`, depends on F1.5.

### F1.7 — An NFL source, gated

- [ ] **decide** whether a feature needs NFL start times, venues, or a full-season horizon. Nothing does today.
- [ ] If one does, TheSportsDB at $20/month is the cheapest licensed option covering all four sports; state
      the cost and the identity mapping before buying.

**Verify**: the decision is recorded with the feature that needs it, or the item stays closed. `S`, blocked on
a feature requirement.

---

## F2. Draft picks in trades (backlog)

A keeper league can allow draft pick trades, and the owner's leagues do. The provider publishes that
rule (`can_trade_draft_picks`, surfaced as `trades.draftPicks`) but expresses picks only on its website
trade form: `tpids[]`/`tpicks[]` for one side and `tpids2[]`/`tpicks2[]` for the other, with pick values
shaped `{round}_{originalTeamId}`. Every XML shape tried against the transaction API is rejected at
schema level, while a real player in the same body reaches semantic validation, so the request shape is
the limit rather than the product.

The capture in `packages/yahoo-sdk/docs/mobile-api.md` answered the shape, and F3 below carries the
work: a pick crosses the port, the adapter sends it to the app write host, and a refusal keeps the
provider's sentence. The website write host still refuses the pick body at parse level, so no website
session is stored.

### What the capture session is for

The owner used mitmproxy against the provider's app some years ago and expects it to still work on
Android. One capture session is worth more than one question, so the list below is the whole inventory
of things we cannot read today and would act on. Every entry is a question to answer from observed
traffic, never a promise; an entry that turns out not to exist is deleted rather than guessed at.

| Question                                                                                              | What it would change                                                                 | Where it probably lives                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| How does a pick enter a trade request?                                                                | Answered by the Android capture and F3: `<picks><pick>` with round and two team keys | The trade submission call behind the app     |
| What are the real bid amounts on resolved waiver claims, and who else bid?                            | Waiver advice can say what a claim needs rather than only what is allowed            | The claim history or transaction detail call |
| Why is a player unavailable, in words?                                                                | The app explains a status instead of only showing it, which is what people ask       | A player notes or injury feed                |
| What is a player's role this week: line, pair, depth?                                                 | Streaming and start/sit advice stops treating every player as interchangeable        | Depth chart or projection detail             |
| Who is on the trade block, and what is being shopped?                                                 | Trade proposals can start from real interest instead of a cold offer                 | A trade block or team activity call          |
| What does a keeper cost? The round, pick, team, and season are already published as draft provenance. | A keeper cost the provider states, instead of the owner's own formula                | A keeper or draft-detail call, if one exists |
| What is the draft order for next season?                                                              | Pick trade value becomes computable, which is the point of trading picks             | Draft settings or draft results with order   |
| When does each player lock, per game?                                                                 | A late scratch or a bench swap before a specific game start becomes correct          | Schedule detail or lineup lock metadata      |
| How are live points attributed per player during a matchup?                                           | Activity can explain a swing in a matchup, not just a lineup change                  | Matchup or live scoring detail               |

Reads to try on our existing channel first, before assuming a capture is needed: the transaction detail
shape behind a completed trade, the waiver claim history for a league, and any player endpoint that
carries a note or a role. These are cheap to test with cookies we already hold, and each success
removes an entry from the table.

---

## F3. Draft picks in trades (owner's next main-line item)

The league switch is published, a pick crosses the provider port, and a pick-bearing trade is sent. The
shape and the host are proved live on 9 November: a Round 1 for Round 1 proposal returned 201 with pending
trade `477.l.58487.pt.13` and was cancelled with 204. Picks need the app write host, and the body needs a
`<trade_note>` element even when it is empty; an empty `<players>` element breaks the parser, so it is
omitted when only picks move.

- [x] Prove, read-only, that our stored connection authenticates the Android v2 read host for
      `available_draft_picks`, before promising the feature. The stored Yahoo connection (`ready`) read
      `https://pub-api-android-ro.fantasysports.yahoo.com/fantasy/v2/league/{leagueKey}/teams;team_keys={teamKey};out=available_draft_picks?format=json`
      with HTTP 200, `application/json; charset=utf-8`. A hockey league whose settings say
      `can_trade_draft_picks = 1` returned a per-team `available_draft_picks.picks` array of `{ pick: { round } }`
      with rounds 1-19 and no `cost`, `pick`, or original-team field on this host with this query. Two team keys in one
      request returned both teams' lists. The adapter's own read, given the decrypted stored cookie, returned the same
      rounds through `readAvailableDraftPicks`, so the host, path, and payload shape are proven end to end. No crumb was
      needed for the read.
- [x] Add a pick asset to the provider port: round, source team, destination team, with the league's
      `tradeDraftPicks` capability gating it.
- [x] Validate a pick against the league's available picks and the team that owns it; refuse a pick the league does
      not allow with the reason, never silently ignore it.
- [x] Carry picks through a proposal item, the order, submission and the reads, in league terms: a first-round
      pick, from whom, to whom.
- [x] Say what execution honours. The review publishes `tradeProposal` with `assets: [player, draft_pick]`; a
      pick is carried in the captured `<picks><pick><source_team_key>…<destination_team_key>…<round>…` shape, and a
      pick-only trade is a legal trade. A provider refusal returns in league terms with the provider's own
      sentence and the item stays replaceable; a successful proposal stores the provider's pending-trade key.
- [x] Live proof with the stored connection, after a fresh sign-in. A Round 1 for Round 1 proposal on Bread
      Roller returned 201 (`477.l.58487.pt.13`) and was cancelled with 204. The website write host reads the same
      body and answers "You must select at least one player or pick."; the app write host accepts it. A player and
      pick body together parse on the app host, so a mixed trade is representable. The live record is
      `e2e/scratch/pick-send/evidence.md`.

**Verify**: a pick proposal is accepted by validation, appears on the review with both sides named, is sent
with its picks to the app write host, and a refusal keeps the provider's sentence and leaves the item
replaceable. `M` — done, and the write is proved live.

## F4. Every provider request through the SDK (done)

The owner's ruling: "Everything must live in the SDK in a good, strongly typed, general shape. No calls or
validation shall be left in the app." The migration is complete. The adapter builds no provider request at all:
not a read, not a write, and not the write token, which now lives inside the SDK's write path so a write is still
exactly two requests with no retry.

- [x] Migrate every read: teams, session, rosters (single team, schedule, and the whole league), league settings,
      matchups, transactions, pending trades, draft results, player details and history, weekly ranks, the
      scorer's percent-started facts, standings, completed trades, discovery, player search, available draft picks,
      and the scorer's games played.
- [x] Migrate every write: lineup writes, explicit assignments, reserve moves, transaction writes, trade proposals
      with picks, counters, responses and withdrawals.
- [x] Delete the adapter's own transport and builders: `readJson`, its URL builder, the read origins, the payload
      decoders only it used, every XML body builder, the crumb fetch, `YahooJson.ts`, and the write bounds.
- [x] Prove the migrated paths live: five reads against a real league, a no-op lineup write with an identical
      read-back, and a provider-refused write carrying the provider's own sentence
      (`e2e/scratch/provider-regression/`).
- [x] Record the size: `YahooProvider.ts` 4,822 to 2,083 lines, plus a 1,101-line thin mapping module, for a 34%
      reduction across the provider code.

**Verify**: no provider request is built outside `packages/yahoo-sdk`; the adapter keeps only Lineupgrade policy
and the port mapping. `L` — done.

## F5. Availability values for the pool (owner's ruling, 10 November)

`free_agent` stays strict: a free agent is a player the provider offers outside waivers, and an empty pool is an
honest answer rather than a defect. Waiver-listed players get their own availability value so a client can ask for
them explicitly.

- [x] Three distinct pools: `free_agent` (off rosters, outside waivers), `waiver` (off rosters, on waivers), and
      `all` (both). The audit found `all` had been returning rostered players, and fixed it at the provider request.
- [x] Proved against the owner's football league, where every available player was on waivers, with live counts and
      an honest empty strict pool. Evidence: `e2e/scratch/availability-pools/`.

**Verify**: a client can ask for free agents, for waiver-listed players, or for both explicitly, and each answer is
what the league actually holds. `S`

## G. Provider boundary and simplification

### G1 — Stop provider-shaped ideas leaking into generic code

- [x] Audit every generic module for provider-shaped concepts. Found real leaks, including a bug: two-value
      ternaries labelled MLB and NBA teams as NHL and Hockey, and the landing page claimed a scoring period the
      code does not implement.
- [x] Express each as declared capability data: the weekly search ordering, the schedule read limit of 21
      dates, and the games-played limitation that had named one provider's wire query in three places.
- [x] Extend the boundary audit and ADR 0007, and add two lint rules rejecting a sport or league literal
      comparison and a provider request path in generic source, each proved against a deliberate violation.
- [x] Keep the dependency rule that rejects an adapter import outside the composition root.

**Verify**: a second fake provider with different coverage, league type and slots needs no generic edit. `M`,
done.

### G2 — Ponytail discipline

The owner's standing instruction, applied as ongoing practice rather than a one-off pass: the smallest
change that fully solves the task, delete before adding, no speculative abstraction, no option nobody
asked for, and no dependency for a few lines. It never cuts validation at trust boundaries, error handling
that prevents data loss, security, accessibility, or anything explicitly requested.

- [ ] Apply it to every chunk from here on, and note in each reply what was deliberately not built.

**Verify**: reviewed per change; no separate deliverable. `S`, continuous.

---

## H. Transactions review

This is the largest new surface in the product and the first one that writes on a person's behalf. It sits
ahead of the framework migration because the migration is waiting on a release that keeps moving, and this
group cannot wait forever. If the release lands mid-build, the backend half is framework-independent and the
screen migrates with everything else.

The provider's own review links did not work. Yahoo's add page ends in a form submission a deep link
cannot perform, so it lands on a page whose only working action is Cancel, and the Yahoo app claims
`*.yahoo.com` on mobile before a browser sees it. No link we constructed survived either, so that
surface is gone and a proposal set is reviewed inside Lineupgrade instead.

**What it is:** the agent proposes, a person decides, the server writes.

### H1 — Trade probe

- [x] Read-only: does the league transaction feed publish pending trade proposals, and what does the trade
      review setting actually permit. It does: a manager's own offers, with both parties, both ends of every
      movement, the picks, and the `pt` key the documented respond calls take. The plain feed never carries
      them, and another team's offers are refused.
- [x] One write on one league: a proposal was sent, read back and withdrawn in the Irish lacrosse football
      league, and the counterparty could have seen it for about a minute. A repeated propose is unproven, so
      the product never retries one.

**Verify**: a written finding with the request shapes tried. `S`

### H2 — Proposals and the tool

- [x] One call covers every team: a list of proposals, each naming a team, the players to add or drop, an
      optional FAAB bid, and a required short reason. One link back, to one review screen.
- [x] Proposing writes nothing to the provider.
- [x] Re-validate before anything is executable: the player is still available, the roster is still legal,
      the period is still open. A stale item states why rather than failing at submit.
- [x] Carry its own threat model, because this is the first surface where an authorization mistake means
      writing to somebody else's team.

Shipped 2026-10-31. `propose_transactions` stores the set (every owned team, grouped, with the
proposer and surface, expiring after 24 hours) and `revalidate_transaction_proposal_set` re-reads one
batched team state per team and marks each item current or stale with a reason.
`get_pending_trade_offers` reads the provider's own pending offers for a team, read-only. Every read and
write filters by owner, player references are sealed to the owner and league, no tool submits or spends
anything, and the 24-hour window makes an expired set refuse re-validation instead of executing stale
facts. The review screen and execution remain H3 and H4.

**Verify**: an account-wide proposal set read back from storage, with a stale item marked and nothing
written upstream. `M`

### H3 — The screen

- [x] Grouped by team, with a quiet section for teams that have nothing proposed.
- [x] The reason beside each move, and the drop beside the add so a swap reads as one decision.
- [x] Reversible and irreversible actions do not look alike: a waiver claim says it spends FAAB and cannot be
      undone, and a trade says it is an offer only the other manager decides.
- [x] Checkboxes to include or exclude, then one submit, with the action fixed on a 390 px phone.

**Verify**: a six-team proposal set reviewed on a phone-sized viewport, with a stale item and an excluded
item both behaving correctly. `M`

### H4 — Execution

- [x] Writes through the provider's transaction endpoint, using the session and crumb the lineup writer
      already uses.
- [x] Per-item outcome, recorded. No silent retry: a retried add can drop the wrong player.
- [x] Move a player to a reserve list as an executable move, so an add can free a roster slot without
      dropping an injured player, under the same per-item outcome and re-validation rules.
- [x] One team failing never hides the others.
- [x] **decide** trade staging: no. The provider publishes no parameterized trade proposal page and its
      write shape is unproven. Trades stay read-only and link out; incoming offers stay read-only.

Shipped 2026-10-31: a signed-in person submits the included items from `/transactions/{setId}`.
The database claims the set once, submission re-runs revalidation immediately before writing, and
one provider transaction per item carries the add and drop together. An optional reserve move is a
separate recorded step before the add. Outcomes are `executed`, `pending` on waivers, `failed`,
`skipped`, and `unknown`; a failed, unknown, or pending item stops only its own team, and unknown is
never retried. No MCP tool executes anything. The request shapes and out-of-scope notes are in
[RESEARCH.md](fantasy-manager/RESEARCH.md#player-adddrop-and-reserve-moves-2026-10-31).

**Verify**: a real add and drop on a disposable league, with per-item outcomes and the provider's own
transaction feed agreeing. `M` — **live acceptance outstanding**: no disposable league was available,
so the adapter is verified against the fake provider and the recorded request shapes, not a real
transaction feed. The end-to-end suite exercises the web submit path against that fake.

## I. Foldkit migration

The preview is already merged into the rush-hour starter, so the shape is proven. The final release is
expected shortly; adopt it when it lands. This removes the TanStack advisory entirely, which is the
current publication blocker.

### I1 — Adopt in the sample app and evaluate

- [ ] Bring the rush-hour sample onto the released version and record what is better and worse in practice.
- [ ] Code splitting: what the bundle looks like without it, and whether it can be recovered.
- [ ] Rendering: virtual DOM against signals, measured on a list-heavy screen rather than argued.

**Verify**: a running sample with feature parity, plus numbers on both concerns and a recommendation.
`M`, blocked on the final release.

### I2 — Migrate Lineupgrade

- [ ] Migrate in slices, keeping the product working throughout.
- [ ] Preserve the provider boundary, the MCP surface and every acceptance test.

**Verify**: full end-to-end parity plus the measured bundle and interaction numbers from I1. `XL`, split
before delegating.

### I3 — Close the publication gate

- [ ] Remove the temporary backport once the framework no longer carries the vulnerable transport.
- [ ] Update [release-readiness.md](release-readiness.md) and the README gate.

**Verify**: the built-app regression test that reproduces the advisory no longer applies, and no vulnerable
`start-server-core` remains installed. `S`, depends on I2.

---

## J. Security and privacy audit

Distinct from the dependency audit, which is done.

### J0 — The audit

- [x] Threat model the whole surface: sign-in, sessions, the hosted browser, the MCP server and its OAuth
      issuer, the worker, and the database.
- [x] Review dynamic client registration for abuse, and per-tool scope enforcement.
- [x] Review encrypted credential storage, key handling and rotation.
- [x] Inventory personal data actually stored, where it lives, and how long it lives.
- [x] Review the address-based egress policy and the hosted browser's blast radius.
- [x] Review rate limits, logging hygiene, and what a compromised worker could reach.

Written up in [SECURITY-AUDIT.md](SECURITY-AUDIT.md): sixteen findings with severities and evidence, four
fixed with a regression test each, one accepted as designed, eleven deferred with a reason. The groups
below are the deferred work that is worth scheduling; J1 is done.

### J1 — Rate limits and a cost ceiling on the tools

Finding F1, High. The destructive and expensive tools had no per-owner limit, so one stolen token could
drive provider traffic and upstream lineup writes at machine speed and exhaust the free allowances the
deployment depends on.

- [x] Put one limiter in front of the MCP toolkit, beside the existing scope check, so every tool inherits it.
- [x] Key it by owner and by acting client, in durable storage, so scale-to-zero does not reset it.
- [x] Give `set_lineup` a smaller bucket than the read tools, and refuse with `Retry-After`, not a 500.

**Decided**: reads are 60 per client and 180 per owner a minute; other writes 20 and 60 an hour;
`set_lineup` 6 and 18 an hour, in its own bucket and window. The owner ceiling is three client ceilings, so
one client at its limit leaves a full share for two more. A refused call counts, so a failing tool is not a
free loop. The numbers and the client contract are documented in
[MCP.md](fantasy-manager/MCP.md#tool-call-limits); the counter is the durable `tool_call_quota` table. `M`,
done.

### J2 — Registration, retention and erasure for account data

Findings F2 and F4, Medium. Dynamic registration is unauthenticated and never cleaned up, and there is no
erasure or export path for a person's data.

- [x] Cap live dynamic registrations and age out ones that never completed an authorization.
- [x] Make the scope-widening update set-based instead of loading and rewriting every row.
- [x] Add one owner-scoped erasure routine and one owner-scoped export over the tables in the audit's
      inventory, in transaction order, with the cascade gaps closed.
- [x] Sweep `session`, `verification`, `oauth_consent`, and `hosted_linking_sessions` once they expire or pass
      their approved window.
- [ ] Give `uncertain` runs a resolution transition and a clock before they can age out.

**Verify**: an erasure leaves no row carrying the owner id anywhere in the database, an export round-trips,
and a registration loop is refused at the cap. `L`, split registration from erasure before delegating.

**Verified 2026-11-03.** `AccountErasure` (`contexts/privacy`) deletes the owner's rows in one transaction,
children before parents, and returns a plain-word summary. It refuses unless the owner recorded an export
within the last hour, and the erasure consumes that record so one export cannot justify a second erasure.
`AccountExport` produces one versioned JSON document over the same inventory and names every withheld
credential with its reason. Your data (`/account`) offers both; erasure requires the typed phrase
`erase my account`, signs the browser out, and lands on `/erased`. The page shows when the export was taken
and what it holds, or explains that erasing needs one. Access-token resolution now refuses a token whose
user row no longer exists, so an agent's JWT stops working as soon as the erasure commits instead of at its
expiry. The erasure test enumerates owner columns from `information_schema` so a new table cannot be missed,
seeds and removes every class, refuses a missing or stale export, proves a fresh export is consumed, and
proves a failure partway through leaves the account unchanged. The E2E test proves a cookie captured before
erasure cannot reach `/teams` afterwards.

**Not yet proven in production.** The live path needs a signed-in account, and the only way in is a sign-in
code to an email the owner controls. Deployed web revision `00076` closes the surface correctly to anonymous
visitors: `/account` redirects and `/api/account/export` answers 401. The proof to run is a throwaway account:
sign in, export, erase, then query every table for the id from outside the application.

**Owner's windows, 2026-11-02**: 90 days for lineup runs, attempts and write intents after the run ends; 14
days for stored schedule observations after the covered window ends; 7 days for registrations that never
completed an authorization, with 100 live at once; 180 days for consents after last use; 1 day for hosted
linking sessions; 7 days for run diagnostics; owner notes never expire; closed feedback reports after a year.
`RetentionPolicy` states them and the hourly sweep applies them.

Verified in production on 2026-11-02 by the first sweep after deploy: `retention.diagnostics=5`,
`retention.hosted_linking_sessions=4`, `retention.registrations=1`, every other class zero, and an in-flight
run survived the same sweep. Erasure and export remain open.

### J3 — Session revocation and a session inventory

- [x] Choose the trade: the cookie cache is off, so a revoked session is refused on the next request at the
      cost of one database read per authenticated request. At this traffic that is the right trade.
- [x] Record the chosen trade in [deployment.md](deployment.md) beside the MCP token facts.
- [x] Give the owner a session list, an end-one action and an end-all-others action, with sign-out labelled as
      ending this device.

### J4 — Keyring rotation for connection credentials

Finding F5, Medium. A leaked `CONNECTION_ENCRYPTION_KEY` has no fast remedy: the only path is to disconnect
every connection and have each owner link again.

- [x] Decrypt with any retained key version and encrypt with the current one, against the existing envelope.
- [x] Re-encrypt on the next successful credential use, then retire the old version.
- [x] Report stored key versions with the hourly maintenance tick, so retirement follows a count, and refuse
      a retired version by name instead of as a corrupt envelope.

**Verify**: a connection linked under version 1 keeps working after version 2 becomes current, its stored
envelope is version 2 on the next use, and the old version's key can no longer decrypt anything. `M`.

---

## K. MCP client contract

Standing friction with the external client, and the verification gap that let it persist.

### K1 — An MCP acceptance command

- [x] `bun run mcp:accept` registers a client, runs the full flow, and asserts per-tool enforcement.
- [x] Proves both directions: a restricted grant reads what it should and is refused on exactly the tools it
      lacks, with the refusal naming the scope.
- [x] Wired into the verify skill, so accepting an MCP change includes running it.

### K2 — Reduce the scope set

- [x] Map every tool to the scope it needs. Four resource scopes remain: `fantasy:read`, `transactions:review`,
      `lineups:write`, `teams:manage`. `feedback:manage` is gone with the public triage tool, and reading a run
      no longer needs a write scope.
- [x] Keep `offline_access`: it is the refresh request, not a resource right.
- [x] Keep the protected-resource document's omission of `offline_access`, which is correct under RFC 9728, and
      say so where a client author will read it.
- [x] Document the set, the retired names, and the old-to-new mapping. Retired names are accepted but never
      advertised.

**Verify**: the acceptance command passes for the full grant, the onboarding baseline, and a legacy grant minted
with a retired name. `M`, done.

### K3 — Grants should survive a deploy

The client reports reconnecting after every deployment. That should not be necessary: signing keys are
persisted, so access tokens survive a revision change.

- [x] Instrument refresh-token use around a deploy and find whether the strict rotation plus a cold-start
      failure is what ends the grant.
- [x] If so, widen the reuse window and document the behaviour instead of leaving clients to rediscover it.
- [x] Prove it by holding a grant across a deploy with a client that retries.

**Verify**: the same grant serves requests before and after a deploy with no re-authorization. Held a grant
through web revisions `…-00128-lld` to `…-00129-87w` on 2026-11-10: 20 refreshes returned 200 across the
change, `/mcp` served on both sides, and a retried rotated token replayed instead of revoking; a cold-start
refresh abandoned after 1.5 seconds still replayed on its retry. The earlier 30-second window is what ended
grants when a retry crossed it; the five-minute window is documented in the
[deployment runbook](deployment.md#mcp-and-oauth). `M`, done.

---

## L. Onboarding

- [x] Map the first-run path and count the steps. Before: 17 facts and 6 fixed actions. After: 13 facts and 5
      actions, with no new page.
- [x] Put the Gmail workaround where someone gets stuck: inside the browser frame, when the provider refuses the
      address, rather than in a disclosure on the page they have left.
- [x] Make progress states truthful: reading teams, what failed, a retry, and the fact that no team is checked
      until its switch is on.
- [x] Reduce what a first-time user must understand before value. Written up in
      [onboarding-audit-2026-11-01.md](onboarding-audit-2026-11-01.md).

## M. Solver and product expansion

### M1 — Positional scarcity

- [ ] Compute a league-wide scarcity measure periodically rather than per run, provider-neutrally.
- [ ] Use it as the foundation for transaction proposals, not as a score multiplier.

**Verify**: a fixture league where a thin position changes the recommendation for a documented reason. `M`

### M2 — Category-aware objective

**decide**: whether the objective should be expected categories won rather than the current community start
rate. A product choice, not a defect.

**Verify**: a league where the two objectives recommend different lineups, with the difference explained.
`L`

### M3 — Baseball and basketball

Starting-lineup rules for all four sports are declared and tested; stat categories, games and innings limits,
and provider request shapes are not built.

**Verify**: a real league in each sport, read and planned correctly. `L`

### M4 — Second provider

The seam supports it; none is planned. Adding one is an adapter plus a registry entry, provided G1 is done.

**Verify**: a second adapter reading and planning one league without touching generic modules. `L`,
depends on G1.

---

## N. Operations and compliance

### N1 — Restore policy

The drill proved point-in-time restore produces a usable database. What remains is policy.

- [x] Owner ruled 10 November: keep the current retention windows, accept up to 15 minutes of data loss,
      recover within 4 hours, and the owner executes recovery.
- [ ] Record it in the deployment runbook and test the alert path.

**Verify**: the written policy plus one rehearsal that follows it end to end. `S`

### N2 — Domain and production email

- [ ] Acquire a domain and move the sender off the Resend test address.
- [ ] Verify delivery to a non-owner address and the action-required path.

**Verify**: a real reminder delivered to a real inbox that is not the owner's. `S`

### N3 — Muse acceptance against the deployed origin

- [ ] Run the client's rounds against the deployed server rather than a local instance.
- [ ] Confirm paging, cursors, scope enforcement and pending outcomes behave the same there.

**Verify**: a recorded acceptance pass with the tool results. `S`

---

## O. Naming

### O1 — Rename to lineupgrade

Deferred by the owner, but placed deliberately: immediately before the redesign, while nothing is public
and no domain exists.

- [ ] **decide** the name, then update the wordmark, MCP metadata, documentation and any artifacts.

**Verify**: every reference updated. `M` if taken.

---

## P. Redesign exploration

Later by the owner's choice, and after the framework migration so it is not done twice.

- [ ] Explore a more vibrant and playful direction: tasteful motion, and whether cards beat lists.
- [ ] Reconcile with the locked violet and gold identity and the established copy discipline.
- [ ] Agree the direction on two or three screens before building a system.

**Verify**: a direction approved by the owner on real screens, at mobile and desktop, light and dark. `M`
to explore, `L` to apply.

---

## R. Identifiers as ULIDs

The owner prefers ULIDs to UUIDv7 for anything a person ever sees, mainly in URLs: a ULID is shorter,
sortable, and does not look like a hex accident.

- [x] Every identifier Lineupgrade creates is a ULID. Effect's `Crypto.randomULID` builds the 26
      Crockford characters from its clock and crypto service. Connections, hosted linking sessions,
      teams, lineup runs, proposals, feedback, incidents and notifications all create their identifiers
      this way.
- [x] A table whose identifier the application always supplies no longer has a `gen_random_uuid()`
      database default. Nothing outside the application inserts those rows, so no default remains on a
      Lineupgrade identifier column.
- [x] Stored identifiers keep their values. Every Lineupgrade identifier column is `text`, holding an
      old UUID string or a new ULID, with foreign keys converted by the cast rather than regenerated.
      The authentication library's tables (`user`, `session`, `account`, `verification`, `jwks`,
      `oauth_*`) and `rate_limit` keep the shapes it defines. Provider keys are the provider's, never
      ours, and are untouched.
- [x] Validation accepts one of the two stored shapes, a UUID or a ULID, under the existing per-entity
      brands, and refuses arbitrary text.

Nothing remains in this group.

**Verified**: a freshly created team, connection, run, proposal set and feedback report read back with
a ULID; tests seeded with UUID identifiers still read through the affected repositories; the migration
test keeps an old UUID row and accepts a ULID beside it; and the identifier check refuses arbitrary
text. `S`

## S. A Yahoo API SDK outside the app

Modelled on how alchemy distilled its providers: an Effect-native package that owns Yahoo's endpoints,
payloads and refusals, with the application calling a typed client instead of carrying promise-shaped
provider code.

- [x] Survey what the application already knows: hosts, read and write paths, the crumb, read bounds, the captured
      refusals, the transaction body, and every league, roster, player and matchup read.
- [x] Designed as Effect services with typed errors carrying the provider's own words; no caller sees a raw response.
- [x] Built in `packages/yahoo-sdk`, tested against recorded payloads.
- [x] Cut over completely: every provider read and write now goes through the SDK, and the adapter builds no request
      of its own. `YahooProvider.ts` fell from 4,822 lines to 2,083 plus a 1,101-line mapping module, and the
      migrated paths were proved live against the owner's leagues, including a no-op lineup write and a refusal.
- **Done** (changes `e7d04561` through `67e9908e`, plus the standings, roster, picks and window work after them).

This can proceed in parallel with product work because nothing cuts over until it is complete. A signed-in
browser tab is available for checking shapes the recordings do not cover.

The SDK is reviewed against AutoCoach's provider calls before it is called finished: that repository is reference
material for verified knowledge only, never code or architecture, and every call shape it used that we do not is
recorded with the endpoint, the payload, and what our own evidence says about it. Moves are combined into one
provider call wherever the provider supports it: an add with its drop, and several lineup moves in one payload if
the endpoint accepts them.

Once the package is complete, a separate refactor integrates it into the application and enriches the product with
whatever it proved useful: draft picks in trades and richer statistics are the owner's examples, not a mandate to
take everything.

**Verify**: the package answers the same reads and writes as the current adapter against the same recorded
payloads, and the cutover is one wiring change. `L`

## U. Copy that speaks in the league's terms

Visitors do not care about the server. The transaction review explains itself with sentences like "The order the
server chose" and "The server could not decide an order", which describe our machinery rather than the game.

- [x] Sweep the product's copy for words that name our parts: server, backend, provider, endpoint, payload,
      pipeline. Replace each with the thing the person is actually dealing with: the order the moves will run in,
      the league's rules, the player, the team.
- [x] Keep it short. One sentence where the current copy uses two, and no sentence that restates its own heading.
- [x] Leave provider names in the places the guidance already allows: a connection row, a connection message, a
      provider link. Nowhere else.

**Verify**: a grep for the named words over product copy returns only the allowed places, and a walkthrough of
the transaction review reads as English about a fantasy team. `S`

## V. Motion that earns its place

The owner asked for a pass over small animations, with the guidance from Emil Kowalski's work: most things need no
animation, frequent interactions should not be animated, and motion exists to delight on the rarer moments.

- [x] Read the skills before deciding anything, and record the handful of principles this product will keep, in
      the same voice as `DESIGN.md`.
- [x] Pick a small number of infrequent moments where motion would genuinely help, not a sweep of the interface.
- [x] Fix the working hairline: the owner saw it stutter, in Firefox. Measured in both engines, the cause was the
      animated value, not the layout; it now animates a compositable transform and keeps full strength while the
      control works.
- [x] Keep every duration and easing in the theme tokens, and keep the reduced-motion rule authoritative.
- [x] Do not animate the action states: their timing is already decided and written down.

**Verify**: each added motion names the moment it serves, its duration comes from a token, a reduced-motion
capture shows the same content without it, and the submit bar's frame timing is recorded. `S`

## W. Statecharts on XState

The owner prefers the de facto statechart library to the one we adopted. `@typeonce/effect-machine` drives the
lineup-run workflow and the connection lifecycle.

- [x] Evaluate XState with its Effect integration on the v6 beta against the two machines: the lineup run workflow,
      the connection lifecycle, the team automation and hosted linking. The machine definition is data behind
      `packages/backend/src/utilities/machine.ts`.
- [x] The domain events and states stayed identical; the machine's vocabulary is product language.
- [x] Both machines migrated behind their existing tests, and `@typeonce/effect-machine` with its lint plugin was
      deleted.
- [x] The migration waited until the proposal surface was quiet.
- **Done** (changes `c84e8a81`, `f90db215`, `039ce7e4`, `69e345a7`): no test changed outcome.

**Verify**: both machines' tests pass unchanged in intent, the persistence format is either migrated or read with
a compatibility test, and the old dependency is gone from the lockfile. `M`

## X. Transactions by intent, placement by the solver

The Muse keeps producing failures of the same shape: an agent declares a move it believes is legal and the server
refuses it for a reason the agent cannot see, or demands a chain of slot moves the provider then rejects. The
owner's read is that the transaction API asks clients to do our job.

- [ ] Replace declared slot destinations with intent: an add, a drop, a trade, and "put this player on my active
      roster" or "stash this player on a reserve list". The server decides the slot with the lineup solver, which
      already knows every slot's eligibility and the reserve rules.
- [ ] Publish the roster's own arithmetic: active count against the maximum, reserve occupants excluded from it,
      and per-move effect on that count, so a client never has to infer capacity. Not keeper cost: a player's
      keeper price is league-specific and never published, so it is not ours to compute. What a league chooses to
      publish about its own keeper rules is the league's, and the owner's note stays where that intent lives.
- [ ] Correct the roster model to what a provider enforces, described as declared capabilities rather than
      assumptions: the total roster maximum, whether the bench is generic or per-slot, whether a starting slot
      may stand empty, and how reserve eligibility is established (for us, published positions only). Each
      provider declares its own values and the rule reads them, so a second provider needs no branch in the
      backend. A drop frees a roster place, not a place in a kind of slot.
- [ ] Judge a set against the roster on the date its moves apply, read from the league's declared timing, not
      against today's roster.
- [ ] After a submission executes, run the lineup for each affected team once, so placement settles without a
      second client call, and batch the provider writes the provider accepts in one call.

**Verify**: the Muse's recorded failure cases (the two illegal reserve placements plus an add, the two-item
legalization, and the post-drop activation) propose, submit and settle with no client-declared slot destination;
the accounting block matches the provider; and an executed set leaves each affected team's lineup placed. `L`

## Q. Standing loops

### Q1 — Client feedback

Not a project. External clients file findings through the product; triage them, fix what is real, and record
why anything is declined. Currently zero open.

---

## Decisions needed from the owner

| ID  | Decision                                                                                                                   | Blocks |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| D1  | ~~Staging model for CI~~ settled: no staging; the container target is the proof                                            | —      |
| D2  | ~~Cloudflare split~~ settled: stay on Cloud Run, the waking shell covers the cold start                                    | —      |
| D3  | ~~Schedule cache source: derived from our reads, or external~~ settled: cache our reads, NHL API external, no graphite     | F1     |
| D4  | ~~Retention, RPO/RTO and recovery owner~~ settled: current windows, 15 minutes of loss, 4 hours to recover, owner executes | —      |
| D5  | ~~Rename to lineupgrade~~ settled: product-visible strings renamed; infra identities keep their names                      | —      |
| D6  | ~~Solver direction~~ settled: keep current behaviour, revisit only on a wrong lineup                                       | —      |
| D7  | ~~Transactions read-only or executed~~ settled: group I owns it                                                            | —      |
| D8  | Reserve-slot eligibility: per-player, or per reserve position                                                              | A7     |
| D9  | Passkeys as a sign-in option                                                                                               | future |
| D10 | ~~Sign-in email delivery~~ settled: SMTP relay, proved live by the erasure run                                             | —      |
| D11 | ~~Grant revocation on replay~~ settled: keep RFC 9700 family revocation                                                    | —      |
| D12 | ~~Roster spots on an offer; per-player ranking on a run~~ settled: neither publishes; neither changes a decision           | —      |

Ruled already, recorded so they are not reopened: the transactions review is one group and comes before the
framework migration, which is waiting on a release; Foldkit before any redesign; the rename before the
redesign; the visual redesign is exploration rather than committed work; "phase 2 with the solver" is
complete and is not roadmap work.

## Known non-goals

Recorded so they are not rediscovered as gaps: no server-side LLM in the solver, no scoring controls, no
premium provider actions, no arbitrary URL or SQL escape hatches, no multi-period planning, no
cross-account feedback triage.

---

## Appendix — closed work

Rationale for each lives in the commit history and the feedback records. Every item was verified before it
was closed.

- **Checks at :55.** The declared Scheduler trigger is `55 * * * *`; the scheduled period identity is still
  the UTC hour, so a retried tick cannot double up, and a manual `set_lineup` is unchanged. The pause copy
  says checks resume after the fantasy day boundary because the next tick performs the expiry. The deployed
  job still runs `0 * * * *` until an authorized redeploy. Verified by the three-tick five-team test in
  `Automation.test.ts`.
- **The whole fantasy day of activity.** Team activity carries every check from the team's current fantasy
  day and folds each maximal silent stretch with its count and time span. A day with no checks says so and
  still names the last check. Verified by the three-stretch fixture in `TeamDetailPage.browser.test.tsx`; a
  five-team, 120-run day serialized to 75.6 KiB, 2.0 KiB gzipped.

- **MCP client feedback, rounds 2 to 8.** Per-tool scope enforcement, restricted-client feedback, roto
  standings, search row fields, team summary coverage and paging, feedback read-back, hockey date
  windows, compact standings, inlined stat names, two-sided trades with picks, draft history,
  scoring-versus-informational categories, injury status on search rows, transaction rules, per-date
  schedules, and per-team acquisition usage. Resolution notes are in the feedback table.
- **Provider review links.** They did not work in practice: the provider's add page ends in a form
  submission a link cannot perform, and its mobile app claims the domain before a browser sees it. The
  surface is gone; Group H replaced it with a proposal set reviewed inside Lineupgrade.
- **Interface rework from the owner walkthrough.** Voice without emdashes or slogans, connections that exist
  only after a link succeeds, connection identity without personal data, one switch per team with optimistic
  state, folded quiet activity, local times, back affordances, feedback prefill, and a mobile browser that
  can be typed into.
- **Local helper removal.** The helper app, its upload endpoint, the device flow, the pairing and reconnect
  columns, and the seeded OAuth client are gone.
- **Dependency audit.** Two reachable vulnerabilities fixed; 49 remaining records dispositioned in
  [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md).
- **Restore drill.** Passed 2026-10-29; procedure in the [deployment runbook](deployment.md).
- **Two test stalls.** Input readiness now comes from the live DOM, and shutdown awaits session teardown.
