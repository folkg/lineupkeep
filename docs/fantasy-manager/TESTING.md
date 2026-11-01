# Testing and proof plan

Status: proposed seams and acceptance criteria for final plan approval. No application tests or implementation have been written during planning. Confirm these seams with the plan before implementation, then work vertically with one failing behavior at a time.

## 1. Test seams

| Public seam                                  | Catches                                                               | Does not prove                                                           |
| -------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Pure assignment solver                       | Legality, exact objective, determinism, infeasibility                 | Source-data truth or correct sport policy                                |
| Opinionated selection policy                 | Comparable values, negative/zero/missing, availability reasoning      | Provider's real-world forecasting accuracy                               |
| Provider adapter                             | Decoding, exact coverage/membership, authorized requests, review URLs | Unofficial provider behavior remaining stable forever                    |
| Domain public services with migrated storage | Ownership, state transitions, durable requests, recovery, retention   | Real cloud IAM, network routing, or all Postgres lock behavior in PGlite |
| Browser remote/controller/view               | Accessible flows, loading, pending/error recovery, focus/races        | Production SSR/hydration/network integration                             |
| Built app and actual MCP transport           | Auth, consent/scopes, serialization, persistence, surface integration | Production cloud permissions or hosted Muse compatibility                |
| Authorized cloud/client acceptance           | IAM, queue delivery, egress, cold starts, real client behavior        | A zero-bill guarantee under arbitrary public traffic                     |

Do not create a test-only public interface to reach internals. A solver and policy are real calculation seams used by production; an independent validator/oracle belongs in tests and is not another implementation dependency.

Feedback uses three layers rather than one: the public service with migrated storage proves submission normalization, owner isolation, filtering, quota, lifecycle repeats and rejections, and the closed-report sweep; the actual MCP protocol test proves scope enforcement, no owner identity in results, and submit/list serialization under the read scope; the built app proves the form, accessible field errors, plain-text rendering, listing with status, reload persistence, and the contextual team reference.

## 2. TDD discipline

- Vitest/@effect/vitest, existing Effect-machine test support, and Effect Arbitrary first. Do not add another property library merely because examples use it; fast-check is already useful where the starter uses it in browser workflows.
- Tests beside owned modules, flat descriptive `it` cases, explicit Arrange/Act/Assert sections, public outcomes, no `any` or unchecked assertions.
- One failing test for one observable behavior, run it to establish the expected failure, implement the smallest change, then continue.
- Inject true external seams/Test Layers; no module mocks or assertions about collaborator call counts.
- Test-local disposable resources, deterministic time, real committed migrations, no shared mutable fixtures or real cookies.
- Test concurrency semantics with local real PostgreSQL in addition to fast PGlite tests. PGlite cannot by itself prove production row locking, transaction isolation, competing workers, or session advisory locks.

## 3. Solver tests: generated problems and an independent optimum

Generate tiny and realistic assignment problems, not Yahoo JSON. A problem includes players, legal edges, starter/reserve capacities, pooled standard-roster limits, legal bench accommodation, locks, current assignments, signed values, and repeated interchangeable slots. Cover both truly capped benches and providers whose advertised bench count is part of a total roster allowance rather than a hard bench-assignment maximum.

For tiny instances, enumerate all complete legal assignments independently and compare the complete objective tuple. Keep exhaustive enumeration deliberately small and slow but structurally unlike the production algorithm. Do not obtain expected output from the production solver or reuse its feasibility helper.

Required properties, with precise preconditions:

- Every original player appears exactly once; none is invented or dropped.
- Slot capacities, legal destinations, and fixed assignments are respected.
- A returned infeasible result agrees with the tiny exhaustive oracle.
- Primary value is optimal; zero-filling, minimum-change, and canonical tie rules hold among primary ties.
- Empty slots can beat negative starters when legal. Locked negative starters are not illegally benched.
- Missing evidence is not assigned value zero by the solver shell/policy.
- Input ordering and equivalent-slot labeling do not change semantic output.
- Applying a chosen optimum as the current assignment yields the same semantic assignment on a repeated solve when facts/policy are unchanged.
- Increasing a candidate's value cannot decrease the best achievable primary objective for an otherwise identical feasible problem. Do not overclaim that the same candidate must remain selected under every tie.
- Adding a legal alternative cannot reduce the best achievable primary objective, while infeasible-to-feasible changes are handled separately.
- A lower-priority tie preference can never beat a better primary score, including large/close values.
- No arbitrary 'infinity' cost can leak an illegal edge into a reported feasible lineup.

Named adversarial cases: FLEX chains; multiple eligible positions; two equal-score players; more players than legal storage slots; an injured player on reserve with no activation space; spare legal reserve slots; incomplete values; zero-only rosters; all-negative candidates; mixed locks; no bench capacity; repeated slot types; malformed/inconsistent provider rules.

Persist seed and minimized counterexample on failure. A generated failure becomes a small readable regression, not a new giant captured roster file.

## 4. Policy tests: independent from matching

Use worked expected comparisons and generated boundary cases:

- Complete realised values, partially missing values, zeros, negatives, and no usable fallback.
- Consistent comparison basis; no raw percentage-versus-points comparisons and no silent switch to a different scoring scheme. The one cut-population fallback is recorded in the provenance label.
- Missing injury/start status versus explicit healthy/out; confirmed/unconfirmed participation; no injury double-counting.
- An uncertain positive player can fill an empty position; comparable confirmed participants are preferred according to the explicit policy, not a hidden hard tier.
- Category heuristic is labeled as such and does not claim expected points/category-win probability.
- Same facts and the same provider score produce the same result, independent of provider payload ordering.

NFL cases: bye/no scheduled game, questionable/out changes before lock, already locked players, period-correct realised statistics, and league scoring context.

NHL cases: announced/unannounced/backup goalie, a non-starting goalie who might appear, injured skater, negative goalie value, no scheduled game, and all-zero versus missing fallback evidence. Whether a feed actually contains meaningful free data is a contract/acceptance question, not something a synthetic generator can prove.

Future MLB policy checklist (not initial implementation): SP-only, RP-only, SP/RP eligibility, announced starter versus possible relief appearance, opener/bulk roles, schedule changes/doubleheaders, and provider-score participation assumptions. Do not encode these cases in the generic solver.

## 5. State-machine exploration and model-based sequences

Use the starter's MachineTest.explore/scenarios and Effect Arbitrary. Explore abstract reachable states and require complete transition/branch coverage for the explored definition; exercise data-bearing events with generated scenarios. Finite exploration is not a proof over all payload values.

Every machine-state row codec gets round-trip tests across explored states/generated values. Every durable transition is also tested through the service with migrated storage. Reject unexpected events instead of silently accepting them.

Build a deliberately smaller independent command model, not a copy of the transition graph. Commands include link/expire/reconnect/disconnect, enable/disable/pause, advance clock, enqueue/deliver/duplicate, provider roster change, lock change, start write, lose response, crash worker, recover, and query result.

Core sequence invariants:

- Another user cannot inspect, mutate, or poll another user's connection/team/run/link session.
- Disabled/paused scheduled work does not begin a write after a control check rejects it; manual work does not change enrollment.
- Pause expires at the provider day boundary, including DST/weekly-league cases; no special immediate run is invented.
- Missing/unavailable teams retain configuration and receive no writes.
- Invalid credentials open one incident; five linked teams do not create five emails.
- Duplicate request/delivery does not create unrelated runs or blindly replay a completed write.
- A stale worker cannot commit state over a newer generation. An expired lease never establishes that an external request finished.
- Pending/uncertain is not reported as verified success; an HTTP 200 with invalid coverage is rejected.
- Same-key/different-intent requests are rejected.
- Deployment/policy cutover does not overlap an unresolved old write.

Do not consider MachineTest.verify alone sufficient: it can establish that execution follows the same machine definition, not that the business definition is correct. Independent invariants/model observations supply that evidence.

## 6. Crash and transport failure matrix

Inject a failure at each meaningful side-effect boundary and assert returned/persisted results through public services:

| Boundary                                        | Expected evidence                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Before run/outbox transaction commits           | No accepted durable work                                                      |
| After commit, before queue creation             | Repairable persisted delivery intent                                          |
| Queue accepted, dispatch response lost          | Same delivery identity; no duplicate side effect                              |
| Worker claimed, before write intent             | Recoverable lease/attempt                                                     |
| Write intent persisted, before transmission     | Conservative reconciliation; no invented proof that it was sent               |
| Provider accepted, response lost                | Uncertain outcome; readback before any further write                          |
| Provider rejected definitively                  | Typed safe error/retry classification, not fabricated success                 |
| Provider response received, before state commit | Recovery observes provider/intent instead of blindly replaying                |
| Readback differs due to manual edit             | Divergence/uncertainty reported; no automatic restore loop                    |
| Email accepted, delivery acknowledgment lost    | Stable logical notification identity and provider idempotency where supported |
| Pause/reconnect/disconnect during work          | Generation/control checks plus reconciliation for already-sent requests       |

Transport-level sensitivity controls matter: the fake provider must actually accept/mutate before simulating lost response in the accepted-write case. A test that never performs the side effect cannot prove recovery from it.

### Explicit assignment reconciliation

The behavioural provider fake applies the explicit assignments it accepts, so each lost-response case exercises the real side effect. The durable worker proves:

- Accepted with a matching readback: completed, verified, not reconciled.
- Accepted with a differing readback: failed, verified, every mismatched assignment recorded, and no automatic retry.
- Response lost with a matching readback: reconciled change, no second write.
- Response lost with an unchanged readback: `retry-wait`, the intent marked not sent, no second write inside the attempt, and one write after a forced retry.
- A slot or lock edit between the planning read and the pre-write re-read: bounded replan from the fresh roster, recorded as source-changed.
- A membership or coverage change between those reads: blocked with no write.
- A scoring-week change between the planning league read and the pre-write league read: blocked with no write.
- A policy that cannot score the league: the provider-native action runs and the outcome records `provider_native` with the policy refusal.

Detected races are limited to observations the provider publishes in its roster and league reads: slot assignments, membership, per-player editability, coverage, and the current scoring week. A scoring-week roll after the pre-write league read, an edit after the pre-write roster read, and a lock transition the provider does not publish are not locally detectable; the provider's all-or-nothing rejection and the post-write readback are the backstops.

## 7. Provider contracts and privacy

Use a small set of sanitized, hand-minimized fixtures covering structurally distinct Yahoo responses: current/historical discovery, multiple teams in one league, nested league/player statistics, date/week/season coverage, missing stats, zeros, locks, and error bodies. Add a synthetic provider with different keys, week identifiers, rollover, and batch behavior.

Provider payload fixtures come from captured structure, not from assumptions about it. Each fixture is a live read with every value replaced by synthetic data of the same JSON type, kept as data in one module so a newly observed shape is a new fixture rather than a branch in an existing one. Cover the structural properties that actually vary: nested attribute fragment lists padded with empty placeholders, repeated single-field entries such as roster positions and stat categories, one league variant per sport plus one per scoring type that omits fields the others publish, rosters with week and date coverage, weekly and season stat availability, and a transaction naming a dropped player. Tests that require a named invalid-response failure assert against captured unexpected shapes too, so the failure path is never written against an invented payload. Boundary tests for a published schema must exercise the boundary the handler sees, including an empty string where the schema accepts it.

Verify actual request origin/method/path/query/XML, redirect rejection, response/body bounds, coverage validation, exact selected keys, and same-league review-link mapping through a transport seam. Exercise real serialization, not just pre-parsed fixture objects.

Keep dedicated PublicInternet security tests for DNS/TLS/SSRF semantics; MSW cannot prove them. Reuse starter coverage rather than weakening its transport or adding production test bypasses.

Privacy tests need positive controls: inject recognizable secret canaries into rejected provider responses and inspect actual surfaced/logged observations. Assert cookies, crumbs, credential blobs, account GUIDs, manager data, and raw URLs never escape. Test encryption tampering, owner/connection swapping, secret rotation, and expired/replayed hosted linking session.

## 8. Surfaces and deployed acceptance

- MCP protocol: real OAuth/consent, narrow scopes, ownership, pending/verified results, exact UTF-8 output budgets, one oversized record, whole-record continuations, and wrong-owner cursor/run access.
- Browser: keyboard/focus, passwordless code flow, open registration, hosted-browser linking, reconnect, no teams, long names/many teams, enabled/disabled/paused states, expired pause, pending/uncertain activity, offline/failure recovery, and mobile layout.
- Hosted browser: use the fake provider served by the test/dev server, never a live Yahoo login. Assert owner-bound streaming, wrong-owner and replay rejection, expiry, cancellation, egress blocking, temporary-profile removal, `T`/`Y` capture without logging, automatic ready, and automatic team discovery. Keep production-service probes separate and manually authorized.
- Built E2E: SSR/hydration, production artifacts, auth persistence, no duplicate browser writes, queue-to-visible-result integration with external fakes. Zero retries; retain first-failure evidence privately.
- Hosted Muse: harmless read and real OAuth first, then paging and bounded pending-run handling. Do not use compatibility with a different local client as proof.
- Authorized GCP acceptance: private invoker IAM, queue/Scheduler OIDC identity, secrets, chosen provider egress, cold-start CPU/memory/latency, Neon wakeups, image sizes/retention, and actual billing-allocation checks.

Live explicit-lineup writes need separate owner authorization and a small controlled acceptance case. Research authorization for prior calls is not continuing permission to mutate accounts during implementation planning.

## 9. Exit criteria

Passing example tests alone is insufficient. Before Phase 1 release: owner isolation, native-action/review-link contracts, machine/codec exploration, durable crash recovery, actual MCP/client behavior, minimal UI recovery, free-tier measurement, and fixed-starter security acceptance must pass.

Before Phase 2 cutover: tiny-oracle agreement and generated invariants, worked opinionated policy examples, meaningful provider evidence, explicit-write readback/recovery, and no-transaction/no-member-loss proofs must pass. Then cut over directly as agreed: no shadow product stage or second team opt-in.
