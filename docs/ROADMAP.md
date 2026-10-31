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
| MCP surface          | 17 tools, seven scopes, per-tool enforcement; feedback rounds 2 to 8 closed                    |
| Client feedback      | Zero open items                                                                                |
| Connections          | Hosted browser only; local helper and device flow deleted                                      |
| Interface            | Reworked from the owner walkthrough; a bolder direction is a later exploration                 |
| Deployment           | Cloud Run web, worker and hosted browser on GCP; no repository remote and no CI                |
| Publication gate     | Blocked on upstream: a temporary backport of the TanStack advisory is in force                 |
| Restore              | Drill passed 2026-10-29; retention, RPO/RTO and recovery owner undecided                       |
| Dependencies         | Fresh audit and disposition in [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md)                      |
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

The Effect spans and annotations from the starter should already exist. This is a tracer provider, not new
instrumentation.

- [ ] Confirm the spans and annotations are present and useful in the worker, the web app and the hosted
      browser before adding anything.
- [ ] Inject a tracer that exports them to Cloud Logging in a queryable format.
- [ ] Document the queries worth knowing in the deployment runbook.
- [ ] Add an alert on failed and uncertain runs.

**Verify**: a known run id is found in Logs Explorer with its provider operations, and a deliberately
failed run raises the alert. `S`

Shipped and deployed: spans export as structured JSON with Cloud Run's trace id, and the alert policy
`Lineupkeep failed or uncertain lineup runs` is enabled. Reading the result showed the shape is wrong, so
group D replaced the span-per-line writer with real traces and one wide event per unit of work.

---

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
`type=date`, and `search_players` uses it only for date-covered leagues; the shapes tried are recorded
in [RESEARCH.md](fantasy-manager/RESEARCH.md#pool-player-schedule-shapes-2026-10-31). The summary
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

The container appears to live about fifteen minutes after each hourly wake, which is paid compute for no
work.

- [ ] Find what keeps it alive: CPU always allocated, a long-lived connection, or a keepalive setting.
- [ ] Review memory and CPU against real usage, and concurrency against real traffic.
- [ ] Review the worker's minimum instances, and whether the hosted browser should scale to zero.
- [ ] Record the monthly cost per service so any change can be judged.

**Verify**: measured idle time and cost after the change, with no latency regression on a real request. `S`

### B2 — Skip runs that cannot do anything

- [ ] Return early only when the cached calendar says no rostered player has a game before the next tick
      **and** that date was observed after the fantasy day began.
- [ ] Fail open: an unknown, stale or incomplete calendar runs as usual, and a manual `set_lineup` bypasses
      the gate.
- [ ] Record a skipped outcome with its reason.

**Verify**: a fixture whose game moves into today after the sweep proves the run happens, because a wrong
skip is worse than a wasted read. Measure the request saving over a real week. `M`, depends on F1.

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

Every chunk pays this, currently two to four minutes.

- [ ] Measure per-project and per-file timings and name the long poles. A first attempt restructured the
      entry point into parallel steps without changing what dominates; it measured 142 s against a 128 s
      baseline and was reverted. The test step is roughly 124 s of that, so the work is inside the suite.
- [ ] Cut what is measurable: redundant builds, repeated setup, work that could parallelise.
- [ ] Keep the discipline: no retries, no skips, no inflated timeouts.

**Verify**: measured before and after, same suites, same counts. `M`. Note that the entry-point work is
already done and did not help; the remaining gain has to come from the node project itself.

---

## D. Wide events and real traces

The owner read the production logs and found them fragmented: a request arrives as dozens of separate
single-line entries instead of one wide event. That is a fair reading of what we shipped. Each completed span
was written as its own log line, so the shape is span-per-line rather than one event per unit of work, and
nothing reached Cloud Trace as a trace.

The intended shape is a canonical wide event per request and per lineup run, with every attribute the work
touched inside it, plus real spans in Cloud Trace for the parts worth a waterfall.

### D1 — Send spans to Cloud Trace, not to the log

- [x] Export through OTLP to Google Cloud's Telemetry API rather than hand-writing span lines to stdout.
      Cloud Trace accepts OTLP directly, so this removes our bespoke writer instead of adding to it.
- [x] Keep the existing Effect spans and attributes as the source; this changes the exporter, not the
      instrumentation.
- [x] Confirm a request appears as one trace with a service waterfall, and that a lineup run's provider
      calls appear as child spans of the run.
- [x] Check what Alchemy already provides before writing an exporter by hand; if the stack can inject the
      telemetry configuration, prefer that over application code that hard-codes endpoints.

**Verify**: a real request and a real lineup run viewed as traces in Cloud Trace, with the provider children
attached. `M`

Shipped: the Cloud Run host injects the OpenTelemetry environment and the runtime account holds
`roles/telemetry.tracesWriter`; the exporter mints its token from the metadata server. Effect's own OTLP
exporter writes protobuf to `telemetry.googleapis.com`, and Alchemy has no Cloud Run telemetry binding to
inject instead. The first real worker request trace held 318 spans, with `YahooProvider.readLeague`,
`YahooProvider.readRoster`, `YahooProvider.readPlayerHistory`, and `PublicInternet.request` under each
`LineupWorker.run`. A request exported before the IAM grant propagated was lost, which is the expected
telemetry-never-fails-a-request behaviour.

### D2 — One wide event per request and per run

- [x] Emit a single structured log entry per HTTP request and per lineup run, carrying the request id, the
      route or tool, the actor, the connection and team, the counts that matter, the durations, the outcome,
      and the trace id, so a person reading logs sees one line per unit of work instead of a dozen.
- [x] Keep the existing redaction and suppression rules; a wide event must never carry a token, cookie,
      crumb, note body, email address or provider payload.
- [x] Decide what stays a separate line: genuinely exceptional errors, and anything outside a request, such
      as startup and shutdown.
- [x] Keep the failed-run alert working from the wide event rather than from a span line.

**Verify**: one grep for a request id returns exactly one log entry, and its trace id opens the correct trace.
`M`

Shipped: the aggregation is a tracer over the exported spans, so there is no second instrumentation path.
`event.kind` distinguishes a request from a run, and the alert filter moved to `event.kind` plus
`event.outcome`. Transport statement detail is kept in the trace children rather than merged into the entry.

### D3 — Retire what this replaces

- [x] Remove the bespoke span-to-stdout writer and the tests that pin its shape.
- [x] Update the runbook queries, which currently describe span lines.

**Verify**: no span-shaped log line remains, and the runbook's queries still find a run. `S`

Shipped: `CloudLoggingTracer` and its test are gone, replaced by `WideEventTracer`. A five-run worker tick
wrote 377 span lines before and writes six wide events now.

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

### F1 — Cache the professional-team calendar

- [ ] **decide** the source: derive from our own roster reads, or add an external schedule for a whole
      season with start times. Recommendation: derive first, add an external source only when a feature
      needs every team or a full season.
- [ ] **Never join on an abbreviation.** Roster rows carry a professional-team key, observed as `nhl.t.26`.
      League abbreviations differ from the provider's (`LAK` against `LA`). An opponent arrives only as an
      abbreviation, so its key comes from observed key/abbreviation pairs, and an unknown abbreviation
      stays unresolved rather than guessed.
- [ ] Persist what the reads already see, with an observation instant, so the calendar grows from normal
      work and adds no upstream contract.
- [ ] Sweep the current period daily, not hourly, and after a provider-day rollover.
- [ ] Publish coverage: games beyond the current period, games remaining, and a postponed signal once the
      cache covers them, each stating when it was observed.

**Verify**: one week of live reads match the direct provider read for every rostered player's dates,
opponents and home or away; a postponed game stays unresolved until an observed case proves the marking.
`L`. See [DECISIONS.md round 13](fantasy-manager/DECISIONS.md).

---

## G. Provider boundary and simplification

### G1 — Stop provider-shaped ideas leaking into generic code

Weekly versus daily coverage, league types, waiver shapes and stat quirks are provider facts. A second
provider must not require editing generic modules.

- [ ] Audit every generic module — lineups, queries, runs, policy — for provider-shaped concepts.
- [ ] Express each as declared capability data beside the existing table.
- [ ] Extend the boundary audit and ADR 0007 with what is now enforceable.
- [ ] Keep the dependency rule that rejects an adapter import outside the composition root.

**Verify**: a deliberate violation is rejected, and adding a fake provider with different coverage and
league types requires no edit outside the provider. `M`

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

- [ ] Read-only: does the league transaction feed publish pending trade proposals, and what does the trade
      review setting actually permit.
- [ ] Only then, one write on one league, reported before anything is built on it.

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

- [ ] Grouped by team, with a quiet section for teams that have nothing proposed.
- [ ] The reason beside each move, and the drop beside the add so a swap reads as one decision.
- [ ] Reversible and irreversible actions do not look alike: a waiver claim spends FAAB and cannot be
      undone; a trade involves another person.
- [ ] Checkboxes to include or exclude, then one submit. Works on a phone first.

**Verify**: a six-team proposal set reviewed on a phone-sized viewport, with a stale item and an excluded
item both behaving correctly. `M`

### H4 — Execution

- [ ] Writes through the provider's transaction endpoint, using the session and crumb the lineup writer
      already uses.
- [ ] Per-item outcome, recorded. No silent retry: a retried add can drop the wrong player.
- [ ] One team failing never hides the others.

**Verify**: a real add and drop on a disposable league, with per-item outcomes and the provider's own
transaction feed agreeing. `M`

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

- [ ] Threat model the whole surface: sign-in, sessions, the hosted browser, the MCP server and its OAuth
      issuer, the worker, and the database.
- [ ] Review dynamic client registration for abuse, and per-tool scope enforcement.
- [ ] Review encrypted credential storage, key handling and rotation.
- [ ] Inventory personal data actually stored, where it lives, and how long it lives.
- [ ] Review the address-based egress policy and the hosted browser's blast radius.
- [ ] Review rate limits, logging hygiene, and what a compromised worker could reach.

**Verify**: written findings with severities, each fixed or accepted with a reason, and a re-test per fix.
`L`, split into audit and remediation.

---

## K. MCP client contract

Standing friction with the external client, and the verification gap that let it persist.

### K1 — An MCP acceptance command

Scope problems have been argued from two sides without a shared test. Make them testable.

- [ ] A command that registers a client against a chosen origin, runs the full authorization flow, and
      asserts per-tool scope enforcement for each tool and each scope subset.
- [ ] Prove both directions: a restricted grant reads what it should and is refused on exactly the tools
      it lacks, with the refusal naming the scope.
- [ ] Run it against the deployed origin as part of accepting any MCP change, and add it to the verify
      skill so it is not ad hoc.

**Verify**: the command exercised against a local instance and the deployed origin, with a recorded pass
for a full grant and for a reduced grant. `M`

### K2 — Reduce the scope set

Seven scopes is more than the product needs, and a client holding a subset has hit repeated friction.

- [ ] Map every tool to the scope it truly needs and find scopes that can merge without weakening
      enforcement.
- [ ] Keep `offline_access`: it is the OAuth scope that asks for a refresh token, and without it an
      unattended agent must re-authorize constantly.
- [ ] Fix the metadata inconsistency where the protected-resource document omits `offline_access` while the
      authorization-server document lists it.
- [ ] Document the resulting set for client authors.

**Verify**: K1's command passes for the reduced set, and each tool's required scope is unchanged in
practice or weaker with a stated reason. `M`, depends on K1.

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

- [ ] Map the first-run path from landing to a connected, enabled team and count the steps.
- [ ] Place the Google-account workaround where someone actually gets stuck, not only on the connections
      page.
- [ ] Make progress states truthful about what is not automated until a connection succeeds.
- [ ] Reduce what a first-time user must understand before value.

**Verify**: a first-time user reaches a connected team without help, with the step count measured before and
after. `M`

---

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

| ID  | Decision                                                             | Blocks |
| --- | -------------------------------------------------------------------- | ------ |
| D1  | Staging model for CI: long-lived or per-branch                       | C1     |
| D2  | Cloudflare split, or make GCP cold start good enough                 | E2     |
| D3  | Schedule cache source: derived from our reads, or external           | F1     |
| D4  | Retention, RPO/RTO and recovery owner                                | N1     |
| D5  | Rename to lineupgrade, and when                                      | O1     |
| D6  | Solver direction: positional scarcity first, or category-aware first | M1, M2 |
| D7  | ~~Transactions read-only or executed~~ settled: group I owns it      | —      |
| D8  | Reserve-slot eligibility: per-player, or per reserve position        | A7     |
| D9  | Passkeys as a sign-in option                                         | future |

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
