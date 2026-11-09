import { Effect } from "effect";

import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import { parseExact } from "#contexts/connections/internal/provider-scoring/Exact.ts";
import { scoreLineup } from "#contexts/connections/internal/provider-scoring/LineupScore.ts";
import type { ScoredPlayer } from "#contexts/connections/internal/provider-scoring/LineupScore.ts";
import type {
  Exact,
  Period,
  PlayerAvailability,
  PlayerCommunityStartRate,
  PlayerOwnership,
  PlayerRank,
  PolicyPlayer,
  StartingLineupRule,
  ValueSource,
} from "#contexts/connections/internal/provider-scoring/types.ts";
import type {
  PlayerWeekOpponent,
  ProviderCapabilities,
  ProviderGamesPlayed,
  ProviderLeagueSettings,
  ProviderPlayerStatus,
  ProviderScoreOutcome,
  ProviderScoreRequest,
  ProviderPlayerScore,
  ProviderRoster,
  ProviderRosterPlayer,
  ProviderPeriodSupport,
} from "#contexts/connections/Provider.ts";
import type { ProviderReadFailure } from "#contexts/connections/Provider.ts";

const supportedSports = ["football", "hockey"] as const;

type SupportedSport = (typeof supportedSports)[number];

function isSupportedSport(sport: FantasySport): sport is SupportedSport {
  return supportedSports.some((supported) => supported === sport);
}

function unsupportedSportPeriods(detail: string): ProviderPeriodSupport {
  return {
    kinds: {
      season: "unsupported",
      week: "unsupported",
      preset: "unsupported",
      range: "unsupported",
    },
    presets: [],
    maximumRangeDays: 0,
    detail,
  };
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
    weeklyOrderingValues: false,
  },
  statPeriods: {
    football: {
      kinds: {
        season: "native",
        week: "native",
        preset: "unsupported",
        range: "unsupported",
      },
      presets: [],
      maximumRangeDays: 0,
      detail:
        "Football publishes season and completed-week player series, and no daily player series, so a preset window or an explicit range is refused rather than guessed from weekly values.",
    },
    hockey: {
      kinds: {
        season: "native",
        week: "unsupported",
        preset: "aggregated",
        range: "aggregated",
      },
      presets: [
        { preset: "last_7_days", days: 7 },
        { preset: "last_14_days", days: 14 },
        { preset: "last_30_days", days: 30 },
      ],
      maximumRangeDays: 31,
      detail:
        "Hockey publishes season totals and one day of player statistics at a time, and no weekly player series. A preset window or an explicit range is the sum of your league's daily reads for the days it covers; average and percentage categories are not summed and are listed as not aggregated.",
    },
    baseball: unsupportedSportPeriods("Your league does not serve baseball."),
    basketball: unsupportedSportPeriods("Your league does not serve basketball."),
  },
  projections: { basis: "week", sports: ["football"] },
  scheduleRead: { maximumDates: 21 },
  tradeProposal: {
    assets: ["player"],
    detail:
      "Yahoo's web trade request accepts players only and refused a draft pick with \"Invalid XML POSTed. Error code 25\". Its app trade request does accept a draft pick, but Lineupgrade has not shown that your stored sign-in can write to that host, so it cannot send one. A league's available draft picks are read and a pick trade is reviewed, never offered.",
  },
  transactionRequest: { maximumAdds: 1, maximumDrops: 1 },
  limitations: [
    {
      subject: "team_remaining_games",
      detail:
        "Yahoo publishes no remaining-game count for football: a player plays at most one game per scoring week, and each roster entry carries the bye week instead.",
    },
    {
      subject: "per_team_games_played",
      detail:
        "Yahoo publishes no per-team games-played count: its teams games-played output returns an empty per-team node, and its roster, standings, and players reads refuse that output, so only the league's games-played cap is known.",
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
        detail: "Your league does not plan lineups for this sport.",
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
      const projection = projectedRankSource(input, period, facts);
      if (projection !== undefined) {
        sources.push(projection);
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

const healthyAvailability: PlayerAvailability = { kind: "available" };

const yahooStatusTable: Readonly<Record<string, PlayerAvailability>> = {
  healthy: healthyAvailability,
  O: { kind: "excluded", reason: "out" },
  IR: { kind: "excluded", reason: "injured-reserve" },
  "IR+": { kind: "excluded", reason: "injured-reserve" },
  "IR-LT": { kind: "excluded", reason: "injured-reserve" },
  "IR-NR": { kind: "excluded", reason: "injured-reserve" },
  "IR-R": { kind: "excluded", reason: "injured-reserve" },
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

export function yahooPlayerStatus(injuryCode: string | undefined): ProviderPlayerStatus {
  const availability = yahooAvailability(injuryCode);
  switch (availability.kind) {
    case "available":
      return "healthy";
    case "uncertain":
      return "day_to_day";
    case "excluded":
      return availability.reason === "injured-reserve" ? "injured_reserve" : "out";
    case "unrecognised":
      return "unknown";
  }
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
  const current = player.slot.status === "verified" ? limits.get(player.slot.slot) : undefined;
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

function projectedRankSource(
  input: ProviderScoreRequest,
  period: Period,
  facts: ReadonlyArray<YahooPlayerFacts>,
): ValueSource | undefined {
  const current = input.league.periodWindow?.current;
  if (period.kind !== "week" || current !== period.week) {
    return undefined;
  }
  return {
    kind: "projection",
    period,
    players: facts.flatMap((fact) => {
      const rank = fact.ranks.find((entry) => entry.type === "PW");
      return rank === undefined ? [] : [{ id: fact.providerPlayerKey, rank: rank.rank }];
    }),
  };
}

function targetPeriod(target: ProviderScoreRequest["target"]): Period {
  switch (target.coverage) {
    case "week":
      return { kind: "week", week: target.week };
    case "date":
      return { kind: "date", date: target.date };
    case "current":
      throw new Error("Your league lineup plan requires a resolved target period");
  }
}

export type YahooPlayerFacts = YahooStartRateSummary & {
  readonly providerPlayerKey: string;
  readonly percentOwned: number | null;
  readonly percentOwnedDelta: number | null;
  readonly ranks: ReadonlyArray<PlayerRank>;
  readonly opponent?: PlayerWeekOpponent;
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
};
