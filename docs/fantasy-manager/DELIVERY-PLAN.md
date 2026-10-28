# Staged delivery and acceptance

Status: product decisions and independent repository/brand preparation are complete. The owner wants autonomous completion of Phase 1, with bounded internal slices rather than repeated owner assignments. [The execution mandate](../PHASE-1-HANDOFF.md) records GCP CLI setup authority and conditional deployment gates. Resolve feasibility at its owning slice; carry the coherent security fix as a pre-publication gate and preserve explicit billing, secure-access, framework-pin, and live-provider boundaries.

## Dependencies and scope

```text
0 readiness/feasibility
  -> 1 fresh baseline
  -> 2 linking + team discovery
  -> 3 query MCP + transaction review links
  -> 4 durable native lineup runs
  -> 5 minimal UI + scheduling + action-required email
  -> 6 authorized Cloud Run acceptance / Phase 1 launch
  -> 7 custom policy + solver + explicit-write acceptance
  -> 8 direct Phase 2 cutover

Future only: agent-tested transaction suggestions -> possible product workflow
```

Work in vertical red-green slices inside each stage, not all schemas followed by all repositories followed by all tests. An acceptance failure belongs at the earliest owning seam. Do not carry an unsupported feature forward as successful empty data.

## Stage 0 — Close readiness and feasibility gates

**Purpose:** establish the contracts needed by the next slice and explicitly track deferred readiness gates. The owner permits loopback-only local implementation while the coherent security fix is pending; this does not authorize exposing the vulnerable transport.

Tasks:

- Product name/destination: complete. The owner selected Lineupkeep at `/Users/graemefolk/Documents/Software/lineupkeep`; independent baseline and branding preparation are recorded in [setup provenance](../SETUP.md). No domain purchase or trademark clearance is implied.
- Keep the validated independent starter baseline for local implementation. Its release tracker forbids publication of the installed vulnerable Solid Start RPC closure. Track adoption of a coherent upstream fix and required security regression proof before Stage 6; do not stop every local slice while waiting or introduce an unauthorized backport/downgrade.
- Preserve the starter's pinned Effect, machine, auth, runtime, MCP, architecture/test, SSR, and frontend/server constraints. Presence of files is not proof of baseline readiness.
- Convert the known Yahoo evidence into small maintained contract cases. Do not depend on disappeared `/tmp` reports, copy old implementation code, or include real cookies/account data.
- Confirm supported NFL/NHL period/lock/roster rules and Yahoo's exact fantasy-day rollover. Verify bench versus total-roster capacity and same-roster reserve eligibility before final solver formulation.
- Verify hosted browser streaming and the local-helper fallback in bounded spikes. Do not assume the hosted agent's browser is the user's computer. The hosted browser is ephemeral, owner-bound, and egress-restricted; never expose arbitrary CDP remotely.
- Specify the proposed public seams in TESTING.md for approval with this plan. Technical implementation selection is the assistant's job; return only genuine product tradeoffs.
- Inspect current package/source/license options for exact weighted assignment/min-cost flow, lexicographic objectives, and runtime footprint. No dependency installation just to decorate a plan.
- Complete a quota worksheet for fresh Neon application data, protected Alchemy state, Cloud Run, Tasks/Scheduler, secrets, image storage, logs, and email. Check shared-account allocations before claiming free-tier fit.

**Exit for the next local slice:** approved name/path and bounded assignment, validated local baseline, necessary public seams and supported contracts, and explicit known gaps. The unresolved coherent security fix remains a Stage 6 publication gate, not a local entry condition. If a fact cannot yet be established, identify which later stage it blocks; Phase 2 scoring evidence need not block native Phase 1. No hidden permission to deploy.

## Stage 1 — Create the independent baseline

**Entry:** an explicitly assigned local implementation slice and the validated independent baseline, under the local-development decision above.

The independent copy, product identity, and unchanged-baseline validation are already complete. Do not recopy the starter or reinitialize history. Remaining platform/domain work proceeds in separate reviewed slices.

Tasks:

- Copy the approved starter without VCS metadata, dependencies, caches, build outputs, env/secrets, or resolved cloud resource references.
- Establish the successor's own version control and product identity. Leave both AutoCoach and rush-hour untouched.
- The unchanged baseline was validated; the example Notes feature is removed in its own reviewed change, and the first connections vertical replaces its test scaffolding.
- Keep registration, auth/OAuth/MCP, observability, runtime, email transport, frontend stack, and dependency boundaries where applicable. Do not rewrite working infrastructure because this is a ground-up domain rewrite.
- Establish one fantasy context with focused services, branded opaque IDs, generic period references, minimal domain schemas, expected errors, and test Layers. Do not add speculative multi-provider or multi-cloud frameworks.
- Record machine-state codecs and owner-filtered, batch-first persistence conventions. Start with real migrated storage tests.

**Exit:** baseline checks pass; no example Notes behavior remains; no old/starter resource identities or hardcoded owner; new tests prove failures before their implementations.

## Stage 2 — Local linking and exact team discovery

**Purpose:** establish the authenticated provider seam before rich tools or automated writes.

Vertical slices:

1. Start/expire/cancel a hosted browser linking session, with the local helper as fallback.
2. Complete one-use approved linking, validate provider session, and encrypt minimal credentials.
3. List safe connection metadata and reconnect/disconnect through the connection machine.
4. Discover exact NFL/NHL teams and persist stable identity/configuration; multiple teams in one league must coexist.
5. Refresh discovery, mark inaccessible teams unavailable without deleting settings, and keep new teams disabled.

Security/IO:

- Provider-specific extraction and Yahoo request construction stay private. All production Yahoo HTTP uses PublicInternet with exact authorization and scoped response consumption.
- Dedicated ephemeral browser workspace with owner-bound transport, restricted provider egress, no persisted recordings, and no secrets in commands/MCP/logs. The local helper keeps its dedicated temporary profile.
- Test wrong owner, pairing replay/expiry, tampered credentials, connection generation, missing ranks/statuses, non-editable rosters, and synthetic-provider structural differences.

**Exit:** safe query-only connection and team discovery work locally through the public seam; linking feasibility and account ownership are proven without code from AutoCoach. Adapter read endpoints and payload shapes were verified against the live provider on 2026-10-25; acceptance through the product's own linking seam remains open.

## Stage 3 — Query-first stateless MCP and transaction review links

**Purpose:** deliver the agent exploration surface before the optimizer.

Vertical slices:

- Compact connection/team/calendar discovery.
- Selected league settings/scoring, standings and matchup context.
- Exact rosters plus bounded selected-player hydration, actual stats/projections, availability, player search and free-agent/waiver pools.
- Read transaction history and generate typed add/add-drop/drop/trade review links.
- Add selection groups, UTF-8 byte/row budgets, whole-record continuations, narrowing-required outcomes, and safe per-resource failures.

Acceptance:

- Correct period/key validation, zero/missing distinctions, source freshness/coverage, and no unsupported aggregate claims.
- Native actual-protocol OAuth/scopes/ownership tests, request isolation, safe serialization, budget edge cases, and no submission-stage links.
- Harmless actual hosted-Muse read/consent experiment after endpoint deployment is separately authorized. If that cannot yet happen, record client compatibility as unproven rather than swap transport.

**Exit:** Phase 1 query tools and review-link generation pass local protocol contracts; no lineup or transaction writes are hidden in read/link operations. The tool surface stays generic and exposes no diamond/provider-specific projection selectors.

## Stage 4 — Durable native `set_lineup`

**Purpose:** establish the recovery shell before adding mathematical optimization.

Vertical slices:

- User-owned run creation, stable request identity, run-status reads, and atomic run/outbox persistence.
- Authenticated delivery, duplicate handling, per-team coordination, provider-aware bounded batching, and repair of undispatched/stale work.
- Native lineup action preparation, pre-write ownership/control/period/lock validation, provider invocation, and roster readback.
- Verified changed/no-op results versus pending, blocked, retryable, failed, and uncertain outcomes.
- Bounded manual MCP waiting that returns durable run references without canceling accepted work on disconnect.

Acceptance:

- Machine exploration, generated event sequences, row-codec round trips, migrated storage behavior, and the crash matrix in TESTING.md.
- Real local Postgres concurrency cases for duplicate workers, lease/generation changes, pause/disconnect races, and lost responses.
- Partial team failures in a provider/queue batch do not replay completed team writes.
- Native actions do not require every player editable, do not invoke premium optimization, and never submit transactions.

**Exit:** the provider-native action works through the full durable public seam against a behavioral provider fake. Any live write/readback test requires explicit owner authorization and must not inherit open-ended authority from past research.

## Stage 5 — Minimal frontend, hourly automation, and notifications

**Purpose:** complete the agreed operational Phase 1 product.

Tasks:

- Use Impeccable to design the product's operational UI on the starter stack, following the owner-approved royal violet and gold identity in the root DESIGN.md. The visual direction is settled; design the actual team/connection/run surfaces within it and keep the built system documented. Do not port Angular or invent marketing pages.
- Open passwordless registration/sign-in; teams and compact connections; enable/disable and rest-of-fantasy-day pause; last-run status and small inline activity.
- Schedule current-period eligible work hourly. Collapse missed ticks and reconcile unfinished writes; no future-horizon editing or historical replay.
- Implement provider-day pause expiry with Effect DateTime; test exact boundary, DST, weekly periods, and server/user timezone independence.
- Open one reconnect incident, retain enrollment, and enqueue one action-required notification. Reuse email delivery with a persistent logical idempotency identity for durable retry rather than a fresh identity on every recovery attempt.
- Retain outcomes/explanations for 30 days and minimal diagnostic inputs for seven; sweep expired copies through bounded scheduled cleanup.
- Include ordinary auth/email abuse controls and real queue/error recovery. Do not add an allowlist, invitation system, scoring controls, analytics dashboard, or transaction suggestions.

**Exit:** public service, browser failure/race, built SSR/hydration/auth, scheduled recovery, retention, and notification tests pass. No action is displayed successful merely because a request or queue submission returned.

## Stage 6 — Authorized GCP acceptance and Phase 1 launch

**Entry:** the autonomous mandate's destination/billing/budget, protected-state/access, origin/email, and publication-security gates are satisfied. Record and review the actual infrastructure plan within that authority; obtain owner approval for material scope/cost changes and separately scoped live-provider acceptance. Routine in-scope rollout steps do not require repeated owner supervision.

Proposed resources:

- Public web/MCP Cloud Run service and private IAM-protected worker; request-based billing and minimum zero.
- One small Cloud Tasks queue initially, a shared hourly Scheduler job, narrow invoker/enqueuer identities, and bounded concurrency/instance counts.
- Fresh Neon Free application database and protected remote Alchemy state with separate credentials/lifecycles. No existing starter database references.
- Minimal Secret Manager versions, a lean shared image/repository with cleanup, production transactional email/domain configuration, and privacy-safe bounded telemetry.

Acceptance:

- Review actual Alchemy resource plan, identity scope, state isolation, database retention/restore, trusted ingress headers, queue/Scheduler OIDC audience, callbacks/consent, secrets, and no deployment credentials in runtime.
- Confirm no current critical starter publication blocker and run the full required check/audit matrix; local greens are not cloud proof.
- Verify chosen cloud egress can use the linked Yahoo session without bypassing protections. Establish actual hosted-Muse OAuth/paging/pending-run behavior.
- Measure cold/warm end-to-end latency, initialization and database wakeups, CPU/memory, image size, connection counts, and usage under five-team hourly bursts. Model 100 teams as a test scenario, not launch usage.
- Confirm remaining shared free allowances. Report all expected nonzero items, including domain ownership or consumed pre-existing account allocations; do not call temporary credits a recurring free tier.
- Establish operator instructions for queue backlog, uncertain writes, reconnect, quota exhaustion, rollback, and protected state/database restore.

**Exit:** accepted Phase 1 product: rich generic queries, native `set_lineup`, review URLs, minimal UI, hourly queue execution, and action-required email. No custom optimizer or transaction execution. No promise that arbitrary public traffic cannot generate a bill.

## Stage 7 — Phase 2 pure policy/solver and explicit-write contract

**Purpose:** replace the old imperative optimizer without importing its implementation or fixture-led correctness strategy.

Vertical slices:

1. Agree concrete worked NFL/NHL policy comparisons under the accepted objective; establish meaningful provider evidence. Do not treat missing or non-informative fallback data as a working scorer.
2. Derive hard constraints from verified provider/sport/league rules, including pooled roster versus bench capacity, reserve moves, locks, and illegal existing rosters.
3. Implement the pure problem-to-plan solver through the approved seam. Use generated problems, an independent tiny exhaustive oracle, and exact lexicographic comparisons from the first slice.
4. Add opinionated availability-aware policies independently of the solver; no scoring controls, rank-required parsing, raw percentage/point mixing, injury double penalties, or positive sentinels.
5. Translate legal plans into provider-specific explicit assignment requests and verify readback/recovery. Scope changed editable assignments correctly; retain all roster members.
6. Complete representative failure cases and authorized minimal live acceptance for explicit writes. Validate source freshness and behavior when manual edits or lock changes race execution.

**Exit:** solver/oracle/invariant agreement, independent policy examples, actual useful scoring evidence, correct same-roster legality, exact write/readback and uncertain-outcome recovery. An inability to establish meaningful NHL evidence blocks NHL custom optimization readiness, not Phase 1 native action. Return a genuine policy tradeoff to the owner rather than inventing an unapproved fallback.

## Stage 8 — Direct Phase 2 cutover

**Entry:** Stage 7 acceptance is complete and deployment is approved. This is not a shadow product stage.

Tasks:

- Switch the generic `set_lineup` implementation and scheduled execution to custom optimization for eligible teams immediately when ready.
- Keep disabled/paused state, current-period scope, per-team coordination, pending/run-status behavior, and no-transaction restriction unchanged.
- Resolve queued fresh intents using the active implementation while reconciling already-started native attempts safely. Record actual policy/implementation per attempt.
- Verify version cutover and rollback do not overlap unresolved provider writes. Rollback changes future execution; it does not automatically restore historical assignments.
- Retain privacy/cost/latency observation and regression coverage, but do not require a new per-team opt-in or parallel shadow rollout.

**Exit:** Phase 2 automation uses the ground-up optimizer through the same generic interface and durable shell. No add/drop recommendation or execution has been added.

## Roadmap, not implementation

- Let agents explore public sources, players, statistics, and candidate transactions through MCP; evaluate whether the workflow actually produces useful suggestions.
- Record successful repeatable decision steps before deciding whether to productize them.
- Future recommendation workflows should compose with existing connections, query snapshots, policy provenance, run records, and human transaction-review links, rather than embed an LLM inside the solver.
- Further product decisions are required before server-side LLM use, transaction suggestions, cross-account feedback triage or analytics, new providers/sports, multi-period/category optimization, player pins, or transaction execution. None are silently included in these stages.
