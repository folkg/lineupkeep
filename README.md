# Lineupkeep

**Your lineup. Looked after.**

An independent, provider-neutral fantasy-management product, prepared from a fresh Effect/Solid starter. This is a **complete rewrite**, not an AutoCoach fork, port, migration, or facelift.

## Start here

1. [Project handoff](START-HERE.md): scope, implementation boundary, source references, and next work.
2. [Product](PRODUCT.md), [branding](docs/brand/BRAND.md), and [design system](DESIGN.md).
3. [Implementation plan](docs/fantasy-manager/IMPLEMENTATION-PLAN.md), [delivery stages](docs/fantasy-manager/DELIVERY-PLAN.md), and [test strategy](docs/fantasy-manager/TESTING.md).
4. [Planning index](docs/fantasy-manager/README.md): all decisions, research, glossary, MCP/architecture/hosting proposals, UX brief, and ADRs.
5. [Setup provenance](docs/SETUP.md) and [release readiness](docs/release-readiness.md).

**Current state:** independent repository on the approved brand/design system, with retained starter authentication, hosted browser linking, owner-scoped encrypted Yahoo connections, team discovery, bounded provider queries, durable lineup runs, hourly current-period automation, reconnect notifications, and owner-scoped feedback from the app and MCP clients. The Notes demo is removed. Provider scoring, the pure solver, and the Phase 2 cutover are implemented locally; Phase 2 deployment and live acceptance remain. The `cloud-run` stage is deployed in `lineupkeep-prod`; [the deployed environment](docs/deployment.md#deployed-environment-2026-10-25) and [the redacted live acceptance record](docs/phase-1-acceptance-2026-10-25.md) own the inventory, evidence and remaining gates. The current dependency baseline still has a documented critical publication blocker and an applied temporary backport; deployment is not blanket security acceptance.

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

## Loading and mutations

Pages wait for primary data; writes return refreshed page data in the same response. See [loading and single-flight](docs/loading-and-single-flight.md) for loading choices, how writes refresh the page, and framework upgrade checks.

## Package imports

Use `./module` for same-directory imports, package-owned `#…` imports for other directories, and `@lineupkeep/<package>/…` exports across packages. Each package owns its aliases in `package.json`; `bun run lint` autofixes parent-relative imports. For example, web modules use `#browser/connections/connectionQueries.ts` or `#contracts/connections/connectionContract.ts`, and backend modules use `#contexts/auth/User.ts` or `#database/dbUtilities.ts`. Keep explicit file extensions in aliases so Node and build tools resolve the same file. New domains fit the existing role wildcards without updating an alias inventory.

## Next work

The owner has chosen to proceed with local implementation on the current pinned baseline while awaiting a coherent security fix. Follow the [delivery stages](docs/fantasy-manager/DELIVERY-PLAN.md), resolving feasibility at each owning slice; keep the security fix as a pre-publication gate rather than a blanket local-development stop. Remain loopback-only and do not publicly tunnel the vulnerable transport. Use the [autonomous Phase 1 handoff](docs/PHASE-1-HANDOFF.md) for the complete assignment, authorized GCP CLI setup, secure credential provisioning, and conditional deployment gates. Do not ask for a new assignment after each internal slice. The Notes demo is removed; the connections vertical is scaffolding for linking, not a finished product surface.

## Link a Yahoo account

Open **Connections** and choose **Connect Yahoo**. A private browser opens inside the page; sign in there once. Lineupkeep never stores your password, and keystrokes are relayed only to that temporary browser. When Yahoo accepts the sign-in, the connection becomes ready, teams are discovered automatically, and the app opens **Teams**. No install, code copy, or second approval is required. The temporary browser profile is destroyed when the session ends.

Hosted sign-in runs on the Node target when a Playwright Chromium is installed. The Cloudflare target and a Node image without that browser report `hosted_browser.unsupported`; the dedicated production browser service is [planned but not provisioned](docs/fantasy-manager/HOSTED-BROWSER-INFRA-PLAN.md). The hosted browser is the only linking path.

If your Yahoo account signs in with Google, Yahoo will not accept a Gmail address on the hosted sign-in page. Add a phone number to your Yahoo account and sign in with that number instead. The Connections page has the same note beside **Connect Yahoo**.

## Connecting an MCP client

Connect a stateless **MCP 2026-07-28** client to `https://<host>/mcp`; earlier session-based revisions are unsupported. Follow the `401` challenge and resource metadata, then use authorization code with S256 PKCE, the endpoint `resource`, and explicit scope consent.

### Request this scope set on the first authorization

```text
connections:read fantasy:read offline_access
```

Every tool enforces one scope and only that scope. This baseline reads connections and fantasy
data, submits feedback, and buys a refresh token. A tool that needs `transactions:review`,
`lineups:write`, `teams:manage`, or `feedback:manage` answers `403 insufficient_scope` with the
one scope it needs, so add that scope in a new authorization instead of requesting everything up
front. The `401` challenge names the same baseline, or the called tool's scope; the `403` body
names the missing scope, so a client that surfaces only a response body can still see what is
missing. Authorization-server metadata publishes the complete set—
`connections:read fantasy:read transactions:review lineups:write teams:manage feedback:manage offline_access`—while
protected-resource metadata publishes the six resource scopes, because `offline_access` buys a
refresh token from the authorization server rather than access to the resource. The full
per-tool table and the incremental-authorization behaviour are in the
[MCP contract](docs/fantasy-manager/MCP.md#per-tool-scopes).

### First requests

`server/discover` needs no token and returns only the product name, supported protocol versions, and capabilities:

```sh
curl -sS https://<host>/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2026-07-28' \
  -H 'mcp-method: server/discover' \
  --data '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1.0.0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'
```

Every other method needs a bearer access token, the protocol version in both the header and the `_meta` block, and the method and tool name in headers:

```sh
curl -sS https://<host>/mcp \
  -H 'authorization: Bearer <access-token>' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2026-07-28' \
  -H 'mcp-method: tools/call' \
  -H 'mcp-name: list_connections' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_connections","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

A tool result carries the payload twice: `structuredContent` for clients that read it, and the same JSON as text content for clients that only read text. Both copies count against the page budget, so a page fills about half of the 16 KiB ceiling; narrow with filters or `groups` rather than expecting more records per call.

### Registration

Dynamic Client Registration is enabled for public clients at `POST /api/auth/oauth2/register`; PKCE is required and redirect URIs are validated. Registration records the full scope set by default, but a grant is exactly the scope the authorization request asks for, so still request the whole set above. When a client asks for a Client ID anyway, register one and paste the returned `client_id`; there is no client secret:

```sh
curl -sS -X POST https://<host>/api/auth/oauth2/register \
  -H 'content-type: application/json' \
  --data '{"client_name":"Lineupkeep curl","redirect_uris":["http://127.0.0.1:19999/callback"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none","application_type":"native"}'
```

Clients that cannot self-register may instead use an HTTPS client metadata document as their `client_id`. Metadata fetches never follow redirects: serve the document at the exact HTTPS URL, because a redirect is refused by policy and reported separately from a network failure. Private destinations are rejected and native loopback callbacks are allowed.

A `*.run.app` hostname is long enough to truncate in some client consent forms. A short custom domain is the remedy; nothing in the protocol depends on the hostname.

### Token lifetime and renewal

An access token lasts **five minutes**. A refresh token lasts **30 days from issue or last rotation**, so a grant survives normal agent idle time between turns. Renewal, not a longer access token, is the supported path.

Request `offline_access` on the first authorization; it is part of the set above. Without it the grant has no refresh token, so the client must send the person through authorization again when the access token expires.

Every successful refresh rotates the refresh token. Persist the returned `refresh_token` before using the new access token. For 30 seconds after rotation the old token returns the same response, which lets a retried request recover; after that the provider treats reuse as replay and revokes the whole refresh-token grant for that client and person, including the newest token. The grant is then unrecoverable and only a fresh authorization restores it. A client that cannot persist the rotated token will lose the connection at its first renewal after the retry window.

Refresh without a secret as a public client:

```sh
curl -sS -X POST https://<host>/api/auth/oauth2/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode 'client_id=<client-id>' \
  --data-urlencode 'refresh_token=<refresh-token>' \
  --data-urlencode 'resource=https://<host>/mcp'
```

The response carries a new `access_token`, `expires_in`, `scope`, and `refresh_token`. Access tokens are signed by a key persisted in the service database, so a deployment or restart does not invalidate a live token or grant. Reauthorization after a deploy therefore indicates that the client did not persist or replayed its rotated refresh token; it is not server-side invalidation. The 2026-10-28 deploy experiment is recorded in [the MCP contract](docs/fantasy-manager/MCP.md#discovery-documents).

### After connecting

Use `tools/list` for live schemas/scopes/hints. Retry unconfirmed creation only with the same request identity/content; inspect current state before repeating other writes. Keep the latest rotated refresh token as described above.
Browser sign-out does not revoke offline grants: disconnect through `/api/auth/oauth2/revoke`. Issued access tokens may remain valid until expiry. OAuth setup proves no tool behavior; local workerd proves no production routing guarantee.

## Deployment

The [owner runbook](docs/deployment.md) owns protected state, provider setup, migration safety, and production acceptance. No local check authorizes deployment.
