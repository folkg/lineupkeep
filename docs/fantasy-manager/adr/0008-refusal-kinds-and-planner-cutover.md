# Refusal kinds and the per-team planner cutover

## Context

[ADR 0007](0007-provider-registry-and-planner-capability.md) made planning a provider capability and made
a refusal a value rather than a defect. It left one thing ambiguous: a refusal only said `action:
"native"` or `action: "block"`, with the adapter deciding the action per code. That is the wrong axis.
The two facts that matter are not "which action do you want" but "could any later attempt succeed".

An earlier Phase 2 cutover attempt missed the distinction and switched every run to the custom planner.
The owner's four hockey leagues publish categories with no scoring rules, so that planner version
refused them, and the worker treated the refusal as terminal: every hockey team blocked instead of
getting the native action the owner actually wanted. The planner has since gained the community start
rate rung, so those leagues plan. The remaining hazard is the same shape at a smaller scale: a
structural "this league can never be valued here" and a transient "not right now" cannot share one
response.

## Decision

**A refusal names its own kind.**

`ProviderLineupOutcome` returns either a plan or a refusal carrying `refusal: "structural" | "transient"`
with a stable code, a human-readable detail, the policy version, and the selection basis when one was
resolved. The worker no longer inspects codes or decides actions per league. It acts on the kind:

- **Structural**: no amount of waiting or retrying makes the provider able to value this league. The
  worker falls back to the provider's own action, and records that the attempt ran the native action
  and why the planner was not used.
- **Transient**: the provider can value this league, but not from the facts available now. The worker
  blocks the attempt with the named reason. The next scheduled tick is the retry; a person can act on a
  roster, lock, period, or provider problem that will not resolve itself.

**Structural is a claim about the league and the provider, never about one read.** Absence in a single
response cannot distinguish "this provider does not publish this" from "this read returned nothing", so
a provider may only claim structural when its own declarations make the measurement impossible — for
example no value source on the ladder, or a declared capability that rules the league out. A league
whose published values are missing is transient: blocking is honest, silently switching to a different
action is not.

The code-to-kind table lives with the codes inside the provider's scoring modules:

| Code                                           | Kind       | Why                                                                |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `policy:no-value-source`                       | structural | No measurement exists for this league at this provider             |
| `policy:no-observed-periods`                   | transient  | History is not there yet; completed periods will exist later       |
| `solver:unusable-selection-value`              | transient  | Published evidence is missing for players on this roster right now |
| `solver:lock-references-unknown-slot`          | transient  | The roster can change; the league's value source is unchanged      |
| `solver:locked-player-ineligible-for-slot`     | transient  | The roster can change; the league's value source is unchanged      |
| `solver:lock-capacity-exceeded`                | transient  | The roster can change; the league's value source is unchanged      |
| `solver:roster-exceeds-slot-capacity`          | transient  | The current roster and declared slots make no legal plan now       |
| `solver:player-has-no-legal-slot`              | transient  | The roster can change; the league's value source is unchanged      |
| `solver:required-starting-position-unfillable` | transient  | A roster change fills the position                                 |
| `solver:no-legal-assignment`                   | transient  | The facts that produced it can change                              |
| `assignment:plan-membership`                   | transient  | The plan translation saw facts it does not cover                   |
| `assignment:locked-player`                     | transient  | The lock clears; the league is still plannable                     |
| `assignment:reserve-slot`                      | transient  | A person can move the player; the operation currently cannot       |

Every transient code is a statement about the current roster, locks, period, or read, not about the
league's value source. That is the whole test: only a structural claim survives "and then what?".

**Runs ask for the custom planner, and the planner decides per team.**

Scheduled and manual runs are stamped with the deployment's active implementation
(`custom_policy`). The worker dispatches on that stamp and calls `provider.planLineup`. Nothing offers
a per-team opt-in, and the worker never reads league settings to guess. The per-team answer comes back
as a plan or a refusal whose kind decides the response.

**Queued intents cross the cutover at claim time.**

A run that has not written anything — queued, retry-waiting without a write intent, or reclaimed after
a lapsed lease — is re-stamped with the active implementation as part of the claim and planned under
it. A run with a write in flight (applying, verifying, or uncertain with an intent) is never re-planned
under a replacement implementation: it resumes readback and reconciliation against the plan it already
recorded. This is the durable shell's existing rule, now applied to the implementation as well as the
policy version.

**The run records what ran.**

The run's own `implementation` and `implementationVersion` name what was requested. The outcome names
what produced the result: `provider_native` with a refusal provenance when a structural refusal fell
back, `custom_policy` with the planned basis when the planner planned, and `custom_policy` with the
refusal provenance when a transient refusal blocked. A later reader can tell the three cases apart
from the run alone, including the code, detail, and basis.

**Rollback changes future execution only.**

Rolling back is flipping `activeLineupImplementation` back to `provider_native` and deploying. Runs
that have not started then execute natively, and a run with a write in flight still reconciles its own
recorded plan. Rollback does not restore historical assignments: a lineup the custom policy already
wrote stays as the provider has it, and rotating a lineup back is a separate, ordinary lineup decision,
not a rollback. A wholesale code revert to a revision that predates custom planning cannot re-stamp
runs queued as `custom_policy`; that revision did not have the claim-time alignment. Drain or accept
those runs before reverting to such a revision.

## Consequences

- A league whose provider publishes no value source gets the native action every time, with the reason
  recorded, instead of a permanent block or a silent switch.
- A transient refusal is a visible, actionable block. The cost is that a provider outage that empties
  every published value looks like "some roster players have no usable value" until someone
  investigates; the alternative silently degraded to a different implementation, which is worse.
- The worker has no provider vocabulary and no league heuristics. Adding a provider adds refusal
  reasons and kinds in its adapter.
- Two implementations remain in the worker and the run schema. That is the rollback surface, not a
  feature.
- The queued-intent rule makes a deployment mid-flight safe for fresh work and honest for in-flight
  work, at the cost of a claim-time write that changes two fields on runs that never started.

## Alternatives rejected

- **Keeping `action: "native" | "block"`.** It describes the response rather than the fact, so two
  adapters could disagree about the same situation, and a worker could not check the claim.
- **Classifying the reasons in the worker.** It reintroduces provider/policy vocabulary into generic
  code and makes a new refusal code a worker edit.
- **Treating any refusal as a fallback.** The precise failure the owner reverted: transient facts would
  silently run a different algorithm with no record worth reading.
- **Treating any refusal as a block.** A league that can never be valued would never get a lineup.
- **Re-planning in-flight runs on the active implementation.** Two implementations could both write
  for one attempt, and a readback would be compared with a plan nobody sent.
- **A per-team opt-in flag.** It moves a policy decision onto the owner and leaves the capability
  question unanswered.

## Deferred

- Category-aware and rotisserie objectives. A category league valued by the community start rate is
  ordered by a crowd signal, not by category contribution; the cutover does not pretend otherwise.
- Reading a provider's confirmed-starter or has-a-game facts into availability. They would refine
  selection, not the value basis, and are not part of this cutover.
- A provider that publishes usable projections. Its rung is implemented and unselected by Yahoo.
