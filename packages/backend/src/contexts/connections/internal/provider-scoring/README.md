# Provider scoring

How one provider turns its own published evidence into final scores. This module is not a product
concept: it exists so a provider adapter can decide what a player is worth without putting that
decision in generic code.

Only a provider adapter may import it. Generic code receives one final score per player and an opaque
provenance label from `ProviderShape.planLineup`, and places players with
`contexts/connections/internal/LineupPlanning.ts`. Nothing here imports the application, Effect,
persistence, transport, or the solver; the rules for that are
`provider-scoring-stays-in-the-adapter` and `provider-scoring-is-self-contained` in
`.dependency-cruiser.ts`.

## What it contains

| Module                 | Responsibility                                                                   |
| ---------------------- | -------------------------------------------------------------------------------- |
| `Exact.ts`             | Decimal arithmetic with no floating-point drift                                  |
| `ScoringProfile.ts`    | A league's categories and points rules, with the scale its modifiers need        |
| `Scoring.ts`           | One period's statistics scored by those rules, or a named unknown                |
| `Period.ts`            | Weekly and dated periods, their keys, and equality                               |
| `ObservationWindow.ts` | The four-period trailing window                                                  |
| `ValueSource.ts`       | The three scoring schemes and how each yields a value per player                 |
| `Valuation.ts`         | Provider status facts to an availability tier, and exact values to integer units |
| `LineupScore.ts`       | Choose a scheme, then produce one final score and tier per player, or a refusal  |

## The schemes

A provider contributes the schemes it can compute for a league; the ladder prefers projections, then
the league's own rules applied to realised statistics, then a published crowd share. The first scheme
that yields values wins, and its label is recorded as provenance. A scheme that cannot be computed at
all is skipped; a provider with no usable scheme refuses structurally, and the worker may fall back to
the provider's own action.

Scores leave here as safe integers in the scheme's own unit. A player without a published value has no
score — never zero — and the generic planner treats that as unusable.

## Deliberately outside this module

- Reading provider endpoints, declaring capabilities, and writing lineups: the adapter's job.
- Placing players into slots, locks, reserve eligibility, and the availability ladder order: generic
  planning decisions ([POLICY.md](../../../../../../../docs/fantasy-manager/POLICY.md)).
- Assignment optimisation: `@lineupkeep/lineup-solver`.
