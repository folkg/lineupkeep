import {
  lineupPolicyVersion,
  planLineup,
  lineupAssignments,
  periodKey,
  trailingPeriodCount,
} from "@lineupkeep/lineup-policy";
import type {
  LineupPolicyInput,
  LineupPlanRefusal,
  Period,
  PeriodObservation,
  PlayerAvailability,
  PlayerCommunityStartRate,
  PlayerProjection,
  PlayerRealisedPoints,
  PolicyPlayer,
} from "@lineupkeep/lineup-policy";
import type { StatObservation } from "@lineupkeep/lineup-scoring";
import { parseExact, scorePeriod, scoringProfile } from "@lineupkeep/lineup-scoring";
import type { Exact, ScoringProfile } from "@lineupkeep/lineup-scoring";
import { makePlayerId, makeSlotId } from "@lineupkeep/lineup-solver";
import type { PlayerId, RosterSlot, SlotEligibility } from "@lineupkeep/lineup-solver";
import { DateTime, Effect } from "effect";

import type {
  ProviderCapabilities,
  ProviderCommunityStartRate,
  ProviderLeagueSettings,
  ProviderLineupOutcome,
  ProviderLineupRequest,
  ProviderPlayerDetail,
  ProviderRoster,
  ProviderRosterPlayer,
  ProviderRosterPosition,
} from "#contexts/connections/Provider.ts";
import type { ProviderReadFailure } from "#contexts/connections/Provider.ts";

export const yahooCapabilities: ProviderCapabilities = {
  fantasyDay: {
    timeZone: "America/Los_Angeles",
    boundary: "local-midnight",
    version: "yahoo-pacific-midnight/1",
  },
  sports: ["football", "hockey"],
  playerSearch: {
    sorts: ["name", "position", "ownership", "actual_rank", "overall_rank", "stat"],
    providerOrderedSorts: ["actual_rank", "overall_rank", "stat"],
    weeklyStatSortSports: ["football"],
  },
  publishesProjections: false,
  publishesCommunityStartRate: true,
  statBases: ["week", "season"],
  limitations: [
    {
      subject: "player_schedule",
      detail:
        "Yahoo publishes no per-player games-remaining or probable-starter field. A roster entry carries the professional-team abbreviation and, where the league publishes one, the bye week; remaining player-games are available per fantasy team from get_matchups and get_team_summary.",
    },
    {
      subject: "probable_starters",
      detail:
        "Yahoo publishes no probable-starter field on its fantasy read surface, so participation is reported only through the provider's injury status.",
    },
    {
      subject: "projections",
      detail: "Yahoo exposes no projected player statistics.",
    },
    {
      subject: "team_remaining_games",
      detail:
        "Yahoo publishes no remaining-game count for football: a player plays at most one game per scoring week, and each roster entry carries the bye week instead.",
    },
    {
      subject: "lock_timing",
      detail:
        "Yahoo's exact fantasy-day rollover and per-player lock timing are not verified. This reports the league's declared period range only.",
    },
    {
      subject: "historical_seasons",
      detail: "Only the linked team's current season is validated for this provider.",
    },
  ],
};

export function planYahooLineup(
  input: ProviderLineupRequest,
  read: YahooLineupReader,
): Effect.Effect<ProviderLineupOutcome, ProviderReadFailure> {
  return Effect.gen(function* () {
    const slots = yahooLeagueSlots(input.league);
    const candidates: Array<LineupPolicyInput> = [];
    if (yahooCapabilities.publishesProjections) {
      candidates.push(projectedPointsInput(input, yield* read.readDetails()));
    }
    if (input.league.statModifiers.length > 0) {
      const history = yield* read.readHistory(
        yahooObservationWindow(input.league, targetPeriod(input.target)),
      );
      candidates.push(
        yahooPointsPolicyInput({ league: input.league, roster: input.roster, history }),
      );
    }
    if (yahooCapabilities.publishesCommunityStartRate) {
      candidates.push(
        yahooCommunityStartRatePolicyInput({
          league: input.league,
          roster: input.roster,
          details: yield* read.readDetails(),
        }),
      );
    }

    const planned = planLineup(candidates);
    if (planned.kind === "refused") {
      return refusedLineup(planned.refusals);
    }
    const translated = lineupAssignments({
      plan: planned.plan,
      slots: slots.map((slot) => ({ id: slot.id, kind: slot.kind })),
      players: input.roster.players.map((player) => ({
        playerKey: player.providerPlayerKey,
        name: player.name,
        slot: player.slot,
        editable: player.isEditable === true,
      })),
    });
    if (translated.kind === "refused") {
      return {
        kind: "refused",
        action: "block",
        policyVersion: lineupPolicyVersion,
        code: translated.code,
        detail: translated.detail,
        basis: planned.basis,
      };
    }
    return {
      kind: "planned",
      policyVersion: lineupPolicyVersion,
      basis: planned.basis,
      assignments: translated.assignments.map((assignment) => ({
        providerPlayerKey: assignment.playerKey,
        slot: assignment.slot,
      })),
    };
  });
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

export function yahooObservationWindow(
  league: ProviderLeagueSettings,
  target: Period,
): ReadonlyArray<Period> {
  return target.kind === "week"
    ? completedWeeks(league, target.week)
    : completedDates(league, target.date);
}

export function yahooLeagueSlots(league: ProviderLeagueSettings): ReadonlyArray<RosterSlot> {
  return league.rosterPositions.map(rosterSlot);
}

const availabilityByInjuryCode: Readonly<Record<string, PlayerAvailability>> = {
  O: { kind: "excluded", reason: "out" },
  IR: { kind: "excluded", reason: "injured-reserve" },
  "IR-LT": { kind: "excluded", reason: "injured-reserve" },
  SUSP: { kind: "excluded", reason: "suspended" },
  NA: { kind: "excluded", reason: "not-active" },
  DTD: { kind: "uncertain", reason: "day-to-day" },
};

export function yahooAvailability(injuryCode: string | undefined): PlayerAvailability {
  if (injuryCode === undefined) {
    return { kind: "available" };
  }
  return availabilityByInjuryCode[injuryCode] ?? { kind: "unrecognised", code: injuryCode };
}

export const yahooInjuryStatusCodes: ReadonlyArray<string> = Object.keys(availabilityByInjuryCode);

export function yahooTargetPeriod(roster: ProviderRoster): Period {
  return roster.coverage.type === "week"
    ? { kind: "week", week: roster.coverage.week }
    : { kind: "date", date: roster.coverage.date };
}

function refusedLineup(refusals: ReadonlyArray<LineupPlanRefusal>): ProviderLineupOutcome {
  const refusal = refusals.at(-1);
  return {
    kind: "refused",
    action: "native",
    policyVersion: lineupPolicyVersion,
    code: refusal?.code ?? "policy:no-value-source",
    detail: refusal?.detail ?? "This league publishes no value source the custom policy can use.",
    basis: undefined,
  };
}

function projectedPointsInput(
  input: ProviderLineupRequest,
  details: ReadonlyArray<ProviderPlayerDetail>,
): LineupPolicyInput {
  const period = targetPeriodOf(input.roster);
  const slots = yahooLeagueSlots(input.league);
  const players = policyPlayers(input.roster, period);
  const scoring = yahooScoringProfile(input.league);
  const byKey = new Map(details.map((detail) => [detail.providerPlayerKey, detail]));
  const projections: Array<PlayerProjection> = [];
  const realised: Array<PlayerRealisedPoints> = [];
  for (const player of players) {
    const detail = byKey.get(player.id);
    const projection = pointsOf(scoring, detail?.projected?.stats);
    if (projection !== undefined) {
      projections.push({ id: player.id, points: projection });
    }
    const actual = pointsOf(scoring, detail?.actual?.stats);
    if (actual !== undefined) {
      realised.push({ id: player.id, points: actual });
    }
  }
  return {
    period,
    source: { kind: "projected-points", projections, realised },
    slots,
    players,
  };
}

export function yahooPointsPolicyInput(
  input: YahooPolicyFacts & { readonly history: ReadonlyArray<YahooPeriodHistory> },
): LineupPolicyInput {
  const period = targetPeriodOf(input.roster);
  const slots = yahooLeagueSlots(input.league);
  const players = policyPlayers(input.roster, period);
  const window = yahooObservationWindow(input.league, period);
  return {
    period,
    source: {
      kind: "scoring-rules",
      window,
      scoring: yahooScoringProfile(input.league),
      observations: observationsFor(input.history, window),
    },
    slots,
    players,
  };
}

export function yahooCommunityStartRatePolicyInput(
  input: YahooPolicyFacts & { readonly details: ReadonlyArray<ProviderPlayerDetail> },
): LineupPolicyInput {
  const period = targetPeriodOf(input.roster);
  const slots = yahooLeagueSlots(input.league);
  const players = policyPlayers(input.roster, period);
  const byKey = new Map(
    input.details.map((detail) => [detail.providerPlayerKey, detail.communityStartRate]),
  );
  return {
    period,
    source: {
      kind: "community-start-rate",
      started: players.map((player) => startRateOf(player.id, byKey.get(player.id))),
    },
    slots,
    players,
  };
}

function policyPlayers(roster: ProviderRoster, period: Period): ReadonlyArray<PolicyPlayer> {
  return roster.players.map((player) => ({
    id: makePlayerId(player.providerPlayerKey),
    eligiblePositions: player.eligiblePositions,
    availability: yahooAvailability(player.injuryCode),
    locked: player.isEditable !== true,
    currentSlotId: makeSlotId(player.slot),
    nonGamePeriods: nonGamePeriods(player, period),
  }));
}

function rosterSlot(position: ProviderRosterPosition): RosterSlot {
  const id = makeSlotId(position.position);
  const kind = position.kind;
  const eligibility = slotEligibility(position.eligibility);
  switch (kind) {
    case "starting":
      return {
        kind: "starting",
        id,
        capacity: position.count,
        requirement: "required",
        eligibility,
      };
    case "bench":
    case "reserve":
      return { kind, id, capacity: position.count, eligibility };
  }
}

function slotEligibility(positions: ReadonlyArray<string>): SlotEligibility {
  return positions.length === 0
    ? { kind: "any" }
    : { kind: "positions", positions: [...positions] };
}

function startRateOf(
  playerId: PlayerId,
  startRate: ProviderCommunityStartRate | undefined,
): PlayerCommunityStartRate {
  return {
    id: playerId,
    percent: exactPercent(startRate?.percent ?? null),
    cuts: (startRate?.cuts ?? []).flatMap((cut) => {
      const percent = exactPercent(cut.percent);
      return percent === undefined ? [] : [{ cut: cut.cut, percent }];
    }),
  };
}

function exactPercent(percent: number | null): Exact | undefined {
  return percent === null ? undefined : parseExact(String(percent));
}

function pointsOf(
  scoring: ScoringProfile,
  stats: ReadonlyArray<{ readonly statId: number; readonly value: number | null }> | undefined,
): Exact | undefined {
  if (stats === undefined) {
    return undefined;
  }
  const score = scorePeriod(
    scoring,
    stats.map((stat) => ({ statId: String(stat.statId), value: stat.value })),
  );
  return score.kind === "scored" ? score.points : undefined;
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
): ReadonlyArray<PeriodObservation> {
  const stats = statsByPeriodAndPlayer(history);
  return window.map((period) => {
    const players =
      stats.get(periodKey(period)) ?? new Map<string, ReadonlyArray<StatObservation>>();
    return {
      period,
      players: [...players].map(([id, observations]) => ({
        id: makePlayerId(id),
        stats: observations,
      })),
    };
  });
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

function completedWeeks(league: ProviderLeagueSettings, targetWeek: number): ReadonlyArray<Period> {
  const firstWeek = league.periodWindow?.start ?? 1;
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

function targetPeriodOf(roster: ProviderRoster): Period {
  return roster.coverage.type === "week"
    ? { kind: "week", week: roster.coverage.week }
    : { kind: "date", date: roster.coverage.date };
}

function targetPeriod(target: ProviderLineupRequest["target"]): Period {
  switch (target.coverage) {
    case "week":
      return { kind: "week", week: target.week };
    case "date":
      return { kind: "date", date: target.date };
    case "current":
      throw new Error("A provider lineup plan requires a resolved target period");
  }
}

export type YahooPolicyFacts = {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
};

export type YahooLineupReader = {
  readonly readDetails: () => Effect.Effect<
    ReadonlyArray<ProviderPlayerDetail>,
    ProviderReadFailure
  >;
  readonly readHistory: (
    periods: ReadonlyArray<Period>,
  ) => Effect.Effect<ReadonlyArray<YahooPeriodHistory>, ProviderReadFailure>;
};

export type YahooPeriodHistory = {
  readonly period: Period;
  readonly details: ReadonlyArray<ProviderPlayerDetail>;
};
