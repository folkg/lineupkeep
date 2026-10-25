import { Schema } from "effect";

import { ConnectionId } from "./Connection.ts";
import { TeamId } from "./FantasyTeam.ts";
import {
  CounterpartyRef,
  Cursor,
  NarrowingResult,
  PageLimit,
  PlayerRef,
  QueryBudget,
  QueryCoverage,
  QueryFailure,
  QueryPage,
  QueryPeriod,
  QueryStatus,
  QueryTeam,
  StatRef,
  TeamListRow,
} from "./QueryValues.ts";

export const ListTeamsInput = Schema.Struct({
  sport: Schema.optional(Schema.Literals(["football", "hockey"])),
  season: Schema.optional(Schema.Int.check(Schema.isGreaterThan(1900))),
  connection: Schema.optional(ConnectionId),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type ListTeamsInput = typeof ListTeamsInput.Type;

export const ListTeamsData = Schema.Struct({
  status: Schema.Literal("ok"),
  teams: Schema.Array(TeamListRow),
  page: QueryPage,
  budget: QueryBudget,
});
export type ListTeamsData = typeof ListTeamsData.Type;
export const ListTeamsResult = Schema.Union([ListTeamsData, NarrowingResult]);
export type ListTeamsResult = typeof ListTeamsResult.Type;

export const GetCalendarInput = Schema.Struct({
  team: TeamId,
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetCalendarInput = typeof GetCalendarInput.Type;

const CalendarPeriod = Schema.Struct({
  week: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  isCurrent: Schema.Boolean,
});

export const CalendarData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  periods: Schema.Array(CalendarPeriod),
  window: Schema.optional(
    Schema.Struct({
      currentWeek: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      startWeek: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      endWeek: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
  ),
  dates: Schema.optional(
    Schema.Struct({
      start: Schema.optional(Schema.String),
      end: Schema.optional(Schema.String),
    }),
  ),
  lockContext: Schema.optional(
    Schema.Struct({
      status: Schema.Literal("unverified"),
      weeklyDeadline: Schema.optional(Schema.String),
      detail: Schema.String,
    }),
  ),
  historical: Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.String,
  }),
  coverage: Schema.Array(QueryCoverage),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type CalendarData = typeof CalendarData.Type;
export const CalendarResult = Schema.Union([CalendarData, NarrowingResult]);
export type CalendarResult = typeof CalendarResult.Type;

export const LeagueGroup = Schema.Literals(["overview", "scoring", "roster_rules", "standings"]);
export type LeagueGroup = typeof LeagueGroup.Type;

export const GetLeagueInput = Schema.Struct({
  team: TeamId,
  groups: Schema.optional(Schema.Array(LeagueGroup)),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetLeagueInput = typeof GetLeagueInput.Type;

const LeagueOverview = Schema.Struct({
  name: Schema.NonEmptyString,
  teamCount: Schema.Int.check(Schema.isGreaterThan(0)),
  scoringType: Schema.NonEmptyString,
  scoringLabel: Schema.optional(Schema.String),
  currentWeek: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  startWeek: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  endWeek: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  startDate: Schema.optional(Schema.String),
  endDate: Schema.optional(Schema.String),
  weeklyDeadline: Schema.optional(Schema.String),
  waiver: Schema.Struct({
    type: Schema.optional(Schema.String),
    rule: Schema.optional(Schema.String),
    usesFaab: Schema.optional(Schema.Boolean),
  }),
});

const RosterRule = Schema.Struct({
  position: Schema.NonEmptyString,
  kind: Schema.Literals(["starter", "bench", "reserve"]),
  count: Schema.Int.check(Schema.isGreaterThan(0)),
});

const RosterRules = Schema.Struct({
  positions: Schema.Array(RosterRule),
  starterCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  benchCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  reserveCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const ScoringCategory = Schema.Struct({
  stat: StatRef,
  name: Schema.NonEmptyString,
  abbreviation: Schema.NonEmptyString,
  group: Schema.NonEmptyString,
  enabled: Schema.Boolean,
  positionTypes: Schema.Array(Schema.NonEmptyString),
  points: Schema.NullOr(Schema.String),
});

export const LeagueData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  overview: Schema.optional(LeagueOverview),
  rosterRules: Schema.optional(RosterRules),
  scoring: Schema.Array(ScoringCategory),
  standings: Schema.optional(
    Schema.Struct({
      status: Schema.Literal("unsupported"),
      detail: Schema.String,
    }),
  ),
  coverage: Schema.Array(QueryCoverage),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type LeagueData = typeof LeagueData.Type;
export const LeagueResult = Schema.Union([LeagueData, NarrowingResult]);
export type LeagueResult = typeof LeagueResult.Type;

export const RosterDetail = Schema.Literals(["compact", "full"]);
export type RosterDetail = typeof RosterDetail.Type;

export const GetRostersInput = Schema.Struct({
  team: TeamId,
  period: Schema.optional(QueryPeriod),
  detail: Schema.optional(RosterDetail),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetRostersInput = typeof GetRostersInput.Type;

export const RosterPlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  slot: Schema.NonEmptyString,
  primaryPosition: Schema.NonEmptyString,
  displayPosition: Schema.NonEmptyString,
  eligiblePositions: Schema.Array(Schema.NonEmptyString),
  editable: Schema.NullOr(Schema.Boolean),
  injury: Schema.Struct({
    reported: Schema.Boolean,
    code: Schema.optional(Schema.String),
    detail: Schema.optional(Schema.String),
  }),
  byeWeek: Schema.optional(Schema.NullOr(Schema.Int)),
  undroppable: Schema.optional(Schema.NullOr(Schema.Boolean)),
  isFlex: Schema.optional(Schema.NullOr(Schema.Boolean)),
});
export type RosterPlayer = typeof RosterPlayer.Type;

export const RosterData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  period: Schema.optional(QueryPeriod),
  coverage: Schema.Array(QueryCoverage),
  players: Schema.Array(RosterPlayer),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type RosterData = typeof RosterData.Type;
export const RosterResult = Schema.Union([RosterData, NarrowingResult]);
export type RosterResult = typeof RosterResult.Type;

export const PlayerGroup = Schema.Literals([
  "identity",
  "availability",
  "eligibility",
  "actual_stats",
  "projections",
  "scoring_context",
]);
export type PlayerGroup = typeof PlayerGroup.Type;

const SearchAvailability = Schema.Literals(["all", "free_agent", "waiver"]);

const PlayerSort = Schema.Literals(["name", "position", "ownership"]);

export const SearchPlayersInput = Schema.Struct({
  team: TeamId,
  query: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
  ),
  positions: Schema.optional(
    Schema.Array(
      Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(8))),
    ).pipe(Schema.check(Schema.isMaxLength(8))),
  ),
  availability: Schema.optional(SearchAvailability),
  sort: Schema.optional(PlayerSort),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type SearchPlayersInput = typeof SearchPlayersInput.Type;

const SearchPlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  primaryPosition: Schema.NonEmptyString,
  displayPosition: Schema.NonEmptyString,
  eligiblePositions: Schema.Array(Schema.NonEmptyString),
  availability: Schema.Literals(["free_agent", "waiver", "rostered", "unknown"]),
  percentOwned: Schema.NullOr(Schema.Finite),
});

export const SearchPlayersData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  coverage: Schema.Array(QueryCoverage),
  players: Schema.Array(SearchPlayer),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type SearchPlayersData = typeof SearchPlayersData.Type;
export const SearchPlayersResult = Schema.Union([SearchPlayersData, NarrowingResult]);
export type SearchPlayersResult = typeof SearchPlayersResult.Type;

export const GetPlayersInput = Schema.Struct({
  team: TeamId,
  players: Schema.Array(PlayerRef).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(25)),
  ),
  period: Schema.optional(QueryPeriod),
  groups: Schema.optional(Schema.Array(PlayerGroup)),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetPlayersInput = typeof GetPlayersInput.Type;

const StatValue = Schema.Struct({
  stat: StatRef,
  value: Schema.NullOr(Schema.Finite),
});

const StatGroup = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    period: QueryPeriod,
    stats: Schema.Array(StatValue),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.String,
  }),
]);

const ScoringContext = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    categories: Schema.Array(StatRef),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.String,
  }),
]);

const PlayerAvailability = Schema.Struct({
  rosterStatus: Schema.Literals(["rostered", "free_agent", "waiver", "unknown"]),
  injury: Schema.Struct({
    reported: Schema.Boolean,
    code: Schema.optional(Schema.String),
    detail: Schema.optional(Schema.String),
  }),
});

const PlayerIdentity = Schema.Struct({
  name: Schema.NonEmptyString,
  primaryPosition: Schema.NonEmptyString,
  displayPosition: Schema.NonEmptyString,
});

const PlayerEligibility = Schema.Struct({
  eligiblePositions: Schema.Array(Schema.NonEmptyString),
});

const PlayerDetail = Schema.Struct({
  player: PlayerRef,
  identity: Schema.optional(PlayerIdentity),
  availability: Schema.optional(PlayerAvailability),
  eligibility: Schema.optional(PlayerEligibility),
  actualStats: Schema.optional(StatGroup),
  projections: Schema.optional(StatGroup),
  scoringContext: Schema.optional(ScoringContext),
});

const StatDefinition = Schema.Struct({
  stat: StatRef,
  name: Schema.NullOr(Schema.String),
  abbreviation: Schema.NullOr(Schema.String),
  group: Schema.NullOr(Schema.String),
  unit: Schema.Literal("provider_reported"),
});

export const PlayersData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  period: Schema.optional(QueryPeriod),
  dictionary: Schema.Array(StatDefinition),
  players: Schema.Array(PlayerDetail),
  coverage: Schema.Array(QueryCoverage),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type PlayersData = typeof PlayersData.Type;
export const PlayersResult = Schema.Union([PlayersData, NarrowingResult]);
export type PlayersResult = typeof PlayersResult.Type;

export const GetMatchupsInput = Schema.Struct({
  team: TeamId,
  period: QueryPeriod,
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetMatchupsInput = typeof GetMatchupsInput.Type;

const MatchupTeam = Schema.Struct({
  team: CounterpartyRef,
  name: Schema.NonEmptyString,
  points: Schema.NullOr(Schema.Finite),
});

const Matchup = Schema.Struct({
  period: QueryPeriod,
  home: MatchupTeam,
  away: MatchupTeam,
  status: Schema.optional(Schema.String),
});

export const MatchupsData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  period: QueryPeriod,
  matchups: Schema.Array(Matchup),
  coverage: Schema.Array(QueryCoverage),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type MatchupsData = typeof MatchupsData.Type;
export const MatchupsResult = Schema.Union([MatchupsData, NarrowingResult]);
export type MatchupsResult = typeof MatchupsResult.Type;

export const GetTransactionsInput = Schema.Struct({
  team: TeamId,
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetTransactionsInput = typeof GetTransactionsInput.Type;

const Transaction = Schema.Struct({
  occurredAt: Schema.String,
  type: Schema.Literals(["add", "drop", "add_drop", "trade", "commissioner", "other"]),
  status: Schema.optional(Schema.String),
  teams: Schema.Array(Schema.Struct({ team: CounterpartyRef, name: Schema.NonEmptyString })),
  players: Schema.Array(
    Schema.Struct({
      player: PlayerRef,
      direction: Schema.Literals(["add", "drop", "incoming", "outgoing"]),
    }),
  ),
});

export const TransactionsData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  transactions: Schema.Array(Transaction),
  coverage: Schema.Array(QueryCoverage),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type TransactionsData = typeof TransactionsData.Type;
export const TransactionsResult = Schema.Union([TransactionsData, NarrowingResult]);
export type TransactionsResult = typeof TransactionsResult.Type;
