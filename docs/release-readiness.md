# v1 release readiness

Status checked **2026-11-22** against official upstream issues, releases and published package source. The framework was migrated to Solid 2.0.3 on 2026-11-19 and to the TanStack 2.0.0-rc.11 line on 2026-11-22. These are dated observations, not permanent upstream statuses or release authorization.

## Local-development decision

The Lineupgrade owner chose to continue local implementation while awaiting a coherent upstream security fix. That fix is now adopted. This supersedes treating the fix as an entry condition for all local feature work; it does **not** waive the remaining publication acceptance below or establish security acceptance.

Keep the application loopback-only, with no public tunnel or public deployment of an unaccepted transport. Automated provider tests use synthetic data and behavioral fakes; real provider access remains separately authorized. Track the remaining acceptance before publication, including the built-app transport regression, container E2E, clean Linux CI and deployment-target acceptance. No new upstream-status check or dependency audit is claimed by this decision; a separate audit was run on 2026-10-29 and is recorded in [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md).

## Publication blocker: Solid Start RPC security (fixed upstream)

[GHSA-qx66-fv34-fjm8 / CVE-2026-102989](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8) is critical. [Router #8573](https://github.com/TanStack/router/pull/8573) is merged; the first fixed `start-server-core` is **1.169.39**.

- The installed line is `@tanstack/solid-start` **2.0.0-rc.11**, which resolves `start-server-core` **1.169.45**, `start-client-core` **1.170.39**, `router-core` **1.171.39** and `start-storage-context` **1.167.41**. The three response-validation patches are removed; installed-source inspection shows the upstream response handling in `router-core`, `start-client-core` and `start-server-core`.
- rc.11 has a packaging defect: it imports `@tanstack/start-server-core/request-scope`, but 1.169.45 does not export that subpath ([TanStack/router #8964](https://github.com/TanStack/router/issues/8964)). The single remaining TanStack patch adds that export. It changes no transport behavior. Remove it when a release exports the subpath.
- **Owner decision (2026-11-19, reaffirmed 2026-11-22):** adopt the stable Solid 2 line and the latest usable TanStack 2 RCs. rc.10 was the previous usable line; its vulnerable core closure and temporary backport are retired.
- **Acceptance so far:** a clean install reproduces the patched export; `bun checks` passes (2,103 node, 299 browser, 10 chromium; both builds); the container E2E passes 62 tests, including the built-app `e2e/serverFunctionTransport.e2e.ts` regression. Clean Linux CI and deployment-target acceptance remain.
- **Historical record:** the 2026-10-24 attempts to pair a patched core with rc.8 failed because no published `router-core` exported both the old and new surfaces. Those attempts are superseded by rc.11 and are not a current workaround.

## Hosted-browser egress widening (2026-10-28)

The hosted browser no longer uses a static provider-origin allowlist. The
allowlist could not complete a Yahoo sign-in through a Google identity and made
every provider login change a silent breakage risk. The owner directed its
removal.

**Replacement.** Each browser session starts a local HTTP forward proxy. Chromium
uses it for HTTP, HTTPS, WebSocket, and secure WebSocket traffic, with its own
resolver blackholed, the implicit loopback proxy bypass disabled, and QUIC,
non-proxied WebRTC UDP, and DNS prefetching off. The proxy resolves every
destination, refuses it when any answer is a metadata, loopback, private,
link-local, CGNAT, multicast, reserved, or other non-public address, and dials
the verified address directly. Resolution, validation, and connection are one
decision, so a public name that later resolves privately is refused on the next
request and a name with mixed public and private answers is refused outright.
Refusals name the host, reach the client as a control message, and are recorded
in the browser session outcome. The local development fixture origin is the only
loopback allowance and is not available in the deployed browser service.

**Retained protections.** One-use owner-bound ticket, HMAC-signed short-lived
descriptor, one active hosted session per owner, five starts per owner per ten
minutes, one browser per instance, ephemeral profile destroyed on capture,
cancel, expiry, fault, or shutdown, dialog dismissal, download cancellation,
bounded frames and input, and provider-scoped `T`/`Y` capture followed by
provider validation. Popups are now streamed as active targets and close with
the session.

**What this costs.** The browser can reach any public internet destination,
including any public service that a page or popup can address. The service can
therefore be used as a short-lived public browser within the per-owner limits.
The egress check is application code inside the same process as Chromium, not a
network boundary: a Chromium compromise or a proxy defect could bypass it, and
no VPC connector, Cloud NAT, or managed egress proxy is deployed because of the
CAD 5/month budget. The policy does not prove that an unusual public route cannot
reach an internal service; it covers the documented metadata, loopback, private,
link-local, and CGNAT ranges. These are accepted residual risks, not a claim of
network isolation. The full decision and revisit conditions are in
[ADR 0010](fantasy-manager/adr/0010-address-based-egress.md).

**Acceptance.** Address-class refusal, public-address permission, public-name
private-answer refusal, re-resolution, loud refusal transport and outcome
recording, popup streaming, popup return, capture, and profile cleanup are
covered by local Node and Chromium tests. The deployed browser revision
`lineupkeep-hb-00010-6db` completed a descriptor handshake, loaded the real Yahoo
login page, streamed frames with no refusals, and refused the GCP metadata
endpoint with a recorded `non_public_address` refusal. On 2026-10-28 the owner
attempted a real Google-identity Yahoo sign-in through the deployed browser.
Google loaded its identity page and then refused the sign-in with "This browser
or app may not be secure", its supported-browser gate against software-controlled
and embedded browsers. The hosted Google-identity path is therefore **not
accepted**. No local capture path remains, so a Google-identity account cannot
finish linking; no evasion of Google's browser check is claimed or accepted.

## Framework version decision and retained limitations

**Owner decision (2026-11-19, reaffirmed 2026-11-22): adopt Solid 2.0.3 and the latest usable TanStack 2 RCs.** The earlier rc.13 hold is superseded. The temporary response-validation backport is retired; the remaining acceptance items below still apply.

### Query failure/recovery and dialog behavior

The stable Solid 2.0.3 and TanStack Query 6.0.0-rc.6 line is installed. The prefetched-failure/refetch/reset and confirmation-dialog browser suites pass; the dialog now closes before its write settles by deferring the write one microtask.

### Server Errored escaping

Solid 2.0.3 includes the escaping fix for raw string children of server `<Errored>` ([Solid #4119](https://github.com/solidjs/solid/pull/4119)). The application still passes JSX rather than raw untrusted text at these boundaries.

## Optional feature and adoption gates

These are **not whole-v1 blockers while the features remain excluded or current integrations retained**. Keep awaiting primary loader data under the [loading policy](loading-and-single-flight.md).

### Native Query SSR / single-flight: optional migration

Router [#8192](https://github.com/TanStack/router/pull/8192), [#8193](https://github.com/TanStack/router/pull/8193), [#8213](https://github.com/TanStack/router/pull/8213) and Query [#11326](https://github.com/TanStack/query/pull/11326) are **merged and present in the pinned releases**, not unresolved upstream blockers. Their primitives do not automatically compose a replacement for Start's current integration.

Retain `setupRouterSsrQueryIntegration` until an approved replacement proves useful initial HTML before scripts and refreshed data in **one actual browser write request**, including non-awaited query work, redirects/authentication, error recovery, disposal and per-request cache isolation. No migration is implied by publication alone.

### Patch-removal watches

- **Start action URLs:** [Router #8467](https://github.com/TanStack/router/pull/8467) is shipped since rc.10. The solid-start patch is removed; server-function and SSR regressions pass.
- **Start request-scope export:** the rc.11 patch adds the missing `./request-scope` export for [TanStack/router #8964](https://github.com/TanStack/router/issues/8964). Remove it when a published `start-server-core` exports the subpath and the build passes without the patch.
- **Better Auth 1.7.27:** the oauth-provider cause-chain patch is no longer needed; upstream follows the cause chain. The CIMD patch remains so a policy-refused redirect is named separately from a network failure. Remove it when upstream makes that distinction.

Related open Query [#12031](https://github.com/TanStack/query/issues/12031)/[#12034](https://github.com/TanStack/query/pull/12034) (NotReadyError/disposal) and [#11903](https://github.com/TanStack/query/issues/11903)/[#12126](https://github.com/TanStack/query/pull/12126) (cached-key tearing) are watches, not exact #4189 matches or proven current application blockers.

## Remaining release acceptance

- [x] Refresh the full dependency audit and record disposition of residual infrastructure/tooling advisories. [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md) records the 2026-10-29 scan: **55 advisory/version records, not 55 distinct CVEs**, over 8 packages, each classified shipped or tooling with reachability evidence and a fixed version. `zod` 4.4.3 was upgraded to 4.6.7 and `seroval` 1.6.7 to 1.6.12 inside the shipped bundle; the remaining **49 records over 6 packages** are 48 tooling-only dispositions and the one production-critical record, now fixed by the rc.11 upgrade. This is a triage record, not a security-clean result, and a fresh scan is still required before publication.
- [ ] Confirm hosted clean Linux CI; this remains unverified. Use the [README check matrix](../README.md#commands-and-required-checks), without treating historical local greens as fresh release acceptance.
- [ ] Obtain owner authorization and complete real deployment-target acceptance under the [deployment runbook](deployment.md). Local workerd/container results are not cloud proof and authorize no deployment or publication.
