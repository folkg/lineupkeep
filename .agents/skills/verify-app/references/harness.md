# Application verification harness

Use Node.js 24, Bun, Docker, and Playwright Chromium (`bunx playwright install chromium`). Runs use disposable PostgreSQL, never the retained Alchemy development database. macOS/Linux are supported; Windows and remote/shared-host Docker daemons are not.

## Commands

```sh
bun run verify --criteria e2e/scratch/<task>/criteria.json --grep '<title>' e2e/<spec>.e2e.ts
bun run verify --criteria <file> --target cloudflare ...
bun run verify --criteria <file> --target container ...
bun run verify --criteria <file> --video ...
bun run verify --timeout 45m ...
bun run verify --recover
bun run verify --help
```

Without selection, committed E2Es run; scratch tasks must be explicitly selected and are retained with evidence. `--grep` is a Playwright expression. The deadline includes checkout-lock waiting. Video slows browser actions; measure without it.

The runner reads synthetic `e2e/e2e.env`, not root `.env`, and sanitizes inherited cloud credentials/profiles. Never configure real keys in test env. Cloudflare also rejects leftover `.dev.vars*` beside its deployment files.

## Ownership and recovery

Verification and E2E targets share a checkout lock. The supervisor journals the exact manifest, stack/stage/cwd, source identity, processes, and Docker ownership before creation. Alchemy owns resources and ready endpoints; Playwright never starts the application server. Runs retain evidence before bounded destroy, and release ownership only after confirmed process/container/resource absence.

For an abandoned/interrupted run use **`bun run verify --recover`**. Recovery replays the exact journaled Alchemy identity before ownership-checked interrupted/late-create sweeps. Never delete `.alchemy` or locks first, kill by port, or manually remove processes/containers. If the owner is still running, wait. If journals are damaged or recovery incomplete, inspect the reported evidence and ask for help.

Local state is sensitive, not shareable evidence. Caches/logs can remain after resource records are destroyed. Process tracking is observational; detached descendants can escape it. An unreleased listening port prevents lock release. This is isolation, not a hostile-code sandbox.

Source is fingerprinted before/after runs. Do not edit or launch competing builds while testing. Different checkouts require independent dependencies, build/temp paths, and local state; do not symlink shared `node_modules`.

## Proof surfaces

[Browser](browser.md), [MCP](mcp.md), and [services](services.md) assertions prove different contracts. Read the [service execution boundary](services.md#execution-boundary); setup/call labels are not proof. A service-only test opens no page.

All targets use non-deployable test composition: `PublicInternet` metadata routing and an authenticated service route with selected scenario programs. Normal builds exclude them; target verification rejects compiled test markers. **Never deploy test artifacts.** Auth, database, domain services, and protocol handlers otherwise retain production composition.

Container verification packages the production Node image. Its loopback dependencies use run-scoped relays via `host.docker.internal`, which Docker resolves through `host-gateway` on Docker Desktop and Linux. On Linux the relay binds the inspected IPv4 bridge gateway after trying to bind that address, because Docker's bridge interface can be down and absent from `os.networkInterfaces()` until a container attaches. Relays bind only to an inspected, bindable IPv4 gateway, never wildcard or LAN addresses; unsafe gateways fail closed with the inspected values. Remote Docker engines are unsupported. Application publication remains host-loopback only. Only plain Node provides server CPU profiles.

## Criteria and claims

Declare before running:

```json
{
  "request": "What was asked",
  "criteria": [{ "id": "C1", "statement": "Observable outcome" }]
}
```

Inspect `summary.md`, tests, steps, artifacts, and failures; then write `claims.json` in the printed `.artifacts/verify/<run-id>/` directory:

```json
{
  "request": "What was asked",
  "criteria": [
    {
      "id": "C1",
      "statement": "Observable outcome",
      "status": "passed",
      "assertions": [{ "test": "exact test title", "step": "exact step title" }],
      "artifacts": ["test-results/<test>/result.png"],
      "observation": "What the assertions established"
    }
  ],
  "limitations": ["What this does not prove"],
  "video": "not-requested"
}
```

Match request, IDs, and statements unchanged. Answer every criterion with `passed`, `failed`, `blocked`, or `not-tested`. Disclose every non-passing test and explain blocked/untested scope. Passing citations need actual passing assertions, not setup; whole-test citations have no video position. Copy exact titles/relative artifact paths from the summary. Keep paths inside the run directory.

Run `bun run verify:review "$RUN_DIR"`. It validates source, cleanup, citations, attachments, and any reviewed video, then writes `delivery.json`, `report.md`, and self-contained `report.html`. READY can include honestly reported failures. [Evidence code](../../../../e2e/verify/evidence.ts) and [review code](../../../../e2e/verify/review.ts) own shapes/validation; inspect run files for detailed diagnostics. Keep failed evidence.

## Evidence privacy

Fixture credentials stay in memory; shared redaction removes known credential forms before attachment. Use synthetic payloads: tool arguments/results and service observations are deliberately retained. Never return another User's credentials or attach private production data. Redaction cannot guarantee arbitrary payload anonymity.

Share redacted call artifacts and generated reports, not raw browser traces as credential-safe evidence. Traces can contain authorization state. `alchemy-run.json`, endpoints, and local state are restricted recovery data, not shareable artifacts.

Local builds with PostgreSQL/fake Resend do not establish real delivery, Google OAuth, deployed pooling, IAM, routing, production CPU/latency, or backup restoration. Skips, expected failures, and incomplete execution are not passing proof.
