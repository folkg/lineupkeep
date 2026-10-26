import { buildLineupProblem, periodKey, trailingWindow } from "@lineupkeep/lineup-policy";
import type {
  LineupPolicyInput,
  LineupPolicyRefusal,
  Period,
  PeriodObservation,
  PlayerAvailability,
  PlayerValuation,
  PolicyPlayer,
} from "@lineupkeep/lineup-policy";
import type { StatObservation } from "@lineupkeep/lineup-scoring";
import { describeScoring, scoringProfile } from "@lineupkeep/lineup-scoring";
import type { ScoringCoverage, ScoringProfile } from "@lineupkeep/lineup-scoring";
import {
  makePlayerId,
  makeSelectionBasis,
  makeSlotId,
  solveLineup,
} from "@lineupkeep/lineup-solver";
import type {
  LineupPlan,
  LineupProblem,
  LineupRefusal,
  RosterSlot,
  SelectionBasis,
  SlotEligibility,
} from "@lineupkeep/lineup-solver";

import type {
  ProviderLeagueSettings,
  ProviderPlayerDetail,
  ProviderRoster,
  ProviderRosterPlayer,
} from "#contexts/connections/Provider.ts";

export function planYahooLineup(input: YahooLineupInput): YahooLineupResult {
  const policyInput = yahooPolicyInput(input);
  const verdict = buildLineupProblem(policyInput);
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
    selectionBasis: policyInput.selectionBasis,
    coverage: describeScoring(policyInput.scoring, observedStatIds(input.history)),
    valuations: verdict.valuations,
  };
}

export function yahooPolicyInput(input: YahooLineupInput): LineupPolicyInput {
  const period = yahooTargetPeriod(input.roster);
  const window = trailingWindow(input.history.map((entry) => entry.period));
  const players = input.roster.players.map((player) => yahooPolicyPlayer(player, period));
  return {
    selectionBasis: selectionBasisFor(window),
    period,
    window,
    scoring: yahooScoringProfile(input.league),
    slots: yahooLeagueSlots(input.league),
    players,
    observations: observationsFor(input.history, window, players),
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
  switch (injuryCode) {
    case "O":
      return { kind: "excluded", reason: "out" };
    case "IR":
    case "IR-LT":
      return { kind: "excluded", reason: "injured-reserve" };
    case "SUSP":
      return { kind: "excluded", reason: "suspended" };
    case "NA":
      return { kind: "excluded", reason: "not-active" };
    case "DTD":
      return { kind: "uncertain", reason: "day-to-day" };
    default:
      return { kind: "unknown", code: injuryCode };
  }
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

function observedStatIds(history: ReadonlyArray<YahooPeriodHistory>): ReadonlyArray<string> {
  const statIds = new Set<string>();
  for (const entry of history) {
    for (const detail of entry.details) {
      for (const stat of detail.actual?.stats ?? []) {
        statIds.add(String(stat.statId));
      }
    }
  }
  return [...statIds];
}

function selectionBasisFor(window: ReadonlyArray<Period>): SelectionBasis {
  return makeSelectionBasis(`yahoo:mean-points-per-period:${window.map(periodKey).join(",")}`);
}

const benchPosition = "BN";

type ProviderRosterPosition = ProviderLeagueSettings["rosterPositions"][number];

export type YahooLineupInput = {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly history: ReadonlyArray<YahooPeriodHistory>;
};

type YahooPeriodHistory = {
  readonly period: Period;
  readonly details: ReadonlyArray<ProviderPlayerDetail>;
};

export type YahooLineupResult =
  | {
      readonly kind: "planned";
      readonly plan: LineupPlan;
      readonly problem: LineupProblem;
      readonly selectionBasis: SelectionBasis;
      readonly coverage: ScoringCoverage;
      readonly valuations: ReadonlyArray<PlayerValuation>;
    }
  | { readonly kind: "refused"; readonly refusal: YahooLineupRefusal };

type YahooLineupRefusal =
  | { readonly kind: "policy"; readonly refusal: LineupPolicyRefusal }
  | { readonly kind: "solver"; readonly refusal: LineupRefusal };
