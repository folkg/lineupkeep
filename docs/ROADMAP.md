# Roadmap

Long-term work for Lineupkeep. Phases 1 and 2 are deployed; this file tracks what remains, grouped so one
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

| Area                 | State                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Phase 1 (stages 0–6) | Complete, deployed, live-accepted                                                              |
| Phase 2 (stages 7–8) | Complete, deployed, hourly automation verified                                                 |
| Lineup algorithm     | Custom solver live for all five owner teams                                                    |
| Provider boundary    | Keyed injection at the composition root; some provider-shaped ideas still reach generic layers |
| MCP surface          | 20 tools, four resource scopes, per-tool enforcement; feedback rounds 2 to 8 closed            |
| Client feedback      | Zero open items                                                                                |
| Connections          | Hosted browser only; local helper and device flow deleted                                      |
| Interface            | Reworked from the owner walkthrough; a bolder direction is a later exploration                 |
| Deployment           | Cloud Run web, worker and hosted browser on GCP; no repository remote and no CI                |
| Publication gate     | Blocked on upstream: a temporary backport of the TanStack advisory is in force                 |
| Restore              | Drill passed 2026-10-29; retention, RPO/RTO and recovery owner undecided                       |
| Dependencies         | Fresh audit and disposition in [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md)                      |
| Security             | Audit and disposition in [SECURITY-AUDIT.md](SECURITY-AUDIT.md); deferred work is group J      |
| Checks               | 1339 node, 89 browser, 9 chromium; end to end 52 per target                                    |

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
no client used it. Pool rows carry games remaining only when `includeGames` is requested. The summary
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

There is no remote and no CI. Staging, dual deployments and review workflows all wait on this.

- [ ] Create the repository and push the history.
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

The provider publishes no season or team schedule; the only schedule fact is one opponent per rostered
player per date or scoring week.

### F1 — The professional-team calendar

**The source decision is settled** ([SCHEDULE-SOURCES.md](SCHEDULE-SOURCES.md), [ADR 0011](fantasy-manager/adr/0011-observed-facts-and-schedule-sources.md)):

- Cache what our own reads already publish, as observed facts with a per-fact refresh policy. Caching is what
  makes the reads efficient — up to 360 provider reads a day for the same answers becomes five.
- Add the **NHL's own API** (`api-web.nhle.com`) as the first external source, for start times, venues, a
  horizon beyond the current period, and postponement state. It is free, keyless, one 100 KB request per
  league week, and its `robots.txt` allows the site with `use=reference`.
- **Do not use Yahoo graphite** without written permission: it is technically the best candidate and Yahoo's
  Universal Terms of Service prohibit both the automated collection and the database it would create.
- **Do not add an NFL source yet.** The provider's own opponent fact answers the automation question. If a
  feature needs one, TheSportsDB at $20/month is the cheapest licensed option, and that cost is stated before
  it is recommended.
- **Never join on an abbreviation.** Roster rows carry a professional-team key, observed as `nhl.t.26`. League
  abbreviations differ from the provider's (`LAK` against `LA`). A mapping comes only from a pair the provider
  publishes on one roster row, is scoped to its league, is one-to-one or is unused, and an unmatched team stays
  unresolved rather than guessed.

### F1.1 — Observed-facts store and read view

- [x] Add the observation store: subject, fact kind, the window it covers, value, observation instant,
      source, confidence (`authoritative` / `corroborated` / `reported`), and the upstream reference.
- [ ] Add the read view that reports a disagreement between two authoritative observations as a conflict; the
      current read takes the stored newest observation and cannot reconstruct a disagreement.
- [x] Keep one row per source, subject, fact kind, and window, and prune windows that ended more than 30 days
      ago.

**Verify**: a fixture that changes value leaves one row with the newer observation, an older observation cannot
replace it, and retention removes a window after 30 days. Conflict reporting remains open. `S`.

### F1.2 — Record the provider's own schedule facts

- [ ] Record the opponent fact the roster reads already publish, one observation per fantasy team per date,
      with the fantasy-day maximum age.
- [ ] Serve the schedule window from the store, refreshing once per fantasy day per linked team instead of
      once per automation tick.

**Verify**: a week of live reads matches the direct provider read for every rostered player's dates, opponents
and home or away, and the request count over the same week is recorded. `M`.

### F1.3 — Professional-team identity from provider-published pairs

- [ ] Store the canonical professional team on the provider's key, with the league and the display
      abbreviation kept as display text only.
- [ ] Attach a source identifier only through a key/abbreviation pair observed on one roster row, recorded
      with its source and instant; scope it to the league and refuse a one-to-many mapping.
- [ ] Leave an unmatched source team unresolved and unserved for any canonical team.

**Verify**: a deliberate one-to-many mapping is refused, and an unknown abbreviation produces no canonical
team. `S`.

### F1.4 — The fact hook and the source registry

- [ ] Add `Facts.require({ subject, fact, window, maximumAge })` returning the fact with its observation
      instant, source, confidence, and window, or a named refusal.
- [ ] Add the `FactSource` registry injected at the composition root, with declared sport coverage, fact
      kinds, horizon, and request budget. No generic module names or imports a source.
- [ ] Move the existing schedule reads onto the hook, so a caller asks for a fact and not for a read.

**Verify**: a fake source with different coverage and horizon needs no generic edit, and the provider adapter
is the only module that names the provider. `M`.

### F1.5 — The NHL external source

- [ ] Add the `api-web.nhle.com` source: the league-week read for start times, venue and status, and the
      team-season read for the fixture skeleton.
- [ ] Ask for a concrete season id, never the `/now` alias, which redirects and is refused by our egress
      policy.
- [ ] Decode the status field so an unrecognised value is `unknown`, never `on`, and an empty games array is a
      fact while a missing one is a fault.

**Verify**: one live week matches the league's own page for every NHL team's dates, start times, venues and
home or away, and the request count for a week is recorded. `M`, depends on F1.1, F1.3, F1.4.

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

The current review links do not work. Yahoo's add page ends in a form submission a deep link cannot perform,
so it lands on a page whose only working action is Cancel, and the Yahoo app claims `*.yahoo.com` on mobile
before a browser sees it. No link we construct survives either.

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
- [x] **decide** trade staging: no. The provider publishes no parameterized trade proposal page, its
      write shape is unproven, and a staged trade has no review link that can act on it. Trades stay
      read-only and link out; incoming offers stay read-only.

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

### I2 — Migrate Lineupkeep

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

- [ ] Cap live dynamic registrations and age out ones that never completed an authorization.
- [ ] Make the scope-widening update set-based instead of loading and rewriting every row.
- [ ] Add one owner-scoped erasure routine and one owner-scoped export over the tables in the audit's
      inventory, in transaction order, with the cascade gaps closed.
- [ ] Sweep `session`, `verification`, `oauth_consent`, `hosted_linking_sessions`, and `uncertain` runs once
      they have a resolution.

**Verify**: an erasure leaves no row carrying the owner id anywhere in the database, an export round-trips,
and a registration loop is refused at the cap. `L`, split registration from erasure before delegating.

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

- [ ] Instrument refresh-token use around a deploy and find whether the strict rotation plus a cold-start
      failure is what ends the grant.
- [ ] If so, widen the reuse window and document the behaviour instead of leaving clients to rediscover it.
- [ ] Prove it by holding a grant across a deploy with a client that retries.

**Verify**: the same grant serves requests before and after a deploy with no re-authorization. `M`

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

- [ ] **decide** retention window, recovery point and time objectives, and who executes recovery.
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

## Q. Standing loops

### Q1 — Client feedback

Not a project. External clients file findings through the product; triage them, fix what is real, and record
why anything is declined. Currently zero open.

---

## Decisions needed from the owner

| ID  | Decision                                                                                                               | Blocks |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------ |
| D1  | Staging model for CI: long-lived or per-branch                                                                         | C1     |
| D2  | Cloudflare split, or make GCP cold start good enough                                                                   | E2     |
| D3  | ~~Schedule cache source: derived from our reads, or external~~ settled: cache our reads, NHL API external, no graphite | F1     |
| D4  | Retention, RPO/RTO and recovery owner                                                                                  | N1     |
| D5  | Rename to lineupgrade, and when                                                                                        | O1     |
| D6  | Solver direction: positional scarcity first, or category-aware first                                                   | M1, M2 |
| D7  | ~~Transactions read-only or executed~~ settled: group I owns it                                                        | —      |
| D8  | Reserve-slot eligibility: per-player, or per reserve position                                                          | A7     |
| D9  | Passkeys as a sign-in option                                                                                           | future |

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

- **MCP client feedback, rounds 2 to 8.** Per-tool scope enforcement, review links, restricted-client
  feedback, roto standings, search row fields, team summary coverage and paging, feedback read-back, hockey
  date windows, compact standings, inlined stat names, two-sided trades with picks, draft history,
  scoring-versus-informational categories, injury status on search rows, transaction rules, per-date
  schedules, and per-team acquisition usage. Resolution notes are in the feedback table.
- **Provider review links.** They do not work in practice: the provider's add page ends in a form
  submission a link cannot perform, and its mobile app claims the domain before a browser sees it. Group H
  replaces them.
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
