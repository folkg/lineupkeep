# Hosting comparison

Status: Cloud Run + a fresh Neon Free PostgreSQL project accepted; public/private service split accepted. Detailed resource configuration remains to be designed. No deployment is authorized yet. Prices are USD and primary-source pages were inspected during this planning session. Verify account-level allocations, plan eligibility, and region before deployment. Free allowances are not an availability guarantee or a hard spending cap.

## Accepted compute choice and remaining recommendations

Choose request-billed GCP Cloud Run first, targeting one user and five fantasy teams. The user's preference supersedes the earlier Cloudflare Paid recommendation. Cloudflare may become attractive after expansion, but do not implement a second production target now.

Propose minimum instances zero, Cloud Tasks, a shared Cloud Scheduler, and an independently owned scale-to-zero Postgres database. Accept container/database cold starts and account for billed request duration, including I/O waits, startup, and auxiliary services. Neon Free is the accepted database choice, using a fresh project owned by this product. The accepted topology is a public web/MCP service plus an IAM-protected background service, both scale-to-zero and sharing domain code.

Cloudflare Workers Paid remains a comparison option with its $5/month compute minimum, not the current target. Maintain clean domain/infrastructure seams without building a custom multi-cloud framework.

AWS Lambda + SQS + EventBridge Scheduler is credible but currently has less direct starter integration. It is not rejected technically; its extra integration work is not justified purely by chasing a free compute allowance without workload measurements.

Do not rewrite the starter's relational auth/domain persistence into D1, DynamoDB, or Firestore merely to obtain a free database. Such a change needs its own trade-off and approval. All-in-GCP/AWS managed Postgres is a different cost proposition from external scale-to-zero Postgres.

## Cloud Run cold-start and cost work

The currently inspected starter host is NOT configured for our accepted scale-to-zero policy: `cloudRunTemplate()` sets `minInstanceCount: 1`, and its container sets `cpuIdle: false`. Do not blindly inherit these settings or claim the current configuration is free-tier oriented. Update them in the approved successor, not as a side effect in the starter repository.

Proposed launch settings and verification:

- Request-based billing, minimum zero, a bounded maximum instance count, and no keep-warm pings.
- Lean multi-stage production image, no dev dependencies or runtime package installation/builds.
- No migrations, browser startup, or mandatory network-heavy discovery during process readiness.
- Reuse initialized Effect runtime/resources across requests where safe, while keeping MCP requests stateless and credentials connection-scoped.
- Defer infrequently used initialization without disguising first-request latency as eliminated startup latency.
- Measure startup CPU boost's billed cost and latency benefit; do not treat it as free.
- Benchmark realistic memory and concurrency rather than blindly reducing memory or spawning instances unnecessarily.
- Place service and database in nearby compatible regions; measure database wakeup and reconnection behavior separately.
- Finish queue work within the authenticated worker request before acknowledging delivery; do not rely on background fibers after the response under CPU throttling.

The starter's `neonDatabase` currently references an existing starter stack. Independent rewrite means a NEW project/database and new secrets; reuse the implementation pattern, never its live database resource reference.

Sources: inspected `infra/hosts/cloudRun.ts`, `infra/database/neon.ts`, and Google's [general Cloud Run development tips](https://docs.cloud.google.com/run/docs/tips/general). No starter configuration was edited.

## Verified documentation facts

### Cloudflare

- Workers Free: 100,000 requests/day, 10 ms CPU per HTTP or Cron invocation, 128 MB isolate memory, 50 subrequests per invocation, and 5 Cron Triggers/account.
- Network wait is not CPU, but Effect execution, decoding/validation, JSON parsing, cryptography, rendering, and optimization do consume CPU. Prior Yahoo research observed hundreds of KB per rich team and over 1 MB for a bulk response. Free-tier safety is not established by a small count of users.
- Workers Paid: $5/month minimum; 10 million requests and 30 million CPU milliseconds/month included. Ordinary invocations default to 30 seconds CPU and can be configured up to 5 minutes. This is not an app-total $5 guarantee.
- Queues Free: 10,000 operations/day and 24-hour retention. A small successful message normally costs one write, one read, one delete; retries add operations. Batching messages does not remove per-message operation charges.
- Queues Paid: 1 million operations/month included, then $0.40/million.
- Workflows Free: 3,000 steps/day, 10 ms CPU per invocation, with requests shared with Workers. Workflows is not a blanket escape from free Worker CPU limits.
- SQLite-backed Durable Objects are available on Free, with their own storage/duration quotas. The limits page lists 30-second default CPU and also cross-references Worker invocation limits. Verify the exact free-account behavior before proposing Durable Objects as a CPU solution. A DO-centered execution design is a real architecture choice, not proof that the current app fits Free.
- D1 has a free allowance but is SQLite, not the starter's Postgres database. Its availability does not make a database port free engineering work.
- No server-hosted browser is required by the agreed local-helper linking approach.

### GCP

- Request-billed Cloud Run: 2 million requests, 180,000 vCPU-seconds, 360,000 GiB-seconds/month free, applied using the documented region pricing and aggregated by billing account. Do not confuse these with the different instance-billed/jobs allowances.
- Cloud Tasks: first 1 million operations/month free; next tier $0.40/million. Payloads are chunked at 32 KB, and creation/dispatch/retries/control calls must be accounted for.
- Cloud Scheduler: 3 jobs/month free per billing account, then $0.10/job/month. One shared scheduler can select due teams; a job per team is unnecessary.
- Cloud Run outbound internet transfer has a limited regional free allowance, and build/image storage, logs, secrets/KMS, database, and email are separate dimensions. Avoid always-on instances, VPC connectors, and unnecessary Cloud Run Jobs for small HTTP tasks without examining their billing.
- Alchemy documentation and the installed package include CloudTasks Queue/CreateTask support. The current starter already has a Cloud Run host and a Neon database stage. No production deployment or queue integration was tested here.

### AWS

- Lambda Event Functions list a monthly free allowance of 1 million requests and 400,000 GB-seconds. Provisioned concurrency does not receive the same free allowance.
- Alchemy documents Lambda Function URLs, SQS consumers, EventBridge Scheduler, and SES bindings. The current starter does not expose an AWS host stage.
- Model SQS, schedule invocations, logs, email, database, public egress, and optional front-door charges separately. Avoid NAT gateways and managed always-on Postgres as incidental defaults.
- Temporary new-account credits are not a durable free-tier architecture. Verify the actual account's plan and eligibility.

### Cloud SQL versus scale-to-zero Postgres

The user clarified that recurring free-tier fit is required, not just minimizing a paid baseline. Cloud SQL does not offer an ongoing free PostgreSQL instance allowance; its [free trial instance](https://docs.cloud.google.com/sql/docs/postgres/free-trial-instance) lasts up to 30 days. Cloud Run's compute free allowance is a separate product and cannot offset Cloud SQL charges. An always-running Cloud SQL instance therefore does not meet the stated requirement.

Google's [Cloud SQL start/stop documentation](https://cloud.google.com/sql/docs/postgres/start-stop-restart-instance) says a manually stopped PostgreSQL instance remains stopped until explicitly started and does not respond to application connections. Stopping suspends instance charges, but storage and IP-address charges continue. This is not automatic connection-triggered suspend/resume like Neon; do not import RDS stop-duration rules into Cloud SQL.

For an application expected to accept logins and run hourly without orchestrating database start/stop, Cloud SQL would ordinarily remain running and incur recurring instance/storage charges. This makes Neon Free the recommended lowest-cost fit for the current starter and five-team workload, subject to actual quota use. It is not a claim that every GCP database is always-on or that no other provider offers a free Postgres plan.

### Database and email apply to every compute choice

- The current starter already declares Cloudflare+Neon and Cloud Run+Neon deployment stages. This establishes an existing implementation path, not a stable-baseline handoff or production proof.
- Neon's inspected Free plan lists 100 CU-hours/project, 1 GB/project storage, 5 GB/project public transfer, and forced suspension after 5 minutes of inactivity. Plan terms can change; verify before launch.
- Frequent application or background queries can prevent suspension. At an illustrative 0.25 CU, 30 days continuously awake consumes 180 CU-hours, exceeding 100. Hourly bursts that allow actual suspension are very different from staggered continuous traffic. Database cold starts remain even with edge compute.
- Resend is a candidate transactional email adapter: Free currently lists 100 emails/day and 3,000/month. Domain verification, authentication mail, reconnect incidents, retries, and daily bursts all matter. Email provider choice is not accepted yet.
- Do not email cookies, credentials, raw provider errors, or private roster content. Deduplicate action-required notifications and keep durable notification delivery/retry separate from lineup mutation recovery.

## Illustrative sizing, not benchmark results

Assume 24 hourly team runs/day and one small queue message/run, before retries or batching optimizations:

| Enabled teams | Runs/day | Runs/30 days | CF queue ops/day at 3/run |
| ------------- | -------: | -----------: | ------------------------: |
| 5             |      120 |        3,600 |                       360 |
| 100           |    2,400 |       72,000 |                     7,200 |
| 1,000         |   24,000 |      720,000 |                    72,000 |

Cloudflare's free queue allowance would fit the first two idealized cases, not the third. Actual operation counts include retries and other work. At six paid Workflow steps/run, 100 teams would use 14,400 steps/day, beyond the free 3,000/day; six is an illustrative design, not a selected implementation. Database state-machine transitions need not map one-for-one to managed Workflow steps.

If a full run used 50 ms CPU, 100 teams would use 3.6 million CPU ms/month, below Workers Paid's 30 million included. This is not measured and says nothing about the Free 10 ms per-invocation limit. UI/auth/query traffic is additional.

If a Cloud Run run occupied 1 vCPU for one billed second at concurrency one, 100 teams would consume 72,000 vCPU-seconds/month; five seconds would consume 360,000. These scenarios are not predictions: startup, concurrency, network wait, memory allocation, and traffic patterns determine the bill.

## Five-team free-tier launch worksheet

These are planning estimates, not measured usage or permission to provision. Existing projects may already consume shared billing-account allowances.

| Dimension         | Initial planning assumption                                                                                                                 | Acceptance work                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Team runs         | 5 × 24 × 30 = 3,600/month before skips/retries                                                                                              | Measure full native/query/optimizer work, not only HTTP counts                                                    |
| Cloud Run         | At an illustrative 10 billed seconds/run and 1 vCPU, 36,000 vCPU-seconds plus startup/dispatcher/UI traffic                                 | Below 180,000 only if real totals and shared allocation fit; measure concurrency/memory/startup                   |
| Cloud Tasks       | Even a conservative 10 operations/run is 36,000/month for small reference-only payloads                                                     | Account for retries/control calls and actual chunking; free allowance 1M/month                                    |
| Scheduler         | One shared hourly job, also triggering bounded repair/cleanup                                                                               | Verify remaining portion of three free jobs/account                                                               |
| Neon app compute  | Hourly bursts with actual suspension; 0.25 CU awake five minutes/hour would be 15 CU-hours/30 days                                          | Wakeup tail, pool health queries, interactive traffic and autosizing can increase this; no always-on poller       |
| Neon storage      | At illustrative 1 KiB/run outcome plus 5 KiB/diagnostic, 30-day outcomes and 7-day diagnostics are about 8 MiB before indexes/auth/overhead | Measure real bytes; retention across events/traces/outbox/backups matters                                         |
| Email             | A few sign-in/reconnect messages, not a message per team/run                                                                                | Resend 100/day and 3,000/month; open registration requires quota-aware abuse handling                             |
| Secret Manager    | Aim for no more than six active versions in the billing account                                                                             | Plain config must not become a secret per setting; existing secrets and disabled old versions count               |
| Artifact Registry | Retain only measured required image/revision layers inside the remaining 0.5 GiB free storage                                               | The current image has not been built/measured here; cleanup policies and rollback requirements must be reconciled |

Cloud Run application runtime and protected Alchemy state must use independent database access. Keep migration/provisioning credentials out of both runtime services. A state-only Neon project/role also needs its own quota/recovery review; don't pretend infrastructure state is free ephemeral local storage.

### Secrets and cryptography cost

Secret Manager currently includes six active versions and 10,000 access operations/month per billing account. Both enabled and disabled versions count. The starter currently creates a secret per environment entry; the successor should separate plain configuration from genuine secrets and avoid accumulating versions after every deploy.

A versioned application AES-GCM envelope with a Secret Manager-held key is a candidate for cookie encryption without a paid generic KMS key baseline. Use native cryptography behind Effect with authenticated owner/connection context and deliberate rotation/recovery. Cloud KMS documents free usage specifically for Autokey-created keys; do not assume arbitrary application KMS keys qualify. This is a security design to implement and test, not an excuse to store cookies plaintext.

Build locally or in approved CI using the starter path where practical. Cloud Build's documented free minutes are machine/pool-specific and marked promotional; do not make long-term free-tier fit depend on an unverified build tier. Builds, images, logs, egress, database, email, and existing billing-account usage remain separate dimensions.

Budget alerts are not hard spending caps. With open public registration, no platform choice alone can guarantee a $0 invoice under arbitrary abuse. The accepted goal is recurring free-tier fit at expected usage, with bounded work, ordinary rate limits, quota awareness, and no automatic paid-plan upgrade.

Sources: [Secret Manager](https://cloud.google.com/secret-manager/pricing), [KMS](https://cloud.google.com/kms/pricing), [Artifact Registry](https://cloud.google.com/artifact-registry/pricing), [Cloud Build](https://cloud.google.com/build/pricing), plus compute/database/email sources below.

## Acceptance check before locking deployment

1. Inspect the stable starter's final runtime, PublicInternet, auth, database, and machine contracts; do not infer readiness from file presence.
2. Measure representative auth, SSR, MCP, bounded rich Yahoo parsing, encryption, and worst-supported optimizer cases using sanitized synthetic inputs.
3. Check actual deployed CPU/memory behavior, not only local elapsed time. Production deployment requires separate authorization.
4. Exercise cron → queue → durable run → provider adapter → verification, including duplicate delivery and ambiguous writes.
5. Test provider egress from the chosen platform. A platform can be compute-compatible but still encounter Yahoo session restrictions or anti-abuse responses. Do not assume cookies obtained locally work from every cloud egress.
6. Model database wakeups, retention, state writes, logs, email bursts, and retries at agreed team counts.
7. Add alarms, bounded concurrency, retention policies, quota awareness, and spending controls. Cloud billing alerts alone are not hard spending caps.

## Primary sources

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/queues/platform/pricing/
- https://developers.cloudflare.com/workflows/reference/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://cloud.google.com/run/pricing
- https://cloud.google.com/tasks/pricing
- https://cloud.google.com/scheduler/pricing
- https://aws.amazon.com/lambda/pricing/
- https://neon.com/pricing
- https://www.resend.com/docs/knowledge-base/account-quotas-and-limits
- https://alchemy.run/cloudflare/
- https://alchemy.run/gcp/
- https://alchemy.run/gcp/guides/bindings/
- https://alchemy.run/aws/
