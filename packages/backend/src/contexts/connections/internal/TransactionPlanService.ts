import {
  Array as EffectArray,
  Context,
  Crypto,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import { PlayerRef } from "#contexts/connections/QueryValues.ts";
import {
  TransactionPlanFactsUnavailable,
  TransactionPlanMoveNotFound,
  TransactionPlanPersistenceFailed,
  TransactionPlanRunInProgress,
  TransactionPlanService,
  TransactionPlanTeamNotFound,
  isOpenMove,
} from "#contexts/connections/TransactionPlans.ts";
import type {
  StoredMoveClaim,
  StoredMoveIntent,
  StoredMovePlacement,
  StoredMovePlayer,
  StoredMoveSlot,
  TransactionMoveCursor,
  TransactionMoveId,
  TransactionMoveList,
  TransactionMoveListInput,
  TransactionMovePageLimit,
  TransactionMoveProvenance,
  TransactionMoveReadState,
  TransactionMoveResult,
  TransactionPlanCountsInput,
  TransactionPlanDiscardInput,
  TransactionPlanEditInput,
  TransactionPlanMoveDraft,
  TransactionPlanMoveView,
  TransactionPlanProposeInput,
  TransactionPlanRead,
  TransactionPlanReadInput,
  TransactionPlanRefMoveDraft,
  TransactionPlanRefProposeInput,
  TransactionPlanRefusal,
  TransactionPlanRunCounts,
  TransactionPlanRunRefusal,
  TransactionPlanSaveInput,
  TransactionPlanServiceError,
  TransactionPlanSubmitInput,
  TransactionPlanTodayInput,
  TransactionPlanTodaySubmission,
  TransactionPlanView,
  TransactionTimelineInput,
} from "#contexts/connections/TransactionPlans.ts";

import { QueryTokens } from "./QueryTokens.ts";
import {
  claimTransactionPlanMoves,
  describeTransactionPlanMove,
  evaluateTransactionPlan,
} from "./TransactionPlanEvaluation.ts";
import type {
  TransactionPlanClaimRefusal,
  TransactionPlanEvaluation,
  TransactionPlanMove,
  TransactionPlanMoveEvaluation,
  TransactionPlanRosterPlayer,
  TransactionPlanTeamFacts,
} from "./TransactionPlanEvaluation.ts";
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
  TransactionPlanWriteRequest,
  TransactionPlanWriteResult,
} from "./TransactionPlanWrites.ts";

export {
  TransactionPlanFactsUnavailable,
  TransactionPlanPersistenceFailed,
  TransactionPlanRunInProgress,
  TransactionPlanService,
} from "#contexts/connections/TransactionPlans.ts";

const transactionPlanRunStaleMillis = 10 * 60 * 1000;

export type TransactionPlanFactsShape = {
  readonly read: (input: {
    readonly userId: UserId;
    readonly team: TeamId;
    readonly at: DateTime.Utc;
    readonly players: ReadonlyArray<string>;
    readonly needsBudget: boolean;
  }) => Effect.Effect<TransactionPlanTeamFacts, TransactionPlanFactsUnavailable>;
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
    const crypto = yield* Crypto.Crypto;
    const newId = crypto.randomULID.pipe(
      Effect.mapError((cause) => TransactionPlanPersistenceFailed.make({ cause })),
    );
    const newClaim = crypto.randomULID.pipe(
      Effect.mapError((cause) => TransactionPlanPersistenceFailed.make({ cause })),
    );

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

    const propose = Effect.fn("TransactionPlanService.propose")(function* (
      userId: UserId,
      input: TransactionPlanProposeInput,
    ) {
      const at = yield* DateTime.now;
      yield* repository.loadPlan({ userId, team: input.team, at });
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const open = stored.filter(isOpenMove);
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: [...new Set([...namedPlayers(open), ...draftPlayers(input.moves)])],
        needsBudget: needsBudget(open) || input.moves.some((move) => move.bid !== undefined),
      });
      const roster = new Map(facts.roster.map((player) => [player.key, player] as const));
      const groupIds = new Map(
        yield* Effect.forEach(
          [
            ...new Set(
              input.moves.flatMap((draft) => (draft.group === undefined ? [] : [draft.group])),
            ),
          ],
          (label) => newId.pipe(Effect.map((id) => [label, id] as const)),
        ),
      );
      const firstPosition =
        stored.reduce((position, move) => Math.max(position, move.position), -1) + 1;
      const ids = yield* Effect.forEach(input.moves, () =>
        newId.pipe(Effect.map((id) => Schema.decodeSync(TransactionMoveIdSchema)(id))),
      );
      const candidates = input.moves.map((draft, index) =>
        draftCandidate({
          draft,
          id: requireId(ids, index),
          position: firstPosition + index,
          group: draft.group === undefined ? undefined : groupIds.get(draft.group),
          roster,
          facts,
        }),
      );
      const proposals = draftGroups(input.moves, candidates);
      const settled = settleProposals({
        team: input.team,
        accepted: open,
        proposals,
        facts,
        roster,
        checkedAt: at,
      });

      if (settled.accepted.length > open.length) {
        const evaluation = evaluateTransactionPlan({
          facts,
          moves: settled.accepted,
          checkedAt: at,
        });
        const evaluated = new Map(evaluation.moves.map((entry) => [entry.move, entry] as const));
        const planClaims = claimPlan({ moves: settled.accepted, after: evaluation, roster });
        const appends = candidates
          .filter((candidate) => settled.accepted.includes(candidate))
          .map((candidate) =>
            appendOf(
              candidate,
              entryOf(evaluated, candidate.id),
              planClaims.claims.get(candidate.id) ?? [],
              input.proposedBy,
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
        tokens.openPlayerRefs({
          userId: input.userId,
          leagueKey: input.leagueKey,
          refs: refs.map((ref) => Schema.decodeSync(PlayerRef)(ref)),
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
          adds: addRefs.filter((ref): ref is string => ref !== undefined),
          fallbacks: fallbackRefs.filter((ref): ref is string => ref !== undefined),
          drops: dropRefs.filter((ref): ref is string => ref !== undefined),
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
      const resolved = yield* Effect.forEach(input.moves, (draft, index) =>
        resolveDraft({
          userId,
          team: input.team,
          providerTeamKey: team.value.providerTeamKey,
          teamName: team.value.name,
          leagueKey: team.value.providerLeagueKey,
          draft,
        }).pipe(Effect.map((result) => ({ index, result }))),
      );
      const refused: Array<TransactionPlanRefusal> = resolved.flatMap((entry) =>
        entry.result.status === "refused"
          ? [
              {
                code: entry.result.code,
                team: input.team,
                detail: entry.result.detail,
                moves: [entry.index],
              },
            ]
          : [],
      );
      if (refused.length > 0) {
        const at = yield* DateTime.now;
        const stored = yield* repository.readPlanMoves({ userId, team: input.team });
        const facts = yield* factsPort.read({
          userId,
          team: input.team,
          at,
          players: [],
          needsBudget: false,
        });
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused,
        };
      }
      const resolvedMoves = resolved.flatMap((entry) =>
        entry.result.status === "resolved"
          ? [{ index: entry.index, draft: entry.result.draft }]
          : [],
      );
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
      for (const amendment of amendments) {
        const result = yield* edit(userId, {
          team: input.team,
          move: amendment.move,
          change: amendment.draft,
        });
        for (const refusal of result.refused) {
          refused.push({
            ...refusal,
            moves: refusal.moves.map(() => amendment.index),
          });
        }
        plan = result.plan;
      }
      if (appends.length > 0) {
        const result = yield* propose(userId, {
          team: input.team,
          proposedBy: input.proposedBy,
          moves: appends.map((entry) => entry.draft),
        });
        for (const refusal of result.refused) {
          refused.push({
            ...refusal,
            moves: refusal.moves.map((position) => appends[position]?.index ?? position),
          });
        }
        plan = result.plan;
      }
      if (plan !== undefined) {
        return { plan, refused };
      }
      const at = yield* DateTime.now;
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: [],
        needsBudget: false,
      });
      return {
        plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
        refused,
      };
    });

    const save = Effect.fn("TransactionPlanService.save")(function* (
      userId: UserId,
      input: TransactionPlanSaveInput,
    ) {
      const at = yield* DateTime.now;
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const move = stored.find((entry) => entry.id === input.move);
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const open = stored.filter(isOpenMove);
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: namedPlayers(open),
        needsBudget: needsBudget(open),
      });
      const roster = new Map(facts.roster.map((player) => [player.key, player] as const));
      const refused = moveChangeRefusal({ team: input.team, move });
      if (refused !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [refused],
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
        };
      }

      const before = evaluateTransactionPlan({ facts, moves: open, checkedAt: at });
      const peers = groupPeers(open, move);
      const changed = open.map((entry) =>
        entry.id === move.id || peers.some((peer) => peer.id === entry.id)
          ? movedToDay(entry, input.runDay)
          : entry,
      );
      const after = evaluateTransactionPlan({ facts, moves: changed, checkedAt: at });
      const revalidation = revalidationRefusal({
        team: input.team,
        target: move,
        moves: open,
        before,
        after,
        requireTarget: false,
        indexes: [0],
      });
      if (revalidation !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [revalidation],
        };
      }
      const planClaims = claimPlan({ moves: changed, after, roster });
      const collision = planClaims.refused[0];
      if (collision !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [claimRefusalOf(input.team, collision, [0])],
        };
      }

      const entry = entryOf(evaluatedMoves(after), move.id);
      yield* repository.editMove({
        userId,
        team: input.team,
        move: move.id,
        at,
        edit: {
          content: contentOfMove(move, entry, input.runDay, at),
          claims: planClaims.claims.get(move.id) ?? [],
        },
        groupDays: peers.map((peer) => ({
          move: peer.id,
          runDay: input.runDay,
          effectiveDate: entryOf(evaluatedMoves(after), peer.id).effectiveDate,
        })),
      });

      return { plan: yield* readView({ userId, team: input.team, facts, at }), refused: [] };
    });

    const edit = Effect.fn("TransactionPlanService.edit")(function* (
      userId: UserId,
      input: TransactionPlanEditInput,
    ) {
      const at = yield* DateTime.now;
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const move = stored.find((entry) => entry.id === input.move);
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const open = stored.filter(isOpenMove);
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: namedPlayers(open),
        needsBudget: needsBudget(open),
      });
      const roster = new Map(facts.roster.map((player) => [player.key, player] as const));
      const refused = moveChangeRefusal({ team: input.team, move });
      if (refused !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [refused],
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
        roster,
        facts,
      });
      const before = evaluateTransactionPlan({ facts, moves: open, checkedAt: at });
      const peers = runDay === move.runDay ? [] : groupPeers(open, move);
      const changed = open.flatMap((entry) => {
        if (entry.id === move.id) {
          return [candidate];
        }
        return peers.some((peer) => peer.id === entry.id) ? [movedToDay(entry, runDay)] : [entry];
      });
      const after = evaluateTransactionPlan({ facts, moves: changed, checkedAt: at });
      const revalidation = revalidationRefusal({
        team: input.team,
        target: candidate,
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
        };
      }
      const planClaims = claimPlan({ moves: changed, after, roster });
      const collision = planClaims.refused[0];
      if (collision !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [claimRefusalOf(input.team, collision, [0])],
        };
      }

      const entry = entryOf(evaluatedMoves(after), move.id);
      yield* repository.editMove({
        userId,
        team: input.team,
        move: move.id,
        at,
        edit: {
          content: contentOfCandidate(candidate, entry, at),
          claims: planClaims.claims.get(move.id) ?? [],
        },
        groupDays: peers.map((peer) => ({
          move: peer.id,
          runDay,
          effectiveDate: entryOf(evaluatedMoves(after), peer.id).effectiveDate,
        })),
      });

      return { plan: yield* readView({ userId, team: input.team, facts, at }), refused: [] };
    });

    const discard = Effect.fn("TransactionPlanService.discard")(function* (
      userId: UserId,
      input: TransactionPlanDiscardInput,
    ) {
      const at = yield* DateTime.now;
      const facts = yield* factsPort.read({
        userId,
        team: input.team,
        at,
        players: [],
        needsBudget: false,
      });
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const move = stored.find((entry) => entry.id === input.move);
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

      yield* repository.discardMove({
        userId,
        team: input.team,
        move: move.id,
        at,
      });

      return { plan: yield* readView({ userId, team: input.team, facts, at }), refused: [] };
    });

    const runMoves = Effect.fn("TransactionPlanService.runMoves")(function* (input: {
      readonly userId: UserId;
      readonly team: TeamId;
      readonly at: DateTime.Utc;
      readonly facts: TransactionPlanTeamFacts;
      readonly open: ReadonlyArray<TransactionMoveRowRecord>;
      readonly mode: "submit" | "due";
    }) {
      const evaluation = evaluateTransactionPlan({
        facts: input.facts,
        moves: input.open,
        checkedAt: input.at,
      });
      const entries = evaluatedMoves(evaluation);
      const selection = selectRunGroups({
        team: input.team,
        mode: input.mode,
        facts: input.facts,
        open: input.open,
        entries,
      });
      const counts = emptyRunCounts();
      counts.moves = selection.selected.length;
      const outcomes = new Map<TransactionMoveId, TransactionMoveResult>();
      const deferred = new Set<TransactionMoveId>();
      const openById = new Map(input.open.map((move) => [move.id, move] as const));
      const selectedIds = new Set(selection.selected.map((move) => move.id));

      const settle = Effect.fn("TransactionPlanService.settle")(function* (
        settlements: ReadonlyArray<TransactionMoveSettlement>,
      ) {
        if (!EffectArray.isReadonlyArrayNonEmpty(settlements)) {
          return;
        }
        yield* repository.settleMoves({
          userId: input.userId,
          team: input.team,
          at: input.at,
          settlements,
        });
        for (const settlement of settlements) {
          outcomes.set(settlement.move, settlement.result);
          countRunResult(counts, settlement.result);
        }
      });

      const runMember = (
        members: ReadonlyArray<TransactionMoveRowRecord>,
        index: number,
      ): Effect.Effect<{ readonly retry: boolean }, TransactionPlanPersistenceFailed> =>
        Effect.gen(function* () {
          const move = members[index];
          if (move === undefined) {
            return { retry: false };
          }
          const entry = entryOf(entries, move.id);
          const write = yield* writes.apply(
            writeRequestOf({ userId: input.userId, team: input.team, move, entry }),
          );
          const decided = writeResultOf(write);
          if (decided.status === "retry") {
            counts.retry += 1;
            return { retry: true };
          }
          yield* settle([
            settlementOf({
              move,
              entry,
              result: decided.result,
              detail: decided.detail,
              facts: input.facts,
              at: input.at,
              attempted: true,
            }),
          ]);
          if (decided.result === "failed" || decided.result === "unknown") {
            const stopped = `${describeTransactionPlanMove(move)} did not run, so the rest of its group was skipped.`;
            yield* settle(
              members.slice(index + 1).map((rest) =>
                settlementOf({
                  move: rest,
                  entry: entryOf(entries, rest.id),
                  result: "skipped",
                  detail: stopped,
                  facts: input.facts,
                  at: input.at,
                  attempted: false,
                }),
              ),
            );
            return { retry: false };
          }
          return yield* runMember(members, index + 1);
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
            group.moves.map((move) =>
              settlementOf({
                move,
                entry: entryOf(entries, move.id),
                result: "skipped",
                detail: blocked.detail,
                facts: input.facts,
                at: input.at,
                attempted: false,
              }),
            ),
          );
          continue;
        }

        const invalid = group.moves.find(
          (move) => entryOf(entries, move.id).validation.status !== "current",
        );
        if (invalid !== undefined) {
          const label = describeTransactionPlanMove(invalid);
          const reason = entryOf(entries, invalid.id).validation.reasons[0];
          yield* settle(
            group.moves.map((move) => {
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
                  })
                : settlementOf({
                    move,
                    entry,
                    result: "skipped",
                    detail: `The group did not run because ${label} could not run.`,
                    facts: input.facts,
                    at: input.at,
                    attempted: false,
                  });
            }),
          );
          continue;
        }

        const memberRun = yield* runMember(group.moves, 0);
        if (memberRun.retry) {
          for (const move of group.moves) {
            if (!outcomes.has(move.id)) {
              deferred.add(move.id);
            }
          }
        }
      }

      return { counts, refusals: selection.refused };
    });

    const submit = Effect.fn("TransactionPlanService.submit")(function* (
      userId: UserId,
      input: TransactionPlanSubmitInput,
    ) {
      const at = yield* DateTime.now;
      const runClaim = yield* newClaim;
      const claimed = yield* repository.claimRun({
        userId,
        team: input.team,
        runClaim,
        at,
      });
      if (claimed.status === "held") {
        return yield* TransactionPlanRunInProgress.make({
          team: input.team,
          detail: `Another run holds this team's plan, so today's moves wait for it to finish.`,
        });
      }
      return yield* Effect.gen(function* () {
        const stored = yield* repository.readPlanMoves({ userId, team: input.team });
        const facts = yield* factsPort.read({
          userId,
          team: input.team,
          at,
          players: namedPlayers(stored.filter(isOpenMove)),
          needsBudget: needsBudget(stored.filter(isOpenMove)),
        });
        const run = yield* runMoves({
          userId,
          team: input.team,
          at,
          facts,
          open: stored.filter(isOpenMove),
          mode: "submit",
        });
        const plan = planViewOf({
          stored: yield* repository.readPlanMoves({ userId, team: input.team }),
          facts,
          checkedAt: at,
          team: input.team,
        });
        return {
          team: input.team,
          today: facts.today,
          counts: { ...run.counts, plans: 1, claimed: 1 },
          refusals: run.refusals,
          plan,
        };
      }).pipe(
        Effect.ensuring(
          repository.releaseRun({ userId, team: input.team, runClaim, at }).pipe(Effect.ignore),
        ),
      );
    });

    const submitToday = Effect.fn("TransactionPlanService.submitToday")(function* (
      userId: UserId,
      input: TransactionPlanTodayInput,
    ) {
      const held = new Map<TeamId, { readonly discard: Array<TransactionMoveId>; now: boolean }>();
      for (const choice of input.choices) {
        const team = held.get(choice.team) ?? { discard: [], now: false };
        if (choice.choice === "discard") {
          team.discard.push(choice.move);
        } else {
          team.now = true;
        }
        held.set(choice.team, team);
      }
      const counts = emptyRunCounts();
      const refusals: Array<TransactionPlanRunRefusal> = [];
      let discarded = 0;
      for (const [team, choices] of held) {
        let blocked = false;
        for (const move of choices.discard) {
          const result = yield* discard(userId, { team, move });
          if (result.refused.length > 0) {
            blocked = true;
            for (const refusal of result.refused) {
              refusals.push({
                code: refusal.code,
                team,
                detail: refusal.detail,
                moves: [move],
              });
            }
            continue;
          }
          discarded += 1;
        }
        if (blocked || !choices.now) {
          continue;
        }
        const submission = yield* submit(userId, { team });
        mergeRunCounts(counts, submission.counts);
        for (const refusal of submission.refusals) {
          refusals.push(refusal);
        }
      }
      return {
        status: "submitted",
        counts,
        discarded,
        refusals,
      } satisfies TransactionPlanTodaySubmission;
    });

    const runDue = Effect.fn("TransactionPlanService.runDue")(function* (
      limit: number,
      at: DateTime.Utc,
    ) {
      const before = DateTime.formatIsoDateUtc(DateTime.add(at, { days: 1 }));
      const recovered = yield* repository.releaseStaleRuns({ before: staleClaimBefore(at) });
      const candidates = yield* repository.readDuePlans({ before, limit });
      const counts = { ...emptyRunCounts(), plans: candidates.length, recovered };
      if (candidates.length === 0) {
        return { at, counts };
      }

      const candidateMoves = yield* repository.readOpenMovesForPlans({ plans: candidates });
      const factsByPlan = new Map<string, TransactionPlanTeamFacts>();
      yield* Effect.forEach(
        candidates,
        (plan) => {
          const planMoves = candidateMoves.filter(
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

      const known = candidates.filter((plan) => factsByPlan.has(planKey(plan)));
      if (known.length === 0) {
        return { at, counts };
      }
      const dueMoves = yield* repository.readDueMovesForPlans({ plans: known, before });
      const duePlans = known.filter((plan) => {
        const facts = factsByPlan.get(planKey(plan));
        return (
          facts !== undefined &&
          dueMoves.some(
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
        plans: claimed.map((entry) => entry.plan),
      });
      const runClaimed = (index: number): Effect.Effect<void, TransactionPlanServiceError> =>
        Effect.gen(function* () {
          const entry = claimed[index];
          if (entry === undefined) {
            return;
          }
          const planMoves = open.filter(
            (move) => move.userId === entry.plan.userId && move.team === entry.plan.team,
          );
          const run = yield* runMoves({
            userId: entry.plan.userId,
            team: entry.plan.team,
            at,
            facts: entry.facts,
            open: planMoves,
            mode: "due",
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
      const checks = yield* Effect.forEach(
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
          ).pipe(
            Effect.map((read): readonly [TeamId, TransactionTeamCheck] => {
              if (read._tag === "Failure") {
                return [team, { status: "unavailable" }];
              }
              const evaluation = evaluateTransactionPlan({
                facts: read.success,
                moves: movesByTeam.get(team) ?? [],
                checkedAt: input.at,
              });
              return [
                team,
                {
                  status: "checked",
                  today: read.success.today,
                  moves: new Map(evaluation.moves.map((entry) => [entry.move, entry] as const)),
                },
              ];
            }),
          ),
        { concurrency: 3 },
      );
      return new Map(checks);
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
        ...new Set(page.flatMap((row) => (isOpenMove(row.move) ? [row.move.team] : []))),
      ];
      const planMoves =
        openTeams.length === 0
          ? []
          : yield* repository.readOpenMovesForTeams({ userId, teams: openTeams });
      const checks = yield* checkTeams({ userId, at, teams: openTeams, moves: planMoves });
      const moves = moveReadViews({ moves: page, checks });
      const todayOf = new Map(
        [...checks].flatMap(([teamId, check]) =>
          check.status === "checked" ? [[teamId, check.today] as const] : [],
        ),
      );
      const counts = yield* countMoves(userId, input.team);
      const last = page[page.length - 1];
      const complete = rows.length <= input.limit;
      return {
        status: "ok",
        team,
        moves,
        days: moveDays({ moves, todayOf }),
        counts: counts.totals,
        teamCount: counts.teamCount,
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
      const open = stored.filter(isOpenMove);
      const checks = yield* checkTeams({
        userId,
        at,
        teams: open.length === 0 ? [] : [input.team],
        moves: open,
      });
      const check = checks.get(input.team);
      const moves = stored.map((move) => moveReadView({ move, team, check }));
      const today = check?.status === "checked" ? check.today : undefined;
      return {
        team,
        today,
        moves,
        days: planDays({ moves, today }),
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
      submit,
      submitToday,
      runDue,
      timeline,
      list,
      plan,
      counts,
    };
  }),
);

function settleProposals(input: {
  readonly team: TeamId;
  readonly accepted: ReadonlyArray<TransactionPlanMove>;
  readonly proposals: ReadonlyArray<DraftGroup>;
  readonly facts: TransactionPlanTeamFacts;
  readonly roster: ReadonlyMap<string, TransactionPlanRosterPlayer>;
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
      moves: accepted,
      checkedAt: input.checkedAt,
    });
    const full = evaluateTransactionPlan({
      facts: input.facts,
      moves: [...accepted, ...remaining.flatMap((proposal) => proposal.moves)],
      checkedAt: input.checkedAt,
    });
    const broken = brokenExistingMove(baseline, full, accepted);
    if (broken !== undefined) {
      const culprit = remaining.find((proposal) =>
        removingGroupKeepsPlan({
          team: input.team,
          accepted,
          baseline,
          remaining,
          proposal,
          facts: input.facts,
          checkedAt: input.checkedAt,
        }),
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
      remaining = remaining.filter((proposal) => proposal !== culprit);
      continue;
    }

    const refusals = remaining.flatMap((proposal) => {
      const refusal = groupRefusal({
        team: input.team,
        proposal,
        accepted,
        full,
        roster: input.roster,
      });
      return refusal === undefined ? [] : [{ proposal, refusal }];
    });
    if (refusals.length === 0) {
      accepted = [...accepted, ...remaining.flatMap((proposal) => proposal.moves)];
      break;
    }
    const refusedGroups = new Set(refusals.map((entry) => entry.proposal));
    for (const entry of refusals) {
      refused.push(entry.refusal);
    }
    remaining = remaining.filter((proposal) => !refusedGroups.has(proposal));
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
  return accepted.find(
    (move) =>
      entryOf(before, move.id).validation.status === "current" &&
      entryOf(after, move.id).validation.status !== "current",
  );
}

function removingGroupKeepsPlan(input: {
  readonly team: TeamId;
  readonly accepted: ReadonlyArray<TransactionPlanMove>;
  readonly baseline: TransactionPlanEvaluation;
  readonly remaining: ReadonlyArray<DraftGroup>;
  readonly proposal: DraftGroup;
  readonly facts: TransactionPlanTeamFacts;
  readonly checkedAt: DateTime.Utc;
}): boolean {
  const others = input.remaining
    .filter((proposal) => proposal !== input.proposal)
    .flatMap((proposal) => proposal.moves);
  const after = evaluateTransactionPlan({
    facts: input.facts,
    moves: [...input.accepted, ...others],
    checkedAt: input.checkedAt,
  });
  const before = evaluatedMoves(input.baseline);
  const entries = evaluatedMoves(after);
  return input.accepted.every(
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
}): TransactionPlanRefusal | undefined {
  const fullMoves = evaluatedMoves(input.full);
  const invalid = input.proposal.moves.find(
    (move) => entryOf(fullMoves, move.id).validation.status !== "current",
  );
  if (invalid !== undefined) {
    const reason = entryOf(fullMoves, invalid.id).validation.reasons[0];
    return {
      code: reason?.code ?? "invalid_move",
      team: input.team,
      detail:
        reason?.detail ?? `${describeTransactionPlanMove(invalid)} cannot run against this plan.`,
      ...(input.proposal.label === undefined ? {} : { group: input.proposal.label }),
      moves: input.proposal.indexes,
    };
  }

  const days = new Set(input.proposal.moves.map((move) => entryOf(fullMoves, move.id).runDay));
  if (days.size > 1) {
    return {
      code: "group_day_conflict",
      team: input.team,
      detail: `A group runs on one day, and these moves run on ${[...days].join(", ")}.`,
      ...(input.proposal.label === undefined ? {} : { group: input.proposal.label }),
      moves: input.proposal.indexes,
    };
  }

  return claimCollision({
    team: input.team,
    moves: [...input.accepted, ...input.proposal.moves],
    after: input.full,
    roster: input.roster,
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
  readonly indexes: ReadonlyArray<number>;
}): TransactionPlanRefusal | undefined {
  const refused = claimPlan(input).refused[0];
  return refused === undefined ? undefined : claimRefusalOf(input.team, refused, input.indexes);
}

function claimPlan(input: {
  readonly moves: ReadonlyArray<TransactionPlanMove>;
  readonly after: TransactionPlanEvaluation;
  readonly roster: ReadonlyMap<string, TransactionPlanRosterPlayer>;
}): {
  readonly claims: ReadonlyMap<TransactionMoveId, ReadonlyArray<StoredMoveClaim>>;
  readonly refused: ReadonlyArray<TransactionPlanClaimRefusal>;
} {
  const claims = claimTransactionPlanMoves({
    moves: input.moves,
    placements: placementsOf(input.after),
    roster: input.roster,
  });
  return {
    claims: new Map(claims.moves.map((entry) => [entry.move, entry.claims] as const)),
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
    evaluation.moves.flatMap((entry) =>
      entry.placement === undefined ? [] : [[entry.move, entry.placement] as const],
    ),
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
  readonly mode: "submit" | "due";
  readonly facts: TransactionPlanTeamFacts;
  readonly open: ReadonlyArray<TransactionMoveRowRecord>;
  readonly entries: ReadonlyMap<TransactionMoveId, TransactionPlanMoveEvaluation>;
}): RunSelection {
  const due = input.open.filter((move) =>
    runCandidate({
      move,
      entry: entryOf(input.entries, move.id),
      mode: input.mode,
      today: input.facts.today,
    }),
  );
  const dueIds = new Set(due.map((move) => move.id));
  const peers = new Map<string, Array<TransactionMoveRowRecord>>();
  for (const move of due) {
    const key = move.group ?? move.id;
    if (peers.has(key)) {
      continue;
    }
    peers.set(
      key,
      input.open.filter((open) => (open.group ?? open.id) === key),
    );
  }
  const groups: Array<RunGroup> = [];
  const refused: Array<TransactionPlanRunRefusal> = [];
  for (const [key, members] of peers) {
    const missing = members.filter((move) => !dueIds.has(move.id));
    if (missing.length > 0) {
      refused.push({
        code: "group_not_selected",
        team: input.team,
        detail:
          input.mode === "submit"
            ? "A group runs whole, so every move in it must be chosen for today."
            : "A group runs whole, so every move in it must be due on the same league day.",
        moves: members.map((move) => move.id),
      });
      continue;
    }
    groups.push({
      key,
      moves: [...members].sort(
        (left, right) =>
          runPositionOf(entryOf(input.entries, left.id), left) -
            runPositionOf(entryOf(input.entries, right.id), right) ||
          left.id.localeCompare(right.id),
      ),
    });
  }
  groups.sort(
    (left, right) =>
      groupPosition(left, input.entries) - groupPosition(right, input.entries) ||
      left.key.localeCompare(right.key),
  );
  return { selected: groups.flatMap((group) => group.moves), groups, refused };
}

function runCandidate(input: {
  readonly move: TransactionMoveRowRecord;
  readonly entry: TransactionPlanMoveEvaluation;
  readonly mode: "submit" | "due";
  readonly today: StoredMoveDate;
}): boolean {
  if (!isOpenMove(input.move) || input.move.result !== undefined) {
    return false;
  }
  if (input.mode === "submit") {
    return input.move.decision === "now" && input.entry.runDay === input.today;
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
      if (input.group.moves.some((member) => member.id === dependency)) {
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
    case "withdrawn":
    case "expired":
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
    adds: input.move.adds.map((add) => add.key),
    drops: input.move.drops.map((drop) => drop.key),
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
      return { status: "settled", result: "executed", detail: undefined };
    case "pending":
      return { status: "settled", result: "pending", detail: write.detail };
    case "failed":
      return { status: "settled", result: "failed", detail: write.detail };
    case "unknown":
      return { status: "settled", result: "unknown", detail: write.detail };
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
}): TransactionMoveSettlement {
  return {
    move: input.move.id,
    result: input.result,
    detail: input.detail,
    validation: input.entry.validation,
    runDay: input.entry.runDay,
    effectiveDate: input.entry.effectiveDate,
    runPosition: input.entry.runPosition,
    steps: input.attempted ? attemptStepsOf(input) : [],
  };
}

function attemptStepsOf(input: {
  readonly move: TransactionMoveRowRecord;
  readonly entry: TransactionPlanMoveEvaluation;
  readonly result: TransactionMoveResult;
  readonly detail: string | undefined;
  readonly facts: TransactionPlanTeamFacts;
  readonly at: DateTime.Utc;
}): ReadonlyArray<StoredMoveStep> {
  const step = (
    kind: StoredMoveStep["kind"],
    playerKey: string,
    fromSlot: string | undefined,
    toSlot: string | undefined,
  ): StoredMoveStep => ({
    kind,
    playerKey,
    ...(fromSlot === undefined ? {} : { fromSlot }),
    ...(toSlot === undefined ? {} : { toSlot }),
    outcome: stepOutcome(input.result),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    decidedAt: input.at,
  });

  if (input.move.kind === "activate" || input.move.kind === "stash") {
    const placement = input.entry.placement;
    const playerKey = placement?.playerKey ?? input.move.intent?.player?.key;
    const toSlot = placement?.toSlot;
    if (playerKey === undefined || toSlot === undefined) {
      return [];
    }
    return [
      step(
        "reserve_move",
        playerKey,
        placement?.fromSlot ?? rosterSlot(input.facts, playerKey),
        toSlot,
      ),
    ];
  }
  if (input.move.kind === "slot_move") {
    const slot = input.move.slotMove;
    return slot === undefined
      ? []
      : [step("slot_move", slot.playerKey, rosterSlot(input.facts, slot.playerKey), slot.toSlot)];
  }
  if (input.move.kind === "trade") {
    return [];
  }

  const steps = [
    ...input.move.adds.map((add) => step("add", add.key, undefined, undefined)),
    ...input.move.drops.map((drop) => step("drop", drop.key, undefined, undefined)),
  ];
  const placement = input.entry.placement;
  if (
    input.move.intent?.to === "reserve" &&
    placement !== undefined &&
    input.result === "executed"
  ) {
    steps.push(
      step(
        "reserve_move",
        placement.playerKey,
        placement.fromSlot ?? rosterSlot(input.facts, placement.playerKey),
        placement.toSlot,
      ),
    );
  }
  return steps;
}

function stepOutcome(result: TransactionMoveResult): StoredMoveStep["outcome"] {
  switch (result) {
    case "executed":
    case "pending":
    case "failed":
    case "skipped":
    case "unknown":
      return result;
    case "withdrawn":
    case "expired":
      return "skipped";
  }
}

function rosterSlot(facts: TransactionPlanTeamFacts, playerKey: string): string | undefined {
  return facts.roster.find((player) => player.key === playerKey)?.slot;
}

function mergeRunCounts(target: MutableRunCounts, source: TransactionPlanRunCounts): void {
  target.plans += source.plans;
  target.claimed += source.claimed;
  target.busy += source.busy;
  target.recovered += source.recovered;
  target.unavailable += source.unavailable;
  target.moves += source.moves;
  target.executed += source.executed;
  target.pending += source.pending;
  target.failed += source.failed;
  target.skipped += source.skipped;
  target.unknown += source.unknown;
  target.retry += source.retry;
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
    case "withdrawn":
    case "expired":
      return;
  }
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
  return group.moves.reduce(
    (position, move) => Math.min(position, runPositionOf(entryOf(entries, move.id), move)),
    Number.MAX_SAFE_INTEGER,
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
  const open = input.stored.filter(isOpenMove);
  const openIds = new Set(open.map((move) => move.id));
  const evaluation = evaluateTransactionPlan({
    facts: input.facts,
    moves: open,
    checkedAt: input.checkedAt,
  });
  const evaluated = evaluatedMoves(evaluation);
  const blockages = new Map(
    evaluation.order.blocked.map((entry) => [entry.move, entry.detail] as const),
  );
  const openById = new Map(open.map((move) => [move.id, move] as const));
  const runOrder = evaluation.order.steps.map((step) => step.move);
  const runOrderIds = new Set(runOrder);
  const ordered = [
    ...runOrder.map((id) => requireMove(openById, id)),
    ...open.filter((move) => !runOrderIds.has(move.id)),
    ...input.stored.filter((move) => !openIds.has(move.id)),
  ];
  return {
    team: input.team,
    today: input.facts.today,
    moves: ordered.map((move) => moveView(move, evaluated.get(move.id), blockages.get(move.id))),
    groups: evaluation.groups,
  };
}

function moveView(
  move: TransactionMoveRecord,
  entry: TransactionPlanMoveEvaluation | undefined,
  blockage: string | undefined,
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
    decision: planDecision(move),
    runDay: entry?.runDay ?? move.runDay,
    effectiveDate: entry?.effectiveDate ?? move.effectiveDate,
    dueToday: entry?.dueToday ?? false,
    validation: entry?.validation ?? move.validation,
    placement: entry?.placement ?? move.placement,
    claims: entry?.claims ?? move.claims,
    runPosition: entry?.runPosition,
    dependsOn: entry?.dependsOn ?? [],
    blockage,
    projection: entry?.projectedRoster ?? [],
  };
}

function draftCandidate(input: {
  readonly draft: TransactionPlanMoveDraft;
  readonly id: TransactionMoveId;
  readonly position: number;
  readonly group: string | undefined;
  readonly roster: ReadonlyMap<string, TransactionPlanRosterPlayer>;
  readonly facts: TransactionPlanTeamFacts;
}): CandidateMove {
  const draft = input.draft;
  return {
    id: input.id,
    group: input.group,
    position: input.position,
    kind: draft.kind,
    adds: (draft.adds ?? []).map((key) => poolPlayer(key, input.facts)),
    fallbacks: (draft.fallbacks ?? []).map((key) => poolPlayer(key, input.facts)),
    drops: (draft.drops ?? []).map((key) => rosterPlayer(key, input.roster)),
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
    decision: draft.runDay === undefined ? "now" : "saved",
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

function draftGroups(
  drafts: ReadonlyArray<TransactionPlanMoveDraft>,
  candidates: ReadonlyArray<TransactionPlanMove>,
): ReadonlyArray<DraftGroup> {
  const grouped = new Map<string, DraftGroup>();
  const proposals: Array<DraftGroup> = [];
  drafts.forEach((draft, index) => {
    const candidate = candidates[index];
    if (candidate === undefined) {
      throw new Error("A drafted move was not converted");
    }
    if (draft.group === undefined) {
      proposals.push({ label: undefined, indexes: [index], moves: [candidate] });
      return;
    }
    const existing = grouped.get(draft.group);
    if (existing === undefined) {
      const proposal: DraftGroup = {
        label: draft.group,
        indexes: [index],
        moves: [candidate],
      };
      grouped.set(draft.group, proposal);
      proposals.push(proposal);
      return;
    }
    existing.indexes.push(index);
    existing.moves.push(candidate);
  });
  return proposals;
}

function appendOf(
  candidate: CandidateMove,
  entry: TransactionPlanMoveEvaluation,
  claims: ReadonlyArray<StoredMoveClaim>,
  proposedBy: TransactionMoveProvenance,
  at: DateTime.Utc,
): TransactionMoveAppend {
  return {
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
      decision: candidate.decision,
      decidedAt: candidate.runDay === undefined ? undefined : at,
      validation: entry.validation,
    },
    claims,
  };
}

function contentOfMove(
  move: TransactionMoveRecord,
  entry: TransactionPlanMoveEvaluation,
  runDay: StoredMoveDate | undefined,
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
    decision: runDay === undefined ? "now" : "saved",
    decidedAt: runDay === undefined ? undefined : at,
    validation: entry.validation,
  };
}

function contentOfCandidate(
  candidate: CandidateMove,
  entry: TransactionPlanMoveEvaluation,
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
    decision: candidate.decision,
    decidedAt: candidate.decision === "saved" ? at : undefined,
    validation: entry.validation,
  };
}

function movedToDay(
  move: TransactionPlanMove,
  runDay: StoredMoveDate | undefined,
): TransactionPlanMove {
  return { ...move, runDay, decision: runDay === undefined ? "now" : "saved" };
}

function groupPeers(
  open: ReadonlyArray<TransactionMoveRecord>,
  move: TransactionMoveRecord,
): ReadonlyArray<TransactionMoveRecord> {
  if (move.group === undefined) {
    return [];
  }
  return open.filter((entry) => entry.id !== move.id && entry.group === move.group);
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
  return new Map(evaluation.moves.map((entry) => [entry.move, entry] as const));
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

function planDecision(move: TransactionMoveRecord): TransactionPlanDecision {
  if (move.decision === "discarded") {
    return "discarded";
  }
  return move.runDay === undefined ? "now" : "saved";
}

type TransactionPlanDecision = "now" | "saved" | "discarded";

function namedPlayers(
  moves: ReadonlyArray<{
    readonly adds: ReadonlyArray<StoredMovePlayer>;
    readonly fallbacks: ReadonlyArray<StoredMovePlayer>;
  }>,
): ReadonlyArray<string> {
  return [
    ...new Set(moves.flatMap((move) => [...move.adds, ...move.fallbacks].map((add) => add.key))),
  ];
}

function draftPlayers(drafts: ReadonlyArray<TransactionPlanMoveDraft>): ReadonlyArray<string> {
  return [
    ...new Set(drafts.flatMap((draft) => [...(draft.adds ?? []), ...(draft.fallbacks ?? [])])),
  ];
}

function needsBudget(moves: ReadonlyArray<{ readonly bid?: number }>): boolean {
  return moves.some((move) => move.bid !== undefined);
}

function requireId(ids: ReadonlyArray<TransactionMoveId>, index: number): TransactionMoveId {
  const id = ids[index];
  if (id === undefined) {
    throw new Error("A drafted move was not assigned an identifier");
  }
  return id;
}

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
    }
  | { readonly status: "retry" };

type MutableRunCounts = {
  -readonly [Key in keyof TransactionPlanRunCounts]: TransactionPlanRunCounts[Key];
};
