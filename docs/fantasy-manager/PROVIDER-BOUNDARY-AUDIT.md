# Provider boundary audit

This audit records every provider-specific fact found in generic code, where it was found, and what
happened to it during the Phase 2 provider-neutrality correction. It exists so the next provider can be
added without rediscovering the seam, and so a reviewer can tell a deliberate provider declaration from
a leak.

The decision itself is [ADR 0007](adr/0007-provider-registry-and-planner-capability.md). The
responsible-module map stays in [ARCHITECTURE.md](ARCHITECTURE.md#2-modules-and-seams).

## Result

After the correction, no production module outside the provider adapters, the composition root, and
three presentation declaration modules contains the string `Yahoo` or `yahoo`, and no generic module
imports a provider adapter. The repository-wide check that produced that statement:

```sh
rg -n 'Yahoo|yahoo' packages apps --glob '!*.test.*' --glob '!**/internal/yahoo/**'
```

The remaining hits are the declarations listed under
[provider-specific by nature](#provider-specific-by-nature), each of which is a lookup table keyed by
provider rather than a branch on provider identity.

## The seam

| Piece             | File                                       | Responsibility                                                                                     |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Provider key      | `contexts/connections/ProviderKey.ts`      | Branded `/^[a-z][a-z0-9]{1,23}$/` identifier stored on connections and teams                       |
| Provider contract | `contexts/connections/Provider.ts`         | One plain-object shape for every provider capability and operation                                 |
| Registry          | `contexts/connections/ProviderRegistry.ts` | Keyed map resolved by `get` or `requireProvider`, with `ProviderUnregistered` as the named failure |
| Composition       | `runtime/ApplicationLayer.ts`              | The only module that imports an adapter and builds the registry map                                |

`ProviderShape` declares facts, not brand behavior:

- `fantasyDay`: time zone, `local-midnight` boundary, and the policy version used in safe results.
- `sports`: the sports this provider serves.
- `playerSearch`: accepted sorts, the sorts the provider itself orders, and the sports with weekly
  statistic series.
- `publishesProjections` and `publishesCommunityStartRate`: which value sources exist.
- `statBases`: actual and projected statistic bases the provider reports.
- `limitations`: named, human-readable limitations by subject (`player_schedule`,
  `probable_starters`, `projections`, `community_start_rate`, `team_remaining_games`, `lock_timing`,
  `historical_seasons`).

Generic query code renders and enforces those facts. It never infers them from a provider name.

## Findings and dispositions

### Contracts and persistence

| Where                                                             | Provider-specific fact                                                     | Disposition                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `connections/Connection.ts`, `connections/HostedLinking.ts`       | Provider schema was `Literals(["yahoo"])`                                  | Replaced by `ProviderKey`; the contract exports only the key                                                          |
| `internal/ConnectionTables.ts`, `internal/HostedLinkingTables.ts` | Columns were `text("provider", { enum: ["yahoo"] })`                       | Plain `text`, decoded through `ProviderKey`                                                                           |
| `internal/LineupRunTables.ts`                                     | Write-intent action and plan tag `start_active_players`                    | Renamed to `native_action`; a migration rewrites stored run state and write-intent plans                              |
| `internal/LineupRunWorkflow.ts`                                   | Observation fields `leagueCurrentWeek`, `leagueStartWeek`, `leagueEndWeek` | Renamed to `leagueCurrentPeriod`, `leagueStartPeriod`, `leagueEndPeriod`; the same migration rewrites in-flight state |
| `contexts/connections/Provider.ts`                                | `ProviderPeriodWindow.currentWeek/startWeek/endWeek`                       | Renamed to `current/start/end`                                                                                        |
| `contexts/connections/FantasyTeam.ts` etc.                        | Single-letter brand aliases distinguishing provider and provider key       | Removed; `ProviderKey` is the one identifier type                                                                     |
| `contexts/connections/Connection.ts`                              | `Provider` alias hid that the value is a key                               | Re-exported explicitly as `ProviderKey` so the key and the adapter shape cannot be confused                           |

### Provider contract and generic services

| Where                                                     | Provider-specific fact                                                                              | Disposition                                                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Provider.ts`                                             | `provider: Literals(["yahoo"])`, provider operation names `apply_native_start_active`, `read_crumb` | `ProviderKey`; `apply_native_action`; `read_crumb` removed from the public operation list and handled inside the adapter  |
| `Provider.ts`                                             | Value source `"percent-started"` and `ProviderPercentStarted`, `cutType`, `delta`                   | `"community-start-rate"`, `ProviderCommunityStartRate`, `cut`, `change`                                                   |
| `Provider.ts`                                             | Roster position `isStarting: boolean`                                                               | `kind: "starting" \| "bench" \| "reserve"` plus declared `eligibility`                                                    |
| `Provider.ts`                                             | Player detail `percentStarted`                                                                      | `communityStartRate`                                                                                                      |
| `Provider.ts`                                             | Write-not-sent reason `crumb_unavailable`                                                           | `session_incomplete`, a neutral reason the worker can act on                                                              |
| `connections/FantasyDay.ts`                               | Hardcoded `yahooPacificMidnight` and `fantasyDayPolicy(provider, league)`                           | Provider-declared `ProviderFantasyDay`; the adapter owns time zone, boundary, and version                                 |
| `connections/QueryResults.ts`                             | Yahoo prose in MCP descriptions; `percentStarted` fields                                            | Capability-driven descriptions; `communityStartRate`                                                                      |
| `internal/FantasyQueriesLive.ts`                          | `period`, `startedPeriod`, `currentWeek` vocabulary; hardcoded Yahoo sort and projection checks     | Neutral `period`, `startRateCoverage`, `currentPeriod`; behavior comes from `capabilities.playerSearch` and `limitations` |
| `internal/ConnectionsLive.ts`                             | A single `ProviderGateway` and `provider: "yahoo"` in method inputs                                 | Registry lookup by `ProviderKey`; unregistered keys fail as `ConnectionProviderRejected`                                  |
| `internal/QueryContext.ts`, `internal/QueryRepository.ts` | Resolution assumed one provider                                                                     | Loads the key from the owned team and resolves the shape from the registry                                                |
| `internal/TeamRepository.ts`                              | Pause-until-day-end used `fantasyDayPolicy(provider, league)`                                       | Uses the team provider's `capabilities.fantasyDay`                                                                        |
| `internal/NotificationsRepository.ts`                     | Email said "reconnect your Yahoo account"                                                           | Provider-neutral "reconnect your fantasy team"                                                                            |

### Planning and values

| Where                                    | Provider-specific fact                                                                                                                                                                     | Disposition                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/LineupWorkerLive.ts`           | Eleven imports from `yahoo/YahooLineup.ts`: planner, value sources, policy inputs, assignment request, target period, observation window, refusal codes and descriptions, preferred source | Replaced by `provider.planLineup`, neutral outcomes, and `applyNativeAction` / `applyExplicitAssignments`; the worker keeps the run machine, serialization, intents, readback, reconciliation, and native fallback  |
| `internal/LineupWorkerLive.ts`           | Sport-specific refusal for leagues with dated rosters                                                                                                                                      | Removed; a provider that cannot plan a target says so through its own refusal or declared capability                                                                                                                |
| `internal/LineupWorkerLive.ts`           | `Effect.die("The Yahoo value-source ladder cannot select projections.")`                                                                                                                   | Replaced by a fallback ladder over data conditions; see below                                                                                                                                                       |
| `lineup-policy/src/plan.ts`, `source.ts` | None; ladder now lives here                                                                                                                                                                | `projected-points` → `scoring-rules` → `community-start-rate` → named refusal. `planLineup` evaluates candidates in ladder order, and `lineupAssignments` turns a plan into provider assignments or a named refusal |
| `lineup-policy/src/policy.ts`            | `percent-started` naming and started vocabulary                                                                                                                                            | `community-start-rate`; the pure policy knows no provider                                                                                                                                                           |
| `yahoo/YahooLineup.ts`                   | Yahoo planning was imported by the worker                                                                                                                                                  | Still Yahoo-specific, now exposed only as the provider's `planLineup` capability                                                                                                                                    |

The projections defect deserves its own line. Selecting a value source is a total order over candidates:
projections first, then scoring rules, then the published community start rate, then a named refusal
with a remedy. A provider that publishes no projections simply contributes no candidate. An unusable
candidate is a refusal in the result, not an Effect defect. The worker records the refusal, falls back
to the native action when the refusal allows it, and reports the policy provenance.

### Presentation, tooling, and helper

| Where                                                                               | Provider-specific fact                                                           | Disposition                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser auth, landing, connections, team pages, hosted-linking panel, browser frame | Hardcoded "Yahoo" copy                                                           | `contracts/connections/providerLabels.ts` maps a key to a display name; callers render the supplied provider                                                           |
| `contracts/connections/teamContract.ts`                                             | Provider literal                                                                 | `ProviderKey`                                                                                                                                                          |
| MCP `fantasyQueryTools.ts`                                                          | Descriptions claimed Yahoo ranks and "projections always unsupported for Yahoo"  | Descriptions now defer to the provider's declared capabilities and limitations                                                                                         |
| `packages/hosted-browser/src/provider.ts`                                           | One Yahoo login URL and origin allowlist                                         | `hostedBrowserProviders` keyed by provider; origins are derived from the declarations                                                                                  |
| `apps/linking-helper/src/providers.ts`                                              | Yahoo sign-in URL, `T`/`Y` session cookies, Yahoo label, and a `"yahoo"` default | `helperProviders` declares label, sign-in URL, and required session cookie names; the CLI's default comes from the declared list; `ProviderBrowser` is cookie-agnostic |
| `e2e/` fixtures                                                                     | `yahoo` key and Yahoo-shaped fake payloads                                       | Retained: they simulate the first provider through the public seam and the fake adapter implements `ProviderShape`                                                     |

## Provider-specific by nature

These are declarations, not leaks. Each is scoped to one surface and consumed through a keyed lookup,
so another provider adds an entry without touching behavior.

| Declaration                                                  | Location                                                        | Why it is acceptable                                                                                                                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display names and the current default selection              | `apps/web/src/contracts/connections/providerLabels.ts`          | Presentation only. The default is the only provider the product currently offers; when a second provider exists, the connections flow should ask which one, which is a product decision rather than a refactor |
| Hosted browser sign-in URL and allowlisted origins           | `packages/hosted-browser/src/provider.ts`                       | The hosted browser must navigate to the provider's own sign-in page and nowhere else; the allowlist is a security boundary, and it is one entry per provider                                                   |
| Helper sign-in URL, session cookie names, and provider label | `apps/linking-helper/src/providers.ts`                          | The local helper drives the provider's real web sign-in. Cookie names are that provider's session format; the helper never sees the password, and `ProviderBrowser` itself is provider-neutral                 |
| Provider-labelled sign-in page                               | The provider's own page, opened by the helper or hosted browser | We do not restyle or proxy provider authentication. The person sees the provider's page, so provider identity is the honest label                                                                              |
| Yahoo wire details                                           | `packages/backend/src/contexts/connections/internal/yahoo/**`   | Endpoints, XML actions, crumb, game codes, diamond cuts, and review-link parameters are the adapter's job                                                                                                      |

Cookie names and the sign-in URL are the two facts that could not be moved behind the server-side
`ProviderShape`, because they belong to the browser-driving surfaces rather than the backend adapter.
They are declared in the same keyed style, in the only modules allowed to know them.

## Enforcement

`.dependency-cruiser.ts` adds `provider-adapters-are-injected`:

- **Rejected:** any import of `contexts/connections/internal/yahoo/` from elsewhere, including a
  generic service next to the adapter, with the remedy "use ProviderRegistry and construct each adapter
  only in runtime/ApplicationLayer.ts".
- **Accepted:** the same import from `runtime/ApplicationLayer.ts` and from inside the adapter
  directory.

The rule is covered by acceptance and rejection fixtures in `scripts/dependencyCruiser.test.ts`. The
existing `no-cross-context-internals` and `no-context-internals-outside-composition-roots` rules keep
the rest of the context internals sealed.

A deliberate violation was added to the real tree — a single import of `YahooProvider.ts` from
`internal/FantasyQueriesLive.ts` — and the check rejected it:

```text
error provider-adapters-are-injected: packages/backend/src/contexts/connections/internal/FantasyQueriesLive.ts → packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.ts
  Generic code must not import a provider adapter; use ProviderRegistry and
  construct each adapter only in runtime/ApplicationLayer.ts.

x 1 dependency violations (1 errors, 0 warnings). 183 modules, 703 dependencies cruised.
```

The import was then reverted. The same check passes on the complete tree.

## AutoCoach breadth review

The AutoCoach reference was read for breadth, not ported. It supports four sports (`nfl`, `nhl`, `nba`,
`mlb`) and exposes Yahoo's date-scoped roster and percent-started evidence. Its lineup score function
multiplies values by injuries (`0.001`), LTIR (`0.1`), not-playing (`1e-7`), and starting (`100`). Those
multipliers are not adopted: they double-count participation, treat a missing signal as a near-zero
value, and encode provider/sport judgement in a generic score. [ADR 0006](adr/0006-availability-tiers.md)
already replaced that idea with an availability ladder that never adjusts value.

What the seam accommodates now:

- **Sports:** declared per provider; the generic contracts' vocabulary is still football and hockey,
  which is a deliberate follow-up rather than a hidden assumption.
- **League formats:** `ProviderLeagueSettings.format` carries the declared league format, so head-to-head
  categories, head-to-head points, rotisserie, and points-only leagues reach the planner as facts.
- **Timing:** providers declare a fantasy-day boundary, and rosters declare `week` or `date` coverage
  with a period window, which covers weekly NFL lineups and date-scoped NHL rosters without either
  becoming the generic model.
- **Value sources:** projections, scoring rules, and community start rate are capabilities. A provider
  that publishes projections (AutoCoach reads Yahoo's projected ranks) can contribute that candidate
  without the worker changing.
- **Statistics:** declared bases and categories let a league score with its own rules instead of a
  hardcoded provider formula.

Deliberate follow-ups are listed in [ADR 0007](adr/0007-provider-registry-and-planner-capability.md#deferred):
widening the product sport vocabulary, category-aware or rotisserie optimization, and baseball pitcher
policy. This chunk keeps behavior and does not add a provider, a sport, or a new optimization.
