# Sourdough Starter

An authenticated Node.js web application starter using Solid, TanStack Start/Query, Effect, Drizzle, and PostgreSQL.
Every application created from this starter replaces Notes with its own domain; the product and design documents describe the shipped application.

**Pre-v1:** see [release readiness](docs/release-readiness.md) for publication blockers, accepted version holds and optional adoption gates.

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

Use `./module` for same-directory imports, package-owned `#…` imports for other directories, and `@sourdough/<package>/…` exports across packages. Each package owns its aliases in `package.json`; `bun run lint` autofixes parent-relative imports. For example, web modules use `#browser/notes/noteQueries.ts` or `#contracts/notes/noteContract.ts`, and backend modules use `#contexts/auth/User.ts` or `#database/dbUtilities.ts`. Keep explicit file extensions in aliases so Node and build tools resolve the same file. New domains fit the existing role wildcards without updating an alias inventory.

## Seed checklist

- [ ] **Choose a fresh identity:** display/repository/package names, `@sourdough/*` namespace, canonical origin, telemetry service/version, stack/resource and stage identities. Update imports, manifests, aliases, policy fixtures, metadata, copy, accessible names, and assertions; regenerate the lockfile with Bun. Never rename existing managed state by text replacement.
- [ ] **Record the real product:** replace [PRODUCT](PRODUCT.md) and [GLOSSARY](GLOSSARY.md) with users/jobs/terms; choose brand identity and refresh [DESIGN](DESIGN.md) and Impeccable sidecar/previews together. Invent no customer research.
- [ ] **Add your domain:** follow [add-domain](.agents/skills/add-domain/SKILL.md), including tests and genuine integration wiring.
- [ ] **Remove Notes outside in:** routes/navigation, MCP tools/scopes/registrations, server functions/contracts/remotes/controllers/workflows/views, then backend runtime Layers/repositories/tables and fixtures. Retain shared auth, query, navigation, UI, and telemetry; update actual import permissions, not incidental domain lists.
- [ ] **Handle database history:** only a never-deployed fresh seed may regenerate the initial migration. Retained/local/remote data requires backup and reviewed forward migrations; never rewrite applied history or assume sample data is expendable.
- [ ] **Select deployment lifecycle:** review stage/host/region/registry/database and preview isolation. Separate application data, protected state, retained development, and disposable verification; define restore ownership and serialized migrations/rollouts in the [runbook](docs/deployment.md).
- [ ] **Configure integrations:** follow annotated [.env.example](.env.example) for auth origin, independent production secrets, sender/Resend, trusted ingress, optional Google branding/callbacks, and provider inputs. Keep provisioning/state secrets out of runtime/build/tests; generated URLs/ports/bindings remain composition-owned.
- [ ] **Verify before requesting deployment:** checks, affected E2Es, artifact verification, and appropriate browser/MCP/service evidence. Search for unintended sample identities; obtain authorization for the reviewed plan. Local success authorizes nothing remotely.

## Connecting an MCP client

Connect a stateless **MCP 2026-07-28** client to `https://<host>/mcp`; earlier session-based revisions are unsupported. Follow challenge/resource metadata and authorization-server discovery; use authorization code with S256 PKCE, endpoint `resource`, and explicit scope consent. Request `offline_access` for renewable access.
Dynamic Client Registration is disabled. Publish an HTTPS client metadata document at a public non-root `client_id` URL with matching identity and registered callback. Metadata redirects/private destinations are rejected; native loopback callbacks are allowed.
Use `tools/list` for live schemas/scopes/hints. Retry unconfirmed creation only with the same request identity/content; inspect current state before repeating other writes. Store rotated refresh tokens.
Browser sign-out does not revoke offline grants: disconnect through `/api/auth/oauth2/revoke`. Issued access tokens may remain valid until expiry. OAuth setup proves no tool behavior; local workerd proves no production routing guarantee.

## Deployment

The [owner runbook](docs/deployment.md) owns protected state, provider setup, migration safety, and production acceptance. No local check authorizes deployment.
