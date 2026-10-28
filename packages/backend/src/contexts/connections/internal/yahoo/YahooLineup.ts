import { DateTime, Effect } from "effect";

import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import { parseExact } from "#contexts/connections/internal/provider-scoring/Exact.ts";
import { scoreLineup } from "#contexts/connections/internal/provider-scoring/LineupScore.ts";
import type { ScoredPlayer } from "#contexts/connections/internal/provider-scoring/LineupScore.ts";
import { periodKey } from "#contexts/connections/internal/provider-scoring/Period.ts";
import { scoringProfile } from "#contexts/connections/internal/provider-scoring/ScoringProfile.ts";
import type {
  Exact,
  Period,
  ScoringProfile,
  PlayerAvailability,
  PlayerCommunityStartRate,
  PlayerOwnership,
  PlayerRank,
  PolicyPlayer,
  StartingLineupRule,
  StatObservation,
  ValueSource,
} from "#contexts/connections/internal/provider-scoring/types.ts";
import type {
  ProviderCapabilities,
  ProviderGamesPlayed,
  ProviderLeagueSettings,
  ProviderScoreOutcome,
  ProviderScoreRequest,
  ProviderPlayerDetail,
  ProviderPlayerScore,
  ProviderRoster,
  ProviderRosterPlayer,
  ProviderScoringWeek,
} from "#contexts/connections/Provider.ts";
import type { ProviderReadFailure } from "#contexts/connections/Provider.ts";

const supportedSports = ["football", "hockey"] as const;
const observationWindowPeriods = 4;

type SupportedSport = (typeof supportedSports)[number];

function isSupportedSport(sport: FantasySport): sport is SupportedSport {
  return supportedSports.some((supported) => supported === sport);
}

export const yahooCapabilities: ProviderCapabilities = {
  fantasyDay: {
    timeZone: "America/Los_Angeles",
    boundary: "local-midnight",
    version: "yahoo-pacific-midnight/1",
  },
  sports: [...supportedSports],
  playerSearch: {
    sorts: ["name", "position", "ownership", "actual_rank", "overall_rank", "stat"],
    providerOrderedSorts: ["actual_rank", "overall_rank", "stat"],
    weeklyStatSeriesSports: ["football"],
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
        "Yahoo publishes a real-world starting status for goalies and pitchers only, and only once that game's starter is announced. Every other position carries no starting signal and stays unconfirmed, so participation for them is reported only through the provider's injury status.",
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

export function scoreYahooRoster(
  input: ProviderScoreRequest,
  read: YahooLineupReader,
): Effect.Effect<ProviderScoreOutcome, ProviderReadFailure> {
  return Effect.gen(function* () {
    if (!isSupportedSport(input.sport)) {
      return {
        kind: "refused",
        refusal: "structural",
        provenance: "yahoo/unsupported-sport",
        detail: "This provider does not plan lineups for this sport.",
      };
    }
    const period = targetPeriod(input.target);
    const gamesLimited =
      input.league.maxGamesPlayed !== undefined || input.league.maxInningsPitched !== undefined;
    const gamesPlayed = gamesLimited ? yield* read.readGamesPlayed() : [];
    const players = policyPlayers(input, period, gamesPlayed);
    const facts = yield* read.readPlayerFacts();
    const sources: Array<ValueSource> = [];
    if (gamesLimited) {
      sources.push({
        kind: "ownership-composite",
        sport: input.sport,
        teamCount: input.league.teamCount,
        standardRosterSpots: standardRosterSpots(input.league),
        players: ownershipFactsOf(players, facts),
      });
    } else {
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
        started: startRatesOf(players, facts),
      });
    }

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
      gamesPlayed,
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

const healthyAvailability: PlayerAvailability = { kind: "available" };

const yahooStatusTable: Readonly<Record<string, PlayerAvailability>> = {
  healthy: healthyAvailability,
  O: { kind: "excluded", reason: "out" },
  IR: { kind: "excluded", reason: "injured-reserve" },
  "IR+": { kind: "excluded", reason: "injured-reserve" },
  "IR-LT": { kind: "excluded", reason: "injured-reserve" },
  NA: { kind: "excluded", reason: "not-active" },
  SUSP: { kind: "excluded", reason: "suspended" },
  D: { kind: "uncertain", code: "D" },
  DTD: { kind: "uncertain", code: "DTD" },
  Q: { kind: "uncertain", code: "Q" },
  P: { kind: "uncertain", code: "P" },
  GTD: { kind: "uncertain", code: "GTD" },
};

type StartingLineupRole = "goalie" | "position-player";

const yahooStartingLineupRoleBySport: Readonly<
  Partial<Record<FantasySport, Readonly<Record<string, StartingLineupRole>>>>
> = {
  football: {
    DEF: "position-player",
    K: "position-player",
    QB: "position-player",
    "Q/W/R/T": "position-player",
    RB: "position-player",
    TE: "position-player",
    "W/R": "position-player",
    "W/T": "position-player",
    WR: "position-player",
  },
  hockey: {
    C: "position-player",
    D: "position-player",
    F: "position-player",
    G: "goalie",
    LW: "position-player",
    RW: "position-player",
  },
};

const yahooStartingLineupRuleByRole: Readonly<Record<StartingLineupRole, StartingLineupRule>> = {
  goalie: "unlikely-to-play",
  "position-player": "not-an-availability-fact",
};

const yahooDefaultStartingLineupRole: StartingLineupRole = "position-player";

function yahooStartingLineupRole(sport: FantasySport, position: string): StartingLineupRole {
  return yahooStartingLineupRoleBySport[sport]?.[position] ?? yahooDefaultStartingLineupRole;
}

function yahooStartingLineupRule(sport: FantasySport, position: string): StartingLineupRule {
  return yahooStartingLineupRuleByRole[yahooStartingLineupRole(sport, position)];
}

export function yahooAvailability(injuryCode: string | undefined): PlayerAvailability {
  if (injuryCode === undefined) {
    return healthyAvailability;
  }
  return yahooStatusTable[injuryCode] ?? { kind: "unrecognised", code: injuryCode };
}

export const yahooInjuryStatusCodes: ReadonlyArray<string> = Object.keys(yahooStatusTable);

export function yahooTargetPeriod(roster: ProviderRoster): Period {
  return roster.coverage.type === "week"
    ? { kind: "week", week: roster.coverage.week }
    : { kind: "date", date: roster.coverage.date };
}

function providerValue(player: ScoredPlayer): ProviderPlayerScore {
  return {
    providerPlayerKey: player.id,
    score: player.units ?? null,
    availability: player.availability,
  };
}

function policyPlayers(
  input: ProviderScoreRequest,
  period: Period,
  gamesPlayed: ReadonlyArray<ProviderGamesPlayed>,
): ReadonlyArray<PolicyPlayer> {
  const limits = new Map(gamesPlayed.map((entry) => [entry.position, entry]));
  return input.roster.players.map((player) => ({
    id: player.providerPlayerKey,
    availability: yahooAvailability(player.injuryCode),
    scheduled: participationCounts(player, limits) ? player.scheduled : true,
    startingLineup: player.startingLineup,
    startingLineupRule: yahooStartingLineupRule(input.sport, player.primaryPosition),
    nonGamePeriods: nonGamePeriods(player, period),
  }));
}

function participationCounts(
  player: ProviderRosterPlayer,
  limits: ReadonlyMap<string, ProviderGamesPlayed>,
): boolean {
  const limit = limitOf(player, limits);
  return limit === undefined || limit.projected <= limit.max;
}

function limitOf(
  player: ProviderRosterPlayer,
  limits: ReadonlyMap<string, ProviderGamesPlayed>,
): ProviderGamesPlayed | undefined {
  const current = limits.get(player.slot);
  if (current !== undefined) {
    return current;
  }
  return player.eligiblePositions
    .map((position) => limits.get(position))
    .filter((entry): entry is ProviderGamesPlayed => entry !== undefined && entry.max > 0)
    .reduce<ProviderGamesPlayed | undefined>(
      (lowest, entry) =>
        lowest === undefined || entry.projected / entry.max < lowest.projected / lowest.max
          ? entry
          : lowest,
      undefined,
    );
}

function standardRosterSpots(league: ProviderLeagueSettings): number {
  return league.rosterPositions
    .filter((position) => position.kind !== "reserve")
    .reduce((total, position) => total + position.count, 0);
}

function nonGamePeriods(player: ProviderRosterPlayer, period: Period): ReadonlyArray<Period> {
  if (period.kind !== "week" || player.byeWeek === null) {
    return [];
  }
  return [{ kind: "week", week: player.byeWeek }];
}

function ownershipFactsOf(
  players: ReadonlyArray<PolicyPlayer>,
  facts: ReadonlyArray<YahooPlayerFacts>,
): ReadonlyArray<PlayerOwnership> {
  const byKey = new Map(facts.map((fact) => [fact.providerPlayerKey, fact]));
  return players.map((player) => {
    const fact = byKey.get(player.id);
    return {
      id: player.id,
      percentOwned: exactPercent(fact?.percentOwned ?? null),
      delta:
        fact?.percentOwnedDelta === null || fact?.percentOwnedDelta === undefined
          ? undefined
          : parseExact(String(fact.percentOwnedDelta)),
      ranks: fact?.ranks ?? [],
    };
  });
}

function startRatesOf(
  players: ReadonlyArray<PolicyPlayer>,
  rates: ReadonlyArray<YahooPlayerFacts>,
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
  for (let week = targetWeek - observationWindowPeriods; week < targetWeek; week += 1) {
    if (week >= firstWeek) {
      periods.push({ kind: "week", week });
    }
  }
  return periods;
}

function completedDates(league: ProviderLeagueSettings, targetDate: string): ReadonlyArray<Period> {
  const target = DateTime.makeUnsafe(`${targetDate}T00:00:00.000Z`);
  const periods: Array<Period> = [];
  for (let offset = observationWindowPeriods; offset >= 1; offset -= 1) {
    const date = DateTime.formatIsoDate(DateTime.add(target, { days: -offset }));
    if (league.startDate === undefined || date >= league.startDate) {
      periods.push({ kind: "date", date });
    }
  }
  return periods;
}

function targetPeriod(target: ProviderScoreRequest["target"]): Period {
  switch (target.coverage) {
    case "week":
      return { kind: "week", week: target.week };
    case "date":
      return { kind: "date", date: target.date };
    case "current":
      throw new Error("A provider lineup plan requires a resolved target period");
  }
}

export type YahooPlayerFacts = YahooStartRateSummary & {
  readonly providerPlayerKey: string;
  readonly percentOwned: number | null;
  readonly percentOwnedDelta: number | null;
  readonly ranks: ReadonlyArray<PlayerRank>;
};

export type YahooStartRateSummary = {
  readonly percent: number | null;
  readonly cuts: ReadonlyArray<YahooStartRateCut>;
};

export type YahooStartRateCut = {
  readonly cut: string;
  readonly percent: number | null;
};

export type YahooLineupReader = {
  readonly readPlayerFacts: () => Effect.Effect<
    ReadonlyArray<YahooPlayerFacts>,
    ProviderReadFailure
  >;
  readonly readGamesPlayed: () => Effect.Effect<
    ReadonlyArray<ProviderGamesPlayed>,
    ProviderReadFailure
  >;
  readonly readHistory: (
    periods: ReadonlyArray<ProviderScoringWeek>,
  ) => Effect.Effect<ReadonlyArray<YahooPeriodHistory>, ProviderReadFailure>;
};

export type YahooPeriodHistory = {
  readonly period: Period;
  readonly details: ReadonlyArray<ProviderPlayerDetail>;
};
