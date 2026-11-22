import { EffectString } from "@lineupkeep/collections";
import { Array as EffectArray, Option } from "effect";

import { solveLineup } from "./solve.ts";
import {
  knownSelection,
  makeAvailabilityTier,
  makePlayerId,
  makeSelectionBasis,
  makeSlotId,
  unusableSelection,
} from "./types.ts";
import type { RosterSlot } from "./types.ts";

export function projectLineupOutlook(input: OutlookInput): OutlookResult {
  const moves = [...input.moves].sort(
    (left, right) =>
      EffectString.localeCompare(left.effectiveDate ?? "", right.effectiveDate ?? "") ||
      EffectString.localeCompare(left.runDay ?? "", right.runDay ?? "") ||
      left.order - right.order,
  );
  const byMove = new Map(EffectArray.map(moves, (move) => [move.id, move] as const));
  const unapplied: Array<{ move: string; reason: string }> = [];
  const events: Array<OutlookMove> = [];
  for (const move of moves) {
    const dependency = EffectArray.findFirst(move.dependsOn, (id) => {
      const required = byMove.get(id);
      return (
        required === undefined ||
        required.effectiveDate === undefined ||
        move.effectiveDate === undefined ||
        required.effectiveDate > move.effectiveDate
      );
    });
    const reason = move.fallback
      ? "Fallback depends on the primary move failing."
      : move.validation === "illegal"
        ? "The move is illegal."
        : move.effectiveDate === undefined
          ? "The move has no effective date."
          : dependency._tag === "Some"
            ? `Dependency ${dependency.value} does not take effect before this move.`
            : undefined;
    if (reason !== undefined) {
      unapplied.push({ move: move.id, reason });
    } else {
      events.push(move);
    }
  }

  const roster = new Map(EffectArray.map(input.players, (player) => [player.key, player] as const));
  const applied: Array<string> = [];
  const periods: Array<OutlookPeriod> = [];
  let next = 0;
  for (const period of input.periods) {
    const shownMoves = EffectArray.filter(events, (move) => move.effectiveDate === period.start);
    while (next < events.length && (events[next]?.effectiveDate ?? "") <= period.start) {
      const move = events[next];
      if (move !== undefined) {
        applyMove(roster, move);
        applied.push(move.id);
      }
      next += 1;
    }
    periods.push(fitPeriod(period, [...roster.values()], input.slots, shownMoves));
  }
  for (const move of events) {
    if (!applied.includes(move.id)) {
      unapplied.push({
        move: move.id,
        reason: "The move does not affect a period in this window.",
      });
    }
  }
  const players = [
    ...new Map(
      EffectArray.map(
        EffectArray.flatMap(periods, (period) => period.players),
        (player) => [player.key, player] as const,
      ),
    ).values(),
  ];
  return {
    periods,
    players: EffectArray.map(players, (player) => {
      const appearances = EffectArray.filter(periods, (period) =>
        EffectArray.some(period.players, (entry) => entry.key === player.key),
      );
      const games = EffectArray.flatMap(appearances, (period) => {
        const entry = Option.getOrUndefined(
          EffectArray.findFirst(period.players, (row) => row.key === player.key),
        );
        return entry?.game === undefined || entry.game === null
          ? []
          : EffectArray.map(entry.game, (game) => ({
              ...game,
              fitsStartingSlot: entry.fitsStartingSlot,
              ...(period.date === undefined ? { week: period.week } : { date: period.date }),
            }));
      });
      return {
        key: player.key,
        name: player.name,
        ...(player.proTeam === undefined ? {} : { proTeam: player.proTeam }),
        gamesInWindow: games.length,
        gamesThatFit: EffectArray.filter(games, (game) => game.fitsStartingSlot).length,
        unknownPeriods: EffectArray.filter(
          appearances,
          (period) =>
            Option.getOrUndefined(
              EffectArray.findFirst(period.players, (entry) => entry.key === player.key),
            )?.unknown !== undefined,
        ).length,
        games,
      };
    }),
    windowTotals: {
      openSlotPeriods: EffectArray.reduce(
        periods,
        0,
        (total, period) => total + period.totals.open,
      ),
      periodsWithOpenSlot: EffectArray.filter(periods, (period) => period.totals.open > 0).length,
      rosterGames: EffectArray.reduce(
        periods,
        0,
        (total, period) => total + period.games.rosterGames,
      ),
      unknownPlayers: new Set(
        EffectArray.flatMap(periods, (period) =>
          EffectArray.map(period.unknownGameDays, (player) => player.key),
        ),
      ).size,
    },
    moves: { applied, unapplied },
  };
}

function applyMove(roster: Map<string, OutlookPlayer>, move: OutlookMove): void {
  for (const key of move.drops) {
    roster.delete(key);
  }
  for (const player of move.adds) {
    roster.set(player.key, player);
  }
  if (move.slotMove !== undefined) {
    const player = roster.get(move.slotMove.key);
    if (player !== undefined) {
      roster.set(player.key, { ...player, slot: move.slotMove.to });
    }
  }
}

function fitPeriod(
  period: OutlookWindowPeriod,
  roster: ReadonlyArray<OutlookPlayer>,
  slots: ReadonlyArray<OutlookSlot>,
  moves: ReadonlyArray<OutlookMove>,
): OutlookPeriod {
  const starting = EffectArray.filter(slots, (slot) => slot.kind === "starting");
  const games = EffectArray.map(roster, (player) => ({
    ...player,
    game: player.games.get(period.date ?? `week:${String(period.week)}`),
    unknown: !player.games.has(period.date ?? `week:${String(period.week)}`)
      ? player.proTeam === undefined
        ? "The player's professional team is unknown."
        : "No schedule covers this period for this player."
      : undefined,
  }));
  const available = EffectArray.filter(
    games,
    (player) =>
      !EffectArray.some(slots, (slot) => slot.kind === "reserve" && slot.position === player.slot),
  );
  const selectionBasis = makeSelectionBasis("outlook-games");
  const tier = makeAvailabilityTier("available");
  const solved = solveLineup({
    selectionBasis,
    availabilityTiers: [tier],
    slots: EffectArray.map(slots, (slot): RosterSlot => {
      const base = {
        id: makeSlotId(slot.position),
        capacity: slot.count,
        eligibility:
          slot.eligibility.length === 0
            ? { kind: "any" as const }
            : { kind: "positions" as const, positions: slot.eligibility },
      };
      return slot.kind === "starting"
        ? { ...base, kind: "starting", requirement: "optional" }
        : { ...base, kind: slot.kind };
    }),
    players: EffectArray.map(available, (player) => ({
      id: makePlayerId(player.key),
      eligiblePositions: player.positions,
      availabilityTier: tier,
      selection:
        player.unknown !== undefined
          ? unusableSelection(selectionBasis, "missing")
          : knownSelection(
              selectionBasis,
              player.game?.length === 0 || player.game === null ? 0 : 1,
            ),
      reserveEligible: true,
      lockedSlotId: undefined,
      currentSlotId: EffectArray.some(slots, (slot) => slot.position === player.slot)
        ? makeSlotId(player.slot)
        : undefined,
      mayBeLeftInPlace: true,
    })),
  });
  const assignments =
    solved.kind === "refusal"
      ? new Map(EffectArray.map(available, (player) => [player.key, player.slot] as const))
      : new Map(
          EffectArray.map(
            solved.plan.assignments,
            (assignment) => [assignment.playerId, assignment.slotId] as const,
          ),
        );
  const slotRows = EffectArray.map(starting, (slot) => {
    const assigned = EffectArray.filter(
      available,
      (player) => assignments.get(player.key) === slot.position,
    );
    const playing = EffectArray.filter(
      assigned,
      (player) => player.game !== undefined && player.game !== null && player.game.length > 0,
    ).length;
    return {
      position: slot.position,
      total: slot.count,
      assigned: assigned.length,
      playing,
      open: slot.count - playing,
      empty: slot.count - assigned.length,
    };
  });
  const totals = {
    startingSlots: EffectArray.reduce(slotRows, 0, (sum, slot) => sum + slot.total),
    assigned: EffectArray.reduce(slotRows, 0, (sum, slot) => sum + slot.assigned),
    playing: EffectArray.reduce(slotRows, 0, (sum, slot) => sum + slot.playing),
    open: EffectArray.reduce(slotRows, 0, (sum, slot) => sum + slot.open),
    empty: EffectArray.reduce(slotRows, 0, (sum, slot) => sum + slot.empty),
  };
  return {
    ...(period.date === undefined ? { week: period.week } : { date: period.date }),
    start: period.start,
    end: period.end,
    totals,
    slots: slotRows,
    sittingWithGame: EffectArray.map(
      EffectArray.filter(
        games,
        (player) =>
          player.game !== undefined &&
          player.game !== null &&
          player.game.length > 0 &&
          !EffectArray.some(starting, (slot) => slot.position === assignments.get(player.key)),
      ),
      (player) => ({
        key: player.key,
        name: player.name,
        positions: player.positions,
        slot: assignments.get(player.key) ?? player.slot,
        reason: "No starting place was assigned for this game.",
      }),
    ),
    unknownGameDays: EffectArray.map(
      EffectArray.filter(games, (player) => player.unknown !== undefined),
      (player) => ({
        key: player.key,
        name: player.name,
        ...(player.proTeam === undefined ? {} : { proTeam: player.proTeam }),
        reason: player.unknown ?? "No schedule covers this period.",
      }),
    ),
    games: {
      rosterGames: EffectArray.reduce(
        games,
        0,
        (total, player) => total + (player.game?.length ?? 0),
      ),
    },
    moves: EffectArray.map(moves, (move) => ({
      id: move.id,
      kind: move.kind,
      effectiveDate: move.effectiveDate ?? period.start,
      adds: EffectArray.map(move.adds, (player) => ({ key: player.key, name: player.name })),
      fallbacks: EffectArray.map(move.fallbacks ?? [], (player) => ({
        key: player.key,
        name: player.name,
      })),
      drops: EffectArray.map(move.drops, (key) => ({
        key,
        name: move.dropNames?.get(key) ?? "Unknown player",
      })),
      validation: move.validation,
      certainty: move.certainty,
      conditional: move.validation !== "current",
    })),
    players: EffectArray.map(games, (player) => ({
      ...player,
      fitsStartingSlot:
        player.game !== undefined &&
        player.game !== null &&
        player.game.length > 0 &&
        EffectArray.some(
          starting,
          (slot) =>
            (slot.position === assignments.get(player.key) ||
              EffectArray.some(
                slotRows,
                (row) => row.position === slot.position && row.open > 0,
              )) &&
            (slot.eligibility.length === 0 ||
              EffectArray.some(player.positions, (position) =>
                slot.eligibility.includes(position),
              )) &&
            !EffectArray.some(
              slots,
              (held) => held.kind === "reserve" && held.position === player.slot,
            ),
        ),
    })),
    ...(solved.kind === "refusal"
      ? {
          fitDetail: `Projection could not be assigned: ${solved.refusal.reason}. Recorded slots for this roster are shown instead.`,
        }
      : {}),
  };
}

type OutlookGame = { readonly opponent?: string; readonly home?: boolean };
export type OutlookPlayer = {
  readonly key: string;
  readonly name: string;
  readonly proTeam?: string;
  readonly positions: ReadonlyArray<string>;
  readonly slot: string;
  readonly games: ReadonlyMap<string, ReadonlyArray<OutlookGame> | null>;
};
export type OutlookSlot = {
  readonly position: string;
  readonly kind: "starting" | "bench" | "reserve";
  readonly count: number;
  readonly eligibility: ReadonlyArray<string>;
};
export type OutlookMove = {
  readonly id: string;
  readonly kind: string;
  readonly effectiveDate?: string;
  readonly runDay?: string;
  readonly order: number;
  readonly adds: ReadonlyArray<OutlookPlayer>;
  readonly fallbacks?: ReadonlyArray<{ readonly key: string; readonly name: string }>;
  readonly drops: ReadonlyArray<string>;
  readonly dropNames?: ReadonlyMap<string, string>;
  readonly slotMove?: { readonly key: string; readonly to: string };
  readonly validation: "current" | "stale" | "unchecked" | "illegal";
  readonly certainty: "saved" | "confirmed";
  readonly dependsOn: ReadonlyArray<string>;
  readonly fallback: boolean;
};
export type OutlookWindowPeriod = {
  readonly date?: string;
  readonly week?: number;
  readonly start: string;
  readonly end: string;
};
type OutlookPeriod = {
  readonly date?: string;
  readonly week?: number;
  readonly start: string;
  readonly end: string;
  readonly totals: {
    readonly startingSlots: number;
    readonly assigned: number;
    readonly playing: number;
    readonly open: number;
    readonly empty: number;
  };
  readonly slots: ReadonlyArray<{
    readonly position: string;
    readonly total: number;
    readonly assigned: number;
    readonly playing: number;
    readonly open: number;
    readonly empty: number;
  }>;
  readonly sittingWithGame: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly positions: ReadonlyArray<string>;
    readonly slot: string;
    readonly reason: string;
  }>;
  readonly unknownGameDays: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly proTeam?: string;
    readonly reason: string;
  }>;
  readonly games: { readonly rosterGames: number };
  readonly moves: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly effectiveDate: string;
    readonly adds: ReadonlyArray<{ readonly key: string; readonly name: string }>;
    readonly fallbacks: ReadonlyArray<{ readonly key: string; readonly name: string }>;
    readonly drops: ReadonlyArray<{ readonly key: string; readonly name: string }>;
    readonly validation: "current" | "stale" | "unchecked" | "illegal";
    readonly certainty: "saved" | "confirmed";
    readonly conditional: boolean;
  }>;
  readonly players: ReadonlyArray<
    OutlookPlayer & {
      readonly game?: ReadonlyArray<OutlookGame> | null;
      readonly unknown?: string;
      readonly fitsStartingSlot: boolean;
    }
  >;
  readonly fitDetail?: string;
};
export type OutlookInput = {
  readonly periods: ReadonlyArray<OutlookWindowPeriod>;
  readonly players: ReadonlyArray<OutlookPlayer>;
  readonly slots: ReadonlyArray<OutlookSlot>;
  readonly moves: ReadonlyArray<OutlookMove>;
};
export type OutlookResult = {
  readonly periods: ReadonlyArray<OutlookPeriod>;
  readonly players: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly proTeam?: string;
    readonly gamesInWindow: number;
    readonly gamesThatFit: number;
    readonly unknownPeriods: number;
    readonly games: ReadonlyArray<
      OutlookGame & {
        readonly date?: string;
        readonly week?: number;
        readonly fitsStartingSlot: boolean;
      }
    >;
  }>;
  readonly windowTotals: {
    readonly openSlotPeriods: number;
    readonly periodsWithOpenSlot: number;
    readonly rosterGames: number;
    readonly unknownPlayers: number;
  };
  readonly moves: {
    readonly applied: ReadonlyArray<string>;
    readonly unapplied: ReadonlyArray<{ readonly move: string; readonly reason: string }>;
  };
};
