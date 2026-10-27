# Lineupkeep working agreement

## Independent rewrite and authorization

Lineupkeep is a complete, provider-neutral rewrite. AutoCoach is reference material only: do not transplant its implementation, architecture, algorithms, credentials, data, deployment files, or managed resources. Reuse verified knowledge and make deliberate decisions; retain sound starter platform foundations rather than rebuilding them without a reason.

Read [START-HERE.md](START-HERE.md), [PRODUCT.md](PRODUCT.md), the [implementation plan](docs/fantasy-manager/IMPLEMENTATION-PLAN.md), and the [agreed glossary](docs/fantasy-manager/GLOSSARY.md) before implementation. The owner wants autonomous completion of Phase 1 under [the handoff mandate](docs/PHASE-1-HANDOFF.md), using bounded internal slices rather than repeated owner approvals, while awaiting a coherent upstream security fix. The documented vulnerable transport is a publication gate, not a blanket stop on local development: remain loopback-only, do not expose it through a public tunnel, and retain the required upgrade/security acceptance. The owner authorizes use of their GCP CLI for fresh Lineupkeep setup; the handoff records conditional rollout authority and unresolved billing/budget, secure access, framework-pin, and live-provider gates. Do not infer destination approval from the active CLI project. Preparing the handoff did not itself begin feature execution.

Use jj, not Git. Keep work as focused, described jj changes; finish a completed task with a fresh empty working copy. Never rewrite the source starter or AutoCoach repository. No remote or production resources are configured.

The approved identity is Lineupkeep, lowercase lineupkeep in the wordmark, with royal violet and gold in both light and dark. Preserve professional solidity and sporting energy; do not substitute green or reopen palette selection during routine implementation. [DESIGN.md](DESIGN.md), [.impeccable/design.json](.impeccable/design.json), and [brand notes](docs/brand/BRAND.md) replace the starter identity. The connections surface pairs and approves the local helper, which uploads an encrypted, owner-scoped provider session through a narrow authenticated endpoint. Do not invent live features, results, testimonials, projections, or registered-domain ownership.

## Starter platform agreement

## Commands and checks

Use the pinned Node runtime by default and Bun package manager.
While iterating, run one file with `bunx vitest run --project node <path>` (or `--project chromium <path>` for a Chromium-launching test, or `--project browser <path>`).
Run `bun checks` before completing each jj change; do not start a new jj change with failing checks.
After completing your entire task, run the E2E test suite with `bun run test:e2e`.
Before deploying, run each deployment E2E target (`test:e2e:cloudflare`, `test:e2e:container`). Run suites serially

## Safety

Deploy nothing without owner authorization; the [runbook](docs/deployment.md) owns cloud/state, migration, and acceptance decisions.
Do not edit source or launch competing builds while a test or verification run owns the checkout.
Recover interrupted runs with `bun run verify --recover`; never delete locks/state or manually kill processes/containers.
Follow [harness ownership](.agents/skills/verify-app/references/harness.md#ownership-and-recovery); independent checkouts need independent dependencies, outputs, and state.
Stop development before database maintenance. Only confirmed `db:reset` deletes development data; verification must use disposable storage.
Before broad prerelease changes, inspect pinned source, official docs, catalog, and patches; reproduce regressions before removing workarounds. Clean-install linker changes and apply committed migrations after upgrades.

## Task-triggered guidance

- Adding a domain: [add-domain](.agents/skills/add-domain/SKILL.md); terms live in [GLOSSARY.md](GLOSSARY.md).
- Pages, reads, writes, recovery, or navigation: [web-interactions](.agents/skills/web-interactions/SKILL.md).
- Writing tests: [testing](.agents/skills/testing/SKILL.md); use vertical red-green-refactor and public behavior.
- IO or telemetry: [observability](.agents/skills/observability/SKILL.md); `bun run effect-solutions -- show <topic>` is optional guidance, not boundary authority.
- Browser, MCP, service, performance, or walkthrough evidence: [verify-app](.agents/skills/verify-app/SKILL.md), including the service execution boundary.
  Native [import](.dependency-cruiser.ts) and [lint](oxlint.config.ts) policies and their fixtures own enforceable boundaries; do not bypass them.

## Performance

Batch first: repositories and application services accept arrays; singular callers pass `[input]`. Gather IDs and commands, then call once. Never perform per-item service/repository IO in loops, `Effect.forEach`, or arrays assembled for `Effect.all`/`Promise.all`. Use set-based writes and atomic mutations; bounded parameter-limit chunking belongs inside persistence. Add pragmatic owner/filter/order indexes for actual access paths; measure before specializing. The binding-aware lint rule catches direct imported services and simple aliases, not arbitrary interprocedural IO.
Add useful indexes for actual access paths, but do not over-index speculatively. Additional indexes can be added later after performance problems are observed. Err on the side of fewer indexes, not more, to avoid unnecessary write overhead.
