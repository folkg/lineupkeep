# Planning research

Research informs proposals; it does not constitute deployment or compatibility verification.

## Existing scoring behavior

Inspected `server/core/src/common/services/playerScoreFunctions/playerStartScoreFunctions.service.ts` in AutoCoach:

- Base scoring uses started percentage, falls back to owned percentage, and coerces missing/zero values to at least one.
- Injury, non-participation, and starting status apply multiplicative penalties/boosts.
- Weekly scoring has a different rule because its comments state projections already incorporate injury effects.
- NFL scoring includes a comment questioning whether injury is counted twice.

The successor is not committed to these formulas or fallbacks. Preserve zero/missing distinctions, allow signed selection values, and separate legal eligibility from participation evidence. Decide policy explicitly and test it independently from the assignment solver. Do not use the old output as the sole correctness oracle.

## Fantasy-day boundaries and timezone handling

- The old utility module uses spacetime with the named zone `Canada/Pacific`, not an explicit fixed PST offset.
- Yahoo's [transaction and lineup deadlines](https://help.yahoo.com/kb/SLN6775.html) use PT and describe settings-dependent game-time and 11:59 PM deadlines. This supports using Pacific local calendar rules, but does not by itself prove a single universal fantasy-day rollover. Exact Yahoo pause-boundary semantics remain a verification item; no live account probes were performed.
- The current local starter declares Effect 4.0.5 and Node >=24.11.1 <25. The local runtime reports Node 24.21.0 and `globalThis.Temporal` is undefined under its default flags.
- Inspected Effect's DateTime source for named zones, local start-of-day, and calendar-aware addition. A network-free smoke check using the starter's installed Effect produced 23 hours between Los Angeles midnights on 2026-03-08 and 25 hours on 2026-11-01.
- Effect DateTime appears sufficient without a separate timezone dependency. Production tests must include pause expiry exactly at the boundary, DST changes, server/user timezone independence, and late queue delivery across rollover. This does not authorize a starter copy or an application implementation.

## Starter machine support and old scheduling

- The current starter already catalogs `@typeonce/effect-machine` 0.41.1 and uses Schema-defined machines in `NoteLifecycleWorkflow.ts`.
- Its machine utilities expose snapshot decoding and pure transition planning. These are useful conventions to evaluate; they do not prove a durable external-side-effect execution engine exists.
- The old AutoCoach scheduler fires at minute 55 of every hour. Additional sport/day eligibility is selected downstream. Its cadence is evidence of the incumbent behavior, not a requirement to copy it.
- Starter dependencies have changed since earlier research; inspect its current architecture and readiness before copying. Presence of updated files does not establish a copy-ready handoff.

## Old Yahoo write batching

Inspected `putLineupChanges` and `putRosterChangePromise` in `server/core/src/common/services/yahooAPI/yahooAPI.service.ts`. The public function receives an array but loops sequentially over it, assembling one XML roster body and calling `team/{teamKey}/roster` once per team. This proves only that the old app does not batch writes across teams. It does not prove Yahoo cannot support any bulk-write endpoint. No additional live Yahoo probes were made. Batch provider requests only when actual support and per-team outcome semantics are verified.

## Starter readiness observation

Read the local `rush-hour/docs/release-readiness.md`, dated 2026-10-22. It explicitly records a critical Solid Start RPC publication blocker in the installed dependency closure and an owner decision to wait for a coherent published upstream fix. It also retains other compatibility limitations. This is a local tracker observation, not a fresh independent advisory reproduction or a declaration about every current upstream release. Treat the baseline as not publication-ready until its documented gates and stable handoff are satisfied.

Read the starter deployment runbook: retained application data and protected Postgres-backed Alchemy state have different lifecycles and credentials. Do not copy its live Neon resource references. Its domain/testing guidance already requires batch-first services, Schema-defined lifecycle state, machine/codec exploration, generated sequences, and real-transport acceptance.

## Assignment and model-based testing research

Primary explanations inspected:

- https://developers.google.com/optimization/flow/assignment_min_cost_flow
- https://web.cs.dal.ca/~nzeh/Teaching/4113/book/matching/bipartite_matching_via_flows/maximum_weight_matching.html
- https://fast-check.dev/docs/advanced/model-based-testing/

Assignment/min-cost flow can represent legal player destinations, capacities, fixed assignments, and additive values. A generic mixed-integer/constraint runtime supports more coupled rules but is not necessary merely because a lineup contains FLEX positions.

The old Team implementation excludes BN from overfilled positions and separately sums standard-roster capacity. This suggests a pooled capacity distinction that must be verified against actual provider rules. Do not force negative-valued players into starters through a fictitious fixed bench cap. Min-cost flow is the leading formulation if those pools are required; Hungarian remains suitable only when the accepted model truly reduces to independent slots.

Candidate implementation sources inspected, not installed or benchmarked:

- https://github.com/havelessbemore/munkres/ — README advertises no runtime dependencies, TypeScript, rectangular assignment and bigint; Infinity is avoid-if-possible, not an absolute legal prohibition.
- https://github.com/Vages/min-cost-flow — README describes successive-shortest-path flow; exact arithmetic, negative costs, maintenance and semantics still need source/package evaluation.
- https://axelwickman.com/or-tools-wasm/network_flow_min_cost_flow.html — JS/WASM binding exists, but initialization/bundle cost and necessity are not established.

Use the starter's Effect-machine/Arbitrary test support first. Model-based test guidance explicitly warns against copying the real system into the model. Transition execution agreeing with its own definition does not establish that the domain rules are right; independent properties and tiny exhaustive oracles remain necessary.

## Hosting comparison

See [HOSTING.md](HOSTING.md) for current primary-source limits, illustrative workload calculations, and the proposed platform acceptance checks. Hosting is reopened by the user; the earlier GCP direction is not a final constraint.

## Alchemy GCP feasibility — documentation evidence

Inspected primary pages:

- https://alchemy.run/gcp/
- https://alchemy.run/blog/2026-09-29-beta-80/

Additional inspected starter facts: Cloud Run currently uses minimum one instance and `cpuIdle: false`; this is not the accepted scale-to-zero launch policy. Its Neon layer references an existing starter stack, which must not be reused as this independent product's data resource. The auth implementation provides email-code sign-in/automatic registration and optional Google, not email/password authentication. These findings shape the next decisions and must be rechecked at the stable-baseline handoff.

The GCP guide documents Effect-oriented Cloud Run runtimes, Cloud Scheduler, Pub/Sub, Cloud SQL, Secret Manager/KMS, and IAM bindings. It lists Cloud Run scale-to-zero and several website deployment paths. The release page documents GCP support and an Effect-version baseline.

This makes an Alchemy-managed GCP deployment plausible, not verified. Before recommending exact resources or installing anything, inspect the current starter dependency versions and published package/source contracts, especially Effect compatibility, the selected frontend's production build, private job invocation, Cloud Tasks support if selected, database cost, and remote infrastructure-state storage. Documentation examples show differing import conventions, so do not copy them as a compatibility guarantee.

No infrastructure was created or modified during this research.
