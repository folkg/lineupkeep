# Lineupkeep

**Your lineup. Looked after.**

An independent, provider-neutral fantasy-management product, prepared from a fresh Effect/Solid starter. This is a **complete rewrite**, not an AutoCoach fork, port, migration, or facelift.

## Start here

1. [Project handoff](START-HERE.md): scope, implementation boundary, source references, and next work.
2. [Product](PRODUCT.md), [branding](docs/brand/BRAND.md), and [design system](DESIGN.md).
3. [Implementation plan](docs/fantasy-manager/IMPLEMENTATION-PLAN.md), [delivery stages](docs/fantasy-manager/DELIVERY-PLAN.md), and [test strategy](docs/fantasy-manager/TESTING.md).
4. [Planning index](docs/fantasy-manager/README.md): all decisions, research, glossary, MCP/architecture/hosting proposals, UX brief, and ADRs.
5. [Setup provenance](docs/SETUP.md) and [release readiness](docs/release-readiness.md).

**Current state:** independent repository, brand/design-system foundation, retained starter authentication, and a first connections vertical that starts and cancels provider-link requests. The Notes demo is removed. Provider-linking completion, provider queries, lineup setting, scheduling, and optimization are **not implemented**. The current dependency baseline has a documented critical publication blocker. The [autonomous Phase 1 mandate](docs/PHASE-1-HANDOFF.md) records implementation/setup authority and conditional rollout gates; current checks are not release acceptance.

The lowercase wordmark is **lineupkeep**; ordinary prose uses **Lineupkeep**. The approved palette is **royal violet and gold**, with complete light/dark themes. No domain has been purchased or production origin configured.

## Reference, not inheritance

AutoCoach can supply historical research and reverse-engineered provider knowledge. It does not supply this application's implementation or architecture. There is no migration of users, data, credentials, infrastructure state, or history. Make deliberate decisions across architecture, algorithms, infrastructure, Alchemy IaC, testing, accessibility, security, and operations. “Ground up” does not mean rewriting sound starter platform services or ignoring verified evidence.

## Repository

Jujutsu owns version control. There is one flattened starter baseline, followed by focused Lineupkeep preparation/branding changes and an empty working copy for the next assigned task. No remote is configured. Use `jj status`, `jj log`, and `jj diff`; do not use Git commands.

## Start locally

Install the Node and Bun versions pinned in `.nvmrc` and `package.json`, plus Docker.

```sh
cp .env.example .env
bun install
bun run dev
```

Open <http://127.0.0.1:3000>. `bun run dev` runs Node development. Stop it before switching to `bun run dev:cloudflare`, Alchemy's local Vite/workerd target with the same retained PostgreSQL data for this checkout. Neither needs cloud credentials. Verification uses separate disposable data.
Without Resend configuration, development prints sign-in emails/codes to the server console; tests use outboxes/fake Resend, never real mail.
Developer commands own origin and migrated database. Ctrl-C stops the app, not its database; `db:stop` retains data and `db:start` resumes it.
**`bun run db:reset` deletes development data**, with typed confirmation or explicit `--yes`. Export needed data and stop development before maintenance.

## Commands and required checks

Bun installs dependencies and dispatches scripts; Node is the default runtime for application/tooling code. `package.json` owns commands.

| Command                                | When / purpose                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bun checks`                           | Every committed-code change: format, type-aware lint, architecture, unused code, tests, both builds |
| `bun run test:node` / `test:browser`   | Focused Node/tooling or browser regressions                                                         |
| `bun run test:e2e`                     | Routes, UI, authentication, or server functions; production Node integration                        |
| `bun run test:e2e:cloudflare`          | Server entry, backend runtime, database/auth composition, or deployment target                      |
| `bun run test:e2e:container`           | Node image, Dockerfile, container build/publication, host runtime, or container networking          |
| `bun run targets:verify`               | Deployment-adapter upgrades or build/infrastructure changes; credential-free artifact checks        |
| `bun run db:generate` / `db:migrate`   | Generate/review committed migrations / apply to stopped development                                 |
| `bun run verify --criteria <file> ...` | Assertion-linked evidence; see [verify-app](.agents/skills/verify-app/SKILL.md)                     |

E2Es require Docker and are excluded from `checks`. Run all affected targets, all three if in doubt. Never run builds/E2Es/verification concurrently or edit source during an owned run. [Harness recovery](.agents/skills/verify-app/references/harness.md#ownership-and-recovery) owns interrupted runs.

## Loading and mutations

Pages wait for primary data; writes return refreshed page data in the same response. See [loading and single-flight](docs/loading-and-single-flight.md) for loading choices, how writes refresh the page, and framework upgrade checks.

## Package imports

Use `./module` for same-directory imports, package-owned `#…` imports for other directories, and `@lineupkeep/<package>/…` exports across packages. Each package owns its aliases in `package.json`; `bun run lint` autofixes parent-relative imports. For example, web modules use `#browser/connections/connectionQueries.ts` or `#contracts/connections/connectionContract.ts`, and backend modules use `#contexts/auth/User.ts` or `#database/dbUtilities.ts`. Keep explicit file extensions in aliases so Node and build tools resolve the same file. New domains fit the existing role wildcards without updating an alias inventory.

## Next work

The owner has chosen to proceed with local implementation on the current pinned baseline while awaiting a coherent security fix. Follow the [delivery stages](docs/fantasy-manager/DELIVERY-PLAN.md), resolving feasibility at each owning slice; keep the security fix as a pre-publication gate rather than a blanket local-development stop. Remain loopback-only and do not publicly tunnel the vulnerable transport. Use the [autonomous Phase 1 handoff](docs/PHASE-1-HANDOFF.md) for the complete assignment, authorized GCP CLI setup, secure credential provisioning, and conditional deployment gates. Do not ask for a new assignment after each internal slice. The Notes demo is removed; the connections vertical is scaffolding for linking, not a finished product surface.

## Connecting an MCP client

Connect a stateless **MCP 2026-07-28** client to `https://<host>/mcp`; earlier session-based revisions are unsupported. Follow challenge/resource metadata and authorization-server discovery; use authorization code with S256 PKCE, endpoint `resource`, and explicit scope consent. Request `offline_access` for renewable access.
Dynamic Client Registration is disabled. Publish an HTTPS client metadata document at a public non-root `client_id` URL with matching identity and registered callback. Metadata redirects/private destinations are rejected; native loopback callbacks are allowed.
Use `tools/list` for live schemas/scopes/hints. Retry unconfirmed creation only with the same request identity/content; inspect current state before repeating other writes. Store rotated refresh tokens.
Browser sign-out does not revoke offline grants: disconnect through `/api/auth/oauth2/revoke`. Issued access tokens may remain valid until expiry. OAuth setup proves no tool behavior; local workerd proves no production routing guarantee.

## Deployment

The [owner runbook](docs/deployment.md) owns protected state, provider setup, migration safety, and production acceptance. No local check authorizes deployment.
