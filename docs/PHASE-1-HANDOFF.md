# Autonomous Phase 1 handoff

## Assignment

Own the complete Phase 1 implementation, verification, operational documentation, and deployment preparation. Prefer a fully deployed and accepted product when the external gates below are satisfied; otherwise deliver a tested deployment candidate with precise remaining gates. Do not ask the owner to supervise or authorize every implementation slice.

This document prepares the next implementing session; its preparation did not start feature implementation or provision resources. Start the assignment by giving the next agent the prompt below.

Read [START-HERE.md](../START-HERE.md), [AGENTS.md](../AGENTS.md), the product/design guidance, and the linked planning documents. Accepted product policy remains authoritative. This handoff supersedes earlier instructions to obtain a separate assignment for every local slice. It does not waive security, cost, provider-write, or unrelated-resource boundaries.

## Authority and limits

| Area                 | Authority                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local implementation | Complete Phase 1 in vertical TDD slices; choose routine technical details, remove Notes separately, preserve sound platform foundations, and maintain focused jj changes.                                                                                                                                                             |
| GCP                  | The owner explicitly permits using their authenticated GCP CLI to set up everything needed for this application. Inspect access and prepare the fresh project/resources and Alchemy plan. Confirm billing account and spending authorization before attaching billing or creating billable resources.                                 |
| Existing resources   | Do not adopt, alter, delete, or migrate AutoCoach/starter resources, credentials, databases, infrastructure state, or sessions. An active CLI project is not a destination approval. Use explicit project selection on cloud commands.                                                                                                |
| Cloud rollout        | Once destination, billing/budget, origin/email access, protected state, and security gates are satisfied, carry out the bounded Phase 1 rollout under this assignment. Review and record the actual plan yourself; additional owner approval is needed for a material scope/cost change or an unresolved gate, not each routine step. |
| Yahoo                | The owner can log in through a local Playwright CLI browser session. Arrange that interaction when the helper is ready. Browser login is not permission for arbitrary research or lineup writes; obtain designated-team read acceptance and minimal native-write authority. Never execute transactions or premium actions.            |
| Security             | Local work may proceed on the pinned baseline, loopback-only without public tunnels. Publication requires a coherent fixed dependency closure and installed-source/transport/SSR/single-flight acceptance. Ask before departing from the Solid rc.13 hold; do not silently patch around or waive the blocker.                         |
| Purchases            | No domain purchase, paid plan upgrade, trademark filing, or unrelated resource work is authorized.                                                                                                                                                                                                                                    |

The cloud budget and billing account are not yet specified. Budget alerts are not hard spending caps. Keep resource/instance/concurrency limits, log/image retention, abuse controls, and an estimated recurring-cost worksheet; do not promise zero cost from free allowances.

## Credentials and access

No Yahoo cookies, crumb, passwords, or reusable sessions are retained in this handoff. Do not search for or copy AutoCoach credential stores. Do not ask the owner to paste secrets into chat or Inbox.

A metadata-only preflight during handoff preparation found an active gcloud account and active project `auto-gm-372620`. This is evidence of CLI configuration only, not token validity, IAM, billing access, or permission to use that project. Do not deploy Lineupkeep there by default. No token, credential file, or local/cloud secret store was inspected.

Alchemy needs actual credentials in the executing process, but the owner need not manually copy them into the conversation. The inspected pinned GCP provider supports `GOOGLE_ACCESS_TOKEN` with `GOOGLE_PROJECT_ID` (alias `GOOGLE_CLOUD_PROJECT`), or a supported service-account key via `GOOGLE_APPLICATION_CREDENTIALS`; a gcloud login alone is not automatic Alchemy authentication. Obtain a short-lived token from the authorized CLI into a protected child-process environment without printing it, shell tracing, command-line secret arguments, captured logs, or persistent plaintext files. Refresh safely between operations and account for expiry during long deployments. Reinspect the installed provider if dependencies change. Do not create a long-lived service-account key merely for convenience. Align gcloud, registry authentication, and Alchemy to the same explicitly selected project/identity; avoid changing the owner's global CLI defaults.

The existing deployment scaffold requires these additional inputs. Generated secrets can be created by the agent; account access cannot be invented.

| Input                                        | How to obtain it                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GCP project, billing account, region, budget | Inventory only necessary non-secret metadata through the authorized CLI. Recommend an independent project and region; ask the owner only for missing authority, account selection, and spending limits.                                                                                                                                                                                  |
| Neon provisioning                            | Obtain authorized access or a protected `NEON_API_KEY`; create fresh application storage. GCP login does not authenticate Neon.                                                                                                                                                                                                                                                          |
| Alchemy remote state                         | Follow [the owner runbook](deployment.md#bootstrap-protected-state--owner-only). Provision only with explicit bootstrap authority, or ask the owner to perform bootstrap. Obtain the protected `ALCHEMY_STATE_DATABASE_URL`, separate from application data, with verified permissions, TLS, lock/restore behavior, and lifecycle. Never fall back to local state for remote operations. |
| Email                                        | The current scaffold uses Resend. Obtain a sending-scoped `RESEND_API_KEY`, verified domain access, and `EMAIL_FROM`, or return a justified provider change for decision. GCP access does not supply these. No external email sends in ordinary tests.                                                                                                                                   |
| Application secrets                          | Generate a strong stable `BETTER_AUTH_SECRET` and the connection-encryption material required by the implemented design; store through the reviewed secret mechanism, never source/docs/artifacts. Test rotation/recovery and do not regenerate on each deploy.                                                                                                                          |
| Public origin                                | Prefer the assigned Cloud Run URL if the owner accepts it; otherwise obtain access to an already-owned domain. Configure `BETTER_AUTH_URL`, callbacks, trusted ingress and abuse controls against the real topology. Do not buy a domain.                                                                                                                                                |
| Yahoo acceptance                             | Owner login/MFA in a dedicated local browser workspace, then secure transfer through the new helper. Do not request credentials in MCP, commands, logs, or the frontend.                                                                                                                                                                                                                 |
| Hosted Muse                                  | Owner account/client action may be necessary for actual OAuth, paging, and pending-result acceptance. Local protocol tests are not proof of hosted-client compatibility.                                                                                                                                                                                                                 |

Google OAuth login is optional and not required for passwordless email-code registration. A Google OAuth application/client secret is unrelated to gcloud deployment access; do not create one unnecessarily.

## Execution sequence

1. Inspect jj status and current authoritative documents. Preserve unrelated work. Confirm the pinned Node/Bun toolchain and baseline checks; do not recopy the starter or reinitialize history.
2. Prove local-helper pairing feasibility. Build encrypted, owned, multi-account connections and exact NFL/NHL team discovery with behavioral provider fakes and disposable migrated PostgreSQL.
3. Complete rich bounded provider-neutral query MCP and transaction-review links. Validate exact resource/period semantics, missing versus zero, ownership, scopes, whole-record paging, and byte limits.
4. Implement durable native `set_lineup`, bounded waiting/status references, outbox/queue recovery, per-team coordination, write intent/readback, and uncertain-outcome reconciliation. Never blindly replay or undo a provider write.
5. Finish operational UI in the approved royal violet/gold design, hourly current-period automation, enable/disable/provider-day pause, reconnect incidents/email, and enforced 30-day outcomes/seven-day normalized-diagnostic retention.
6. Resolve the coherent security upgrade and cloud/access gates. Implement two min-zero request-billed Cloud Run services, IAM-private worker, bounded Tasks/Scheduler, fresh Neon storage and protected state with least privilege. Do not inherit min-one/instance-billing defaults.
7. Perform scoped live acceptance when authorized, deploy if all gates pass, verify production and hosted Muse, and hand over operations/recovery/cost evidence. If an external gate remains, finish all independent work and deliver the tested candidate instead of claiming launch success.

Resolve feasibility at its owning seam, not as a reason to stop all implementation. Phase 2 scoring/solver, legal reserve optimization, explicit-assignment writes, and direct optimizer cutover are excluded. Do not let their evidence requirements block the Phase 1 native action.

## Verification and completion

Follow repository testing and verification skills. Write/run failing public-behavior tests before implementations. Use real disposable PostgreSQL for persistence/concurrency and behavioral provider fakes for deterministic failures. Cover ownership, replay, expiry, locks, pause/disconnect races, worker crashes, duplicate delivery, uncertain writes, incident deduplication, retention and billing/abuse boundaries.

Run `bun checks` after committed-code changes, then all affected browser/MCP/service/container/target checks serially. Do not edit/build while verification owns the checkout; recover through the supported harness. Retain sanitized assertion-linked evidence and distinguish unit/fake, local actual-protocol, live provider, hosted-client, and deployed-cloud acceptance. Never commit secrets or raw private provider dumps.

Completion means either:

- **Deployed and accepted:** all Phase 1 behavior works, publication gates passed, permitted live checks verified, and production monitoring/recovery/rollback/retention/cost instructions are delivered; or
- **Deployment candidate:** implementation and available checks are complete, with exact external gates, unproven claims, secure provisioning actions, and reproducible deployment steps. Do not equate this with a fully accepted launch.

Leave focused described jj changes and a fresh empty working copy. Deliver a concise summary, test/evidence locations, public URLs if deployed, resource inventory without secret values, known limitations, and operator instructions. Use Plannotator Inbox for substantive handover and necessary owner questions/actions, not routine progress. Continue independent work after asking; do not poll or wait for replies.

## Prompt for the next agent

```text
Work in /Users/graemefolk/Documents/Software/lineupkeep.

Take ownership of the entire Phase 1 implementation, testing, operational handoff,
and conditional deployment. Read START-HERE.md and docs/PHASE-1-HANDOFF.md first,
then follow AGENTS.md and the authoritative product/design/planning documents.
The handoff is your execution mandate and permission ledger, not a request to
produce another plan. Implement in focused TDD/jj slices without seeking owner
approval for each slice or routine technical decision.

Use the owner's GCP CLI as authorized to prepare/setup fresh Lineupkeep
infrastructure. Confirm billing account and budget before billable provisioning;
never treat the active legacy project as the approved destination. Obtain missing
Neon/email/state access securely, generate application secrets yourself, and
arrange the owner's local Yahoo login/MFA when needed. Never paste or print secrets.

Keep the vulnerable transport loopback-only until the coherent security fix and
required regressions pass. Respect the unresolved framework-pin decision and
scoped live-provider authorization. No AutoCoach migration, transactions, premium
actions, purchases, or Phase 2 optimizer. Preserve the approved violet/gold brand.

Return a fully deployed, verified Phase 1 product if all gates can be satisfied;
otherwise finish the tested deployment candidate and identify exact external
gates. Do not stop merely at the first missing external input: ask through Inbox
and continue independent work. Do not poll for replies. Distinguish implemented,
locally tested, live-accepted, and deployed claims. Finish with documented
operations/evidence and a fresh empty jj working copy.
```
