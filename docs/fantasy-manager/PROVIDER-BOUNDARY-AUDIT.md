# Provider boundary audit

This audit records every provider-specific fact found in generic code, where it was found, and what
happened to it. It exists so the next provider can be added without rediscovering the seam, and so a
reviewer can tell a deliberate provider declaration from a leak.

The first correction is [ADR 0007](adr/0007-provider-registry-and-planner-capability.md) with
[ADR 0008](adr/0008-refusal-kinds-and-planner-cutover.md). The second — a provider publishes a final
score rather than a scoring policy — is [ADR 0009](adr/0009-provider-score-ownership.md); the sections
below marked _second pass_ were changed by it. The third sweep looked for provider-shaped _ideas_ that
survive the import rule: sport-to-behaviour rules, provider wire vocabulary, a provider's numeric
bounds, and capability claims the provider never made. Sections marked _third pass_ were changed by it.
The responsible-module map stays in [ARCHITECTURE.md](ARCHITECTURE.md#2-modules-and-seams).

## Result

No production module outside the provider adapters, their scoring modules, the composition root, and
the keyed presentation declarations contains the string `Yahoo` or `yahoo`, and no generic
module imports a provider adapter or a provider scoring module. The repository-wide check:

```sh
rg -n 'Yahoo|yahoo' packages apps \
  --glob '!*.test.*' --glob '!**/internal/yahoo/**'
```

The remaining hits are deliberate: the composition root imports the adapter to build the registry;
`providerLabels` and the hosted-browser declaration are keyed lookup tables;
the `20261025113924_cool_ted_forrester` migration is an immutable applied record; and
`ProviderFakeTest.ts` is test support that simulates the first provider through the public seam. The `repository/provider-identity` lint rule
makes the source statement enforceable: it rejects a provider name in any `src/` module outside the
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
- `playerSearch`: accepted sorts, the sorts the provider itself orders, and whether its search rows
  publish the value a weekly order sorts by (`weeklyOrderingValues`, _third pass_).
- `statPeriods`: per sport, which statistic-period kinds the provider serves natively, by aggregating
  daily reads, or not at all.
- `scheduleRead.maximumDates`: how many dates one schedule read covers (_third pass_).
- `publishesProjections`: whether the query surface can offer the projections group.
- `limitations`: named, human-readable limitations by subject (`player_schedule`,
  `probable_starters`, `projections`, `team_remaining_games`, `per_team_games_played` (_third pass_),
  `lock_timing`, `historical_seasons`).

Generic query code renders and enforces those facts. It never infers them from a provider name.

### Fields kept, and the second-provider argument for each

| Field                                              | Why the generic layer needs it                                                       | Why a second provider could differ                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `fantasyDay` (zone, boundary, version)             | Pause expiry and "is this period still current" are generic decisions                | A provider with a different midnight or a rolling lock would declare its own      |
| `sports`                                           | Discovery and team lists must filter to what the provider serves                     | Providers cover different sports                                                  |
| `playerSearch.sorts`                               | A sort the provider refuses must be answered with a remedy, not forwarded            | Sort vocabularies differ                                                          |
| `playerSearch.providerOrderedSorts`                | The query layer must not re-order a provider-ordered page                            | Another provider sorts fewer or more things itself                                |
| `playerSearch.weeklyOrderingValues` (_third pass_) | A weekly order may only be offered where the rows publish the value it sorts by      | Another provider publishes the weekly value, or publishes none at all             |
| `statPeriods` (per sport)                          | A period kind the provider cannot serve is refused with its remedy, not substituted  | Providers serve different period kinds natively or by aggregating daily reads     |
| `scheduleRead.maximumDates` (_third pass_)         | The schedule section must state the bound the provider enforces                      | A provider with a shorter or longer schedule-read bound declares its own          |
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
| `internal/LineupRunWorkflow.ts`                                       | Observation fields `leagueCurrentWeek`, `leagueStartWeek`, `leagueEndWeek`            | Renamed to periods, then removed in the final review when no reader remained; the migration remains an applied record |
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
provider's own evidence: the league's rules, then the ownership composite for a games-limited league,
then the published crowd share, then a named refusal with a remedy. A provider that publishes
projections combines them into its own final score before the seam; an unused projections rung was
removed from the scoring modules in the final review. An unusable candidate is a refusal in the
result, not an Effect defect. The worker records the refusal, falls back to the native action when the
refusal allows it, and reports the provider's label.

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

### Provider-shaped ideas that survived the import rule — third pass

The import rule was already true, so this sweep looked for knowledge rather than dependencies: a
generic module that decided something only the provider knows, a capability claim the provider never
made, and a name that would mislead the next reader. Each hit is listed with its disposition.

| Where                                                                                                                                          | Provider-specific idea                                                                                                                                                                                                               | Disposition                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/FantasyQueriesLive.ts` `searchPlayers`                                                                                               | Refused `statPeriod: "week"` for every provider with the fixed claim "the provider's player search publishes only season rank and stat values" — a fact about one provider's search payload, and a claim the provider never declared | **Real leak.** The declaration it needed already existed but was unread and misnamed (`weeklyStatSeriesSports`, which reads like the player-detail series `statPeriods` already declares). Replaced by `playerSearch.weeklyOrderingValues`; the refusal is now gated on it and the text names the declaration |
| `QueryResults.ts` `statPeriod` description                                                                                                     | "Only `season` is offered: the provider publishes no weekly rank or stat value in its search payload"                                                                                                                                | **Real leak, same fact.** Description now states the condition ("only where the provider declares that its search rows publish the weekly value they order by") instead of asserting one provider's payload                                                                                                   |
| `internal/FantasyQueriesLive.ts` `gamesPlayedUsageDetail`                                                                                      | Named one provider's wire query, `teams;out=games_played`, inside a generic explanation                                                                                                                                              | **Real leak.** The fact is now the declared `per_team_games_played` limitation; the generic layer renders `limitation(provider, "per_team_games_played")`                                                                                                                                                     |
| `QueryResults.ts` `GamesPlayedUsage` description, `internal/FantasyQueriesLive.ts` `transactionRules.detailNote`, MCP `get_league` description | The same wire query repeated in three generic texts, and a claim about per-team games played made for every provider                                                                                                                 | **Real leak.** The wire fragment is gone; `detail` names the provider's declared limitation, and the duplicated claim is removed from the transaction-rules note                                                                                                                                              |
| `QueryResults.ts` `window` / `days` descriptions, MCP `get_team_summary` description                                                           | Hardcoded "one schedule read covers at most 21 dates" — a numeric bound only the adapter enforces                                                                                                                                    | **Real leak.** Declared as `scheduleRead.maximumDates`; the schedule section's `detail` states the provider's own number, and the generic text points at it instead of naming one                                                                                                                             |
| `QueryResults.ts` `percentOwnedDelta` / `percentStartedChange` descriptions                                                                    | "a scoring week in football, the provider's fantasy day in hockey" — a sport-to-window rule the generic layer does not implement                                                                                                     | **Real leak.** Both now say the provider's own change window and that it is not published with the row, so no period may be inferred                                                                                                                                                                          |
| `apps/web/src/browser/teams/teamLabels.ts`, `browser/transactions/TransactionReviewPage.tsx`                                                   | `league === "nfl" ? "NFL" : "NHL"` and `sport === "football" ? "Football" : "Hockey"` — a closed two-value map over a four-value contract, which mislabels MLB and NBA                                                               | **Real leak and a visible bug.** Replaced by `contracts/connections/teamVocabulary.ts`, an exhaustive map over every declared sport and league, so a new value fails to compile instead of rendering the wrong label                                                                                          |
| `apps/web/src/browser/landing/LandingPage.tsx`                                                                                                 | "The scoring period is a week in football and a day in hockey" — presentation stating a rule the code deliberately does not have                                                                                                     | **Real leak.** Copy now says the league decides whether a period is a week or a day. This is the one visible copy change, and it changed because the old sentence asserted a rule the product does not apply                                                                                                  |
| `apps/web/src/browser/auth/AuthPage.tsx`                                                                                                       | "For Yahoo football and hockey leagues."                                                                                                                                                                                             | **Presentation only.** Kept: it names the sports the one live adapter serves, it is honest, and it drives no decision. When a second provider exists the connections flow must ask which provider, which is the product decision already recorded in ADR 0007                                                 |
| `Provider.ts` `ProviderPlayerStatus`, `injuryCode`, `byeWeek`, `displayPosition`, roster slot names                                            | Injury codes, a bye week, and slot names that look like one sport's vocabulary                                                                                                                                                       | **Generic concepts that look provider-ish.** Kept: the provider publishes each value verbatim, no generic module compares or enumerates one, and a provider without byes reports null. `ProviderPlayerStatus` is the provider-neutral availability vocabulary the adapter maps its own codes into             |
| `ProviderLeagueSettings.maxInningsPitched`, `statCategories`, `statModifiers`                                                                  | A baseball cap and a league's scoring context                                                                                                                                                                                        | **Declared league facts.** Kept: nullable, published only when the league declares one, and never branched on. The description says "a cap its sport does not apply is not manufactured"                                                                                                                      |
| `internal/LineupPlanning.ts`, `internal/LineupTarget.ts`                                                                                       | None: slots, eligibility, coverage, and the target period all come from declarations                                                                                                                                                 | **No leak.** Confirmed by the second-provider test below                                                                                                                                                                                                                                                      |

The `readMatchups` and `readPlayerHistory` inputs still take `ProviderScoringWeek` (_third pass,
deferred_). That is a real coverage assumption in the seam: a provider whose matchups are dated cannot
express one. Fixing it changes `ProviderShape` and the adapter together, which this chunk deliberately
does not do; generic code degrades honestly instead, refusing a matchup read for a league with no
declared period window. It is recorded here so the next provider's work starts from the fact rather
than the assumption.

### Presentation and tooling

| Where                                                                               | Provider-specific fact                                                          | Disposition                                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Browser auth, landing, connections, team pages, hosted-linking panel, browser frame | Hardcoded "Yahoo" copy                                                          | `contracts/connections/providerLabels.ts` maps a key to a display name; callers render the supplied provider       |
| `contracts/connections/teamContract.ts`                                             | Provider literal; run `policy { version, basis, code }` (_second pass_)         | `ProviderKey`; run `provenance { kind, label, detail? }`                                                           |
| MCP `fantasyQueryTools.ts`                                                          | Descriptions claimed Yahoo ranks and "projections always unsupported for Yahoo" | Descriptions defer to the provider's declared capabilities and limitations                                         |
| MCP `lineupTools.ts`                                                                | "Lineupkeep's own policy plans the lineup" (_second pass_)                      | "Lineupkeep plans the lineup from the provider's final per-player scores"                                          |
| `packages/hosted-browser/src/provider.ts`                                           | One Yahoo login URL                                                             | `hostedBrowserProviders` keyed by provider; egress is provider-independent and address-based                       |
| `e2e/` fixtures                                                                     | `yahoo` key and Yahoo-shaped fake payloads                                      | Retained: they simulate the first provider through the public seam and the fake adapter implements `ProviderShape` |

### Examined and kept, with reasons

| Candidate                                                | Disposition                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayPosition` on roster, search, and details         | Kept. It is the provider's own human-facing position label, rendered verbatim; generic code never parses or compares it, and synthesising a label across providers would be worse. Eligibility and primary position carry every decision.                                                                                                                                                               |
| Roster slot names (`QB`, `W/R/T`, `BN`, `IR+`, ...)      | Kept as opaque identifiers. The provider publishes them, players declare eligibility by name, and the solver treats both as strings. No generic module enumerates a slot name.                                                                                                                                                                                                                          |
| Week-versus-date periods                                 | Kept as a declared fact (`rosterCoverage`, `ProviderRosterCoverage`, `ProviderPeriodWindow`). Weekly and dated rosters both exist in the live account, and target resolution needs the provider's own range.                                                                                                                                                                                            |
| Sport and league literals in public contracts            | Kept, unchanged from ADR 0007's deferral: `FantasySport` and `FantasyLeague` enumerate four values while a provider declares the subset it serves. Generic planning never branches on sport, and generic presentation now maps every declared value exhaustively (`teamVocabulary.ts`) rather than comparing one. Widening the vocabulary is still deferred to a provider that publishes another sport. |
| `custom_policy` / `custom-policy/2` implementation names | Kept. They name which implementation acted (the product's planner or the provider's native action), not a scoring rule; the version was bumped because planning moved.                                                                                                                                                                                                                                  |
| Provider limitations prose                               | Kept as provider-authored text, consumed by subject. It is the only place a provider explains what it cannot publish.                                                                                                                                                                                                                                                                                   |

## Provider-specific by nature

These are declarations, not leaks. Each is scoped to one surface and consumed through a keyed lookup,
so another provider adds an entry without touching behavior.

| Declaration                                        | Location                                                                                         | Why it is acceptable                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display names and the current default selection    | `apps/web/src/contracts/connections/providerLabels.ts`                                           | Presentation only. The default is the only provider the product currently offers; when a second provider exists, the connections flow should ask which one, which is a product decision rather than a refactor |
| Hosted browser sign-in URL and allowlisted origins | `packages/hosted-browser/src/provider.ts`                                                        | The hosted browser must navigate to the provider's own sign-in page and nowhere else; the allowlist is a security boundary, and it is one entry per provider                                                   |
| Provider-labelled sign-in page                     | The provider's own page, opened by the hosted browser                                            | We do not restyle or proxy provider authentication. The person sees the provider's page, so provider identity is the honest label                                                                              |
| Yahoo wire details and scoring                     | `packages/backend/src/contexts/connections/internal/yahoo/**` and `internal/provider-scoring/**` | Endpoints, XML actions, crumb, game codes, scoring cohorts, review-link parameters, and the arithmetic that turns league rules or crowd shares into scores are the adapter's job                               |

The sign-in URL and the provider's session cookie names are the two facts that cannot move behind
the server-side `ProviderShape`, because they belong to the hosted browser rather than the backend
adapter. They stay in the hosted-browser modules that drive the provider's own sign-in.

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

The `repository` lint plugin adds five rules:

- `provider-scoring-vocabulary` rejects a fixed list of scoring identifiers (`communityStartRate`,
  `valueSource`, `startCutPreference`, `scoringProfile`, `scorePeriod`, `mean-points-per-period`,
  `observationWindow`, `ownershipComposite`, `community-start-rate`, `platinum`, `statBases`, `isFlex`,
  and their siblings) in any `src/` module outside the provider's own directories, so a scoring
  concept cannot reappear as a field name, a string, or a helper.
- `provider-action-vocabulary` rejects `start-active`, `start_active`, and `start active` in the same
  generic source, so one provider's native action name cannot become product vocabulary.
- `provider-identity` rejects `Yahoo` or `yahoo` in generic source outside the adapter, the
  composition root, and the keyed presentation declarations, so a provider-name branch cannot
  reappear as a string comparison.
- `provider-sport-rule` (_third pass_) rejects a comparison of a sport or league against a declared
  literal — `sport === "football"`, `league === "nfl"` — in any generic `src/` module, so a generic
  layer cannot select behavior by sport. The remedy is the provider's declared capability or an
  exhaustive map over every declared value.
- `provider-wire-vocabulary` (_third pass_) rejects one provider's request path and query fragments
  (`fantasy/v2/`, `;out=`, `;sort_type=`, `fantasysports`) in the same generic source, so a wire key
  cannot become an explanation a person reads. The remedy is a declared capability or a named
  limitation.

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

and a native action name added to a generic scopes module:

```text
packages/backend/src/contexts/connections/LineupScopes.ts:15:9: error repository(provider-action-vocabulary): `start-active` names one provider's native action; keep it inside the provider adapter and expose only the generic run outcome.
```

The third-pass rules are proved by fixtures in the same suite, and each was also run against a real
generic module. A sport rule added to `contexts/connections/LineupScopes.ts`:

```text
packages/backend/src/contexts/connections/LineupScopes.ts:9:55: error repository(provider-sport-rule): `sport === "football"` makes a generic module decide by sport or league; read the fact the provider declares on ProviderShape.capabilities, or map every declared value exhaustively instead of comparing one.
```

and a wire fragment added to `contexts/connections/QueryResults.ts`:

```text
packages/backend/src/contexts/connections/QueryResults.ts:1607:37: error repository(provider-wire-vocabulary): `;out=` is one provider's wire vocabulary; keep request paths, query fragments, and response keys inside the adapter and expose the fact as a declared capability or a named limitation.
```

Both accept the remedy: a `capabilities.sports.includes(sport)` check and an exhaustive
`Record<FantasySport, string>` map pass, and the wire vocabulary stays legal inside the adapter and its
scoring modules.

## A second provider, exercised through the generic path

`internal/SecondProviderFakeTest.ts` declares a provider that differs from the first in every fact this
audit names: date roster coverage instead of a scoring week, a rotisserie league, its own slot names
(`PG`, `SG`, `UTIL`, `BENCH`, `RESERVE`), a different fantasy-day time zone and version, a weekly
search order its rows can explain, its own schedule-read bound, and no projections of the first
provider's kind. `ProviderBoundary.test.ts` drives the same generic code with it and asserts that:

- `internal/LineupPlanning.ts` places the roster using that provider's slot names, kinds, and
  eligibility with no branch for either provider;
- `internal/LineupTarget.ts` resolves a dated target and refuses a weekly one, from the declared
  coverage alone;
- `FantasyQueries.searchPlayers` accepts a weekly order because that provider declares
  `weeklyOrderingValues`, where the first provider's identical call is refused — the same generic
  gate, two declarations, no edit;
- `get_team_summary` states that provider's own `scheduleRead.maximumDates` in `schedule.detail`, and
  its league reports the declared rotisserie format.

That test is the standing proof that adding a provider is an adapter plus a registry entry.

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
