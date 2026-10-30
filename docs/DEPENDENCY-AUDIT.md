# Dependency audit and disposition

Fresh scan and disposition of every advisory record `bun audit` reports for this repository. This
replaces the earlier, untriaged count of 47 records recorded in
[release-readiness.md](release-readiness.md). It is a dated observation, not a security-clean result and
not publication authorization.

## Scan

| Item              | Value                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Command           | `bun audit` (machine-readable form: `bun audit --json`)                                                                       |
| Date              | 2026-10-29 local, `2026-10-30T00:18Z`                                                                                         |
| Tool              | Bun 1.4.2 (`744846f84`), Node 24.22.1, macOS arm64                                                                            |
| Cross-check       | [OSV](https://api.osv.dev/v1/querybatch) queried per package and version, then each advisory fetched for its patched versions |
| Before the change | 8 packages, 55 advisory records — 1 critical, 11 high, 40 moderate, 3 low                                                     |
| After the change  | 6 packages, 49 advisory records — 1 critical, 7 high, 38 moderate, 3 low                                                      |

Two notes about reading the scan.

- **Records are not vulnerabilities.** All 55 records carried distinct GHSA ids, but several advisories
  share one root cause across versions (for example hono's repeated `serveStatic` path work). The
  numbers below are advisory/version records, as the previous tracker also recorded.
- **The scan reported eight packages, not nine.** The anticipated ninth package did not appear in either
  run, and no package was dropped by name. The eight below are the complete set.

### Reproducing the before and after sets

The parent change carries the pre-upgrade lock. Both sets are reproducible:

```sh
jj new mqnoksoqwykm && bun install --frozen-lockfile && bun audit   # 8 packages, 55 records
jj new && bun audit                                                 # on this change: 6 packages, 49 records
```

## How each record was classified

**Shipped** means the package's code is present in the built application: `apps/web/dist` (Cloudflare
target), `apps/web/.output` (Node target), or the hosted-browser image. **Tooling** means build, test or
deploy only: `@lineupkeep/infra`, the root `devDependencies`, or a dependency of the Alchemy CLI. Tooling
records still matter — they run on the owner's machine with repository input and produce deploy plans —
but they are a different risk class and are labelled as such.

Reachability was established from three sources, not assumed:

1. the installed package source, read for the call path from a request handler to the vulnerable code;
2. the built artifacts, grepped for the module and for the fixed code's markers;
3. the application source, grepped for the API in question.

**A caveat about chain attribution.** `bun audit` prints dependency chains by package name and can
attribute an installed copy to the wrong workspace chain. The `toml` record below is exactly that case:
the scan prints `workspace:@lineupkeep/web > effect > toml`, while the only installed `toml` belongs to a
nested `effect@4.0.0-beta.59` under `effect-solutions`. Every chain in this document was verified against
the installed tree, not only against the scan's display.

## Records and disposition

### `@tanstack/start-server-core@1.169.26` — shipped, reachable (critical)

Chain: `@lineupkeep/web > @tanstack/solid-start > @tanstack/start-server-core` (shipped server bundle).
A second chain, `@tanstack/start-plugin-core > @tanstack/start-server-core`, is build tooling that
resolves to the same installed version.

| Advisory            | CVE             | Severity | Fixed    | Reachable | Action                                              |
| ------------------- | --------------- | -------- | -------- | --------- | --------------------------------------------------- |
| GHSA-qx66-fv34-fjm8 | CVE-2026-102989 | critical | 1.169.39 | Yes — E1  | Not taken: framework hold. Covered by the backport. |

**E1.** Unauthenticated reflected XSS in server-function responses. Static reachability through Solid RPC
was established earlier, and a built-app reproduction executed the attack shape locally before the
backport; the regression is committed as `e2e/serverFunctionTransport.e2e.ts` and passes on the shipped
build. The temporary response-validation backport in
[release-readiness.md](release-readiness.md#temporary-response-validation-backport-applied-2026-10-25)
closes the reported vector on the pinned closure.

**Not taken.** 1.169.39 cannot be installed without moving the framework family. The patched
`start-*-core` set requires `router-core` 1.171.34, which no published version pairs with `solid-router`
2.0.0-rc.8's imports; the 2026-10-24 attempts and their failures are recorded in
[release-readiness.md](release-readiness.md#publication-blocker-solid-start-rpc-security). The owner holds
Solid and TanStack versions, and this audit does not change that.

### `seroval@1.6.7` — shipped, deserializer reachable (resolved)

Chains, all resolving to one hoisted copy:

- `@lineupkeep/web > @solidjs/web > seroval`
- `@lineupkeep/web > solid-js > seroval-plugins > seroval`
- `@lineupkeep/web > @tanstack/solid-router > @tanstack/router-core > seroval`
- `@lineupkeep/web > @tanstack/solid-start > @tanstack/start-storage-context > @tanstack/router-core > seroval`
- `@lineupkeep/web > @tanstack/solid-router-ssr-query > @tanstack/router-ssr-query-core > @tanstack/router-core > seroval`
- `@tanstack/start-plugin-core > @tanstack/router-core > seroval`

| Advisory            | CVE             | Severity | Fixed  | Reachable | Action             |
| ------------------- | --------------- | -------- | ------ | --------- | ------------------ |
| GHSA-97r2-qh9m-474h | CVE-2026-116581 | high     | 1.6.8  | Yes — E2  | Upgraded to 1.6.12 |
| GHSA-wp97-x4hv-qvhp | CVE-2026-116584 | high     | 1.6.8  | Yes — E2  | Upgraded to 1.6.12 |
| GHSA-7rv5-mrxv-xcr9 | CVE-2026-116580 | high     | 1.6.8  | Yes — E2  | Upgraded to 1.6.12 |
| GHSA-f86p-h4j2-7qgj | CVE-2026-116583 | moderate | 1.6.11 | No — E3   | Upgraded to 1.6.12 |
| GHSA-9wx9-5pv9-3349 | CVE-2026-116582 | moderate | 1.6.10 | No — E3   | Upgraded to 1.6.12 |

**E2 — the deserializer is reachable from untrusted input.** Installed
`@tanstack/start-server-core/dist/esm/server-functions-handler.js` imports `fromJSON` and calls it on the
GET `payload` query parameter, on the `application/json` request body, and on the `TSS_FORMDATA_CONTEXT`
form field. That parse happens inside `handleServerAction` _before_ `action(params)` runs, so the
application's own authorization inside a server function cannot precede deserialization. The same call
sites survive into the shipped bundles: `fromJSON(payload, { plugins: serovalPlugins })` is present in
`apps/web/dist/server/server.js` and in `apps/web/.output/server/_ssr/ssr.mjs`. The array-length and
sequence advisories are therefore reachable in the shape the advisories describe — a small request payload
handed to `fromJSON` before any application authorization. The attacker-picked-callable advisory is on the
same call path and additionally needs a plugin value to target; it is reachable in the sense the advisory
means (the deserializer is the boundary).

**E3 — the serializer advisories are not reachable in this application.** Both require the serialized
object graph to contain a `RegExp` built from untrusted text, or a typed array carrying an own
`constructor` property from untrusted data. No module under `apps/web/src/contracts` or
`apps/web/src/server-functions` constructs a `RegExp`, `Uint8Array`, `ArrayBuffer` or other view, and no
provider or user input is turned into one before serialization. Provider and user text reaches seroval as
strings, which seroval escapes in both affected versions.

**Taken.** `seroval` and `seroval-plugins` are pinned to 1.6.12 through root `overrides`, satisfying
`~1.6.7` (`@solidjs/web`, `solid-js`) and `^1.6.2` (`@tanstack/router-core`) without moving any framework
version. 1.6.12 keeps the same entry points and has no dependencies of its own. The fixed guard is
present in the shipped build: `SerovalMalformedNodeError` appears in
`apps/web/dist/server/assets/web-*.js`.

### `zod@4.4.3` — shipped, not demonstrably triggerable (resolved)

Eight chains; four installed copies existed at scan time:

| Installed copy           | Resolved by                                                                                                                                                                  | Vulnerable |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `node_modules/zod@4.4.3` | `@tanstack/start-plugin-core`, `@tanstack/router-plugin`, `@tanstack/router-generator`, `drizzle-orm`, `better-call` (peer), `@better-auth/cimd` / `@better-auth/mcp` (peer) | yes        |
| nested `4.6.7` × 3       | `@better-auth/core`, `@better-auth/oauth-provider`, `better-auth`, `knip`                                                                                                    | no         |

| Advisory            | CVE            | Severity | Fixed | Reachable                             | Action            |
| ------------------- | -------------- | -------- | ----- | ------------------------------------- | ----------------- |
| GHSA-mrhx-c7xc-m3w5 | CVE-2023-54404 | high     | 4.6.6 | Loaded — E4 (no trigger demonstrated) | Upgraded to 4.6.7 |

**E4.** The vulnerable copy was in the shipped server bundle: the pre-upgrade
`apps/web/.output/server/_libs/@better-auth/cimd+[...].mjs` carried two zod cores, `version = { major: 4,
minor: 6, patch: 7 }` and `{ major: 4, minor: 4, patch: 3 }`. `better-call/dist/index.mjs` statically
imports `./openapi.mjs`, the only better-call module that imports `zod`, so the 4.4.3 copy was loaded at
start-up through `@better-auth/mcp` and `@better-auth/cimd`.

A trigger was not demonstrated, and the reasons are specific: the application source imports no zod
(`rg 'from "zod"' apps packages` returns nothing), `better-auth` and `@better-auth/core` validate with
their nested 4.6.7 copies, `@better-auth/mcp` and `@better-auth/cimd` do not import zod themselves, and
the other consumers resolving to 4.4.3 are the TanStack route generator (build time, repository config
as input) and `drizzle-orm`'s `zod` adapter entry, which nothing imports. The advisory needs an attacker
array validated by an array schema **built with the vulnerable copy**, which this application does not
create.

**Taken anyway.** `zod` is pinned to 4.6.7 through root `overrides`. It is the latest published release,
already present in three nested copies, satisfies every declared range (`^4.4.3`, `^4.5.4`,
`^3.25.0 || ^4.0.0`), and moves no Solid or TanStack package. After the upgrade all four copies in the
shipped bundle are 4.6.7 and the audit no longer reports zod.

### `@hono/node-server@1.19.9` — tooling (accepted)

Chain: `@lineupkeep/infra > alchemy > @prisma/dev > @hono/node-server`.

| Advisory            | CVE            | Severity | Fixed   | Reachable | Action       |
| ------------------- | -------------- | -------- | ------- | --------- | ------------ |
| GHSA-wc8c-qw6v-h7f6 | CVE-2026-29087 | high     | 1.19.10 | No — E6   | Left, see D1 |
| GHSA-92pp-h63x-v22m | CVE-2026-39406 | moderate | 1.19.13 | No — E6   | Left, see D1 |
| GHSA-frvp-7c67-39w9 | —              | moderate | 1.19.15 | No — E6   | Left, see D1 |

**E6.** `alchemy/lib/Prisma/PrismaDevDatabase.js` reaches `@prisma/dev` only through
`Effect.tryPromise(() => import("@prisma/dev"))`, inside `ensurePrismaDevDatabase`. It executes only when
an Alchemy Prisma dev database is created; this repository configures Neon, not Alchemy's Prisma
provider, so the import never runs. `@hono/node-server` does not appear in `apps/web/dist` or
`apps/web/.output`, and it is not a dependency of any shipped workspace.

**D1 — disposition.** The package is the Node adapter for Prisma's local dev server, a tool we do not
start. `@prisma/dev` pins it exactly (`1.19.9`), so an upgrade means overriding an exact pin inside a
pinned deploy CLI (`alchemy` 2.0.0-beta.83). That is a riskier change than the exposure. This assessment
changes if we adopt Alchemy's Prisma dev-database provider, if the Prisma dev server is bound beyond
loopback, or if Alchemy publishes a version that raises the pin.

### `hono@4.11.4` — tooling (accepted)

Chains: `@lineupkeep/infra > @alchemy.run/frontend-frameworks > hono` and
`@lineupkeep/infra > alchemy > @prisma/dev > @hono/node-server > hono` (one installed copy, 4.11.4).

All 38 records are tooling. Fixed versions range from 4.11.7 to 4.13.7; **4.13.7 or later clears every
record in this list**.

| Advisory            | CVE            | Severity | Fixed   | Reachable | Action       |
| ------------------- | -------------- | -------- | ------- | --------- | ------------ |
| GHSA-q5qw-h33p-qvwr | CVE-2026-29045 | high     | 4.12.4  | No — E5   | Left, see D2 |
| GHSA-88fw-hqm2-52qc | CVE-2026-54290 | high     | 4.12.25 | No — E5   | Left, see D2 |
| GHSA-9r54-q6cx-xmh5 | CVE-2026-24771 | moderate | 4.11.7  | No — E5   | Left, see D2 |
| GHSA-6wqw-2p9w-4vw4 | CVE-2026-24472 | moderate | 4.11.7  | No — E5   | Left, see D2 |
| GHSA-r354-f388-2fhh | CVE-2026-24398 | moderate | 4.11.7  | No — E5   | Left, see D2 |
| GHSA-w332-q679-j88p | CVE-2026-24473 | moderate | 4.11.7  | No — E5   | Left, see D2 |
| GHSA-5pq2-9x2x-5p6w | CVE-2026-29086 | moderate | 4.12.4  | No — E5   | Left, see D2 |
| GHSA-p6xx-57qc-3wxr | CVE-2026-29085 | moderate | 4.12.4  | No — E5   | Left, see D2 |
| GHSA-r5rp-j6wh-rvv4 | CVE-2026-39410 | moderate | 4.12.12 | No — E5   | Left, see D2 |
| GHSA-xf4j-xp2r-rqqx | CVE-2026-39408 | moderate | 4.12.12 | No — E5   | Left, see D2 |
| GHSA-wmmm-f939-6g9c | CVE-2026-39407 | moderate | 4.12.12 | No — E5   | Left, see D2 |
| GHSA-xpcf-pg52-r92g | CVE-2026-39409 | moderate | 4.12.12 | No — E5   | Left, see D2 |
| GHSA-qp7p-654g-cw7p | CVE-2026-44458 | moderate | 4.12.18 | No — E5   | Left, see D2 |
| GHSA-p77w-8qqv-26rm | CVE-2026-44457 | moderate | 4.12.18 | No — E5   | Left, see D2 |
| GHSA-9vqf-7f2p-gf9v | CVE-2026-44456 | moderate | 4.12.16 | No — E5   | Left, see D2 |
| GHSA-69xw-7hcm-h432 | CVE-2026-44455 | moderate | 4.12.16 | No — E5   | Left, see D2 |
| GHSA-xrhx-7g5j-rcj5 | CVE-2026-47674 | moderate | 4.12.21 | No — E5   | Left, see D2 |
| GHSA-3hrh-pfw6-9m5x | CVE-2026-47675 | moderate | 4.12.21 | No — E5   | Left, see D2 |
| GHSA-f577-qrjj-4474 | CVE-2026-47673 | moderate | 4.12.21 | No — E5   | Left, see D2 |
| GHSA-2gcr-mfcq-wcc3 | CVE-2026-47676 | moderate | 4.12.21 | No — E5   | Left, see D2 |
| GHSA-458j-xx4x-4375 | CVE-2026-56761 | moderate | 4.12.14 | No — E5   | Left, see D2 |
| GHSA-rv63-4mwf-qqc2 | CVE-2026-54288 | moderate | 4.12.25 | No — E5   | Left, see D2 |
| GHSA-wgpf-jwqj-8h8p | CVE-2026-54289 | moderate | 4.12.25 | No — E5   | Left, see D2 |
| GHSA-wwfh-h76j-fc44 | CVE-2026-54286 | moderate | 4.12.25 | No — E5   | Left, see D2 |
| GHSA-j6c9-x7qj-28xf | CVE-2026-54287 | moderate | 4.12.25 | No — E5   | Left, see D2 |
| GHSA-xgm2-5f3f-mvvc | CVE-2026-59897 | moderate | 4.12.27 | No — E5   | Left, see D2 |
| GHSA-w62v-xxxg-mg59 | CVE-2026-59895 | moderate | 4.12.27 | No — E5   | Left, see D2 |
| GHSA-8j4g-w8fx-2239 | CVE-2026-69207 | moderate | 4.12.34 | No — E5   | Left, see D2 |
| GHSA-f23p-vx2j-j53r | CVE-2026-71850 | moderate | 4.12.34 | No — E5   | Left, see D2 |
| GHSA-gqvv-2mrq-wpjv | CVE-2026-84365 | moderate | 4.13.5  | No — E5   | Left, see D2 |
| GHSA-g6gw-c38x-mqfc | CVE-2026-84364 | moderate | 4.13.5  | No — E5   | Left, see D2 |
| GHSA-crvj-82cr-hjcx | CVE-2026-84363 | moderate | 4.13.5  | No — E5   | Left, see D2 |
| GHSA-26pp-8wgv-hjvm | CVE-2026-56762 | moderate | 4.12.12 | No — E5   | Left, see D2 |
| GHSA-hxh3-vqpv-xpqv | CVE-2026-93981 | moderate | 4.13.7  | No — E5   | Left, see D2 |
| GHSA-v8w9-8mx6-g223 | CVE-2026-56763 | moderate | 4.12.7  | No — E5   | Left, see D2 |
| GHSA-gq3j-xvxp-8hrf | CVE-2026-56764 | low      | 4.11.10 | No — E5   | Left, see D2 |
| GHSA-hm8q-7f3q-5f36 | CVE-2026-44459 | low      | 4.12.18 | No — E5   | Left, see D2 |
| GHSA-79qm-7rj5-m7r9 | CVE-2026-71849 | low      | 4.12.34 | No — E5   | Left, see D2 |

**E5.** Two import sites exist in the installed tree. `@alchemy.run/frontend-frameworks` imports hono
only in its **Waku** adapter (`dist/waku/adapter.js`, `dist/waku/aws-adapter.js`); this project deploys
Solid Start, so that module is never loaded. `@prisma/dev` uses hono for its local dev server, behind the
dynamic import in E6. Neither built application (`apps/web/dist`, `apps/web/.output`) contains a hono
module: the only textual matches are the word "honors" in bundled copy, and `rg 'node_modules/hono'` finds
nothing. `hono` is not a dependency of any shipped workspace.

**D2 — disposition.** The only reachable instance would be an HTTP server we never start, or a framework
adapter we never load. `@prisma/dev` pins hono exactly (`4.11.4`) inside the pinned Alchemy CLI, so
upgrading means overriding an exact pin of a dev server's HTTP stack. This assessment changes if the
Prisma dev server or the Waku adapter is ever started against untrusted traffic, or if Alchemy raises its
pins.

### `lodash@4.17.21` — tooling (accepted)

Chain: `@lineupkeep/infra > alchemy > @prisma/dev > @mrleebo/prisma-ast > chevrotain > @chevrotain/gast > lodash`.

| Advisory            | CVE            | Severity | Fixed   | Reachable | Action       |
| ------------------- | -------------- | -------- | ------- | --------- | ------------ |
| GHSA-r5fr-rjxr-66jc | CVE-2026-4800  | high     | 4.18.0  | No — E7   | Left, see D3 |
| GHSA-f23m-r3pf-42rh | CVE-2026-2950  | moderate | 4.18.0  | No — E7   | Left, see D3 |
| GHSA-xxjr-mmjv-4gpg | CVE-2025-13465 | moderate | 4.17.23 | No — E7   | Left, see D3 |

**E7.** lodash is a parser dependency of `@mrleebo/prisma-ast`, which `@prisma/dev` uses to read
`schema.prisma`. Its only input is a repository file, and it is behind the same dynamic import as E6.
`rg 'node_modules/lodash' apps/web/dist apps/web/.output` finds nothing; lodash is not a dependency of any
shipped workspace.

**D3 — disposition.** `chevrotain` and `@chevrotain/gast` pin lodash exactly (`4.17.21`), so the fix
requires overriding an exact pin of a parser in a dev tool. The inputs are repository-owned. This changes
if a Prisma schema becomes attacker-influenced, or if chevrotain publishes a fixed pin.

### `toml@4.3.0` — tooling (accepted)

Scan chain: `workspace:@lineupkeep/web > effect > toml`. **This is not the installed path.**

| Advisory            | CVE             | Severity | Fixed | Reachable | Action       |
| ------------------- | --------------- | -------- | ----- | --------- | ------------ |
| GHSA-4qx8-w7c3-pj3p | CVE-2026-114141 | high     | 5.0.1 | No — E8   | Left, see D4 |
| GHSA-9j65-hcg3-gc64 | CVE-2026-114143 | high     | 5.0.1 | No — E8   | Left, see D4 |
| GHSA-9qmh-m7c6-f92p | CVE-2026-114144 | high     | 5.0.1 | No — E8   | Left, see D4 |

**E8.** The application's `effect@4.0.5` declares **no dependencies at all** and contains no `toml`
import (`rg 'from "toml"' node_modules/effect` returns nothing). The only installed `toml` is required by
`effect@4.0.0-beta.59`, nested under the root devDependency `effect-solutions`, where
`dist/unstable/cli/Primitive.js` imports it for CLI config files. That TOML parser is bundled into
`node_modules/effect-solutions/dist/cli.js`, the developer command `bun run effect-solutions`. No shipped
artifact contains a `toml` module, and no `toml` input exists: the CLI reads its own documentation
manifest, not TOML files. `gray-matter` lists `toml ^2.3.3` as an optional dependency (never installed
here), and `confbox` parses TOML through `smol-toml`.

**D4 — disposition.** Dev documentation CLI only. The fix is toml 5.0.1, which the nested effect's
`^4.1.1` range excludes, and bumping it would run untested parser internals under a beta Effect. This
changes if the application starts using Effect's TOML `ConfigProvider` on untrusted input, or if
`effect-solutions` ships an Effect that accepts toml 5.

**A fourth toml advisory is published and absent from Bun's database.** OSV reports
GHSA-h895-cgqg-jf52 / CVE-2026-63376 (prototype pollution through quote-form key-path desynchronization,
fixed 5.0.1) against `toml@4.3.0`; `bun audit` did not list it. It does not change the disposition — the
package is still dev tooling with no attacker input — but the record count understates the published
advisories for this package by one.

### `valibot@1.2.0` — tooling, not imported (accepted)

Chains: `@lineupkeep/backend > drizzle-orm > valibot` (an optional-peer edge) and
`@lineupkeep/infra > alchemy > @prisma/dev > valibot` (exact pin).

| Advisory            | CVE            | Severity | Fixed | Reachable | Action       |
| ------------------- | -------------- | -------- | ----- | --------- | ------------ |
| GHSA-5qjj-4xww-7phc | CVE-2026-59952 | moderate | 1.4.2 | No — E9   | Left, see D5 |

**E9.** `drizzle-orm` declares valibot only as an optional peer and imports it only from the
`drizzle-orm/valibot` entry. The application imports `drizzle-orm`, `drizzle-orm/pg-core`, the
`effect-*` entries, `pglite`, and `postgres-js` — never `drizzle-orm/valibot` — and the shipped bundles
contain no valibot (`rg -N valibot apps/web/dist apps/web/.output` finds nothing). The installed copy
exists because `@prisma/dev` depends on it exactly (`1.2.0`).

**D5 — disposition.** Unused code path in the application, plus a tooling-only copy behind the E6 dynamic
import. This changes if we adopt the drizzle valibot schema adapter, at which point the fix (1.4.2) is
within its peer range and should be taken.

## Changes taken

| Package           | From  | To     | Mechanism        | Why it is safe                                                                                                                        |
| ----------------- | ----- | ------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `zod`             | 4.4.3 | 4.6.7  | root `overrides` | Latest 4.x; satisfies `^4.4.3`, `^4.5.4`, `^3.25.0 \|\| ^4.0.0`; already installed in three nested copies; no framework package moves |
| `seroval`         | 1.6.7 | 1.6.12 | root `overrides` | Same `exports`, no dependencies; satisfies `~1.6.7` and `^1.6.2`; no framework package moves                                          |
| `seroval-plugins` | 1.6.7 | 1.6.12 | root `overrides` | Released in lockstep with seroval; peer range `seroval ^1.0` still satisfied                                                          |

`bun audit fix` was not run. Each upgrade is an explicit pin in `package.json` `overrides`, so a future
install cannot drift back or sideways without a visible manifest change. `bun.lock` changed only in those
three resolutions, their now-deduplicated nested copies, and one stale workspace devDependency entry that
`bun install` recomputed. No Solid or TanStack version changed:

- `solid-js`, `@solidjs/web`, `@solidjs/signals`, `@solidjs/compiler`, `@solidjs/babel-plugin` — 2.0.0-rc.13
- `@tanstack/solid-start` 2.0.0-rc.8, `@tanstack/solid-router` 2.0.0-rc.8, `router-core` 1.171.22,
  `start-server-core` 1.169.26, `start-client-core` 1.170.22

The three existing framework patches in `patchedDependencies` still apply and were not touched.

## Verification

| Check               | Result                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `bun checks`        | Passed — format, lint, dependency-cruiser, knip, knip production, 1395 tests in 116 files, both builds |
| `bun run build:all` | Passed (Node and Cloudflare targets)                                                                   |
| `bun run test:e2e`  | Passed — 52 tests, 5.8 minutes, Node target, including `serverFunctionTransport.e2e.ts`                |

Shipped-artifact inspection after the upgrade:

- every zod core in `apps/web/dist/server/assets/authorize-*.js` reports `major: 4, minor: 6, patch: 7`
  (four copies: root, `@better-auth/core`, `better-auth`, `@better-auth/oauth-provider`);
- `SerovalMalformedNodeError`, the 1.6.8+ guard, is present in `apps/web/dist/server/assets/web-*.js`;
- no `hono`, `lodash`, `@hono/node-server`, `toml`, or `valibot` module appears in `apps/web/dist` or
  `apps/web/.output`.

## Record set after the change

`bun audit` now reports 49 records over 6 packages:

| Package                       | Records | Class   | Verdict                                                       |
| ----------------------------- | ------- | ------- | ------------------------------------------------------------- |
| `hono`                        | 38      | tooling | Accepted — Waku adapter and Prisma dev server, neither loaded |
| `@hono/node-server`           | 3       | tooling | Accepted — Prisma dev server only, behind a dynamic import    |
| `lodash`                      | 3       | tooling | Accepted — Prisma schema AST parser, exact pin                |
| `toml`                        | 3       | tooling | Accepted — `effect-solutions` developer CLI                   |
| `valibot`                     | 1       | tooling | Accepted — unused drizzle entry and Prisma dev server         |
| `@tanstack/start-server-core` | 1       | shipped | Critical, tracked separately, mitigated by the backport       |

Resolved by this change: `zod` (1 record) and `seroval` (5 records). Difference: 8 packages → 6,
55 records → 49, high 11 → 7, moderate 40 → 38. The critical record is unchanged and expected to stay
until a fixed framework parent is adopted.

## Residual risk in plain terms

The one production-critical dependency problem is still the tracked one: the pinned Solid Start server
transport contains the reflected-XSS flaw described in GHSA-qx66-fv34-fjm8, and it is mitigated only by a
local patch against three pinned packages. That patch closes the reported forgery vector and is exercised
by a committed built-app regression, but it is not an upstream release, must be re-applied and re-verified
on every install, and proves nothing about server-function input shapes the advisory did not cover.
Publication remains gated on adopting a published parent that carries the complete upstream fix with the
same acceptance, or on the owner accepting the patched pin in writing. The Solid/TanStack hold this audit
respected is the reason the fixed version was not taken.

The two shipped non-framework weaknesses found in this scan are now fixed in the built application:
seroval's deserializer, which the server runs on request payloads before authorization, and the
vulnerable zod copy that was loaded at start-up. Both upgrades are pinned and verified across the unit,
integration, build and end-to-end checks.

The remaining 49 records are all in build or deploy tooling. They cannot reach a request served by the
deployed web, worker, or hosted-browser service: the packages are absent from every built artifact, and
the two live code paths (`@prisma/dev`'s local server and the Waku adapter) are either never imported or
never loaded. That is a statement about reachability, not about the advisories being harmless: they would
matter to anyone running the Prisma dev server or a Waku deployment, and they will matter here if that
changes. Tooling chains also run with repository and owner input on the deploy machine, so a compromised
dependency there could still read deploy credentials — the reason these are documented rather than
dismissed.

## What was not established

- **A reproduction of the zod advisory against our own schemas.** No application schema uses the
  vulnerable copy; the verdict is "loaded in the shipped bundle, trigger not demonstrated". The upgrade
  makes the question moot for this dependency.
- **Reachability inside `@prisma/dev` and the Waku adapter.** Their HTTP surfaces were not exercised. The
  claim is only that neither is loaded by this application or its deploy path.
- **Whether the Prisma dev server binds beyond loopback.** Not started or observed; the provider is
  unused here.
- **The fourth toml advisory.** `bun audit` does not report GHSA-h895-cgqg-jf52 while OSV does; the Bun
  advisory database appears to lag for that record. One package's count is therefore one short of the
  published set.
- **Advisories published after this date.** This is a point-in-time record; a later scan is required
  before publication, as the release checklist already requires.
