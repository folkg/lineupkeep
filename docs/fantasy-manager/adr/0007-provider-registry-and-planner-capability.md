# Provider registry, declared capabilities, and a provider-supplied planner

> Partly superseded by [ADR 0009](0009-provider-score-ownership.md): the plan no longer crosses the
> seam as assignments plus a scoring `basis`, capabilities no longer declare a community start rate or
> statistic bases, and `@lineupkeep/lineup-policy` and `@lineupkeep/lineup-scoring` are now provider
> scoring modules. The registry, provider key, declared-capability, and composition-root decisions
> here still hold.

## Context

[ADR 0001](0001-provider-neutral-product.md) made the product provider-neutral and kept Yahoo's
authentication, decoding, rules, and action mechanics inside its adapter. The implementation had not
caught up. The generic lineup worker imported eleven Yahoo planning symbols, including the value-source
ladder, the points and started policy inputs, the assignment request, the observation window, and the
refusal vocabulary. It also carried a sport-specific refusal for leagues whose roster is dated. The
generic seam named `yahoo` in its persisted schema and its operation names, the fantasy-day policy was
a hardcoded Yahoo midnight, the query contract repeated Yahoo prose and offered a `percent-started`
value source, and generic layers selected Yahoo behavior by matching provider names.

The owner's correction was explicit: no Yahoo-specific code or branches may remain in the generic
lineup worker; providers are injected as a keyed map conforming to one provider-agnostic interface;
the worker chooses an implementation from the team's provider key; nothing outside Yahoo's own modules
may import them, except the wiring that injects the map. The projections defect had the same root — a
value source that could not be selected ended the Effect with `Effect.die` instead of refusing with a
named reason.

## Decision

**One provider shape, resolved through an injected registry.**

1. `ProviderShape` is the whole provider contract: session validation, discovery, league/roster/player/
   matchup/transaction/standings reads, native and explicit writes, review links, declared capabilities,
   and a roster scoring capability. It is a plain object of Effect-returning methods.
2. `ProviderKey` is a branded, provider-neutral identifier. Stored teams, connections, and requests carry
   the key, never a closed provider literal.
3. `ProviderRegistry` maps keys to provider shapes. Generic code resolves the provider from the team's
   stored key. The registry is the only way a provider enters the application.
4. `runtime/ApplicationLayer.ts` is the only module that imports a provider adapter. Adding a provider is
   a new adapter module plus one entry in the registry map; no generic module changes.

**Capabilities are declared facts, not inferred brand behavior.**

Each provider reports its fantasy-day policy, supported sports, player-search sorts, which sorts it
orders itself, which sports publish weekly statistic series, whether it publishes projections, and
named limitations (for example a sport without a point-total sort, lock timing, or historical
seasons). Generic layers render and enforce those facts. They do not contain provider prose, provider
names, or per-provider branches. How a provider constructs a score is not a declared capability.

**Planning is a provider capability; the worker stays generic.**

`provider.scoreRoster(request)` receives neutral inputs — session material, provider team and league
keys, sport, league settings, roster, and target — and returns one final score and availability tier
per roster player with an opaque provenance label, or a named refusal whose kind is `structural` or
`transient`. The generic planner turns those scores into explicit assignments.

The worker keeps everything that is not provider judgement: the durable run machine, per-team
serialization, observation, write intents, sending and readback, reconciliation, outcomes, retries, and
the native fallback when a refusal allows it. It knows no value sources, scoring periods, sports, sports
rules, roster shapes, or provider vocabulary.

**A fallback ladder, not a fatal branch.**

The value-source ladder lives inside the provider's scoring modules: the league's rules, then the
ownership composite for a games-limited league, then the published crowd share, then a named refusal.
Providers supply the candidate inputs they can compute. Choosing a source is a fallback chain over
data conditions inside the adapter, not an Effect defect. A refusal is returned as data with an opaque
label and a human-readable detail.

**The boundary is enforced, not documented.**

A dependency-cruiser rule forbids imports of a provider adapter from anywhere except the adapter's own
directory and the composition root, with acceptance and rejection fixtures. The rule is proved against
a deliberate generic-to-Yahoo import in the architecture test suite.

## Consequences

- Adding a provider touches one adapter directory, one registry entry, and provider presentation labels;
  generic services, contracts, worker, and UI copy stay unchanged.
- Provider-specific rules and vocabulary are auditable in one place. The
  [provider boundary audit](../PROVIDER-BOUNDARY-AUDIT.md) records every leak found, its disposition,
  and the few provider-specific facts that legitimately remain outside the adapter.
- Generic layers can no longer be tempted to special-case a provider: a closed provider literal or a
  provider name in a generic schema is now a visible regression rather than a habit.
- A provider now owns the decision of what scores it can publish, so a provider without usable
  scoring evidence refuses with its own named reason instead of the worker guessing.
- The worker test double must implement the planner capability, which keeps the test seam as wide as
  the production seam.
- Declared capabilities are data. A provider that declares a sort or a value source it cannot honour
  produces a runtime refusal, not a compile-time error.

## Alternatives rejected

- **A union of provider types in the worker.** It reproduces the coupling under a different name and
  makes every new provider an edit to generic code.
- **A registry keyed by sport.** Sports do not own behavior; providers and leagues do, and several
  providers may serve one sport.
- **Keeping presentation prose in generic contracts.** Prose is a capability statement; it belongs to
  the provider that can vouch for it.
- **Treating an unselectable value source as a defect.** Normal data conditions — no scoring rules,
  no games limit, no community rate — are refusals with remedies, not crashes.

## Deferred

- Widening the product's sport and league-code vocabulary beyond football and hockey. The seam now takes
  provider-declared sports and free-form league codes at the persistence edge, but the public contracts
  and UI still name the two live sports; widening waits for a provider that publishes another sport.
- A provider that publishes usable projections decides how to use them inside its own scoring module;
  the seam carries only the final score. Yahoo publishes none, so its scoring never uses them.
- Runtime plugin loading, provider capability negotiation over a network, and third-party adapters. The
  registry is static composition, not a plugin system.
