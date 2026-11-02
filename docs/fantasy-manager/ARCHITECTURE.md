# Technical architecture

Status: recommended implementation design for final review. Product decisions are recorded in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). This document does not authorize implementation or deployment.

## 1. Design in one sentence

A provider-neutral fantasy domain owns validated reads, connections, team controls, and durable lineup runs; explicit state machines coordinate IO, while a pure assignment solver consumes a small sport/provider-agnostic problem prepared by opinionated selection policies.

```text
Hosted Muse / other MCP clients       Browser
              \                       /
               Public Cloud Run application
                  |             |
          public use cases      | bounded wait / run status
                  |             |
             Neon PostgreSQL: users, connections, teams, controls,
                     run snapshots, diagnostics, delivery outbox
                                  |
                    Cloud Tasks, authenticated delivery
                                  |
Cloud Scheduler ----------> Private Cloud Run worker
                                  |
                     provider batch planning / execution
                                  |
                 PublicInternet -> exact approved provider endpoints

User's browser: hosted browser -> provider's own login page
              -> encrypted server persistence
```

Both Cloud Run services scale to zero. MCP transport remains request-scoped/stateless; domain work is durable independently of an MCP connection. No server LLM, hosted browser, Redis, continuously running scheduler, optimizer sidecar, or custom durable-workflow platform is required.

## 2. Modules and seams

Start with one fantasy domain context containing focused public services for connections, queries, team automation, and lineup runs. Do not invent multiple bounded contexts simply because there are three machines. Split ownership only when actual independent responsibilities justify it.

Follow the starter's placement, Schema/Effect errors, Layers, row codecs, repositories, machine helpers, architecture checks, runtime, and browser/server contracts. Public services and repositories are batch-first; single callers pass one-element collections. Provider-specific transport chunking stays inside its adapter. Set-based persistence must not become per-team repository calls in a loop.

Internal roles:

| Module            | Interface responsibility                                                                                                                               | What stays hidden                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Connections       | Link through the hosted browser, list safe metadata, reconnect/disconnect                                                                              | Cookie formats, secret versions, account fingerprints                |
| Fantasy queries   | Discover teams/leagues, read selected roster/player/stat/matchup/history data                                                                          | Provider endpoints, nested parsing, hydration strategy               |
| Team automation   | Enable, disable, pause through fantasy-day end                                                                                                         | Persistence and expiry mechanics                                     |
| Lineup runs       | Request, inspect, execute/reconcile a run                                                                                                              | Queue, leases, provider writes, retry mechanics                      |
| Provider adapter  | Interpret provider facts/rules, declare capabilities, publish a final score per player and opaque provenance, and perform bounded supported operations | Yahoo keys, T/Y, crumb, XML, web-link parameters, scoring arithmetic |
| Lineup planning   | Turn a provider's scores and declarations into the solver's neutral problem                                                                            | No period, sport, provider, or scoring-rule knowledge                |
| Assignment solver | Return the best legal complete assignment or infeasibility                                                                                             | No network, clock, provider, sport, or player-name logic             |

This is a responsibility map, not a mandate for one file or class per row. Keep small related functions together. A production Yahoo adapter and deliberately different synthetic test adapter justify the provider seam; no runtime plugin-loading system, speculative ESPN adapter, or arbitrary request language. Providers do declare capability facts (fantasy day, supported sports, search sorts, whether a weekly search order can be explained, statistic periods, the schedule-read bound, whether they publish projections, and named limitations) because generic layers must render and enforce them without branching on a provider name or on a sport literal. They do not declare how they construct a score: a provider publishes one final score per player and an opaque provenance label, and its scoring modules stay inside the adapter ([ADR 0009](adr/0009-provider-score-ownership.md)).

## 3. Domain data: three shapes, not one giant player object

### Provider decoding

Decode unknown responses at the adapter. Validate the exact requested resources, season/period, membership, and actual/projected distinction. An HTTP 200 with a different period or no meaningful rows is not a valid zero dataset.

Use provider-specific schemas privately. Preserve missing values, distinguish zero, and do not require ranks merely to admit a player. Do not default unknown injury status to healthy. Discover exact teams; do not select only one team per league or skip a roster just because it is uneditable.

### Query data

Return only explicitly selected generic fields/groups, with compact defaults. Useful groups include identity/eligibility, availability, actual statistics, projections, ownership, and scoring context. A self-describing statistic needs its name, unit, period, actual/projected meaning, and missingness. Share metadata dictionaries within a page instead of repeating large descriptions per value.

No public diamond/cohort selectors, provider-specific projection variants, raw Yahoo payload escape hatch, arbitrary URL field, or unbounded JSON extension bag. Support current use cases, not every hypothetical provider field. Do not reduce rich MCP exploration to the optimizer's tiny input.

Opaque application references resolve provider keys internally. Stat references can be opaque and dictionary-described; do not claim arbitrary provider statistics have identical cross-provider semantics. Opponent/public-league reads require verified read access through the caller's connection; they do not confer management rights.

### Optimization problem

An immutable problem contains only player references, starter/reserve slot capacities and meaningful identities, pooled standard-roster limits, legal bench accommodation, current assignments, legal destination edges, fixed assignments, a common signed-value basis, and deterministic tie metadata. The shell supplies time-dependent facts before invoking the pure core.

Reserve eligibility is a legal constraint. Participation/injury/real-world starting status is policy evidence, not automatically a prohibition on starting. Scoring evidence is never exposed as provider-specific methods in the shared interface.

Preserve every roster member. An empty starter is allowed; dropping a player or fabricating bench/reserve capacity is not. If no complete legal same-roster assignment exists, return a blocked explanation rather than quietly removing players or submitting a knowingly invalid roster.

## 4. Provider and policy resolution

Resolve the owner and connection from stored team identity, then its provider implementation from an injected registry keyed by provider key ([ADR 0007](adr/0007-provider-registry-and-planner-capability.md)). `runtime/ApplicationLayer.ts` is the only module that imports an adapter; a dependency-cruiser rule rejects any other import of a provider directory. Select policy using sport, league format/rules, target period, and available evidence—not provider name alone. The [provider boundary audit](PROVIDER-BOUNDARY-AUDIT.md) records every provider-specific fact that was found and where it now lives.

Yahoo is the only initial live adapter, for NFL/NHL. Different providers may batch differently and define different periods/day boundaries. The generic operation remains the same; no public methods for provider entitlement checks or scoring cohorts.

Phase 1 `set_lineup` invoked the native lineup action. Phase 2 requests `custom_policy` for scheduled and manual generic runs ([ADR 0008](adr/0008-refusal-kinds-and-planner-cutover.md)). The provider decides per team whether it can score that league: a structural refusal falls back to the provider's native action with the reason recorded, and a transient refusal blocks with a named reason. Report `provider_native` versus `custom_policy` behavior and the implementation version in safe results. A native invocation is not an optimum guarantee and does not enforce the custom optimizer's signed-value objective.

Scoring is a provider capability: `provider.scoreRoster` receives neutral facts and returns one final score and availability tier per roster player, or a named refusal whose kind is `structural` (this league can never be valued here, so fall back) or `transient` (not from the facts available now, so block). The generic planner turns those scores into explicit assignments. The generic worker owns the durable run machine, per-team serialization, observation, write intents, sending and readback, reconciliation, outcomes, retries, and the native fallback. It knows no value sources, scoring periods, sports, or provider vocabulary.

Queued requests express intent, not a permanently selected algorithm. Resolve the active implementation when claiming fresh work; re-stamp runs that have written nothing, and resume readback for a run with a write in flight instead of re-planning it. Persist the selected version for that attempt. Do not reinterpret an already-sent write after a deployment. Never overlap a replacement optimizer write with an unresolved prior write. The run records the requested implementation and its version; each attempt's write intent stores the plan that actually ran, including whether it used the provider-native action or explicit assignments and the provenance or refusal. Rollback changes future execution only; it does not restore historical assignments.

### Selection values

- Score construction belongs to the provider. Its ladder prefers the league's rules applied to realised statistics, then the ownership composite for a games-limited league, then the published community start rate, then a named refusal with a remedy. A provider contributes only the candidates it can support; generic code receives one final score per player and an opaque provenance label.
- Never compare raw projected points with raw percentages. Use one consistent basis for the relevant decision.
- Zero is valid; missing is not zero. Do not synthesize an ownership fallback or a positive sentinel without an explicit policy decision.
- If evidence is incomplete, use the agreed fallback consistently. Where no comparison is possible, preserve affected assignments and report incomplete evidence; do not claim a globally optimal full-team result. An unselectable value source is a refusal, never an Effect defect.
- Avoid double injury penalties when the provider's own score already includes participation assumptions.
- Participation is an availability tier the objective orders above value, never a multiplier: a confirmed starter outranks an unconfirmed player, an unconfirmed player outranks a confirmed backup goalie, and a player with a game outranks one whose team is not playing. A lower-tier player still fills an otherwise empty position.
- Category leagues initially use a scalar heuristic, not category-win optimization. No user-facing scoring controls. League format arrives as a provider-declared fact, so rotisserie and points-only leagues do not need a new branch in generic code.
- The starting-lineup interpretation is declared data for all four reference sports. Baseball's starting-pitcher rule is provisional and never extended to relievers or batters; football and basketball never demote on a non-start. Only a position the table marks as single-starter is read that way, and an undeclared one is never demoted. Full baseball and basketball request, scoring, and limits support remains deferred.

The opinionated formulas and their worked sport examples are recorded in [POLICY.md](POLICY.md); they are not inherited from the old app's multipliers. The observed NHL evidence is a published crowd share plus a three-state real-world starting fact for goalies. Do not treat a sampled zero cut as proven useful data.

## 5. Solver: exact weighted assignment

Use a weighted bipartite assignment formulation, not a procedural sequence of player swaps:

- One side: rostered players.
- Destinations: actual starter positions, legal bench accommodation, and reserve positions.
- Edges: legal assignments only, with locks fixed.
- All players remain assigned exactly once; starter/reserve counts and any pooled standard-roster limits are respected.
- An optional starting slot may be empty; a required one may not. Unmatched players are not a substitute for legal bench accommodation.
- The provider's shared standard-roster semantics are still unverified. The implemented policy treats every declared slot count as a hard maximum, so it cannot invent roster space; where a provider shares one starter+bench allowance, model that pool as bench capacity. [POLICY.md](POLICY.md#slots-eligibility-and-locks) records the decision and its cost.

Optimize lexicographically:

1. Legality and fixed assignments are mandatory, not penalties.
2. Maximize starting occupancy by availability tier, most available tier first, as a count. A player from a lower tier never displaces one from a higher tier, whatever either is worth; the tier ladder is declared by the policy and the solver knows only its order. A starter counts towards its tier only when its value is not negative.
3. Maximize total comparable signed starting value across every tier; non-starting contribution and empty slots are zero.
4. Among equal-value plans, prefer eligible zero-valued starter occupancy.
5. Minimize semantic assignment changes.
6. Choose a canonical deterministic result.

Availability is never a multiplier on value. Provider status codes map to policy availability facts in
one adapter table, and those facts map to ladder tiers in one policy function, so the pure solver stays
provider-neutral and a missing or unrecognised code cannot refuse a run.

Equivalent repeated slots must not create fake changes: exchanging two identical center-slot indices is not a Yahoo position change. The provider mapping determines whether slot identity matters.

Use explicitly specified fixed-precision values/exact integer objectives where practical. Never let a small floating-point epsilon silently overturn a better primary score. Lexicographic priorities require a proved bounded encoding or staged optimization, not arbitrary large constants.

### Implemented algorithm

`@lineupkeep/lineup-solver` uses the exact Hungarian assignment (`munkres` 2.1.1) over a square matrix:
one column per slot capacity unit, one row per player plus dummy rows for unused capacity. Pooled
standard-roster capacity is not a separate constraint: when a provider shares one allowance between
starters and bench, the league's declared bench capacity is modeled so total slot capacity equals the
shared pool. Lexicographic priorities are encoded as proved bounded `bigint` weights, and forbidden
edges use a finite bound above every legal assignment, so infeasibility is proved rather than guessed.
Every result is re-checked by the shared invariant predicates.

The package README records the exact encoding, the library audit, measured timings, and the exhaustive
oracle. Min-cost flow was considered and is not needed: the actual provider rules reduce to independent
slot capacities, and declared capacity is a hard maximum.

Escalate to integer/constraint programming only when accepted coupled constraints cannot be represented by assignment/flow. Multi-period planning, season-long pace limits, transactions, and true category objectives are not silently included.

## 6. Three principal machines

Use the starter's existing Effect-machine conventions and test support unless a verified requirement makes them unsuitable. Machine snapshots are domain state; a machine library alone does not provide durable execution.

### Provider connection

Candidate states: linking, ready, reconnect-required, disconnected. Each state owns its data, rather than combining unrelated booleans and optional fields. Expiring or replayed hosted linking sessions cannot change another user's connection. Reauthentication creates a new credential generation; stale work must revalidate it before writing.

A reconnect-required transition opens one connection incident and one notification intent. Five teams using that connection do not create five emails. A later expiration after successful reconnect is a new incident.

### Team automation

States: disabled, enabled, paused-until-fantasy-day-end. Keep availability observations separate from enrollment: unavailable is not the same as disabled. Pause expiry restores eligibility at the next normal check, not a special forced run.

Evaluate deadlines using the provider's fantasy-day policy and Effect DateTime named-zone calendar arithmetic. No fixed PST offset, 24-hour arithmetic across DST, or dependence on the server/user timezone. Yahoo's exact rollover still needs verification.

Manual authorized requests bypass scheduled enrollment checks but not connection readiness, ownership, availability, locks, or uncertain-write protection.

### Lineup run

Recommended logical states:

```text
queued -> reading -> planning -> validating -> applying -> verifying -> completed
    |         |          |            |           |            |
    +------> skipped / blocked / retry-wait / failed / uncertain / superseded
```

Native Phase 1 planning prepares the bounded native command, not a custom lineup. No-op results must be distinguishable from failures, blocked work, and inability to determine a write outcome. Retry is a recovery transition with preserved attempt history, not a new unrelated run.

Persist the state data needed to resume/reconcile, not an in-memory process continuation. Full state identifiers, events, codecs, retry budgets, and transition guards are a Stage 1 implementation specification; diagrams alone are insufficient.

## 7. Durable execution without a custom workflow engine

Use Postgres snapshots, short atomic transitions, a delivery outbox, and Cloud Tasks. Do not hold a database transaction or row lock while making external HTTP requests.

### Request and delivery

1. Authenticate the caller; resolve owned team/period and validate bounded input.
2. Use a stable request identity, rejecting reuse with different intent. In one transaction, persist the run and enqueue intent.
3. Dispatch the outbox promptly with deterministic delivery identity. Record success; duplicate task creation/delivery must be harmless.
4. The existing hourly scheduler also repairs undispatched intents and stale work. Do not add a high-frequency database polling daemon that prevents Neon suspension.
5. Worker delivery contains run references, never cookies. Load and authorize stored work rather than trusting incoming owner/team fields.
6. Manual MCP waits for a bounded interval, then returns current status/run reference. Request cancellation does not cancel committed durable work. `BackgroundWork` is not a substitute for durable enqueue.

A queue outage may delay execution; report pending/delivery difficulty honestly. Do not promise deadline guarantees that an hourly repair sweep cannot provide.

### Team coordination and batching

A team/period run is the recovery/outcome unit. Serialize application writes to the same team across manual and scheduled work. Bound provider traffic per connection.

Batch compatible reads and writes inside the provider implementation where supported. A queue delivery may contain a bounded group of run references; completed teams are not re-applied when the group is redelivered. Batch persistence remains set-based. Do not claim batch HTTP is a cross-team atomic transaction.

Use short-lived leases with generation/version checks and a durable write-intent state. A lease expiring is not proof that an already-sent provider request ended. Yahoo does not honor our fencing token, so never permit a replacement write solely because a local lease expired.

### Validate, apply, reconcile

- Re-read relevant roster, membership, locks, connection generation, target period, and automation controls before writing. Re-plan boundedly if stale.
- Pause/disable stops scheduled work before a write starts; it cannot undo an HTTP request already sent.
- Persist intended assignment/before-state fingerprint before explicit writes. Submit only the provider-required editable assignments.
- Verify coverage, membership, and observed assignments afterward. Native actions can succeed when some players are locked; do not require every player editable.
- A timeout after transmission is uncertain, not definitely failed. Reconcile by readback before considering another write.
- For explicit assignments, compare observed state with both intended and before-state. For native actions the exact intended lineup may not be knowable; readback cannot invent proof of acceptance.
- If evidence remains ambiguous, preserve an uncertain/blocked outcome and require recovery rather than blindly replaying. Do not automatically restore, undo, or fight external manual edits.
- External edits can race our last validation. With no provider CAS/idempotency guarantee, exactly-once effects and elimination of all races cannot be promised.

Only classify transport failures as safe pre-transmission failures if the transport can prove that distinction. The current PublicInternet error is intentionally opaque; do not infer it from a generic network exception.

## 8. Persistence and lifecycle

Minimal persistent responsibilities:

- Starter auth/session/OAuth data.
- Provider connection metadata and separately encrypted credential records.
- Stable owned team identity/configuration and last-seen availability.
- Team automation state/codec.
- Run state/version, request identity, attempts, implementation version, concise result.
- Minimal diagnostic inputs, expiring after seven days.
- Delivery/notification intents and their stable identities.
- Feedback reports owned by one application user, with a bounded submission quota per owner and acting client.

Concise run outcomes/explanations expire after 90 days. Do not preserve their full content forever through soft-deleted rows, event tables, traces, backups, or abandoned outbox payloads. Define cleanup for every copy. Current configuration and unresolved incidents are not historical run retention.

Retention windows live in one policy module (`packages/backend/src/retention/RetentionPolicy.ts`). Lineup runs, attempts, and write intents are removed 90 days after the run reaches an end state. Schedule observations are removed 14 days after the covered window ends. Unapproved dynamic client registrations are removed after seven days, and at most 100 may be live. OAuth consents are removed 180 days after their last consent interaction. Hosted linking sessions are removed one day after they end. Owner notes are never auto-deleted. A window closes when its whole length has elapsed, so a record exactly on the boundary is removed. A run that has not ended has no end state and is never swept.

A feedback report keeps the submitter kind and surface, kind, status, title, body, bounded optional context (tool, team reference, client, surface), and an optional resolution note with its closure time. Open and acknowledged reports are current work and stay. Resolved and not-planned reports are deleted 365 days after they close, and submission-quota rows are deleted once their hour can no longer accept a report; there is no soft-deleted feedback copy. Reports carry no credentials, provider payloads, email addresses, or account identity beyond the opaque owner. The hourly worker runs the sweep beside the existing retention sweep, and the service bounds text length, strips control characters, and stores user text as plain text that is never rendered as markup.

Use real migrations, owned-row predicates, pragmatic owner/filter/order/expiry indexes, stable ordering, bounded pages, and idempotent creates. Add uniqueness for actual identities, not league-only identities that overwrite two teams in one league.

Keep application data, infrastructure state, and test databases on separate lifecycles. Database retention is not a backup. Before deployment/migration, adopt the starter's protected remote-state, recovery, and backup procedures with this product's own resources and least-privilege roles.

## 9. Linking and secrets

Use a hosted browser as the linking flow. It runs a fresh ephemeral Chromium profile in an isolated, IAM-private browser service and streams the provider page into the Connections surface. The person signs in once inside that page; the connection becomes ready without copying a code or approving a second device. The service is deployed for the `cloud-run` stage as `lineupkeep-hb`; see [the hosted browser infrastructure](HOSTED-BROWSER-INFRA-PLAN.md). The web proxies the stream and completes the connection, so the browser service is IAM-only, holds no application database or encryption secret, and accepts a session only with a Cloud Run ID token plus an HMAC-signed, one-use descriptor.

The browser is per-session and short-lived. Each hosted linking session is bound to the authenticated application owner, expires within ten minutes, and is one-use. The browser can join only with a one-use ticket delivered as an HttpOnly, `SameSite=Strict`, path-scoped cookie; only its hash is stored. A per-owner lock permits one open session, and starts are rate-limited. Wrong-owner joins, replayed sessions, expiry, and concurrent starts are rejected. The browser and its temporary profile are destroyed when session material is captured, when the owner cancels, on disconnect, and on expiry.

The hosted browser is not a general proxy, but it can reach the public internet so a provider's identity chain works. Each session routes Chromium through a local forward proxy that resolves every destination and refuses non-public addresses by address, not by hostname; link-local, metadata, loopback, CGNAT, private, multicast, and reserved destinations are refused, and the verified public address is dialed directly. It cannot reach application-private services. See [ADR 0010](adr/0010-address-based-egress.md). Input is relayed transiently to the provider page through the web process; passwords, page content, screenshots, cookies, and crumbs are never logged, traced, recorded, or persisted. The transient keystroke relay is an accepted decision and the UI does not claim the password stays off our servers ([Round 11](DECISIONS.md#round-11--transient-keystroke-relay-in-the-hosted-browser)). The browser stops as soon as the required `T`/`Y` session cookies are captured and validated. Failure states distinguish expired sessions, blocked logins, additional verification, provider unavailability, and wrong-account rejection.

The hosted browser is the only linking path. There is no local capture tool or upload endpoint; a deployment where hosted linking is unavailable reports that state instead of offering another route.

Extract only the provider's required session material, send over authenticated TLS, validate the connection server-side, and store encrypted credentials separately. No cookies/crumbs in MCP, frontend state, telemetry, diagnostic snapshots, task payloads, URLs returned to agents, or email. Disconnect blocks future work and removes active secret material; already-sent requests still require reconciliation.

For the free-tier design, a versioned AES-GCM envelope with a key held in Secret Manager is a practical candidate. Bind ciphertext to owner/connection/provider/version as authenticated data. Use native cryptography behind Effect, unique nonces, rotation, tamper/cross-owner tests, and deliberate key recovery. Do not automatically recreate the old app's paid KMS-key topology. Autokey-specific KMS free allowances are not proof arbitrary application keys are free.

No credentials in infrastructure state/build outputs beyond unavoidable protected provider records; treat infrastructure state and local Alchemy outputs as secret-bearing. Never copy `.env`, profiles, VCS state, dependency caches, or existing cloud resource references from either old app or starter.

## 10. Yahoo transport and review links

Every production Yahoo HTTP request uses starter PublicInternet. The Yahoo implementation independently restricts exact origins, methods, paths, query fields, resource keys, and XML bodies; rejects redirects; and sets bounded response/time budgets. No raw-fetch escape hatch.

Current PublicInternet accepts Request and scoped Response consumption; its defaults are 15 seconds and 1 MiB. Earlier verified bulk Yahoo payloads exceed that default. Configure a deliberate larger bound only for bounded rich Yahoo operations, not globally. Consume/cancel response bodies within scope.

The v2 read origin `pub-api-ro.fantasysports.yahoo.com` and the service origin `pub-api.fantasysports.yahoo.com` were exercised against the live provider on 2026-10-25 for session validation, crumb acquisition, NFL/NHL team discovery, rosters, league settings, player search, selected-player statistics, scoreboards, transactions, and league team membership. [Verified read behavior](RESEARCH.md#live-yahoo-read-verification-2026-10-25) and [read endpoint verification](RESEARCH.md#live-yahoo-read-endpoints-2026-10-25) record payload shapes and sizes, the normalizer defects verification corrected, the provider's actual-only weekly statistics, date-scoped rosters, and the write-side facts that remain unproven. The read-write origin's native and explicit roster writes are recorded in [the native write verification](RESEARCH.md#live-yahoo-native-write-verification-2026-10-25) and [the explicit assignment verification](RESEARCH.md#live-yahoo-explicit-assignment-write-verification-2026-10-26).

Yahoo native start-active uses an XML roster action; optimal-start was explicitly premium-denied on the researched account. No premium optimization endpoint, purchase, entitlement bypass, or substitute recommendation call is included.

Yahoo explicit assignments use the same read-write roster endpoint, crumb, and coverage selector as the native action, with an XML `players` collection of `player_key` and `position` pairs instead of an `action`. The adapter sends only changed, editable, non-reserve assignments and no add, drop, or trade element, so every roster member is retained. Official documentation and the live probe agree that unmentioned players keep their positions; the roster readback, not the write response, is the authority for what changed.

Review links support add, add/drop, drop, and trade, with exact provider-host allowlists and identifier validation. Yahoo uses scalar `apid`/`dpid`, and stage-one trade review with repeated outgoing/incoming IDs. Keep numeric web IDs private to the adapter. No submission-stage URLs, arbitrary redirects, CSRF material, transaction execution, or claim that a prefill guarantees final eligibility. Validate same-league/counterparty/player relationships before generating a link.

## 11. MCP and frontend

See [MCP.md](MCP.md), [UX-BRIEF.md](UX-BRIEF.md), and [TESTING.md](TESTING.md). Both surfaces call the same public use cases, not separate implementations. Feedback is the one domain both a signed-in person and an agent report and follow up through the same owner-scoped service: a tool grant is always the acting account's own reports, and no agent-wide or operator queue exists.

Retain the starter's application-user/client authorization, OAuth consent, ownership, narrow read/write scopes, and runtime/Effect-free browser boundaries. A future HTTP dataset adapter is not required now. Hosted Muse remains the primary client acceptance target; do not change to stateful/legacy MCP for older Pi.

## 12. Infrastructure and cost

Cloud Run public web/MCP, IAM-protected worker, and IAM-only hosted browser, Cloud Tasks, shared hourly Cloud Scheduler, fresh Neon Free application database, protected remote Alchemy state, Secret Manager, bounded image retention, and the existing transactional email implementation are sufficient candidates.

See [HOSTING.md](HOSTING.md) for quotas and costs. Do not inherit the starter's current min-one/instance-billing configuration or external database resource reference. Put ordinary non-secret environment configuration in plain environment entries instead of creating a Secret Manager version per setting. Verify the billing account's shared free allowances, including existing projects.

Production needs ingress-aware auth rate limits and email quotas even with open registration. These are ordinary abuse controls, not an allowlist or invitation system. Free-tier fit under expected usage is a target; public traffic cannot be guaranteed a zero bill merely by setting a billing alert.

## 13. Hard acceptance gates

- Resolve the starter's documented critical RPC publication blocker and obtain a stable copy-ready baseline. Do not publish the inspected vulnerable dependency closure or invent a local backport.
- Verify actual hosted Muse OAuth/tool behavior and chosen cloud egress/session compatibility.
- Verify Yahoo's exact fantasy-day rollover and supported league rules.
- Establish meaningful scoring evidence and complete legal assignment/write behavior before Phase 2 activation.
- Obtain explicit authorization for infrastructure plan/apply and any live provider write acceptance. No such action is authorized by this document.
