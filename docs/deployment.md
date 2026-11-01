# Deployment owner runbook

This runbook explains safe operation, not authorization. [The Phase 1 mandate](PHASE-1-HANDOFF.md) records the owner's GCP CLI setup permission and conditional rollout authority. Review and record the exact plan; do not apply until its billing/budget, access, and publication-security gates are satisfied. A material scope/cost change needs owner approval. Local checks cannot establish cloud credentials, IAM, routing, delivery, or restoration.

## Provisioned environment (2026-10-25)

Bootstrap, outside Alchemy (Alchemy has no billing-link provider, and state cannot store itself):

- GCP project `lineupkeep-prod` (number `602042678335`), billing account `0139E5-D27389-43F1F2`, region `us-east1`. The gcloud CLI's active project is still the deleted `auto-gm-372620`, so every command needs `--project=lineupkeep-prod`; set it in the CLI if bare commands are wanted.
- Protected Alchemy state in the owner's shared Neon project `alchemy-state` (`spring-cell-62836171`): database and role `lineupkeep_state`, direct endpoint, `sslmode=verify-full`.
- Provisioning inputs: `~/.config/lineupkeep/infra.env` (mode 600, outside the repository) with `ALCHEMY_STATE_DATABASE_URL`, `NEON_API_KEY`, `GOOGLE_PROJECT_ID`, `GCP_REGION`, `BETTER_AUTH_SECRET`, `CONNECTION_ENCRYPTION_KEY`, `EMAIL_FROM`, `RESEND_API_KEY`, `AUTH_CLIENT_IP_HEADERS`. A key rotation additionally carries `CONNECTION_ENCRYPTION_KEY_VERSION` and `CONNECTION_ENCRYPTION_RETAINED_KEYS`; see [connection credential encryption rotation](#connection-credential-encryption-rotation). `ALERT_EMAIL` is optional and only attaches an email notification channel to the lineup-run alert; without it the alert policy still opens incidents in Cloud Monitoring. Mint `GOOGLE_ACCESS_TOKEN` per session with `gcloud auth print-access-token` and never echo it.
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
| Worker service                    | `lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y` — min 0 / max 2, concurrency 2, timeout 300 s, request-based billing, invoker IAM enforced (unauthenticated requests return 403)                                                                                                                        |
| Hosted browser service            | `lineupkeep-hb` — `https://lineupkeep-hb-hcfc7y3kha-ue.a.run.app`, current revision `lineupkeep-hb-00018-k2f`, min 0 / max 2, concurrency 1, 1 vCPU / 2 GiB, timeout 780 s, `/healthz` startup probe, request-based billing, invoker IAM enforced; only the web runtime account holds `roles/run.invoker` |
| Runtime accounts                  | Web: `alchemefdt2v24ebek3kk5bbglblvc@lineupkeep-prod.iam.gserviceaccount.com`; worker: `alchems6msjzkhxxseuglypqfudf7b@…`; queue/scheduler invoker: `alchem2r7pyg3ia7ujwxdkdpon7d5z@…`; hosted browser: `alchemgx4kg3sc7lv6v6t2vmqz6g6v@…`                                                                |
| Queue                             | `projects/lineupkeep-prod/locations/us-east1/queues/lineupkeepweb-lineupworkerqueue-cloud-run-vhxrepebzd4sojv4` — running, 5 dispatches/s, 4 concurrent, 5 attempts with 10–300 s backoff                                                                                                                 |
| Scheduler                         | `lineupkeepweb-lineuptick-cloud-run-ctseuiblv2wtwlwu` — `55 * * * *` UTC since the 2026-10-31 deploy. OIDC to `POST /api/internal/lineup-worker` with `{action:"tick",limit:50}`, 300 s attempt deadline, 2 retries, which is why the worker timeout is 300 s rather than 900 s                           |
| Registry                          | `us-east1-docker.pkg.dev/lineupkeep-prod/lineupkeepweb-registry-cloud-run-u4rplfecdzi27v3w` — `web:*` and `browser:*` images; the browser image is about 853 MB expanded and replaces the Chromium headless deployment on every content change                                                            |
| Application database              | Alchemy-managed `LineupkeepDatabase` / `production` Neon Free project, independent of protected state                                                                                                                                                                                                     |
| Secret Manager                    | `lineupkeepweb-secret-better-auth-secret-cloud-run-zz7b4zbcg2rfo5fb`, `…-connection-encryption-key-cloud-run-ec7zelts3e7mtrtt`, `…-resend-api-key-cloud-run-6daiaqee2uvf6llx`, `…-database-url-cloud-run-2zpqgtvdba7gierc`, `…-hosted-browser-descriptor-key-cloud-run-ifx5uoc5omsxeu74`                  |
| Secret versions                   | The web and browser revisions pin immutable versions; on 2026-10-31 each secret has exactly one active version (better auth 15, connection key 15, Resend 15, database URL 46, descriptor key 13), kept by `Retain-<name>-Version` in [cloudRun.ts](../infra/hosts/cloudRun.ts).                          |

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

Current revisions after the retention deploys (2026-10-31): web
`lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-00046-7gw` and worker
`lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y-00047-8tx` on web digest
`sha256:6a05add95bf8eb051e9695442da75a18d44175b150d0164e1dc5e85c59ee60ef`, and
hosted browser `lineupkeep-hb-00019-b9p` on browser digest
`sha256:a38ebae1366223b286941345f1194b8f3e5e09a3c0bbc6dab7357046d3bef503`.
The first of them reported five creates — the registry cleanup policy and the
five `Retain-<name>-Version` steps — and twelve updates, and published new
versions only because the publishing step had just been changed. Its first
attempt failed at the retention step and nothing else was left half-applied:
all three services reached Ready and answered before the retry. The second set
the registry policy to keep one image per package after the decommissioned
project's images were removed, and reported 18 updates. Before them, the
2026-10-31 cost-settings deploy (worker timeout 900 s → 300 s and the scheduler
`0 * * * *` → `55 * * * *`) reported 16 updates with no creates or deletions on
revisions `…-00043-4c8`, `…-00044-z9g` and `lineupkeep-hb-00018-k2f` on web digest
`sha256:b77e051ae741ab8147f887be10d60c0394dcc0d2a2036cbc1ceb8581851f9958`.

Current revisions after the wide-event and Cloud Trace deploy (2026-10-31):
web `lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-00053-st6` and worker
`lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y-00054-6rc` on web digest
`sha256:189678363a8b600f78718382b8ff3b9acbe4f6bf44f3a9b6218cb20ae7907f0b`;
the hosted browser stayed on `lineupkeep-hb-00019-b9p`. The first apply that day
(web `…-00049-twx`, worker `…-00050-cv4`) reported two creates and 18 updates:
the creates were the `roles/telemetry.tracesWriter` bindings for the web and
worker runtime accounts, and the updates were both images and services, the
alert policy's log filter, the scheduler job, the migration step, the retention
steps, and a `DATABASE_URL` secret version. A request made within seconds of
that apply exported no trace because the new binding had not propagated, which
the exporter accepted silently. Three more applies carried review-free refinements
to the wide event's attribute merge, the exceptional-error logger, and one
unused record field; each reported 17 updates.

Current revisions after the cold-start deploy (2026-10-31): web
`lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-00054-jkl` and worker
`lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y-00055-l8b` on web digest
`sha256:f4bb6b11cbc62b288132c8d6fb194a1454fc7645d153dab5ea630d34d7a06fbf`; the
hosted browser stayed on `lineupkeep-hb-00019-b9p`. The plan reported 17 updates
and no creates or deletions: both images, both services, the migration step,
the scheduler job, the retention steps, and one `DATABASE_URL` version. The web
container now probes every second; the worker and hosted browser keep five
seconds. [The cold-start section](#cold-start-and-the-waking-shell-2026-10-31)
records the before and after.

The deterministic alias
`https://lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-602042678335.us-east1.run.app`
also resolves, but the canonical URL above is the auth origin. Do not configure
callbacks or clients against the alias unless `BETTER_AUTH_URL` is changed and
redeployed.

A version is published only when its value changes, and `Retain-<name>-Version`
destroys the superseded ones, so the count does not grow with deploys; see
[retention](#retention-and-the-zero-bill). Do not disable a version that the
current web or worker revision references, and do not raise
`retainedSecretVersions` without reading what the rollback window costs.

### Cost expectation

Planning estimate for one owner and five teams, not a measured invoice or a
zero-cost promise. The budget is a CAD 5/month alerting budget, not a hard cap.

| Dimension         | Expectation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloud Run         | Hourly ticks, a few user requests, and month-end runs should stay inside the request-billed free allowances (2M requests, 180k vCPU-s, 360k GiB-s). Cold starts count.                                                                                                                                                                                                                                                                                                                                                                                       |
| Hosted browser    | One link is roughly 1–3 minutes of 1 vCPU / 2 GiB, about CAD 0.003–0.01 before free allowances; 120 vCPU-s and 240 GiB-s per two-minute session means roughly 1,500 sessions/month fit inside the 180k vCPU-s free allowance. Idle cost is zero at min 0. Two concurrent sessions are the configured ceiling.                                                                                                                                                                                                                                                |
| Cloud Tasks       | One small message per run plus retries; inside the free 1M operations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Cloud Scheduler   | One job, and after 2026-10-31 the only job on the billing account, so it is inside the free three.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Secret Manager    | One active version per secret (five), against six free per billing account, so nothing is charged. [cloudRun.ts](../infra/hosts/cloudRun.ts) publishes a version only when its value changes and `Retain-<name>-Version` destroys the rest after the revision that pins the kept one is ready. It reached 98 versions and about $5.52/month before that: every deploy republished identical values.                                                                                                                                                          |
| Artifact Registry | One web image and one browser image, about 0.42 GB at the measured 85 MB and 331 MB averages. `RegistryCleanupPolicy` in [cloudRun.ts](../infra/hosts/cloudRun.ts) applies [registryCleanupPolicy.json](../infra/registryCleanupPolicy.json): keep the newest version of each package and delete the rest. The repository held 61 images and 7.66 GB before the policy. Storage is $0.10/GB-month beyond the account's 0.5 GiB free, so one of each fits inside the allowance and nothing is charged; a second image per package would be about $0.03/month. |
| Neon              | Free-plan quotas (100 CU-hours, 1 GB per project); hourly bursts must actually suspend to remain inside them.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Resend            | Test sender only until a domain is verified; free 100/day and 3,000/month.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Budget alerts fire at 50 %, 90 % and 100 % of CAD 5. Review actual usage before
adding users, teams or a sending domain.

### Measured usage and the idle window (2026-10-31)

The worker looks busy for about fifteen minutes after each hourly tick, and that
time is neither work nor a charge. Cloud Run keeps a scaled-to-zero instance for
at most 15 minutes after it last handled a request ("An instance will never stay
idle for more than 15 minutes after processing a request"); with request-based
billing and no minimum instances that window is throttled, unbilled time. Over
the seven days to 2026-10-31 the worker instance existed for 2,451
instance-minutes but accrued 2,716.9 billable instance-seconds (45 minutes):
1.8 % of its presence. Nothing in the service extends the window. The minimum is
zero, `cpu-throttling` is true, the hourly tick is the only request
(`request_count` is 1 per hour with no requests inside the tail), and neither
server image holds a timer or keepalive: the only `setInterval`/`setTimeout`
calls outside the client bundle belong to an open hosted-browser session
(`packages/hosted-browser`) and a socket-close timeout. The web service and the
hosted browser show the same shape.

Measured 2026-10-24 → 2026-10-31 from Cloud Monitoring `run.googleapis.com/*`:

| Service        | Requests | Request p50 / p95 / p99 | End-to-end p50 / p95 / p99 | Cold starts | Start-up p50 / p95 | Memory p50 / p95 / p99 vs limit     | CPU p95 / p99 | Peak concurrency p99 | Billable vs present  |
| -------------- | -------- | ----------------------- | -------------------------- | ----------- | ------------------ | ----------------------------------- | ------------- | -------------------- | -------------------- |
| Web            | 1,694    | 364 / 1,371 / 1,891 ms  | 400 / 1,746 / 7,407 ms     | 77          | 5.67 / 5.92 s      | 172 / 203 / 210 MiB of 512 (41 %)   | 5.1 / 10.2 %  | 4.0 of 20            | 1,872 s vs 1,408 min |
| Worker         | 150      | 11.5 / 18.0 / 22.0 s    | 17.8 / 24.6 / 29.3 s       | 159         | 5.68 / 6.24 s      | 173 / 189 / 216 MiB of 512 (42 %)   | 6.3 / 13.6 %  | 1.9 of 2             | 2,717 s vs 2,451 min |
| Hosted browser | 20       | 1.7 s / 138 s / 290 s   | 1.7 s / 138 s / 319 s      | 20          | 5.15 / 5.37 s      | 122 / 385 / 700 MiB of 2 GiB (34 %) | 6.2 / 36.7 %  | 1.7 of 1             | 738 s vs 323 min     |

`request_latencies` measures execution; `request_latency/e2e_latencies` is what a
caller sees and includes the pending start-up, which is why the web clips 7.4 s
at p99 and the worker 29.3 s. Cold-start count is the number of
`container/startup_latencies` samples, one per worker tick plus deployments. The
hourly tick therefore answers about 18 s after the scheduler fires: 5.7 s
container start, then an 11.5 s median tick that reads provider pages and
writes the run.

Cost, projected from the same seven days over 30.4375 days at us-east1 list
price (Cloud Billing catalog, 2026-10-30: $0.000024/vCPU-s, $0.0000025/GiB-s,
$0.40 per million requests):

| Service        | vCPU-s | GiB-s  | Requests | Gross  |
| -------------- | ------ | ------ | -------- | ------ |
| Web            | 12,546 | 3,969  | 7,366    | $0.314 |
| Worker         | 21,650 | 5,695  | 652      | $0.534 |
| Hosted browser | 4,146  | 6,045  | 87       | $0.115 |
| Total          | 38,342 | 15,710 | 8,105    | $0.963 |

The free allowances are 180,000 vCPU-seconds, 360,000 GiB-seconds and 2,000,000
requests per billing account, and this billing account also serves
`auto-gm-372620` (`mutation-api-prod`, another 19,425 vCPU-seconds and 9,541
GiB-seconds a month at the same projection). Together they use 32 % of the free
CPU, 7 % of the free memory and 0.4 % of the free requests, so Cloud Run bills
nothing at this size and every figure above is gross list price, not an invoice.
The project has no BigQuery billing export, so per-service cost is derived from
the allocation-time metrics that Cloud Run bills against.

These numbers fix the settings:

- **Minimum instances stay 0 on all three services.** One warm worker instance
  is 2,592,000 min-instance vCPU-seconds and 1,296,000 GiB-seconds a month:
  $6.57 + $3.29 = $9.86, against $0.53 of billable work today, and more than the
  CAD 5 budget on its own. It removes 5.7 s from a tick that runs once an hour.
  A warm hosted browser is $6.57 + $13.15 = $19.72 a month to remove the
  first-frame cold start.
- **Billing stays request-based** (`cpuIdle: true`, `cpu-throttling: true`). The
  2,406 idle instance-minutes a week are free only under this setting; charged
  across the instance lifecycle they would be 627,635 vCPU-seconds and 313,817
  GiB-seconds a month, about $11.93.
- **CPU and memory stay 1 vCPU / 512 MiB (web, worker) and 1 vCPU / 2 GiB
  (browser).** Peak memory is 41–42 % of the web and worker limits, both services
  are provider- and database-bound, and a smaller CPU would lengthen the tick
  rather than save a billed second. A real Chromium session reached 849 MiB, so
  2 GiB is 2.4× the observed peak; 1 GiB would leave less headroom than a heavier
  provider page can take.
- **Concurrency stays 2 (worker), 20 (web), 1 (browser).** Peak request
  concurrency is 1.9, 4.0 and 1.7. A lower web cap only starts more instances and
  pays more cold starts for the same work.
- **The worker timeout is 300 s, not 900 s.** The scheduler abandons an attempt
  at 300 s and Cloud Tasks abandons a delivery at its 10-minute dispatch
  deadline, so a longer server timeout only bills work whose caller has already
  given up. The measured tick is 17.8 s end-to-end at p50 and 29.3 s at p99, and
  300 s still covers a queued batch of about 50 runs at the measured ~2 s per
  run. A batch that is killed any way is retried by the queue and resumes from
  its recorded plan.

Deliberately unchanged, and what decided it:

- The hosted browser keeps minimum 0 and its 780 s timeout. The first link after
  a quiet period pays the 5.15 s container start measured above (9.4 s to the
  first JPEG frame in the 2026-10-25 probe), and a warm instance costs $19.72 a
  month to avoid it.
- The web keeps its 300 s timeout even though the browser session clock is ten
  minutes: one request in the last seven days ended in the 295–325 s bucket at
  that boundary. Raising it raises the worst case this section is bounding and
  needs a session-length measurement of its own first.
- Secret Manager versions and Artifact Registry storage are the other billed
  Cloud Run-adjacent items and are governed by their own notes above.

After the 2026-10-31 deploy the 02:55 UTC tick showed the same shape on worker
revision `…-00044-z9g`: one start-up sample, 7.8 billable instance-seconds for
the 5.7 s start and a 2.0 s tick (the earlier 20.7 s tick was the same start-up
plus a 14.8 s tick that had a run to deliver), 1.0 s billed when the instance
shut down, and 0.0 billable seconds in each of the fourteen idle minutes in
between. The timeout change cannot move those numbers; it bounds a stuck
request at 300 s instead of 900 s.

To repeat the comparison, ask for instance presence and billable seconds over the
same window and read them side by side (there is no `gcloud` time-series
command; the Monitoring API is the route):

```sh
TOKEN="$(gcloud auth print-access-token)"
END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START="$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)"   # GNU date: date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ
for metric in instance_count billable_instance_time; do
  curl -s -H "Authorization: Bearer $TOKEN" \
    "https://monitoring.googleapis.com/v3/projects/lineupkeep-prod/timeSeries?filter=metric.type%3D%22run.googleapis.com%2Fcontainer%2F${metric}%22&interval.startTime=${START}&interval.endTime=${END}&aggregation.alignmentPeriod=3600s&aggregation.perSeriesAligner=ALIGN_SUM"
done
```

Presence well above billable seconds is the idle window; presence equal to
billable seconds would mean instance-based billing or minimum instances have
crept back.

### Cold start and the waking shell (2026-10-31)

The web service scales to zero, so the first request after a quiet period pays for the container.
Cloud Run holds a request until the instance's startup probe succeeds, and its frontend neither caches
nor serves static files. Nothing served from inside the container can therefore paint before the
container starts; an edge cache is the only way past that floor, and this origin has none. The shell
below covers the wait after the container is reachable, which is where a suspended database or a stalled
provider call used to leave a blank tab.

**Where the wait went.** Sixteen web instances from the 2026-10-31 logs, decoded from
`cloud_run_revision` entries:

| Segment                               | Time                       | Log evidence                                    |
| ------------------------------------- | -------------------------- | ----------------------------------------------- |
| Instance start → app listening        | 2.1 s median (1.4–3.8 s)   | `Starting new instance` → `Listening on`        |
| Listening → startup probe succeeds    | 3.7 s median (2.5–4.2 s)   | `Listening on` → `STARTUP HTTP probe succeeded` |
| First cold render (the probe request) | 230 ms median (209–289 ms) | the probe's `GET / ok …ms`                      |
| Network round trip and transfer       | ~0.2–0.4 s                 | client TTFB minus the server's request duration |

The middle row was not work: `startupProbe.periodSeconds` was 5, so a server that listened after 2.1 s
waited for the next probe before Cloud Run routed anything. `webContainer()` now probes every second,
with a sixty-failure budget for the same sixty-second startup allowance. The worker and hosted browser
keep their five-second probes, where cold-start latency is not the first impression.

**Measured cold start, before and after.** `scripts/coldStart.ts` with a fresh browser context per
sample, a 390×844 phone viewport and no service worker, after sixteen idle minutes:

| Sample          | Revision      | TTFB   | First paint | First contentful paint | Load    |
| --------------- | ------------- | ------ | ----------- | ---------------------- | ------- |
| Landing, cold   | `…-00053-st6` | 6.45 s | 6.67 s      | 6.67 s                 | 6.89 s  |
| Team page, cold | `…-00053-st6` | 6.53 s | 6.93 s      | 6.93 s                 | 7.26 s  |
| Landing, cold   | `…-00053-st6` | 6.57 s | 6.81 s      | 6.81 s                 | 7.14 s  |
| Team page, cold | `…-00053-st6` | 6.26 s | 6.64 s      | 6.64 s                 | 12.72 s |
| Landing, cold   | `…-00054-jkl` | 3.41 s | 3.65 s      | 3.65 s                 | 3.85 s  |
| Team page, cold | `…-00054-jkl` | 3.37 s | 3.76 s      | 3.76 s                 | 4.01 s  |
| Landing, cold   | `…-00054-jkl` | 3.22 s | 3.42 s      | 3.42 s                 | 3.69 s  |
| Team page, cold | `…-00054-jkl` | 3.25 s | 3.64 s      | 3.64 s                 | 3.87 s  |

Median TTFB fell from 6.53 s to 3.37 s and median first contentful paint from 6.81 s to 3.65 s.
Cloud Run's own `container/startup_latencies` agrees: the previous revision measured 5.72–5.85 s
(p50 5.79 s, p95 5.85 s, plus one 11.2 s start) on this day, and the new one 2.57–2.77 s across the five
cold starts above (p50 2.60 s, p95 2.77 s).

The instance timeline behind those samples: instance start → listening 1.4–1.7 s, listening → probe
success 1.3–1.4 s, and the probe's own `/` render 131–152 ms. Before the change the same segments were
1.8–2.4 s and 3.7–4.0 s, with the probe's render at 216–230 ms. The probe warms the route, so the
visitor's own render is 15–22 ms. A warm request returned in 0.37 s TTFB and 0.74 s first paint both
before and after, so the cold samples carry the container and probe wait, not a rendering regression.

**The waking shell.** A document navigation whose render has not started within two seconds is answered
with a complete static document instead: the wordmark, "Lineupkeep is waking", a `role="status"` line
that says nothing has been read yet, and a **Try again** link to the same path. It carries
`x-lineupkeep-waking: 1`, `Cache-Control: no-store` and `noindex, nofollow`, so neither a browser nor a
crawler can keep or replay it as a page. It reloads itself once; a second stall within ten seconds
becomes "taking longer than usual" with the same retry link. It shows no navigation, teams or other data,
takes no focus, and has no animation to wait on. Healthy renders return in tens of milliseconds, so the
shell appears only when a dependency is stuck.

**Reproducing a cold start without keeping an instance warm.** Cloud Run keeps a scaled-to-zero instance
for at most fifteen minutes after its last request, and no request may reach it in that window. The
script reads the service's newest request from Cloud Logging, waits out the window itself, then samples:

```sh
# The newest request the service handled; 16 minutes later the instance is gone.
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc" AND logName:"run.googleapis.com%2Frequests"' \
  --project=lineupkeep-prod --limit=1 --format=value(timestamp)

# Sample a landing page and an anonymous team page; frames, timings and samples.json
# land in .artifacts/cold-start/<timestamp>-<label>/.
node scripts/coldStart.ts before \
  https://lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-hcfc7y3kha-ue.a.run.app \
  lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-00053-st6 \
  lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc / /teams
```

`COLD_START_IDLE_MINUTES` can raise the wait; the script refuses anything below sixteen minutes. The
`/teams` sample is anonymous, so the server answers the cold request with the `/auth` redirect and the
browser paints the sign-in page on the same instance; it measures the cold first byte, not a signed-in
team roster. Nothing keeps an instance warm, and no minimum instance count is set.

**Reproducing the breakdown.** Match each instance's three lifecycle entries, then read the probe
request's own duration:

```sh
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc" AND (textPayload:"Starting new instance" OR textPayload:"Listening on" OR textPayload:"STARTUP HTTP probe succeeded")' \
  --project=lineupkeep-prod --limit=200 --format="table(timestamp,labels.instanceId,textPayload)" --freshness=1d
```

`samples.json` records client TTFB, paint entries, LCP, load and the frames captured by the browser's
screencast. A page that has not painted cannot be captured with a screenshot, so the 200 ms and 1 s
frames are the unchanged frame from before the navigation: that is what the blank first impression is.

On 2026-10-31 the owner chose to keep the Cloud Run origin and accept the
container-bound first paint rather than add an edge cache. Revisit that only
with a registered domain and measured traffic that makes the edge worth its
cost and the auth-origin change.

### Retention and the zero bill

Two Google Cloud line items grew without bound before 2026-10-31, and both are
now owned by the stack instead of by memory:

- **Secret versions.** Publishing was once per deploy rather than once per value,
  so identical values accumulated: 98 active versions, 92 over the six free,
  about $5.52/month — the largest item on the account and more than the whole
  budget. `runtimeSecret` now memoizes the version command on its inputs
  (`memo: { include: [] }`), so an unchanged value publishes nothing, and
  `Retain-<name>-Version` runs after the web revision that pins the version is
  ready and destroys every other active version. Five secrets, five versions,
  no charge. One-off note: the 83 superseded versions present at the change were
  destroyed by hand before the step existed; the retained set was the versions
  the live and two previous revisions pinned, and every pinned version survived.
- **Images.** Every deploy pushes a new web and browser digest, because the
  publish step is deliberately not memoized. `RegistryCleanupPolicy` applies
  [registryCleanupPolicy.json](../infra/registryCleanupPolicy.json) — keep the
  two most recent versions of each package, delete everything else — with
  `--no-dry-run`. Artifact Registry owns the deletions on a background job, so
  they land within about a day of the policy or a push. Before the policy the
  repository held 61 images and 7.66 GB; the ceiling is now one web image and
  one browser image, about 0.42 GB, which fits inside the account's 0.5 GiB free
  allowance. `auto-gm-372620` contributed another 5.27 GB until 2026-10-31; see
  [the decommissioned project](#the-decommissioned-project).

What that costs and what it gives up:

| Setting                                                                            | Cost                                              | Trade                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retainedSecretVersions = 1` ([cloudRun.ts](../infra/hosts/cloudRun.ts))           | $0 — five versions are inside the six free        | A traffic rollback across a _value_ change cannot start, because the previous value's version is gone. Roll back by redeploying the previous value, which republishes it. Code-only reverse deploys are unaffected: versions are published per value, so revisions from before the change pin the same version. |
| `keepCount: 1` ([registryCleanupPolicy.json](../infra/registryCleanupPolicy.json)) | $0 — 0.42 GB is inside the account's 0.5 GiB free | The previous deploy's image is deleted, so `update-traffic` to an older revision cannot cold start; roll back by redeploying the previous source, which rebuilds it. `keepCount: 2` keeps the previous image for about $0.03/month.                                                                             |

Secret version numbers are resolved against the CLI's active project, which is
not this one, so every command in `Retain-<name>-Version` uses the fully
qualified `projects/<project>/secrets/<name>` and
`projects/<project>/secrets/<name>/versions/<n>` forms. `--secret=<id>` alone
resolves against whatever project gcloud currently points at and fails with a
404 that names the wrong project.

### The decommissioned project

The billing account `0139E5-D27389-43F1F2` shared every free allowance above
with `auto-gm-372620` (Fantasy AutoCoach, `877183802`), so whatever it consumed
was taken from this project. On 2026-10-31 the owner declared that project
finished and asked for all of it to go. In order: its 5.27 GB of images (46
`auto-coach`, 8 `gcf-artifacts`), its six Cloud Scheduler jobs — three enabled,
one firing hourly at a Cloud Run service that reported itself not ready, and
three paused leftovers from Firebase deployments — its two active secret
versions (a SendGrid key and a Yahoo client secret), and then the project
itself: two Cloud Run services, three ACTIVE first-generation Cloud Functions
behind Firebase authentication, one Firestore database, seven storage buckets
(about 5 MB, one of them a 55 KB Terraform state bucket), two empty secrets and
two empty repositories.

`auto-gm-372620` is now `DELETE_REQUESTED` with billing disabled, and the
account carries one live project. Deletion is reversible until about
2026-11-30 with `gcloud projects undelete auto-gm-372620`, which restores the
project and what is still inside it, Firestore and Firebase authentication data
included. The cleanup itself is outside this repository's IaC because the stack
does not own that project; the durable part is that nothing here may depend on
it again.

The same billing account also lists `gen-lang-client-0884516839` (Gemini API)
and `final-project-380918`, both ACTIVE and billing-enabled but dormant: no
Compute, Cloud SQL, Cloud Run, BigQuery or storage resources, and no
`generativelanguage` generation in the last thirty days. They were left alone
because the owner has not declared them finished. A dormant project costs
nothing; a live one would consume these allowances first.

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

Supply the six required application inputs through protected provisioning/CI inputs: canonical HTTPS `BETTER_AUTH_URL`, a generated random `BETTER_AUTH_SECRET`, a base64-encoded 32-byte `CONNECTION_ENCRYPTION_KEY`, `EMAIL_FROM`, `RESEND_API_KEY`, and a reviewed `AUTH_CLIENT_IP_HEADERS` policy. Optional rotation inputs are described under [connection credential encryption rotation](#connection-credential-encryption-rotation). Keep the auth and encryption secrets stable across restarts and rotate deliberately. The allowlist forwards secrets to the host, not to build commands; `APP_ENV` is generated as production.

### Connection credential encryption rotation

Provider session material is stored only as a versioned AES-GCM envelope. The envelope records the key
version, and authenticated data binds the owner, connection, provider, and key version. Every service reads
its keyring from configuration only, never from the database, so a database compromise cannot supply the key
that opens its own stored secrets.

| Input                                 | Required | Meaning                                                                                                                                                                  |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONNECTION_ENCRYPTION_KEY`           | yes      | Base64 32-byte key that seals every new and re-wrapped envelope.                                                                                                         |
| `CONNECTION_ENCRYPTION_KEY_VERSION`   | no       | Positive integer stamped into new envelopes, default `1`. Increase it with every new key.                                                                                |
| `CONNECTION_ENCRYPTION_RETAINED_KEYS` | no       | Comma-separated `version:base64-32-byte-key` entries the deployment may still decrypt with, for example `1:<old-key>`. Retained keys never encrypt. Empty means no ring. |

A lone `CONNECTION_ENCRYPTION_KEY` with no version and no ring is key version `1` and behaves exactly as
before. Every service must run the same ring; roll out a ring to web and worker together.

Opening a credential is its use. An envelope under a retained version still decrypts, and a successful open
reseals the same plaintext under the current key using a compare-and-swap on the stored envelope. A
concurrent reconnect or another rewrap has already replaced the envelope, so a losing writer never
overwrites newer material. Each envelope converges once, under normal traffic, with no migration. Use the
connections and let scheduled work run; nothing else is required.

Rotate without re-linking:

```sh
set -a && . ~/.config/lineupkeep/infra.env && set +a
# 1. Retain the current key under its current version (keeping any earlier retained
#    versions), mint the next key, then advance the version.
export CONNECTION_ENCRYPTION_RETAINED_KEYS="${CONNECTION_ENCRYPTION_RETAINED_KEYS:+$CONNECTION_ENCRYPTION_RETAINED_KEYS,}${CONNECTION_ENCRYPTION_KEY_VERSION:-1}:$CONNECTION_ENCRYPTION_KEY"
export CONNECTION_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export CONNECTION_ENCRYPTION_KEY_VERSION=$(( ${CONNECTION_ENCRYPTION_KEY_VERSION:-1} + 1 ))
# 2. Persist those three lines to ~/.config/lineupkeep/infra.env (mode 600), then
#    deploy from infra/ using the [redeploy commands](#redeploy-and-rollback).
```

Watch the old version drain. The hourly `tick` runs the credential-key census and reports it in the
`lineup.worker` wide event as `event.attributes`: `connection.credential_key_versions` (a `version:count`
list), `connection.credential_older_envelopes` (not on the current version), and
`connection.credential_unreadable_envelopes` (versions the ring no longer holds). The tick response
carries the same values as `credentialKeys`.

```sh
gcloud logging read 'resource.type="cloud_run_revision"
  AND jsonPayload.event.operation="lineup.worker"
  AND jsonPayload.event.attributes."connection.credential_older_envelopes">=0' \
  --project=lineupkeep-prod --freshness=2h --limit=1 \
  --format='value(jsonPayload.event.attributes)'
```

Retire only when the version's count is zero: remove its entry from `CONNECTION_ENCRYPTION_RETAINED_KEYS`
and deploy. Retirement is deliberate, never inferred. If an envelope still names the removed version, its
connection fails with the named refusal `connection.credential_key_version_unavailable` rather than a
generic decryption failure, and the census reports it under `connection.credential_unreadable_envelopes`.
The refused span also carries `connection.credential_key_version` and
`connection.credential_failure="key_version_unavailable"`:

```sh
gcloud logging read 'resource.type="cloud_run_revision"
  AND jsonPayload.event.attributes."connection.credential_failure"="key_version_unavailable"' \
  --project=lineupkeep-prod --freshness=24h --limit=5 \
  --format='value(jsonPayload.event.attributes)'
```

Restore that entry (while the key material still exists) and redeploy, or have the owner disconnect and
re-link that connection. Losing key material makes those sessions unrecoverable; it does not expose them.
Never place a key in logs, build outputs, tickets, repository files, or chat; record only versions and
counts.

Suspected key leak, first ten minutes:

1. Rotate immediately with the leaked key retained under its version, so new and re-wrapped envelopes no
   longer use it. Deploy the ring; do not disconnect first if you want to keep reading the old envelopes.
2. Assume the stored provider sessions are compromised if the database may also have been read. A key
   rotation does not revoke a provider session, and the provider cannot tell us from an attacker. Pause
   automated provider work (`gcloud scheduler jobs pause <job> --project=lineupkeep-prod --location=us-east1`,
   with the job name from `gcloud scheduler jobs list`), have each owner disconnect the affected
   connections on the Connections page so their ciphertext is deleted, and have them re-link after the new
   ring is live.
3. Keep the leaked key in the ring only while it enables convergence of envelopes you still intend to keep;
   remove it once `olderEnvelopes` reaches zero or those connections are disconnected, and deploy again.
4. Record the incident with key versions and counts only. Deleting a retained version before its envelopes
   are gone turns recoverable connections into re-links, which the named refusal will tell you about.

Scratch-database dry run of the mechanism, before any deployment:

```sh
bunx vitest run --project node \
  packages/backend/src/contexts/connections/internal/ConnectionCredentialEncryption.test.ts \
  packages/backend/src/contexts/connections/internal/ConnectionCredentialConvergence.test.ts \
  packages/backend/src/contexts/connections/internal/CredentialKeyCensus.test.ts
```

These exercise a retained version decrypting, convergence after use, the named refusal for an absent
version, and the census, against a disposable migrated database. They are not a substitute for verifying a
deployed ring on a scratch deployment.

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

### Browser sessions

A signed cookie keeps a browser signed in. Every authenticated request reads its `session` row, because
better-auth's cookie cache is disabled (`cookieCache: { enabled: false }` in `BetterAuthAdapter.ts`). The
chosen cache window is therefore zero. Ending a session deletes its row, and the next request from that
device finds nothing and is treated as signed out; sign-out does the same for the current device. A stolen
cookie cannot outlive the row it names.

The cost is one read of the `session` row by session token per authenticated request. The page shell reads
the session once and each server-function call reads it once more, so a page load costs about two indexed
reads. That is the whole price of a zero window, and at current traffic it is cheaper than a revocation
window nobody can see.

The same read refreshes `expires_at` and `updated_at` at most once every five minutes
(`session.updateAge`). That interval sets the resolution of the last-used time in the session list and caps
how often an active session writes. Sessions still expire after seven days without a refresh, and the
browser cookie is issued with the same seven-day life at sign-in. Session lifetime itself is unchanged;
shortening it changes sign-in continuity and needs a product decision.

The owner sees the list on the Connections page: the device hint derived from the stored user agent, when
the session started, and when it was last used, with the current device marked. The page can end one
session or every other session. Every statement is scoped by owner id, so the list never shows another
account's rows, and no session token is rendered. Sign-out is labelled "Sign out this device"; MCP grants
described above are separate and survive browser sign-out.

### Telemetry

Spans go to Cloud Trace through Google Cloud's Telemetry (OTLP) API. The Cloud Run host injects the OpenTelemetry configuration ([cloudRun.ts](../infra/hosts/cloudRun.ts)): `OTEL_TRACES_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_ENDPOINT=https://telemetry.googleapis.com`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, and `OTEL_RESOURCE_ATTRIBUTES=gcp.project_id=lineupkeep-prod`. Effect's OTLP exporter posts protobuf batches to `/v1/traces`; there is no collector, no log-based span writer, and no observability vendor. Alchemy has no Cloud Run telemetry binding (its telemetry layer targets its own Worker/Lambda/Container runtimes), so the host injects the standard OpenTelemetry environment rather than application code hard-coding an endpoint.

Authentication is the runtime service account. The exporter asks the Cloud Run metadata server for an access token and sends it as a bearer token; the host grants `roles/telemetry.tracesWriter` to the web and worker accounts. There is no key file, no Secret Manager entry, and no exporter secret. The exporter only authenticates the endpoint whose host is `telemetry.googleapis.com`; any other OTLP endpoint, including the local verification collector, is exported without a token. `OTEL_TRACES_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_EXPORTER_OTLP_PROTOCOL` are host-owned on Cloud Run: a stage environment that sets them is ignored for these services so the revision cannot carry duplicate values. Where a host leaves them unset, or sets the exporter to `none`, the tracer falls back to the no-op tracer and the wide events still write on the Node host; Cloudflare is unaffected.

Telemetry never fails a request or a run. The exporter catches failures, drops the batch, and disables itself for 60 seconds. After the response is built, each HTTP request waits at most three seconds for one final drain, so a scaled-to-zero instance does not lose the spans it just produced; a slow or unavailable Telemetry API costs at most that bounded wait.

The tracer uses the trace id Cloud Run passes in `X-Cloud-Trace-Context`, converting its decimal span id to the 16-digit hexadecimal form Cloud Trace expects. Cloud Run's own request log, the wide event line, and the spans therefore share one trace. The request span records `request.id` (the caller's `x-request-id`, or the id the entry generates), and each worker run records `lineup.request` (the domain request id that links a browser or MCP submit to every run it created).

#### Wide events

One structured log entry is written per unit of work: an HTTP request (the `http.server.request` span) and a lineup run (the `LineupWorker.run` span). A worker request that delivers several runs writes one request entry and one entry per run. The entry is an aggregation of the spans already collected for that unit — the same spans in Cloud Trace, not a second instrumentation path. The unit root and every descendant that ended before it contribute their attributes; the last completed value wins for a repeated key.

Top-level fields are the severity, a `message` such as `GET /teams ok 179.2ms`, the reserved `logging.googleapis.com/trace` / `spanId` / `trace_sampled` fields, and an `event` object:

| Field            | Meaning                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`           | `http_request` or `lineup_run`; the alert and the queries key off this                                                                                                     |
| `operation`      | The operation span's `app.operation` (for example `teams.list`, `mcp.request`, `lineup.worker`), or the unit's own span name for a run                                     |
| `route`          | Method and path for an HTTP request (`GET /teams`); omitted for a run                                                                                                      |
| `tool`           | The MCP tool name when the request served a tool call; omitted otherwise                                                                                                   |
| `request_id`     | The HTTP request id; omitted for a run                                                                                                                                     |
| `lineup_request` | The domain request id, when the unit touched one                                                                                                                           |
| `run_id`         | The lineup run id; only on a `lineup_run` entry                                                                                                                            |
| `actor`          | The authenticated `user.id` (opaque identifier, never an address)                                                                                                          |
| `connection_id`  | Provider connection id, when known                                                                                                                                         |
| `team_id`        | Fantasy team id, when known                                                                                                                                                |
| `outcome`        | The worst outcome among the unit's spans that carry `app.outcome` or `app.operation`: `ok`, `rejected`, `interrupted`, `retry`, `blocked`, `uncertain`, `failed`, `defect` |
| `status_code`    | The unit root's `http.response.status_code`                                                                                                                                |
| `duration_ms`    | Unit duration                                                                                                                                                              |
| `span_count`     | Ended spans aggregated into the entry                                                                                                                                      |
| `spans`          | Per-span-name `count`, `total_ms`, and `max_ms`, largest total first (at most 24 names)                                                                                    |
| `attributes`     | Merged business attributes: `app.*`, `auth.*`, `lineup.*`, `team.*`, `connection.*`, `provider.*`, `query.*`, `feedback.*`, `tool`, and so on                              |

Validation rejections, unauthorized requests, and not-found results are expected outcomes and are recorded as `rejected`; a defect or an unexpected failure is `failed` or `defect`. Genuinely exceptional work that is not a unit keeps its own entry: for example a client-reported render or server-function error recorded by `/api/telemetry` still logs its own error line, as does a failed background operation. Those lines are plain text and do not carry the trace id; the unit entry for the same request does. Startup, shutdown, and the Cloud Run request log are separate entries and unchanged.

#### Span and attribute inventory

| Span                                                                                                            | Carries                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http.server.request` (server)                                                                                  | `http.request.method`, `url.path`, `request.id`, `http.response.status_code`                                                                                                                                                                          |
| Operation spans such as `teams.list`, `connections.list`, `lineup.worker`, `auth.session` (server)              | `app.operation`, `request.id`, `app.outcome`, `error.type`, `http.response.status_code`                                                                                                                                                               |
| `LineupRuns.submit`                                                                                             | `lineup.request`, `lineup.run_count`, `lineup.delivery`, `lineup.replayed`                                                                                                                                                                            |
| `LineupWorker.deliver` (batch)                                                                                  | `lineup.run` on a delivery failure, `lineup.delivery_count`                                                                                                                                                                                           |
| `LineupWorker.run` (one per run)                                                                                | `lineup.run`, `lineup.request`, `team.id`, `connection.id`, `lineup.trigger`, `lineup.attempt`, `lineup.status`, `lineup.resumed`, `lineup.implementation`, `lineup.action`, `lineup.provenance`                                                      |
| `LineupWorker.run` terminal outcome                                                                             | `app.outcome` (`success`, `failure`, `blocked`, `retry`), `lineup.outcome` (`changed`, `no_op`, `failed`, `uncertain`, `blocked`, `retry`), and `lineup.failure_reason` / `lineup.uncertain_reason` / `lineup.blocked_reason` / `lineup.retry_reason` |
| Provider operations such as `YahooProvider.readRoster`, `YahooProvider.readLeague`, `YahooProvider.scoreRoster` | `provider.operation`, bounded counts (`provider.player_count`, `provider.team_count`, `provider.day_count`, `provider.period_count`), `provider.outcome` on writes (`accepted`, `rejected`, `not_sent`, `unknown`, `session_rejected`)                |
| `PublicInternet.request` (client)                                                                               | `http.request.method`, `server.address`, `http.response.status_code`; no full URL, query, headers, cookies or payload                                                                                                                                 |
| `email.send`                                                                                                    | `email.provider`, `email.purpose`, `email.provider_message_id`; no recipient or body                                                                                                                                                                  |
| Effect SQL children                                                                                             | statement text and timing only; bind values and causes are suppressed                                                                                                                                                                                 |

The hosted browser is a separate Node process with no Effect tracer. It writes a structured `hosted_browser.session` event with session id, outcome, duration, failure class, and any refused host and reason. It is not part of a lineup run trace; linking-session correlation stays on the session id.

#### Redaction and volume

The wide event is written behind the same [safe tracer](../packages/backend/src/runtime/Observability.ts) boundary used for the trace export, so exception, cause, header, parameter, URL-query, and client-path data never reach it. The [wide-event writer](../packages/backend/src/runtime/WideEventTracer.ts) keeps the previous suppression list: token, cookie, crumb, secret, password, email, note, body, and payload keys (exact or suffix) are dropped, `parameters` is dropped, and a `Redacted` value renders as `[REDACTED]`. Low-level transport detail (`db.*`, `effect.sql.*`, `network.*`, `server.*`, the request method, path, and status) is not merged into the wide event even though those child spans keep it in Cloud Trace; SQL statement text therefore stays in the trace, and bind values are never exported. Attribute values are capped at 512 characters, at most 64 merged attributes, 16 array items, 24 span groups, and 4096 span records per trace. Structured values such as provider payloads are dropped rather than serialized. Never add a per-row provider payload, a token, a crumb, a cookie, a note body, or an email address to a span or to a wide event.

Every span is exported; no provider read is sampled out. A provider read is one span per call with a bounded operation name and counts, never a response body or player list. Sampling of the incoming trace changes nothing about the log volume: a wide event is written for every unit whether or not Cloud Run sampled the trace.

Volume for the hour 07:00–08:00 UTC on 2026-10-31, before this change: 389 entries for the web and worker services, 383 of them span lines, for two HTTP requests and one hourly tick that ran five lineups. The 07:55 tick's trace alone was 377 entries. The same shape after the change — one worker request delivering five runs, 318 spans — is six entries (one request plus five runs), and the full waterfall is in Cloud Trace. The 40 minutes after the deploy (09:20–10:00 UTC) held 29 entries for both services: five wide events, zero span lines, and the rest instance startup/shutdown and Cloud Run request/rollout lines, which stay separate. A quiet hour with a single page load is two entries (the wide event plus Cloud Run's own request log) instead of a dozen or more.

#### Queries

Use Logs Explorer or `gcloud logging read`. The worker service is
`lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y`; the web service is
`lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc`. Keep `resource.type` in every
query so the request logs remain available for the same trace.

Failed or uncertain run:

```
resource.type="cloud_run_revision"
resource.labels.service_name="lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y"
jsonPayload.event.kind="lineup_run"
jsonPayload.event.outcome=("failed" OR "uncertain")
```

One run by id:

```
resource.type="cloud_run_revision"
jsonPayload.event.kind="lineup_run"
jsonPayload.event.run_id="<run id>"
```

A team's last run (sort newest first, then read `event.outcome` and `event.run_id`):

```
resource.type="cloud_run_revision"
jsonPayload.event.kind="lineup_run"
jsonPayload.event.team_id="<team id>"
```

Every unit that touched a domain request (a submit plus the runs it created):

```
resource.type="cloud_run_revision"
jsonPayload.event.lineup_request="<domain request id>"
```

The unit for an HTTP request id. This returns exactly one entry; open its
**Trace** link to see the spans:

```
resource.type="cloud_run_revision"
jsonPayload.event.request_id="<request id>"
```

In the CLI, ask for the trace field directly:

```sh
gcloud logging read 'resource.type="cloud_run_revision" AND jsonPayload.event.request_id="<request id>"' \
  --project=lineupkeep-prod --limit=1 --format='value(trace)'
```

Read the trace back with the Cloud Trace API. Ingestion takes about a minute; a trace read before then returns 404:

```sh
curl -sS -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://cloudtrace.googleapis.com/v1/projects/lineupkeep-prod/traces/<trace id>"
```

The v1 response lists spans with decimal `spanId` / `parentSpanId` fields; convert them to the hex ids the log entry's `spanId` uses when matching a wide event to its root span.

A slow provider call is now a trace question, not a log query: filter Trace Explorer on the `YahooProvider.*` span names with a duration over two seconds, or open the run's wide event by `event.run_id` and follow its trace. The wide event's `spans` list already names the slowest span groups with `total_ms` and `max_ms`.

Recorded example. This is one real request entry with synthetic ids; Cloud Run
wraps it into a `jsonPayload` log entry. Its trace is the one to open:

```json
{
  "severity": "INFO",
  "message": "GET / ok 79.2ms",
  "logging.googleapis.com/trace": "d3eebcde75f4c8c8325b38080e1b27b9",
  "logging.googleapis.com/spanId": "d8694b642b18d752",
  "logging.googleapis.com/trace_sampled": true,
  "event": {
    "kind": "http_request",
    "operation": "auth.session",
    "route": "GET /",
    "request_id": "req_01J9ZK3F7M2C9Q4D6H8R1T5VWX",
    "outcome": "ok",
    "status_code": 200,
    "duration_ms": 79.2,
    "span_count": 4,
    "spans": [
      { "name": "auth.session", "count": 1, "total_ms": 1.4, "max_ms": 1.4 },
      { "name": "getCurrentAuthSession", "count": 1, "total_ms": 0.4, "max_ms": 0.4 },
      { "name": "AuthService.getSession", "count": 1, "total_ms": 0.1, "max_ms": 0.1 }
    ],
    "attributes": {
      "app.operation": "auth.session",
      "app.outcome": "success",
      "auth.state": "anonymous",
      "request.id": "req_01J9ZK3F7M2C9Q4D6H8R1T5VWX"
    }
  }
}
```

A lineup run entry from a scheduled tick. The provider reads and their counts
are inside the same entry, and `event.spans` names where the time went. Its
`logging.googleapis.com/trace` is shared with the worker request entry and with
every other run in that delivery:

```json
{
  "severity": "INFO",
  "message": "lineup run 019a3f2e-4d4b-7c2a-9f10-6f2b1d8e4a11 ok 2043.1ms",
  "logging.googleapis.com/trace": "d3eebcde75f4c8c8325b38080e1b27b9",
  "logging.googleapis.com/spanId": "8a4842545a46d06f",
  "logging.googleapis.com/trace_sampled": true,
  "event": {
    "kind": "lineup_run",
    "operation": "LineupWorker.run",
    "lineup_request": "req_01J9ZK3F7M2C9Q4D6H8R1T5VWX",
    "run_id": "019a3f2e-4d4b-7c2a-9f10-6f2b1d8e4a11",
    "actor": "01a17360-1cb3-74eb-afe1-efb23ae91784",
    "connection_id": "019a3f2e-4d4b-7c2a-9f10-6f2b1d8e4a33",
    "team_id": "019a3f2e-4d4b-7c2a-9f10-6f2b1d8e4a22",
    "outcome": "ok",
    "duration_ms": 2043.1,
    "span_count": 53,
    "spans": [
      { "name": "PublicInternet.request", "count": 6, "total_ms": 1228.2, "max_ms": 278.9 },
      { "name": "sql.transaction", "count": 5, "total_ms": 518.7, "max_ms": 133.1 },
      { "name": "YahooProvider.readRoster", "count": 2, "total_ms": 453.0, "max_ms": 227.3 },
      { "name": "YahooProvider.readLeague", "count": 2, "total_ms": 412.3, "max_ms": 209.4 },
      { "name": "postgres", "count": 25, "total_ms": 386.6, "max_ms": 17.0 }
    ],
    "attributes": {
      "app.outcome": "success",
      "connection.id": "019a3f2e-4d4b-7c2a-9f10-6f2b1d8e4a33",
      "lineup.action": "explicit_assignments",
      "lineup.attempt": 1,
      "lineup.implementation": "custom_policy",
      "lineup.outcome": "no_op",
      "lineup.request": "req_01J9ZK3F7M2C9Q4D6H8R1T5VWX",
      "lineup.resumed": false,
      "lineup.run": "019a3f2e-4d4b-7c2a-9f10-6f2b1d8e4a11",
      "lineup.status": "reading",
      "lineup.trigger": "scheduled",
      "provider.operation": "read_player_details",
      "provider.player_count": 21,
      "provider.player_fact_count": 21,
      "team.id": "019a3f2e-4d4b-7c2a-9f10-6f2b1d8e4a22"
    }
  }
}
```

Recorded trace. This is the span tree read back from Cloud Trace for a real
worker request on revision `lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y-00050-cv4`
(the ids are shown in hexadecimal; the v1 API reports them in decimal). It is
one trace with 318 spans; the five runs hang under the single worker request,
and each run's provider and SQL children hang under that run. The later
`00052-zch` revision changed only which attributes the wide event merges, not
which spans are exported:

```
89ece6d31d37bc1e /api/internal/lineup-worker            (Cloud Run request span)
└─ 6a0fff064e62ec34 http.server.request
   └─ 30278c1126035e9f lineup.worker
      └─ e5f78c17b80834a3 Automation.run
         ├─ ... LineupRunRepository.createScheduledRuns ...
         └─ cec60093a2a9395f LineupWorker.run        lineup.outcome=changed
            ├─ YahooProvider.readLeague
            ├─ YahooProvider.readRoster
            ├─ YahooProvider.readPlayerHistory
            ├─ PublicInternet.request
            ├─ postgres
            └─ LineupRunRepository.beginApply
         └─ ... four more LineupWorker.run spans, each with the same children ...
```

#### Alerts

`infra/hosts/cloudRun.ts` declares a log-based Cloud Monitoring alert policy,
`Lineupkeep failed or uncertain lineup runs`, with this filter:

```
resource.type="cloud_run_revision"
jsonPayload.event.kind="lineup_run"
jsonPayload.event.outcome=("failed" OR "uncertain")
```

It rate-limits notifications to one per five minutes. When `ALERT_EMAIL` is set in the provisioning environment, the same stack creates an email notification channel and attaches it. The recipe then sends a verification message; verify the channel before relying on it. Without `ALERT_EMAIL`, incidents still open in Cloud Monitoring but no email is sent. Creating the policy and channel is a deploy-plan change, not something a local check can prove.

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
