import { DateTime, Effect } from "effect";

import { parseExact } from "#contexts/connections/internal/provider-scoring/Exact.ts";
import { scoreLineup } from "#contexts/connections/internal/provider-scoring/LineupScore.ts";
import type { ScoredPlayer } from "#contexts/connections/internal/provider-scoring/LineupScore.ts";
import { trailingPeriodCount } from "#contexts/connections/internal/provider-scoring/ObservationWindow.ts";
import { periodKey } from "#contexts/connections/internal/provider-scoring/Period.ts";
import { scoringProfile } from "#contexts/connections/internal/provider-scoring/ScoringProfile.ts";
import type {
  Exact,
  Period,
  ScoringProfile,
  PlayerAvailability,
  PlayerCommunityStartRate,
  PolicyPlayer,
  StatObservation,
  ValueSource,
} from "#contexts/connections/internal/provider-scoring/types.ts";
import type {
  ProviderCapabilities,
  ProviderLeagueSettings,
  ProviderLineupOutcome,
  ProviderLineupRequest,
  ProviderPlayerDetail,
  ProviderPlayerValue,
  ProviderRoster,
  ProviderRosterCoverage,
  ProviderRosterPlayer,
  ProviderScoringWeek,
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
    const period = targetPeriod(input.target);
    const players = policyPlayers(input.roster, period);
    const sources: Array<ValueSource> = [];
    if (input.league.statModifiers.length > 0) {
      const window = yahooObservationWindow(input.league, period);
      sources.push({
        kind: "scoring-rules",
        window,
        scoring: yahooScoringProfile(input.league),
        observations: observationsFor(
          yield* read.readHistory(window.filter((entry) => entry.kind === "week")),
          window,
        ),
      });
    }
    sources.push({
      kind: "community-start-rate",
      started: startRatesOf(players, yield* read.readStartRates()),
    });

    const scored = scoreLineup({ period, sources, players });
    if (scored.kind === "refused") {
      return {
        kind: "refused",
        refusal: scored.refusal,
        provenance: `yahoo/${scored.code}`,
        detail: scored.detail,
      };
    }
    return {
      kind: "scored",
      provenance: `yahoo/${scored.label}`,
      players: scored.players.map(providerValue),
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

function providerValue(player: ScoredPlayer): ProviderPlayerValue {
  return {
    providerPlayerKey: player.id,
    score: player.units ?? null,
    availability: player.availability.tier,
  };
}

function policyPlayers(roster: ProviderRoster, period: Period): ReadonlyArray<PolicyPlayer> {
  return roster.players.map((player) => ({
    id: player.providerPlayerKey,
    availability: yahooAvailability(player.injuryCode),
    nonGamePeriods: nonGamePeriods(player, period),
  }));
}

function nonGamePeriods(player: ProviderRosterPlayer, period: Period): ReadonlyArray<Period> {
  if (period.kind !== "week" || player.byeWeek === null) {
    return [];
  }
  return [{ kind: "week", week: player.byeWeek }];
}

function startRatesOf(
  players: ReadonlyArray<PolicyPlayer>,
  rates: ReadonlyArray<YahooStartRate>,
): ReadonlyArray<PlayerCommunityStartRate> {
  const byKey = new Map(rates.map((rate) => [rate.providerPlayerKey, rate]));
  return players.map((player) => {
    const rate = byKey.get(player.id);
    return {
      id: player.id,
      percent: exactPercent(rate?.percent ?? null),
      cuts: (rate?.cuts ?? []).flatMap((cut) => {
        const percent = exactPercent(cut.percent);
        return percent === undefined ? [] : [{ cut: cut.cut, percent }];
      }),
    };
  });
}

function exactPercent(percent: number | null): Exact | undefined {
  return percent === null ? undefined : parseExact(String(percent));
}

function observationsFor(
  history: ReadonlyArray<YahooPeriodHistory>,
  window: ReadonlyArray<Period>,
): ReadonlyArray<{
  readonly period: Period;
  readonly players: ReadonlyArray<{
    readonly id: string;
    readonly stats: ReadonlyArray<StatObservation>;
  }>;
}> {
  const stats = statsByPeriodAndPlayer(history);
  return window.map((period) => {
    const players =
      stats.get(periodKey(period)) ?? new Map<string, ReadonlyArray<StatObservation>>();
    return {
      period,
      players: [...players].map(([id, observations]) => ({ id, stats: observations })),
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

export type YahooStartRate = { readonly providerPlayerKey: string } & YahooStartRateSummary;

export type YahooStartRateSummary = {
  readonly percent: number | null;
  readonly change: number | null;
  readonly coverage: ProviderRosterCoverage | null;
  readonly cuts: ReadonlyArray<YahooStartRateCut>;
};

export type YahooStartRateCut = {
  readonly cut: string;
  readonly percent: number | null;
};

export type YahooLineupReader = {
  readonly readStartRates: () => Effect.Effect<ReadonlyArray<YahooStartRate>, ProviderReadFailure>;
  readonly readHistory: (
    periods: ReadonlyArray<ProviderScoringWeek>,
  ) => Effect.Effect<ReadonlyArray<YahooPeriodHistory>, ProviderReadFailure>;
};

export type YahooPeriodHistory = {
  readonly period: Period;
  readonly details: ReadonlyArray<ProviderPlayerDetail>;
};
