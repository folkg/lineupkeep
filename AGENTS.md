# Project Working Agreement

## Commands and checks

Use the pinned Node runtime by default and Bun package manager.
Run `bun checks` after every change to committed code; do not finish with failing checks.
Follow the [README check matrix](README.md#commands-and-required-checks) for additional E2E and artifact checks. Run suites serially.

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

Batch first: repositories and application services accept arrays; singular callers pass `[input]`. Gather IDs and commands, then call once—never perform per-item service/repository IO in loops, `Effect.forEach`, or arrays assembled for `Effect.all`/`Promise.all`. Use set-based writes and atomic mutations; bounded parameter-limit chunking belongs inside persistence. Add pragmatic owner/filter/order indexes for actual access paths; measure before specializing. The binding-aware lint rule catches direct imported services and simple aliases, not arbitrary interprocedural IO.
