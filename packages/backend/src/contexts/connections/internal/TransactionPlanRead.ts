import { DateTime } from "effect";

import type { TeamId } from "#contexts/connections/FantasyTeam.ts";

import type { TransactionPlanMoveEvaluation } from "./TransactionPlanEvaluation.ts";
import {
  isOpenMove,
  type StoredMoveDate,
  type StoredMoveValidation,
  type TransactionMoveCursor,
  type TransactionMoveDecision,
  type TransactionMoveId,
  type TransactionMoveKind,
  type TransactionMovePageLimit,
  type TransactionMoveRecord,
  type TransactionMoveResult,
  type TransactionMoveTeam,
} from "./TransactionPlanRecord.ts";

export function moveReadViews(input: {
  readonly moves: ReadonlyArray<{
    readonly move: TransactionMoveRecord;
    readonly team: TransactionMoveTeam;
  }>;
  readonly checks: ReadonlyMap<TeamId, TransactionTeamCheck>;
}): ReadonlyArray<TransactionMoveRead> {
  return input.moves.map(({ move, team }) =>
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
  if (!isOpenMove(move)) {
    return storedMoveView({ move, team, check: { status: "stored" } });
  }
  const check = input.check;
  if (check === undefined) {
    throw new Error("An open move was read without a check of its team");
  }
  if (check.status === "unavailable") {
    return storedMoveView({ move, team, check: lastCheck(move) });
  }
  const evaluated = check.moves.get(move.id);
  if (evaluated === undefined) {
    throw new Error("An open move was not checked with its team");
  }
  return {
    move: move.id,
    team,
    group: move.group,
    kind: move.kind,
    position: move.position,
    decision: move.decision,
    runDay: evaluated.runDay,
    effectiveDate: evaluated.effectiveDate,
    validation: evaluated.validation,
    check: { status: "checked" },
    result: move.result,
  };
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
  return [...days.values()].sort(compareMoveDays).map((grouped) => ({
    day: grouped.day,
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
  return ordered;
}

export function countTotals(
  teams: ReadonlyArray<TransactionMoveTeamCounts>,
): TransactionMoveCounts {
  return teams.reduce(
    (total, team) => ({
      open: total.open + team.open,
      today: total.today + team.today,
      saved: total.saved + team.saved,
      ended: total.ended + team.ended,
    }),
    { open: 0, today: 0, saved: 0, ended: 0 },
  );
}

export function moveCursor(move: TransactionMoveRecord): TransactionMoveCursor {
  return {
    runDay: move.runDay ?? null,
    team: move.team,
    position: move.position,
    move: move.id,
  };
}

function storedMoveView(input: {
  readonly move: TransactionMoveRecord;
  readonly team: TransactionMoveTeam;
  readonly check: TransactionMoveCheck;
}): TransactionMoveRead {
  return {
    move: input.move.id,
    team: input.team,
    group: input.move.group,
    kind: input.move.kind,
    position: input.move.position,
    decision: input.move.decision,
    runDay: input.move.runDay,
    effectiveDate: input.move.effectiveDate,
    validation: input.move.validation,
    check: input.check,
    result: input.move.result,
  };
}

function lastCheck(move: TransactionMoveRecord): TransactionMoveCheck {
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

function compareMoveTeams(left: TransactionMoveTeamDay, right: TransactionMoveTeamDay): number {
  return left.team.name.localeCompare(right.team.name) || left.team.id.localeCompare(right.team.id);
}

export type TransactionTeamCheck =
  | {
      readonly status: "checked";
      readonly today: StoredMoveDate;
      readonly moves: ReadonlyMap<TransactionMoveId, TransactionPlanMoveEvaluation>;
    }
  | { readonly status: "unavailable" };

type TransactionMoveCheck =
  | { readonly status: "checked" }
  | { readonly status: "stored" }
  | { readonly status: "last_checked"; readonly note: string };

export type TransactionMoveRead = {
  readonly move: TransactionMoveId;
  readonly team: TransactionMoveTeam;
  readonly group: string | undefined;
  readonly kind: TransactionMoveKind;
  readonly position: number;
  readonly decision: TransactionMoveDecision;
  readonly runDay: StoredMoveDate | undefined;
  readonly effectiveDate: StoredMoveDate | undefined;
  readonly validation: StoredMoveValidation;
  readonly check: TransactionMoveCheck;
  readonly result: TransactionMoveResult | undefined;
};

type TransactionMoveTeamDay = {
  readonly team: TransactionMoveTeam;
  readonly moves: ReadonlyArray<TransactionMoveRead>;
};

export type TransactionMoveDay = {
  readonly day: StoredMoveDate | undefined;
  readonly today: boolean;
  readonly teams: ReadonlyArray<TransactionMoveTeamDay>;
};

export type TransactionPlanDay = {
  readonly day: StoredMoveDate | undefined;
  readonly today: boolean;
  readonly moves: ReadonlyArray<TransactionMoveRead>;
};

export type TransactionPlanRead = {
  readonly team: TransactionMoveTeam;
  readonly today: StoredMoveDate | undefined;
  readonly moves: ReadonlyArray<TransactionMoveRead>;
  readonly days: ReadonlyArray<TransactionPlanDay>;
};

export type TransactionMoveCounts = {
  readonly open: number;
  readonly today: number;
  readonly saved: number;
  readonly ended: number;
};

export type TransactionMoveTeamCounts = TransactionMoveCounts & {
  readonly team: TeamId;
};

export type TransactionPlanCounts = {
  readonly totals: TransactionMoveCounts;
  readonly teams: ReadonlyArray<TransactionMoveTeamCounts>;
};

type TransactionMovePage = {
  readonly returned: number;
  readonly complete: boolean;
  readonly next: TransactionMoveCursor | undefined;
};

export type TransactionMoveList = {
  readonly status: "ok";
  readonly team: TransactionMoveTeam | undefined;
  readonly moves: ReadonlyArray<TransactionMoveRead>;
  readonly days: ReadonlyArray<TransactionMoveDay>;
  readonly counts: TransactionMoveCounts;
  readonly page: TransactionMovePage;
};

export type TransactionMoveListInput = {
  readonly team?: TeamId;
  readonly state?: "today" | "saved" | "ended";
  readonly after?: TransactionMoveCursor;
  readonly limit?: TransactionMovePageLimit;
};

export type TransactionTimelineInput = {
  readonly after?: TransactionMoveCursor;
  readonly limit?: TransactionMovePageLimit;
};

export type TransactionPlanCountsInput = {
  readonly team?: TeamId;
};

export type TransactionPlanReadInput = {
  readonly team: TeamId;
};

type MutableMoveDay = {
  readonly day: StoredMoveDate | undefined;
  readonly today: boolean;
  readonly teams: Map<TeamId, MutableMoveTeamDay>;
};

type MutableMoveTeamDay = {
  readonly team: TransactionMoveTeam;
  readonly moves: Array<TransactionMoveRead>;
};

type MutablePlanDay = {
  readonly day: StoredMoveDate | undefined;
  readonly today: boolean;
  readonly moves: Array<TransactionMoveRead>;
};
