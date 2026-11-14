import { Config, Context, Crypto, DateTime, Effect, Layer, Option, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";

import {
  claimTransactionPlanMoves,
  describeTransactionPlanMove,
  evaluateTransactionPlan,
} from "./TransactionPlanEvaluation.ts";
import type {
  TransactionPlanClaimRefusal,
  TransactionPlanEvaluation,
  TransactionPlanGroupEvaluation,
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
import type {
  TransactionMoveList,
  TransactionMoveListInput,
  TransactionPlanCounts,
  TransactionPlanCountsInput,
  TransactionPlanRead,
  TransactionPlanReadInput,
  TransactionTeamCheck,
  TransactionTimelineInput,
} from "./TransactionPlanRead.ts";
import {
  StoredMoveDate,
  TransactionMoveId as TransactionMoveIdSchema,
  TransactionPlanPersistenceFailed,
  isOpenMove,
} from "./TransactionPlanRecord.ts";
import type {
  StoredMoveClaim,
  StoredMoveIntent,
  StoredMovePick,
  StoredMovePlacement,
  StoredMovePlayer,
  StoredMoveSlot,
  StoredMoveValidation,
  TransactionMoveCursor,
  TransactionMoveId,
  TransactionMoveKind,
  TransactionMovePageLimit,
  TransactionMoveProvenance,
  TransactionMoveReadState,
  TransactionMoveRecord,
  TransactionMoveRowRecord,
} from "./TransactionPlanRecord.ts";
import type { TransactionMoveAppend, TransactionMoveContent } from "./TransactionPlanRepository.ts";
import { TransactionPlanRepository } from "./TransactionPlanRepository.ts";

const transactionPlanServiceSwitch = Config.Boolean("TRANSACTION_PLAN_SERVICE").pipe(
  Config.withDefault(false),
);

export class TransactionPlansDisabled extends Schema.TaggedError<
  TransactionPlansDisabled,
  { readonly brand: unique symbol }
>()("transaction_plan.service_disabled", {
  detail: Schema.NonEmptyString,
}) {}

export class TransactionPlanFactsUnavailable extends Schema.TaggedError<
  TransactionPlanFactsUnavailable,
  { readonly brand: unique symbol }
>()("transaction_plan.facts_unavailable", {
  team: TeamId,
  detail: Schema.NonEmptyString,
}) {}

class TransactionPlanMoveNotFound extends Schema.TaggedError<
  TransactionPlanMoveNotFound,
  { readonly brand: unique symbol }
>()("transaction_plan.move_not_found", {
  team: TeamId,
  move: TransactionMoveIdSchema,
}) {}

class TransactionPlanTeamNotFound extends Schema.TaggedError<
  TransactionPlanTeamNotFound,
  { readonly brand: unique symbol }
>()("transaction_plan.team_not_found", {
  team: TeamId,
}) {}

export type TransactionPlanFactsShape = {
  readonly read: (input: {
    readonly userId: UserId;
    readonly team: TeamId;
    readonly at: DateTime.Utc;
  }) => Effect.Effect<TransactionPlanTeamFacts, TransactionPlanFactsUnavailable>;
};

export class TransactionPlanFacts extends Context.Service<
  TransactionPlanFacts,
  TransactionPlanFactsShape
>()(
  "@lineupkeep/backend/contexts/connections/internal/TransactionPlanService/TransactionPlanFacts",
) {}

export class TransactionPlanService extends Context.Service<
  TransactionPlanService,
  TransactionPlanServiceShape
>()("@lineupkeep/backend/contexts/connections/internal/TransactionPlanService") {}

export const TransactionPlanServiceLive = Layer.effect(
  TransactionPlanService,
  Effect.gen(function* () {
    const enabled = yield* transactionPlanServiceSwitch;
    if (!enabled) {
      return disabledService;
    }
    const repository = yield* TransactionPlanRepository;
    const factsPort = yield* TransactionPlanFacts;
    const crypto = yield* Crypto.Crypto;
    const newId = crypto.randomULID.pipe(
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
      const facts = yield* factsPort.read({ userId, team: input.team, at });
      yield* repository.loadPlan({ userId, team: input.team, at });
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const open = stored.filter(isOpenMove);
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

    const save = Effect.fn("TransactionPlanService.save")(function* (
      userId: UserId,
      input: TransactionPlanSaveInput,
    ) {
      const at = yield* DateTime.now;
      const facts = yield* factsPort.read({ userId, team: input.team, at });
      const roster = new Map(facts.roster.map((player) => [player.key, player] as const));
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const move = stored.find((entry) => entry.id === input.move);
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const open = stored.filter(isOpenMove);
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
      const facts = yield* factsPort.read({ userId, team: input.team, at });
      const roster = new Map(facts.roster.map((player) => [player.key, player] as const));
      const stored = yield* repository.readPlanMoves({ userId, team: input.team });
      const move = stored.find((entry) => entry.id === input.move);
      if (move === undefined) {
        return yield* TransactionPlanMoveNotFound.make({ team: input.team, move: input.move });
      }
      const open = stored.filter(isOpenMove);
      const refused = moveChangeRefusal({ team: input.team, move });
      if (refused !== undefined) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [refused],
        };
      }
      if (input.change.runDay !== undefined && !Schema.is(StoredMoveDate)(input.change.runDay)) {
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
      if (input.change.runDay !== undefined && input.change.runDay < facts.today) {
        return {
          plan: planViewOf({ stored, facts, checkedAt: at, team: input.team }),
          refused: [
            {
              code: "run_day_past",
              team: input.team,
              detail: `A saved move runs on ${facts.today} or a later day, so ${input.change.runDay} has already passed.`,
              moves: [0],
            },
          ],
        };
      }

      const candidate = draftCandidate({
        draft: input.change,
        id: move.id,
        position: move.position,
        group: move.group,
        roster,
        facts,
      });
      const before = evaluateTransactionPlan({ facts, moves: open, checkedAt: at });
      const peers = input.change.runDay === move.runDay ? [] : groupPeers(open, move);
      const changed = open.flatMap((entry) => {
        if (entry.id === move.id) {
          return [candidate];
        }
        return peers.some((peer) => peer.id === entry.id)
          ? [movedToDay(entry, input.change.runDay)]
          : [entry];
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
          runDay: input.change.runDay,
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
      const facts = yield* factsPort.read({ userId, team: input.team, at });
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
          Effect.result(factsPort.read({ userId: input.userId, team, at: input.at })).pipe(
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
      return { totals: countTotals(teams), teams };
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

    return { propose, save, edit, discard, timeline, list, plan, counts };
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

function requireId(ids: ReadonlyArray<TransactionMoveId>, index: number): TransactionMoveId {
  const id = ids[index];
  if (id === undefined) {
    throw new Error("A drafted move was not assigned an identifier");
  }
  return id;
}

const disabledService: TransactionPlanServiceShape = {
  propose: () => plansDisabled("propose"),
  save: () => plansDisabled("save"),
  edit: () => plansDisabled("edit"),
  discard: () => plansDisabled("discard"),
  timeline: () => plansDisabled("read the timeline"),
  list: () => plansDisabled("list the plan's moves"),
  plan: () => plansDisabled("read a plan"),
  counts: () => plansDisabled("count moves"),
};

function plansDisabled(operation: string): Effect.Effect<never, TransactionPlansDisabled> {
  return Effect.fail(
    TransactionPlansDisabled.make({
      detail: `The transaction plan service is off, so it cannot ${operation}.`,
    }),
  );
}

export type TransactionPlanMoveDraft = {
  readonly group?: string;
  readonly kind: TransactionMoveKind;
  readonly adds?: ReadonlyArray<string>;
  readonly fallbacks?: ReadonlyArray<string>;
  readonly drops?: ReadonlyArray<string>;
  readonly picks?: ReadonlyArray<StoredMovePick>;
  readonly slotMove?: { readonly player: string; readonly toSlot: string };
  readonly to?: "active" | "reserve";
  readonly player?: string;
  readonly counterparty?: string;
  readonly bid?: number;
  readonly reason: string;
  readonly runDay?: StoredMoveDate;
};

export type TransactionPlanProposeInput = {
  readonly team: TeamId;
  readonly proposedBy: TransactionMoveProvenance;
  readonly moves: ReadonlyArray<TransactionPlanMoveDraft>;
};

export type TransactionPlanSaveInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly runDay: StoredMoveDate;
};

export type TransactionPlanEditInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly change: TransactionPlanMoveDraft;
};

export type TransactionPlanDiscardInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
};

type TransactionPlanDecision = "now" | "saved" | "discarded";

type TransactionPlanMoveView = {
  readonly move: TransactionMoveId;
  readonly group: string | undefined;
  readonly kind: TransactionMoveKind;
  readonly adds: ReadonlyArray<StoredMovePlayer>;
  readonly fallbacks: ReadonlyArray<StoredMovePlayer>;
  readonly drops: ReadonlyArray<StoredMovePlayer>;
  readonly picks: ReadonlyArray<StoredMovePick>;
  readonly slotMove: StoredMoveSlot | undefined;
  readonly intent: StoredMoveIntent | undefined;
  readonly counterpartyKey: string | undefined;
  readonly bid: number | undefined;
  readonly reason: string;
  readonly decision: TransactionPlanDecision;
  readonly runDay: StoredMoveDate | undefined;
  readonly effectiveDate: StoredMoveDate | undefined;
  readonly dueToday: boolean;
  readonly validation: StoredMoveValidation;
  readonly placement: StoredMovePlacement | undefined;
  readonly claims: ReadonlyArray<StoredMoveClaim>;
  readonly runPosition: number | undefined;
  readonly dependsOn: ReadonlyArray<TransactionMoveId>;
  readonly blockage: string | undefined;
  readonly projection: ReadonlyArray<TransactionPlanRosterPlayer>;
};

export type TransactionPlanView = {
  readonly team: TeamId;
  readonly today: StoredMoveDate;
  readonly moves: ReadonlyArray<TransactionPlanMoveView>;
  readonly groups: ReadonlyArray<TransactionPlanGroupEvaluation>;
};

export type TransactionPlanRefusal = {
  readonly code: string;
  readonly team: TeamId;
  readonly detail: string;
  readonly group?: string;
  readonly moves: ReadonlyArray<number>;
};

type TransactionPlanResult = {
  readonly plan: TransactionPlanView;
  readonly refused: ReadonlyArray<TransactionPlanRefusal>;
};

type TransactionPlanServiceError =
  | TransactionPlansDisabled
  | TransactionPlanFactsUnavailable
  | TransactionPlanMoveNotFound
  | TransactionPlanTeamNotFound
  | TransactionPlanPersistenceFailed;

export type TransactionPlanServiceShape = {
  readonly propose: (
    userId: UserId,
    input: TransactionPlanProposeInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly save: (
    userId: UserId,
    input: TransactionPlanSaveInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly edit: (
    userId: UserId,
    input: TransactionPlanEditInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly discard: (
    userId: UserId,
    input: TransactionPlanDiscardInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly timeline: (
    userId: UserId,
    input: TransactionTimelineInput,
  ) => Effect.Effect<TransactionMoveList, TransactionPlanServiceError>;

  readonly list: (
    userId: UserId,
    input: TransactionMoveListInput,
  ) => Effect.Effect<TransactionMoveList, TransactionPlanServiceError>;

  readonly plan: (
    userId: UserId,
    input: TransactionPlanReadInput,
  ) => Effect.Effect<TransactionPlanRead, TransactionPlanServiceError>;

  readonly counts: (
    userId: UserId,
    input: TransactionPlanCountsInput,
  ) => Effect.Effect<TransactionPlanCounts, TransactionPlanServiceError>;
};

type CandidateMove = TransactionPlanMove & {
  readonly reason: string;
  readonly counterpartyKey: string | undefined;
};

type DraftGroup = {
  readonly label: string | undefined;
  readonly indexes: Array<number>;
  readonly moves: Array<TransactionPlanMove>;
};
