# Stage 5 infrastructure plan

Status: deployed on 2026-10-25. The `cloud-run` stage created the described Scheduler job, queue, worker IAM bindings, and both Cloud Run services after the plan review. See [the deployed environment](../deployment.md#deployed-environment-2026-10-25) for the inventory, smoke results and remaining gates. The original plan-only record is retained below for provenance.

## Intended change

The Alchemy Cloud Run host now declares one shared hourly Cloud Scheduler job:

- Resource: `LineupTick`
- Schedule: `0 * * * *` UTC
- Target: the private worker at `POST /api/internal/lineup-worker`
- Body: `{ "action": "tick", "limit": 50 }`
- OIDC audience: the worker URL, using the existing `QueueEnqueuer` service account
- Attempt deadline: 300 seconds
- Retry: 2 attempts with bounded backoff

The tick action expires provider-day pauses, schedules one current-period run per eligible team, repairs undispatched work, delivers pending reconnect notifications, and sweeps retained rows. It reuses the existing queue, worker identity, invoker binding, and Cloud Run service; no second Scheduler job or queue was added. The previous hourly repair-only job is replaced by this tick job because repair is part of the tick.

## Plan attempt

Command:

```sh
cd /Users/graemefolk/Documents/Software/lineupkeep
ALCHEMY_STATE_DATABASE_URL='postgres://...local-only...' \
GCP_REGION='us-central1' \
...plan-only application values... \
bun --filter @lineupkeep/infra plan --stage cloud-run --no-input
```

The plan reached `Computing plan` and then stopped before producing a resource diff:

```text
[INFO] Plan · cloud-run
[INFO] Importing stack module
[INFO] Resolving stack services
[INFO] Loading stack state
[INFO] Computing plan
[ERROR] InvalidReferenceError: Reference to 'Postgres' in stack 'LineupkeepDatabase' and stage 'production' not found. Have you deployed 'production' of 'LineupkeepDatabase'?
[ERROR] Service not found: GCP::Environment
```

No resource was changed. The local state database used only to exercise the planner was stopped afterward.

## What deployment acceptance still needs

- A dedicated protected Alchemy state database and the production Neon project reference.
- Explicit destination/billing/budget approval and an Alchemy-compatible GCP credential injected into the command environment.
- A plan reviewed against the intended Scheduler job, queue limits, worker IAM, secrets, and runtime environment.
- A separately scoped deploy, followed by a real tick, a reconnect-email retry, retention cleanup, and Cloud Run acceptance.
