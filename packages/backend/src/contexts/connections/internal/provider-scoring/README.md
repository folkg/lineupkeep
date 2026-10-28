# Provider scoring

How one provider turns its own published evidence into final scores. This module is not a product
concept: it exists so a provider adapter can decide what a player is worth without putting that
decision in generic code.

Only a provider adapter may import it. Generic code receives one final score per player and an opaque
provenance label from `ProviderShape.scoreRoster`, and places players with
`contexts/connections/internal/LineupPlanning.ts`. Nothing here imports the application, Effect,
persistence, transport, or the solver; the rules for that are
`provider-scoring-stays-in-the-adapter` and `provider-scoring-is-self-contained` in
`.dependency-cruiser.ts`.

## What it contains

| Module                 | Responsibility                                                                    |
| ---------------------- | --------------------------------------------------------------------------------- |
| `Exact.ts`             | Decimal arithmetic with no floating-point drift                                   |
| `ScoringProfile.ts`    | A league's categories and points rules, with the scale its modifiers need         |
| `Scoring.ts`           | One period's statistics scored by those rules, or no complete score               |
| `Period.ts`            | Weekly and dated periods, their keys, and equality                                |
| `ObservationWindow.ts` | The four-period trailing window                                                   |
| `ValueSource.ts`       | The scoring schemes and how each yields integer units per player                  |
| `Valuation.ts`         | Provider status facts to one availability tier, and exact values to integer units |
| `LineupScore.ts`       | Choose a scheme, then produce one final score and tier per player, or a refusal   |

## The schemes

A provider contributes the schemes it can compute for a league. The ladder prefers projections, then
the league's own rules applied to realised statistics, then the ownership composite for a league with a
per-position games limit, then a published crowd share. The first supplied scheme that can be computed
wins, and its label is recorded as provenance. A scheme that cannot be computed at all is skipped; a
present scheme never falls through per player, so a missing value is unusable rather than a reason to
try a weaker scheme. A provider with no usable scheme refuses structurally, and the worker may fall
back to the provider's own action.

Scores leave here as safe integers in the scheme's own unit. A player without a published value has no
score — never zero — and the generic planner treats that as unusable. Only the final score, the
availability tier, and the opaque provenance label cross the seam; the observations, counted periods,
cuts, and ranks that produced them stay here.

## Deliberately outside this module

- Reading provider endpoints, declaring capabilities, and writing lineups: the adapter's job.
- Placing players into slots, locks, reserve eligibility, and the availability ladder order: generic
  planning decisions ([POLICY.md](../../../../../../../docs/fantasy-manager/POLICY.md)).
- Assignment optimisation: `@lineupkeep/lineup-solver`.
