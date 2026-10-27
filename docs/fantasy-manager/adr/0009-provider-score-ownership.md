# A provider publishes a final score, not a scoring policy

## Context

[ADR 0007](0007-provider-registry-and-planner-capability.md) moved lineup planning behind the provider,
but the seam it left still carried the shape of one provider's reasoning. A plan crossed the boundary as
`{ assignments, policyVersion, basis }` where `basis` was a constructed string such as
`community-start-rate:overall:date:2026-10-27` or `mean-points-per-period:week:4,week:5,week:6,week:7`.
Those strings were persisted on every run and rendered to a person, so a durable, generic run record
named one provider's measurement vocabulary. `lineup-scoring` and `lineup-policy` lived as top-level
product packages, so "value source", "scoring basis", "community start rate", "cut", and
"observation window" read as product concepts rather than as one provider's private arithmetic. The
capability declaration repeated the same ideas: `publishesCommunityStartRate`, `statBases`, and a
`community_start_rate` limitation subject.

The owner's instruction was direct: a provider should really only expose a final score, and how a
provider constructs that score is its own implementation detail.

## Decision

**The seam carries a result, not a method.**

`ProviderShape.planLineup` returns one of two things:

- `scored` — an opaque provenance label plus, per roster player, one final signed score in the
  provider's own unit (`null` when the provider publishes none) and the availability tier that
  player sits on;
- `refused` — the structural-or-transient kind, the same opaque label, and a human-readable detail.

Nothing else crosses. No projections, realised statistics, crowd shares, cuts, ranks, legend strings,
period windows, or "which source won" vocabulary. A refusal carries no scoring vocabulary either; the
label is opaque and the detail is prose for a person.

**The generic layer places players; it does not value them.**

`internal/LineupPlanning.ts` turns the provider's roster and league declarations into the solver's
neutral problem — starting, bench, and reserve slots from declared positions, eligibility from the
provider's own lists, locks from the provider's editability flag, the availability ladder, and each
player's final score — then runs `@lineupkeep/lineup-solver` and translates the plan into changed
assignments. It reads no period, no sport, and no scoring rule. A player with no published score is
`unusable` (`missing`), never zero, and a plan that would move a player through a reserve list is a
transient refusal rather than a provider write.

**Scoring construction moves inside the provider.**

`lineup-scoring` and `lineup-policy` are gone as product packages. Their arithmetic now lives in
`contexts/connections/internal/provider-scoring/`, a module scoped to provider scoring, imported only
by provider adapters. It keeps the exact decimal arithmetic, the league-rule scorer, the three
scoring schemes, the four-period observation window, and the availability-to-tier table. The Yahoo
adapter composes them and publishes final scores; another provider may reuse them, replace them, or
publish a score its own way.

**Run provenance is opaque.**

`LineupPlanProvenance` replaces `LineupPolicyProvenance`. A planned run records `{ kind, label }`; a
provider refusal records `{ kind, label, detail }`. The label is provider-supplied and stored and
displayed verbatim: today `yahoo/community-start-rate:overall:date:2026-10-27` or
`yahoo/mean-points-per-period:week:4,week:5,week:6,week:7`. New runs carry a provider prefix; migrated
rows keep the label they recorded at the time. A migration rewrites existing run state and write
intents from `policy{version, code, basis}` to `provenance{kind, label, detail}` without losing the
recorded scheme.

**The availability ladder and the objective stay generic.**

[ADR 0006](0006-availability-tiers.md) made availability a three-rung ordered dimension that outranks
value, and the solver maximises a lexicographic objective. Both remain product decisions: the ladder
order is declared where the problem is built, the provider selects each player's rung from its own
status facts, and the solver knows only the order. Nothing in this correction weakens either.

**The boundary is enforced twice.**

`.dependency-cruiser.ts` adds `provider-scoring-stays-in-the-adapter` (only provider adapters may
import the scoring module) and `provider-scoring-is-self-contained` (the scoring module may import
neither the application nor Effect, persistence, transport, or the solver). The `repository` lint
plugin adds `provider-scoring-vocabulary`, which rejects a fixed list of scoring identifiers anywhere
outside the provider's own modules. Both have acceptance and rejection fixtures, and the lint rule was
proved against a deliberate violation in the real tree.

## Consequences

- A second provider supplies scores its own way and the worker, contracts, UI, and run records need no
  change. Adding scoring knowledge to generic code is now a visible rule violation, not a habit.
- The value-source ladder survives as the Yahoo adapter's preference order over scoring schemes, with
  one deliberate difference: a scheme whose scores cannot be legally placed now blocks the attempt
  (transient) instead of silently falling through to a weaker scheme. The ladder still falls through
  when a scheme cannot be computed at all, which is the early-season case.
- A run record no longer names a measurement in generic columns, so changing a provider's scoring
  arithmetic is not a schema event. The trade is that a reader sees a provider label rather than a
  product term; the label is still specific enough to identify the scheme and its period.
- The generic test fake declares scores directly instead of reproducing a provider's arithmetic, so
  worker tests no longer depend on scoring packages at all.
- `@lineupkeep/lineup-solver` is unchanged and remains the only lineup package: pure assignment
  mathematics with no provider, period, sport, or scoring knowledge.

## Alternatives rejected

- **Keeping `basis` as a "neutral" string.** It is provider vocabulary in a durable record; renaming
  the field would not stop the next provider's terms from leaking into generic columns.
- **Letting the generic layer keep the value-source ladder.** The ladder is a provider's judgement
  about which of its own measurements to trust, and its rungs exist only because one provider
  publishes those measurements.
- **Having the provider run the solver.** Assignment is generic mathematics; leaving it in the adapter
  would keep the package generic in name only.
- **Dropping the availability tier from the seam.** The generic objective ranks availability above
  score, so it must receive the rung; deriving it generically would put provider status codes back in
  generic code.

## Deferred

- Category- and rotisserie-aware scoring inside the Yahoo adapter. The seam can carry whichever final
  score the provider chooses, including a category portfolio score.
- A second adapter that publishes its own scoring scheme. The seam supports it; nothing depends on it.
- Widened sport vocabulary in the public contracts, unchanged from ADR 0007.
