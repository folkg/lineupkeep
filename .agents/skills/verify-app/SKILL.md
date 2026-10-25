---
name: verify-app
description: Prove application behavior through browser interaction, MCP clients, backend public services, or combinations; retain assertion-linked evidence, performance measurements, or reviewed walkthroughs.
compatibility: macOS or Linux, pinned Node and Bun, Docker, and Playwright Chromium. Video also needs FFmpeg and ffprobe.
---

# Verify application behavior

You own judgment; the harness owns isolated infrastructure, evidence, and cleanup. Read [harness usage](references/harness.md) for commands, ownership/recovery, criteria/claims format, and evidence privacy.

## Choose the proof

Declare falsifiable observable criteria in `e2e/scratch/<task>/criteria.json` before running, based on requested behavior rather than implementation as its own oracle.
Choose the claimed surface:

- [Browser](references/browser.md): what a person sees/does.
- [MCP](references/mcp.md): discovery, scoped authorization, actual tool calls, and serialization; direct handlers are not protocol proof.
- [Services](references/services.md): public backend rules and persisted effects, not adapter behavior. Read its [execution boundary](references/services.md#execution-boundary) before service-only proof.

Setup is never proof. Enter the production worker/scheduling path when claiming that behavior; component fixtures do not establish built-app hydration/navigation.
Reuse sufficient regressions at the [appropriate test layer](../testing/SKILL.md). Change-specific scenarios/helpers stay in ignored `e2e/scratch/<task>/`, importing `#e2e/support.ts`.

## Exercise and inspect

Arrange through public services with real sessions and named personas; do not bypass domain rules for prerequisites.
Assert baseline, act across the claimed contract, assert result, and independently inspect persisted state. Name steps `Baseline:`, `Action:`, `Result:`, or `Persistence:` and identify actors.
Distinguish rejection from uncertainty. Observe asynchronous outcomes with deadline-bounded `expect.poll`, never sleeps. Checkpoints follow assertions; screenshots alone prove no correctness.
Inspect statuses, steps, relevant artifacts, and failures—not just exit codes. Keep failed evidence and use fresh runs for corrections.

## Deliver

Answer the unchanged criteria in `claims.json`, including failed, blocked, and untested scope, with exact passing assertion citations and limitations.
Run `bun run verify:review "$RUN_DIR"` and share its report. READY means internally consistent evidence, not universal success or production acceptance.
Use [performance](references/performance.md) for measurement without video; [video](references/video.md) owns browser-only narration/media review and nonvisual `shots.notShown` claims.
Verification supplements required checks. Scenarios/evidence remain uncommitted; delete retained evidence only when asked.
