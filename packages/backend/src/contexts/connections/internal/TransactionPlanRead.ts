import { DateTime } from "effect";
import { Array as EffectArray } from "effect";

import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type {
  ReserveList,
  RosterBlocker,
  RosterFreeablePlace,
  RosterPlaces,
} from "#contexts/connections/QueryValues.ts";
import type {
  StoredMoveDate,
  StoredMovePlacement,
  StoredMovePlayer,
  StoredMoveSlot,
  StoredMoveValidation,
  StoredMoveAttempt,
  TransactionMoveAttemptView,
  TransactionMoveCheckView,
  TransactionMoveCursor,
  TransactionMoveDay,
  TransactionMovePickView,
  TransactionMovePlayerView,
  TransactionMoveRead,
  TransactionMoveTeam,
  TransactionMoveTeamCounts,
  TransactionMoveCounts,
  TransactionMoveValidationView,
  TransactionPlanDay,
  TransactionPlanSnapshot,
  TransactionWaiverBid,
  TransactionWaiverRule,
} from "#contexts/connections/TransactionPlans.ts";
import { isOpenMove, transactionMoveStatus } from "#contexts/connections/TransactionPlans.ts";

import type { TransactionPlanMoveEvaluation } from "./TransactionPlanEvaluation.ts";
import type { TransactionMoveRecord } from "./TransactionPlanRecord.ts";

export function moveReadViews(input: {
  readonly moves: ReadonlyArray<{
    readonly move: TransactionMoveRecord;
    readonly team: TransactionMoveTeam;
  }>;
  readonly checks: ReadonlyMap<TeamId, TransactionTeamCheck>;
}): ReadonlyArray<TransactionMoveRead> {
  return EffectArray.map(input.moves, ({ move, team }) =>
    moveReadView({ move, team, check: input.checks.get(team.id) }),
  );
}

export function moveReadView(input: {
  readonly move: TransactionMoveRecord;
  readonly team: TransactionMoveTeam;
  readonly check: TransactionTeamCheck | undefined;
}): TransactionMoveRead {
  const move = input.move;
  const team = input.team;
  const today = input.check?.status === "checked" ? input.check.today : undefined;
  const decision = displayedDecision(move, today);
  const content = {
    move: move.id,
    team,
    ...(move.group === undefined ? {} : { group: move.group }),
    kind: move.kind,
    position: move.position,
    decision,
    status: transactionMoveStatus({ ...move, decision }),
    ...(move.phase === undefined ? {} : { phase: move.phase }),
    attempts: EffectArray.map(move.attempts, attemptView),
    reason: move.reason,
    adds: EffectArray.map(move.adds, playerView),
    fallbacks: EffectArray.map(move.fallbacks, playerView),
    drops: EffectArray.map(move.drops, playerView),
    picks: EffectArray.map(move.picks, (pick): TransactionMovePickView => ({
      round: pick.round,
      sourceName: pick.sourceName,
      destinationName: pick.destinationName,
    })),
    ...(move.slotMove === undefined ? {} : { slotMove: slotView(move.slotMove) }),
    ...(move.intent === undefined
      ? {}
      : {
          intent: {
            kind: move.intent.kind,
            ...(move.intent.player === undefined ? {} : { player: playerView(move.intent.player) }),
            ...(move.intent.to === undefined ? {} : { to: move.intent.to }),
          },
        }),
    ...(move.bid === undefined ? {} : { bid: move.bid }),
    ...(move.decidedAt === undefined ? {} : { decidedAt: move.decidedAt }),
    ...(move.decidedBy === undefined ? {} : { decidedBy: move.decidedBy }),
    ...(move.surface === undefined ? {} : { surface: move.surface }),
    ...(move.confirmedAt === undefined || move.confirmedBy === undefined
      ? {}
      : { confirmation: { by: move.confirmedBy, at: move.confirmedAt } }),
    ...(move.runAt === undefined ? {} : { runAt: move.runAt }),
    ...(move.runDecidedBy === undefined ? {} : { runDecidedBy: move.runDecidedBy }),
    ...(move.runSurface === undefined ? {} : { runSurface: move.runSurface }),
  };
  if (!isOpenMove(move)) {
    return {
      ...content,
      ...(move.runDay === undefined ? {} : { runDay: move.runDay }),
      ...(move.effectiveDate === undefined ? {} : { effectiveDate: move.effectiveDate }),
      ...(move.placement === undefined ? {} : { placement: placementView(move.placement) }),
      validation: validationView(move.validation),
      check: { status: "stored" },
      ...(move.result === undefined ? {} : { result: move.result }),
      ...(move.resultDetail === undefined ? {} : { resultDetail: move.resultDetail }),
      ...(move.resultAt === undefined ? {} : { resultAt: move.resultAt }),
    };
  }
  const check = input.check;
  if (check === undefined) {
    throw new Error("An open move was read without a check of its team");
  }
  if (check.status === "unavailable") {
    return {
      ...content,
      ...(move.runDay === undefined ? {} : { runDay: move.runDay }),
      ...(move.effectiveDate === undefined ? {} : { effectiveDate: move.effectiveDate }),
      ...(move.placement === undefined ? {} : { placement: placementView(move.placement) }),
      validation: validationView(move.validation),
      check: lastCheck(move),
      ...(move.result === undefined ? {} : { result: move.result }),
      ...(move.resultDetail === undefined ? {} : { resultDetail: move.resultDetail }),
      ...(move.resultAt === undefined ? {} : { resultAt: move.resultAt }),
    };
  }
  const evaluated = check.moves.get(move.id);
  if (evaluated === undefined) {
    throw new Error("An open move was not checked with its team");
  }
  return {
    ...content,
    runDay: evaluated.runDay,
    ...(evaluated.effectiveDate === undefined ? {} : { effectiveDate: evaluated.effectiveDate }),
    ...(evaluated.sendsAt === undefined ? {} : { sendsAt: evaluated.sendsAt }),
    ...(evaluated.placement === undefined ? {} : { placement: placementView(evaluated.placement) }),
    validation: validationView(evaluated.validation),
    check: { status: "checked" },
    ...(move.result === undefined ? {} : { result: move.result }),
    ...(move.resultDetail === undefined ? {} : { resultDetail: move.resultDetail }),
    ...(move.resultAt === undefined ? {} : { resultAt: move.resultAt }),
  };
}

function displayedDecision(
  move: TransactionMoveRecord,
  today: StoredMoveDate | undefined,
): TransactionMoveRecord["decision"] {
  if (
    move.decision === "saved" &&
    (move.runDay === undefined || (today !== undefined && move.runDay <= today))
  ) {
    return "undecided";
  }
  return move.decision;
}

export function moveDays(input: {
  readonly moves: ReadonlyArray<TransactionMoveRead>;
  readonly todayOf: ReadonlyMap<TeamId, StoredMoveDate>;
}): ReadonlyArray<TransactionMoveDay> {
  const days = new Map<string, MutableMoveDay>();
  for (const move of input.moves) {
    const day = move.runDay;
    const key = day ?? "";
    let grouped = days.get(key);
    if (grouped === undefined) {
      const today = input.todayOf.get(move.team.id);
      grouped = {
        day,
        today:
          move.check.status === "stored"
            ? today !== undefined && day === today
            : day === undefined || (today !== undefined && day === today),
        teams: new Map(),
      };
      days.set(key, grouped);
    }
    let team = grouped.teams.get(move.team.id);
    if (team === undefined) {
      team = { team: move.team, moves: [] };
      grouped.teams.set(move.team.id, team);
    }
    team.moves.push(move);
  }
  return EffectArray.map([...days.values()].sort(compareMoveDays), (grouped) => ({
    ...(grouped.day === undefined ? {} : { day: grouped.day }),
    groupedBy: "runDay" as const,
    today: grouped.today,
    teams: [...grouped.teams.values()].sort(compareMoveTeams),
  }));
}

export function planDays(input: {
  readonly moves: ReadonlyArray<TransactionMoveRead>;
  readonly today: StoredMoveDate | undefined;
}): ReadonlyArray<TransactionPlanDay> {
  const days = new Map<string, MutablePlanDay>();
  const ordered: Array<MutablePlanDay> = [];
  for (const move of input.moves) {
    const key = move.runDay ?? "";
    let day = days.get(key);
    if (day === undefined) {
      day = {
        day: move.runDay,
        today: input.today !== undefined && move.runDay === input.today,
        moves: [],
      };
      days.set(key, day);
      ordered.push(day);
    }
    day.moves.push(move);
  }
  return EffectArray.map(ordered, (day) => ({
    ...(day.day === undefined ? {} : { day: day.day }),
    groupedBy: "runDay" as const,
    today: day.today,
    moves: day.moves,
  }));
}

export function countTotals(
  teams: ReadonlyArray<TransactionMoveTeamCounts>,
): TransactionMoveCounts {
  return EffectArray.reduce(teams, { open: 0, today: 0, saved: 0, ended: 0 }, (total, team) => ({
    open: total.open + team.open,
    today: total.today + team.today,
    saved: total.saved + team.saved,
    ended: total.ended + team.ended,
  }));
}

export function moveCursor(move: TransactionMoveRecord): TransactionMoveCursor {
  return {
    runDay: move.runDay ?? null,
    team: move.team,
    position: move.position,
    move: move.id,
  };
}

function playerView(player: StoredMovePlayer): TransactionMovePlayerView {
  return {
    ...(player.name === undefined ? {} : { name: player.name }),
    ...(player.position === undefined ? {} : { position: player.position }),
    ...(player.proTeam === undefined ? {} : { proTeam: player.proTeam }),
    ...(player.availability === undefined ? {} : { availability: player.availability }),
  };
}

function attemptView(attempt: StoredMoveAttempt): TransactionMoveAttemptView {
  return {
    kind: attempt.kind,
    player: playerView(attempt.player),
    outcome: attempt.outcome,
    reason: attempt.reason,
    at: attempt.at,
    ...(attempt.effectiveDate === undefined ? {} : { effectiveDate: attempt.effectiveDate }),
  };
}

function slotView(slot: StoredMoveSlot): {
  readonly playerName?: string;
  readonly toSlot: string;
} {
  return {
    ...(slot.playerName === undefined ? {} : { playerName: slot.playerName }),
    toSlot: slot.toSlot,
  };
}

function placementView(placement: StoredMovePlacement): {
  readonly playerName?: string;
  readonly fromSlot?: string;
  readonly toSlot: string;
  readonly detail: string;
} {
  return {
    ...(placement.playerName === undefined ? {} : { playerName: placement.playerName }),
    ...(placement.fromSlot === undefined ? {} : { fromSlot: placement.fromSlot }),
    toSlot: placement.toSlot,
    detail: placement.detail,
  };
}

function validationView(validation: StoredMoveValidation): TransactionMoveValidationView {
  return {
    status: validation.status,
    ...(validation.checkedAt === undefined ? {} : { checkedAt: validation.checkedAt }),
    reasons: EffectArray.map(validation.reasons, (reason) => ({
      code: reason.code,
      detail: reason.detail,
    })),
  };
}

function lastCheck(move: TransactionMoveRecord): TransactionMoveCheckView {
  return {
    status: "last_checked",
    note: lastCheckedNote(move.validation),
  };
}

function lastCheckedNote(validation: StoredMoveValidation): string {
  return validation.checkedAt === undefined
    ? "Not checked yet."
    : `Last checked ${DateTime.formatIso(validation.checkedAt)}.`;
}

function compareMoveDays(
  left: { readonly day: StoredMoveDate | undefined; readonly today: boolean },
  right: { readonly day: StoredMoveDate | undefined; readonly today: boolean },
): number {
  if (left.today !== right.today) {
    return left.today ? -1 : 1;
  }
  if (left.day === undefined || right.day === undefined) {
    return left.day === right.day ? 0 : left.day === undefined ? 1 : -1;
  }
  return left.day.localeCompare(right.day);
}

function compareMoveTeams(
  left: TransactionMoveDay["teams"][number],
  right: TransactionMoveDay["teams"][number],
): number {
  return left.team.name.localeCompare(right.team.name) || left.team.id.localeCompare(right.team.id);
}

export type TransactionTeamCheck =
  | {
      readonly status: "checked";
      readonly today: StoredMoveDate;
      readonly snapshot: TransactionPlanSnapshot;
      readonly places: RosterPlaces;
      readonly reserve: ReadonlyArray<ReserveList>;
      readonly addsPossible: number;
      readonly addsWithFixes: number;
      readonly canFree: ReadonlyArray<RosterFreeablePlace>;
      readonly illegal: ReadonlyArray<RosterBlocker>;
      readonly waiverBid: TransactionWaiverBid;
      readonly waiver: TransactionWaiverRule;
      readonly moves: ReadonlyMap<TransactionMoveRecord["id"], TransactionPlanMoveEvaluation>;
      readonly blocked: ReadonlyMap<TransactionMoveRecord["id"], string>;
    }
  | { readonly status: "unavailable" };

type MutableMoveDay = {
  readonly day: StoredMoveDate | undefined;
  readonly today: boolean;
  readonly teams: Map<TeamId, { team: TransactionMoveTeam; moves: Array<TransactionMoveRead> }>;
};

type MutablePlanDay = {
  readonly day: StoredMoveDate | undefined;
  readonly today: boolean;
  readonly moves: Array<TransactionMoveRead>;
};
