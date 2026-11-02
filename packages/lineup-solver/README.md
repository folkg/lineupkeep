# @lineupkeep/lineup-solver

Provider-neutral, pure lineup optimization for Lineupkeep. Given the league's roster slots, the retained roster, signed scores for one period, an ordered ladder of availability tiers, and the provider's locks, the solver returns either a legal lineup plan or a named refusal.

This package contains no IO, provider code, database, worker, HTTP, clock, randomness, or Effect services. The caller owns the provider period, the scores it publishes, and the eventual provider write contract.

## Boundary

The package starts after the provider and the generic planner have decided what to compare. It does not read a provider, does not fetch projections, does not decide whether a player is injured, does not know which availability tier an injury code deserves, and does not decide how to represent missing evidence. The ladder's rungs and their order arrive with the problem; the provider selects each player's rung, and the meaning of each rung stays there.

The pure contract is:

1. The caller supplies a `LineupProblem` for one period.
2. `solveLineup` returns a `LineupPlan` or a `LineupRefusal`.
3. The caller can independently re-check the result with `planViolations`, `isLegalPlan`, `lineupViolations`, and `isLegalLineup`.

## The problem

A problem is the league's slots, the retained roster, one selection basis, and one ordered availability
ladder.

```ts
type LineupProblem = {
  readonly selectionBasis: SelectionBasis;
  readonly availabilityTiers: ReadonlyArray<AvailabilityTier>;
  readonly slots: ReadonlyArray<RosterSlot>;
  readonly players: ReadonlyArray<RosterPlayer>;
};
```

`availabilityTiers` is ordered from most available to least available and must contain at least one
distinct non-empty tier. `makeAvailabilityTier` brands a rung; the ladder carries its own order, so
a caller cannot express "above" or "below" out of band.

A slot is a starting position, a bench area, or a reserve-list area. Each has a positive capacity and an eligibility rule. A starting slot is either required or optional.

```ts
type StartingSlot = {
  readonly kind: "starting";
  readonly id: SlotId;
  readonly capacity: number;
  readonly requirement: "required" | "optional";
  readonly eligibility: SlotEligibility;
};
```

A player has the positions they may occupy, one availability tier for this period, one signed
selection value, whether the reserve list accepts them, an optional provider lock, the slot they
currently occupy, and whether the caller permits leaving them in place.

```ts
type RosterPlayer = {
  readonly id: PlayerId;
  readonly eligiblePositions: ReadonlyArray<PositionType>;
  readonly availabilityTier: AvailabilityTier;
  readonly selection: PlayerSelection;
  readonly reserveEligible: boolean;
  readonly lockedSlotId: SlotId | undefined;
  readonly currentSlotId: SlotId | undefined;
  readonly mayBeLeftInPlace?: boolean;
};
```

`availabilityTier` must be one of the declared `availabilityTiers`. A tier is not a modifier on a
value: the value means the same thing in every tier, and the tier only says how likely the player is
to appear. A problem that declares no tiers, declares one twice, or has a player on an undeclared tier
throws; those are caller contract failures.

`selection` is either a known signed integer or an explicit unusable value:

```ts
type PlayerSelection =
  | { readonly kind: "known"; readonly basis: SelectionBasis; readonly units: number }
  | {
      readonly kind: "unusable";
      readonly basis: SelectionBasis;
      readonly reason: "missing" | "not-comparable";
    };
```

Selection values are relative benefits, not projections. They are comparable only within the problem's one `selectionBasis`, such as the one score set a provider published for one period. The solver rejects a problem whose players carry a different basis. `units` is a safe integer so the optimization stays exact and tie-breaks cannot be overturned by floating-point noise.

The player list is the retained roster. There is no drop or add action in this package. A player is
either assigned to exactly one slot or left in place. Only a player the caller marks
`mayBeLeftInPlace` may be left, and the solver leaves the fewest such players it can. A player with no
legal destination and no permission to remain produces a refusal rather than being omitted.

### Position eligibility

`SlotEligibility` is either open to every position or limited to a set:

```ts
type SlotEligibility =
  | { readonly kind: "any" }
  | { readonly kind: "positions"; readonly positions: ReadonlyArray<PositionType> };
```

A player may occupy a slot when the slot accepts at least one of the player's eligible positions. Reserve slots additionally require `reserveEligible`. Bench slots commonly use `{ kind: "any" }`, but a league that restricts bench space can express that restriction here.

### Pooled standard-roster capacity

The solver treats every declared slot capacity as a hard maximum. When a provider shares one standard-roster allowance between starting positions and the bench instead of enforcing the advertised bench count, model that allowance as bench capacity (or split it across bench slots) so that total slot capacity equals the shared pool plus the reserve area. The retention invariant then prevents inventing roster space for a player who has no legal area.

### Locks and current assignments

A lock names one slot. The player may not be placed anywhere else. Several players may lock to the same slot only within that slot's capacity. A lock reserves those units before the solver places anyone else, so a non-locked player cannot consume a locked unit.

`currentSlotId` is used for two purposes: the plan's comparison against the current lineup, and the minimum-change tie-break. The current lineup may itself be illegal; the solver does not refuse merely because the current slot breaches capacity, position eligibility, or a lock. It produces a legal plan and reports the changes.

## The plan

```ts
type LineupPlan = {
  readonly selectionBasis: SelectionBasis;
  readonly assignments: ReadonlyArray<LineupAssignment>;
  readonly leftInPlace: ReadonlyArray<PlayerId>;
  readonly totalSelectionValue: number;
  readonly filledStartingPositions: number;
  readonly requiredStartingPositions: number;
  readonly comparison: LineupComparison;
};
```

`assignments` contains every assigned roster player exactly once, and `leftInPlace` contains every
other roster player exactly once. The two lists are disjoint and together cover the roster. A player is
left in place only when the caller marks them `mayBeLeftInPlace`, and their current slot stays occupied:
the solver reserves one unit of that slot for them, so nobody else is moved into it. A player whose
`currentSlotId` is absent consumes no modelled capacity.

Assigning two players to one slot is legal up to that slot's capacity. The comparison treats a
left-in-place player as unchanged and names players entering and leaving starting positions and every
assigned player whose slot ID changes.

## Objective

The optimization is lexicographic, in this order:

1. **Required starting positions are filled.** Every unit of a required starting slot must be occupied. This is a hard legality condition, not a soft score. If required positions cannot all be filled, the solver refuses. A required position is never traded away for value.
2. **The fewest players are left in place.** A plan that leaves nobody always beats a plan that leaves somebody, whatever the values. Among plans that leave the same number, the ones below decide.
3. **Availability is maximized, most available tier first.** For each tier in the declared ladder order, maximize the number of starting positions occupied by players of that tier. The higher tier's count is compared first, so no amount of value below it can overturn it.
4. **Total selection value is maximized.** The sum covers players assigned to starting positions, across every tier. Bench and reserve assignments contribute zero. Only required slots must be filled; optional starting slots may be left empty.

A starter counts towards their tier's term only when their selection value is not negative. A player
below zero is worse than an empty optional position, so they are not credited for occupying it; zero is
not negative, so a genuine zero still counts.

The first item is a documented decision about unfilled starting positions: a required position is never left empty, because a plan that violates a league requirement is not a legal plan. An optional position may be left empty, and is left empty when filling it would lower total value. A slot whose capacity is only partly required should be modeled as two slots, one required and one optional.

A negative selection value is worse than leaving an optional starting position empty when the player can be retained on the bench or reserve list. If the player cannot be retained elsewhere, filling the optional position is forced by the retention invariant; refusing would drop a roster member.

Zero is a known value. It is not an unknown value and it is not a sentinel. It counts towards the
player's tier, and among plans with equal total value the solver prefers starting an eligible
zero-valued player in an otherwise empty optional starting position.

Availability outranks value between tiers and never modifies it inside one. Two available players
compete on value; an available player competes with a doubtful or unavailable one on tier alone, so a
healthy player worth nothing starts ahead of an injured player worth everything. An unavailable player
can still fill a position that would otherwise stay empty, which is the case for a player who might
come back as a game-time decision.

### Unusable selection values

An unusable value is never treated as zero and never treated as a positive or negative number. A player who has one is never assigned to a starting slot; the solver benches them, or parks them in a reserve slot, and the plan is returned.

`solveLineup` refuses with `unusable-selection-value` when benching is not a resolution: the player has no legal bench or reserve slot, or they are the only player who could occupy a required starting slot. The refusal names those players so the caller can resolve the value or make an explicit fallback decision.

### Tie-breaks

Only the objective items above can change the value of a plan. Everything below is a tie-break among plans that already have the best objective values.

1. More zero-valued starting occupancy.
2. Fewer players moved from their `currentSlotId`.
3. The lexicographically smallest sequence of slot-unit indices in player-ID order; slot units follow slot-ID order, with reserved units before open units inside a slot.

The third tie-break is total: every distinct player-to-unit assignment has a distinct canonical cost, so there is no residual choice for the pinned assignment library to make. The slot ID exposed in the plan hides the unit distinction; two plans that move players between identical units of the same slot ID are the same semantic assignment.

Slot IDs are semantic. If two positions are interchangeable, model them as one slot with capacity above one. Moving a player from one unit to another unit of the same slot ID is not a change.

## Exact algorithm

The solver reduces the problem to a square minimum-cost assignment.

1. Expand every slot into one column per capacity unit. A slot with `k` locked players contributes `k` reserved units followed by `capacity - k` open units.
2. Add one row per player. Add `totalUnits - playerCount` dummy rows for unused capacity.
3. Add a legal edge from a player to a unit when the player may occupy that unit's slot. A locked player can use only their slot's reserved units. A non-locked player can use only open units. Reserve eligibility and position eligibility apply to every edge.
4. Add a **retention edge** for a player marked `mayBeLeftInPlace` to each available unit of their current slot when that slot does not accept them and leaving them there is allowed. A retention edge keeps them out of `assignments`, puts them in `leftInPlace`, and consumes the unit so nobody else can take it. Retention is not allowed for a required starting slot.
5. A dummy row represents an empty unit. Dummies may fill open optional starting units and open bench or reserve units. They may not fill reserved units or any unit of a required starting slot.
6. Run the exact minimum-cost assignment on the square matrix.

A perfect matching in this matrix is exactly a legal plan: every player is assigned or left in place, slot capacities are respected, every required starting unit is occupied, locks are honoured, and every roster member is retained. A legal plan exists exactly when a perfect matching using no forbidden edge exists. If every perfect matching needs a forbidden edge, the problem is infeasible.

A player marked `mayBeLeftInPlace` with no `currentSlotId` has no modelled occupancy to reserve, so
the solver may leave them without consuming a unit. That covers a provider slot the league model does
not declare.

### Lexicographic cost encoding

All costs are `bigint`. For a plan, the cost is:

```text
(retainedCount) * retainWeight
+ sum over tiers of (-tierStartingCount) * tierWeight[tier]
+ (-totalSelectionValue) * valueWeight
+ (-zeroStartingOccupancy) * occupancyWeight
+ (changedPlayerCount) * changeWeight
+ canonicalCost
```

A `tierStartingCount` is the number of starting players in that tier whose value is not negative.
The weights are computed from the problem and satisfy, from the least significant term upwards:

```text
changeWeight     > maximum possible canonical difference
occupancyWeight  > maximum change difference + canonical difference
valueWeight      > maximum occupancy difference + change difference + canonical difference
tierWeight[last] > maximum value difference + occupancy + change + canonical difference
tierWeight[t]    > unitCount * tierWeight[t + 1] + (everything below tierWeight[t + 1])
```

`retainWeight` is larger than the entire range of the rest of a plan, so one fewer left-in-place player
always wins. The tier weights are built from the bottom of the ladder upwards, each one larger than
every term it must outrank, so one more available starter always costs less than the whole rest of the
plan can recover. Availability dominance is therefore exact rather than a large penalty: a single rung
moved outweighs the largest possible value, occupancy, change, and canonical difference combined. A
retention edge contributes `retainWeight` and its canonical cost, with no value, availability, or change
term, because the player is not starting and does not move.

`canonicalCost` is the base-`(unitCount + 1)` number whose digits are the unit indices assigned to players in player-ID order. The base is larger than every unit index, so minimizing the sum is exactly lexicographic minimization of that digit sequence.

Forbidden edges use a finite cost larger than any legal assignment:

```text
legalCellBound = maxAbsValue * valueWeight
               + sum of every tierWeight
               + occupancyWeight + changeWeight + canonicalMax
forbiddenCost  = legalCellBound * 2 * unitCount + 1
```

Any assignment with one forbidden edge costs more than the largest possible legal assignment. There is no arbitrary infinity and no epsilon. If the minimum-cost assignment still contains a forbidden edge, no legal perfect matching exists.

This is a maximum-weight bipartite assignment with capacities and eligibility, solved exactly. It is not greedy and not heuristic. The cost encoding is a proved bounded lexicographic encoding, not a stack of large penalties.

### Assignment library

The matrix is solved with [`munkres`](https://github.com/havelessbemore/munkres) `2.1.1`, pinned exactly.

The bounded dependency audit:

- MIT license, zero runtime dependencies, TypeScript types, ESM and CommonJS builds.
- Supports rectangular and square matrices and an exact `bigint` path.
- The published package is small and the inspected source is a direct implementation of the Munkres/Hungarian assignment algorithm.
- Its upstream test suite includes brute-force and property tests; the package is used only for the mathematical assignment step.
- The solver independently verifies every returned edge, rebuilds the plan, and re-checks all invariants. A forbidden edge is never reported as a legal plan.

The package does not import provider, database, worker, HTTP, Effect service, or clock code.

## Refusals

A refusal is a value with a specific subject, not a thrown string.

| Reason                                  | Meaning                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `unusable-selection-value`              | One or more players have no usable selection value and cannot be benched away from a starting slot.                             |
| `lock-references-unknown-slot`          | A player is locked to a slot that is not in the problem.                                                                        |
| `locked-player-ineligible-for-slot`     | A locked player's position or reserve eligibility excludes the locked slot.                                                     |
| `lock-capacity-exceeded`                | More players are locked to a slot than its capacity.                                                                            |
| `roster-exceeds-slot-capacity`          | The retained roster is larger than the total slot capacity.                                                                     |
| `player-has-no-legal-slot`              | One or more players have no legal destination and no permitted retention. This is also the "player cannot be retained" refusal. |
| `required-starting-position-unfillable` | A required starting slot cannot be fully occupied in a complete legal assignment.                                               |
| `no-legal-assignment`                   | A complete legal assignment does not exist for a less specific conflict; the refusal names the players and slots involved.      |

Malformed problems — duplicate IDs, non-positive capacity, unsafe selection units, a different selection basis, no availability tier, a duplicate tier, a player on an undeclared tier, or a current slot not present in the problem — throw an error. They are caller contract failures, not league-feasibility refusals.

## Invariants

`lineupViolations` and `planViolations` are pure checks shared by the solver, callers, and tests. A returned plan satisfies all of them:

- Every roster player appears exactly once, assigned or left in place; no player is invented or dropped.
- A player left in place carries `mayBeLeftInPlace`, and their current slot keeps its occupancy when they have one.
- Every assignment references a known player and a known slot.
- Slot capacity is respected.
- Position eligibility, reserve eligibility, and locks are respected.
- Every required starting slot is fully occupied.
- No starting assignment uses an unusable selection value.
- The plan's `totalSelectionValue` equals the value recomputed from its own assignments.
- The plan's `filledStartingPositions` equals the count recomputed from its own assignments.

## Worked example (NFL-shaped, synthetic)

Slots: one required QB, two required RB, one optional RB/WR flex, three bench.

| Player | Selection units | Tier      | Current | Note |
| ------ | --------------: | --------- | ------- | ---- |
| qb1    |             120 | will-play | QB      |      |
| rb1    |             100 | will-play | RB      |      |
| rb2    |              90 | will-play | FLEX    |      |
| wr1    |              80 | will-play | BN      |      |
| wr2    |             -10 | will-play | BN      |      |

The required slots are QB, RB, RB; the flex is optional. The best value is 390: qb1 at QB, rb1 and rb2 at RB, wr1 at FLEX, wr2 on the bench. Starting wr2 in the flex would lower the value, so the flex stays occupied by wr1 and the negative player stays benched. The plan reports the rb2 move from FLEX to RB and the wr1 move from bench to FLEX.

If the flex slot were required instead, the best legal plan would still start wr1 there because wr1's value is positive. If wr2 were the only player left for a required flex, the solver would start wr2 and report a negative total value rather than dropping the player.

Give wr2 a `will-not-play` tier and nothing changes here, because wr1 is available and worth more. Give
wr2 the higher value of 200 instead and wr1 still starts in the flex: wr1 counts towards `will-play`
and wr2 counts towards `will-not-play`, and the higher rung is decided first. Bench wr1 entirely and
wr2 takes the flex, because a filled position still beats an empty one.

## Deliberately outside this package

- The provider that produces final scores and selects availability tiers, including which provider fact becomes which rung, which measurement it trusts, and how it constructs a score.
- Provider-specific explicit assignment requests, readback, and recovery.
- Provider period freshness, lock revalidation, and live provider evidence.
- Database, worker, HTTP, MCP, clock, and persistence.
- Multi-period planning, transactions, add/drop, category-outcome optimization, and player pins.

## Verification

The test suite contains worked examples, refusal cases, invariant checks, generated properties, and an independent exhaustive oracle. The oracle enumerates every legal complete assignment for tiny problems, computes the objective tuple directly, and does not use the solver's feasibility helpers. It checks the solver's plan with its own legality rules as well as the public invariant predicates.

Current generated-oracle evidence: 10,000 tiny problems per test run across duplicate values, all-equal values, all-eligible and no-eligible shapes, capacities above the roster, locks, negative values, zeros, required and optional positions, bench/reserve constraints, mixed tiers, all-unavailable rosters, and tiers set against values so the best player is unavailable. The oracle compares the full objective tuple — every tier count, then total value, then zero occupancy, then changes, then the canonical assignment — so agreement is proved for the changed objective rather than assumed.

Measured solver time on this development machine (Node 24, `node --experimental-strip-types`, 30 runs after warm-up):

| Shape            |           Slot definitions | Units |  Median |     Min |      Max |
| ---------------- | -------------------------: | ----: | ------: | ------: | -------: |
| 30-player roster | 20 (10 starting, 10 bench) |    40 | 0.66 ms | 0.51 ms |  1.58 ms |
| 60-player roster | 40 (20 starting, 20 bench) |    80 | 4.54 ms | 3.73 ms | 32.66 ms |
| 60-player roster | 40 (20 starting, 20 bench) |    60 | 2.73 ms | 2.23 ms |  4.54 ms |

No shape in the tested model has uncertain optimality: the reduction is exact for the stated problem, and the forbidden-edge bound is a proof of infeasibility rather than a guess.
