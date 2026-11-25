import { EffectString } from "@lineupkeep/collections";
import {
  Array as EffectArray,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { Option as EffectOption } from "effect";
import { SecureRandom } from "effect/crypto";

import type { UserId } from "#contexts/auth/User.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import { PlayerRef } from "#contexts/connections/QueryValues.ts";
import {
  exclusivePlace,
  rosterOccupancy,
  rosterRuleOf,
} from "#contexts/connections/RosterSlots.ts";
import type { RosterRule } from "#contexts/connections/RosterSlots.ts";
import {
  TransactionPlanFactsUnavailable,
  TransactionPlanMoveNotFound,
  TransactionPlanPersistenceFailed,
  TransactionPlanRunInProgress,
  TransactionPlanService,
  TransactionPlanTeamNotFound,
  TransactionRunId as TransactionRunIdSchema,
  isOpenMove,
} from "#contexts/connections/TransactionPlans.ts";
import type {
  StoredMoveClaim,
  StoredMoveAttempt,
  StoredMoveIntent,
  StoredMovePick,
  StoredMovePlacement,
  StoredMovePlayer,
  StoredMoveSlot,
  TransactionDecision,
  TransactionDecisionActor,
  TransactionMoveCursor,
  TransactionMoveId,
  TransactionMoveKind,
  TransactionMoveList,
  TransactionMoveListInput,
  TransactionMovePageLimit,
  TransactionMovePhase,
  TransactionMoveProvenance,
  TransactionMoveReadState,
  TransactionMoveResult,
  TransactionPlanConfirmation,
  TransactionPlanConfirmInput,
  TransactionPlanCountsInput,
  TransactionPlanDiscardGroupInput,
  TransactionPlanDiscardInput,
  TransactionPlanEditInput,
  TransactionPlanFixInput,
  TransactionPlanMoveDraft,
  TransactionPlanMoveView,
  TransactionPlanProposeInput,
  TransactionPlanRead,
  TransactionPlanReadInput,
  TransactionPlanRefMoveDraft,
  TransactionPlanResult,
  TransactionPlanRefProposeInput,
  TransactionPlanRefusal,
  TransactionPlanRetry,
  TransactionPlanRetryInput,
  TransactionPlanRunCounts,
  TransactionPlanRunRefusal,
  TransactionPlanSnapshot,
  TransactionPlanSaveInput,
  TransactionPlanServiceError,
  TransactionPlanSubmission,
  TransactionPlanSubmitInput,
  TransactionPlanView,
  TransactionRunId,
  TransactionRunRecord,
  TransactionTimelineInput,
} from "#contexts/connections/TransactionPlans.ts";

import { nextCheckAt } from "./CheckSchedule.ts";
import { planReserveMoves } from "./LineupPlanning.ts";
import { QueryTokens } from "./QueryTokens.ts";
import { verifySettlement } from "./TransactionMoveWorkflow.ts";
import {
  claimTransactionPlanMoves,
  describeTransactionPlanMove,
  evaluateTransactionPlan,
  projectedLegs,
} from "./TransactionPlanEvaluation.ts";
import type {
  TransactionPlanClaimRefusal,
  TransactionPlanEvaluation,
  TransactionPlanMove,
  TransactionPlanMoveEvaluation,
  TransactionPlanRosterPlayer,
  TransactionPlanTeamFacts,
} from "./TransactionPlanEvaluation.ts";
import { rosterFixGroupOf, searchRosterFixes } from "./TransactionPlanFixes.ts";
import type { RosterFixDraft } from "./TransactionPlanFixes.ts";
import { planGroupReads } from "./TransactionPlanGroups.ts";
import type { TransactionPlanGroupMember } from "./TransactionPlanGroups.ts";
import {
  countTotals,
  moveCursor,
  moveDays,
  moveReadView,
  moveReadViews,
  planDays,
} from "./TransactionPlanRead.ts";
import type { TransactionTeamCheck } from "./TransactionPlanRead.ts";
import {
  StoredMoveDate,
  TransactionMoveId as TransactionMoveIdSchema,
} from "./TransactionPlanRecord.ts";
import type {
  StoredMoveStep,
  TransactionMoveRecord,
  TransactionMoveRowRecord,
  TransactionPlanRecord,
} from "./TransactionPlanRecord.ts";
import type {
  TransactionMoveAppend,
  TransactionMoveContent,
  TransactionMoveSettlement,
  TransactionPlanRef,
} from "./TransactionPlanRepository.ts";
import { TransactionPlanRepository } from "./TransactionPlanRepository.ts";
import { TransactionPlanWrites } from "./TransactionPlanWrites.ts";
import type {
  TransactionPlanAction,
  TransactionPlanWriteRequest,
  TransactionPlanWriteResult,
  TransactionPlanWritesShape,
} from "./TransactionPlanWrites.ts";

function optionalValue<A>(): A | undefined {
  return undefined;
}

function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(value: A, f: (value: A) => B): B;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined {
  return value === undefined || value === null ? undefined : f(value);
}

function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

export {
  TransactionPlanFactsUnavailable,
  TransactionPlanPersistenceFailed,
  TransactionPlanService,
} from "#contexts/connections/TransactionPlans.ts";

const transactionPlanRunStaleMillis = 10 * 60 * 1000;
const transactionPlanTickDecision: TransactionDecision = {
  decidedBy: "system",
  surface: "automation.run",
};
const transactionRunWaitAttempts = 120;
const transactionRunPollMillis = 250;

export type TransactionPlanFactsShape = {
  readonly read: (input: {
    readonly userId: UserId;
    readonly team: TeamId;
    readonly at: DateTime.Utc;
    readonly players: ReadonlyArray<string>;
    readonly needsBudget: boolean;
  }) => Effect.Effect<TransactionPlanTeamFacts, TransactionPlanFactsUnavailable>;
  readonly today: (input: {
    readonly userId: UserId;
    readonly team: TeamId;
    readonly at: DateTime.Utc;
  }) => Effect.Effect<StoredMoveDate, TransactionPlanFactsUnavailable>;
};

export class TransactionPlanFacts extends Context.Service<
  TransactionPlanFacts,
  TransactionPlanFactsShape
>()(
  "@lineupkeep/backend/contexts/connections/internal/TransactionPlanService/TransactionPlanFacts",
) {}

export const TransactionPlanServiceLive = Layer.effect(
  TransactionPlanService,
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const factsPort = yield* TransactionPlanFacts;
    const tokens = yield* QueryTokens;
    const writes = yield* TransactionPlanWrites;
    const random = yield* SecureRandom.SecureRandom;
    const newId = random.ulid;
    const newClaim = random.ulid;
    const newRunId = random.ulid.pipe(
      Effect.flatMap((id) => Schema.decodeEffect(TransactionRunIdSchema)(id).pipe(Effect.orDie)),
    );

    const finishedRun = (
      recorded: TransactionRunRecord,
      attempt: number,
    ): Effect.Effect<TransactionRunRecord, TransactionPlanServiceError> =>
      Effect.gen(function* () {
        if (recorded.finishedAt !== undefined) {
          return recorded;
        }
        if (attempt >= transactionRunWaitAttempts) {
          return yield* TransactionPlanRunInProgress.make({
            team: recorded.team,
            detail: "Another run holds this team's plan, so the repeated submit is still waiting.",
          });
        }
        yield* Effect.sleep(Duration.millis(transactionRunPollMillis));
        const refreshed = yield* repository.readRun({
          userId: recorded.userId,
          team: recorded.team,
          run: recorded.run,
        });
        if (Option.isNone(refreshed)) {
          return yield* Effect.die(new Error("A recorded run was not found while waiting"));
        }
        return yield* finishedRun(refreshed.value, attempt + 1);
      });

    const readView = Effect.fn("TransactionPlanService.readView")(function* (input: {
      readonly userId: UserId;
      readonly team: TeamId;
      readonly facts: TransactionPlanTeamFacts;
      readonly at: DateTime.Utc;
    }) {
      const stored = yield* repository.readPlanMoves({
        userId: input.userId,
        team: input.team,
      });
      return planViewOf({ stored, facts: input.facts, checkedAt: input.at, team: input.team });
    });

    const storedRead = Effect.fn("TransactionPlanService.storedRead")(function* (input: {
      readonly userId: UserId;
      readonly team: TeamId;
      readonly at: DateTime.Utc;
      readonly today?: StoredMoveDate;
    }) {
      const stored = yield* repository.readPlanMoves({
        userId: input.userId,
        team: input.team,
      });
      const team = yield* teamSummary(input.userId, input.team);
      const moves = EffectArray.map(stored, (move) =>
        moveReadView({ move, team, check: { status: "unavailable" } }),
      );
      return {
        team,
        ...(input.today === undefined ? {} : { today: input.today }),
        nextCheckAt: nextCheckAt(input.at),
        snapshot: storedSnapshot(stored),
        moves,
        days: planDays({ moves, today: input.today }),
        groups: yield* groupReadsFor({ moves: stored, check: undefined }),
      } satisfies TransactionPlanRead;
    });

    const rosterFixedEntries = Effect.fn("TransactionPlanService.rosterFixedEntries")(
      function* (input: {
        readonly facts: TransactionPlanTeamFacts;
        readonly rule: RosterRule;
        readonly open: ReadonlyArray<TransactionPlanMove>;
        readonly entries: ReadonlyArray<ProposedEntry>;
        readonly at: DateTime.Utc;
      }) {
        const baseline = evaluateTransactionPlan({
          facts: input.facts,
          moves: [...input.open, ...EffectArray.map(input.entries, (entry) => entry.candidate)],
          checkedAt: input.at,
        });
        const evaluated = evaluatedMoves(baseline);
        const plans: Array<{
          readonly funded: ProposedEntry;
          readonly fixes: ReadonlyArray<RosterFixDraft>;
        }> = [];
        const cures = new Map<TransactionMoveId, string>();
        for (const entry of input.entries) {
          const evaluation = evaluated.get(entry.candidate.id);
          if (evaluation === undefined || evaluation.validation.status === "current") {
            continue;
          }
          const search = searchRosterFixes({
            facts: input.facts,
            rule: input.rule,
            funded: entry.candidate,
            reasons: evaluation.validation.reasons,
          });
          if (search.detail !== undefined) {
            cures.set(entry.candidate.id, search.detail);
          }
          if (search.fixes.length === 0) {
            continue;
          }
          plans.push({ funded: entry, fixes: search.fixes });
        }
        if (plans.length === 0) {
          return { entries: input.entries, cures };
        }
        const ids = yield* Effect.forEach(
          EffectArray.flatMap(plans, (plan) => {
            const flatMapped1 = plan.fixes;
            return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
          }),
          () =>
            newId.pipe(
              Effect.flatMap((id) =>
                Schema.decodeEffect(TransactionMoveIdSchema)(id).pipe(Effect.orDie),
              ),
            ),
          { concurrency: 1 },
        );
        let cursor = 0;
        const generated = EffectArray.map(plans, (plan) => ({
          funded: plan.funded,
          entries: EffectArray.map(plan.fixes, (fix): ProposedEntry => {
            const id = requireId(ids, cursor);
            cursor += 1;
            return {
              candidate: fixCandidateOf({
                fix,
                id,
                group: rosterFixGroupOf(plan.funded.candidate.id),
                funded: plan.funded.candidate,
              }),
              index: plan.funded.index,
              label: plan.funded.label,
              settleKey: plan.funded.settleKey,
              funded: plan.funded.candidate.id,
            };
          }),
        }));
        const base = EffectArray.reduce(input.entries, Number.MAX_SAFE_INTEGER, (position, entry) =>
          Math.min(position, entry.candidate.position),
        );
        const ordered = optionalArrayValue(
          EffectArray.flatMap(input.entries, (entry) => {
            const fixes =
              EffectOption.getOrUndefined(
                EffectArray.findFirst(generated, (plan) => plan.funded === entry),
              )?.entries ?? [];
            return [...fixes, entry];
          }),
          (value) =>
            EffectArray.map(value, (entry, index) => ({
              ...entry,
              candidate: { ...entry.candidate, position: base + index },
            })),
        );
        const verified = evaluateTransactionPlan({
          facts: input.facts,
          moves: [...input.open, ...EffectArray.map(ordered, (entry) => entry.candidate)],
          checkedAt: input.at,
        });
        const current = new Set(
          EffectArray.flatMap(verified.moves, (entry) => {
            const flatMapped2 = entry.validation.status === "current" ? [entry.move] : [];
            return arrayValueIsArray(flatMapped2) ? flatMapped2 : [flatMapped2];
          }),
        );
        const kept = EffectArray.filter(
          ordered,
          (entry) => entry.funded === undefined || current.has(entry.funded),
        );
        return { entries: kept, cures };
      },
    );

    const propose = Effect.fn("TransactionPlanService.propose")(function* (
      userId: UserId,
      input: TransactionPlanProposeInput,
    ) {
      const at = yield* DateTime.now;
      const decision = input.decision ?? ownerDecision("transactions.propose");
      yield* repository.loadPlan({ userId, team: input.team, at });
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const open = EffectArray.filter(stored, isOpenMove);
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: [...new Set([...namedPlayers(open), ...draftPlayers(input.moves)])],
        needsBudget: needsBudget(open) || needsBudget(input.moves),
      });
      const roster = new Map(
        EffectArray.map(facts.roster, (player) => [player.key, player] as const),
      );
      const rule = rosterRuleOf(facts.constraints, facts.slots);
      const planMoves = planProjection({ facts, open, stored });
      const yielded1 = yield* Effect.forEach(
        [
          ...new Set(
            EffectArray.flatMap(input.moves, (draft) => {
              const flatMapped3 = draft.group === undefined ? [] : [draft.group];
              return arrayValueIsArray(flatMapped3) ? flatMapped3 : [flatMapped3];
            }),
          ),
        ],
        (label) => newId.pipe(Effect.map((id) => [label, id] as const)),
        { concurrency: 1 },
      );
      const groupIds = new Map(yielded1);
      const firstPosition =
        EffectArray.reduce(stored, -1, (position, move) => Math.max(position, move.position)) + 1;
      const ids = yield* Effect.forEach(
        input.moves,
        () =>
          newId.pipe(
            Effect.flatMap((id) =>
              Schema.decodeEffect(TransactionMoveIdSchema)(id).pipe(Effect.orDie),
            ),
          ),
        { concurrency: 1 },
      );
      const entries = EffectArray.map(input.moves, (draft, index): ProposedEntry => {
        const id = requireId(ids, index);
        return {
          candidate: draftCandidate({
            draft,
            id,
            position: firstPosition + index,
            group: draft.group === undefined ? undefined : groupIds.get(draft.group),
            effectiveDate: undefined,
            roster,
            facts,
          }),
          index,
          label: draft.group,
          settleKey: draft.group ?? id,
          funded: undefined,
        };
      });
      const cure = rosterCurePair({ facts, rule, open, entries, at });
      const prepared =
        cure === undefined
          ? entries
          : yield* newId.pipe(
              Effect.flatMap((id) =>
                Schema.decodeEffect(TransactionMoveIdSchema)(id).pipe(Effect.orDie),
              ),
              Effect.map((group) =>
                EffectArray.map(entries, (entry, index) =>
                  index === cure[0] || index === cure[1]
                    ? {
                        ...entry,
                        settleKey: group,
                        candidate: { ...entry.candidate, group },
                      }
                    : entry,
                ),
              ),
            );
      const fixed = yield* rosterFixedEntries({
        facts,
        rule,
        open: planMoves,
        entries: prepared,
        at,
      });
      const settled = settleProposals({
        team: input.team,
        projection: planMoves,
        accepted: open,
        proposals: proposedGroups(fixed.entries),
        facts,
        roster,
        placeClaims: (place) => exclusivePlace(rule, place),
        cures: fixed.cures,
        checkedAt: at,
      });

      if (settled.accepted.length > open.length) {
        const acceptedIds = new Set(EffectArray.map(settled.accepted, (move) => move.id));
        const evaluation = evaluateTransactionPlan({
          facts,
          moves: planProjection({ facts, open: settled.accepted, stored }),
          checkedAt: at,
        });
        const evaluated = evaluatedMoves(evaluation);
        const planClaims = claimPlan({
          moves: settled.accepted,
          after: evaluation,
          roster,
          placeClaims: (place) => exclusivePlace(rule, place),
        });
        const appends = EffectArray.map(
          EffectArray.filter(
            fixed.entries,
            (entry) =>
              acceptedIds.has(entry.candidate.id) &&
              (entry.funded === undefined || acceptedIds.has(entry.funded)),
          ),
          (entry) =>
            appendOf(
              entry.candidate,
              entryOf(evaluated, entry.candidate.id),
              planClaims.claims.get(entry.candidate.id) ?? [],
              input.proposedBy,
              decision,
              at,
            ),
        );
        const [first, ...rest] = appends;
        if (first === undefined) {
          return yield* Effect.die(new Error("Accepted proposals produced no moves to append"));
        }
        yield* repository.appendMoves({
          userId,
          team: input.team,
          at,
          moves: [first, ...rest],
        });
      }

      return {
        plan: yield* readView({ userId, team: input.team, facts, at }),
        refused: settled.refused,
      };
    });

    const resolveDraft = Effect.fn("TransactionPlanService.resolveDraft")(function* (input: {
      readonly userId: UserId;
      readonly team: TeamId;
      readonly providerTeamKey: string;
      readonly teamName: string;
      readonly leagueKey: string;
      readonly draft: TransactionPlanRefMoveDraft;
    }) {
      const open = (
        refs: ReadonlyArray<string>,
      ): Effect.Effect<ReadonlyArray<string | undefined>> =>
        Effect.gen(function* () {
          const decoded = yield* Effect.forEach(
            refs,
            (ref) => Schema.decodeEffect(PlayerRef)(ref).pipe(Effect.orDie),
            { concurrency: 1 },
          );
          return yield* tokens.openPlayerRefs({
            userId: input.userId,
            leagueKey: input.leagueKey,
            refs: decoded,
          });
        });
      const addRefs = yield* open(input.draft.adds ?? []);
      const fallbackRefs = yield* open(input.draft.fallbacks ?? []);
      const dropRefs = yield* open(input.draft.drops ?? []);
      const slotPlayer =
        input.draft.slotMove === undefined ? [] : yield* open([input.draft.slotMove.player]);
      const intentPlayer =
        input.draft.player === undefined ? [] : yield* open([input.draft.player]);
      const invalid =
        addRefs.includes(undefined) ||
        fallbackRefs.includes(undefined) ||
        dropRefs.includes(undefined) ||
        slotPlayer.includes(undefined) ||
        intentPlayer.includes(undefined);
      if (invalid) {
        return {
          status: "refused",
          code: "reference_invalid",
          detail: "A player reference is not valid for this account and league.",
        } as const;
      }
      const counterparty = input.draft.counterparty;
      const counterpartyKey =
        counterparty === undefined
          ? undefined
          : yield* Effect.result(
              tokens.openCounterpartyRef({
                userId: input.userId,
                leagueKey: input.leagueKey,
                ref: counterparty,
              }),
            ).pipe(
              Effect.map((result) => (result._tag === "Success" ? result.success : undefined)),
            );
      if (counterparty !== undefined && counterpartyKey === undefined) {
        return {
          status: "refused",
          code: "reference_invalid",
          detail: "The other team's reference is not valid for this account and league.",
        } as const;
      }
      const party = (ref: string): { readonly key: string; readonly name: string } | undefined => {
        if (ref === input.team) {
          return { key: input.providerTeamKey, name: input.teamName };
        }
        return counterparty !== undefined && ref === counterparty && counterpartyKey !== undefined
          ? { key: counterpartyKey, name: "the other team" }
          : undefined;
      };
      const picks = [];
      for (const pick of input.draft.picks ?? []) {
        const source = party(pick.from);
        const destination = party(pick.to);
        if (source === undefined || destination === undefined) {
          return {
            status: "refused",
            code: "trade_pick_team_not_party",
            detail: "A draft pick names a team that is not part of this trade.",
          } as const;
        }
        picks.push({
          round: pick.round,
          sourceTeamKey: source.key,
          destinationTeamKey: destination.key,
          sourceName: source.name,
          destinationName: destination.name,
        });
      }
      return {
        status: "resolved",
        draft: {
          ...(input.draft.move === undefined ? {} : { move: input.draft.move }),
          ...(input.draft.group === undefined ? {} : { group: input.draft.group }),
          kind: input.draft.kind,
          adds: EffectArray.filter(addRefs, (ref): ref is string => ref !== undefined),
          fallbacks: EffectArray.filter(fallbackRefs, (ref): ref is string => ref !== undefined),
          drops: EffectArray.filter(dropRefs, (ref): ref is string => ref !== undefined),
          picks,
          ...(input.draft.slotMove === undefined || slotPlayer[0] === undefined
            ? {}
            : { slotMove: { player: slotPlayer[0], toSlot: input.draft.slotMove.toSlot } }),
          ...(input.draft.to === undefined ? {} : { to: input.draft.to }),
          ...(intentPlayer[0] === undefined ? {} : { player: intentPlayer[0] }),
          ...(counterpartyKey === undefined ? {} : { counterparty: counterpartyKey }),
          ...(input.draft.bid === undefined ? {} : { bid: input.draft.bid }),
          reason: input.draft.reason,
          ...(input.draft.runDay === undefined ? {} : { runDay: input.draft.runDay }),
        },
      } as const;
    });

    const proposeRefs = Effect.fn("TransactionPlanService.proposeRefs")(function* (
      userId: UserId,
      input: TransactionPlanRefProposeInput,
    ) {
      const team = yield* repository.readTeamProviderKeys({ userId, team: input.team });
      if (Option.isNone(team)) {
        return yield* TransactionPlanTeamNotFound.make({ team: input.team });
      }
      const resolved = yield* Effect.forEach(
        input.moves,
        (draft, index) =>
          resolveDraft({
            userId,
            team: input.team,
            providerTeamKey: team.value.providerTeamKey,
            teamName: team.value.name,
            leagueKey: team.value.providerLeagueKey,
            draft,
          }).pipe(Effect.map((result) => ({ index, result }))),
        { concurrency: 1 },
      );
      const refused: Array<TransactionPlanRefusal> = EffectArray.flatMap(resolved, (entry) => {
        const flatMapped4 =
          entry.result.status === "refused"
            ? [
                {
                  code: entry.result.code,
                  team: input.team,
                  detail: entry.result.detail,
                  moves: [entry.index],
                },
              ]
            : [];
        return arrayValueIsArray(flatMapped4) ? flatMapped4 : [flatMapped4];
      });
      if (refused.length > 0) {
        const at = yield* DateTime.now;
        const stored = yield* repository.readPlanMoves({ userId, team: input.team });
        const facts = yield* factsPort.read({
          userId,
          team: input.team,
          at,
          players: [],
          needsBudget: needsBudget(EffectArray.filter(stored, isOpenMove)),
        });
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused,
          confirmationCleared: false,
        };
      }
      const resolvedMoves = EffectArray.flatMap(resolved, (entry) => {
        const flatMapped5 =
          entry.result.status === "resolved"
            ? [{ index: entry.index, draft: entry.result.draft }]
            : [];
        return arrayValueIsArray(flatMapped5) ? flatMapped5 : [flatMapped5];
      });
      const amendments: Array<{
        readonly index: number;
        readonly move: TransactionMoveId;
        readonly draft: TransactionPlanMoveDraft;
      }> = [];
      const appends: Array<{ readonly index: number; readonly draft: TransactionPlanMoveDraft }> =
        [];
      for (const entry of resolvedMoves) {
        const move = entry.draft.move;
        if (move === undefined) {
          appends.push(entry);
        } else {
          amendments.push({ index: entry.index, move, draft: entry.draft });
        }
      }
      let plan: TransactionPlanView | undefined;
      let confirmationCleared = false;
      for (const amendment of amendments) {
        const result = yield* edit(userId, {
          team: input.team,
          move: amendment.move,
          change: amendment.draft,
          ...(input.decision === undefined ? {} : { decision: input.decision }),
        });
        confirmationCleared = confirmationCleared || result.confirmationCleared;
        for (const refusal of result.refused) {
          refused.push({
            ...refusal,
            moves: EffectArray.map(refusal.moves, () => amendment.index),
          });
        }
        plan = result.plan;
      }
      if (appends.length > 0) {
        const result = yield* propose(userId, {
          team: input.team,
          proposedBy: input.proposedBy,
          ...(input.decision === undefined ? {} : { decision: input.decision }),
          moves: EffectArray.map(appends, (entry) => entry.draft),
        });
        for (const refusal of result.refused) {
          refused.push({
            ...refusal,
            moves: EffectArray.map(
              refusal.moves,
              (position) => appends[position]?.index ?? position,
            ),
          });
        }
        plan = result.plan;
      }
      if (plan !== undefined) {
        return { plan, refused, confirmationCleared };
      }
      const at = yield* DateTime.now;
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: [],
        needsBudget: needsBudget(EffectArray.filter(stored, isOpenMove)),
      });
      return {
        plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
        refused,
        confirmationCleared: false,
      };
    });

    const save = Effect.fn("TransactionPlanService.save")(function* (
      userId: UserId,
      input: TransactionPlanSaveInput,
    ) {
      const at = yield* DateTime.now;
      const decision = input.decision ?? ownerDecision("transactions.save");
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const move = EffectOption.getOrUndefined(
        EffectArray.findFirst(stored, (entry) => entry.id === input.move),
      );
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const open = EffectArray.filter(stored, isOpenMove);
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: namedPlayers(open),
        needsBudget: needsBudget(open),
      });
      const roster = new Map(
        EffectArray.map(facts.roster, (player) => [player.key, player] as const),
      );
      const refused = moveChangeRefusal({ team: input.team, move });
      if (refused !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [refused],
          confirmationCleared: false,
        };
      }
      if (!Schema.is(StoredMoveDate)(input.runDay)) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [
            {
              code: "run_day_invalid",
              team: input.team,
              detail: `A saved move runs on a date like ${facts.today}.`,
              moves: [0],
            },
          ],
          confirmationCleared: false,
        };
      }
      if (input.runDay < facts.today) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [
            {
              code: "run_day_past",
              team: input.team,
              detail: `A saved move runs on ${facts.today} or a later day, so ${input.runDay} has already passed.`,
              moves: [0],
            },
          ],
          confirmationCleared: false,
        };
      }

      const dayChanged = input.runDay !== move.runDay;
      const before = evaluateTransactionPlan({
        facts,
        moves: planProjection({ facts, open, stored }),
        checkedAt: at,
      });
      const peers = dayChanged ? [...groupPeers(open, move), ...fixPeers(open, move)] : [];
      const confirmationCleared =
        dayChanged &&
        (move.confirmedAt !== undefined ||
          EffectArray.some(peers, (peer) => peer.confirmedAt !== undefined));
      const changed = EffectArray.map(open, (entry) =>
        entry.id === move.id || EffectArray.some(peers, (peer) => peer.id === entry.id)
          ? movedToDay(entry, input.runDay, facts.today)
          : entry,
      );
      const after = evaluateTransactionPlan({
        facts,
        moves: planProjection({ facts, open: changed, stored }),
        checkedAt: at,
      });
      const revalidation = revalidationRefusal({
        team: input.team,
        target: move,
        moves: open,
        before,
        after,
        requireTarget: true,
        indexes: [0],
      });
      if (revalidation !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [revalidation],
          confirmationCleared: false,
        };
      }
      const planClaims = claimPlan({
        moves: changed,
        after,
        roster,
        placeClaims: (place) => exclusivePlace(rosterRuleOf(facts.constraints, facts.slots), place),
      });
      const collision = planClaims.refused[0];
      if (collision !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [claimRefusalOf(input.team, collision, [0])],
          confirmationCleared: false,
        };
      }

      const entry = entryOf(evaluatedMoves(after), move.id);
      const content = contentOfMove(move, entry, input.runDay, facts.today, decision, at);
      yield* repository.editMove({
        userId,
        team: input.team,
        move: move.id,
        at,
        edit: {
          content: dayChanged ? content : { ...content, ...preservedDecisionOf(move) },
          claims: planClaims.claims.get(move.id) ?? [],
        },
        groupDays: EffectArray.map(peers, (peer) => ({
          move: peer.id,
          runDay: input.runDay,
          effectiveDate: entryOf(evaluatedMoves(after), peer.id).effectiveDate,
          decision: decisionFor(input.runDay, facts.today),
          decidedBy: decision.decidedBy,
          surface: decision.surface,
        })),
      });

      return {
        plan: yield* readView({ userId, team: input.team, facts, at }),
        refused: [],
        confirmationCleared,
      };
    });

    const edit = Effect.fn("TransactionPlanService.edit")(function* (
      userId: UserId,
      input: TransactionPlanEditInput,
    ) {
      const at = yield* DateTime.now;
      const decision = input.decision ?? ownerDecision("transactions.edit");
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const move = EffectOption.getOrUndefined(
        EffectArray.findFirst(stored, (entry) => entry.id === input.move),
      );
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const open = EffectArray.filter(stored, isOpenMove);
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: namedPlayers(open),
        needsBudget: needsBudget(open) || needsBudget([input.change]),
      });
      const roster = new Map(
        EffectArray.map(facts.roster, (player) => [player.key, player] as const),
      );
      const refused = moveChangeRefusal({ team: input.team, move });
      if (refused !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [refused],
          confirmationCleared: false,
        };
      }
      const runDay = input.change.runDay ?? move.runDay;
      if (runDay !== undefined && !Schema.is(StoredMoveDate)(runDay)) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [
            {
              code: "run_day_invalid",
              team: input.team,
              detail: `A saved move runs on a date like ${facts.today}.`,
              moves: [0],
            },
          ],
          confirmationCleared: false,
        };
      }
      if (runDay !== undefined && runDay < facts.today) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [
            {
              code: "run_day_past",
              team: input.team,
              detail: `A saved move runs on ${facts.today} or a later day, so ${runDay} has already passed.`,
              moves: [0],
            },
          ],
          confirmationCleared: false,
        };
      }
      const change = {
        ...input.change,
        ...(runDay === undefined ? {} : { runDay }),
      };

      const candidate = draftCandidate({
        draft: change,
        id: move.id,
        position: move.position,
        group: move.group,
        effectiveDate: runDay === move.runDay ? move.effectiveDate : undefined,
        roster,
        facts,
      });
      const unchanged = sameMoveShape(move, candidate);
      const rule = rosterRuleOf(facts.constraints, facts.slots);
      const before = evaluateTransactionPlan({
        facts,
        moves: planProjection({ facts, open, stored }),
        checkedAt: at,
      });
      const peers = runDay === move.runDay ? [] : groupPeers(open, move);
      const confirmationCleared =
        !unchanged &&
        (move.confirmedAt !== undefined ||
          EffectArray.some(peers, (peer) => peer.confirmedAt !== undefined));
      const replacedFixes = fixPeers(open, move);
      const surviving = EffectArray.filter(
        open,
        (entry) =>
          entry.id !== move.id &&
          !EffectArray.some(peers, (peer) => peer.id === entry.id) &&
          !EffectArray.some(replacedFixes, (fix) => fix.id === entry.id),
      );
      const withPeers = [
        ...surviving,
        ...EffectArray.map(peers, (peer) => movedToDay(peer, runDay, facts.today)),
      ];
      const fixed = yield* rosterFixedEntries({
        facts,
        rule,
        open: withPeers,
        entries: [
          {
            candidate,
            index: 0,
            label: undefined,
            settleKey: candidate.id,
            funded: undefined,
          },
        ],
        at,
      });
      const changed = [...EffectArray.map(fixed.entries, (entry) => entry.candidate), ...withPeers];
      const after = evaluateTransactionPlan({
        facts,
        moves: planProjection({ facts, open: changed, stored }),
        checkedAt: at,
      });
      const revalidation = revalidationRefusal({
        team: input.team,
        target: candidate,
        moves: withPeers,
        before,
        after,
        requireTarget: true,
        indexes: [0],
      });
      if (revalidation !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [withCure(revalidation, fixed.cures.get(candidate.id))],
          confirmationCleared: false,
        };
      }
      const planClaims = claimPlan({
        moves: changed,
        after,
        roster,
        placeClaims: (place) => exclusivePlace(rosterRuleOf(facts.constraints, facts.slots), place),
      });
      const collision = planClaims.refused[0];
      if (collision !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [claimRefusalOf(input.team, collision, [0])],
          confirmationCleared: false,
        };
      }
      if (unchanged) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [],
          confirmationCleared,
        };
      }

      const evaluatedAfter = evaluatedMoves(after);
      const entry = entryOf(evaluatedAfter, move.id);
      yield* repository.editMove({
        userId,
        team: input.team,
        move: move.id,
        at,
        edit: {
          content: contentOfCandidate(candidate, entry, facts.today, decision, at),
          claims: planClaims.claims.get(move.id) ?? [],
        },
        groupDays: EffectArray.map(peers, (peer) => ({
          move: peer.id,
          runDay,
          effectiveDate: entryOf(evaluatedAfter, peer.id).effectiveDate,
          decision: decisionFor(runDay, facts.today),
          decidedBy: decision.decidedBy,
          surface: decision.surface,
        })),
      });
      if (replacedFixes.length > 0) {
        yield* repository.discardMoves({
          userId,
          team: input.team,
          moves: nonEmpty(
            EffectArray.map(replacedFixes, (fix) => fix.id),
            "A replaced roster fix was lost",
          ),
          decision,
          at,
        });
      }
      const generated = EffectArray.filter(
        fixed.entries,
        (generated) => generated.funded !== undefined,
      );
      if (generated.length > 0) {
        const appends = EffectArray.map(generated, (generated) =>
          appendOf(
            generated.candidate,
            entryOf(evaluatedAfter, generated.candidate.id),
            planClaims.claims.get(generated.candidate.id) ?? [],
            move.proposedBy,
            decision,
            at,
          ),
        );
        const [first, ...rest] = appends;
        if (first === undefined) {
          return yield* Effect.die(new Error("Generated roster fixes produced no moves to append"));
        }
        yield* repository.appendMoves({
          userId,
          team: input.team,
          at,
          moves: [first, ...rest],
        });
      }

      return {
        plan: yield* readView({ userId, team: input.team, facts, at }),
        refused: [],
        confirmationCleared,
      };
    });

    const discard = Effect.fn("TransactionPlanService.discard")(function* (
      userId: UserId,
      input: TransactionPlanDiscardInput,
    ) {
      const at = yield* DateTime.now;
      const decision = input.decision ?? ownerDecision("transactions.discard");
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: [],
        needsBudget: needsBudget(EffectArray.filter(stored, isOpenMove)),
      });
      const move = EffectOption.getOrUndefined(
        EffectArray.findFirst(stored, (entry) => entry.id === input.move),
      );
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const refused = moveChangeRefusal({ team: input.team, move });
      if (refused !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [refused],
        };
      }

      const fixes = fixPeers(EffectArray.filter(stored, isOpenMove), move);
      yield* repository.discardMoves({
        userId,
        team: input.team,
        moves: nonEmpty(
          [move.id, ...EffectArray.map(fixes, (fix) => fix.id)],
          "A discarded move named no move to discard",
        ),
        decision,
        at,
      });

      return { plan: yield* readView({ userId, team: input.team, facts, at }), refused: [] };
    });

    const discardGroup = Effect.fn("TransactionPlanService.discardGroup")(function* (
      userId: UserId,
      input: TransactionPlanDiscardGroupInput,
    ) {
      const at = yield* DateTime.now;
      const decision = input.decision ?? ownerDecision("transactions.discard_group");
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: [],
        needsBudget: needsBudget(EffectArray.filter(stored, isOpenMove)),
      });
      const move = EffectOption.getOrUndefined(
        EffectArray.findFirst(stored, (entry) => entry.id === input.move),
      );
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const refused = moveChangeRefusal({ team: input.team, move });
      if (refused !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [refused],
        };
      }

      const targets = EffectArray.filter(
        confirmationTargets(EffectArray.filter(stored, isOpenMove), [move]),
        (entry) => entry.decision !== "discarded",
      );
      const blocked = EffectArray.flatMap(targets, (target) => {
        const refusal = moveChangeRefusal({ team: input.team, move: target });
        return refusal === undefined ? [] : [refusal];
      });
      if (blocked.length > 0) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: blocked,
        };
      }

      yield* repository.discardMoves({
        userId,
        team: input.team,
        moves: nonEmpty(
          EffectArray.map(targets, (target) => target.id),
          "A discarded group named no move to discard",
        ),
        decision,
        at,
      });

      return { plan: yield* readView({ userId, team: input.team, facts, at }), refused: [] };
    });

    const fix = Effect.fn("TransactionPlanService.fix")(function* (
      userId: UserId,
      input: TransactionPlanFixInput,
    ) {
      const at = yield* DateTime.now;
      const decision = input.decision ?? ownerDecision("transactions.fix");
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const open = EffectArray.filter(stored, isOpenMove);
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: namedPlayers(open),
        needsBudget: needsBudget(open),
      });
      const move = EffectOption.getOrUndefined(
        EffectArray.findFirst(stored, (entry) => entry.id === input.move),
      );
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const changeRefusal = moveChangeRefusal({ team: input.team, move });
      if (changeRefusal !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [changeRefusal],
        };
      }

      const refusal = (code: string, detail: string): TransactionPlanResult => ({
        plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
        refused: [{ code, team: input.team, detail, moves: [0] }],
      });
      const existing = EffectArray.filter(
        fixPeers(open, move),
        (entry) => entry.decision !== "discarded",
      );
      if (existing.length > 0) {
        return refusal(
          "roster_fixes_present",
          "This move already carries a Roster fixes group. Discard it before adding another.",
        );
      }
      const rule = rosterRuleOf(facts.constraints, facts.slots);
      const roster = new Map(
        EffectArray.map(facts.roster, (player) => [player.key, player] as const),
      );
      const projection = planProjection({ facts, open, stored });
      const evaluation = evaluateTransactionPlan({ facts, moves: projection, checkedAt: at });
      const entry = entryOf(evaluatedMoves(evaluation), move.id);
      if (entry.validation.status === "current") {
        return refusal("move_not_blocked", "This move already fits, so it needs no roster fixes.");
      }
      const search = searchRosterFixes({
        facts,
        rule,
        funded: move,
        reasons: entry.validation.reasons,
      });
      if (search.fixes.length === 0) {
        return refusal(
          "no_roster_fix",
          search.detail ?? "No roster change can make room for this move.",
        );
      }

      const ids = yield* Effect.forEach(
        search.fixes,
        () =>
          newId.pipe(
            Effect.flatMap((id) =>
              Schema.decodeEffect(TransactionMoveIdSchema)(id).pipe(Effect.orDie),
            ),
          ),
        { concurrency: 1 },
      );
      const candidates = EffectArray.map(search.fixes, (fix, index) =>
        fixCandidateOf({
          fix,
          id: requireId(ids, index),
          group: rosterFixGroupOf(move.id),
          funded: move,
        }),
      );
      const after = evaluateTransactionPlan({
        facts,
        moves: [...projection, ...candidates],
        checkedAt: at,
      });
      const evaluatedAfter = evaluatedMoves(after);
      if (entryOf(evaluatedAfter, move.id).validation.status !== "current") {
        const reason = entryOf(evaluatedAfter, move.id).validation.reasons[0]?.detail;
        return refusal(
          "no_roster_fix",
          reason ?? "These roster fixes do not make room for this move.",
        );
      }
      const planClaims = claimPlan({
        moves: [...open, ...candidates],
        after,
        roster,
        placeClaims: (place) => exclusivePlace(rule, place),
      });
      const collision = planClaims.refused[0];
      if (collision !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [claimRefusalOf(input.team, collision, [0])],
        };
      }

      yield* repository.appendMoves({
        userId,
        team: input.team,
        at,
        moves: nonEmpty(
          EffectArray.map(candidates, (candidate) =>
            appendOf(
              candidate,
              entryOf(evaluatedAfter, candidate.id),
              planClaims.claims.get(candidate.id) ?? [],
              move.proposedBy,
              decision,
              at,
            ),
          ),
          "A roster fix produced no move to append",
        ),
      });

      return { plan: yield* readView({ userId, team: input.team, facts, at }), refused: [] };
    });

    const runMoves = Effect.fn("TransactionPlanService.runMoves")(function* (input: {
      readonly userId: UserId;
      readonly team: TeamId;
      readonly at: DateTime.Utc;
      readonly facts: TransactionPlanTeamFacts;
      readonly open: ReadonlyArray<TransactionMoveRowRecord>;
      readonly mode: RunMode;
      readonly only?: ReadonlySet<TransactionMoveId>;
      readonly decision: TransactionDecision;
      readonly runClaim: string;
      readonly runId: TransactionRunId;
    }) {
      const submitted: Array<TransactionMoveRowRecord> = [
        ...(yield* repository.readSubmittedMoves({
          userId: input.userId,
          teams: [input.team],
          dates: effectiveDatesOf(input.open),
        })),
      ];
      const project = (
        facts: TransactionPlanTeamFacts,
        moves: ReadonlyArray<TransactionMoveRowRecord>,
      ): ReadonlyArray<TransactionPlanMove> => [
        ...moves,
        ...projectionLegs({ facts, submitted, dates: effectiveDatesOf(moves) }),
      ];
      const evaluation = evaluateTransactionPlan({
        facts: input.facts,
        moves: project(input.facts, input.open),
        checkedAt: input.at,
      });
      const entries = evaluatedMoves(evaluation);
      const selection = selectRunGroups({
        team: input.team,
        mode: input.mode,
        facts: input.facts,
        open: input.open,
        entries,
        ...(input.only === undefined ? {} : { only: input.only }),
      });
      const counts = emptyRunCounts();
      counts.moves = selection.selected.length;
      const outcomes = new Map<TransactionMoveId, TransactionMoveResult>();
      const deferred = new Set<TransactionMoveId>();
      const openById = new Map(
        EffectArray.map([...input.open, ...submitted], (move) => [move.id, move] as const),
      );
      const selectedIds = new Set(EffectArray.map(selection.selected, (move) => move.id));
      const settled = new Set<TransactionMoveId>();

      const settle = Effect.fn("TransactionPlanService.settle")(function* (
        settlements: ReadonlyArray<TransactionMoveSettlement>,
      ) {
        if (!EffectArray.isReadonlyArrayNonEmpty(settlements)) {
          return;
        }
        const movesById = new Map(
          EffectArray.map([...input.open, ...submitted], (move) => [move.id, move] as const),
        );
        for (const settlement of settlements) {
          const move = movesById.get(settlement.move);
          if (move === undefined) {
            return yield* Effect.die(
              new Error("A settlement named a move that is not part of the run"),
            );
          }
          yield* verifySettlement({ move, settlement });
        }
        const settledByClaim = yield* repository.settleMoves({
          userId: input.userId,
          team: input.team,
          runClaim: input.runClaim,
          at: input.at,
          settlements,
        });
        if (!settledByClaim) {
          return yield* TransactionPlanRunInProgress.make({
            team: input.team,
            detail: "Another run took this team's plan before the result could be stored.",
          });
        }
        for (const settlement of settlements) {
          outcomes.set(settlement.move, settlement.result);
          settled.add(settlement.move);
          countRunResult(counts, settlement.result);
          const stored = EffectOption.getOrUndefined(
            EffectArray.findFirst(input.open, (move) => move.id === settlement.move),
          );
          if (stored !== undefined && settlement.result === "executed") {
            submitted.push({ ...stored, result: "executed" });
          }
        }
      });

      const skip = (
        moves: ReadonlyArray<TransactionMoveRowRecord>,
        entries: ReadonlyMap<TransactionMoveId, TransactionPlanMoveEvaluation>,
        detail: string,
      ): Effect.Effect<void, TransactionPlanPersistenceFailed | TransactionPlanRunInProgress> =>
        settle(
          EffectArray.map(moves, (move) =>
            settlementOf({
              move,
              entry: entryOf(entries, move.id),
              result: "skipped",
              detail,
              facts: input.facts,
              at: input.at,
              attempted: false,
              actions: [],
              run: undefined,
            }),
          ),
        );

      const runMember = (
        state: RunState,
      ): Effect.Effect<RunStop, TransactionPlanPersistenceFailed | TransactionPlanRunInProgress> =>
        Effect.gen(function* () {
          const move = state.members[state.index];
          if (move === undefined) {
            return "settled";
          }
          const entry = entryOf(state.entries, move.id);
          const write = yield* writes.apply(
            writeRequestOf({ userId: input.userId, team: input.team, move, entry }),
          );
          const decided = writeResultOf(write);
          if (decided.status === "retry") {
            counts.retry += 1;
            return "retry";
          }
          const submittedClaim = decided.result === "pending" && move.kind === "waiver_claim";
          yield* settle([
            settlementOf({
              move,
              entry,
              result: decided.result,
              detail: decided.detail,
              facts: state.facts,
              at: input.at,
              attempted: true,
              actions: decided.actions,
              ...(submittedClaim
                ? {
                    phase: "with_league" as const,
                    attempts: claimSubmittedAttempts(
                      move,
                      decided.detail ?? "Submitted to the league.",
                      input.at,
                    ),
                  }
                : {}),
              run: {
                id: input.runId,
                at: input.at,
                decidedBy: input.decision.decidedBy,
                surface: input.decision.surface,
              },
            }),
          ]);
          const rest = state.members.slice(state.index + 1);
          if (decided.result === "failed" || decided.result === "unknown") {
            yield* skip(
              rest,
              state.entries,
              decided.result === "unknown"
                ? `${describeTransactionPlanMove(move)} has an unknown outcome, so the rest of its group was skipped.`
                : `${describeTransactionPlanMove(move)} failed, so the rest of its group was skipped.`,
            );
            return "settled";
          }
          if (rest.length === 0) {
            return "settled";
          }

          const remaining = EffectArray.filter(input.open, (open) => !settled.has(open.id));
          const reread = yield* Effect.result(
            factsPort.read({
              userId: input.userId,
              team: input.team,
              at: input.at,
              players: namedPlayers(remaining),
              needsBudget: needsBudget(remaining),
            }),
          );
          if (reread._tag === "Failure") {
            yield* skip(
              rest,
              state.entries,
              `${describeTransactionPlanMove(move)} reached your league, and the roster could not be read again, so the rest of its group did not run.`,
            );
            return "settled";
          }
          const reevaluated = evaluateTransactionPlan({
            facts: reread.success,
            moves: project(reread.success, remaining),
            checkedAt: input.at,
          });
          const entries = evaluatedMoves(reevaluated);
          const next = rest[0];
          if (next === undefined) {
            return "settled";
          }
          const nextEntry = entries.get(next.id);
          if (nextEntry === undefined || nextEntry.validation.status !== "current") {
            const reason = nextEntry?.validation.reasons[0];
            yield* settle([
              settlementOf({
                move: next,
                entry: nextEntry ?? entryOf(state.entries, next.id),
                result: "failed",
                detail: `${describeTransactionPlanMove(next)} did not run after ${describeTransactionPlanMove(move)} reached your league: ${reason?.detail ?? "its check no longer passes."} Your roster was read again; check it, then choose the move again or discard it.`,
                facts: reread.success,
                at: input.at,
                attempted: false,
                actions: [],
                run: undefined,
              }),
            ]);
            yield* skip(
              rest.slice(1),
              entries,
              `The group stopped after ${describeTransactionPlanMove(next)} could not run.`,
            );
            return "settled";
          }
          return yield* runMember({
            members: rest,
            index: 0,
            facts: reread.success,
            entries,
          });
        });

      for (const group of selection.groups) {
        const blocked = blockingRunDependency({
          group,
          entries,
          openById,
          outcomes,
          selected: selectedIds,
          deferred,
        });
        if (blocked !== undefined) {
          if (blocked.kind === "deferred") {
            counts.retry += group.moves.length;
            for (const move of group.moves) {
              deferred.add(move.id);
            }
            continue;
          }
          yield* settle(
            EffectArray.map(group.moves, (move) =>
              settlementOf({
                move,
                entry: entryOf(entries, move.id),
                result: "skipped",
                detail: blocked.detail,
                facts: input.facts,
                at: input.at,
                attempted: false,
                actions: [],
                run: undefined,
              }),
            ),
          );
          continue;
        }

        const invalid = EffectOption.getOrUndefined(
          EffectArray.findFirst(
            group.moves,
            (move) => entryOf(entries, move.id).validation.status !== "current",
          ),
        );
        if (invalid !== undefined) {
          const label = describeTransactionPlanMove(invalid);
          const reason = entryOf(entries, invalid.id).validation.reasons[0];
          yield* settle(
            EffectArray.map(group.moves, (move) => {
              const entry = entryOf(entries, move.id);
              return move.id === invalid.id
                ? settlementOf({
                    move,
                    entry,
                    result: "failed",
                    detail: reason?.detail ?? `${label} could not run.`,
                    facts: input.facts,
                    at: input.at,
                    attempted: false,
                    actions: [],
                    run: undefined,
                  })
                : settlementOf({
                    move,
                    entry,
                    result: "skipped",
                    detail: `The group did not run because ${label} could not run.`,
                    facts: input.facts,
                    at: input.at,
                    attempted: false,
                    actions: [],
                    run: undefined,
                  });
            }),
          );
          continue;
        }

        const stop = yield* runMember({
          members: group.moves,
          index: 0,
          facts: input.facts,
          entries,
        });
        if (stop === "retry") {
          for (const move of group.moves) {
            if (!outcomes.has(move.id)) {
              deferred.add(move.id);
            }
          }
        }
      }

      return { counts, refusals: selection.refused };
    });

    const claimRunWithWait = (input: {
      readonly userId: UserId;
      readonly team: TeamId;
      readonly runClaim: string;
      readonly at: DateTime.Utc;
      readonly attempt: number;
    }): Effect.Effect<TransactionPlanRecord, TransactionPlanServiceError> =>
      Effect.gen(function* () {
        const claimed = yield* repository.claimRun({
          userId: input.userId,
          team: input.team,
          runClaim: input.runClaim,
          at: input.at,
        });
        if (claimed.status === "claimed") {
          return claimed.plan;
        }
        if (input.attempt >= transactionRunWaitAttempts) {
          return yield* TransactionPlanRunInProgress.make({
            team: input.team,
            detail: "Another run holds this team's plan, so this submit is still waiting.",
          });
        }
        yield* Effect.sleep(Duration.millis(transactionRunPollMillis));
        return yield* claimRunWithWait({ ...input, attempt: input.attempt + 1 });
      });

    const recordedSubmission = Effect.fn("TransactionPlanService.recordedSubmission")(function* (
      userId: UserId,
      team: TeamId,
      recorded: TransactionRunRecord,
      at: DateTime.Utc,
    ) {
      const finished = yield* finishedRun(recorded, 0);
      const stored = yield* repository.readPlanMoves({ userId, team });
      const facts = yield* factsPort.read({
        userId,
        team,
        at,
        players: namedPlayers(EffectArray.filter(stored, isOpenMove)),
        needsBudget: needsBudget(EffectArray.filter(stored, isOpenMove)),
      });
      return {
        team,
        today: facts.today,
        counts: finished.counts,
        refusals: finished.refusals,
        plan: planViewOf({ stored, facts, checkedAt: at, team }),
      } satisfies TransactionPlanSubmission;
    });

    const ownerRun = Effect.fn("TransactionPlanService.ownerRun")(function* (input: {
      readonly userId: UserId;
      readonly team: TeamId;
      readonly at: DateTime.Utc;
      readonly decision: TransactionDecision;
      readonly key: string;
      readonly mode: RunMode;
      readonly only?: ReadonlySet<TransactionMoveId>;
    }) {
      const recorded = yield* repository.readRunByKey({
        userId: input.userId,
        team: input.team,
        key: input.key,
      });
      if (Option.isSome(recorded)) {
        return yield* recordedSubmission(input.userId, input.team, recorded.value, input.at);
      }
      const runClaim = yield* newClaim;
      yield* claimRunWithWait({
        userId: input.userId,
        team: input.team,
        runClaim,
        at: input.at,
        attempt: 0,
      });
      const runId = yield* newRunId;
      const started = yield* repository.beginRun({
        userId: input.userId,
        team: input.team,
        run: runId,
        trigger: "submit",
        decision: input.decision,
        key: input.key,
        counts: emptyRunCounts(),
        refusals: [],
        at: input.at,
      });
      if (started.status === "recorded") {
        yield* repository.releaseRun({
          userId: input.userId,
          team: input.team,
          runClaim,
          at: input.at,
        });
        return yield* recordedSubmission(input.userId, input.team, started.run, input.at);
      }
      return yield* Effect.gen(function* () {
        const stored = yield* repository.readPlanMoves({ userId: input.userId, team: input.team });
        const open = EffectArray.filter(stored, isOpenMove);
        const facts = yield* factsPort.read({
          userId: input.userId,
          team: input.team,
          at: input.at,
          players: namedPlayers(open),
          needsBudget: needsBudget(open),
        });
        const run = yield* runMoves({
          userId: input.userId,
          team: input.team,
          at: input.at,
          facts,
          open,
          mode: input.mode,
          ...(input.only === undefined ? {} : { only: input.only }),
          decision: input.decision,
          runClaim,
          runId,
        });
        const counts = { ...run.counts, plans: 1, claimed: 1 };
        yield* repository.finishRun({
          run: runId,
          counts,
          refusals: run.refusals,
          at: input.at,
        });
        return {
          team: input.team,
          today: facts.today,
          counts,
          refusals: run.refusals,
          plan: planViewOf({
            stored: yield* repository.readPlanMoves({ userId: input.userId, team: input.team }),
            facts,
            checkedAt: input.at,
            team: input.team,
          }),
        } satisfies TransactionPlanSubmission;
      }).pipe(
        Effect.ensuring(
          repository
            .releaseRun({ userId: input.userId, team: input.team, runClaim, at: input.at })
            .pipe(Effect.ignore),
        ),
      );
    });

    const submit = Effect.fn("TransactionPlanService.submit")(function* (
      userId: UserId,
      input: TransactionPlanSubmitInput,
    ) {
      const at = yield* DateTime.now;
      return yield* ownerRun({
        userId,
        team: input.team,
        at,
        decision: input.decision ?? ownerDecision("transactions.submit"),
        key: input.key,
        mode: "submit",
      });
    });

    const retry = Effect.fn("TransactionPlanService.retry")(function* (
      userId: UserId,
      input: TransactionPlanRetryInput,
    ) {
      const at = yield* DateTime.now;
      const decision = input.decision ?? ownerDecision("transactions.retry");
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const move = EffectOption.getOrUndefined(
        EffectArray.findFirst(stored, (entry) => entry.id === input.move),
      );
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const members = cardMoves(stored, move);
      const refused = retryRefusal({ team: input.team, members });
      if (refused !== undefined) {
        return {
          team: input.team,
          retried: [],
          counts: emptyRunCounts(),
          refusals: [refused],
          plan: yield* plan(userId, { team: input.team }),
        } satisfies TransactionPlanRetry;
      }
      const targets = EffectArray.filter(members, isOpenMove);
      const run = yield* ownerRun({
        userId,
        team: input.team,
        at,
        decision,
        key: input.key,
        mode: "retry",
        only: new Set(EffectArray.map(targets, (target) => target.id)),
      });
      return {
        team: input.team,
        retried: EffectArray.map(targets, (target) => target.id),
        counts: run.counts,
        refusals: run.refusals,
        plan: yield* plan(userId, { team: input.team }),
      } satisfies TransactionPlanRetry;
    });

    const confirm = Effect.fn("TransactionPlanService.confirm")(function* (
      userId: UserId,
      input: TransactionPlanConfirmInput,
    ) {
      const at = yield* DateTime.now;
      const decision = input.decision ?? ownerDecision("transactions.confirm");
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const open = EffectArray.filter(stored, isOpenMove);
      const requested: Array<TransactionMoveRecord> = [];
      for (const move of input.moves) {
        const found = EffectOption.getOrUndefined(
          EffectArray.findFirst(stored, (entry) => entry.id === move),
        );
        if (found === undefined) {
          return yield* TransactionPlanMoveNotFound.make({ team: input.team, move });
        }
        requested.push(found);
      }
      const refused = EffectArray.flatMap(requested, (move) => {
        const refusal = moveChangeRefusal({ team: input.team, move });
        return refusal === undefined ? [] : [refusal];
      });
      if (refused.length > 0) {
        return {
          status: "confirmed",
          confirmed: [],
          counts: emptyRunCounts(),
          refusals: EffectArray.map(refused, (entry) => ({
            code: entry.code,
            team: input.team,
            detail: entry.detail,
            moves: [...input.moves],
          })),
          plan: yield* storedRead({ userId, team: input.team, at }),
        } satisfies TransactionPlanConfirmation;
      }
      const targets = confirmationTargets(open, requested);
      if (targets.length === 0) {
        return {
          status: "confirmed",
          confirmed: [],
          counts: emptyRunCounts(),
          refusals: [],
          plan: yield* storedRead({ userId, team: input.team, at }),
        } satisfies TransactionPlanConfirmation;
      }
      const today = yield* factsPort.today({ userId, team: input.team, at });
      const decisions = EffectArray.map(targets, (move) => ({
        move: move.id,
        decision: isDueMove(move, today) ? ("now" as const) : ("confirmed" as const),
      }));
      const [first, ...rest] = decisions;
      if (first === undefined) {
        return {
          status: "confirmed",
          confirmed: [],
          counts: emptyRunCounts(),
          refusals: [],
          plan: yield* storedRead({ userId, team: input.team, at, today }),
        } satisfies TransactionPlanConfirmation;
      }
      yield* repository.confirmMoves({
        userId,
        team: input.team,
        confirmedBy: userId,
        decision,
        moves: [first, ...rest],
        at,
      });
      if (!EffectArray.some(decisions, (entry) => entry.decision === "now")) {
        return {
          status: "confirmed",
          confirmed: EffectArray.map(decisions, (entry) => entry.move),
          counts: emptyRunCounts(),
          refusals: [],
          plan: yield* storedRead({ userId, team: input.team, at, today }),
        } satisfies TransactionPlanConfirmation;
      }
      const submission = yield* submit(userId, {
        team: input.team,
        key: input.key,
        decision,
      });
      return {
        status: "confirmed",
        confirmed: EffectArray.map(decisions, (entry) => entry.move),
        counts: submission.counts,
        refusals: submission.refusals,
        plan: yield* plan(userId, { team: input.team }),
      } satisfies TransactionPlanConfirmation;
    });

    const reconcileClaims = Effect.fn("TransactionPlanService.reconcileClaims")(function* (input: {
      readonly at: DateTime.Utc;
      readonly limit: number;
    }) {
      const counts = emptyRunCounts();
      const plans = yield* repository.readClaimPlans({ limit: input.limit });
      counts.plans = plans.length;
      if (plans.length === 0) {
        return { at: input.at, counts };
      }

      const claimNext = (
        index: number,
        claimed: ReadonlyArray<{ readonly plan: TransactionPlanRef; readonly runClaim: string }>,
      ): Effect.Effect<
        ReadonlyArray<{ readonly plan: TransactionPlanRef; readonly runClaim: string }>,
        TransactionPlanPersistenceFailed
      > =>
        Effect.gen(function* () {
          const plan = plans[index];
          if (plan === undefined) {
            return claimed;
          }
          const runClaim = yield* newClaim;
          const claim = yield* repository.claimRun({
            userId: plan.userId,
            team: plan.team,
            runClaim,
            at: input.at,
          });
          if (claim.status === "held") {
            counts.busy += 1;
            return yield* claimNext(index + 1, claimed);
          }
          counts.claimed += 1;
          return yield* claimNext(index + 1, [...claimed, { plan, runClaim }]);
        });
      const claimed = yield* claimNext(0, []);
      if (claimed.length === 0) {
        return { at: input.at, counts };
      }

      const claimMoves = yield* repository.readClaimMovesForPlans({
        plans: EffectArray.map(claimed, (entry) => entry.plan),
      });
      const openMoves = yield* repository.readOpenMovesForPlans({
        plans: EffectArray.map(claimed, (entry) => entry.plan),
      });

      const reconcileNext = (index: number): Effect.Effect<void, TransactionPlanServiceError> =>
        Effect.gen(function* () {
          const entry = claimed[index];
          if (entry === undefined) {
            return;
          }
          const owned = EffectArray.filter(
            claimMoves,
            (move) => move.userId === entry.plan.userId && move.team === entry.plan.team,
          );
          const open = EffectArray.filter(
            openMoves,
            (move) => move.userId === entry.plan.userId && move.team === entry.plan.team,
          );
          const runClaim = entry.runClaim;
          yield* Effect.gen(function* () {
            const players = [
              ...new Set([
                ...EffectArray.flatMap(owned, (move) => {
                  const flatMapped6 = [
                    ...EffectArray.map(move.adds, (player) => player.key),
                    ...EffectArray.map(move.fallbacks, (player) => player.key),
                  ];
                  return arrayValueIsArray(flatMapped6) ? flatMapped6 : [flatMapped6];
                }),
                ...namedPlayers(open),
              ]),
            ];
            const facts = yield* Effect.result(
              factsPort.read({
                userId: entry.plan.userId,
                team: entry.plan.team,
                at: input.at,
                players,
                needsBudget: needsBudget(open),
              }),
            );
            if (facts._tag === "Failure") {
              counts.unavailable += 1;
              return;
            }

            const runId = yield* newRunId;
            const local = emptyRunCounts();
            const settlements: Array<TransactionMoveSettlement> = [];
            for (const move of owned) {
              const decided = yield* reconcileClaim({
                move,
                facts: facts.success,
                open,
                userId: entry.plan.userId,
                team: entry.plan.team,
                at: input.at,
                runId,
                writes,
              });
              if (decided === undefined) {
                continue;
              }
              local.moves += 1;
              countRunResult(local, decided.result);
              if (decided.settlement.attempts.at(-1)?.outcome === "retry") {
                local.retry += 1;
              }
              settlements.push(decided.settlement);
            }
            if (settlements.length === 0) {
              return;
            }
            const ownedById = new Map(EffectArray.map(owned, (move) => [move.id, move] as const));
            for (const settlement of settlements) {
              const move = ownedById.get(settlement.move);
              if (move === undefined) {
                return yield* Effect.die(
                  new Error("A claim settlement named a move that was not claimed"),
                );
              }
              yield* verifySettlement({ move, settlement });
            }
            yield* repository.beginRun({
              userId: entry.plan.userId,
              team: entry.plan.team,
              run: runId,
              trigger: "tick",
              decision: transactionPlanTickDecision,
              key: undefined,
              counts: emptyRunCounts(),
              refusals: [],
              at: input.at,
            });
            const settledByClaim = yield* repository.settleMoves({
              userId: entry.plan.userId,
              team: entry.plan.team,
              runClaim,
              at: input.at,
              settlements: nonEmpty(settlements, "A reconciled claim produced no settlement"),
            });
            if (!settledByClaim) {
              return yield* TransactionPlanRunInProgress.make({
                team: entry.plan.team,
                detail: "Another run took this team's plan before the result could be stored.",
              });
            }
            yield* repository.finishRun({
              run: runId,
              counts: local,
              refusals: [],
              at: input.at,
            });
            counts.moves += local.moves;
            counts.executed += local.executed;
            counts.pending += local.pending;
            counts.failed += local.failed;
            counts.skipped += local.skipped;
            counts.unknown += local.unknown;
            counts.retry += local.retry;
          }).pipe(
            Effect.ensuring(
              repository
                .releaseRun({
                  userId: entry.plan.userId,
                  team: entry.plan.team,
                  runClaim,
                  at: input.at,
                })
                .pipe(Effect.ignore),
            ),
          );
          return yield* reconcileNext(index + 1);
        });
      yield* reconcileNext(0);

      return { at: input.at, counts };
    });

    const runDue = Effect.fn("TransactionPlanService.runDue")(function* (
      limit: number,
      at: DateTime.Utc,
    ) {
      const before = DateTime.formatIsoDateUtc(DateTime.add(at, { days: 1 }));
      const reconciled = yield* reconcileClaims({ at, limit });
      const recovered = yield* repository.releaseStaleRuns({ before: staleClaimBefore(at) });
      const candidates = yield* repository.readDuePlans({ before, limit });
      const counts = {
        ...emptyRunCounts(),
        plans: candidates.length + reconciled.counts.plans,
        claimed: reconciled.counts.claimed,
        busy: reconciled.counts.busy,
        recovered,
        unavailable: reconciled.counts.unavailable,
        moves: reconciled.counts.moves,
        executed: reconciled.counts.executed,
        pending: reconciled.counts.pending,
        failed: reconciled.counts.failed,
        skipped: reconciled.counts.skipped,
        unknown: reconciled.counts.unknown,
        retry: reconciled.counts.retry,
      };
      if (candidates.length === 0) {
        return { at, counts };
      }

      const candidateMoves = yield* repository.readOpenMovesForPlans({ plans: candidates });
      const factsByPlan = new Map<string, TransactionPlanTeamFacts>();
      yield* Effect.forEach(
        candidates,
        (plan) => {
          const planMoves = EffectArray.filter(
            candidateMoves,
            (move) => move.userId === plan.userId && move.team === plan.team,
          );
          return Effect.result(
            factsPort.read({
              userId: plan.userId,
              team: plan.team,
              at,
              players: namedPlayers(planMoves),
              needsBudget: needsBudget(planMoves),
            }),
          ).pipe(
            Effect.map((read) => {
              if (read._tag === "Failure") {
                counts.unavailable += 1;
                return;
              }
              factsByPlan.set(planKey(plan), read.success);
            }),
          );
        },
        { concurrency: 3 },
      );

      const known = EffectArray.filter(candidates, (plan) => factsByPlan.has(planKey(plan)));
      if (known.length === 0) {
        return { at, counts };
      }
      const dueMoves = yield* repository.readDueMovesForPlans({ plans: known, before });
      const duePlans = EffectArray.filter(known, (plan) => {
        const facts = factsByPlan.get(planKey(plan));
        return (
          facts !== undefined &&
          EffectArray.some(
            dueMoves,
            (move) =>
              move.userId === plan.userId &&
              move.team === plan.team &&
              (move.runDay === undefined || move.runDay <= facts.today),
          )
        );
      });

      const claimDue = (
        index: number,
        claimed: ReadonlyArray<DueClaim>,
      ): Effect.Effect<ReadonlyArray<DueClaim>, TransactionPlanPersistenceFailed> =>
        Effect.gen(function* () {
          const plan = duePlans[index];
          if (plan === undefined) {
            return claimed;
          }
          const runClaim = yield* newClaim;
          const claim = yield* repository.claimRun({
            userId: plan.userId,
            team: plan.team,
            runClaim,
            at,
          });
          if (claim.status === "held") {
            counts.busy += 1;
            return yield* claimDue(index + 1, claimed);
          }
          const facts = factsByPlan.get(planKey(plan));
          if (facts === undefined) {
            yield* repository.releaseRun({
              userId: plan.userId,
              team: plan.team,
              runClaim,
              at,
            });
            return yield* claimDue(index + 1, claimed);
          }
          counts.claimed += 1;
          return yield* claimDue(index + 1, [...claimed, { plan, facts, runClaim }]);
        });
      const claimed = yield* claimDue(0, []);
      if (claimed.length === 0) {
        return { at, counts };
      }

      const open = yield* repository.readOpenMovesForPlans({
        plans: EffectArray.map(claimed, (entry) => entry.plan),
      });
      const runClaimed = (index: number): Effect.Effect<void, TransactionPlanServiceError> =>
        Effect.gen(function* () {
          const entry = claimed[index];
          if (entry === undefined) {
            return;
          }
          const planMoves = EffectArray.filter(
            open,
            (move) => move.userId === entry.plan.userId && move.team === entry.plan.team,
          );
          const runId = yield* newRunId;
          yield* repository.beginRun({
            userId: entry.plan.userId,
            team: entry.plan.team,
            run: runId,
            trigger: "tick",
            decision: transactionPlanTickDecision,
            key: undefined,
            counts: emptyRunCounts(),
            refusals: [],
            at,
          });
          const run = yield* Effect.gen(function* () {
            const result = yield* runMoves({
              userId: entry.plan.userId,
              team: entry.plan.team,
              at,
              facts: entry.facts,
              open: planMoves,
              mode: "due",
              decision: transactionPlanTickDecision,
              runClaim: entry.runClaim,
              runId,
            });
            yield* repository.finishRun({
              run: runId,
              counts: result.counts,
              refusals: result.refusals,
              at,
            });
            return result;
          }).pipe(
            Effect.ensuring(
              repository
                .releaseRun({
                  userId: entry.plan.userId,
                  team: entry.plan.team,
                  runClaim: entry.runClaim,
                  at,
                })
                .pipe(Effect.ignore),
            ),
          );
          counts.moves += run.counts.moves;
          counts.executed += run.counts.executed;
          counts.pending += run.counts.pending;
          counts.failed += run.counts.failed;
          counts.skipped += run.counts.skipped;
          counts.unknown += run.counts.unknown;
          counts.retry += run.counts.retry;
          return yield* runClaimed(index + 1);
        });
      yield* runClaimed(0);

      yield* Effect.annotateCurrentSpan({
        "transaction_plan.plans": counts.plans,
        "transaction_plan.claimed": counts.claimed,
        "transaction_plan.busy": counts.busy,
        "transaction_plan.recovered": counts.recovered,
        "transaction_plan.moves": counts.moves,
        "transaction_plan.executed": counts.executed,
        "transaction_plan.pending": counts.pending,
        "transaction_plan.failed": counts.failed,
        "transaction_plan.skipped": counts.skipped,
        "transaction_plan.unknown": counts.unknown,
        "transaction_plan.retry": counts.retry,
      });

      return { at, counts };
    });

    const teamSummary = Effect.fn("TransactionPlanService.teamSummary")(function* (
      userId: UserId,
      team: TeamId,
    ) {
      const loaded = yield* repository.readTeam({ userId, team });
      if (Option.isNone(loaded)) {
        return yield* TransactionPlanTeamNotFound.make({ team });
      }
      return loaded.value;
    });

    const checkTeams = Effect.fn("TransactionPlanService.checkTeams")(function* (input: {
      readonly userId: UserId;
      readonly at: DateTime.Utc;
      readonly teams: ReadonlyArray<TeamId>;
      readonly moves: ReadonlyArray<TransactionMoveRowRecord>;
    }) {
      const movesByTeam = new Map<TeamId, Array<TransactionMoveRowRecord>>();
      for (const move of input.moves) {
        const held = movesByTeam.get(move.team) ?? [];
        held.push(move);
        movesByTeam.set(move.team, held);
      }
      const submitted = yield* repository.readSubmittedMoves({
        userId: input.userId,
        teams: input.teams,
        dates: effectiveDatesOf(input.moves),
      });
      const reads = yield* Effect.forEach(
        input.teams,
        (team) =>
          Effect.result(
            factsPort.read({
              userId: input.userId,
              team,
              at: input.at,
              players: namedPlayers(movesByTeam.get(team) ?? []),
              needsBudget: needsBudget(movesByTeam.get(team) ?? []),
            }),
          ).pipe(Effect.map((read) => ({ team, read }))),
        { concurrency: 3 },
      );
      const checked = EffectArray.flatMap(reads, ({ team, read }) => {
        if (read._tag === "Failure") {
          return [];
        }
        const facts = read.success;
        const rule = rosterRuleOf(facts.constraints, facts.slots);
        const occupancy = rosterOccupancy({ rule, players: facts.roster });
        const freeable = planReserveMoves({ rule, players: facts.roster });
        const teamMoves = movesByTeam.get(team) ?? [];
        return [
          {
            team,
            facts,
            occupancy,
            freeable,
            evaluation: evaluateTransactionPlan({
              facts,
              moves: [
                ...teamMoves,
                ...projectionLegs({
                  facts,
                  submitted: EffectArray.filter(submitted, (move) => move.team === team),
                  dates: effectiveDatesOf(teamMoves),
                }),
              ],
              checkedAt: input.at,
            }),
            playerKeys: [
              ...new Set([
                ...EffectArray.map(freeable, (move) => move.playerKey),
                ...EffectArray.map(occupancy.illegal, (entry) => entry.key),
              ]),
            ],
          },
        ];
      });
      const sealed = yield* tokens.sealPlayerRefGroups({
        userId: input.userId,
        groups: EffectArray.map(checked, (entry) => ({
          leagueKey: entry.facts.leagueKey,
          playerKeys: entry.playerKeys,
        })),
      });
      return new Map<TeamId, TransactionTeamCheck>([
        ...EffectArray.map(checked, (entry, index): readonly [TeamId, TransactionTeamCheck] => {
          const playerRefs = sealed[index];
          if (playerRefs === undefined) {
            throw new Error("A checked team was not sealed");
          }
          const refByKey = new Map(
            EffectArray.map(entry.playerKeys, (key, held) => [key, playerRefs[held]] as const),
          );
          const refOf = (key: string): PlayerRef => {
            const ref = refByKey.get(key);
            if (ref === undefined) {
              throw new Error("A roster player was published without a reference");
            }
            return ref;
          };
          const addsPossible =
            entry.occupancy.places.free +
            EffectArray.reduce(entry.occupancy.reserve, 0, (total, list) => total + list.free);
          return [
            entry.team,
            {
              status: "checked",
              today: entry.facts.today,
              snapshot: {
                status: "live",
                checkedAt: input.at,
                source: entry.facts.rosterSource,
              },
              places: entry.occupancy.places,
              reserve: entry.occupancy.reserve,
              addsPossible,
              addsWithFixes: addsPossible + entry.freeable.length,
              canFree: EffectArray.map(entry.freeable, (move) => ({
                player: refOf(move.playerKey),
                name: move.playerName,
                list: move.toSlot,
                place: move.fromSlot,
              })),
              illegal: EffectArray.map(entry.occupancy.illegal, (blocker) => ({
                player: refOf(blocker.key),
                name: blocker.name,
                slot: blocker.slot,
                fact: blocker.fact,
                cure: blocker.cure,
              })),
              waiverBid: entry.facts.waiverBid,
              waiver: entry.facts.waiver,
              moves: new Map(
                EffectArray.map(entry.evaluation.moves, (held) => [held.move, held] as const),
              ),
              blocked: new Map(
                EffectArray.map(
                  entry.evaluation.order.blocked,
                  (held) => [held.move, held.detail] as const,
                ),
              ),
            },
          ];
        }),
        ...EffectArray.flatMap(reads, ({ team, read }) => {
          const flatMapped7 =
            read._tag === "Failure" ? [[team, { status: "unavailable" }] as const] : [];
          return arrayValueIsArray(flatMapped7) ? flatMapped7 : [flatMapped7];
        }),
      ]);
    });

    const groupReadsFor = Effect.fn("TransactionPlanService.groupReadsFor")(function* (input: {
      readonly moves: ReadonlyArray<TransactionMoveRecord>;
      readonly check: TransactionTeamCheck | undefined;
    }) {
      const grouped = EffectArray.filter(input.moves, (move) => move.group !== undefined);
      if (grouped.length === 0) {
        return [];
      }
      const steps = yield* repository.readSteps({
        moves: nonEmpty(
          EffectArray.map(grouped, (move) => move.id),
          "A grouped move was read without an identifier",
        ),
      });
      return planGroupReads({
        members: EffectArray.map(grouped, (move) => groupMemberOf(move, input.check)),
        steps,
      });
    });

    const countMoves = Effect.fn("TransactionPlanService.countMoves")(function* (
      userId: UserId,
      team: TeamId | undefined,
    ) {
      const teams = yield* repository.countOwnerMoves({ userId, team });
      const teamCount = yield* repository.countOwnerTeams({ userId, team });
      return { totals: countTotals(teams), teams, teamCount };
    });

    const readMovePage = Effect.fn("TransactionPlanService.readMovePage")(function* (
      userId: UserId,
      input: {
        readonly team: TeamId | undefined;
        readonly state: TransactionMoveReadState;
        readonly after: TransactionMoveCursor | undefined;
        readonly limit: TransactionMovePageLimit;
      },
    ) {
      const at = yield* DateTime.now;
      const team = input.team === undefined ? undefined : yield* teamSummary(userId, input.team);
      const rows = yield* repository.readOwnerMoves({
        userId,
        team: input.team,
        state: input.state,
        after: input.after,
        limit: input.limit + 1,
      });
      const page = rows.slice(0, input.limit);
      const openTeams = [
        ...new Set(
          EffectArray.flatMap(page, (row) => {
            const flatMapped8 = isOpenMove(row.move) ? [row.move.team] : [];
            return arrayValueIsArray(flatMapped8) ? flatMapped8 : [flatMapped8];
          }),
        ),
      ];
      const planMoves =
        openTeams.length === 0
          ? []
          : yield* repository.readOpenMovesForTeams({ userId, teams: openTeams });
      const checks = yield* checkTeams({ userId, at, teams: openTeams, moves: planMoves });
      const moves = moveReadViews({ moves: page, checks });
      const teamFacts = EffectArray.flatMap([...checks], ([teamId, check]) => {
        const flatMapped9 =
          check.status === "checked"
            ? [{ team: teamId, places: check.places, reserve: check.reserve, waiver: check.waiver }]
            : [];
        return arrayValueIsArray(flatMapped9) ? flatMapped9 : [flatMapped9];
      });
      const todayOf = new Map(
        EffectArray.flatMap([...checks], ([teamId, check]) => {
          const flatMapped10 = check.status === "checked" ? [[teamId, check.today] as const] : [];
          return arrayValueIsArray(flatMapped10) ? flatMapped10 : [flatMapped10];
        }),
      );
      const counts = yield* countMoves(userId, input.team);
      const last = page[page.length - 1];
      const complete = rows.length <= input.limit;
      const pageGroups = [
        ...new Set(
          EffectArray.flatMap(page, (row) => {
            const flatMapped11 = row.move.group === undefined ? [] : [row.move.group];
            return arrayValueIsArray(flatMapped11) ? flatMapped11 : [flatMapped11];
          }),
        ),
      ];
      const groupMoves =
        pageGroups.length === 0
          ? []
          : yield* repository.readGroupMoves({
              userId,
              groups: nonEmpty(pageGroups, "A grouped move was read without its group"),
            });
      const groups = (yield* Effect.forEach(
        [...new Set(EffectArray.map(groupMoves, (move) => move.team))],
        (teamId) =>
          groupReadsFor({
            moves: EffectArray.filter(groupMoves, (move) => move.team === teamId),
            check: checks.get(teamId),
          }),
        { concurrency: 1 },
      ))
        .flat()
        .sort((left, right) => EffectString.localeCompare(left.team, right.team));
      return {
        status: "ok",
        team,
        nextCheckAt: nextCheckAt(at),
        moves,
        days: moveDays({ moves, todayOf }),
        teamFacts,
        counts: counts.totals,
        teamCount: counts.teamCount,
        groups,
        page: {
          returned: moves.length,
          complete,
          next: complete || last === undefined ? undefined : moveCursor(last.move),
        },
      } satisfies TransactionMoveList;
    });

    const timeline = Effect.fn("TransactionPlanService.timeline")(function* (
      userId: UserId,
      input: TransactionTimelineInput,
    ) {
      return yield* readMovePage(userId, {
        team: undefined,
        state: "open",
        after: input.after,
        limit: input.limit ?? 20,
      });
    });

    const list = Effect.fn("TransactionPlanService.list")(function* (
      userId: UserId,
      input: TransactionMoveListInput,
    ) {
      return yield* readMovePage(userId, {
        team: input.team,
        state: input.state ?? "today",
        after: input.after,
        limit: input.limit ?? 20,
      });
    });

    const plan = Effect.fn("TransactionPlanService.plan")(function* (
      userId: UserId,
      input: TransactionPlanReadInput,
    ) {
      const at = yield* DateTime.now;
      const team = yield* teamSummary(userId, input.team);
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const open = EffectArray.filter(stored, isOpenMove);
      const checks = yield* checkTeams({
        userId,
        at,
        teams: [input.team],
        moves: open,
      });
      const check = checks.get(input.team);
      const moves = EffectArray.map(stored, (move) => moveReadView({ move, team, check }));
      const today = check?.status === "checked" ? check.today : undefined;
      return {
        team,
        today,
        nextCheckAt: nextCheckAt(at),
        snapshot: check?.status === "checked" ? check.snapshot : storedSnapshot(stored),
        ...(check?.status === "checked"
          ? {
              places: check.places,
              reserve: check.reserve,
              addsPossible: check.addsPossible,
              addsWithFixes: check.addsWithFixes,
              canFree: check.canFree,
              illegal: check.illegal,
              waiverBid: check.waiverBid,
              waiver: check.waiver,
            }
          : {}),
        moves,
        days: planDays({ moves, today }),
        groups: yield* groupReadsFor({ moves: stored, check }),
      } satisfies TransactionPlanRead;
    });

    const counts = Effect.fn("TransactionPlanService.counts")(function* (
      userId: UserId,
      input: TransactionPlanCountsInput,
    ) {
      if (input.team !== undefined) {
        yield* teamSummary(userId, input.team);
      }
      return yield* countMoves(userId, input.team);
    });

    return {
      propose,
      proposeRefs,
      save,
      edit,
      discard,
      discardGroup,
      fix,
      retry,
      confirm,
      submit,
      runDue,
      timeline,
      list,
      plan,
      counts,
    };
  }),
);

function rosterCurePair(input: {
  readonly facts: TransactionPlanTeamFacts;
  readonly rule: RosterRule;
  readonly open: ReadonlyArray<TransactionPlanMove>;
  readonly entries: ReadonlyArray<ProposedEntry>;
  readonly at: DateTime.Utc;
}): readonly [number, number] | undefined {
  const occupancy = rosterOccupancy({ rule: input.rule, players: input.facts.roster });
  if (occupancy.illegal.length === 0) {
    return undefined;
  }
  const group = "lineupkeep-roster-cure";
  for (const curing of input.entries) {
    if (curing.candidate.kind !== "activate" || curing.candidate.group !== undefined) {
      continue;
    }
    if (
      entryOf(
        evaluatedMoves(
          evaluateTransactionPlan({
            facts: input.facts,
            moves: [...input.open, curing.candidate],
            checkedAt: input.at,
          }),
        ),
        curing.candidate.id,
      ).validation.status === "current"
    ) {
      continue;
    }
    for (const funding of input.entries) {
      if (funding === curing || funding.candidate.group !== undefined) {
        continue;
      }
      if (funding.candidate.kind !== "drop" && funding.candidate.kind !== "stash") {
        continue;
      }
      const pair = EffectArray.map([funding.candidate, curing.candidate], (candidate) => ({
        ...candidate,
        group,
      }));
      const evaluation = evaluateTransactionPlan({
        facts: input.facts,
        moves: [...input.open, ...pair],
        checkedAt: input.at,
      });
      const evaluated = evaluatedMoves(evaluation);
      if (
        EffectArray.some(
          pair,
          (entry) => entryOf(evaluated, entry.id).validation.status !== "current",
        )
      ) {
        continue;
      }
      const initial = optionalValue<TransactionPlanMoveEvaluation>();
      const last = EffectArray.reduce(evaluation.moves, initial, (found, entry) =>
        EffectArray.some(pair, (move) => move.id === entry.move) &&
        (found === undefined || (entry.runPosition ?? -1) > (found.runPosition ?? -1))
          ? entry
          : found,
      );
      if (
        last === undefined ||
        rosterOccupancy({ rule: input.rule, players: last.projectedRoster }).illegal.length > 0
      ) {
        continue;
      }
      return [funding.index, curing.index];
    }
  }
  return undefined;
}

function settleProposals(input: {
  readonly team: TeamId;
  readonly projection: ReadonlyArray<TransactionPlanMove>;
  readonly accepted: ReadonlyArray<TransactionPlanMove>;
  readonly proposals: ReadonlyArray<DraftGroup>;
  readonly facts: TransactionPlanTeamFacts;
  readonly roster: ReadonlyMap<string, TransactionPlanRosterPlayer>;
  readonly placeClaims: (place: string) => boolean;
  readonly cures: ReadonlyMap<TransactionMoveId, string>;
  readonly checkedAt: DateTime.Utc;
}): {
  readonly accepted: ReadonlyArray<TransactionPlanMove>;
  readonly refused: ReadonlyArray<TransactionPlanRefusal>;
} {
  let accepted = input.accepted;
  let remaining = [...input.proposals];
  const refused: Array<TransactionPlanRefusal> = [];
  while (remaining.length > 0) {
    const baseline = evaluateTransactionPlan({
      facts: input.facts,
      moves: input.projection,
      checkedAt: input.checkedAt,
    });
    const full = evaluateTransactionPlan({
      facts: input.facts,
      moves: [
        ...input.projection,
        ...EffectArray.flatMap(remaining, (proposal) => {
          const flatMapped12 = proposal.moves;
          return arrayValueIsArray(flatMapped12) ? flatMapped12 : [flatMapped12];
        }),
      ],
      checkedAt: input.checkedAt,
    });
    const broken = brokenExistingMove(baseline, full, accepted);
    if (broken !== undefined) {
      const culprit = EffectOption.getOrUndefined(
        EffectArray.findFirst(remaining, (proposal) =>
          removingGroupKeepsPlan({
            team: input.team,
            projection: input.projection,
            accepted,
            baseline,
            remaining,
            proposal,
            facts: input.facts,
            checkedAt: input.checkedAt,
          }),
        ),
      );
      if (culprit === undefined) {
        for (const proposal of remaining) {
          refused.push(brokenRefusal({ team: input.team, proposal, broken, full }));
        }
        break;
      }
      refused.push(
        brokenRefusal({
          team: input.team,
          proposal: culprit,
          broken,
          full,
        }),
      );
      remaining = EffectArray.filter(remaining, (proposal) => proposal !== culprit);
      continue;
    }

    const refusals = EffectArray.flatMap(remaining, (proposal) => {
      const refusal = groupRefusal({
        team: input.team,
        proposal,
        accepted,
        full,
        roster: input.roster,
        placeClaims: input.placeClaims,
        cures: input.cures,
      });
      return refusal === undefined ? [] : [{ proposal, refusal }];
    });
    if (refusals.length === 0) {
      accepted = [
        ...accepted,
        ...EffectArray.flatMap(remaining, (proposal) => {
          const flatMapped13 = proposal.moves;
          return arrayValueIsArray(flatMapped13) ? flatMapped13 : [flatMapped13];
        }),
      ];
      break;
    }
    const refusedGroups = new Set(EffectArray.map(refusals, (entry) => entry.proposal));
    for (const entry of refusals) {
      refused.push(entry.refusal);
    }
    remaining = EffectArray.filter(remaining, (proposal) => !refusedGroups.has(proposal));
  }
  return { accepted, refused };
}

function brokenExistingMove(
  baseline: TransactionPlanEvaluation,
  full: TransactionPlanEvaluation,
  accepted: ReadonlyArray<TransactionPlanMove>,
): TransactionPlanMove | undefined {
  const before = evaluatedMoves(baseline);
  const after = evaluatedMoves(full);
  return EffectOption.getOrUndefined(
    EffectArray.findFirst(
      accepted,
      (move) =>
        entryOf(before, move.id).validation.status === "current" &&
        entryOf(after, move.id).validation.status !== "current",
    ),
  );
}

function removingGroupKeepsPlan(input: {
  readonly team: TeamId;
  readonly projection: ReadonlyArray<TransactionPlanMove>;
  readonly accepted: ReadonlyArray<TransactionPlanMove>;
  readonly baseline: TransactionPlanEvaluation;
  readonly remaining: ReadonlyArray<DraftGroup>;
  readonly proposal: DraftGroup;
  readonly facts: TransactionPlanTeamFacts;
  readonly checkedAt: DateTime.Utc;
}): boolean {
  const others = EffectArray.flatMap(
    EffectArray.filter<DraftGroup>(input.remaining, (proposal) => proposal !== input.proposal),
    (proposal) => proposal.moves,
  );
  const after = evaluateTransactionPlan({
    facts: input.facts,
    moves: [...input.projection, ...others],
    checkedAt: input.checkedAt,
  });
  const before = evaluatedMoves(input.baseline);
  const entries = evaluatedMoves(after);
  return EffectArray.every(
    input.accepted,
    (move) =>
      entryOf(before, move.id).validation.status !== "current" ||
      entryOf(entries, move.id).validation.status === "current",
  );
}

function brokenRefusal(input: {
  readonly team: TeamId;
  readonly proposal: DraftGroup;
  readonly broken: TransactionPlanMove;
  readonly full: TransactionPlanEvaluation;
}): TransactionPlanRefusal {
  const reason = entryOf(evaluatedMoves(input.full), input.broken.id).validation.reasons[0];
  return {
    code: reason?.code ?? "invalid_move",
    team: input.team,
    detail: `Changing this plan would make ${describeTransactionPlanMove(input.broken)} impossible: ${reason?.detail ?? "its check no longer passes."}`,
    ...(input.proposal.label === undefined ? {} : { group: input.proposal.label }),
    moves: input.proposal.indexes,
  };
}

function groupRefusal(input: {
  readonly team: TeamId;
  readonly proposal: DraftGroup;
  readonly accepted: ReadonlyArray<TransactionPlanMove>;
  readonly full: TransactionPlanEvaluation;
  readonly roster: ReadonlyMap<string, TransactionPlanRosterPlayer>;
  readonly placeClaims: (place: string) => boolean;
  readonly cures: ReadonlyMap<TransactionMoveId, string>;
}): TransactionPlanRefusal | undefined {
  const fullMoves = evaluatedMoves(input.full);
  const invalid = EffectOption.getOrUndefined(
    EffectArray.findFirst(
      input.proposal.moves,
      (move) => entryOf(fullMoves, move.id).validation.status !== "current",
    ),
  );
  if (invalid !== undefined) {
    const reason = entryOf(fullMoves, invalid.id).validation.reasons[0];
    return {
      code: reason?.code ?? "invalid_move",
      team: input.team,
      detail: cured(
        reason?.detail ?? `${describeTransactionPlanMove(invalid)} cannot run against this plan.`,
        input.cures.get(invalid.id),
      ),
      ...(input.proposal.label === undefined ? {} : { group: input.proposal.label }),
      moves: input.proposal.indexes,
    };
  }

  const days = new Set(
    EffectArray.map(input.proposal.moves, (move) => entryOf(fullMoves, move.id).runDay),
  );
  if (days.size > 1) {
    return {
      code: "group_day_conflict",
      team: input.team,
      detail: `A group runs on one day, and these moves run on ${EffectArray.join([...days], ", ")}.`,
      ...(input.proposal.label === undefined ? {} : { group: input.proposal.label }),
      moves: input.proposal.indexes,
    };
  }

  return claimCollision({
    team: input.team,
    moves: [...input.accepted, ...input.proposal.moves],
    after: input.full,
    roster: input.roster,
    placeClaims: input.placeClaims,
    indexes: input.proposal.indexes,
  });
}

function revalidationRefusal(input: {
  readonly team: TeamId;
  readonly target: TransactionPlanMove;
  readonly moves: ReadonlyArray<TransactionPlanMove>;
  readonly before: TransactionPlanEvaluation;
  readonly after: TransactionPlanEvaluation;
  readonly requireTarget: boolean;
  readonly indexes: ReadonlyArray<number>;
}): TransactionPlanRefusal | undefined {
  const beforeMoves = evaluatedMoves(input.before);
  const afterMoves = evaluatedMoves(input.after);
  if (input.requireTarget) {
    const entry = entryOf(afterMoves, input.target.id);
    if (entry.validation.status !== "current") {
      const reason = entry.validation.reasons[0];
      return {
        code: reason?.code ?? "invalid_move",
        team: input.team,
        detail: reason?.detail ?? `${describeTransactionPlanMove(input.target)} cannot run.`,
        moves: input.indexes,
      };
    }
  }
  for (const move of input.moves) {
    const beforeEntry = entryOf(beforeMoves, move.id);
    const afterEntry = entryOf(afterMoves, move.id);
    if (beforeEntry.validation.status !== "current" || afterEntry.validation.status === "current") {
      continue;
    }
    const reason = afterEntry.validation.reasons[0];
    return {
      code: reason?.code ?? "invalid_move",
      team: input.team,
      detail: `Changing this plan would make ${describeTransactionPlanMove(move)} impossible: ${reason?.detail ?? "its check no longer passes."}`,
      moves: input.indexes,
    };
  }
  return undefined;
}

function claimCollision(input: {
  readonly team: TeamId;
  readonly moves: ReadonlyArray<TransactionPlanMove>;
  readonly after: TransactionPlanEvaluation;
  readonly roster: ReadonlyMap<string, TransactionPlanRosterPlayer>;
  readonly placeClaims: (place: string) => boolean;
  readonly indexes: ReadonlyArray<number>;
}): TransactionPlanRefusal | undefined {
  const refused = claimPlan(input).refused[0];
  return refused === undefined ? undefined : claimRefusalOf(input.team, refused, input.indexes);
}

function claimPlan(input: {
  readonly moves: ReadonlyArray<TransactionPlanMove>;
  readonly after: TransactionPlanEvaluation;
  readonly roster: ReadonlyMap<string, TransactionPlanRosterPlayer>;
  readonly placeClaims: (place: string) => boolean;
}): {
  readonly claims: ReadonlyMap<TransactionMoveId, ReadonlyArray<StoredMoveClaim>>;
  readonly refused: ReadonlyArray<TransactionPlanClaimRefusal>;
} {
  const claims = claimTransactionPlanMoves({
    moves: input.moves,
    placements: placementsOf(input.after),
    roster: input.roster,
    placeClaims: input.placeClaims,
  });
  return {
    claims: new Map(EffectArray.map(claims.moves, (entry) => [entry.move, entry.claims] as const)),
    refused: claims.refused,
  };
}

function claimRefusalOf(
  team: TeamId,
  refusal: TransactionPlanClaimRefusal,
  indexes: ReadonlyArray<number>,
): TransactionPlanRefusal {
  return {
    code: refusal.code,
    team,
    detail: refusal.detail,
    moves: indexes,
  };
}

function placementsOf(
  evaluation: TransactionPlanEvaluation,
): ReadonlyMap<TransactionMoveId, StoredMovePlacement> {
  return new Map(
    EffectArray.flatMap(evaluation.moves, (entry) => {
      const flatMapped15 =
        entry.placement === undefined ? [] : [[entry.move, entry.placement] as const];
      return arrayValueIsArray(flatMapped15) ? flatMapped15 : [flatMapped15];
    }),
  );
}

function moveChangeRefusal(input: {
  readonly team: TeamId;
  readonly move: TransactionMoveRecord;
}): TransactionPlanRefusal | undefined {
  if (input.move.result === "pending") {
    return {
      code: "move_pending",
      team: input.team,
      detail: `${describeTransactionPlanMove(input.move)} waits on the league's answer, so the plan does not change it.`,
      moves: [0],
    };
  }
  if (isOpenMove(input.move)) {
    return undefined;
  }
  return {
    code: "move_not_open",
    team: input.team,
    detail: `${describeTransactionPlanMove(input.move)} has ended, so the plan no longer changes it.`,
    moves: [0],
  };
}

function selectRunGroups(input: {
  readonly team: TeamId;
  readonly mode: RunMode;
  readonly facts: TransactionPlanTeamFacts;
  readonly open: ReadonlyArray<TransactionMoveRowRecord>;
  readonly entries: ReadonlyMap<TransactionMoveId, TransactionPlanMoveEvaluation>;
  readonly only?: ReadonlySet<TransactionMoveId>;
}): RunSelection {
  const considered =
    input.only === undefined
      ? input.open
      : EffectArray.filter(input.open, (move) => input.only?.has(move.id) === true);
  const due = EffectArray.filter(considered, (move) =>
    runCandidate({
      move,
      entry: entryOf(input.entries, move.id),
      mode: input.mode,
    }),
  );
  const dueIds = new Set(EffectArray.map(due, (move) => move.id));
  const peers = new Map<string, Array<TransactionMoveRowRecord>>();
  for (const move of due) {
    const key = move.group ?? move.id;
    if (peers.has(key)) {
      continue;
    }
    peers.set(
      key,
      EffectArray.filter(considered, (open) => (open.group ?? open.id) === key),
    );
  }
  const groups: Array<RunGroup> = [];
  const refused: Array<TransactionPlanRunRefusal> = [];
  for (const [key, members] of peers) {
    const missing = EffectArray.filter(members, (move) => !dueIds.has(move.id));
    if (missing.length > 0) {
      refused.push({
        code: "group_not_selected",
        team: input.team,
        detail:
          input.mode === "submit"
            ? "A group runs whole, so every move in it must be confirmed for today."
            : input.mode === "retry"
              ? "A group runs whole, so every move in it must be retried together."
              : "A group runs whole, so every move in it must be confirmed and due on the same league day.",
        moves: EffectArray.map(members, (move) => move.id),
      });
      continue;
    }
    groups.push({
      key,
      moves: [...members].sort(
        (left, right) =>
          runPositionOf(entryOf(input.entries, left.id), left) -
            runPositionOf(entryOf(input.entries, right.id), right) ||
          EffectString.localeCompare(left.id, right.id),
      ),
    });
  }
  groups.sort(
    (left, right) =>
      groupPosition(left, input.entries) - groupPosition(right, input.entries) ||
      EffectString.localeCompare(left.key, right.key),
  );
  return {
    selected: EffectArray.flatMap(groups, (group) => {
      const flatMapped16 = group.moves;
      return arrayValueIsArray(flatMapped16) ? flatMapped16 : [flatMapped16];
    }),
    groups,
    refused,
  };
}

function runCandidate(input: {
  readonly move: TransactionMoveRowRecord;
  readonly entry: TransactionPlanMoveEvaluation;
  readonly mode: RunMode;
}): boolean {
  if (!isOpenMove(input.move)) {
    return false;
  }
  if (input.mode === "retry") {
    return input.move.result === "failed" || input.move.result === "skipped";
  }
  if (input.move.result !== undefined) {
    return false;
  }
  if (input.mode === "submit") {
    return input.entry.dueToday;
  }
  return input.entry.dueToday && input.move.kind !== "trade";
}

function blockingRunDependency(input: {
  readonly group: RunGroup;
  readonly entries: ReadonlyMap<TransactionMoveId, TransactionPlanMoveEvaluation>;
  readonly openById: ReadonlyMap<TransactionMoveId, TransactionMoveRowRecord>;
  readonly outcomes: ReadonlyMap<TransactionMoveId, TransactionMoveResult>;
  readonly selected: ReadonlySet<TransactionMoveId>;
  readonly deferred: ReadonlySet<TransactionMoveId>;
}): RunBlockage | undefined {
  for (const move of input.group.moves) {
    const entry = entryOf(input.entries, move.id);
    for (const dependency of entry.dependsOn) {
      if (EffectArray.some(input.group.moves, (member) => member.id === dependency)) {
        continue;
      }
      if (input.deferred.has(dependency)) {
        return { kind: "deferred" };
      }
      const dependencyMove = input.openById.get(dependency);
      const outcome = input.outcomes.get(dependency);
      if (outcome !== undefined) {
        if (outcome === "executed" || (outcome === "pending" && dependencyMove?.kind !== "trade")) {
          continue;
        }
        return {
          kind: "hard",
          detail: `${describeTransactionPlanMove(move)} did not run because ${describeDependency(dependencyMove, dependency, outcome)}.`,
        };
      }
      if (input.selected.has(dependency)) {
        continue;
      }
      const stored = dependencyMove?.result;
      if (stored === "executed" || (stored === "pending" && dependencyMove?.kind !== "trade")) {
        continue;
      }
      return {
        kind: "hard",
        detail: `${describeTransactionPlanMove(move)} did not run because ${describeDependency(dependencyMove, dependency, stored)}.`,
      };
    }
  }
  return undefined;
}

function describeDependency(
  move: TransactionMoveRowRecord | undefined,
  dependency: TransactionMoveId,
  result: TransactionMoveResult | undefined,
): string {
  const label = move === undefined ? dependency : describeTransactionPlanMove(move);
  switch (result) {
    case "pending":
      return `${label} waits on the league's answer`;
    case "unknown":
      return `${label} has an unknown outcome`;
    case "failed":
    case "skipped":
      return `${label} did not pass its check`;
    case "executed":
      return `${label} has ended`;
    case undefined:
      return `${label} is not part of this run`;
  }
}

function writeRequestOf(input: {
  readonly userId: UserId;
  readonly team: TeamId;
  readonly move: TransactionMoveRowRecord;
  readonly entry: TransactionPlanMoveEvaluation;
}): TransactionPlanWriteRequest {
  return {
    userId: input.userId,
    team: input.team,
    move: input.move.id,
    kind: input.move.kind,
    adds: EffectArray.map(input.move.adds, (add) => add.key),
    drops: EffectArray.map(input.move.drops, (drop) => drop.key),
    picks: input.move.picks,
    slotMove: input.move.slotMove,
    intent: input.move.intent,
    placement: input.entry.placement ?? input.move.placement,
    bid: input.move.bid,
    counterpartyKey: input.move.counterpartyKey,
  };
}

function writeResultOf(write: TransactionPlanWriteResult): DecidedWrite {
  switch (write.status) {
    case "executed":
      return { status: "settled", result: "executed", detail: undefined, actions: write.actions };
    case "pending":
      return { status: "settled", result: "pending", detail: write.detail, actions: write.actions };
    case "failed":
      return { status: "settled", result: "failed", detail: write.detail, actions: write.actions };
    case "unknown":
      return { status: "settled", result: "unknown", detail: write.detail, actions: write.actions };
    case "retry":
      return { status: "retry" };
  }
}

function settlementOf(input: {
  readonly move: TransactionMoveRowRecord;
  readonly entry: TransactionPlanMoveEvaluation;
  readonly result: TransactionMoveResult;
  readonly detail: string | undefined;
  readonly facts: TransactionPlanTeamFacts;
  readonly at: DateTime.Utc;
  readonly attempted: boolean;
  readonly actions: ReadonlyArray<TransactionPlanAction>;
  readonly phase?: TransactionMovePhase | undefined;
  readonly attempts?: ReadonlyArray<StoredMoveAttempt>;
  readonly content?: TransactionMoveSettlement["content"];
  readonly run:
    | {
        readonly id: TransactionRunId;
        readonly at: DateTime.Utc;
        readonly decidedBy: TransactionDecisionActor | undefined;
        readonly surface: string | undefined;
      }
    | undefined;
}): TransactionMoveSettlement {
  return {
    move: input.move.id,
    result: input.result,
    detail: input.detail,
    validation: input.entry.validation,
    runDay: input.entry.runDay,
    effectiveDate: input.entry.effectiveDate,
    runPosition: input.entry.runPosition,
    phase: input.phase ?? input.move.phase,
    attempts: input.attempts ?? input.move.attempts,
    content: input.content,
    run: input.run,
    steps: input.attempted
      ? EffectArray.map(input.actions, (action) => ({ ...action, decidedAt: input.at }))
      : [],
  };
}

function reconcileClaim(input: {
  readonly move: TransactionMoveRowRecord;
  readonly facts: TransactionPlanTeamFacts;
  readonly open: ReadonlyArray<TransactionMoveRowRecord>;
  readonly userId: UserId;
  readonly team: TeamId;
  readonly at: DateTime.Utc;
  readonly runId: TransactionRunId;
  readonly writes: TransactionPlanWritesShape;
}): Effect.Effect<
  | { readonly result: TransactionMoveResult; readonly settlement: TransactionMoveSettlement }
  | undefined
> {
  const outcome = claimOutcomeOf(input.move, input.facts);
  if (outcome.status === "with_league") {
    return Effect.undefined;
  }
  const base = claimAttemptsOf(input.move, input.at);
  const claim = input.move.adds[0];
  if (claim === undefined) {
    return Effect.die(new Error("A submitted claim named no player"));
  }
  if (outcome.status === "won") {
    const attempts = withAttempt(base, {
      kind: "claim",
      player: claim,
      outcome: "won",
      reason: outcome.reason,
      at: input.at,
    });
    return Effect.succeed({
      result: "executed",
      settlement: claimSettlement({
        move: input.move,
        facts: input.facts,
        at: input.at,
        runId: input.runId,
        result: "executed",
        detail: outcome.reason,
        phase: "won",
        attempts,
        runDay: input.facts.today,
        effectiveDate: input.facts.today,
        content: undefined,
        steps: [
          {
            kind: "add",
            playerKey: claim.key,
            outcome: "executed",
            detail: outcome.reason,
            decidedAt: input.at,
          },
        ],
      }),
    });
  }
  return Effect.gen(function* () {
    let attempts = withAttempt(base, {
      kind: "claim",
      player: claim,
      outcome: "lost",
      reason: outcome.reason,
      at: input.at,
    });
    const fallbacks = fallbacksToTry(input.move);
    for (const fallback of fallbacks) {
      const candidate = fallbackClaimMove(input.move, fallback, input.facts.today);
      const evaluation = evaluateTransactionPlan({
        facts: input.facts,
        moves: [...EffectArray.filter(input.open, (move) => move.id !== input.move.id), candidate],
        checkedAt: input.at,
      });
      const entry = EffectOption.getOrUndefined(
        EffectArray.findFirst(evaluation.moves, (held) => held.move === input.move.id),
      );
      if (entry === undefined || entry.validation.status !== "current") {
        attempts = withAttempt(attempts, {
          kind: "fallback",
          player: fallback,
          outcome: "unavailable",
          reason:
            entry?.validation.reasons[0]?.detail ??
            "This fallback is no longer available in your league.",
          at: input.at,
        });
        continue;
      }
      const write = yield* input.writes.apply(
        writeRequestOf({
          userId: input.userId,
          team: input.team,
          move: candidate,
          entry,
        }),
      );
      const decided = writeResultOf(write);
      if (decided.status === "retry") {
        attempts = withAttempt(attempts, {
          kind: "fallback",
          player: fallback,
          outcome: "retry",
          reason: write.status === "retry" ? write.detail : "The league could not be read.",
          at: input.at,
        });
        return {
          result: "pending",
          settlement: claimSettlement({
            move: input.move,
            facts: input.facts,
            at: input.at,
            runId: input.runId,
            result: "pending",
            detail: `The claim was lost. ${fallbackLabel(fallback)} could not be sent; the next check tries it again.`,
            phase: "lost",
            attempts,
            runDay: input.move.runDay ?? input.facts.today,
            effectiveDate: undefined,
            content: undefined,
            steps: [],
          }),
        };
      }
      if (decided.result === "failed") {
        attempts = withAttempt(attempts, {
          kind: "fallback",
          player: fallback,
          outcome: "failed",
          reason: decided.detail ?? "Your league refused this fallback.",
          at: input.at,
        });
        continue;
      }
      if (decided.result === "unknown") {
        attempts = withAttempt(attempts, {
          kind: "fallback",
          player: fallback,
          outcome: "unknown",
          reason: decided.detail ?? "Your league did not confirm this fallback.",
          at: input.at,
        });
        return {
          result: "unknown",
          settlement: claimSettlement({
            move: input.move,
            facts: input.facts,
            at: input.at,
            runId: input.runId,
            result: "unknown",
            detail: decided.detail ?? "Your league did not confirm this fallback.",
            phase: "lost",
            attempts,
            runDay: entry.runDay,
            effectiveDate: entry.effectiveDate,
            content: fallbackContent(fallback),
            steps: EffectArray.map(decided.actions, (action) => ({
              ...action,
              decidedAt: input.at,
            })),
          }),
        };
      }
      attempts = withAttempt(attempts, {
        kind: "fallback",
        player: fallback,
        outcome: "executed",
        reason: "Added after the league did not award the claim.",
        at: input.at,
        ...(entry.effectiveDate === undefined ? {} : { effectiveDate: entry.effectiveDate }),
      });
      return {
        result: "executed",
        settlement: claimSettlement({
          move: input.move,
          facts: input.facts,
          at: input.at,
          runId: input.runId,
          result: "executed",
          detail: `The claim was lost. ${fallbackLabel(fallback)} was added instead.`,
          phase: "lost",
          attempts,
          runDay: entry.runDay,
          effectiveDate: entry.effectiveDate,
          content: fallbackContent(fallback),
          steps: EffectArray.map(decided.actions, (action) => ({ ...action, decidedAt: input.at })),
        }),
      };
    }
    return {
      result: "failed",
      settlement: claimSettlement({
        move: input.move,
        facts: input.facts,
        at: input.at,
        runId: input.runId,
        result: "failed",
        detail: allChoicesFailed(attempts),
        phase: "lost",
        attempts,
        runDay: input.move.runDay ?? input.facts.today,
        effectiveDate: undefined,
        content: undefined,
        steps: [],
      }),
    };
  });
}

function claimOutcomeOf(
  move: TransactionMoveRowRecord,
  facts: TransactionPlanTeamFacts,
):
  | { readonly status: "with_league"; readonly reason: string }
  | { readonly status: "won"; readonly reason: string }
  | { readonly status: "lost"; readonly reason: string } {
  const claim = move.adds[0];
  if (claim === undefined) {
    return { status: "lost", reason: "The claim named no player, so there was nothing to award." };
  }
  const name = claim.name ?? claim.key;
  if (EffectArray.some(facts.roster, (player) => player.key === claim.key)) {
    return { status: "won", reason: `The league added ${name} to your roster.` };
  }
  switch (facts.poolStatus.get(claim.key)) {
    case "waiver":
      return { status: "with_league", reason: `Your league has not processed ${name} yet.` };
    case "free_agent":
      return {
        status: "lost",
        reason: `The league did not award ${name}; they are a free agent.`,
      };
    case "rostered":
      return {
        status: "lost",
        reason: `The league awarded ${name} to another team.`,
      };
    case "unknown":
    case undefined:
      return {
        status: "with_league",
        reason: `Your league has not published ${name}'s outcome yet.`,
      };
  }
}

function claimSettlement(input: {
  readonly move: TransactionMoveRowRecord;
  readonly facts: TransactionPlanTeamFacts;
  readonly at: DateTime.Utc;
  readonly runId: TransactionRunId;
  readonly result: TransactionMoveResult;
  readonly detail: string;
  readonly phase: TransactionMovePhase;
  readonly attempts: ReadonlyArray<StoredMoveAttempt>;
  readonly runDay: StoredMoveDate;
  readonly effectiveDate: StoredMoveDate | undefined;
  readonly content: TransactionMoveSettlement["content"];
  readonly steps: ReadonlyArray<StoredMoveStep>;
}): TransactionMoveSettlement {
  return {
    move: input.move.id,
    result: input.result,
    detail: input.detail,
    validation: { status: "current", checkedAt: input.at, reasons: [] },
    runDay: input.runDay,
    effectiveDate: input.effectiveDate,
    runPosition: input.move.runPosition,
    phase: input.phase,
    attempts: input.attempts,
    content: input.content,
    run: {
      id: input.runId,
      at: input.at,
      decidedBy: "system",
      surface: "automation.run",
    },
    steps: input.steps,
  };
}

function claimAttemptsOf(
  move: TransactionMoveRowRecord,
  at: DateTime.Utc,
): ReadonlyArray<StoredMoveAttempt> {
  if (move.attempts.length > 0) {
    return move.attempts;
  }
  const claim = move.adds[0];
  if (claim === undefined) {
    return [];
  }
  return [
    {
      kind: "claim",
      player: claim,
      outcome: "pending",
      reason: "Submitted to the league.",
      at: move.resultAt ?? at,
    },
  ];
}

function claimSubmittedAttempts(
  move: TransactionMoveRowRecord,
  detail: string,
  at: DateTime.Utc,
): ReadonlyArray<StoredMoveAttempt> {
  const claim = move.adds[0];
  if (claim === undefined) {
    return move.attempts;
  }
  return withAttempt(claimAttemptsOf(move, at), {
    kind: "claim",
    player: claim,
    outcome: "pending",
    reason: detail,
    at,
  });
}

function withAttempt(
  attempts: ReadonlyArray<StoredMoveAttempt>,
  attempt: StoredMoveAttempt,
): ReadonlyArray<StoredMoveAttempt> {
  const index = EffectOption.getOrElse(
    EffectArray.findFirstIndex(
      attempts,
      (held) => held.kind === attempt.kind && held.player.key === attempt.player.key,
    ),
    () => -1,
  );
  if (index === -1) {
    return [...attempts, attempt];
  }
  return EffectArray.map(attempts, (held, position) => (position === index ? attempt : held));
}

function fallbacksToTry(move: TransactionMoveRowRecord): ReadonlyArray<StoredMovePlayer> {
  const tried = new Map(
    EffectArray.map(
      EffectArray.filter(move.attempts, (attempt) => attempt.kind === "fallback"),
      (attempt) => [attempt.player.key, attempt.outcome] as const,
    ),
  );
  return EffectArray.filter(move.fallbacks, (fallback) => {
    const outcome = tried.get(fallback.key);
    return outcome === undefined || outcome === "retry";
  });
}

function fallbackClaimMove(
  move: TransactionMoveRowRecord,
  fallback: StoredMovePlayer,
  today: StoredMoveDate,
): TransactionMoveRowRecord {
  return {
    ...move,
    kind: "free_agent_add",
    adds: [fallback],
    picks: [],
    slotMove: undefined,
    intent: { kind: "add", to: move.intent?.to ?? "active" },
    placement: undefined,
    bid: undefined,
    runDay: today,
    effectiveDate: undefined,
    decision: "now",
    result: undefined,
    phase: "lost",
  };
}

function fallbackContent(fallback: StoredMovePlayer): TransactionMoveSettlement["content"] {
  return { kind: "free_agent_add", adds: [fallback], fallbacks: [], bid: undefined };
}

function fallbackLabel(fallback: StoredMovePlayer): string {
  return `Your fallback ${fallback.name ?? fallback.key}`;
}

function allChoicesFailed(attempts: ReadonlyArray<StoredMoveAttempt>): string {
  const tried = EffectArray.map(
    attempts,
    (attempt) =>
      `${attempt.kind === "claim" ? "Claim" : "Fallback"} ${attempt.player.name ?? attempt.player.key}: ${attempt.reason}`,
  );
  return EffectArray.join([...tried, "All choices failed. Nothing is waiting."], " ");
}

function emptyRunCounts(): MutableRunCounts {
  return {
    plans: 0,
    claimed: 0,
    busy: 0,
    recovered: 0,
    unavailable: 0,
    moves: 0,
    executed: 0,
    pending: 0,
    failed: 0,
    skipped: 0,
    unknown: 0,
    retry: 0,
  };
}

function countRunResult(counts: MutableRunCounts, result: TransactionMoveResult): void {
  switch (result) {
    case "executed":
      counts.executed += 1;
      return;
    case "pending":
      counts.pending += 1;
      return;
    case "failed":
      counts.failed += 1;
      return;
    case "skipped":
      counts.skipped += 1;
      return;
    case "unknown":
      counts.unknown += 1;
      return;
  }
}

function planProjection(input: {
  readonly facts: TransactionPlanTeamFacts;
  readonly open: ReadonlyArray<TransactionPlanMove>;
  readonly stored: ReadonlyArray<TransactionPlanMove>;
}): ReadonlyArray<TransactionPlanMove> {
  return [
    ...input.open,
    ...projectionLegs({
      facts: input.facts,
      submitted: EffectArray.filter(input.stored, (move) => move.result === "executed"),
      dates: effectiveDatesOf(input.open),
    }),
  ];
}

function effectiveDatesOf(
  moves: ReadonlyArray<Pick<TransactionPlanMove, "effectiveDate">>,
): ReadonlyArray<StoredMoveDate> {
  return [
    ...new Set(
      EffectArray.flatMap(moves, (move) => {
        const flatMapped17 = move.effectiveDate === undefined ? [] : [move.effectiveDate];
        return arrayValueIsArray(flatMapped17) ? flatMapped17 : [flatMapped17];
      }),
    ),
  ];
}

function projectionLegs(input: {
  readonly facts: TransactionPlanTeamFacts;
  readonly submitted: ReadonlyArray<TransactionPlanMove>;
  readonly dates: ReadonlyArray<StoredMoveDate>;
}): ReadonlyArray<TransactionPlanMove> {
  return projectedLegs({
    rule: rosterRuleOf(input.facts.constraints, input.facts.slots),
    roster: input.facts.roster,
    submitted: input.submitted,
    dates: input.dates,
  });
}

function runPositionOf(
  entry: TransactionPlanMoveEvaluation,
  move: TransactionMoveRowRecord,
): number {
  return entry.runPosition ?? move.position;
}

function groupPosition(
  group: RunGroup,
  entries: ReadonlyMap<TransactionMoveId, TransactionPlanMoveEvaluation>,
): number {
  return EffectArray.reduce(group.moves, Number.MAX_SAFE_INTEGER, (position, move) =>
    Math.min(position, runPositionOf(entryOf(entries, move.id), move)),
  );
}

function staleClaimBefore(at: DateTime.Utc): DateTime.Utc {
  return DateTime.subtractDuration(at, transactionPlanRunStaleMillis);
}

function planKey(plan: TransactionPlanRef): string {
  return `${plan.userId}:${plan.team}`;
}

function planViewOf(input: {
  readonly stored: ReadonlyArray<TransactionMoveRecord>;
  readonly facts: TransactionPlanTeamFacts;
  readonly checkedAt: DateTime.Utc;
  readonly team: TeamId;
}): TransactionPlanView {
  const open = EffectArray.filter(input.stored, isOpenMove);
  const openIds = new Set(EffectArray.map(open, (move) => move.id));
  const evaluation = evaluateTransactionPlan({
    facts: input.facts,
    moves: planProjection({ facts: input.facts, open, stored: input.stored }),
    checkedAt: input.checkedAt,
  });
  const evaluated = evaluatedMoves(evaluation);
  const blockages = new Map(
    EffectArray.map(evaluation.order.blocked, (entry) => [entry.move, entry.detail] as const),
  );
  const openById = new Map(EffectArray.map(open, (move) => [move.id, move] as const));
  const runOrder = EffectArray.flatMap(evaluation.order.steps, (step) => {
    const flatMapped18 = openIds.has(step.move) ? [step.move] : [];
    return arrayValueIsArray(flatMapped18) ? flatMapped18 : [flatMapped18];
  });
  const runOrderIds = new Set(runOrder);
  const ordered = [
    ...EffectArray.map(runOrder, (id) => requireMove(openById, id)),
    ...EffectArray.filter(open, (move) => !runOrderIds.has(move.id)),
    ...EffectArray.filter(input.stored, (move) => !openIds.has(move.id)),
  ];
  return {
    team: input.team,
    today: input.facts.today,
    moves: EffectArray.map(ordered, (move) =>
      moveView(move, evaluated.get(move.id), blockages.get(move.id), input.facts.today),
    ),
    groups: evaluation.groups,
  };
}

function moveView(
  move: TransactionMoveRecord,
  entry: TransactionPlanMoveEvaluation | undefined,
  blockage: string | undefined,
  today: StoredMoveDate,
): TransactionPlanMoveView {
  return {
    move: move.id,
    group: move.group,
    kind: move.kind,
    adds: move.adds,
    fallbacks: move.fallbacks,
    drops: move.drops,
    picks: move.picks,
    slotMove: move.slotMove,
    intent: move.intent,
    counterpartyKey: move.counterpartyKey,
    bid: move.bid,
    reason: move.reason,
    decision: planDecision(move, today),
    runDay: entry?.runDay ?? move.runDay,
    effectiveDate: entry?.effectiveDate ?? move.effectiveDate,
    sendsAt: entry?.sendsAt,
    dueToday: entry?.dueToday ?? false,
    phase: move.phase,
    attempts: move.attempts,
    validation: entry?.validation ?? move.validation,
    placement: entry?.placement ?? move.placement,
    claims: entry?.claims ?? move.claims,
    runPosition: entry?.runPosition,
    dependsOn: entry?.dependsOn ?? [],
    blockage,
    projection: entry?.projectedRoster ?? [],
    ...(move.decidedAt === undefined ? {} : { decidedAt: move.decidedAt }),
    ...(move.confirmedAt === undefined || move.confirmedBy === undefined
      ? {}
      : { confirmation: { by: move.confirmedBy, at: move.confirmedAt } }),
    ...(move.runAt === undefined ? {} : { runAt: move.runAt }),
  };
}

function draftCandidate(input: {
  readonly draft: TransactionPlanMoveDraft;
  readonly id: TransactionMoveId;
  readonly position: number;
  readonly group: string | undefined;
  readonly effectiveDate: StoredMoveDate | undefined;
  readonly roster: ReadonlyMap<string, TransactionPlanRosterPlayer>;
  readonly facts: TransactionPlanTeamFacts;
}): CandidateMove {
  const draft = input.draft;
  return {
    id: input.id,
    group: input.group,
    position: input.position,
    kind: draft.kind,
    adds: EffectArray.map(draft.adds ?? [], (key) => poolPlayer(key, input.facts)),
    fallbacks: EffectArray.map(draft.fallbacks ?? [], (key) => poolPlayer(key, input.facts)),
    drops: EffectArray.map(draft.drops ?? [], (key) => rosterPlayer(key, input.roster)),
    picks: draft.picks ?? [],
    slotMove:
      draft.slotMove === undefined
        ? undefined
        : storedSlot(input.roster, draft.slotMove.player, draft.slotMove.toSlot),
    intent: draftIntent(draft, input.roster),
    counterpartyKey: draft.counterparty,
    bid: draft.bid,
    reason: draft.reason,
    runDay: draft.runDay,
    effectiveDate: input.effectiveDate,
    decision: decisionFor(draft.runDay, input.facts.today),
    result: undefined,
  };
}

function draftIntent(
  draft: TransactionPlanMoveDraft,
  roster: ReadonlyMap<string, TransactionPlanRosterPlayer>,
): StoredMoveIntent | undefined {
  if (draft.kind === "activate" || draft.kind === "stash") {
    return {
      kind: draft.kind,
      ...(draft.player === undefined ? {} : { player: rosterPlayer(draft.player, roster) }),
    };
  }
  if (draft.kind === "free_agent_add" || draft.kind === "waiver_claim") {
    return { kind: "add", to: draft.to ?? "active" };
  }
  return undefined;
}

function proposedGroups(entries: ReadonlyArray<ProposedEntry>): ReadonlyArray<DraftGroup> {
  const groups = new Map<string, DraftGroup>();
  for (const entry of entries) {
    const held = groups.get(entry.settleKey);
    if (held === undefined) {
      groups.set(entry.settleKey, {
        label: entry.label,
        indexes: [entry.index],
        moves: [entry.candidate],
      });
      continue;
    }
    if (!held.indexes.includes(entry.index)) {
      held.indexes.push(entry.index);
    }
    held.moves.push(entry.candidate);
  }
  return [...groups.values()];
}

function fixCandidateOf(input: {
  readonly fix: RosterFixDraft;
  readonly id: TransactionMoveId;
  readonly group: string;
  readonly funded: TransactionPlanMove;
}): CandidateMove {
  const fix = input.fix;
  return {
    id: input.id,
    group: input.group,
    position: input.funded.position,
    kind: fix.kind,
    adds: [],
    fallbacks: [],
    drops: [],
    picks: [],
    slotMove:
      fix.kind === "slot_move" && fix.toSlot !== undefined
        ? { playerKey: fix.playerKey, playerName: fix.playerName, toSlot: fix.toSlot }
        : undefined,
    intent:
      fix.kind === "slot_move"
        ? undefined
        : { kind: fix.kind, player: { key: fix.playerKey, name: fix.playerName } },
    counterpartyKey: undefined,
    bid: undefined,
    reason: fix.detail,
    runDay: input.funded.runDay,
    effectiveDate: input.funded.effectiveDate,
    decision: input.funded.decision,
    result: undefined,
  };
}

function ownerDecision(surface: string): TransactionDecision {
  return { decidedBy: "owner", surface };
}

function storedSnapshot(moves: ReadonlyArray<TransactionMoveRecord>): TransactionPlanSnapshot {
  const initial = optionalValue<DateTime.Utc>();
  const latest = EffectArray.reduce(moves, initial, (found, move) =>
    move.validation.checkedAt !== undefined &&
    (found === undefined || move.validation.checkedAt > found)
      ? move.validation.checkedAt
      : found,
  );
  return latest === undefined
    ? {
        status: "unavailable",
        note: "The league and roster could not be read live, and no move carries a recorded check.",
      }
    : {
        status: "stored",
        checkedAt: latest,
        note: "The league and roster could not be read live, so this is the most recent recorded check.",
      };
}

function appendOf(
  candidate: CandidateMove,
  entry: TransactionPlanMoveEvaluation,
  claims: ReadonlyArray<StoredMoveClaim>,
  proposedBy: TransactionMoveProvenance,
  decision: TransactionDecision,
  at: DateTime.Utc,
): TransactionMoveAppend {
  return {
    id: candidate.id,
    proposedBy,
    content: {
      group: candidate.group,
      kind: candidate.kind,
      adds: candidate.adds,
      fallbacks: candidate.fallbacks,
      drops: candidate.drops,
      picks: candidate.picks,
      slotMove: candidate.slotMove,
      intent: candidate.intent,
      placement: entry.placement,
      counterpartyKey: candidate.counterpartyKey,
      bid: candidate.bid,
      reason: candidate.reason,
      runDay: candidate.runDay,
      effectiveDate: entry.effectiveDate,
      phase: undefined,
      attempts: [],
      decision: candidate.decision,
      decidedAt: candidate.decision === "saved" ? at : undefined,
      decidedBy: decision.decidedBy,
      surface: decision.surface,
      confirmedAt: undefined,
      confirmedBy: undefined,
      validation: entry.validation,
    },
    claims,
  };
}

function contentOfMove(
  move: TransactionMoveRecord,
  entry: TransactionPlanMoveEvaluation,
  runDay: StoredMoveDate | undefined,
  today: StoredMoveDate,
  decision: TransactionDecision,
  at: DateTime.Utc,
): TransactionMoveContent {
  return {
    group: move.group,
    kind: move.kind,
    adds: move.adds,
    fallbacks: move.fallbacks,
    drops: move.drops,
    picks: move.picks,
    slotMove: move.slotMove,
    intent: move.intent,
    placement: entry.placement,
    counterpartyKey: move.counterpartyKey,
    bid: move.bid,
    reason: move.reason,
    runDay,
    effectiveDate: entry.effectiveDate,
    phase: move.phase,
    attempts: move.attempts,
    decision: decisionFor(runDay, today),
    decidedAt: decisionFor(runDay, today) === "saved" ? at : undefined,
    decidedBy: decision.decidedBy,
    surface: decision.surface,
    confirmedAt: undefined,
    confirmedBy: undefined,
    validation: entry.validation,
  };
}

function contentOfCandidate(
  candidate: CandidateMove,
  entry: TransactionPlanMoveEvaluation,
  today: StoredMoveDate,
  decision: TransactionDecision,
  at: DateTime.Utc,
): TransactionMoveContent {
  return {
    group: candidate.group,
    kind: candidate.kind,
    adds: candidate.adds,
    fallbacks: candidate.fallbacks,
    drops: candidate.drops,
    picks: candidate.picks,
    slotMove: candidate.slotMove,
    intent: candidate.intent,
    placement: entry.placement,
    counterpartyKey: candidate.counterpartyKey,
    bid: candidate.bid,
    reason: candidate.reason,
    runDay: candidate.runDay,
    effectiveDate: entry.effectiveDate,
    phase: undefined,
    attempts: [],
    decision: decisionFor(candidate.runDay, today),
    decidedAt: decisionFor(candidate.runDay, today) === "saved" ? at : undefined,
    decidedBy: decision.decidedBy,
    surface: decision.surface,
    confirmedAt: undefined,
    confirmedBy: undefined,
    validation: entry.validation,
  };
}

function preservedDecisionOf(
  move: TransactionMoveRecord,
): Pick<
  TransactionMoveContent,
  "decision" | "decidedAt" | "decidedBy" | "surface" | "confirmedAt" | "confirmedBy"
> {
  return {
    decision: move.decision,
    decidedAt: move.decidedAt,
    decidedBy: move.decidedBy,
    surface: move.surface,
    confirmedAt: move.confirmedAt,
    confirmedBy: move.confirmedBy,
  };
}

function sameMoveShape(move: TransactionMoveRecord, candidate: CandidateMove): boolean {
  return (
    move.kind === candidate.kind &&
    samePlayerKeys(move.adds, candidate.adds) &&
    samePlayerKeys(move.fallbacks, candidate.fallbacks) &&
    samePlayerKeys(move.drops, candidate.drops) &&
    samePicks(move.picks, candidate.picks) &&
    sameSlot(move.slotMove, candidate.slotMove) &&
    sameIntent(move.intent, candidate.intent) &&
    move.counterpartyKey === candidate.counterpartyKey &&
    move.bid === candidate.bid &&
    move.reason === candidate.reason &&
    move.runDay === candidate.runDay
  );
}

function samePlayerKeys(
  left: ReadonlyArray<StoredMovePlayer>,
  right: ReadonlyArray<StoredMovePlayer>,
): boolean {
  return (
    left.length === right.length &&
    EffectArray.every(left, (player, index) => player.key === right[index]?.key)
  );
}

function samePicks(
  left: ReadonlyArray<StoredMovePick>,
  right: ReadonlyArray<StoredMovePick>,
): boolean {
  return (
    left.length === right.length &&
    EffectArray.every(left, (pick, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        pick.round === other.round &&
        pick.sourceTeamKey === other.sourceTeamKey &&
        pick.destinationTeamKey === other.destinationTeamKey
      );
    })
  );
}

function sameSlot(left: StoredMoveSlot | undefined, right: StoredMoveSlot | undefined): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.playerKey === right.playerKey && left.toSlot === right.toSlot;
}

function sameIntent(
  left: StoredMoveIntent | undefined,
  right: StoredMoveIntent | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.kind === right.kind && left.to === right.to && left.player?.key === right.player?.key;
}

function movedToDay(
  move: TransactionPlanMove,
  runDay: StoredMoveDate | undefined,
  today: StoredMoveDate,
): TransactionPlanMove {
  return { ...move, runDay, effectiveDate: undefined, decision: decisionFor(runDay, today) };
}

function groupMemberOf(
  move: TransactionMoveRecord,
  check: TransactionTeamCheck | undefined,
): TransactionPlanGroupMember {
  const evaluated = check?.status === "checked" ? check.moves.get(move.id) : undefined;
  if (check?.status !== "checked" || evaluated === undefined) {
    return {
      move,
      validation: move.validation,
      blockedBy: undefined,
      runPosition: move.runPosition,
    };
  }
  return {
    move,
    validation: evaluated.validation,
    blockedBy: check.blocked.get(move.id),
    runPosition: evaluated.runPosition ?? move.runPosition,
  };
}

function withCure(
  refusal: TransactionPlanRefusal,
  cure: string | undefined,
): TransactionPlanRefusal {
  return { ...refusal, detail: cured(refusal.detail, cure) };
}

function cured(detail: string, cure: string | undefined): string {
  return cure === undefined || EffectString.endsWith(detail, cure) ? detail : `${detail} ${cure}`;
}

function fixPeers(
  open: ReadonlyArray<TransactionMoveRecord>,
  move: TransactionMoveRecord,
): ReadonlyArray<TransactionMoveRecord> {
  const group = rosterFixGroupOf(move.id);
  return EffectArray.filter(open, (entry) => entry.group === group);
}

function nonEmpty<A>(values: ReadonlyArray<A>, detail: string): readonly [A, ...Array<A>] {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new Error(detail);
  }
  return [first, ...rest];
}

function cardMoves(
  stored: ReadonlyArray<TransactionMoveRecord>,
  move: TransactionMoveRecord,
): ReadonlyArray<TransactionMoveRecord> {
  const selected = new Set<TransactionMoveId>();
  const include = (held: TransactionMoveRecord): void => {
    selected.add(held.id);
    for (const peer of stored) {
      if (peer.group !== undefined && peer.group === held.group) {
        selected.add(peer.id);
      }
    }
    for (const fix of fixPeers(stored, held)) {
      selected.add(fix.id);
    }
  };
  include(move);
  const funded = EffectOption.getOrUndefined(
    EffectArray.findFirst(stored, (entry) => rosterFixGroupOf(entry.id) === move.group),
  );
  if (funded !== undefined) {
    include(funded);
  }
  return EffectArray.filter(stored, (entry) => selected.has(entry.id));
}

function retryRefusal(input: {
  readonly team: TeamId;
  readonly members: ReadonlyArray<TransactionMoveRecord>;
}): TransactionPlanRunRefusal | undefined {
  const refusal = (code: string, detail: string): TransactionPlanRunRefusal => ({
    code,
    team: input.team,
    detail,
    moves: EffectArray.map(input.members, (member) => member.id),
  });
  const executed = EffectOption.getOrUndefined(
    EffectArray.findFirst(input.members, (member) => member.result === "executed"),
  );
  if (executed !== undefined) {
    return refusal(
      "group_ran_in_part",
      `${describeTransactionPlanMove(executed)} already reached your league, so this group cannot be retried whole. Discard what is left instead.`,
    );
  }
  const discarded = EffectOption.getOrUndefined(
    EffectArray.findFirst(input.members, (member) => member.decision === "discarded"),
  );
  if (discarded !== undefined) {
    return refusal(
      "group_not_whole",
      `Part of this group was discarded, so the rest cannot be retried. Discard what is left, or form the move again.`,
    );
  }
  const claimed = EffectOption.getOrUndefined(
    EffectArray.findFirst(input.members, (member) => member.phase !== undefined),
  );
  if (claimed !== undefined) {
    return refusal(
      "move_already_claimed",
      `${describeTransactionPlanMove(claimed)} already went to your league as a claim, so it cannot be retried. Discard what is left.`,
    );
  }
  const waiting = EffectOption.getOrUndefined(
    EffectArray.findFirst(input.members, (member) => member.result === "pending"),
  );
  if (waiting !== undefined) {
    return refusal(
      "move_waiting",
      `${describeTransactionPlanMove(waiting)} waits on the league's answer, so it cannot be retried.`,
    );
  }
  const unknown = EffectOption.getOrUndefined(
    EffectArray.findFirst(input.members, (member) => member.result === "unknown"),
  );
  if (unknown !== undefined) {
    return refusal(
      "move_unknown",
      `${describeTransactionPlanMove(unknown)} has an unknown outcome. Check your league, then discard it or form the move again.`,
    );
  }
  const notFailed = EffectOption.getOrUndefined(
    EffectArray.findFirst(
      input.members,
      (member) => member.result !== "failed" && member.result !== "skipped",
    ),
  );
  if (notFailed !== undefined) {
    return refusal(
      "move_not_failed",
      `Nothing in this group failed, so there is nothing to retry.`,
    );
  }
  const invalid = EffectOption.getOrUndefined(
    EffectArray.findFirst(input.members, (member) => member.validation.status !== "current"),
  );
  if (invalid !== undefined) {
    return refusal(
      "move_check_stale",
      invalid.validation.reasons[0]?.detail ??
        `${describeTransactionPlanMove(invalid)} did not pass its latest check, so it cannot be retried.`,
    );
  }
  return undefined;
}

function confirmationTargets(
  open: ReadonlyArray<TransactionMoveRecord>,
  requested: ReadonlyArray<TransactionMoveRecord>,
): ReadonlyArray<TransactionMoveRecord> {
  const selected = new Set<TransactionMoveId>();
  for (const move of requested) {
    selected.add(move.id);
    for (const peer of groupPeers(open, move)) {
      selected.add(peer.id);
    }
    for (const fix of fixPeers(open, move)) {
      selected.add(fix.id);
    }
    const funded = EffectOption.getOrUndefined(
      EffectArray.findFirst(open, (entry) => rosterFixGroupOf(entry.id) === move.group),
    );
    if (funded === undefined) {
      continue;
    }
    selected.add(funded.id);
    for (const fix of fixPeers(open, funded)) {
      selected.add(fix.id);
    }
  }
  return EffectArray.filter(open, (move) => selected.has(move.id));
}

function isDueMove(move: TransactionMoveRecord, today: StoredMoveDate): boolean {
  return move.runDay === undefined || move.runDay <= today;
}

function groupPeers(
  open: ReadonlyArray<TransactionMoveRecord>,
  move: TransactionMoveRecord,
): ReadonlyArray<TransactionMoveRecord> {
  if (move.group === undefined) {
    return [];
  }
  return EffectArray.filter(open, (entry) => entry.id !== move.id && entry.group === move.group);
}

function poolPlayer(key: string, facts: TransactionPlanTeamFacts): StoredMovePlayer {
  const pooled = facts.pool.get(key);
  if (pooled === undefined) {
    return { key };
  }
  return {
    key,
    name: pooled.name,
    ...(pooled.positions[0] === undefined ? {} : { position: pooled.positions[0] }),
    availability: pooled.availability,
  };
}

function rosterPlayer(
  key: string,
  roster: ReadonlyMap<string, TransactionPlanRosterPlayer>,
): StoredMovePlayer {
  const player = roster.get(key);
  if (player === undefined) {
    return { key };
  }
  return {
    key,
    name: player.name,
    ...(player.positions[0] === undefined ? {} : { position: player.positions[0] }),
  };
}

function storedSlot(
  roster: ReadonlyMap<string, TransactionPlanRosterPlayer>,
  playerKey: string,
  toSlot: string,
): StoredMoveSlot {
  const player = roster.get(playerKey);
  return {
    playerKey,
    ...(player === undefined ? {} : { playerName: player.name }),
    toSlot,
  };
}

function evaluatedMoves(
  evaluation: TransactionPlanEvaluation,
): ReadonlyMap<TransactionMoveId, TransactionPlanMoveEvaluation> {
  return new Map(EffectArray.map(evaluation.moves, (entry) => [entry.move, entry] as const));
}

function entryOf(
  evaluated: ReadonlyMap<TransactionMoveId, TransactionPlanMoveEvaluation>,
  move: TransactionMoveId,
): TransactionPlanMoveEvaluation {
  const entry = evaluated.get(move);
  if (entry === undefined) {
    throw new Error("A plan move was not evaluated");
  }
  return entry;
}

function requireMove(
  open: ReadonlyMap<TransactionMoveId, TransactionMoveRecord>,
  move: TransactionMoveId,
): TransactionMoveRecord {
  const entry = open.get(move);
  if (entry === undefined) {
    throw new Error("An ordered move was not in the plan");
  }
  return entry;
}

function planDecision(move: TransactionMoveRecord, today: StoredMoveDate): TransactionPlanDecision {
  if (move.decision === "discarded") {
    return "discarded";
  }
  if (move.decision === "saved" && (move.runDay === undefined || move.runDay <= today)) {
    return "undecided";
  }
  return move.decision;
}

function decisionFor(
  runDay: StoredMoveDate | undefined,
  today: StoredMoveDate,
): TransactionPlanDecision {
  return runDay === undefined || runDay <= today ? "undecided" : "saved";
}

type TransactionPlanDecision = "undecided" | "saved" | "now" | "confirmed" | "discarded";

function namedPlayers(
  moves: ReadonlyArray<{
    readonly adds: ReadonlyArray<StoredMovePlayer>;
    readonly fallbacks: ReadonlyArray<StoredMovePlayer>;
  }>,
): ReadonlyArray<string> {
  return [
    ...new Set(
      EffectArray.flatMap(moves, (move) => {
        const flatMapped19 = EffectArray.map([...move.adds, ...move.fallbacks], (add) => add.key);
        return arrayValueIsArray(flatMapped19) ? flatMapped19 : [flatMapped19];
      }),
    ),
  ];
}

function draftPlayers(drafts: ReadonlyArray<TransactionPlanMoveDraft>): ReadonlyArray<string> {
  return [
    ...new Set(
      EffectArray.flatMap(drafts, (draft) => {
        const flatMapped20 = [...(draft.adds ?? []), ...(draft.fallbacks ?? [])];
        return arrayValueIsArray(flatMapped20) ? flatMapped20 : [flatMapped20];
      }),
    ),
  ];
}

function needsBudget(
  moves: ReadonlyArray<{ readonly kind?: TransactionMoveKind; readonly bid?: number }>,
): boolean {
  return EffectArray.some(moves, (move) => move.kind === "waiver_claim" || move.bid !== undefined);
}

function requireId(ids: ReadonlyArray<TransactionMoveId>, index: number): TransactionMoveId {
  const id = ids[index];
  if (id === undefined) {
    throw new Error("A drafted move was not assigned an identifier");
  }
  return id;
}

type ProposedEntry = {
  readonly candidate: CandidateMove;
  readonly index: number;
  readonly label: string | undefined;
  readonly settleKey: string;
  readonly funded: TransactionMoveId | undefined;
};

type RunState = {
  readonly members: ReadonlyArray<TransactionMoveRowRecord>;
  readonly index: number;
  readonly facts: TransactionPlanTeamFacts;
  readonly entries: ReadonlyMap<TransactionMoveId, TransactionPlanMoveEvaluation>;
};

type RunStop = "settled" | "retry";

type RunMode = "submit" | "due" | "retry";

type CandidateMove = TransactionPlanMove & {
  readonly reason: string;
  readonly counterpartyKey: string | undefined;
};

type DraftGroup = {
  readonly label: string | undefined;
  readonly indexes: Array<number>;
  readonly moves: Array<TransactionPlanMove>;
};

type DueClaim = {
  readonly plan: TransactionPlanRef;
  readonly facts: TransactionPlanTeamFacts;
  readonly runClaim: string;
};

type RunGroup = {
  readonly key: string;
  readonly moves: ReadonlyArray<TransactionMoveRowRecord>;
};

type RunSelection = {
  readonly selected: ReadonlyArray<TransactionMoveRowRecord>;
  readonly groups: ReadonlyArray<RunGroup>;
  readonly refused: ReadonlyArray<TransactionPlanRunRefusal>;
};

type RunBlockage =
  | { readonly kind: "hard"; readonly detail: string }
  | { readonly kind: "deferred" };

type DecidedWrite =
  | {
      readonly status: "settled";
      readonly result: TransactionMoveResult;
      readonly detail: string | undefined;
      readonly actions: ReadonlyArray<TransactionPlanAction>;
    }
  | { readonly status: "retry" };

type MutableRunCounts = {
  -readonly [Key in keyof TransactionPlanRunCounts]: TransactionPlanRunCounts[Key];
};
