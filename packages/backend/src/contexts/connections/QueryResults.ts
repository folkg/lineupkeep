import { Schema } from "effect";

import { ConnectionId } from "./Connection.ts";
import { FantasySport, TeamId } from "./FantasyTeam.ts";
import {
  CounterpartyRef,
  Cursor,
  LeagueFormat,
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
  StatPeriod,
  StatPeriodPreset,
  StatRef,
  TeamListRow,
} from "./QueryValues.ts";

export const ListTeamsInput = Schema.Struct({
  sport: Schema.optional(FantasySport),
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

export const StandingDetail = Schema.Literals(["compact", "detailed"]);
export type StandingDetail = typeof StandingDetail.Type;

export const LeagueGroup = Schema.Literals([
  "overview",
  "scoring",
  "roster_rules",
  "standings",
  "draft_history",
]);
export type LeagueGroup = typeof LeagueGroup.Type;

export const GetLeagueInput = Schema.Struct({
  team: TeamId,
  groups: Schema.optional(Schema.Array(LeagueGroup)),
  standingsDetail: Schema.optional(
    StandingDetail.pipe(
      Schema.annotate({
        description:
          "Form of the `standings` group. `compact`, the default, returns every team's rank, points, and record without per-category arrays, so a 13-team league fits in one result. `detailed` adds per-category season totals and rotisserie points and therefore pages teams; request it with the `standings` group alone for the most rows per page.",
      }),
    ),
  ),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetLeagueInput = typeof GetLeagueInput.Type;

const LeagueOverview = Schema.Struct({
  name: Schema.NonEmptyString,
  teamCount: Schema.Int.check(Schema.isGreaterThan(0)),
  scoringType: Schema.NonEmptyString,
  scoringLabel: Schema.optional(Schema.String),
  currentWeek: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  startWeek: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  endWeek: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
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

export const CategoryValue = Schema.Union([
  Schema.Struct({
    stat: StatRef,
    name: Schema.NonEmptyString.pipe(
      Schema.annotate({
        description:
          "The league scoring category's name, inlined so the number needs no dictionary read.",
      }),
    ),
    status: Schema.Literal("published"),
    value: Schema.Finite,
  }),
  Schema.Struct({
    stat: StatRef,
    name: Schema.NonEmptyString,
    status: Schema.Literal("not_published"),
    detail: Schema.String,
  }),
]);
export type CategoryValue = typeof CategoryValue.Type;

const OmittedCategories = Schema.Struct({
  count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  detail: Schema.String,
});

const StandingsCoverage = Schema.Union([
  Schema.Struct({ status: Schema.Literal("available") }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

export const StandingRow = Schema.Struct({
  team: CounterpartyRef,
  name: Schema.NonEmptyString,
  current: Schema.Boolean,
  rank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  playoffSeed: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))),
  record: Schema.optional(
    Schema.Struct({
      wins: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      losses: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      ties: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      percentage: Schema.NullOr(Schema.Finite),
    }),
  ),
  gamesBack: Schema.NullOr(Schema.Finite),
  pointsBack: Schema.NullOr(Schema.Finite),
  points: Schema.NullOr(Schema.Finite),
  pointsFor: Schema.NullOr(Schema.Finite),
  pointsAgainst: Schema.NullOr(Schema.Finite),
  streak: Schema.optional(
    Schema.Struct({
      type: Schema.NonEmptyString,
      value: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  categories: Schema.optional(Schema.Array(CategoryValue)).pipe(
    Schema.annotate({
      description:
        "Per-category season totals. Present only with `standingsDetail: detailed`; the compact form omits them so a whole league fits in one result.",
    }),
  ),
  categoryPoints: Schema.optional(Schema.Array(CategoryValue)).pipe(
    Schema.annotate({
      description: "Per-category rotisserie points. Present only with `standingsDetail: detailed`.",
    }),
  ),
});
export type StandingRow = typeof StandingRow.Type;

const StandingsData = Schema.Struct({
  status: Schema.Literal("available"),
  format: LeagueFormat,
  presentation: StandingDetail,
  detailNote: Schema.NonEmptyString,
  categoryTotals: Schema.optional(StandingsCoverage),
  categoryPoints: Schema.optional(StandingsCoverage),
  omittedCategories: Schema.optional(OmittedCategories),
  teams: Schema.Array(StandingRow),
});

const DraftPick = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  pick: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  team: CounterpartyRef,
  teamName: Schema.optional(Schema.NonEmptyString),
  player: PlayerRef,
});
export type DraftPick = typeof DraftPick.Type;

const DraftHistory = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    draftStatus: Schema.optional(Schema.NonEmptyString),
    detailNote: Schema.NonEmptyString,
    picks: Schema.Array(DraftPick),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.String,
  }),
]);

export const LeagueData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  overview: Schema.optional(LeagueOverview),
  rosterRules: Schema.optional(RosterRules),
  scoring: Schema.optional(Schema.Array(ScoringCategory)).pipe(
    Schema.annotate({
      description:
        "League scoring categories in order. Present when the `scoring` group is requested and whenever standings rows carry stat references, which the compact standings form does not.",
    }),
  ),
  standings: Schema.optional(
    Schema.Union([
      StandingsData,
      Schema.Struct({
        status: Schema.Literal("unsupported"),
        detail: Schema.String,
      }),
    ]),
  ),
  draftHistory: Schema.optional(DraftHistory).pipe(
    Schema.annotate({
      description:
        "Completed draft picks for this league's draft, one row per pick. Present when the `draft_history` group is requested. This is history, not current or future pick ownership: the provider publishes no pick-ownership read, and a traded pick appears on the trade transaction that moved it.",
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
  proTeam: Schema.NullOr(Schema.NonEmptyString),
  eligiblePositions: Schema.Array(Schema.NonEmptyString),
  editable: Schema.NullOr(Schema.Boolean),
  injury: Schema.Struct({
    reported: Schema.Boolean,
    code: Schema.optional(Schema.String),
    detail: Schema.optional(Schema.String),
  }),
  byeWeek: Schema.optional(Schema.NullOr(Schema.Int)),
  undroppable: Schema.optional(Schema.NullOr(Schema.Boolean)),
});
export type RosterPlayer = typeof RosterPlayer.Type;

const PlayerSchedule = Schema.Struct({
  status: Schema.Literal("unsupported"),
  detail: Schema.String,
});

export const RosterData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  period: Schema.optional(QueryPeriod),
  coverage: Schema.Array(QueryCoverage),
  playerSchedule: PlayerSchedule,
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

const PlayerSort = Schema.Literals([
  "name",
  "position",
  "ownership",
  "actual_rank",
  "overall_rank",
  "stat",
]);

export const SearchPlayersInput = Schema.Struct({
  team: TeamId,
  query: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMaxLength(80)),
      Schema.annotate({
        description:
          "Case-insensitive name filter of 1 to 80 characters. Omit it to list the available player pool; a blank value is rejected with the remedy rather than treated as no filter.",
      }),
    ),
  ),
  positions: Schema.optional(
    Schema.Array(
      Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(8))),
    ).pipe(Schema.check(Schema.isMaxLength(8))),
  ),
  availability: Schema.optional(SearchAvailability),
  sort: Schema.optional(
    PlayerSort.pipe(
      Schema.annotate({
        description:
          "Provider-backed order, offered only when the linked provider declares it. `actual_rank` and `overall_rank` are the provider's actual and overall ranks; `stat` orders by the league scoring category in `stat`. `ownership` orders by percent owned descending. The provider's declared limitations explain any sort it refuses, such as a point-total sort for a sport that does not offer it.",
      }),
    ),
  ),
  stat: Schema.optional(
    StatRef.pipe(
      Schema.annotate({
        description:
          "League scoring category from `get_league` scoring. Required only when sort is `stat`.",
      }),
    ),
  ),
  statPeriod: Schema.optional(
    Schema.Literals(["season", "week"]).pipe(
      Schema.annotate({
        description:
          "Period for a `stat` sort. Only `season` is offered: the provider publishes no weekly rank or stat value in its search payload, so a weekly order cannot be shown in the rows. A `week` value answers with the remedy.",
      }),
    ),
  ),
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
  percentOwned: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Provider-published percent owned. Null means the provider published no value for this row.",
    }),
  ),
  percentOwnedDelta: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Change in percent owned over the provider's current reporting window, which for this provider is its ownership week rather than the fantasy day. This is the only ownership-change field; null means the provider published no change for this row.",
    }),
  ),
  percentStarted: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Provider-published percent started. Null means the provider published no value for this row.",
    }),
  ),
  percentStartedChange: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Change in percent started over the provider's current started-percentage window (a scoring week in football, the provider's fantasy day in hockey). Null means the provider published no change for this row.",
    }),
  ),
  actualRank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).pipe(
    Schema.annotate({
      description:
        "The provider's current-season rank for this player, the value that orders sort `actual_rank`.",
    }),
  ),
  overallRank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).pipe(
    Schema.annotate({
      description:
        "The provider's overall rank for this player, the value that orders sort `overall_rank`.",
    }),
  ),
  statValue: Schema.optional(Schema.NullOr(Schema.Finite)).pipe(
    Schema.annotate({
      description:
        "The provider's season value for the requested `stat` category. Present only with sort `stat`; null means the provider published no value for this player.",
    }),
  ),
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
  period: Schema.optional(
    StatPeriod.pipe(
      Schema.annotate({
        description:
          'Period the `actual_stats` group covers. Accepted shapes: `{kind: "season"}` (the default when omitted), `{kind: "week", week}` or its short form `{week}`, `{kind: "preset", preset}` with `last_7_days`, `last_14_days`, or `last_30_days`, and `{kind: "range", start, end}` with inclusive `YYYY-MM-DD` dates. Each provider declares which kinds it serves natively, by aggregating daily reads, or not at all, and the result repeats that declaration in `periodSupport`; an unsupported kind is refused naming the kind and the alternative instead of substituting season totals.',
      }),
    ),
  ),
  groups: Schema.optional(
    Schema.Array(PlayerGroup).pipe(
      Schema.annotate({
        description:
          "Groups to hydrate. `actual_stats` states the basis the provider declares: a completed week, season totals, or a daily-summed window with its covered dates. `projections` is available only where the provider publishes them; otherwise the group returns an unsupported status naming that limitation.",
      }),
    ),
  ),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetPlayersInput = typeof GetPlayersInput.Type;

const StatValue = Schema.Struct({
  stat: StatRef,
  value: Schema.NullOr(Schema.Finite),
});

const StatPeriodRange = Schema.Struct({
  start: Schema.NonEmptyString,
  end: Schema.NonEmptyString,
  days: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

const StatPeriodAggregation = Schema.Struct({
  method: Schema.Literal("daily_sum"),
  detail: Schema.NonEmptyString,
});

const StatGroup = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    basis: Schema.Literals(["week", "season", "date_range"]),
    period: Schema.optional(QueryPeriod),
    range: Schema.optional(StatPeriodRange),
    aggregation: Schema.optional(StatPeriodAggregation),
    stats: Schema.Array(StatValue),
    notAggregated: Schema.Array(
      Schema.Struct({ stat: StatRef, detail: Schema.NonEmptyString }),
    ).pipe(
      Schema.annotate({
        description:
          "Categories the provider publishes but that cannot be summed across days, such as averages and percentages. Empty for a provider-native week or season basis.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.String,
  }),
]);

const StatPeriodSupport = Schema.Struct({
  sport: FantasySport,
  kinds: Schema.Struct({
    season: Schema.Literals(["native", "aggregated", "unsupported"]),
    week: Schema.Literals(["native", "aggregated", "unsupported"]),
    preset: Schema.Literals(["native", "aggregated", "unsupported"]),
    range: Schema.Literals(["native", "aggregated", "unsupported"]),
  }).pipe(
    Schema.annotate({
      description:
        "How this provider serves each period kind for this sport: `native` is one provider series, `aggregated` is a sum of provider reads, and `unsupported` is refused with a remedy.",
    }),
  ),
  presets: Schema.Array(
    Schema.Struct({
      preset: StatPeriodPreset,
      days: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
  ),
  maximumRangeDays: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  detail: Schema.NonEmptyString,
});

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
  primaryPosition: Schema.optional(Schema.NonEmptyString),
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
  period: Schema.optional(StatPeriod),
  periodSupport: StatPeriodSupport,
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

const RemainingGames = Schema.Struct({
  week: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  completed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  live: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  remaining: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const MatchupTeam = Schema.Struct({
  team: CounterpartyRef,
  name: Schema.NonEmptyString,
  points: Schema.NullOr(Schema.Finite),
  projectedPoints: Schema.NullOr(Schema.Finite),
  winProbability: Schema.NullOr(Schema.Finite),
  remainingGames: Schema.optional(RemainingGames),
  categories: Schema.optional(Schema.Array(CategoryValue)),
});

const MatchupCategoryWinner = Schema.Struct({
  stat: StatRef,
  winner: Schema.optional(CounterpartyRef),
  tied: Schema.Boolean,
});

const Matchup = Schema.Struct({
  period: QueryPeriod,
  home: MatchupTeam,
  away: MatchupTeam,
  status: Schema.optional(Schema.String),
  isPlayoffs: Schema.optional(Schema.Boolean),
  isConsolation: Schema.optional(Schema.Boolean),
  isTied: Schema.optional(Schema.Boolean),
  weekStart: Schema.optional(Schema.NonEmptyString),
  weekEnd: Schema.optional(Schema.NonEmptyString),
  categoryWinners: Schema.optional(Schema.Array(MatchupCategoryWinner)),
});

const MatchupSchedule = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    unit: Schema.Literal("fantasy_team_player_games"),
    detail: Schema.String,
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

export const MatchupsData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  period: QueryPeriod,
  matchups: Schema.Array(Matchup),
  schedule: MatchupSchedule,
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
  scope: Schema.optional(
    Schema.Literals(["league", "team"]).pipe(
      Schema.annotate({
        description:
          "`league` returns the league's recent transactions; `team` restricts the provider read to the linked team's own moves. Both use the provider's bounded transaction window.",
      }),
    ),
  ),
  since: Schema.optional(
    Schema.DateTimeUtc.pipe(
      Schema.annotate({
        description:
          "Only transactions at or after this instant. The provider has no date filter, so the range is applied to the bounded window the provider returns; `window` states whether the window was exhausted.",
      }),
    ),
  ),
  until: Schema.optional(
    Schema.DateTimeUtc.pipe(
      Schema.annotate({
        description: "Only transactions at or before this instant.",
      }),
    ),
  ),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetTransactionsInput = typeof GetTransactionsInput.Type;

export const TransactionWindow = Schema.Struct({
  fetched: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  truncated: Schema.Boolean,
  earliest: Schema.optional(Schema.String),
  latest: Schema.optional(Schema.String),
});
export type TransactionWindow = typeof TransactionWindow.Type;

const TransactionTeam = Schema.Struct({
  team: CounterpartyRef,
  name: Schema.optional(Schema.NonEmptyString),
});

const TransactionMovement = Schema.Struct({
  kind: Schema.Literals(["add", "drop", "trade", "other"]),
  from: Schema.NullOr(TransactionTeam).pipe(
    Schema.annotate({
      description: "The team the player left, or null when the move has no leaving team.",
    }),
  ),
  to: Schema.NullOr(TransactionTeam).pipe(
    Schema.annotate({
      description: "The team the player joined, or null when the move has no joining team.",
    }),
  ),
});

const TransactionParty = Schema.Struct({
  role: Schema.Literals(["proposer", "receiver", "participant"]),
  team: CounterpartyRef,
  name: Schema.optional(Schema.NonEmptyString),
});

const TransactionParties = Schema.Struct({
  source: Schema.Literals(["provider", "player_movements"]),
  entries: Schema.Array(TransactionParty),
});

const TransactionPick = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
    Schema.annotate({
      description:
        "Round of the traded draft pick. The provider publishes no draft year or overall pick number for a traded pick.",
    }),
  ),
  from: Schema.NullOr(TransactionTeam).pipe(
    Schema.annotate({ description: "The team that sent the pick." }),
  ),
  to: Schema.NullOr(TransactionTeam).pipe(
    Schema.annotate({ description: "The team that received the pick." }),
  ),
  original: Schema.NullOr(TransactionTeam).pipe(
    Schema.annotate({
      description: "The team that originally owned the pick, before any earlier trade.",
    }),
  ),
});

const TransactionCompleteness = Schema.Union([
  Schema.Struct({ status: Schema.Literal("complete") }),
  Schema.Struct({
    status: Schema.Literal("incomplete"),
    code: Schema.NonEmptyString,
    detail: Schema.NonEmptyString,
  }),
]);

const Transaction = Schema.Struct({
  occurredAt: Schema.String,
  type: Schema.Literals(["add", "drop", "add_drop", "trade", "commissioner", "other"]),
  status: Schema.optional(Schema.String),
  completeness: TransactionCompleteness,
  parties: Schema.optional(TransactionParties),
  teams: Schema.Array(TransactionTeam),
  picks: Schema.Array(TransactionPick),
  players: Schema.Array(
    Schema.Struct({
      player: PlayerRef,
      movement: TransactionMovement,
      name: Schema.optional(Schema.NonEmptyString),
      primaryPosition: Schema.optional(Schema.NonEmptyString),
      displayPosition: Schema.optional(Schema.NonEmptyString),
      eligiblePositions: Schema.optional(Schema.Array(Schema.NonEmptyString)),
      proTeam: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
    }),
  ),
});

export const TransactionsData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  transactions: Schema.Array(Transaction),
  window: TransactionWindow,
  coverage: Schema.Array(QueryCoverage),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type TransactionsData = typeof TransactionsData.Type;
export const TransactionsResult = Schema.Union([TransactionsData, NarrowingResult]);
export type TransactionsResult = typeof TransactionsResult.Type;

export const SummaryGroup = Schema.Literals([
  "league",
  "standings",
  "categories",
  "matchup",
  "roster",
]);
export type SummaryGroup = typeof SummaryGroup.Type;

export const GetTeamSummaryInput = Schema.Struct({
  team: TeamId,
  groups: Schema.optional(
    Schema.Array(SummaryGroup).pipe(
      Schema.check(Schema.isMaxLength(5)),
      Schema.annotate({
        description:
          "Sections to include. Defaults to `league`, `standings`, `matchup`, and `roster`. `categories` adds the season category totals and points plus the matchup's per-category values. The roster section pages with the returned cursor.",
      }),
    ),
  ),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetTeamSummaryInput = typeof GetTeamSummaryInput.Type;

const SummaryLeague = Schema.Union([
  Schema.Struct({ status: Schema.Literal("available"), ...LeagueOverview.fields }),
  Schema.Struct({ status: Schema.Literal("degraded"), detail: Schema.String }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryStanding = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    rank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
    playoffSeed: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))),
    points: Schema.NullOr(Schema.Finite),
    gamesBack: Schema.NullOr(Schema.Finite),
    pointsBack: Schema.NullOr(Schema.Finite),
    pointsFor: Schema.NullOr(Schema.Finite),
    pointsAgainst: Schema.NullOr(Schema.Finite),
    streak: Schema.optional(
      Schema.Struct({
        type: Schema.NonEmptyString,
        value: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      }),
    ),
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryRecord = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    wins: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    losses: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    ties: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    percentage: Schema.NullOr(Schema.Finite),
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryCategories = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    values: Schema.Array(CategoryValue),
    omittedCategories: OmittedCategories,
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryStandingRow = Schema.Struct({
  team: CounterpartyRef,
  name: Schema.NonEmptyString,
  current: Schema.Boolean,
  rank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  wins: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  losses: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  ties: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  percentage: Schema.optional(Schema.NullOr(Schema.Finite)),
  points: Schema.NullOr(Schema.Finite),
  gamesBack: Schema.NullOr(Schema.Finite),
  pointsBack: Schema.NullOr(Schema.Finite),
});

const SummaryStandings = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    format: LeagueFormat,
    teams: Schema.Array(SummaryStandingRow),
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryMatchup = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    period: QueryPeriod,
    opponent: Schema.Struct({
      team: CounterpartyRef,
      name: Schema.NonEmptyString,
    }),
    points: Schema.NullOr(Schema.Finite),
    opponentPoints: Schema.NullOr(Schema.Finite),
    projectedPoints: Schema.NullOr(Schema.Finite),
    opponentProjectedPoints: Schema.NullOr(Schema.Finite),
    remainingGames: Schema.optional(RemainingGames),
    opponentRemainingGames: Schema.optional(RemainingGames),
    categories: Schema.optional(Schema.Array(CategoryValue)),
    opponentCategories: Schema.optional(Schema.Array(CategoryValue)),
    statusLabel: Schema.optional(Schema.String),
    isPlayoffs: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

export const SummaryScheduleWeek = Schema.Struct({
  period: QueryPeriod,
  current: Schema.Boolean,
  completed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  live: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  remaining: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const SummarySchedule = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    unit: Schema.Literal("fantasy_team_player_games"),
    weeks: Schema.Array(SummaryScheduleWeek),
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryRosterPlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  slot: Schema.NonEmptyString,
  primaryPosition: Schema.NonEmptyString,
  proTeam: Schema.NullOr(Schema.NonEmptyString),
  injury: Schema.Struct({
    reported: Schema.Boolean,
    code: Schema.optional(Schema.String),
  }),
});

export const TeamSummaryData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  period: Schema.optional(QueryPeriod),
  league: Schema.optional(SummaryLeague),
  standing: Schema.optional(SummaryStanding),
  record: Schema.optional(SummaryRecord),
  categoryTotals: Schema.optional(SummaryCategories),
  categoryPoints: Schema.optional(SummaryCategories),
  standings: Schema.optional(SummaryStandings),
  matchup: Schema.optional(SummaryMatchup),
  schedule: Schema.optional(SummarySchedule),
  probableStarters: Schema.optional(
    Schema.Struct({
      status: Schema.Literal("unsupported"),
      detail: Schema.String,
    }),
  ),
  roster: Schema.Array(SummaryRosterPlayer),
  coverage: Schema.Array(QueryCoverage),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type TeamSummaryData = typeof TeamSummaryData.Type;
export const TeamSummaryResult = Schema.Union([TeamSummaryData, NarrowingResult]);
export type TeamSummaryResult = typeof TeamSummaryResult.Type;
