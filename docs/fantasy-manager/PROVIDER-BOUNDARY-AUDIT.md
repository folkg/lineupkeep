# Provider boundary audit

This audit records every provider-specific fact found in generic code, where it was found, and what
happened to it. It exists so the next provider can be added without rediscovering the seam, and so a
reviewer can tell a deliberate provider declaration from a leak.

The first correction is [ADR 0007](adr/0007-provider-registry-and-planner-capability.md) with
[ADR 0008](adr/0008-refusal-kinds-and-planner-cutover.md). The second — a provider publishes a final
score rather than a scoring policy — is [ADR 0009](adr/0009-provider-score-ownership.md); the sections
below marked _second pass_ were changed by it. The responsible-module map stays in
[ARCHITECTURE.md](ARCHITECTURE.md#2-modules-and-seams).

## Result

After the second pass, no production module outside the provider adapters, their scoring modules, the
composition root, and the keyed presentation/helper declarations contains the string `Yahoo` or
`yahoo`, and no generic module imports a provider adapter or a provider scoring module. The
repository-wide check that produced that statement:

```sh
rg -n 'Yahoo|yahoo' packages apps \
  --glob '!*.test.*' --glob '!*Test.ts' --glob '!*.md' \
  --glob '!**/internal/yahoo/**' --glob '!packages/backend/migrations/**'
```

Test support and the helper README are excluded because they are not runtime modules; the historical
`20261025113924_cool_ted_forrester` migration is excluded because it is an immutable applied record,
not code that runs. The remaining hits are the declarations listed under
[provider-specific by nature](#provider-specific-by-nature), each of which is a lookup table keyed by
provider rather than a branch on provider identity. The `repository/provider-identity` lint rule now
makes that statement enforceable in source: it rejects a provider name in any `src/` module outside the
adapter, the composition root, and those declarations.

## The seam

| Piece             | File                                              | Responsibility                                                                                                      |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Provider key      | `contexts/connections/ProviderKey.ts`             | Branded `/^[a-z][a-z0-9]{1,23}$/` identifier stored on connections and teams                                        |
| Provider contract | `contexts/connections/Provider.ts`                | One plain-object shape for every provider capability and operation                                                  |
| Registry          | `contexts/connections/ProviderRegistry.ts`        | Keyed map resolved by `get` or `requireProvider`, with `ProviderUnregistered` as the named failure                  |
| Composition       | `runtime/ApplicationLayer.ts`                     | The only module that imports an adapter and builds the registry map                                                 |
| Lineup planning   | `contexts/connections/internal/LineupPlanning.ts` | Builds the solver's neutral problem from a provider's declarations and final scores and returns changed assignments |
| Provider scoring  | `contexts/connections/internal/provider-scoring/` | How one provider constructs scores: exact arithmetic, league-rule scoring, crowd shares, windows                    |

`ProviderShape.scoreRoster` returns **a result, not a method** (_second pass_):

- `scored` — an opaque `provenance` label and, per player, a final signed `score` in the provider's own
  unit (`null` when the provider publishes none) plus an `availability` tier, together with the
  per-position games-played facts;
- `refused` — `structural` or `transient`, the same opaque label, and a human-readable `detail`.

Nothing about projections, realised statistics, crowd shares, cuts, ranks, period windows, or which
source won crosses the seam.

`ProviderShape` declares facts, not brand behavior:

- `fantasyDay`: time zone, `local-midnight` boundary, and the provider version used when pausing.
- `sports`: the sports this provider serves.
- `playerSearch`: accepted sorts, the sorts the provider itself orders, and the sports with weekly
  statistic series.
- `publishesProjections`: whether the query surface can offer the projections group.
- `limitations`: named, human-readable limitations by subject (`player_schedule`,
  `probable_starters`, `projections`, `team_remaining_games`, `lock_timing`, `historical_seasons`).

Generic query code renders and enforces those facts. It never infers them from a provider name.

### Fields kept, and the second-provider argument for each

| Field                                              | Why the generic layer needs it                                                       | Why a second provider could differ                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `fantasyDay` (zone, boundary, version)             | Pause expiry and "is this period still current" are generic decisions                | A provider with a different midnight or a rolling lock would declare its own      |
| `sports`                                           | Discovery and team lists must filter to what the provider serves                     | Providers cover different sports                                                  |
| `playerSearch.sorts`                               | A sort the provider refuses must be answered with a remedy, not forwarded            | Sort vocabularies differ                                                          |
| `playerSearch.providerOrderedSorts`                | The query layer must not re-order a provider-ordered page                            | Another provider sorts fewer or more things itself                                |
| `playerSearch.weeklyStatSortSports`                | A weekly stat sort must be refused where the provider only publishes seasons         | Another provider may publish weekly series for every sport, or none               |
| `publishesProjections`                             | The `projections` group must say "unsupported" rather than silently empty            | Another provider publishes projections                                            |
| `limitations`                                      | Unsupported reads must explain the provider's own limit                              | Every limit is provider-specific prose                                            |
| `rosterCoverage` (`week` or `date`)                | Resolving a target period and writing a roster both branch on it                     | Weekly roster providers and dated roster providers both exist today               |
| `periodWindow` (`current`, `start`, `end`)         | Resolving "current" for a weekly roster needs the provider's declared range          | A dated roster publishes season dates instead, and this stays undefined           |
| `rosterPositions` (name, kind, count, eligibility) | Slot structure, capacity, and eligibility are the solver's constraints               | Slot names, flex rules, and reserve lists are league facts the provider publishes |
| `statCategories` / `statModifiers`                 | The league's own scoring context is a query answer, and a provider may score with it | Another provider may publish categories only                                      |
| `isEditable`                                       | A non-editable player is pinned to their slot in the neutral problem                 | Providers report locks differently or not at all                                  |
| `percentStarted` on search results                 | A published popularity share is a query answer, not a scoring decision               | Another provider may publish only ownership, and then this is null                |

## Findings and dispositions

### Contracts and persistence

| Where                                                                 | Provider-specific fact                                                                | Disposition                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `connections/Connection.ts`, `connections/HostedLinking.ts`           | Provider schema was `Literals(["yahoo"])`                                             | Replaced by `ProviderKey`; the contract exports only the key                                                          |
| `internal/ConnectionTables.ts`, `internal/HostedLinkingTables.ts`     | Columns were `text("provider", { enum: ["yahoo"] })`                                  | Plain `text`, decoded through `ProviderKey`                                                                           |
| `internal/LineupRunTables.ts`                                         | Write-intent action and plan tag `start_active_players`                               | Renamed to `native_action`; a migration rewrites stored run state and write-intent plans                              |
| `internal/LineupRunWorkflow.ts`                                       | Observation fields `leagueCurrentWeek`, `leagueStartWeek`, `leagueEndWeek`            | Renamed to `leagueCurrentPeriod`, `leagueStartPeriod`, `leagueEndPeriod`; the same migration rewrites in-flight state |
| `contexts/connections/Provider.ts`                                    | `ProviderPeriodWindow.currentWeek/startWeek/endWeek`                                  | Renamed to `current/start/end`                                                                                        |
| `contexts/connections/LineupRun.ts`                                   | `LineupPolicyProvenance { version, basis, code }` (_second pass_)                     | `LineupPlanProvenance { kind, label, detail? }`: one opaque provider label, never parsed                              |
| `internal/LineupRunWorkflow.ts`, `internal/LineupRunTables.ts`        | Plan fields `policy` (_second pass_)                                                  | Renamed to `provenance`; a migration rewrites run state and write intents and keeps the recorded label                |
| `contexts/connections/FantasyTeam.ts`, `internal/ConnectionTables.ts` | Team automation `policyVersion` held the provider's fantasy-day label (_second pass_) | Renamed to `fantasyDayVersion`; the same migration rewrites stored automation state                                   |
| `contexts/connections/FantasyTeam.ts` etc.                            | Single-letter brand aliases distinguishing provider and provider key                  | Removed; `ProviderKey` is the one identifier type                                                                     |
| `contexts/connections/Connection.ts`                                  | `Provider` alias hid that the value is a key                                          | Re-exported explicitly as `ProviderKey` so the key and the adapter shape cannot be confused                           |

### Provider contract and generic services

| Where                                                     | Provider-specific fact                                                                              | Disposition                                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Provider.ts`                                             | `provider: Literals(["yahoo"])`, provider operation names `apply_native_start_active`, `read_crumb` | `ProviderKey`; `apply_native_action`; `read_crumb` removed from the public operation list and handled inside the adapter |
| `Provider.ts`                                             | Value source `"percent-started"` and `ProviderPercentStarted`, `cutType`, `delta`                   | Renamed to the provider's own vocabulary, and then removed from the seam entirely in the second pass                     |
| `Provider.ts`                                             | Roster position `isStarting: boolean`                                                               | `kind: "starting" \| "bench" \| "reserve"` plus declared `eligibility`                                                   |
| `Provider.ts`                                             | Write-not-sent reason `crumb_unavailable`                                                           | `session_incomplete`, a neutral reason the worker can act on                                                             |
| `connections/FantasyDay.ts`                               | Hardcoded `yahooPacificMidnight` and `fantasyDayPolicy(provider, league)`                           | Provider-declared `ProviderFantasyDay`; the adapter owns time zone, boundary, and version                                |
| `connections/QueryResults.ts`                             | Yahoo prose in MCP descriptions; `percentStarted` fields                                            | Capability-driven descriptions; the search surface keeps `percentStarted` as a published share                           |
| `internal/FantasyQueriesLive.ts`                          | `period`, `startedPeriod`, `currentWeek` vocabulary; hardcoded provider sort and projection checks  | Neutral `period`, `currentPeriod`; behavior comes from `capabilities.playerSearch` and `limitations`                     |
| `internal/ConnectionsLive.ts`                             | A single `ProviderGateway` and `provider: "yahoo"` in method inputs                                 | Registry lookup by `ProviderKey`; unregistered keys fail as `ConnectionProviderRejected`                                 |
| `internal/QueryContext.ts`, `internal/QueryRepository.ts` | Resolution assumed one provider                                                                     | Loads the key from the owned team and resolves the shape from the registry                                               |
| `internal/TeamRepository.ts`                              | Pause-until-day-end used `fantasyDayPolicy(provider, league)`                                       | Uses the team provider's `capabilities.fantasyDay`                                                                       |
| `internal/NotificationsRepository.ts`                     | Email said "reconnect your Yahoo account"                                                           | Provider-neutral "reconnect your fantasy team"                                                                           |

### Planning and values, first pass

| Where                                    | Provider-specific fact                                                                                                                                                                     | Disposition                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/LineupWorkerLive.ts`           | Eleven imports from `yahoo/YahooLineup.ts`: planner, value sources, policy inputs, assignment request, target period, observation window, refusal codes and descriptions, preferred source | Replaced by `provider.scoreRoster`, the generic planner, neutral outcomes, and `applyNativeAction` / `applyExplicitAssignments`; the worker keeps the run machine, serialization, intents, readback, reconciliation, and native fallback |
| `internal/LineupWorkerLive.ts`           | Sport-specific refusal for leagues with dated rosters                                                                                                                                      | Removed; a provider that cannot plan a target says so through its own refusal or declared capability                                                                                                                                     |
| `internal/LineupWorkerLive.ts`           | `Effect.die("The Yahoo value-source ladder cannot select projections.")`                                                                                                                   | Replaced by a fallback ladder over data conditions; see below                                                                                                                                                                            |
| `lineup-policy/src/plan.ts`, `source.ts` | None; the ladder lived here                                                                                                                                                                | Moved behind the provider in the second pass; see below                                                                                                                                                                                  |
| `yahoo/YahooLineup.ts`                   | Yahoo planning was imported by the worker                                                                                                                                                  | Now Yahoo's own scoring modules and the provider's `scoreRoster` capability                                                                                                                                                              |

The projections defect deserves its own line. Selecting a scoring scheme is a total order over the
provider's own evidence: projections first, then scoring rules, then the published crowd share, then a
named refusal with a remedy. A provider that publishes no projections simply contributes no candidate.
An unusable candidate is a refusal in the result, not an Effect defect. The worker records the
refusal, falls back to the native action when the refusal allows it, and reports the provider's label.

### Planning, scores, and provenance — second pass

| Where                                                      | Provider-specific fact                                                                                   | Disposition                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Provider.ts` `ProviderScoreOutcome`                       | A plan crossed as `{ assignments, policyVersion, basis }`, where `basis` was provider scoring vocabulary | One final score per player plus an availability tier and games facts, or a refusal; `basis` and `policyVersion` no longer exist |
| `Provider.ts` `ProviderCapabilities`                       | `publishesCommunityStartRate` and `statBases`: scoring declarations with no generic reader               | Deleted; the adapter keeps the fact, the seam does not                                                                          |
| `Provider.ts` `ProviderPlayerReadInput`                    | `startRateCoverage` asked the generic read for one provider's crowd measurement                          | Deleted; the crowd read is internal to the adapter (`YahooProvider.readPlayerFacts`)                                            |
| `Provider.ts` `ProviderPlayerDetail`                       | `communityStartRate` with `cuts` and `coverage` on the shared detail payload                             | Deleted from the seam; the provider reads it only for its own scoring                                                           |
| `Provider.ts` `ProviderPlayerSearchResult`                 | `communityStartRate` / `communityStartRateChange`                                                        | Renamed to `percentStarted` / `percentStartedChange`: a published share the search surface reports, not a scoring policy        |
| `Provider.ts` `ProviderRosterPlayer`                       | `isFlex`, a provider flag with no generic reader                                                         | Deleted; slot name plus eligibility already describe the slot                                                                   |
| `Provider.ts` `ProviderPeriod`                             | A week-only period next to roster coverage, easy to confuse                                              | Renamed `ProviderScoringWeek`, with `ProviderCoverageKind` for the week-or-date coverage type                                   |
| `lineup-scoring`, `lineup-policy` (top-level packages)     | Read as product concepts: "value source", "scoring basis", "community start rate", "observation window"  | Relocated to `contexts/connections/internal/provider-scoring/`; the packages no longer exist                                    |
| `lineup-policy` `buildLineupProblem`, `lineupAssignments`  | Built the solver problem and translated a plan, mixing scoring with placement                            | Split: placement is generic (`internal/LineupPlanning.ts`), scoring stays in the provider module                                |
| `lineup-policy` `availabilityLadder`, `assessAvailability` | The ladder is a product decision; the status mapping is provider judgement                               | Ladder order now in the generic planner; status-to-tier mapping in the provider module                                          |
| `lineup-policy` `lineupRefusalKind`                        | Mapped scoring and solver codes to structural or transient in one table                                  | Provider scoring refusals are classified by the adapter; solver and placement refusals are transient in the generic planner     |
| `internal/ProviderFakeTest.ts`                             | Reproduced a provider's scoring arithmetic in the generic test fake                                      | Declares a final score and availability tier per player (`setPlayerScores`); it imports no scoring module                       |
| `internal/LineupWorkerLive.ts`                             | Annotated spans and recorded `lineup.selection_basis` / `policy.basis`                                   | Annotates and records `lineup.provenance` / `provenance.label`                                                                  |

The one deliberate behaviour change in the split: the ladder still falls through when a scheme cannot be
computed at all (no completed period, no published value), but a scheme whose scores cannot be legally
placed now blocks the attempt instead of silently switching to a weaker scheme. Roster shape is not
evidence about which measurement to trust.

### Presentation, tooling, and helper

| Where                                                                               | Provider-specific fact                                                           | Disposition                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser auth, landing, connections, team pages, hosted-linking panel, browser frame | Hardcoded "Yahoo" copy                                                           | `contracts/connections/providerLabels.ts` maps a key to a display name; callers render the supplied provider                                                           |
| `contracts/connections/teamContract.ts`                                             | Provider literal; run `policy { version, basis, code }` (_second pass_)          | `ProviderKey`; run `provenance { kind, label, detail? }`                                                                                                               |
| MCP `fantasyQueryTools.ts`                                                          | Descriptions claimed Yahoo ranks and "projections always unsupported for Yahoo"  | Descriptions defer to the provider's declared capabilities and limitations                                                                                             |
| MCP `lineupTools.ts`                                                                | "Lineupkeep's own policy plans the lineup" (_second pass_)                       | "Lineupkeep plans the lineup from the provider's final per-player scores"                                                                                              |
| `packages/hosted-browser/src/provider.ts`                                           | One Yahoo login URL and origin allowlist                                         | `hostedBrowserProviders` keyed by provider; origins are derived from the declarations                                                                                  |
| `apps/linking-helper/src/providers.ts`                                              | Yahoo sign-in URL, `T`/`Y` session cookies, Yahoo label, and a `"yahoo"` default | `helperProviders` declares label, sign-in URL, and required session cookie names; the CLI's default comes from the declared list; `ProviderBrowser` is cookie-agnostic |
| `e2e/` fixtures                                                                     | `yahoo` key and Yahoo-shaped fake payloads                                       | Retained: they simulate the first provider through the public seam and the fake adapter implements `ProviderShape`                                                     |

### Examined and kept, with reasons

| Candidate                                                | Disposition                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayPosition` on roster, search, and details         | Kept. It is the provider's own human-facing position label, rendered verbatim; generic code never parses or compares it, and synthesising a label across providers would be worse. Eligibility and primary position carry every decision. |
| Roster slot names (`QB`, `W/R/T`, `BN`, `IR+`, ...)      | Kept as opaque identifiers. The provider publishes them, players declare eligibility by name, and the solver treats both as strings. No generic module enumerates a slot name.                                                            |
| Week-versus-date periods                                 | Kept as a declared fact (`rosterCoverage`, `ProviderRosterCoverage`, `ProviderPeriodWindow`). Weekly and dated rosters both exist in the live account, and target resolution needs the provider's own range.                              |
| Sport literals in public contracts                       | Kept, unchanged from ADR 0007's deferral: the contracts name football and hockey while provider-declared sports are already accepted at the persistence edge. Generic planning no longer branches on sport at all.                        |
| `custom_policy` / `custom-policy/2` implementation names | Kept. They name which implementation acted (the product's planner or the provider's native action), not a scoring rule; the version was bumped because planning moved.                                                                    |
| Provider limitations prose                               | Kept as provider-authored text, consumed by subject. It is the only place a provider explains what it cannot publish.                                                                                                                     |

## Provider-specific by nature

These are declarations, not leaks. Each is scoped to one surface and consumed through a keyed lookup,
so another provider adds an entry without touching behavior.

| Declaration                                                  | Location                                                                                         | Why it is acceptable                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display names and the current default selection              | `apps/web/src/contracts/connections/providerLabels.ts`                                           | Presentation only. The default is the only provider the product currently offers; when a second provider exists, the connections flow should ask which one, which is a product decision rather than a refactor |
| Hosted browser sign-in URL and allowlisted origins           | `packages/hosted-browser/src/provider.ts`                                                        | The hosted browser must navigate to the provider's own sign-in page and nowhere else; the allowlist is a security boundary, and it is one entry per provider                                                   |
| Helper sign-in URL, session cookie names, and provider label | `apps/linking-helper/src/providers.ts`                                                           | The local helper drives the provider's real web sign-in. Cookie names are that provider's session format; the helper never sees the password, and `ProviderBrowser` itself is provider-neutral                 |
| Provider-labelled sign-in page                               | The provider's own page, opened by the helper or hosted browser                                  | We do not restyle or proxy provider authentication. The person sees the provider's page, so provider identity is the honest label                                                                              |
| Yahoo wire details and scoring                               | `packages/backend/src/contexts/connections/internal/yahoo/**` and `internal/provider-scoring/**` | Endpoints, XML actions, crumb, game codes, scoring cohorts, review-link parameters, and the arithmetic that turns league rules or crowd shares into scores are the adapter's job                               |

Cookie names and the sign-in URL are the two facts that could not be moved behind the server-side
`ProviderShape`, because they belong to the browser-driving surfaces rather than the backend adapter.
They are declared in the same keyed style, in the only modules allowed to know them.

## Enforcement

`.dependency-cruiser.ts` keeps `provider-adapters-are-injected` and adds two rules (_second pass_):

- **Rejected:** any import of `contexts/connections/internal/yahoo/` from elsewhere, including a
  generic service next to the adapter, with the remedy "use ProviderRegistry and construct each adapter
  only in runtime/ApplicationLayer.ts".
- **Accepted:** the same import from `runtime/ApplicationLayer.ts` and from inside the adapter
  directory.
- **Rejected:** any import of `contexts/connections/internal/provider-scoring/` from outside the
  provider adapters — `provider-scoring-stays-in-the-adapter`.
- **Rejected:** any import from a scoring module into the application, Effect, persistence, transport,
  the solver, or the brand — `provider-scoring-is-self-contained`.

The `repository` lint plugin adds two rules:

- `provider-scoring-vocabulary` rejects a fixed list of scoring identifiers (`communityStartRate`,
  `valueSource`, `startCutPreference`, `scoringProfile`, `scorePeriod`, `mean-points-per-period`,
  `observationWindow`, `statBases`, `isFlex`, and their siblings) in any `src/` module outside the
  provider's own directories, so a scoring concept cannot reappear as a field name, a string, or a
  helper.
- `provider-identity` rejects `Yahoo` or `yahoo` in generic source outside the adapter, the
  composition root, and the keyed presentation/helper declarations, so a provider-name branch cannot
  reappear as a string comparison.

Each rule is covered by acceptance and rejection fixtures in `scripts/dependencyCruiser.test.ts`. A
deliberate violation was added to the real tree — a single import of `YahooProvider.ts` from
`internal/FantasyQueriesLive.ts` — and the check rejected it:

```text
error provider-adapters-are-injected: packages/backend/src/contexts/connections/internal/FantasyQueriesLive.ts → packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.ts
  Generic code must not import a provider adapter; use ProviderRegistry and
  construct each adapter only in runtime/ApplicationLayer.ts.

x 1 dependency violations (1 errors, 0 warnings). 183 modules, 703 dependencies cruised.
```

The import was then reverted. The same check passes on the complete tree.

The second-pass rules were proved the same way, in the real tree and then reverted. A scoring import
added to `internal/LineupPlanning.ts`:

```text
error provider-scoring-stays-in-the-adapter: packages/backend/src/contexts/connections/internal/LineupPlanning.ts → packages/backend/src/contexts/connections/internal/provider-scoring/LineupScore.ts
  How a provider constructs a score is that provider's implementation detail;
  use ProviderShape for final scores and opaque provenance, and keep scoring
  modules inside the provider adapters.
```

and a scoring term added to a generic contract module:

```text
packages/backend/src/contexts/connections/QueryResultsViolation.ts:1:29: error repository(provider-scoring-vocabulary): `communityStartRate` names how one provider constructs a score; keep scoring vocabulary inside the provider adapter and expose only a final score and opaque provenance.
```

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
  categories, head-to-head points, rotisserie, and points-only leagues reach the provider as facts.
- **Timing:** providers declare a fantasy-day boundary, and rosters declare `week` or `date` coverage
  with a period window, which covers weekly NFL lineups and date-scoped NHL rosters without either
  becoming the generic model.
- **Scoring:** a provider publishes one final score per player for its chosen scheme, or refuses. A
  provider that publishes projections, categories, or a crowd share decides internally how to combine
  them, and the run records only its label. The score is an integer count on the provider's own scale
  — hundredths of a point, hundredths of a started percentage — because the solver ranks integer
  selections exactly; every value in one run shares that scale, and nothing generic interprets it.

Deliberate follow-ups are listed in [ADR 0007](adr/0007-provider-registry-and-planner-capability.md#deferred)
and [ADR 0009](adr/0009-provider-score-ownership.md#deferred): widening the product sport vocabulary,
category-aware or rotisserie optimization inside the adapter, and baseball pitcher policy. This chunk
keeps behavior and does not add a provider, a sport, or a new optimization.
