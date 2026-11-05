# v1 release readiness

Status checked **2026-10-22** against official upstream issues, releases and published package source; the temporary backport record below was added **2026-10-25**. These are dated observations, not permanent upstream statuses or release authorization.

## Local-development decision

The Lineupgrade owner has chosen to continue local implementation on the pinned baseline while awaiting a coherent upstream security fix. This supersedes treating that fix as an entry condition for all local feature work; it does **not** waive the publication blocker below or establish security acceptance. A temporary response-validation backport is checked in below, so the vulnerable transport itself no longer blocks publication; adopting a published fix with the same acceptance still does.

Keep the application loopback-only, with no public tunnel or public deployment of the vulnerable transport. Automated provider tests use synthetic data and behavioral fakes; real provider access remains separately authorized. Track adoption of the coherent fix before publication, including installed-source inspection and real-transport security/SSR/single-flight acceptance. No new upstream-status check or dependency audit is claimed by this decision; a separate audit was run on 2026-10-29 and is recorded in [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md).

## Publication blocker: Solid Start RPC security

**Do not publish v1 with the current vulnerable transport.** [GHSA-qx66-fv34-fjm8 / CVE-2026-102989](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8) is critical. [Router #8573](https://github.com/TanStack/router/pull/8573) is merged; the first fixed `start-server-core` is **1.169.39**.

- Current Start/Router **2.0.0-rc.8** resolves to `start-server-core` **1.169.26**, `start-client-core` **1.170.22** and `router-core` **1.171.22**. Prior review established static reachability through Solid RPC; a built-app reproduction on 2026-10-24 executed the attack shape locally (see below).
- [Start rc.9](https://github.com/TanStack/router/releases/tag/%40tanstack/solid-start%402.0.0-rc.9) was published October 22, but retains the same vulnerable core closure and requires **Solid rc.16+**. Inspected published transport bytes confirm it is not a fixed, rc.13-compatible parent release.
- **Owner decision (2026-10-22):** pause framework changes and wait for a published, coherent fixed Solid 2 release. No forced server-only override or Solid 1 downgrade is authorized. The aligned Solid rc.13 hold remains in place. Superseded in part on 2026-10-25 by the authorized temporary response-validation backport below; the hold still forbids framework version changes, and no upgrade path from the rejected pin or shim is revived.
- **Temporary patched-core pin attempted 2026-10-24 and rejected as incoherent.** The patched set (`start-server-core` 1.169.39, `start-client-core` 1.170.34, `start-storage-context` 1.167.36, and their required `router-core` 1.171.34) cannot coexist with rc.8's `solid-router`. A global `router-core` 1.171.34 override fails the build because rc.8 imports `makeSsrSerovalPlugin`, `isPlainArray`, `isPlainObject`, `createRawStreamDeserializePlugin` and `defaultSerovalPlugins` from the router-core main entry, removed upstream in 1.171.30/1.171.31. Keeping `router-core` 1.171.22 fails the other way: the patched cores import `isPromise`, `createRawStreamRPCPlugin`, `defaultSerovalDeserializerPlugins`, `createDefaultSerovalPlugins` and `makeSerovalPlugin`, added in 1.171.31, and the Vite/Nitro bundler resolves the hoisted 1.171.22 copy rather than Bun's nested 1.171.34 copies. No published `router-core` version exports both surfaces. The pin was reverted; `package.json` and `bun.lock` carry no pin override. A temporary compatibility shim (router-core entry re-exports plus a re-added `isPlainArray`) was attempted on 2026-10-24 and rejected as well: `router-core` 1.171.31 deleted `isDehydrated`, `takeBufferedHtml` and `takeBufferedScripts` from `serverSsr`, so rc.8 SSR failed at runtime and reconstructing them would re-implement router-core's buffering pipeline. Both paths remain rejected; the temporary response-validation backport below is the applied measure.

Unblock only when an intended-line parent contains the complete upstream fix across the core packages and response boundaries, supports rc.13 **or the owner revisits that pin**, and passes acceptance. Inspect installed source after a clean install; include real-transport security regression proof and preserve SSR and single-flight behavior through the [README check matrix](../README.md#commands-and-required-checks). Green E2Es alone do not clear the advisory. A built-app regression against the current built app reproduced the advisory (crafted server-function request returned attacker `text/html`); its local evidence is in `.artifacts/verify/b5253754-6c4c-4964-bafc-6c746093e2cc/`. The regression itself is committed as `e2e/serverFunctionTransport.e2e.ts`.

Follow the advisory, #8573 and the [Solid 2 release feed](https://github.com/TanStack/router/releases). No exact intended-line security backport tracker was found; unrelated SSR PRs are not substitutes.

### Temporary response-validation backport (applied 2026-10-25)

The owner authorized a temporary, revertible security change so that the known vulnerable transport does not by itself block publication while a coherent fixed parent is pending. The behavior of merged [Router #8573](https://github.com/TanStack/router/pull/8573) is applied to the installed packages through Bun `patchedDependencies`.

**No dependency version, lockfile resolution, or member of the Solid/TanStack family changed.** `start-server-core` is still **1.169.26**, `start-client-core` is still **1.170.22**, `router-core` is still **1.171.22**, and `@tanstack/solid-start` is still **2.0.0-rc.8**. `bun.lock` gained only the three `patchedDependencies` entries.

| package                       | version    | patch file                                             | patched shipped files                                                                                                               |
| ----------------------------- | ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@tanstack/router-core`       | `1.171.22` | `patches/@tanstack%2Frouter-core@1.171.22.patch`       | `dist/esm/ssr/handlerCallback.js`, `dist/cjs/ssr/handlerCallback.cjs`                                                               |
| `@tanstack/start-client-core` | `1.170.22` | `patches/@tanstack%2Fstart-client-core@1.170.22.patch` | `dist/esm/createServerFn.js`                                                                                                        |
| `@tanstack/start-server-core` | `1.169.26` | `patches/@tanstack%2Fstart-server-core@1.169.26.patch` | `dist/esm/request-response.js`, `dist/esm/serializer/ServerFunctionSerializationAdapter.js`, `dist/esm/server-functions-handler.js` |

Only the published ESM entries are patched for the two `start-*-core` packages because those packages ship no CJS build; `router-core` ships both, so both are patched. A clean `bun install --frozen-lockfile` reproduces all six patched files.

**Adaptations to the older built code** (every other line is the upstream fix verbatim):

1. `server-functions-handler`: 1.169.26 assigns inner payload results with `return await action(...)` inside its nested async IIFE, where the post-fix base uses `res = await action(...)`. The port keeps `return await` and otherwise applies the fix's `{ data, context, method }` argument shape unchanged.
2. `server-functions-handler`: 1.169.26 reads the JSON body into a `jsonPayload` local before parsing, where the post-fix base inlines the `request.json()` call. The port keeps that older structure and changes only the `{}` default to `void 0` and the action argument.

`router-core`'s 1.171.22 `isSsrResponse`/`normalizeSsrResponse` and `start-server-core`'s 1.169.26 `requestHandler` are structurally identical to the post-fix base, so those hunks port without adaptation. The `not-found` header rewrite keeps `Content-Type: application/json` authoritative by setting it after construction, so a caller-supplied `headers` object can no longer replace it.

**Evidence (2026-10-25, Node 24.22.1, Bun 1.4.2, Playwright Chromium, disposable PostgreSQL):**

- Red before the patch: `.artifacts/verify/1d1faf29-65aa-469e-af3d-f27949ba8b05/` — the crafted request returned `200 text/html` with the attacker's marker.
- Green and acceptance: `.artifacts/verify/3eee71f1-a38e-4c29-93f2-a879c5c1f317/` — criteria C1 (forgery refused), C2 (SSR, hydration), C3 (single-flight writes, redirects) passed and the delivery gate passed; the forged request now returns `200 application/json` with an empty envelope.
- Check matrix: `.artifacts/verify/6391027c-224a-49d1-b70e-ad8125f3c7fa/` — `bun checks` (769 tests, 65 files, both builds) and 34 passing E2E tests on the node, cloudflare and container targets.

**Residual risk:** this is a maintained local patch against three pinned packages, not an upstream release. It must be re-applied and re-verified against any future install, it carries no upstream support, and a later unrelated change to those dist files would need the patch regenerating. It closes the reported response-forgery vector for the pinned closure; it does not prove every server-function input shape.

**Removal condition:** adopt a published Solid 2 parent whose closure contains the complete #8573 fix across `router-core` and the `start-*-core` response boundaries, with the same acceptance (installed-source inspection after a clean install, the built-app `e2e/serverFunctionTransport.e2e.ts` regression, `bun checks`, all three E2E targets, and SSR/hydration/single-flight/redirect/write behavior). Remove it by deleting the three patch files, deleting the three `patchedDependencies` entries from `package.json` **and** `bun.lock`, reinstalling, and re-running that acceptance; leaving a stale entry or file fails the install.

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

## Accepted v1 version hold and retained limitations

**Owner decision: keep the aligned Solid 2.0.0-rc.13 family for v1 and document limitations.** No framework version change or further adoption trial is authorized by this tracker; the temporary response-validation backport above is a security change, not a framework adoption. This is not blanket security-risk acceptance and does not waive the remaining acceptance items below.

### Query failure/recovery: published upstream fix, local adoption still unverified

[Solid #4189](https://github.com/solidjs/solid/issues/4189) is **closed**: Query **6.0.0-rc.5** with Signals **rc.16** can miss `<Errored>` under `<Loading>`. [Fix #4195](https://github.com/solidjs/solid/pull/4195) is merged and **published in [Signals rc.17](https://github.com/solidjs/solid/releases/tag/%40solidjs/signals%402.0.0-rc.17)**, not awaiting merge.

Our prefetched-failure/refetch/reset reproduction differs from the upstream case: it passes rc.13 and fails initial error UI on rc.16; it has **not been verified on rc.17**. Follow the published fix without filing a duplicate. Revisit adoption only with approval and proof of visible initial failure plus refetch/reset recovery.

### Dialog close/read order: unresolved local adoption test

The rc.16 trial differed between ordinary-first `open() && !closing()` and optimistic-first reads while confirmation remained pending; rc.13 passed. No exact upstream issue or published fix was found, and no issue was posted. Related optimistic/Show fixes do not prove this behavior fixed. Any approved adoption must prove the dialog closes before settlement, without asserting an unverified engine cause.

### Server Errored escaping: retained risk on rc.13

[Solid #4116](https://github.com/solidjs/solid/issues/4116) is **closed**; [fix #4119](https://github.com/solidjs/solid/pull/4119) is merged and shipped in [rc.16](https://github.com/solidjs/solid/releases/tag/solid-js%402.0.0-rc.16). A local probe confirmed rc.13 can render raw string children of server `<Errored>` as unescaped HTML.

**Never pass raw untrusted text as Errored children.** Inspected application boundaries use JSX rather than raw untrusted child strings; that is not an exploitability guarantee. Holding rc.13 retains this escaping defect, is not security-neutral, and authorizes no additional backport. No dedicated public advisory/CVE for this defect was found; do not assign it an unrelated one. An approved future adoption must verify escaping as well as recovery and dialog behavior.

## Optional feature and adoption gates

These are **not whole-v1 blockers while the features remain excluded or current integrations retained**. Keep awaiting primary loader data under the [loading policy](loading-and-single-flight.md).

### Independently delayed SSR sections: feature gate

- [Router #8026](https://github.com/TanStack/router/pull/8026) is **open, non-draft, targeting `main`**: post-`</body>` output is quarantined until completion, preventing progressive paint and failing beyond a **65,536-character tail cap**.
- [Router #8214](https://github.com/TanStack/router/pull/8214) is **open draft, targeting `solid-router-v2-pre`**: an alternative Solid-owned transport bypasses that transform.
- Neither fix ships in the inspected rc.8/rc.9 closure. Require **either** a published, locally verified fix **or an equivalent**, not both PRs.

Before enabling the feature, prove with a real browser that a fast boundary paints before an independently gated slow boundary resolves and before stream completion; **>64 KiB late HTML** completes without response failure; hydration is clean. Preserve initial SSR, authentication, redirects, navigation and one-request writes. A merged PR or preview package alone is insufficient.

### Native Query SSR / single-flight: optional migration

Router [#8192](https://github.com/TanStack/router/pull/8192), [#8193](https://github.com/TanStack/router/pull/8193), [#8213](https://github.com/TanStack/router/pull/8213) and Query [#11326](https://github.com/TanStack/query/pull/11326) are **merged and present in the pinned releases**, not unresolved upstream blockers. Their primitives do not automatically compose a replacement for Start's current integration.

Retain `setupRouterSsrQueryIntegration` until an approved replacement proves useful initial HTML before scripts and refreshed data in **one actual browser write request**, including non-awaited query work, redirects/authentication, error recovery, disposal and per-request cache isolation. No migration is implied by publication alone.

### Patch-removal watches

- **Start action URLs:** [Router #8467](https://github.com/TanStack/router/pull/8467) is merged and shipped in rc.9. Retain the rc.8 patch under the rc.13 hold; removal requires an approved compatible release and action-URL/SSR/single-flight regressions, not just merge status.
- **Better Auth 1.7.12:** retain the cause-chain patch for concurrent CIMD registration. No exact upstream tracker was found; the related resource-seeding fix is not this registration race. Remove only after the unpatched registration regression passes.

Related open Query [#12031](https://github.com/TanStack/query/issues/12031)/[#12034](https://github.com/TanStack/query/pull/12034) (NotReadyError/disposal) and [#11903](https://github.com/TanStack/query/issues/11903)/[#12126](https://github.com/TanStack/query/pull/12126) (cached-key tearing) are watches, not exact #4189 matches or proven current application blockers.

## Remaining release acceptance

- [x] Refresh the full dependency audit and record disposition of residual infrastructure/tooling advisories. [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md) records the 2026-10-29 scan: **55 advisory/version records, not 55 distinct CVEs**, over 8 packages, each classified shipped or tooling with reachability evidence and a fixed version. `zod` 4.4.3 was upgraded to 4.6.7 and `seroval` 1.6.7 to 1.6.12 inside the shipped bundle; the remaining **49 records over 6 packages** are 48 tooling-only dispositions and the one production-critical record above. This is a triage record, not a security-clean result, and a fresh scan is still required before publication.
- [ ] Confirm hosted clean Linux CI; this remains unverified. Use the [README check matrix](../README.md#commands-and-required-checks), without treating historical local greens as fresh release acceptance.
- [ ] Obtain owner authorization and complete real deployment-target acceptance under the [deployment runbook](deployment.md). Local workerd/container results are not cloud proof and authorize no deployment or publication.
