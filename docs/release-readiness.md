# v1 release readiness

Status checked **2026-10-22** against official upstream issues, releases and published package source. These are dated observations, not permanent upstream statuses or release authorization.

## Local-development decision

The Lineupkeep owner has chosen to continue local implementation on the pinned baseline while awaiting a coherent upstream security fix. This supersedes treating that fix as an entry condition for all local feature work; it does **not** waive the publication blocker below or establish security acceptance.

Keep the application loopback-only, with no public tunnel or public deployment of the vulnerable transport. Automated provider tests use synthetic data and behavioral fakes; real provider access remains separately authorized. Track adoption of the coherent fix before publication, including installed-source inspection and real-transport security/SSR/single-flight acceptance. No new upstream-status check or dependency audit is claimed by this decision.

## Publication blocker: Solid Start RPC security

**Do not publish v1 with the current vulnerable transport.** [GHSA-qx66-fv34-fjm8 / CVE-2026-102989](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8) is critical. [Router #8573](https://github.com/TanStack/router/pull/8573) is merged; the first fixed `start-server-core` is **1.169.39**.

- Current Start/Router **2.0.0-rc.8** resolves to `start-server-core` **1.169.26**, `start-client-core` **1.170.22** and `router-core` **1.171.22**. Prior review established static reachability through Solid RPC; a built-app reproduction on 2026-10-24 executed the attack shape locally (see below).
- [Start rc.9](https://github.com/TanStack/router/releases/tag/%40tanstack/solid-start%402.0.0-rc.9) was published October 22, but retains the same vulnerable core closure and requires **Solid rc.16+**. Inspected published transport bytes confirm it is not a fixed, rc.13-compatible parent release.
- **Owner decision:** pause framework changes and wait for a published, coherent fixed Solid 2 release. No local backport, forced server-only override or Solid 1 downgrade is authorized. The aligned Solid rc.13 hold remains in place.
- **Temporary patched-core pin attempted 2026-10-24 and rejected as incoherent.** The patched set (`start-server-core` 1.169.39, `start-client-core` 1.170.34, `start-storage-context` 1.167.36, and their required `router-core` 1.171.34) cannot coexist with rc.8's `solid-router`. A global `router-core` 1.171.34 override fails the build because rc.8 imports `makeSsrSerovalPlugin`, `isPlainArray`, `isPlainObject`, `createRawStreamDeserializePlugin` and `defaultSerovalPlugins` from the router-core main entry, removed upstream in 1.171.30/1.171.31. Keeping `router-core` 1.171.22 fails the other way: the patched cores import `isPromise`, `createRawStreamRPCPlugin`, `defaultSerovalDeserializerPlugins`, `createDefaultSerovalPlugins` and `makeSerovalPlugin`, added in 1.171.31, and the Vite/Nitro bundler resolves the hoisted 1.171.22 copy rather than Bun's nested 1.171.34 copies. No published `router-core` version exports both surfaces. The pin was reverted; `package.json` and `bun.lock` are unchanged. A temporary compatibility shim (router-core entry re-exports plus a re-added `isPlainArray`) or a fixed parent remains an owner decision.

Unblock only when an intended-line parent contains the complete upstream fix across the core packages and response boundaries, supports rc.13 **or the owner revisits that pin**, and passes acceptance. Inspect installed source after a clean install; include real-transport security regression proof and preserve SSR and single-flight behavior through the [README check matrix](../README.md#commands-and-required-checks). Green E2Es alone do not clear the advisory. A scratch regression against the current built app reproduced the advisory (crafted server-function request returned attacker `text/html`); its local, uncommitted evidence is in `.artifacts/verify/b5253754-6c4c-4964-bafc-6c746093e2cc/`.

Follow the advisory, #8573 and the [Solid 2 release feed](https://github.com/TanStack/router/releases). No exact intended-line security backport tracker was found; unrelated SSR PRs are not substitutes.

## Accepted v1 version hold and retained limitations

**Owner decision: keep the aligned Solid 2.0.0-rc.13 family for v1 and document limitations.** No framework patch or further adoption trial is authorized by this tracker. This is not blanket security-risk acceptance and does not waive the publication blocker above.

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

- [ ] Refresh the full dependency audit and record disposition of residual infrastructure/tooling advisories. The prior scan counted **47 advisory/version records, not 47 distinct CVEs**: one production-critical record above and 46 infrastructure/tooling records for separate triage. No fresh scan is claimed here, nor a security-clean result.
- [ ] Confirm hosted clean Linux CI; this remains unverified. Use the [README check matrix](../README.md#commands-and-required-checks), without treating historical local greens as fresh release acceptance.
- [ ] Obtain owner authorization and complete real deployment-target acceptance under the [deployment runbook](deployment.md). Local workerd/container results are not cloud proof and authorize no deployment or publication.
