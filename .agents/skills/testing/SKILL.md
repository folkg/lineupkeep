---
name: testing
description: Choose and write regression tests for pure logic, Effect services, browser interactions, and built-app integration.
---

# Test public behavior

Use vertical red-green-refactor cycles: one failing observable behavior, the smallest implementation, then refactor.
Inject dependencies; **no module mocks**, including `vi.mock`, `vi.doMock`, and `vi.hoisted`. Mock only external seams, not domain logic or implementation imports. Do not use `toHaveBeenCalled*` or `.mock.calls` / `.mock.results`; assert returned values, persisted state, or visible behavior instead.

## Choose the layer

- **Node:** pure logic and event-replayed workflows; Effect public-service behavior with real migrated storage for persistence. Use `it.effect` for Effect tests and committed migrations through Test Layers.
- **Browser mode:** views/controllers together for focus, keyboard, timing races, and recovery under injected delayed/rejected/unconfirmed remotes. Do not exactly duplicate E2E happy paths.
- **E2E:** production-build integration, persistence, authentication, hydration, and navigation. Component fixtures cannot prove built-app integration. Use Playwright against isolated infrastructure; each test signs up its own email-code account through fake Resend.

## Choose valuable proof

- Keep proof of distinct broken public behavior at its owning layer; remove redundant setup and assertions.
- Avoid private SQL recipes, call/cache layouts, configuration echoes, dependency behavior, and tests that require known limitations. Retain explicit protocol, security, and resource-ownership contracts.
- Size fixtures to real owned boundaries. Preserve distinct policy, syntax, override, and exception partitions, not copies that only rename filenames.
- Do not supply the behavior under test in arrangement. Use positive sensitivity controls so privacy and cleanup assertions cannot pass on empty observations or inactive producers.

## Workflows and machines

| Test             | Requirement                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Exploration      | Required: check invariants on every reachable state and require complete transition coverage.                                                 |
| Property tests   | Required where events carry data: generate event sequences and payloads with fixed seeds and about 100 runs; print replay details on failure. |
| Codec round trip | Required wherever a machine-state row codec exists; cover every explored state and generated values.                                          |
| Story tests      | Optional: keep one or two when they make the behavior easier to read.                                                                         |

Every workflow or codec module has its own test file; lint rules check those tests' contents.

Order each workflow test file: exploration, property tests, then optional stories. One test proves one behavior. Tests live beside the module that owns the behavior; codec tests belong with the codec, not the machine.
Clients use `browser/workflow/workflowTest.ts` (`exploreWorkflow` and `play`) with fast-check. Backend machines use `MachineTest.explore` and `MachineTest.scenarios` with `effect/Arbitrary`. Derive coverage from the machine definition, not a hand-written transition list.

## External HTTP boundaries

Use MSW 3 for HTTP transport tests at an external boundary, such as an email provider: exercise the real client and assert request content and response handling. Never use MSW for domain logic; inject a service or its Test Layer for application tests.
Create fresh MSW interception per test through a disposable setup, reject unhandled requests strictly, and close interception on disposal. Keep transport tests serial because interception is process-global. MSW cannot prove DNS pinning, TLS identity, or SSRF protection; retain the capability's dedicated security tests.

## Suite parallelism

`bun checks` runs files concurrently in one worker pool sized from available parallelism; tests inside a file run in order. A file must therefore own its database, temporary directories, and loopback ports, and any process-wide state (environment variables, globals, interception) belongs to the single file that sets it. Keep a file serial when its cases share that state, and use `test.concurrent` only where each case allocates its own resources.

## E2E discipline

Use role/name locators and web-first assertions; poll measured layout instead of taking an instant snapshot.
Prove hydration with held client scripts: SSR controls stay disabled until handlers attach. Never hide lost actions with sleeps or retries.
Keep zero retries and first-failure traces/screenshots; reject flaky passes if retries are requested. Treat traces as credential-bearing local evidence.
Create Users per test, arrange unrelated prerequisites through public service fixtures, and keep contexts Playwright-managed so failure teardown retains artifacts.
Bound worker concurrency to available resources; diagnose contention before changing deadlines. Wait for asserted UI completion and actual requests, not arbitrary network quiet periods.
Keep injected race/failure/focus combinations in browser mode; retain E2Es for built integration and persisted outcomes.
Exercise cold shared initialization across independent runtime instances; one shared fixture instance can hide database races.

## Author and finish

Keep one test file per module, flat cases, and observable assertions rather than mock history or private structure.
Separate setup/action/assertions with whitespace and use present-tense test names.
Assert accessible roles/names for browser controls, not markup or styling classes.
Dispose mounted UI and Query clients; await observable completion before ending tests.
Use Query/router settlement or deadline-bounded polling, never sleeps or weakened timeouts.
Group guardrail acceptance/rejection fixtures by tool; every rule needs a constructive remedy.
Follow the [required check matrix](../../../README.md#commands-and-required-checks).
For browser/MCP/service evidence and ownership-safe execution, use [verify-app](../verify-app/SKILL.md).

## Fixture ownership

Each test creates fresh mutable fixtures through setup functions returning `Disposable` / `AsyncDisposable`, bound with `using` / `await using`.
The disposer owns cleanup, and failed setup releases partial acquisitions.
Do not populate shared module/describe fixture variables through lifecycle hooks; test-local native cancellation/completion finalizers may invoke the same disposal.
Build Effect fixtures in each test's own scope with native acquisition/finalization and per-test layer provision; keep framework-owned run infrastructure in its native lifecycle.
