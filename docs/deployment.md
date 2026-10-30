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

## Deployed environment (2026-10-25)

The `cloud-run` stage is deployed in `lineupkeep-prod` (`us-east1`) under the
owner's CAD 5/month budget. `BETTER_AUTH_URL` and the canonical service origin
are the same URL; the provisioned environment file now owns that value.

| Item                              | Value                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public origin / `BETTER_AUTH_URL` | `https://lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-hcfc7y3kha-ue.a.run.app`                                                                                                                                                                                                                            |
| Web service                       | `lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc` — public ingress, min 0 / max 3, concurrency 20, 1 vCPU / 512 MiB, request-based billing (`cpu-throttling=true`), startup CPU boost                                                                                                                        |
| Worker service                    | `lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y` — min 0 / max 2, concurrency 2, timeout 900 s, request-based billing, invoker IAM enforced (unauthenticated requests return 403)                                                                                                                        |
| Hosted browser service            | `lineupkeep-hb` — `https://lineupkeep-hb-hcfc7y3kha-ue.a.run.app`, current revision `lineupkeep-hb-00010-6db`, min 0 / max 2, concurrency 1, 1 vCPU / 2 GiB, timeout 780 s, `/healthz` startup probe, request-based billing, invoker IAM enforced; only the web runtime account holds `roles/run.invoker` |
| Runtime accounts                  | Web: `alchemefdt2v24ebek3kk5bbglblvc@lineupkeep-prod.iam.gserviceaccount.com`; worker: `alchems6msjzkhxxseuglypqfudf7b@…`; queue/scheduler invoker: `alchem2r7pyg3ia7ujwxdkdpon7d5z@…`; hosted browser: `alchemgx4kg3sc7lv6v6t2vmqz6g6v@…`                                                                |
| Queue                             | `projects/lineupkeep-prod/locations/us-east1/queues/lineupkeepweb-lineupworkerqueue-cloud-run-vhxrepebzd4sojv4` — running, 5 dispatches/s, 4 concurrent, 5 attempts with 10–300 s backoff                                                                                                                 |
| Scheduler                         | `lineupkeepweb-lineuptick-cloud-run-ctseuiblv2wtwlwu` — `0 * * * *` UTC as deployed on 2026-10-25; the declared schedule is `55 * * * *` and applies on the next authorized deploy. OIDC to `POST /api/internal/lineup-worker` with `{action:"tick",limit:50}`, 300 s attempt deadline, 2 retries         |
| Registry                          | `us-east1-docker.pkg.dev/lineupkeep-prod/lineupkeepweb-registry-cloud-run-u4rplfecdzi27v3w` — `web:*` and `browser:*` images; the browser image is about 853 MB expanded and replaces the Chromium headless deployment on every content change                                                            |
| Application database              | Alchemy-managed `LineupkeepDatabase` / `production` Neon Free project, independent of protected state                                                                                                                                                                                                     |
| Secret Manager                    | `lineupkeepweb-secret-better-auth-secret-cloud-run-zz7b4zbcg2rfo5fb`, `…-connection-encryption-key-cloud-run-ec7zelts3e7mtrtt`, `…-resend-api-key-cloud-run-6daiaqee2uvf6llx`, `…-database-url-cloud-run-2zpqgtvdba7gierc`, `…-hosted-browser-descriptor-key-cloud-run-ifx5uoc5omsxeu74`                  |
| Secret versions                   | The web and browser revisions pin immutable versions; the descriptor key has six enabled versions and the live revisions pin version 6 on 2026-10-28. Keep only pinned versions after a rollback window.                                                                                                  |

**First plan review (2026-10-25):** the `cloud-run` plan proposed 26 resources,
all creates — four secrets with their access bindings and immutable versions,
three service accounts (web runtime, worker runtime, queue enqueuer), the
Artifact Registry repository, image build and publish, the migration run, both
Cloud Run services, the queue, the worker invoker binding, and the hourly
Scheduler job. It proposed no updates, replacements or deletions and adopted no
existing resource. The applied revisions were then read back with `gcloud` to
confirm the settings in the table.

**Hosted browser review (2026-10-25):** the plan reported 10 creates and 11
updates, all reviewed. Creates: the hosted browser service account, secret with
its two accessor bindings and immutable version, browser image build and
publish, the browser Cloud Run service, and the web invoker binding. Updates:
the web/worker revisions and image builds, the migration build, the scheduler
job, and a new secret version for each existing runtime secret. No deletions and
no adopted resources. The first apply used a generated long service id whose
`*.a.run.app` hostname exceeded the DNS label limit and was therefore
unroutable; the service id was fixed to `lineupkeep-hb`, a replacement was
reviewed and applied, the temporary probe and orphaned services were deleted,
and the invoker binding was reconverged by one more reviewed plan (one replace,
12 updates). Three final code-follow-up plans each reported 12 updates (image
rebuilds/publishes, service revisions, and one secret version); none created or
deleted a resource. The final state was verified with `gcloud`, an authenticated
WebSocket probe, and revision readback (`lineupkeep-hb-00004-tb2`, web
`lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-00016-fzl`).

Current revisions after the address-based egress deploy (2026-10-28): web
`lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-00029-m7g` on web digest
`sha256:788bf0f6721a90b06579855a946b154518748af7d02636c6c7ad41e9ca4166ca`,
worker `lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y-00030-4rz` on the same
web digest, and hosted browser `lineupkeep-hb-00010-6db` on browser digest
`sha256:41c92d69c8d498e6fd00ad0e7ddd4f4dbc574d5868883fc1522d0ad13e77edfe`.
The plan for that deploy reported 12 updates and no creates or deletions. The
web and browser revisions pin descriptor key version 6.

The deterministic alias
`https://lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-602042678335.us-east1.run.app`
also resolves, but the canonical URL above is the auth origin. Do not configure
callbacks or clients against the alias unless `BETTER_AUTH_URL` is changed and
redeployed.

Every deploy publishes a secret version because the version command is not
memoized. Secret Manager includes six active versions per billing account before
per-version charges; keep the version pinned by the live revisions, then
deliberately destroy superseded versions after a rollback window. Do not disable
a version that the current web or worker revision references.

### Cost expectation

Planning estimate for one owner and five teams, not a measured invoice or a
zero-cost promise. The budget is a CAD 5/month alerting budget, not a hard cap.

| Dimension         | Expectation                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Run         | Hourly ticks, a few user requests, and month-end runs should stay inside the request-billed free allowances (2M requests, 180k vCPU-s, 360k GiB-s). Cold starts count.                                                                                                                                        |
| Hosted browser    | One link is roughly 1–3 minutes of 1 vCPU / 2 GiB, about CAD 0.003–0.01 before free allowances; 120 vCPU-s and 240 GiB-s per two-minute session means roughly 1,500 sessions/month fit inside the 180k vCPU-s free allowance. Idle cost is zero at min 0. Two concurrent sessions are the configured ceiling. |
| Cloud Tasks       | One small message per run plus retries; inside the free 1M operations.                                                                                                                                                                                                                                        |
| Cloud Scheduler   | One job; inside the free three jobs per billing account unless other projects consume them, then $0.10/job/month.                                                                                                                                                                                             |
| Secret Manager    | 13 active versions after the hosted browser deploy (six free per billing account); up to about CAD 0.24/month for the excess. Destroy superseded versions after rollback windows.                                                                                                                             |
| Artifact Registry | The web image plus the ~853 MB expanded browser image (compressed layers are smaller). The repository may exceed the 0.5 GiB free allowance; storage is about CAD 0.10/GB-month, so the current pair is on the order of a few cents per month.                                                                |
| Neon              | Free-plan quotas (100 CU-hours, 1 GB per project); hourly bursts must actually suspend to remain inside them.                                                                                                                                                                                                 |
| Resend            | Test sender only until a domain is verified; free 100/day and 3,000/month.                                                                                                                                                                                                                                    |

Budget alerts fire at 50 %, 90 % and 100 % of CAD 5. Review actual usage before
adding users, teams or a sending domain.

### Redeploy and rollback

Load the protected provisioning inputs, mint a fresh GCP token, authenticate
Docker, and deploy the same stacks in dependency order:

```sh
set -a && . ~/.config/lineupkeep/infra.env && set +a
export GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)"
gcloud auth configure-docker us-east1-docker.pkg.dev --quiet
cd infra
env -u npm_execpath node ../node_modules/alchemy/bin/cli.js deploy database.run.ts --stage production --yes
env -u npm_execpath node ../node_modules/alchemy/bin/cli.js deploy platform.run.ts --stage production --yes
env -u npm_execpath node ../node_modules/alchemy/bin/cli.js deploy alchemy.run.ts --stage cloud-run --yes
```

`BETTER_AUTH_URL` is already set to the deployed origin in the provisioning
environment. A new origin requires a new value and a redeploy; never leave a
placeholder in a live revision. The web stack builds and publishes the web and
browser images, runs committed migrations before activation, and creates new
secret versions. `HOSTED_BROWSER_DESCRIPTOR_KEY` must exist in the provisioning
environment; without it the plan fails closed. Treat the access token as
short-lived and account for expiry during long runs. The browser image build
runs `npm install` and `playwright install --with-deps chromium` on an amd64
platform, so it takes a few minutes under emulation; its push is the slowest
part of a cold deployment.

Code rollback: deploy the previous source revision through Alchemy, or move
traffic back to the previous ready Cloud Run revision while investigating:

```sh
gcloud run services update-traffic lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc \
  --project=lineupkeep-prod --region=us-east1 --to-revisions=<previous-web-revision>=100
gcloud run services update-traffic lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y \
  --project=lineupkeep-prod --region=us-east1 --to-revisions=<previous-worker-revision>=100
gcloud run services update-traffic lineupkeep-hb \
  --project=lineupkeep-prod --region=us-east1 --to-revisions=<previous-browser-revision>=100
```

Migrations are forward-only, so a code rollback must still tolerate the applied
schema. Restoring data or protected state is a separate, tested procedure; state
restore does not roll back code. Record the previous revisions and image digest
before a risky change.

Phase 2 lineup implementation rollback is narrower than a revision move. The
worker treats `activeLineupImplementation` (`packages/backend/src/contexts/connections/LineupRun.ts`)
as the deployment's active implementation: fresh runs are stamped with it, and a
claimed run that has written nothing is re-stamped to it before it plans. Setting
it back to `provider_native` and deploying changes future execution only.
Rollback does not restore historical assignments — a lineup the custom policy
already wrote stays as the provider has it. A run with a write in flight resumes
readback and reconciliation against its own recorded plan, never a re-plan. A
wholesale revision rollback to a build that predates the custom planner cannot
re-stamp runs already queued as `custom_policy`; drain those runs, or expect them
to run on the older build's dispatch path. See
[ADR 0008](fantasy-manager/adr/0008-refusal-kinds-and-planner-cutover.md).

### Deployed smoke results (2026-10-25)

- `GET /` returned `200 text/html` (12,497 bytes, 0.28 s) with the Lineupkeep title.
- `POST /mcp` without a token returned `401` and
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`.
- The protected-resource metadata returned the deployed `/mcp` resource, the
  authorization server, and the four scopes.
- A manual Scheduler run invoked the worker with a Google-issued OIDC token and
  returned `200` in 0.45 s.
- An unauthenticated worker request returned `403`.
- A sign-in-code request for the owner's Resend account address returned `200
  {"success":true}`; the transactional path reached Resend. A different address
  was refused with `422 EMAIL_REJECTED` because `onboarding@resend.dev` is a
  test sender. No inbox was read and no owner sign-in was completed.
- Both revisions were Ready with clean startup logs (only the HTTP listener and
  graceful shutdown messages).

**Address-based egress smoke (2026-10-28):** an operator probe through
`gcloud run services proxy` completed the descriptor handshake against revision
`lineupkeep-hb-00010-6db`, reported `starting`, `loading`, and `waiting`, and
streamed 3 JPEG frames from the real Yahoo login page with no refusals. A second
probe used `http://169.254.169.254/latest/meta-data/` as the login URL: the
transport reported `Refused` for `169.254.169.254` with reason
`non_public_address`, the refusal page was streamed, and Cloud Logging recorded
`hosted_browser.session outcome=cancelled refused=[{host: 169.254.169.254,
reason: non_public_address}]`. The temporary `roles/run.invoker` binding used for
these probes was removed; the policy was read back with only the web runtime
account. On 2026-10-28 the owner attempted the Google-identity Yahoo sign-in
through the deployed browser. Google loaded its identity page and then refused
with "This browser or app may not be secure", its supported-browser gate against
software-controlled and embedded browsers. The Google-identity path is not
accepted; the hosted browser is the only linking path.

**Hosted browser smoke (2026-10-25):** the browser service reached `Ready` with
its `/healthz` startup probe, invoker IAM refused unauthenticated requests (403
for ordinary paths, 401 for a token without `run.invoker`), and an operator
WebSocket through `gcloud run services proxy` completed the signed-descriptor
handshake, streamed seven JPEG frames (first frame 4,941 bytes) with `starting`,
`loading`, and `waiting` statuses, and loaded the real Yahoo login page through
the service's egress. The operator closed the session; the log recorded
`hosted_browser.session cancelled` with only session id, outcome, and duration.
The temporary `run.invoker` binding used for the probe was removed immediately
and the policy was re-read to confirm only the web runtime account remains. The
descriptor key and IAM ID tokens were never printed or written to disk.

The web frontend answers `GET /healthz` with a Google 404 page for every caller,
so that path is usable only by the internal startup probe; point external
monitoring at the web service instead. Invoker IAM remains the boundary for the
browser service's `/` and `/session` paths.

Deployed product acceptance still needs the owner to sign in, link Yahoo through
the hosted browser against the deployed origin, and perform one live read/write
run. The hosted browser's Google-identity path is blocked by Google's
supported-browser gate, so a Google-identity account cannot finish linking.
Hosted MCP-client acceptance and a verified sending domain remain open. See [the Phase 1 acceptance record](phase-1-acceptance-2026-10-25.md).

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

## Application data restore drill

Application data lives in its own Neon project (`lineupkeep`), separate from the shared state project. Recovery
is point-in-time restore into a branch, which never touches the production branch.

Procedure, run 2026-10-29:

1. Create a restore branch of the production branch at a chosen past timestamp, using the Neon API with the
   owner's `NEON_API_KEY` from `~/.config/lineupkeep/infra.env`. Creating a branch is read-only with respect to
   production.
2. Create a `read_write` endpoint on that branch. A restore branch has no endpoint of its own, so one must be
   added before it can be reached.
3. Point a client at the branch by taking the production connection URI and substituting the restore
   endpoint's host. The credentials, database and parameters are otherwise identical.
4. Prove the **application**, not just a SQL client, can use the restored data: read the credentials through
   `ConnectionCredentialEncryption` with the production `CONNECTION_ENCRYPTION_KEY` and confirm each stored
   session decrypts. A restore that returns rows which cannot be decrypted has not restored a usable system.
5. Compare the migration count against production. A restore taken before a deployment must show fewer
   migrations than production, which is what proves the restore point is exact rather than approximate.
6. Delete the endpoint and then the branch. Both are disposable and cost nothing once removed.

Recorded result: at a restore point of `2026-10-29T22:30Z`, the branch held 2 connections, 6 teams, 484
lineup runs and 28 feedback records. Both provider sessions decrypted with the production key (529 and 578
bytes). The branch showed 19 applied migrations against production's 20, and still carried the
`pairing_code` column that the 22:46Z deployment removed, confirming the restore point was exact. Endpoint
and branch were deleted afterwards; production was never touched.

This establishes that PITR produces a usable application database. It does not establish a retention policy,
an RPO/RTO commitment, or who executes recovery under duress; those remain policy decisions for the owner.

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

### Hosted browser linking (deployed)

The local Node target still runs Playwright Chromium in-process for development
and tests. The `cloud-run` stage runs the dedicated IAM-only browser service
`lineupkeep-hb` and the web service proxies each owner-bound session to it. The
Cloudflare target returns `hosted_browser.unsupported`; so does a Node image
without the Playwright Chromium executable, which the node target checks before
claiming hosted linking is available.

The web mints a Cloud Run ID token for the exact service URL from the metadata
server and opens WSS with an HMAC-signed descriptor (session id, expiry of at
most 15 minutes, login URL). The browser service verifies the signature and the
bounded lifetime, refuses reused session ids and a second browser, and accepts
nothing else. `HOSTED_BROWSER_URL` and `HOSTED_BROWSER_DESCRIPTOR_KEY` are the
only hosted-browser settings on the web; the browser service receives only the
descriptor key and `NODE_ENV`. Do not put the database URL, connection
encryption key, auth secret, or provider session material in its environment.

Privacy contract: keystrokes transit the web process into the ephemeral
Chromium, but nothing is logged, traced, recorded, or written outside the
temporary profile. Provider cookies are sent once over the authenticated
internal stream after Chromium is killed and the profile removed. Cloud Logging
contains `hosted_browser.session` records with session id, outcome, duration,
failure class, and any refused host and reason only.

Egress is decided by resolved address. Each session starts a local HTTP forward
proxy and Chromium uses it for HTTP, HTTPS, WebSocket, and secure WebSocket
traffic. The proxy resolves every destination, refuses it if any answer is a
metadata, loopback, private, link-local, CGNAT, multicast, reserved, or other
non-public address, and otherwise dials the verified address directly. Chromium's
own resolver is blackholed, its implicit loopback proxy bypass is disabled, and
QUIC, non-proxied WebRTC UDP, and DNS prefetching are off. A refusal returns a
403 naming the host, sends a `Refused` control message to the client, and is
recorded in the `hosted_browser.session` outcome.

The browser can reach the public internet, including a provider's identity
provider. It is not a general proxy: the one-use owner-bound ticket, ten-minute
expiry, one active session per owner, five starts per owner per ten minutes, and
one browser per instance bound the cost. Network-level egress isolation is not
deployed. A VPC connector or Cloud NAT would add a recurring charge above the
owner's budget; the address policy is the enforced boundary, not network
isolation. Do not add a generic URL proxy, arbitrary CDP endpoint, or public
tunnel. See [ADR 0010](fantasy-manager/adr/0010-address-based-egress.md).

New pages are browsing targets. A provider popup becomes the active stream and
receives input; closing it returns to the provider page; closing the session
closes every target.

#### Start, stop, and rollback

- **Start / recover:** the service scales to zero and starts on the first
  session. If it is unhealthy, redeploy the stack or move traffic back to a
  known-good revision.
- **Stop the hosted path:** deploy the previous web revision, or remove the web
  runtime account's `roles/run.invoker` binding on `lineupkeep-hb`. The web then
  receives IAM refusals and fails the session with an actionable message. Do not
  remove the binding while expecting hosted linking to work; do not add
  `allUsers`.
- **Browser rollback:** move traffic to the previous browser revision, then
  redeploy the matching source. The browser service is stateless, so this needs
  no migration. Delete old browser images and superseded secret versions after a
  rollback window.
- **Descriptor-key rotation:** generate a new value in
  `~/.config/lineupkeep/infra.env`, deploy the web stack, and confirm the browser
  and web revisions pin the new secret version. Sessions started under the old
  key fail verification; they expire within ten minutes and require no data
  repair.

#### Cold starts and cost

- A warm session reached the first JPEG frame in 812 ms and the `waiting`
  status in 941 ms in the operator probe.
- A cold session (first request after the 15-minute idle window) reached the
  first JPEG frame in 9,434 ms and the `waiting` status in 9,804 ms. The
  instance start to `hosted_browser.ready` was 1.3 s and the startup probe
  passed 5.4 s after instance start; the rest is image pull, Chromium launch,
  and the provider page load. The service keeps no warm capacity, so the first
  link after a quiet period is the slow one. Do not raise `minInstanceCount`
  without a cost review.
- A two-minute session costs roughly CAD 0.003–0.01 of 1 vCPU / 2 GiB before
  free allowances; about 1,500 such sessions fit in the monthly Cloud Run free
  vCPU-seconds. Idle cost is zero. The browser image adds a few cents per month
  of Artifact Registry storage once the free allowance is used.
- Concurrency is bounded by `containerConcurrency: 1` and max two instances, so
  at most two browsers exist. A third concurrent start is refused as busy rather
  than queued. The web keeps five starts per user per ten minutes and one active
  session per owner.

#### When a session hangs

1. Cancel in the UI or close the tab; the web closes the upstream socket, the
   service kills Chromium and removes the profile, and the session is cancelled.
2. If the UI is gone, the ten-minute session clock and the 780 s Cloud Run
   request timeout terminate the stream; the instance and its `/tmp` profile are
   discarded with it. No cleanup command is required.
3. Inspect `gcloud logging read 'resource.type="cloud_run_revision" AND
   resource.labels.service_name="lineupkeep-hb"'` for the session outcome. A
   repeated `failed`/`browser_unavailable` means the image or runtime is broken:
   roll traffic back or redeploy.
4. Never add a generic browser endpoint, extend the timeout without a review, or
   reuse an instance profile to "unstick" a session.

#### Monitoring

Watch the browser service's revision readiness, instance count, 5xx rate, and
`hosted_browser.session` outcomes. Alert on repeated `failed` or `cancelled`
outcomes and on unauthenticated requests (which should exist only if IAM or the
web's invoker binding regresses). The cost budget alerts at 50 %, 90 %, and
100 % of CAD 5 remain the spending guard; they are not a hard cap.

### Sign-in providers

Email codes are the default; Google is optional. Codes resist mail-link scanners and let people choose the signing-in device. First verified sign-in creates an account; provider linking requires verified addresses. Production requires Resend rather than logging codes. Development may use console delivery; tests use an injected outbox or fake Resend, never real mail. Avoiding password hashing does not guarantee a platform CPU budget; review delivery latency, abuse, and unconfirmed-outcome recovery before changing authentication.

For [Resend](https://resend.com/docs/send-with-nodejs), verify a sending domain, create a sending-scoped API key, and set `EMAIL_FROM` to a sender on that domain. Keep the key protected. Per-client and per-recipient limits are **not a global email budget**. Review provider limits, distributed abuse, edge controls, monitoring, and delivery/recovery behavior for the actual application; no free-tier or quota-exhaustion guarantee is made.

For [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), create a web client and configure the application's consent/branding requirements with Google. Register the canonical origin and exact redirect URI `https://<host>/api/auth/callback/google`. For development, register `http://127.0.0.1:3000` and `http://127.0.0.1:3000/api/auth/callback/google`. Set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or neither. These are sign-in credentials, unrelated to GCP deployment credentials. The UI offers only server-reported enabled methods.

The base origin is trusted automatically; there is **no supported extra-origins environment setting**. Previews require explicit isolated stage/database policy and registered callbacks; otherwise omit Google. No OAuth proxy or automatic database branch is configured. Changing sign-in methods is an application decision requiring security, recovery, and CPU tests, not a password-toggle recipe.

### MCP and OAuth

The stateless adapter composes request-local identity and calls public use cases; feature scopes define consent promises. [Client setup](../README.md#connecting-an-mcp-client) owns discovery and grant handling. Local bearer verification avoids introspection latency but delays revocation until access-token expiry; browser sign-out leaves offline grants connected. Review explicit grant disconnection and refresh-token rotation.

MCP access tokens last five minutes and refresh tokens last 30 days from issue or last rotation; every refresh rotates the token, and reusing a rotated token outside the 30-second retry window revokes the whole grant. These values are explicit in `BetterAuthAdapter.ts` rather than inherited from a plugin default. The `oauth_resource.refresh_token_ttl` column can cap that value when set; it is null in the seeded schema, so leave it null unless deliberately shortening the grant. JWT signing keys are rows in the `jwks` table, and refresh tokens are hashed rows in `oauth_refresh_token`; a Cloud Run revision change or scale-to-zero therefore does not invalidate a live token or grant. Only pointing the service at a different database or deleting those rows invalidates an existing grant; changing `BETTER_AUTH_SECRET` invalidates browser session cookies, so keep it stable for sign-in continuity. `bun checks` and the MCP E2E exercise this on migrated local storage; they do not prove a specific production revision change.
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
