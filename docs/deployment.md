# Deployment owner runbook

This runbook explains safe operation, not authorization. [The Phase 1 mandate](PHASE-1-HANDOFF.md) records the owner's GCP CLI setup permission and conditional rollout authority. Review and record the exact plan; do not apply until its billing/budget, access, and publication-security gates are satisfied. A material scope/cost change needs owner approval. Local checks cannot establish cloud credentials, IAM, routing, delivery, or restoration.

## Provisioned environment (2026-10-25)

Bootstrap, outside Alchemy (Alchemy has no billing-link provider, and state cannot store itself):

- GCP project `lineupkeep-prod` (number `602042678335`), billing account `0139E5-D27389-43F1F2`, region `us-east1`. The gcloud CLI's active project is the unrelated `auto-gm-372620`; pass `--project=lineupkeep-prod` explicitly and do not change global config.
- Protected Alchemy state in the owner's shared Neon project `alchemy-state` (`spring-cell-62836171`): database and role `lineupkeep_state`, direct endpoint, `sslmode=verify-full`.
- Provisioning inputs: `~/.config/lineupkeep/infra.env` (mode 600, outside the repository) with `ALCHEMY_STATE_DATABASE_URL`, `NEON_API_KEY`, `GOOGLE_PROJECT_ID`, `GCP_REGION`, `BETTER_AUTH_SECRET`, `CONNECTION_ENCRYPTION_KEY`, `EMAIL_FROM`, `RESEND_API_KEY`, `AUTH_CLIENT_IP_HEADERS`. Mint `GOOGLE_ACCESS_TOKEN` per session with `gcloud auth print-access-token` and never echo it.
- Alchemy-managed: application Neon project (`database.run.ts`, stage `production`), project APIs and the CAD 5/month budget with 50/90/100% alerts (`platform.run.ts`, stage `production`), and the Cloud Run web service (`alchemy.run.ts`, stage `cloud-run`).
- Email uses Resend's test sender `onboarding@resend.dev`, which delivers only to the owner's account address; a verified domain is a launch gate for open registration.

Deploy shape:

```sh
set -a && . ~/.config/lineupkeep/infra.env && set +a
export GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)"
cd infra
env -u npm_execpath node ../node_modules/alchemy/bin/cli.js plan  database.run.ts --stage production
env -u npm_execpath node ../node_modules/alchemy/bin/cli.js deploy database.run.ts --stage production --yes
env -u npm_execpath node ../node_modules/alchemy/bin/cli.js deploy platform.run.ts --stage production --yes
env -u npm_execpath node ../node_modules/alchemy/bin/cli.js deploy alchemy.run.ts --stage cloud-run --yes
```

`BETTER_AUTH_URL` must equal the deployed origin, so the first web deploy establishes the Cloud Run URL and a follow-up deploy sets it; never ship a placeholder origin. Docker must be authenticated to `${GCP_REGION}-docker.pkg.dev` before the web stack publishes an image.

## Select a stage and lifecycle

[infra/stage.ts](../infra/stage.ts) owns host/database selection. [infra/config.ts](../infra/config.ts) owns the runtime allowlist; [.env.example](../.env.example) is its annotated input reference. Do not infer a runtime setting from a variable merely existing in the provisioning shell.

| Workflow/stage                                                     | Host and database                                       | Owner inputs                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `dev`, `dev:cloudflare`                                            | Node/workerd; retained development PostgreSQL           | Selected development settings only; no cloud credentials                       |
| `local`, `local-cloudflare`, `local-container` in Alchemy dev mode | Production-composed local target; disposable PostgreSQL | Required production application settings; no cloud credentials                 |
| `local-external-db` in local mode                                  | Node; explicit external database                        | Production settings and both database URLs; deliberate migration authorization |
| E2E/verification targets                                           | Isolated test composition and disposable PostgreSQL     | Runner-owned synthetic settings; never root `.env`                             |
| Database stack, `production`                                       | Retained Neon application database                      | Protected state access and Neon provisioning credentials                       |
| Web `production`                                                   | Cloudflare and uncached Hyperdrive                      | State, application settings, Cloudflare credentials                            |
| Web `cloud-run`                                                    | Cloud Run Node image                                    | State, application settings, GCP credentials/project and region                |

Local state depends on **Alchemy dev execution mode**, not a stage named `local`. Non-dev plan/deploy/destroy requires remote state. Development and verification explicitly use local state.

Remote web stages reference the **same** durable `LineupkeepDatabase` / `production` resource in [neon.ts](../infra/database/neon.ts); they are not isolated previews. Add stage/database isolation deliberately. Changing hosts requires reviewing replacement and deletion effects, not simply switching an environment flag.

[database.run.ts](../infra/database.run.ts) owns the durable database independently of web teardown. Retention protects the physical database but removes its state record when destroyed: it does not replace backups or adoption procedures. Routine CI must not destroy this stack.

## Bootstrap protected state — owner only

All non-local stacks use `alchemy/State/PostgresState` through [state.ts](../infra/state.ts). Before any remote command:

1. Use **one shared state-only Neon project, with a separate database and login role per application**, outside every application stack. Application data belongs in separate projects; stack names alone do not isolate state credentials. No repository command bootstraps state. Existing resources require reviewed migration/adoption; an empty store does not adopt them.
2. Scope each application's role to its own state database; revoke unintended cross-database/PUBLIC access. The shared project shares compute/quota, outages, administration trust, and project-level restore blast radius: budget capacity across apps and coordinate restoration. Grant CONNECT, schema USAGE/CREATE, and ownership/read-write access to the unqualified `alchemy_resource_state` and `alchemy_stack_output` tables in a dedicated writable schema on the role's search path. Review PUBLIC/default role grants. Do not grant application-database access or routine CI database-stack administration/destruction.
3. Define backup/PITR retention, recovery owner, RPO, and RTO as application policy. Pause deployments and exercise restore into a separate state-only database. Verify restored records against actual resource identities before changing the secret. Restoring state does not roll back application code or data. Backups contain secrets too.
4. Store `ALCHEMY_STATE_DATABASE_URL` in protected CI environments and an owner-controlled secret manager. Use certificate-verified TLS (`sslmode=verify-full`) and a **direct/session-capable endpoint**, not Neon's `-pooler` transaction endpoint: state locks are session advisory locks. Reserve at least two simultaneous connections per running state store for lock holding and independent verification, with capacity for commands accessing multiple stack/stage pairs. Missing configuration fails closed; there is no local fallback.
5. Serialize plan/deploy/destroy per exact stack/stage across CI and owner terminals. Use application-specific concurrency identities and `cancel-in-progress: false`. The advisory lock fails fast; it is not a queue. Never evade contention by changing the state URL, stack/stage, or lock prefix. Shared application databases also require cross-stage migration serialization or a database-scoped migration lock before rollout.
6. Confirm authority for the first plan and for deployment under the applicable mandate; conditional rollout authority is usable only after its gates are satisfied. Review credentials, host/database policy, connection capacity, and restore readiness. Rotate credentials consistently with deployments paused. Never delete state to clear locks; session locks release when their connections close.

Plan and destroy need the same state store as deploy. Keep URLs out of source and command arguments, and deny state secrets to untrusted PR/build/check jobs. Checkout-local `.alchemy` and `infra/.alchemy` also contain resolved credentials: keep them ignored/private, preserve them when cleanup is incomplete, and never share them as evidence.

## Production configuration

Supply the six required application inputs through protected provisioning/CI inputs: canonical HTTPS `BETTER_AUTH_URL`, a generated random `BETTER_AUTH_SECRET`, a base64-encoded 32-byte `CONNECTION_ENCRYPTION_KEY`, `EMAIL_FROM`, `RESEND_API_KEY`, and a reviewed `AUTH_CLIENT_IP_HEADERS` policy. Keep the auth and encryption secrets stable across restarts and rotate deliberately. The allowlist forwards secrets to the host, not to build commands; `APP_ENV` is generated as production.

### Connection credential encryption rotation

Provider session material is stored only as a versioned AES-GCM envelope. The envelope records the key version, and authenticated data binds the owner, connection, provider, and key version. The current release supports one active key version (`1`) from `CONNECTION_ENCRYPTION_KEY`.

Current supported rotation: pause provider work, disconnect every affected connection so active ciphertext is deleted, replace the secret with a newly generated base64 32-byte key, and have each owner reconnect. Disconnecting first avoids leaving ciphertext under a discarded key. This requires owner action per connection and should be planned as an incident, not a routine deploy.

Planned keyring rotation without re-linking: deploy a release that decrypts retained envelopes with the old key version while encrypting new credentials with the new version, re-encrypt on the next successful credential use, then remove the old key version. Do not change the key without either the disconnect-first path or a keyring-capable release. Losing the key makes stored provider sessions unrecoverable; it does not expose them. Never place the key in plain environment entries, build outputs, logs, or repository files.

Choose client-address headers from actual trusted ingress: Cloudflare's `cf-connecting-ip` or a reviewed Cloud Run forwarding/proxy policy. Header names alone do not prevent spoofing. Set `AUTH_TRUSTED_PROXIES` only to actual trusted ranges and verify address attribution/rate limiting under that topology. Rate-limit `/api/telemetry` at ingress as well.

### Sign-in providers

Email codes are the default; Google is optional. Codes resist mail-link scanners and let people choose the signing-in device. First verified sign-in creates an account; provider linking requires verified addresses. Production requires Resend rather than logging codes. Development may use console delivery; tests use an injected outbox or fake Resend, never real mail. Avoiding password hashing does not guarantee a platform CPU budget; review delivery latency, abuse, and unconfirmed-outcome recovery before changing authentication.

For [Resend](https://resend.com/docs/send-with-nodejs), verify a sending domain, create a sending-scoped API key, and set `EMAIL_FROM` to a sender on that domain. Keep the key protected. Per-client and per-recipient limits are **not a global email budget**. Review provider limits, distributed abuse, edge controls, monitoring, and delivery/recovery behavior for the actual application; no free-tier or quota-exhaustion guarantee is made.

For [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), create a web client and configure the application's consent/branding requirements with Google. Register the canonical origin and exact redirect URI `https://<host>/api/auth/callback/google`. For development, register `http://127.0.0.1:3000` and `http://127.0.0.1:3000/api/auth/callback/google`. Set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or neither. These are sign-in credentials, unrelated to GCP deployment credentials. The UI offers only server-reported enabled methods.

The base origin is trusted automatically; there is **no supported extra-origins environment setting**. Previews require explicit isolated stage/database policy and registered callbacks; otherwise omit Google. No OAuth proxy or automatic database branch is configured. Changing sign-in methods is an application decision requiring security, recovery, and CPU tests, not a password-toggle recipe.

### MCP and OAuth

The stateless adapter composes request-local identity and calls public use cases; feature scopes define consent promises. [Client setup](../README.md#connecting-an-mcp-client) owns discovery and grant handling. Local bearer verification avoids introspection latency but delays revocation until access-token expiry; browser sign-out leaves offline grants connected. Review explicit grant disconnection and refresh-token rotation.
Metadata retrieval must stay public-only, reject redirects, and resist DNS rebinding at connection time. Process routing can pin approved addresses; Workers need host-enforced protection. Test metadata routing is never a production exception, and local workerd cannot prove this guarantee.

### Telemetry

For production OTLP tracing, set `OTEL_TRACES_EXPORTER=otlp` **and** `OTEL_EXPORTER_OTLP_ENDPOINT` to the deployed collector base URL; Effect appends `/v1/traces`. Supply optional secret `OTEL_EXPORTER_OTLP_HEADERS` using URI-encoded header values where required. Set application service identity and release `SERVICE_VERSION` from CI. Only the allowlisted subset is supported, not every standard OTEL environment variable. Review actual exported data under the [observability policy](../.agents/skills/observability/SKILL.md).

## Provisioning and publication prerequisites

Provider credentials belong to protected shell/CI inputs or a configured interactive `ALCHEMY_PROFILE`, **never application bindings**. Complete provider environment credentials override profiles; CI must not presume laptop profile access. See the provisioning section in `.env.example` for exact variable names.

- **Neon database stack:** `NEON_API_KEY` provisions the retained database; it is not an application database credential or an additional web-runtime secret.
- **Cloudflare:** use account ID plus a narrowly scoped API token for Worker/Hyperdrive operations. The provider also supports global API key plus email (`CLOUDFLARE_EMAIL`, alias `CLOUDFLARE_ACCOUNT_EMAIL`); prefer the scoped token. Review actual permissions before use. [cloudflare.ts](../infra/hosts/cloudflare.ts) owns resource composition.
- **GCP:** `GOOGLE_ACCESS_TOKEN` plus `GOOGLE_PROJECT_ID` (alias `GOOGLE_CLOUD_PROJECT`), or `GOOGLE_APPLICATION_CREDENTIALS` pointing to a protected service-account JSON key, plus `GCP_REGION`. Do not assume arbitrary ADC/Workload Identity files are accepted by the pinned provider. An authorized agent can obtain a short-lived token from gcloud directly into the deployment process environment without displaying or recording it; do not ask the owner to paste it into chat. Gcloud login alone does not automatically configure Alchemy, Neon, email, or protected state. Tokens must last through the operation. Separately authenticate gcloud and Docker, and align gcloud's active project/identity with Alchemy: registry configuration and secret-version commands use that CLI context. Misalignment can affect the wrong project. [cloudRun.ts](../infra/hosts/cloudRun.ts) owns composition.

Cloud Run owns image publication in [cloudRun.ts](../infra/hosts/cloudRun.ts) using the shared [Node image build](../infra/build/node.ts); builds receive no application/state secrets. Cloud Run uses Secret Manager and a dedicated runtime account; Cloudflare receives bindings. Audit permissions/rotation on the selected host.

## Plan, migrate, activate

After owner bootstrap and authorization, use the scripts in [infra/package.json](../infra/package.json). For example, planning the database is separate from planning the web stack:

```sh
bun --filter @lineupkeep/infra plan:database --stage production
bun --filter @lineupkeep/infra plan --stage production
```

Review and record the resulting changes before apply; verify that the applicable mandate covers their resources, cost, and rollout. [migrations.ts](../infra/migrations.ts) applies committed Drizzle migrations against the direct URL; consumed Outputs gate activation on success. Destroy does not roll schema back. Use expand/contract changes and a tested application-data backup/recovery plan. Explicit external-db stages require both URLs and deliberate target confirmation before migrating.

Keep application data, protected infrastructure state, and disposable verification resources on separate lifecycles; retained development data is not verification storage. Run near the database and reconcile runtime pools, concurrency, and instance limits with its real connection budget. Keep Hyperdrive query caching disabled for read-after-write consistency. Process and isolate resource lifetimes differ; use `BackgroundWork` for response-independent work and a durable queue/job system for work that must survive instance loss.

Entities use soft deletion; legal erasure needs a future purge or retention job.

## Adding feature resources

Define a public domain service; place host construction Layers in `infra/features/<context>/<host>.ts` and compose in the existing `hostLayer` case in `infra/stage.ts`. Pass concrete typed outputs and register providers in `infra/alchemy.run.ts`; the [import policy](../.dependency-cruiser.ts) owns permissions and remedies.
Keep stable resource identities, least-privilege bindings, and construction ownership there. Runtime adapters live in the context's `internal/`, composed by `ApplicationLayer` and hosted by `BackendRuntime.make`: pass Worker bindings through its target or protected Node configuration to scoped clients. Test use cases with injected Layers, then bindings/permissions/target composition and artifact exclusion.
Prebuilt TanStack/Nitro artifacts do not establish Alchemy-native planning-branch erasure. Never import construction Layers into runtime or serialize constructed services as environment variables. Process-lived clients and request/isolate-lived clients have different lifetimes; changing packaging requires architecture approval, not another host selector or speculative registry.

## Recovery and acceptance

For local test/evidence recovery use the [harness procedure](../.agents/skills/verify-app/references/harness.md#ownership-and-recovery), never manual deletion, killing by port, or removal of unowned resources. Never deploy an E2E composition artifact: rebuild normally and run target verification.

Before production acceptance, verify provider/registry authentication, IAM and secrets, callbacks and real delivery, trusted ingress, TLS/pooling, rollout/readiness/termination, remote CPU behavior, and telemetry export. On Workers retain `global_fetch_strictly_public` and verify connection-time public-only routing/rebinding protection; local workerd cannot prove it. Verify live state permissions, contention, backup restoration, and independence from application teardown. Local Docker cannot prove Cloud Run orchestration or routing. Credential-free checks and local Postgres state tests establish contracts, not these cloud guarantees.
