# Begin here: Lineupkeep

## What this project is

A fresh provider-neutral fantasy-management product. This is not an AutoCoach port, data migration, reskin, or continuation of its implementation. Initial adapters target Yahoo NFL/NHL; future providers/sports must not leak into the solver or generic interfaces.

Use the existing AutoCoach checkout as reference material for verified provider behavior and known failure modes. Build better-suited architecture, algorithms, infrastructure, Alchemy IaC, and tests deliberately. Do not copy old classes, multipliers, Firebase infrastructure, session stores, accounts, or secrets. Keep the old application untouched.

Reference checkout on the preparation machine:
`/Users/graemefolk/Documents/Software/fac/auto-coach`

Starter source:
`/Users/graemefolk/Documents/Software/rush-hour`

Independent destination:
`/Users/graemefolk/Documents/Software/lineupkeep`

These are local reference paths, not build-time dependencies.

## What is ready

- Independent jj repository: one flattened starter baseline, then a Lineupkeep identity/preparation change.
- All 17 planning documents copied, with current setup/name annotations where appropriate.
- Product/brand guidance, the owner-selected royal violet and gold palette, semantic light/dark tokens, self-hosted typography, wordmark, favicon, and an Impeccable design sidecar.
- Retained starter platform with a device-paired connections vertical and a first-party local CLI that links a Yahoo session through a temporary browser profile into an encrypted, owner-scoped connection. The Notes demo is removed.
- Independent package namespace, local resource labels, stack/resource identities, and telemetry names. No existing cloud state was renamed or imported.
- Fresh dependencies; source dependencies, environment, outputs, browser sessions, cloud state, and VCS history were not copied.

## Permission boundary

The owner wants one autonomous assignment covering all Phase 1 and permits use of their GCP CLI to set up fresh Lineupkeep infrastructure. [The Phase 1 handoff](docs/PHASE-1-HANDOFF.md) records the execution prompt, authority, credential provisioning, and remaining billing/security/live-provider gates. Internal slices are delivery units, not repeated owner-approval gates. Preparing this handoff did not begin feature execution or provision resources. Domain purchases, unrelated-resource changes, and unscoped provider writes remain prohibited.

## Read in this order

1. [Product](PRODUCT.md), [brand](docs/brand/BRAND.md), [design](DESIGN.md).
2. [Scope and technical proposal](docs/fantasy-manager/IMPLEMENTATION-PLAN.md).
3. [Detailed delivery stages](docs/fantasy-manager/DELIVERY-PLAN.md), [architecture](docs/fantasy-manager/ARCHITECTURE.md), [testing](docs/fantasy-manager/TESTING.md).
4. [Glossary](docs/fantasy-manager/GLOSSARY.md), [decisions](docs/fantasy-manager/DECISIONS.md), [ADRs](docs/fantasy-manager/README.md).
5. [MCP](docs/fantasy-manager/MCP.md), [hosting](docs/fantasy-manager/HOSTING.md), [provider research](docs/fantasy-manager/RESEARCH.md), [lineup selection policy](docs/fantasy-manager/POLICY.md).
6. [Release readiness](docs/release-readiness.md), [deployment runbook](docs/deployment.md), [working agreement](AGENTS.md).

## Implementation readiness

The product scope, name, destination, and visual direction are settled. **Local implementation may proceed while the security fix is pending.** Complete Stage 0 feasibility work at the seam it affects; do not wait for every later-stage fact before building the first slice.

- **Publication gate, not a local-development stop:** the installed `start-server-core` is still `1.169.26`; the inherited release tracker identifies this closure as vulnerable. Keep development loopback-only and use synthetic data for automated provider tests. Do not expose this transport through a public deployment or tunnel. A temporary checked-in response-validation backport closes the reported vector in the meantime; [release readiness](docs/release-readiness.md#temporary-response-validation-backport-applied-2026-10-25) owns its record and removal condition. Adopt a coherent upstream fix with installed-source inspection and real-transport/SSR/single-flight regression acceptance before publication; a version bump alone is not acceptance.
- **Before later Phase 1 slices:** the hosted browser flow is proved locally. Review the remaining public seams and prove supported provider periods/locks, bounded query contracts, and native-action readback/recovery. Live probes require separate permission.
- **Later gates, not blockers for every first slice:** meaningful custom scoring/reserve evidence and explicit-assignment acceptance belong to Phase 2. Hosted Muse, cloud egress/IAM, quotas, and actual deployment acceptance remain gates before launch.

The autonomous handoff does not waive publication security, billing authorization, or scoped live-provider acceptance. Deployment is conditional on those gates, not on the owner supervising each implementation slice.

## Autonomous implementation assignment

Use [the Phase 1 execution prompt](docs/PHASE-1-HANDOFF.md#prompt-for-the-next-agent) to assign the entire implementation. Start with bounded hosted-browser feasibility and the first connection/team-discovery slice, not the optimizer; then continue through Phase 1 without requesting a separate assignment for every slice. Inspect the proposed public seams, retain sound starter auth/runtime/MCP behavior, and prove ownership and recovery using a behavioral provider fake and disposable PostgreSQL. Establish hosted-browser streaming before investing in its full UI. Real Yahoo access requires a separately scoped approval.

Do not recopy the starter or rebuild the platform. The Notes demo is removed; add only the types, persistence, and services required by each vertical slice. Defer custom scoring/solver work to Phase 2, and carry the security fix as a tracked pre-publication gate. Do not add speculative provider frameworks or alternative hosting targets.

Phase 1 comes before the custom optimizer. Cloud Run + fresh Neon Free is the chosen target, with two min-zero request-billed services plus the planned IAM-private hosted-browser service; the copied infrastructure is an undeployed scaffold, not proof of free-tier fit. Its original host defaults still require the planned implementation work.

No users, preferences, history, auth grants, or provider sessions will ever be migrated from AutoCoach.

## Handoff state

Use `jj status` to confirm the empty working copy and [setup record](docs/SETUP.md) for exact provenance and validation. Keep subsequent work in separate changes. Branding approval is not a dependency-security waiver or trademark clearance.
