# Lineupkeep

**Your lineup. Looked after.**

An independent, provider-neutral fantasy-management product, prepared from a fresh Effect/Solid starter. This is a **complete rewrite**, not an AutoCoach fork, port, migration, or facelift.

## Start here

1. [Project handoff](START-HERE.md): scope, implementation boundary, source references, and next work.
2. [Product](PRODUCT.md), [branding](docs/brand/BRAND.md), and [design system](DESIGN.md).
3. [Implementation plan](docs/fantasy-manager/IMPLEMENTATION-PLAN.md), [delivery stages](docs/fantasy-manager/DELIVERY-PLAN.md), and [test strategy](docs/fantasy-manager/TESTING.md).
4. [Planning index](docs/fantasy-manager/README.md): all decisions, research, glossary, MCP/architecture/hosting proposals, UX brief, and ADRs.
5. [Setup provenance](docs/SETUP.md) and [release readiness](docs/release-readiness.md).

**Current state:** independent repository on the approved brand/design system, with retained starter authentication, hosted browser linking with a local-helper fallback, owner-scoped encrypted Yahoo connections, team discovery, bounded provider queries, durable native `set_lineup` runs, hourly current-period automation, and reconnect notifications. The Notes demo is removed. Scoring/solver work remains Phase 2. The `cloud-run` stage is deployed in `lineupkeep-prod`; [the deployed environment](docs/deployment.md#deployed-environment-2026-10-25) and [the redacted live acceptance record](docs/phase-1-acceptance-2026-10-25.md) own the inventory, evidence and remaining gates. The current dependency baseline still has a documented critical publication blocker and an applied temporary backport; deployment is not blanket security acceptance.

The lowercase wordmark is **lineupkeep**; ordinary prose uses **Lineupkeep**. The approved palette is **royal violet and gold**, with complete light/dark themes. No domain has been purchased; the deployed Cloud Run origin is the configured public origin.

## Reference, not inheritance

AutoCoach can supply historical research and reverse-engineered provider knowledge. It does not supply this application's implementation or architecture. There is no migration of users, data, credentials, infrastructure state, or history. Make deliberate decisions across architecture, algorithms, infrastructure, Alchemy IaC, testing, accessibility, security, and operations. “Ground up” does not mean rewriting sound starter platform services or ignoring verified evidence.

## Repository

Jujutsu owns version control. There is one flattened starter baseline, followed by focused Lineupkeep preparation/branding changes and an empty working copy for the next assigned task. No remote is configured. Use `jj status`, `jj log`, and `jj diff`; do not use Git commands.

## Start locally

Install the Node and Bun versions pinned in `.nvmrc` and `package.json`, plus Docker.

```sh
cp .env.example .env
bun install
bunx playwright install chromium   # once, for hosted browser sign-in
bun run dev
```

Open <http://127.0.0.1:3000>. `bun run dev` runs Node development. Stop it before switching to `bun run dev:cloudflare`, Alchemy's local Vite/workerd target with the same retained PostgreSQL data for this checkout. Neither needs cloud credentials. Verification uses separate disposable data.
Without Resend configuration, development prints sign-in emails/codes to the server console; tests use outboxes/fake Resend, never real mail.
Developer commands own origin and migrated database. Ctrl-C stops the app, not its database; `db:stop` retains data and `db:start` resumes it.
**`bun run db:reset` deletes development data**, with typed confirmation or explicit `--yes`. Export needed data and stop development before maintenance.

## Commands and required checks

Bun installs dependencies and dispatches scripts; Node is the default runtime for application/tooling code. `package.json` owns commands.

| Command                                | When / purpose                                                                                      | Runs E2E          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- |
| `bun checks`                           | Every committed-code change: format, type-aware lint, architecture, unused code, tests, both builds | No                |
| `bun run test:node` / `test:browser`   | Focused Node or browser regressions                                                                 | No                |
| `bun run test:e2e`                     | Routes, UI, authentication, or server functions; production Node integration                        | Node target       |
| `bun run test:e2e:cloudflare`          | Server entry, backend runtime, database/auth composition, or deployment target                      | Cloudflare target |
| `bun run test:e2e:container`           | Node image, Dockerfile, container build/publication, host runtime, or container networking          | Container target  |
| `bun run targets:verify`               | Deployment-adapter upgrades or build/infrastructure changes; credential-free artifact checks        | No                |
| `bun run db:generate` / `db:migrate`   | Generate/review committed migrations / apply to stopped development                                 | No                |
| `bun run verify --criteria <file> ...` | Assertion-linked evidence; see [verify-app](.agents/skills/verify-app/SKILL.md)                     | No                |

### `checks` never runs E2E

`bun checks` runs formatting, type-aware lint, architecture rules, unused-code detection, the Node and browser test suite, and both builds. It runs **no** E2E target, because E2E needs Docker, a production build, and real browser sessions. A green `checks` therefore never proves routes, hydration, authentication, persistence, or deployment-target behavior.

After `checks`, run the E2E targets the change can break: any page, read, write, recovery, navigation, server function, protocol route, authentication path, backend runtime, or deployment configuration change needs its affected target; run all three when in doubt. Never run builds/E2Es/verification concurrently or edit source during an owned run. [Harness recovery](.agents/skills/verify-app/references/harness.md#ownership-and-recovery) owns interrupted runs.

### Fast inner loop

While iterating, run the one file that can fail: `bunx vitest run --project node <path>` (or `--project browser <path>`, or add `-t "<test name>"`). Vitest has no changed-test cache that stays correct: `--changed` and `--related` silently skip suites reached through package aliases, so they are a convenience only and are never what `checks` runs. Finish with `bun checks` plus the affected E2E targets, not with a narrowed run.

Node and browser files share one worker pool sized from available parallelism: every file owns its migrated in-memory database, temporary directories, and ephemeral loopback ports, so a file is only serial against itself and parallel files cannot collide. A file that mutates process-wide state, such as `PATH` for a fake container runtime, owns that state for its own process only.

## Loading and mutations

Pages wait for primary data; writes return refreshed page data in the same response. See [loading and single-flight](docs/loading-and-single-flight.md) for loading choices, how writes refresh the page, and framework upgrade checks.

## Package imports

Use `./module` for same-directory imports, package-owned `#…` imports for other directories, and `@lineupkeep/<package>/…` exports across packages. Each package owns its aliases in `package.json`; `bun run lint` autofixes parent-relative imports. For example, web modules use `#browser/connections/connectionQueries.ts` or `#contracts/connections/connectionContract.ts`, and backend modules use `#contexts/auth/User.ts` or `#database/dbUtilities.ts`. Keep explicit file extensions in aliases so Node and build tools resolve the same file. New domains fit the existing role wildcards without updating an alias inventory.

## Next work

The owner has chosen to proceed with local implementation on the current pinned baseline while awaiting a coherent security fix. Follow the [delivery stages](docs/fantasy-manager/DELIVERY-PLAN.md), resolving feasibility at each owning slice; keep the security fix as a pre-publication gate rather than a blanket local-development stop. Remain loopback-only and do not publicly tunnel the vulnerable transport. Use the [autonomous Phase 1 handoff](docs/PHASE-1-HANDOFF.md) for the complete assignment, authorized GCP CLI setup, secure credential provisioning, and conditional deployment gates. Do not ask for a new assignment after each internal slice. The Notes demo is removed; the connections vertical is scaffolding for linking, not a finished product surface.

## Link a Yahoo account

Open **Connections** and choose **Connect Yahoo**. A private browser opens inside the page; sign in there once. Lineupkeep never stores your password, and keystrokes are relayed only to that temporary browser. When Yahoo accepts the sign-in, the connection becomes ready, teams are discovered automatically, and the app opens **Teams**. No install, code copy, or second approval is required. The temporary browser profile is destroyed when the session ends.

Hosted sign-in runs on the Node target. The Cloudflare target returns `hosted_browser.unsupported`; the dedicated production browser service is [planned but not provisioned](docs/fantasy-manager/HOSTED-BROWSER-INFRA-PLAN.md). The local helper remains the fallback when hosted sign-in is unavailable:

```sh
./node_modules/.bin/lineupkeep link
```

The helper prints a public pairing code and the app's Connections URL. Open that URL, sign in to Lineupkeep, enter the code, and approve the helper. It opens Yahoo in a dedicated temporary Chromium profile; sign in there and leave the window open until the helper reports success. The app validates the session and stores an encrypted connection, and the helper removes the temporary profile when it finishes.

Use `--app-url <origin>` (or `LINEUPKEEP_APP_URL`) when the app is not at `http://localhost:5173`, and `--help` for the full usage. The helper keeps the device code and access token in memory, never in command arguments or output, and never reads your normal browser profile. The token authorizes only the credential upload and expires on its own. Live linking requires a Yahoo account and is not part of the automated test suite; see [the helper README](apps/linking-helper/README.md).

## Connecting an MCP client

Connect a stateless **MCP 2026-07-28** client to `https://<host>/mcp`; earlier session-based revisions are unsupported. Follow challenge/resource metadata and authorization-server discovery; use authorization code with S256 PKCE, endpoint `resource`, and explicit scope consent. Request `offline_access` for renewable access.
Dynamic Client Registration is enabled for public clients at `POST /api/auth/oauth2/register`; PKCE is required and redirect URIs are validated. Clients that cannot self-register may instead use an HTTPS client metadata document as their `client_id`. Metadata redirects/private destinations are rejected; native loopback callbacks are allowed.
Use `tools/list` for live schemas/scopes/hints. Retry unconfirmed creation only with the same request identity/content; inspect current state before repeating other writes. Store rotated refresh tokens.
Browser sign-out does not revoke offline grants: disconnect through `/api/auth/oauth2/revoke`. Issued access tokens may remain valid until expiry. OAuth setup proves no tool behavior; local workerd proves no production routing guarantee.

## Deployment

The [owner runbook](docs/deployment.md) owns protected state, provider setup, migration safety, and production acceptance. No local check authorizes deployment.
