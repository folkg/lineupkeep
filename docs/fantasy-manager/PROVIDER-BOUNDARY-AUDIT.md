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
- `limitations`: named, human-readable limitations by subject. Today the provider declares
  `team_remaining_games` and `per_team_games_played`; a subject it can answer carries no limitation, so
  the list shrinks as coverage grows rather than describing absent sections a client cannot request.

Generic query code renders and enforces those facts. It never infers them from a provider name.

### Fields kept, and the second-provider argument for each

| Field                                              | Why the generic layer needs it                                                                                                   | Why a second provider could differ                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `fantasyDay` (zone, boundary, version)             | Pause expiry and "is this period still current" are generic decisions                                                            | A provider with a different midnight or a rolling lock would declare its own      |
| `sports`                                           | Discovery and team lists must filter to what the provider serves                                                                 | Providers cover different sports                                                  |
| `playerSearch.sorts`                               | A sort the provider refuses must be answered with a remedy, not forwarded                                                        | Sort vocabularies differ                                                          |
| `playerSearch.providerOrderedSorts`                | The query layer must not re-order a provider-ordered page                                                                        | Another provider sorts fewer or more things itself                                |
| `playerSearch.weeklyOrderingValues` (_third pass_) | A weekly order may only be offered where the rows publish the value it sorts by                                                  | Another provider publishes the weekly value, or publishes none at all             |
| `statPeriods` (per sport)                          | A period kind the provider cannot serve is refused with its remedy, not substituted                                              | Providers serve different period kinds natively or by aggregating daily reads     |
| `scheduleRead.maximumDates` (_third pass_)         | The schedule section must state the bound the provider enforces                                                                  | A provider with a shorter or longer schedule-read bound declares its own          |
| `publishesProjections`                             | The `projections` group publishes the projected week rank where the provider serves one, and says so compactly where it does not | Another provider publishes full projected statistics                              |
| `limitations`                                      | Unsupported reads must explain the provider's own limit                                                                          | Every limit is provider-specific prose                                            |
| `rosterCoverage` (`week` or `date`)                | Resolving a target period and writing a roster both branch on it                                                                 | Weekly roster providers and dated roster providers both exist today               |
| `periodWindow` (`current`, `start`, `end`)         | Resolving "current" for a weekly roster needs the provider's declared range                                                      | A dated roster publishes season dates instead, and this stays undefined           |
| `rosterPositions` (name, kind, count, eligibility) | Slot structure, capacity, and eligibility are the solver's constraints                                                           | Slot names, flex rules, and reserve lists are league facts the provider publishes |
| `statCategories` / `statModifiers`                 | The league's own scoring context is a query answer, and a provider may score with it                                             | Another provider may publish categories only                                      |
| `isEditable`                                       | A non-editable player is pinned to their slot in the neutral problem                                                             | Providers report locks differently or not at all                                  |
| `percentStarted` on search results                 | A published popularity share is a query answer, not a scoring decision                                                           | Another provider may publish only ownership, and then this is null                |

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
| MCP `lineupTools.ts`                                                                | "Lineupgrade's own policy plans the lineup" (_second pass_)                     | "Lineupgrade plans the lineup from the provider's final per-player scores"                                         |
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

## Draft picks in a trade, proved live

A pick trade is host-specific and shape-specific, both settled against league `477.l.58487` on 9 November:

- The website write host parses the body and answers "You must select at least one player or pick."; a pick never
  reaches it. The app write host accepts the same body.
- The working body is `<trade_note></trade_note>` followed by `<picks>`, with no `<players>` element when only
  picks move. A missing note is read as an empty selection, and an empty `<players>` element fails the parser with
  error 25.
- A Round 1 for Round 1 proposal returned 201 with pending trade `477.l.58487.pt.13` and was cancelled with 204.
- Players and picks parse together on the app host: a mixed body carrying an unknown player was refused with
  "Player --empty-- is not on team Bread Roller.", which proves both parts were read.

The adapter now always writes the trade note, sends a pick-bearing proposal to the app host, and keeps player-only
trades on the website host. The live record lives in `e2e/scratch/pick-send/evidence.md`.

## Yahoo SDK read migration

`packages/yahoo-sdk` is now a workspace package. It imports only `effect` and its own `#yahoo/*`
modules, and its tests run in the Node project under the same single-worker-per-file policy as the rest
of the suite. Its original seven source changes remain unmerged outside this repository; the package
moved here with one additional upstream change to the error fields.

The migrated reads are `ProviderShape.readLeague`, backed by `Yahoo.leagues.settings`;
`ProviderShape.readLeagueTeams`, backed by `Yahoo.teams.list`; `ProviderShape.validateSession`,
backed by `Yahoo.session.validate`; `ProviderShape.readRoster`, backed by `Yahoo.rosters.forTeam`;
`ProviderShape.readMatchups`, backed by `Yahoo.matchups.week`; `ProviderShape.readTransactions`,
backed by `Yahoo.transactions.list`; `ProviderShape.readPendingTrades`, backed by
`Yahoo.transactions.pendingTrades`; `ProviderShape.readDraftResults`, backed by
`Yahoo.draft.results`; `ProviderShape.discoverTeams`, backed by `Yahoo.leagues.discover`; and
`ProviderShape.searchPlayers`, backed by `Yahoo.players.search`. Those eight per-league and session
reads keep byte-identical requests:
`GET /fantasy/v2/league/{leagueKey}/settings`, `GET /fantasy/v2/league/{leagueKey}/teams`,
`GET /fantasy/v2/users;use_login=1`,
`GET /fantasy/v2/team/{teamKey}/roster{coverage}/players;out=opponent,starting_status,transactions`,
`GET /fantasy/v2/league/{leagueKey}/scoreboard;week={week}`,
`GET /fantasy/v2/league/{leagueKey}/transactions;count={limit}[;start={offset}][;team_key={teamKey}]`,
`GET /fantasy/v2/league/{leagueKey}/transactions;type=pending_trade;team_key={teamKey}`,
and `GET /fantasy/v2/league/{leagueKey}/draftresults;out=players`, all with `?format=json`.
`readPendingTrades` uses the SDK's `transactions.pendingTrades`; its movement kind keeps the
provider's `pending_trade` value as its own kind rather than folding it into `trade`. The two
aggregate reads change their requests by construction; their published rows, ordering, limits, and
failure vocabulary do not change. The measured saving is recorded below. The SDK transport replaces
the adapter's `readJson` for these operations; the adapter path
remains for every other read. `Yahoo.Retry.none` is installed at the port because the existing adapter
has no read retry; enabling the SDK's transient retry would be a product decision, not a transport swap.

The upstream SDK now carries the provider's HTTP `status` on every status error and marks whether an
`Unauthorized` or `Forbidden` message came from a structured provider envelope. A `GatewayTimeout`
without a status is the SDK's own deadline; 408 and 504 keep their status. That lets the port publish
Yahoo's sentence as `detail` only when Yahoo actually supplied one.

### Operation map

| Port read                  | SDK operation                | Verdict                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readLeagueTeams`          | `teams.list`                 | **Migrated.** Same request, same published fields.                                                                                                                                                                                                                                                      |
| `validateSession`          | `session.validate`           | **Migrated.** Same request, same session outcome; refusal detail is gated by the SDK's `structured` mark.                                                                                                                                                                                               |
| `readLeague`               | `leagues.settings`           | **Migrated.** Same request; the adapter keeps `format`, `rosterChange`, `rosterCoverage`, `rosterConstraints`, and `webUrl` policy and maps the SDK settings to the port.                                                                                                                               |
| `readRoster`               | `rosters.forTeam`            | **Migrated.** Same request and published fields, including the week-or-date selector and the 400-to-period-mismatch rule.                                                                                                                                                                               |
| `readRosterSchedule`       | `rosters.forTeam`            | Clean per week or date; the range fan-out and game merge stay in the adapter.                                                                                                                                                                                                                           |
| `readPlayerDetails`        | `players.details`            | Clean per season, week, or date; period resolution and daily aggregation stay in the adapter.                                                                                                                                                                                                           |
| `readPlayerHistory`        | `players.details`            | Clean per period, with the same period-resolution boundary.                                                                                                                                                                                                                                             |
| `readMatchups`             | `matchups.week`              | **Migrated.** Same request and week handling; the SDK's week-coverage check publishes the same `ProviderPeriodMismatch`.                                                                                                                                                                                |
| `readTransactions`         | `transactions.list`          | **Migrated.** Same request, limit, offset, and team filter; the adapter rebuilds parties and teams from the SDK's transaction shape.                                                                                                                                                                    |
| `readPendingTrades`        | `transactions.pendingTrades` | **Migrated.** Same request; `canRespond` maps from the SDK's number to the port's boolean, and the SDK's `pending_trade` movement kind is published as `pending_trade`.                                                                                                                                 |
| `readDraftResults`         | `draft.results`              | **Migrated.** Same request, direct shape mapping.                                                                                                                                                                                                                                                       |
| `discoverTeams`            | `leagues.discover`           | **Migrated.** One aggregate read for both games replaces two per-game team reads and one settings read per league. Five live leagues: 7 requests → 1, median 1,709 ms → 311 ms, published rows byte-identical. `gameKey` maps to `league`/`sport`, and `provider` comes from the registry.              |
| `readLeagueRosters`        | `rosters.forLeagues`         | **Not a swap.** The aggregate `users;use_login` read returns the signed-in manager's team only (1 against 10–13 live). A root league-scoped read returns every team, but its five-league response is 19.5 MB against the 4 MiB read bound, so the adapter keeps its per-league `teams;out=roster` read. |
| `searchPlayers`            | `players.search`             | **Migrated.** One aggregate player-collection read per league: 1 request → 1, median 356–491 ms → 424–453 ms. Published rows, ordering, limit, refusals, and `proTeamKey` from `editorial_team_key` are unchanged on all five live leagues.                                                             |
| `readStandings`            | none                         | No SDK operation. `leagues.discover` carries only rank, points for/against/back; the port publishes category totals, acquisition usage, and streaks.                                                                                                                                                    |
| `readCompletedTrades`      | none                         | `transactions.list` has no `type=trade` filter; filtering after `count` would change which trades are returned.                                                                                                                                                                                         |
| `readPlayerWeeks`          | none                         | Needs `out=ranks,opponent;ranks=projected_week`; `players.details` requests stats and ownership instead.                                                                                                                                                                                                |
| `readAvailableDraftPicks`  | none                         | The adapter reads the Android read host with `out=available_draft_picks`; `leagues.teamAnalysis` uses the web host and a different `out`.                                                                                                                                                               |
| `scoreRoster` player facts | none                         | Needs percent-started cut types and the full rank set; no SDK operation requests that shape.                                                                                                                                                                                                            |

Writes keep the adapter's own transport. The SDK's `lineups.setNative`, `lineups.assign`,
`transactions.apply`, `trades.propose`, `trades.withdraw`, and `lineups.reserve` cover the adapter's
write surface but are not enabled as SDK operations. The SDK's host table now names both write hosts,
`write` and `androidWrite`, and its `hostOrigin` is the one list the adapter resolves them from; a
write request to either host carries the same crumb and `json_f` format.

### Draft picks in a trade

`ProviderShape.proposeTrade` carries `picks`, each one a round, a source team, and a destination team.
The adapter validates every key against the trade's two parties, writes the captured app shape
`<picks><pick><source_team_key>…</source_team_key><destination_team_key>…</destination_team_key><round>…</round></pick></picks>`
after any players, and sends a pick-bearing proposal to `https://pub-api-android-rw.fantasysports.yahoo.com`.
A player-only proposal stays on `https://pub-api-rw.fantasysports.yahoo.com`. That host choice lives in
the adapter; nothing above the port names either host. A provider refusal keeps its own sentence as the
item's failure detail, and the item is replaceable like any refused item. A successful proposal stores
the provider's pending-trade key and state.

The live re-proof with the stored connection could not run. On 9 November every write answered HTTP 401
with the provider's sentence "Cookie has timed out, please log in again." — a player-only proposal, a
roster write, and the same requests on both write hosts. Reads still authenticated on both read hosts,
and a deliberately wrong crumb answered 403 "Invalid crumb", so the session's write half had lapsed,
not the request body. No proposal was created, so there was nothing to cancel.

The pick shape is the captured one, and the earlier refusal is recorded in the roadmap: the same shape
on the website write host answered 400 "Invalid XML POSTed. Error code 25", a parse failure, while a
player-only body on that host reaches semantic validation. The product sends the app host the capture
proved rather than treating the website's parse refusal as the product's answer. The live write is
unproven with our stored sign-in; the fixtures prove the body, the host choice, the sentence, and the
stored key.

### Migration order

1. `teams.list` — done, with request, shape, and error parity tests.
2. `validateSession` — done, after the upstream SDK error fields landed.
3. `rosters.forTeam` — done, with the date-scoped read, the roster field shape, and the 400-to-period-mismatch rule unchanged.
4. `leagues.settings`, `matchups.week`, `transactions.list`, `transactions.pendingTrades`, and
   `draft.results` — done, with the league policy mapping, matchup week coverage, transaction parties
   and teams, the pending-trade `canRespond`, its own `pending_trade` movement kind, and the draft
   shape unchanged.
5. `players.details` and `readPlayerHistory` — request-identical once period resolution is lifted
   above the port.
6. Live-verify the aggregate reads (`leagues.discover`, `rosters.forLeagues`, `players.search`) before
   swapping. `leagues.discover` and `players.search` are migrated, with the measurement below.
   `rosters.forLeagues` stays out of the adapter's path: it publishes the signed-in manager's team, and
   a full-league multi-league response exceeds the SDK read bound.
7. Add SDK operations for standings, completed-trade filtering, weekly player ranks, and the Android
   available-draft-pick host.
8. Writes last, one operation at a time, each with a recorded acceptance or refusal.

### Parity findings from the migrated reads

- **Request:** identical URL, method, `accept` and `cookie` headers, empty body, and the same
  `30_000` ms / `4_194_304` byte bounds. Effect's HTTP client normally injects `b3` and `traceparent`
  headers; the port disables propagation so the provider sees the same request as before.
- **Fields:** `name`, `acquisitionUsage.seasonMoves`, `acquisitionUsage.weeklyAdds.used`,
  `acquisitionUsage.weeklyAdds.coverage`, and `remainingBudget` are unchanged. The three existing
  `readLeagueTeams` tests pass without edits.
- **Session failures:** 401 and 403 become `ProviderSessionRejected` with the provider's own status.
  An empty user list becomes `ProviderSessionRejected` without a status, because Yahoo answered 200.
- **Provider failures:** status errors become `ProviderRequestFailed` with the provider's status. A
  `GatewayTimeout` without a status is the SDK's own deadline; a 408 or 504 keeps its status.
- **Parse failures:** `YahooParseError` becomes `ProviderResponseInvalid`; `field` can now be populated
  (`body`, `league.teams.team_key`) where the old path left it undefined. The field is optional and no
  client reads it, but it is a shape difference.
- **Refusal detail:** `ProviderSessionRejected.detail` carries Yahoo's sentence only when the SDK
  marks the message as structured. Raw body text stays out of the port, exactly as the old adapter
  withheld it; the existing 401/403 privacy tests pass unchanged.
- **Malformed acquisition usage:** the SDK decodes `number_of_moves` and `roster_adds` strictly. A
  non-numeric or fractional `number_of_moves`, a non-numeric add count, a non-date coverage value, or
  a non-integer week now fails the whole read with `ProviderResponseInvalid`; the old adapter dropped
  only the affected `seasonMoves` or `weeklyAdds`. The SDK does not bound the published week to 1–99,
  so an out-of-range week is passed through where the old adapter dropped it. No recorded payload
  exercises these shapes. Team keys are also validated against Yahoo's numeric form, where the old
  decoder accepted any non-dot segment.
- **Retry:** the incoming adapter path never retried a read; the SDK's default retry is disabled at the
  port so a migrated read still makes one request.

### Roster read parity

- **Request:** identical URL, method, `accept` and `cookie` headers, empty body, and the same
  `30_000` ms / `4_194_304` byte bounds. A week period is sent as `;week=N` and a date period as
  `;date=YYYY-MM-DD`; the SDK's empty coverage suffix is used only when the caller passes no period, so
  the read neither widens nor narrows the day the league applies moves on. The existing roster tests
  pass unchanged, and four new tests pin the transport, session, server-failure, and unscoped-400
  outcomes.
- **Fields:** every published roster field is unchanged: player key, name, display and primary
  position, position type, pro team abbreviation, eligible positions, slot (including the unverified
  shape for an empty slot), editability, injury code and detail, availability status, bye week,
  scheduled fact, opponent and home flag, starting lineup, undroppable, and transaction trend. The
  existing exact-shape week-roster test passes without edits.
- **Period:** a coverage that disagrees with the requested week or date is `ProviderPeriodMismatch`
  with `requested` and `covered`, as before. A 400 answer to a scoped read stays a period mismatch with
  `covered: null`; a 400 answer to an unscoped read stays `ProviderRequestFailed` with status 400.
- **Failures:** 401 and 403 become `ProviderSessionRejected` with the provider's status and, only when
  the SDK marks the message structured, the provider's sentence. A 500 becomes
  `ProviderRequestFailed` with status 500. A parse failure, a team-key mismatch, or an empty roster
  becomes `ProviderResponseInvalid`.
- **Shape differences:** parse failures can now carry a `field` (`body`, `team.team_key`,
  `roster.week`, `players.selected_position.week`, `players.selected_position.date`) where the old
  path sometimes left it undefined. The field is optional and no client reads it. The SDK decodes
  `roster.date` and `selected_position.date` as `YYYY-MM-DD`, so a malformed date now fails the read
  with `provider.response_invalid` instead of publishing a value the port's coverage schema would
  reject. The SDK ignores the roster player's `editorial_team_key`, which the port never published,
  and exposes the container's `is_editable`, which `ProviderRoster` does not carry.
- **Refusal detail:** the same structured-statement gate as session validation; raw body text stays
  out of the port.

### League, matchup, transaction, pending-trade, and draft read parity

- **Request:** the five migrated reads send the same URL, method, `accept` and `cookie` headers, empty
  body, and `30_000` ms / `4_194_304` byte bounds as before, with one request because retry is disabled
  at the port. The existing settings, scoreboard, transaction, pending-trade, and draft tests assert the
  exact URLs and pass unchanged.
- **League fields:** every published field is unchanged. `statModifiers[].points` is still the
  provider's own value rendered as a string, and `periodWindow`, `rosterPositions`, `rosterConstraints`,
  `statCategories`, `rosterChange`, `rosterCoverage`, `format`, and `webUrl` are still decided by the
  adapter from the SDK's decoded settings. The recorded live hockey settings payload
  (`477.l.5744`) decodes through `leagues.settings`; no published field needs a value the SDK does not
  supply.
- **Matchup fields:** week, status, playoff and consolation flags, tie flag, week bounds, both team
  scores, win probability, remaining games, category totals, and category winners keep their published
  values; `period` remains the requested scoring week. The SDK's week-coverage check is the same
  `ProviderPeriodMismatch` with `requested` and `covered`.
- **Transaction fields:** transaction key, occurrence time, type, status, trade parties, the teams the
  movements involve, players and their two ends, traded picks, and the incompleteness codes are
  unchanged. The adapter rebuilds the port's parties and team union from the SDK's `proposer`,
  `receiver`, players, and picks, and publishes the SDK's movement kind directly. A transaction answer
  for another league is still `ProviderResponseInvalid`.
- **Pending-trade fields:** transaction key, proposed time, note, `canRespond`, proposer, receiver,
  unused roster spots, players and movements, traded picks, and incompleteness are unchanged. The SDK's
  number becomes the port's boolean, and the SDK's `pending_trade` movement kind is published as
  `pending_trade`. A pending-trade answer for another league is still `ProviderResponseInvalid`.
- **Draft fields:** round, pick, team key, player key, and the optional player name are unchanged. A
  draft answer for another league is still `ProviderResponseInvalid`, now with field
  `league.draft_results.team_key`.
- **Failures:** 401 and 403 stay `ProviderSessionRejected` with the provider's status and, only when
  the SDK marks the statement structured, the provider's sentence; a server status stays
  `ProviderRequestFailed`; a parse, shape, or identity failure stays `ProviderResponseInvalid`; a
  matchups week mismatch stays `ProviderPeriodMismatch`.
- **Shape differences:** the SDK exposes the league's declared acquisition numbers unchanged, so a
  declared zero publishes zero; the adapter still treats a zero games-played or innings-pitched cap as
  absent, because those fields mean a cap and zero means no cap. The SDK rejects a non-https league URL
  and a non-numeric matchup total where the old decoder published a string URL or `null`; it also
  rejects a `team_remaining_games.week` that disagrees with the request even when `total` is absent,
  where the old decoder ignored it. No recorded live payload exercises any of these shapes. A matchup
  week above 99 is refused by the SDK's input schema before the request; the old adapter forwarded it.
  The SDK and the port both publish `pending_trade` as its own transaction type and movement kind, so
  the offer's own vocabulary survives instead of falling into `other`.

### Provider-vocabulary sweep

The `pending_trade` collapse was not the only place a known provider value was falling through a
fallback. The same review found and reworked one more, and kept the deliberate domain mappings:

- **Changed — pending-trade movement kind.** The SDK's `YahooTransactionMovement.kind` and the port's
  `ProviderTransactionMovement.kind` both include `pending_trade`; the live offer publishes
  `pending_trade`.
- **Changed — pending-trade transaction type.** The SDK's `YahooTransactionType` and the port's
  `ProviderTransaction.type` both include `pending_trade`; a pending-trade row no longer reports
  `other`.
- **Changed — zero acquisition limits.** The SDK no longer drops a declared zero `max_weekly_adds` or
  `max_adds`; the port publishes the declared number. The games-played and innings-pitched caps keep
  the adapter's zero-means-no-cap policy.
- **Removed — redundant raw movement type.** `kind` now carries every known provider movement type, so
  the extra `rawType` field is gone.
- **Kept — `canRespond` number-to-boolean.** The SDK reports the provider's number; the port's question
  is a boolean.
- **Kept — unknown kinds and transaction types.** `other` is the forward-compatible catch-all for a
  movement or transaction type the SDK does not know; the port publishes the same `other` rather than
  invent a category.
- **Kept — league formats, roster coverage, and roster change.** The adapter derives these from the
  published scoring type, modifiers, weekly deadline, edit key, and slot names. No provider value is
  discarded.
- **Kept — trade ratification and player status.** Known values map to the port's vocabulary; a value
  the adapter was not taught is `unknown` rather than a guessed category. Player status also publishes
  the provider's raw injury code.
- **Kept — strict decoding.** A malformed total, a mismatched remaining-games week, a non-https league
  URL, or a matchup week above 99 is refused rather than published as a guessed value.

### Aggregate reads against live leagues

`e2e/scratch/sdk-aggregate-check/check.ts` reads the owner's stored connection from the local
development database, opens it with the application's credential cipher, and compares each aggregate
SDK read with the adapter's published answer for the same league. It also requests the root
league-scoped team collection to measure its team count and response size. It performs GETs only and
writes its result to `e2e/scratch/sdk-aggregate-check/report.json` beside itself.

| Port read           | SDK operation        | Live result                                                                                                                                         |
| ------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discoverTeams`     | `leagues.discover`   | **Ready.** 5 of 5 leagues parse; 0 field differences.                                                                                               |
| `readLeagueRosters` | `rosters.forLeagues` | **Not ready.** 5 of 5 leagues parse; each returns one team (16–22 players) against the adapter's 10–13 teams (187–281 players) for the same league. |
| `searchPlayers`     | `players.search`     | **Ready.** 5 of 5 leagues parse; 10 players each; 0 field differences.                                                                              |

Findings:

- **League wrapper.** Live aggregate responses put the league directly in `leagues[]`; the normalizer
  produces the bare league object there. `leagues.discover` and `players.search` accepted only
  `entry.league`, so every league failed at `leagues.0.league`. Both decoders now accept the direct
  entry or the single-key `league` fragment, and `rosters.forLeagues` already did. The recorded live
  responses are fixtures in `packages/yahoo-sdk/src/aggregateFixturesTest.ts`, and a malformed entry
  still fails with `YahooParseError`.
- **Empty games played.** Yahoo returns `team.games_played: {}` for leagues with no games-played data
  (football `470.l.70271` and hockey `477.l.31027` live). The schema now accepts the empty object and
  publishes no games-played rows for it. Malformed games-played rows still fail. This removed the last
  decoder rejection from `rosters.forLeagues`: all five leagues parse.
- **Roster scope.** The aggregate `users;use_login` path returns one team per league: the signed-in
  manager's team. A root `leagues;league_keys=…/teams;out=roster` request returns every team in those
  leagues (12, 12, 13, 10, and 10 live), but the five-league response is 19,524,288 bytes against the
  SDK's 4,194,304-byte read bound. One league is 3,520,383 bytes and fits, so full-league rosters remain
  a per-league read. `packages/yahoo-sdk/README.md` and `docs/design.md` publish that limitation, and
  `rosters.forLeagues` stays out of the adapter's path.
- **Roster fields.** On the one team the aggregate returns, every published roster field agrees
  exactly. Three fields differ only because the aggregate request asks for more than the adapter's
  `teams;out=roster` request: `opponent`/`scheduled` and `transactionTrend` are present in the SDK
  parse and absent or `not_published` in the adapter's answer. `pendingTransactions` and `gamesPlayed`
  are parsed by the SDK and have no port field.
- **Search.** The aggregate returns ten players per league; limit and ordering semantics match the
  per-league read, and every published field agrees. The SDK summary carries the live
  `editorial_team_key` as `proTeamKey`, beside the abbreviation. It also carries `opponent`,
  `startingStatus`, `ranks`, `stats`, and `ownershipType`, which the port's search result does not
  publish; those are extra answers, not value disagreements.
- **Discover.** The aggregate returns the same single team per league as `discoverTeams`, plus league
  settings, team standings, managers, and logos. It has zero comparable field differences; the
  adapter-only `provider`, `league`, and `sport` values come from the registry and from `gameKey`.

Verdict at the time of that probe: `leagues.discover` and `players.search` were ready to migrate.
Both are now migrated, with the measurement below. `rosters.forLeagues` is not ready and stays a
per-league read, because the provider can return every team only in a response that exceeds the SDK's
read bound.

### Discovery and search migration measurement

`e2e/scratch/sdk-aggregate-check/check.ts` reads the owner's stored connection, runs the adapter's own
`discoverTeams` and per-league `searchPlayers` three times each, and records the provider request
count and wall time beside every published row. It ran immediately before the migration and again
after it, against the same five leagues: football `470.l.70271` and hockey `477.l.14882`,
`477.l.31027`, `477.l.5744`, and `477.l.58487`. It performs GETs only.

| Port read       | Operation          | Requests before | Requests after | Median wall time before | Median wall time after |
| --------------- | ------------------ | --------------: | -------------: | ----------------------: | ---------------------: |
| `discoverTeams` | `leagues.discover` |               7 |              1 |                1,709 ms |                 311 ms |
| `searchPlayers` | `players.search`   |               1 |              1 |       356–491 ms/league |      424–453 ms/league |

Discovery's seven requests were two per-game team reads plus one settings read for each of the five
leagues, so every league also cost a settings request; the aggregate publishes each league name beside
its teams, and the single shared read covers all five. Search was already one request per league; it
keeps that count and reads the aggregate player collection instead of the league-scoped collection.
Both reports used the same search parameters: all availability, ownership order, limit 10, no query.

Search wall time by league, before and after: `470.l.70271` 371 → 452 ms, `477.l.14882` 412 → 424 ms,
`477.l.31027` 356 → 451 ms, `477.l.5744` 491 → 453 ms, and `477.l.58487` 365 → 442 ms.

Parity was measured from the published rows, not asserted from the request count. Stable-key
comparison of the before and after reports finds identical discovery rows for all five leagues — team
keys, names, seasons, league names, and team page URLs — and identical search rows for all five,
including their order and every published field: `proTeamKey`, percentages and deltas, both ranks,
stat value, status code and detail, and transaction trend.

What changes at the edges, stated rather than invented:

- Discovery now always publishes `leagueName` from the aggregate answer. The old read omitted it when
  that league's settings read failed while still publishing its teams; a malformed league now fails
  the whole discovery as `provider.response_invalid` instead of publishing teams without a name.
- Discovery publishes the games in `nfl`-then-`nhl` order as before, and the teams within a league in
  the provider's order.
- The SDK decodes a team key in Yahoo's numeric form and a present team URL as `https`. A payload
  whose team key is malformed, or whose team URL is not `https`, now fails discovery as an invalid
  response where the old decoder accepted the key or synthesized the URL. No recorded live payload
  exercises either shape.
- An unrequested game key in a discovery answer is `provider.response_invalid` with field
  `games.code`; the old adapter named the same failure `game.code`. The failure kind is unchanged.
- A search answer with no group for the requested league, or with a league that was not requested, is
  `provider.response_invalid` with field `league.league_key`. The old read reported that kind for a
  mismatched league and a schema failure for a missing one. The aggregate collection is scoped to the
  signed-in manager's leagues, so a league the session does not own has no group and is refused this
  way; every product search resolves through a team the session owns.
- The aggregate search rows also carry `opponent`, `startingStatus`, `ranks`, `stats`, and
  `ownershipType`, which the port does not publish. No value the port does publish is omitted.
