# Provider-neutral fantasy manager: implementation plan

Status: product grilling and independent Lineupkeep repository/brand preparation are complete. The owner wants autonomous completion of all Phase 1 in bounded internal slices, with GCP CLI setup authority and conditional deployment under [the execution mandate](../PHASE-1-HANDOFF.md). A coherent upstream security fix remains a publication gate, not a blanket local-development stop. Billing/budget, secure access, framework-pin, and scoped live-provider gates remain explicit. All eight rounds of answers are preserved in [DECISIONS.md](DECISIONS.md).

## Read this first

- **Product:** independent provider-neutral fantasy management, not a Yahoo wrapper or migration of AutoCoach.
- **Phase 1:** query-first stateless MCP, one generic `set_lineup` mutation backed by native start-active, human transaction-review links, minimal rewritten frontend, hourly queued automation, and action-required email.
- **Phase 2:** a ground-up pure lineup optimizer, legal same-roster reserve movement, provider-specific explicit writes, and direct cutover when ready. No shadow product stage or new team opt-in.
- **Hosting:** Alchemy-managed Cloud Run + fresh Neon Free PostgreSQL. Public web/MCP and private IAM-protected worker both scale to zero. Expected launch: one user, five teams; 100 teams is a sizing/test scenario.
- **Initial integration:** Yahoo NFL/NHL. Other providers and sports are deferred, not built behind speculative interfaces.
- **Main architecture:** state machines coordinate; pure functions parse, score, validate, and solve. Provider/sport details stay out of the solver and public MCP method vocabulary.

## Detailed plan documents

| Document                             | Owns                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [DELIVERY-PLAN.md](DELIVERY-PLAN.md) | Stages 0–8, entry/exit criteria, rollout, explicit permission gates                                    |
| [ARCHITECTURE.md](ARCHITECTURE.md)   | Modules, data shapes, solver comparison, machines, durability, linking, security                       |
| [TESTING.md](TESTING.md)             | Proposed public test seams, TDD, independent solver oracles, generated/model-based tests, crash matrix |
| [MCP.md](MCP.md)                     | Generic tool families, bounded results, paging, authorization, client acceptance                       |
| [HOSTING.md](HOSTING.md)             | Platform comparison, accepted Cloud Run/Neon choice, quota/cold-start/cost work                        |
| [UX-BRIEF.md](UX-BRIEF.md)           | Minimal functional surfaces and later Impeccable design work                                           |
| [GLOSSARY.md](GLOSSARY.md)           | Agreed domain terminology, not implementation details                                                  |
| [RESEARCH.md](RESEARCH.md)           | Inspected source and primary documentation evidence                                                    |

## Accepted product rules

### Independence and scope

Fresh Effect domain implementation on a stable approved rush-hour baseline. Borrow API knowledge and lessons, not AutoCoach implementation code. Never migrate users, history, preferences, credentials, or secrets. Leave the old application intact.

No server LLM, agent-code runner, transaction execution, custom query language, arbitrary URL proxy, provider recommendations/premium optimization, or general-purpose hosted browser infrastructure. The scoped, owner-bound provider login browser in ARCHITECTURE §9 is the exception; it is not a proxy or CDP service. Transaction suggestions are roadmap only: use MCP as an agent experimentation ground first, then decide whether a demonstrated useful workflow belongs in the product.

### Generic contracts and data

All domain/MCP operations are provider-neutral and minimal for current use cases. Resolve the implementation from the relevant owned resource. No diamond/cohort API, provider-specific projection variants, speculative capability framework, or raw-response escape hatch.

Keep rich selected query data distinct from small optimization inputs. Statistics need meaning, units, period, actual/projected distinction, freshness, and missingness. Validate exact requested resources and nested coverage; HTTP 200 alone is not semantic success. Preserve inaccessible teams/configuration and distinguish read access to league opponents from management authority.

Provider adapters own request batching and period/day semantics. Minimize upstream API calls wherever support is verified; retain per-team outcomes and recovery even when teams share a provider request. The old Yahoo code issues one PUT per team despite accepting an array; it does not demonstrate a cross-team write endpoint.

### Opinionated optimization

Policies belong in provider/sport/league-appropriate layers. Prefer comparable projected points when usable; Yahoo's private fallback is diamond-manager started evidence. Do not mix raw percentages and points or invent missing scores. If useful evidence is absent, preserve affected choices and explain why. Zero is not missing.

Hard constraints describe legal destinations, roster capacity, reserve eligibility, and locks. Availability/real-world starting status is soft selection evidence, not an automatic exclusion. An injured/unconfirmed player can fill an otherwise empty slot; avoid double adjustments when projections already account for participation.

Objective order:

1. Respect legality and locked assignments.
2. Maximize total comparable signed selection value, empty starter slots worth zero.
3. Among equal-value results, prefer eligible zero-valued starter occupancy.
4. Minimize semantic assignment changes.
5. Deterministic final tie-breaking.

Negative starters lose to empty positions when legal bench accommodation exists. Every roster member is retained; no add/drop to repair an infeasible roster. Include legal same-roster reserve moves. Category leagues initially use a scalar heuristic, not category-matchup optimization. No user-facing scoring controls, now or on the roadmap. Baseball starter/reliever cases belong in future MLB policy tests, never sport branches inside the solver.

### Automation and manual actions

- New teams default to disabled. Disable is indefinite; enable enrolls in scheduled automation.
- Pause lasts only through the provider's fantasy-day end, including weekly leagues; then the next normal scheduled run may act. No special immediate resume run.
- Hourly scheduled execution targets the currently actionable provider period. After downtime, reconcile unfinished writes and collapse missed ticks rather than replay stale/historical edits.
- Enabled automation can replace unlocked manual assignments. Use pause for manual control; persistent player pins are deferred.
- Explicit one-off MCP actions may run while paused/disabled without changing enrollment. They still obey authorization, locks, connection/availability, and uncertain-write protection.
- Recheck controls immediately before writes. Already-sent requests may complete; reconcile without automatic undo/restore.
- `set_lineup` normally returns a verified result, or a durable run reference after bounded waiting. Disconnecting MCP does not lose committed work. Results identify native versus optimizer behavior.

### Connection, UI, and retention

Use a hosted browser as the primary linking/reconnect flow, with the user-local helper as fallback. The hosted browser is owner-bound, one-use, short-lived, and egress-restricted; it never exposes a general CDP endpoint or assumes the hosted agent's browser is the user's computer. No password collection in application data, credentials in MCP/frontend/logs/email, or persisted browser recordings. Store minimal provider session material encrypted and connection-scoped; all production Yahoo HTTP uses PublicInternet plus Yahoo-specific exact authorization.

Expired login suspends writes but preserves enrollment. Show reconnect-required and send one action-required email per unresolved connection incident, not per team/hourly run. No reminder campaign initially.

Minimal frontend on the starter stack, rewritten/redesigned with Impeccable: open passwordless email-code registration/sign-in, connections, teams, enable/disable/pause, last-run status, and small inline recent activity. No allowlist/invitation gate, old Angular port, feedback/about pages, transaction suggestion UI, or analytics dashboard.

Retain concise outcomes/explanations for 30 days, minimal normalized diagnostics for seven days, and no raw provider dumps by default. Enforce deletion across all copies rather than hiding expired data behind soft deletion.

## Recommended technical decisions for review

These implement the accepted rules but have not been separately approved:

- Use the starter's existing Effect-machine conventions, with provider connection, team automation, and lineup-run snapshots/row codecs.
- Use short transactional transitions, an enqueue/notification outbox, and Cloud Tasks, not a custom workflow engine or durable in-memory fiber.
- Use per-team coordination, stored write intent, bounded pre-write revalidation, and reconciliation. A lease/fencing token cannot guarantee exactly-once writes to an external provider that does not honor it.
- Prefer min-cost flow when verified pooled standard-roster limits require it; Hungarian assignment only when the problem truly reduces to independent slots. Select a small audited dependency through a bounded spike; no from-scratch solver by default.
- Use Effect DateTime named-zone calendar arithmetic without spacetime/Temporal dependencies unless a demonstrated gap requires one.
- Reuse Postgres/auth/email/runtime patterns, but create this product's own resources and add stable notification identity for durable retry.
- Keep a lean request-billed Cloud Run image, min instances zero, no keep-warm pings, and measured startup/concurrency/database wakeups. Do not inherit the starter's current min-one/instance-billing settings.

## Delivery summary

| Stage | Deliverable                                                                              |
| ----- | ---------------------------------------------------------------------------------------- |
| 0     | Ready/fixed starter, name/path approval, contract and feasibility gates                  |
| 1     | Independent validated baseline; Notes demo removed, connections started                  |
| 2     | Hosted browser linking with helper fallback, encrypted connections, exact team discovery |
| 3     | Generic rich-query MCP and safe transaction-review links                                 |
| 4     | Durable native `set_lineup`, verified/pending results, recovery                          |
| 5     | Minimal UI, hourly scheduling, action-required email, retention                          |
| 6     | Separately authorized Cloud Run/Neon acceptance and Phase 1 launch                       |
| 7     | Pure policy/solver with independent proof and explicit-write acceptance                  |
| 8     | Direct Phase 2 cutover; no transaction suggestions/execution                             |

See DELIVERY-PLAN.md for each stage's tasks and acceptance evidence.

## Outstanding facts and approval gates

1. **Starter publication blocker:** the inspected local `docs/release-readiness.md` explicitly reports a critical Solid Start RPC vulnerability and forbids publication of the installed closure. This is a local tracker observation, not an independent fresh advisory audit. The owner permits local implementation on the validated pinned baseline while awaiting a coherent fix; adopt and accept it before publication. Keep the vulnerable transport loopback-only, without public tunnels; no unauthorized workaround.
2. **Provider contracts:** confirm Yahoo fantasy-day rollover, bench/pool/reserve rules, meaningful NFL/NHL scoring evidence, and live explicit-assignment write/readback before the relevant stages. Earlier all-zero diamond samples do not prove usable fallback quality.
3. **Client/browser/helper/cloud:** verify hosted Muse OAuth/paging/pending-run behavior, hosted browser streaming and local-helper pairing feasibility, cloud egress/session compatibility, IAM, cold starts, and actual free-allowance availability. No new live Yahoo probes were performed in consolidation.
4. **Identity — complete:** the owner selected Lineupkeep, its independent directory, and the royal violet and gold visual direction. No domain purchase, trademark clearance, or production origin is implied.
5. **Authority:** the [autonomous handoff](../PHASE-1-HANDOFF.md) records the owner's subsequent whole-Phase-1 assignment and GCP CLI setup permission. Review technical seams as implementation work, not a repeated owner-approval ritual. Resolve the remaining billing/security/access/live-provider gates before the affected external action; earlier research authorization does not carry forward.

The product-question frontier is settled. Reopen questions only for genuine unresolved tradeoffs or facts that invalidate these choices—not to make the owner choose routine implementation details.
