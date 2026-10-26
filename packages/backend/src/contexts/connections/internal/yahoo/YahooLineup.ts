import {
  buildLineupProblem,
  lineupPolicyVersion,
  periodKey,
  preferredValueSource,
  trailingPeriodCount,
  trailingWindow,
} from "@lineupkeep/lineup-policy";
import type {
  LineupPolicyInput,
  LineupPolicyRefusal,
  PercentStartedCut,
  Period,
  PeriodObservation,
  PlayerAvailability,
  PlayerPercentStarted,
  PlayerValuation,
  PolicyPlayer,
  ValueSourceKind,
} from "@lineupkeep/lineup-policy";
import type { StatObservation } from "@lineupkeep/lineup-scoring";
import { parseExact, scoringProfile } from "@lineupkeep/lineup-scoring";
import type { Exact, ScoringProfile } from "@lineupkeep/lineup-scoring";
import { makePlayerId, makeSlotId, solveLineup } from "@lineupkeep/lineup-solver";
import type {
  LineupPlan,
  LineupProblem,
  LineupRefusal,
  RosterSlot,
  SelectionBasis,
  SlotEligibility,
} from "@lineupkeep/lineup-solver";
import { DateTime } from "effect";

import type {
  ProviderLeagueSettings,
  ProviderPercentStarted,
  ProviderPlayerDetail,
  ProviderRoster,
  ProviderRosterPlayer,
} from "#contexts/connections/Provider.ts";

export { lineupPolicyVersion };

export function planYahooLineup(input: LineupPolicyInput): YahooLineupResult {
  const verdict = buildLineupProblem(input);
  if (verdict.kind === "refusal") {
    return { kind: "refused", refusal: { kind: "policy", refusal: verdict.refusal } };
  }
  const solved = solveLineup(verdict.problem);
  if (solved.kind === "refusal") {
    return { kind: "refused", refusal: { kind: "solver", refusal: solved.refusal } };
  }
  return {
    kind: "planned",
    plan: solved.plan,
    problem: verdict.problem,
    selectionBasis: solved.plan.selectionBasis,
    valuations: verdict.valuations,
  };
}

export function yahooValueSourceKinds(
  league: ProviderLeagueSettings,
): ReadonlyArray<ValueSourceKind> {
  return league.statModifiers.length > 0
    ? ["scoring-rules", "percent-started"]
    : ["percent-started"];
}

export function yahooPointsPolicyInput(input: YahooPeriodLineupInput): LineupPolicyInput {
  const players = yahooPolicyPlayers(input.roster);
  const window = trailingWindow(input.history.map((entry) => entry.period));
  return {
    period: yahooTargetPeriod(input.roster),
    source: {
      kind: "scoring-rules",
      window,
      scoring: yahooScoringProfile(input.league),
      observations: observationsFor(input.history, window, players),
    },
    slots: yahooLeagueSlots(input.league),
    players,
  };
}

export function yahooStartedPolicyInput(input: YahooStartedLineupInput): LineupPolicyInput {
  const details = new Map(
    input.details.map((detail) => [detail.providerPlayerKey, detail.percentStarted]),
  );
  return {
    period: yahooTargetPeriod(input.roster),
    source: {
      kind: "percent-started",
      started: input.roster.players.map((player) =>
        startedFor(player.providerPlayerKey, details.get(player.providerPlayerKey)),
      ),
    },
    slots: yahooLeagueSlots(input.league),
    players: yahooPolicyPlayers(input.roster),
  };
}

export function yahooScoringProfile(league: ProviderLeagueSettings): ScoringProfile {
  return scoringProfile({
    categories: league.statCategories.map((category) => ({
      statId: category.statId,
      label: category.name,
    })),
    rules: league.statModifiers.map((modifier) => ({
      statId: modifier.statId,
      points: modifier.points,
    })),
  });
}

export function yahooScorable(league: ProviderLeagueSettings): boolean {
  return preferredValueSource(yahooValueSourceKinds(league)) !== undefined;
}

export function yahooObservationWindow(
  league: ProviderLeagueSettings,
  roster: ProviderRoster,
): ReadonlyArray<Period> {
  const target = yahooTargetPeriod(roster);
  return target.kind === "week"
    ? completedWeeks(league, target.week)
    : completedDates(league, target.date);
}

export function yahooAssignmentRequest(input: YahooAssignmentInput): YahooAssignmentResult {
  const rosterPlayers = new Map(
    input.roster.players.map((player) => [player.providerPlayerKey, player]),
  );
  const plannedSlots = new Map(
    input.plan.assignments.map((assignment) => [assignment.playerId, assignment.slotId]),
  );
  const missingPlayerKeys = [...rosterPlayers.keys()].filter(
    (key) => !plannedSlots.has(makePlayerId(key)),
  );
  const unknownPlayerIds = input.plan.assignments
    .map((assignment) => assignment.playerId)
    .filter((playerId) => !rosterPlayers.has(playerId));
  if (missingPlayerKeys.length > 0 || unknownPlayerIds.length > 0) {
    return {
      kind: "refused",
      refusal: { kind: "plan-membership", missingPlayerKeys, unknownPlayerIds },
    };
  }

  const startingSlots = new Set(
    input.league.rosterPositions
      .filter((position) => position.isStarting)
      .map((position) => position.position),
  );
  const assignments: Array<YahooPlannedAssignment> = [];
  for (const player of input.roster.players) {
    const targetSlot = plannedSlots.get(makePlayerId(player.providerPlayerKey));
    if (targetSlot === undefined || targetSlot === player.slot) {
      continue;
    }
    if (player.isEditable !== true) {
      return {
        kind: "refused",
        refusal: {
          kind: "locked-player",
          playerKey: player.providerPlayerKey,
          from: player.slot,
          to: targetSlot,
        },
      };
    }
    if (isReserveList(player.slot, startingSlots) || isReserveList(targetSlot, startingSlots)) {
      return {
        kind: "refused",
        refusal: {
          kind: "reserve-list",
          playerKey: player.providerPlayerKey,
          from: player.slot,
          to: targetSlot,
        },
      };
    }
    assignments.push({ playerKey: player.providerPlayerKey, slot: targetSlot });
  }

  return assignments.length === 0 ? { kind: "no_op" } : { kind: "request", assignments };
}

export function describeYahooLineupRefusal(refusal: YahooLineupRefusal): string {
  switch (refusal.kind) {
    case "policy":
      return describePolicyRefusal(refusal.refusal);
    case "solver":
      return describeSolverRefusal(refusal.refusal);
  }
}

export function yahooLineupRefusalCode(refusal: YahooLineupRefusal): string {
  return refusal.kind === "policy"
    ? `policy:${refusal.refusal.kind}`
    : `solver:${refusal.refusal.reason}`;
}

function describePolicyRefusal(refusal: LineupPolicyRefusal): string {
  switch (refusal.kind) {
    case "no-value-source":
      return "This league publishes neither points rules nor a started percentage, so its lineup cannot be valued by the custom policy.";
    case "no-observed-periods":
      return "No completed scoring period is available to value the roster, so the custom policy cannot plan a lineup.";
  }
}

function describeSolverRefusal(refusal: LineupRefusal): string {
  switch (refusal.reason) {
    case "unusable-selection-value":
      return "Some roster players have no usable selection value, so a complete lineup cannot be planned.";
    case "lock-references-unknown-slot":
      return "A locked player occupies a slot this league does not declare, so the lineup cannot be planned.";
    case "locked-player-ineligible-for-slot":
      return "A locked player is not eligible for the slot they occupy, so the lineup cannot be planned.";
    case "lock-capacity-exceeded":
      return "Locked players exceed a slot's declared capacity, so the lineup cannot be planned.";
    case "roster-exceeds-slot-capacity":
      return "The roster has more players than the league's declared slots, so the lineup cannot be planned without dropping a player.";
    case "player-has-no-legal-slot":
      return "Some roster players have no legal slot, so the lineup cannot be planned.";
    case "required-starting-position-unfillable":
      return "A required starting position cannot be filled from the current roster.";
    case "no-legal-assignment":
      return "No complete legal assignment of this roster exists.";
  }
}

function completedWeeks(league: ProviderLeagueSettings, targetWeek: number): ReadonlyArray<Period> {
  const firstWeek = league.periodWindow?.startWeek ?? 1;
  const periods: Array<Period> = [];
  for (let week = targetWeek - trailingPeriodCount; week < targetWeek; week += 1) {
    if (week >= firstWeek) {
      periods.push({ kind: "week", week });
    }
  }
  return periods;
}

function completedDates(league: ProviderLeagueSettings, targetDate: string): ReadonlyArray<Period> {
  const target = DateTime.makeUnsafe(`${targetDate}T00:00:00.000Z`);
  const periods: Array<Period> = [];
  for (let offset = trailingPeriodCount; offset >= 1; offset -= 1) {
    const date = DateTime.formatIsoDate(DateTime.add(target, { days: -offset }));
    if (league.startDate === undefined || date >= league.startDate) {
      periods.push({ kind: "date", date });
    }
  }
  return periods;
}

function isReserveList(slot: string, startingSlots: ReadonlySet<string>): boolean {
  return !startingSlots.has(slot) && slot !== benchPosition;
}

export function yahooLeagueSlots(league: ProviderLeagueSettings): ReadonlyArray<RosterSlot> {
  return league.rosterPositions.map(rosterSlot);
}

function yahooPolicyPlayer(player: ProviderRosterPlayer, period: Period): PolicyPlayer {
  return {
    id: makePlayerId(player.providerPlayerKey),
    eligiblePositions: player.eligiblePositions,
    availability: yahooAvailability(player.injuryCode),
    locked: player.isEditable !== true,
    currentSlotId: makeSlotId(player.slot),
    nonGamePeriods: nonGamePeriods(player, period),
  };
}

export function yahooTargetPeriod(roster: ProviderRoster): Period {
  const coverage = roster.coverage;
  return coverage.type === "week"
    ? { kind: "week", week: coverage.week }
    : { kind: "date", date: coverage.date };
}

export function yahooAvailability(injuryCode: string | undefined): PlayerAvailability {
  if (injuryCode === undefined) {
    return { kind: "available" };
  }
  return availabilityByInjuryCode[injuryCode] ?? { kind: "unrecognised", code: injuryCode };
}

const availabilityByInjuryCode: Readonly<Record<string, PlayerAvailability>> = {
  O: { kind: "excluded", reason: "out" },
  IR: { kind: "excluded", reason: "injured-reserve" },
  "IR-LT": { kind: "excluded", reason: "injured-reserve" },
  SUSP: { kind: "excluded", reason: "suspended" },
  NA: { kind: "excluded", reason: "not-active" },
  DTD: { kind: "uncertain", reason: "day-to-day" },
};

export const yahooInjuryStatusCodes: ReadonlyArray<string> = Object.keys(availabilityByInjuryCode);

function yahooPolicyPlayers(roster: ProviderRoster): ReadonlyArray<PolicyPlayer> {
  const period = yahooTargetPeriod(roster);
  return roster.players.map((player) => yahooPolicyPlayer(player, period));
}

function startedFor(
  providerPlayerKey: string,
  started: ProviderPercentStarted | undefined,
): PlayerPercentStarted {
  return {
    id: makePlayerId(providerPlayerKey),
    percent: exactPercent(started?.percent ?? null),
    cuts: (started?.cuts ?? []).flatMap((cut) => {
      const percent = exactPercent(cut.percent);
      return percent === undefined
        ? []
        : [{ cut: cut.cutType, percent } satisfies PercentStartedCut];
    }),
  };
}

function exactPercent(percent: number | null): Exact | undefined {
  return percent === null ? undefined : parseExact(String(percent));
}

function rosterSlot(position: ProviderRosterPosition): RosterSlot {
  const id = makeSlotId(position.position);
  if (position.isStarting) {
    return {
      kind: "starting",
      id,
      capacity: position.count,
      requirement: "required",
      eligibility: slotPositions(position.position),
    };
  }
  if (position.position === benchPosition) {
    return { kind: "bench", id, capacity: position.count, eligibility: { kind: "any" } };
  }
  return {
    kind: "reserve",
    id,
    capacity: position.count,
    eligibility: slotPositions(position.position),
  };
}

function slotPositions(position: string): SlotEligibility {
  return { kind: "positions", positions: [position] };
}

function nonGamePeriods(player: ProviderRosterPlayer, period: Period): ReadonlyArray<Period> {
  if (period.kind !== "week" || player.byeWeek === null) {
    return [];
  }
  return [{ kind: "week", week: player.byeWeek }];
}

function observationsFor(
  history: ReadonlyArray<YahooPeriodHistory>,
  window: ReadonlyArray<Period>,
  players: ReadonlyArray<PolicyPlayer>,
): ReadonlyArray<PeriodObservation> {
  const stats = statsByPeriodAndPlayer(history);
  return window.map((period) => ({
    period,
    players: players.flatMap((player) => {
      const observations = stats.get(periodKey(period))?.get(player.id);
      return observations === undefined ? [] : [{ id: player.id, stats: observations }];
    }),
  }));
}

function statsByPeriodAndPlayer(
  history: ReadonlyArray<YahooPeriodHistory>,
): Map<string, Map<string, ReadonlyArray<StatObservation>>> {
  const index = new Map<string, Map<string, ReadonlyArray<StatObservation>>>();
  for (const entry of history) {
    const byPlayer = new Map<string, ReadonlyArray<StatObservation>>();
    for (const detail of entry.details) {
      const observations = observationsOf(detail);
      if (observations !== undefined) {
        byPlayer.set(detail.providerPlayerKey, observations);
      }
    }
    index.set(periodKey(entry.period), byPlayer);
  }
  return index;
}

function observationsOf(detail: ProviderPlayerDetail): ReadonlyArray<StatObservation> | undefined {
  return detail.actual?.stats.map((stat) => ({ statId: String(stat.statId), value: stat.value }));
}

const benchPosition = "BN";

type ProviderRosterPosition = ProviderLeagueSettings["rosterPositions"][number];

export type YahooPeriodLineupInput = {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly history: ReadonlyArray<YahooPeriodHistory>;
};

export type YahooStartedLineupInput = {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly details: ReadonlyArray<ProviderPlayerDetail>;
};

export type YahooAssignmentInput = {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly plan: LineupPlan;
};

type YahooPlannedAssignment = {
  readonly playerKey: string;
  readonly slot: string;
};

export type YahooAssignmentResult =
  | { readonly kind: "request"; readonly assignments: ReadonlyArray<YahooPlannedAssignment> }
  | { readonly kind: "no_op" }
  | { readonly kind: "refused"; readonly refusal: YahooAssignmentRefusal };

export type YahooAssignmentRefusal =
  | {
      readonly kind: "plan-membership";
      readonly missingPlayerKeys: ReadonlyArray<string>;
      readonly unknownPlayerIds: ReadonlyArray<string>;
    }
  | {
      readonly kind: "locked-player";
      readonly playerKey: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly kind: "reserve-list";
      readonly playerKey: string;
      readonly from: string;
      readonly to: string;
    };

export type YahooPeriodHistory = {
  readonly period: Period;
  readonly details: ReadonlyArray<ProviderPlayerDetail>;
};

export type YahooLineupResult =
  | {
      readonly kind: "planned";
      readonly plan: LineupPlan;
      readonly problem: LineupProblem;
      readonly selectionBasis: SelectionBasis;
      readonly valuations: ReadonlyArray<PlayerValuation>;
    }
  | { readonly kind: "refused"; readonly refusal: YahooLineupRefusal };

export type YahooLineupRefusal =
  | { readonly kind: "policy"; readonly refusal: LineupPolicyRefusal }
  | { readonly kind: "solver"; readonly refusal: LineupRefusal };
