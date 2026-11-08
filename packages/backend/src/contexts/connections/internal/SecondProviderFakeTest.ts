import { DateTime, Effect } from "effect";

import { fantasyDayLabel } from "#contexts/connections/FantasyDay.ts";
import { ProviderOperationUnsupported } from "#contexts/connections/Provider.ts";
import type {
  ProviderCapabilities,
  ProviderLeagueSettings,
  ProviderOperation,
  ProviderPlayerSearchResult,
  ProviderRoster,
  ProviderRosterSchedule,
  ProviderScoreOutcome,
  ProviderShape,
  ProviderTeam,
} from "#contexts/connections/Provider.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

export const secondProviderKey = decodeProviderKey("atlas");

const secondProviderTeam: ProviderTeam = {
  provider: secondProviderKey,
  providerTeamKey: "atlas.l.900.t.3",
  providerLeagueKey: "atlas.l.900",
  league: "nba",
  sport: "basketball",
  season: 2026,
  name: "Atlas Roto",
};

export const secondProviderLeague: ProviderLeagueSettings = {
  providerLeagueKey: "atlas.l.900",
  name: "Atlas Rotisserie",
  webUrl: "https://atlas.invalid/basketball/900",
  season: 2026,
  startDate: "2026-10-01",
  endDate: "2027-04-10",
  currentDate: "2026-11-02",
  teamCount: 12,
  format: "rotisserie",
  scoringType: "rotisserie",
  scoringLabel: "Roto",
  weeklyDeadline: undefined,
  rosterChange: {
    rule: "next_day",
    source: ["league_settings"],
    detail: "Atlas applies roster changes the day after its current date.",
  },
  waiverType: undefined,
  waiverRule: undefined,
  usesFaab: undefined,
  waiverDays: undefined,
  maxWeeklyAcquisitions: undefined,
  maxSeasonAcquisitions: undefined,
  tradeEndDate: undefined,
  tradeRatification: undefined,
  tradeDraftPicks: undefined,
  tradeObjectionDays: undefined,
  draftStatus: undefined,
  periodWindow: undefined,
  rosterCoverage: "date",
  maxGamesPlayed: undefined,
  maxInningsPitched: undefined,
  rosterPositions: [
    { position: "PG", positionType: "G", kind: "starting", count: 1, eligibility: ["PG"] },
    { position: "SG", positionType: "G", kind: "starting", count: 1, eligibility: ["SG"] },
    { position: "UTIL", positionType: "U", kind: "starting", count: 1, eligibility: [] },
    { position: "BENCH", positionType: "BN", kind: "bench", count: 2, eligibility: [] },
    { position: "RESERVE", positionType: "R", kind: "reserve", count: 1, eligibility: ["PG"] },
  ],
  rosterConstraints: {
    rosterMaximum: 5,
    benchCapacity: "per_slot",
    startingSlotsMayStandEmpty: false,
    reserveEligibility: { kind: "published_positions" },
  },
  statCategories: [],
  statModifiers: [],
};

export const secondProviderRoster: ProviderRoster = {
  providerTeamKey: "atlas.l.900.t.3",
  providerLeagueKey: "atlas.l.900",
  coverage: { type: "date", date: "2026-11-02" },
  players: [
    rosterPlayer("atlas.p.1", "Ada Guard", "PG", "PG", ["PG"]),
    rosterPlayer("atlas.p.2", "Bo Wing", "SG", "SG", ["SG"]),
    rosterPlayer("atlas.p.3", "Cy Swing", "BENCH", "SF", ["SF"]),
    rosterPlayer("atlas.p.4", "Dee Utility", "UTIL", "PG", ["PG"]),
    rosterPlayer("atlas.p.5", "Eve Reserve", "RESERVE", "PG", ["PG"]),
  ],
};

export const secondProviderCapabilities: ProviderCapabilities = {
  fantasyDay: {
    timeZone: "Europe/London",
    boundary: "local-midnight",
    version: "atlas-london-midnight/1",
  },
  sports: ["basketball"],
  playerSearch: {
    sorts: ["name", "position"],
    providerOrderedSorts: [],
    weeklyOrderingValues: true,
  },
  statPeriods: {
    baseball: unsupportedPeriods("Atlas does not serve baseball."),
    basketball: {
      kinds: { season: "native", week: "native", preset: "unsupported", range: "unsupported" },
      presets: [],
      maximumRangeDays: 0,
      detail: "Atlas publishes season and completed-week player series.",
    },
    football: unsupportedPeriods("Atlas does not serve football."),
    hockey: unsupportedPeriods("Atlas does not serve hockey."),
  },
  scheduleRead: { maximumDates: 10 },
  projections: { basis: "week", sports: [] },
  tradeProposal: {
    assets: ["player"],
    detail: "Atlas publishes no trade proposal write and no element for a draft pick.",
  },
  transactionRequest: { maximumAdds: 2, maximumDrops: 2 },
  limitations: [
    {
      subject: "probable_starters",
      detail: "Atlas publishes no real-world starting status for any position.",
    },
  ],
};

export const secondProvider: ProviderShape = {
  key: secondProviderKey,
  capabilities: secondProviderCapabilities,
  validateSession: () => Effect.void,
  discoverTeams: () => Effect.succeed([secondProviderTeam]),
  readLeague: () => Effect.succeed(secondProviderLeague),
  readRoster: ({ period }) =>
    Effect.map(DateTime.now, (now) => ({
      ...secondProviderRoster,
      coverage: period ?? {
        type: "date" as const,
        date: fantasyDayLabel(now, secondProviderCapabilities.fantasyDay),
      },
    })),
  readRosterSchedule: ({ period }) => Effect.succeed(schedule(period)),
  readLeagueRosters: () => unsupported("read_league_rosters"),
  searchPlayers: () => Effect.succeed(searchResults),
  scoreRoster: ({ roster }) => Effect.succeed(scores(roster)),
  readPlayerDetails: () => unsupported("read_player_details"),
  readPlayerHistory: () => unsupported("read_player_history"),
  readPlayerWeeks: () => unsupported("read_player_weeks"),
  readMatchups: () => unsupported("read_matchups"),
  readTransactions: () => unsupported("read_transactions"),
  readCompletedTrades: () => unsupported("read_completed_trades"),
  readPendingTrades: () => unsupported("read_pending_trades"),
  readDraftResults: () => unsupported("read_draft_results"),
  readStandings: () => unsupported("read_standings"),
  readLeagueTeams: () => unsupported("read_league_teams"),
  applyNativeAction: () => notSent,
  applyExplicitAssignments: () => notSent,
  applyTransaction: () => notSent,
  proposeTrade: () => notSent,
  withdrawTrade: () => notSent,
  applyReserveMove: () => notSent,
};

const searchResults: ProviderPlayerSearchResult = {
  players: [
    {
      providerPlayerKey: "atlas.p.1",
      name: "Ada Guard",
      primaryPosition: "PG",
      displayPosition: "PG",
      eligiblePositions: ["PG"],
      availability: "free_agent",
      proTeam: "ATL",
      status: { value: "healthy", code: undefined, detail: undefined },
      percentOwned: 42,
      percentOwnedDelta: 3,
      percentStarted: 31,
      percentStartedChange: 2,
      actualRank: 12,
      overallRank: 40,
      statValue: 18,
      transactionTrend: { status: "not_published", reason: "Atlas publishes no move counts." },
    },
  ],
};

function rosterPlayer(
  providerPlayerKey: string,
  name: string,
  slot: string,
  primaryPosition: string,
  eligiblePositions: ReadonlyArray<string>,
): ProviderRoster["players"][number] {
  return {
    providerPlayerKey,
    name,
    displayPosition: primaryPosition,
    primaryPosition,
    positionType: "G",
    proTeamAbbreviation: "ATL",
    eligiblePositions,
    slot: { status: "verified", slot },
    isEditable: true,
    injuryCode: undefined,
    injuryDetail: undefined,
    byeWeek: null,
    scheduled: true,
    startingLineup: "unconfirmed",
    undroppable: null,
    transactionTrend: { status: "not_published", reason: "Atlas publishes no move counts." },
  };
}

function schedule(period: ProviderRosterSchedule["period"]): ProviderRosterSchedule {
  const dates = period.type === "date" ? datesBetween(period.start, period.end) : [];
  return {
    providerTeamKey: secondProviderRoster.providerTeamKey,
    period,
    dates,
    players: secondProviderRoster.players.map((player) => ({
      providerPlayerKey: player.providerPlayerKey,
      name: player.name,
      proTeamKey: undefined,
      proTeamAbbreviation: player.proTeamAbbreviation,
      games:
        dates.length === 0
          ? [{ date: undefined, opponent: "BOS", home: true }]
          : dates.map((date) => ({ date, opponent: "BOS", home: true })),
    })),
  };
}

function datesBetween(start: string, end: string): ReadonlyArray<string> {
  const first = DateTime.makeUnsafe(`${start}T00:00:00.000Z`);
  const last = DateTime.makeUnsafe(`${end}T00:00:00.000Z`);
  const span = Math.floor(
    (DateTime.toEpochMillis(last) - DateTime.toEpochMillis(first)) / 86_400_000,
  );
  return globalThis.Array.from({ length: span + 1 }, (_, index) =>
    DateTime.formatIsoDate(DateTime.add(first, { days: index })),
  );
}

function scores(roster: ProviderRoster): ProviderScoreOutcome {
  return {
    kind: "scored",
    provenance: "atlas/league-rules",
    gamesPlayed: [],
    players: roster.players.map((player) => ({
      providerPlayerKey: player.providerPlayerKey,
      score: player.providerPlayerKey === "atlas.p.3" ? 2400 : 1200,
      availability: "will-play",
    })),
  };
}

const notSent = Effect.succeed({
  status: "not_sent" as const,
  reason: "session_incomplete" as const,
  detail: "The second provider test double sends no writes.",
});

function unsupported(
  operation: ProviderOperation,
): Effect.Effect<never, ProviderOperationUnsupported> {
  return Effect.fail(
    ProviderOperationUnsupported.make({
      operation,
      reason: "The second provider test double serves only reads the generic boundary proves.",
    }),
  );
}

function unsupportedPeriods(detail: string): ProviderCapabilities["statPeriods"]["baseball"] {
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
