import { Schema } from "effect";

import { TeamAgentNote } from "./AgentNote.ts";
import { ConnectionId } from "./Connection.ts";
import { FantasySport, TeamId } from "./FantasyTeam.ts";
import { leagueOffNightDefinition } from "./ProfessionalGame.ts";
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
  RecentFormWindow,
  RosterSlot,
  StartingStatus,
  StatRef,
  StatWindow,
  TeamListRow,
  TeamOwnerNote,
} from "./QueryValues.ts";

const ScheduleWindowDate = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
);

const ScheduleWindowInput = Schema.Struct({
  start: ScheduleWindowDate,
  end: ScheduleWindowDate,
});

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

const LeagueWeek = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    current: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    end: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    reason: Schema.Literal("not_published"),
  }),
]).pipe(
  Schema.annotate({
    description:
      "The league's current scoring week and the season's week range; `not_published` means the league declares no week, not week zero.",
  }),
);
type LeagueWeek = typeof LeagueWeek.Type;

const CalendarGame = Schema.Struct({
  date: Schema.optional(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description: "Absent for a scoring-week league.",
    }),
  ),
  opponent: Schema.NonEmptyString,
  home: Schema.Boolean,
});
type CalendarGame = typeof CalendarGame.Type;

export const CalendarTeamGames = Schema.Struct({
  proTeam: Schema.NonEmptyString,
  plays: Schema.Boolean.pipe(
    Schema.annotate({
      description: "Whether this professional team plays in the period; false is a bye.",
    }),
  ),
  games: Schema.Array(CalendarGame),
});
export type CalendarTeamGames = typeof CalendarTeamGames.Type;

const CalendarGames = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    period: QueryPeriod,
    observedAt: Schema.DateTimeUtc,
    teams: Schema.Array(CalendarTeamGames),
    notCovered: Schema.optional(Schema.Array(Schema.NonEmptyString)).pipe(
      Schema.annotate({
        description:
          "Requested professional teams no rostered player reaches; absent when all are covered.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    reason: Schema.Literals(["not_published", "unavailable"]),
  }),
]).pipe(
  Schema.annotate({
    description:
      "Each professional team's games in the period; `not_published` means no dates, `unavailable` that the read failed.",
  }),
);

export const GetCalendarInput = Schema.Struct({
  team: TeamId,
  period: Schema.optional(
    QueryPeriod.pipe(
      Schema.annotate({
        description:
          "The league week whose professional-team games to read into `games`. Omit it to read only the week range and periods.",
      }),
    ),
  ),
  proTeams: Schema.optional(
    Schema.Array(
      Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(8))),
    ).pipe(
      Schema.check(Schema.isMaxLength(32)),
      Schema.annotate({
        description:
          "Professional-team abbreviations to keep in `games`. Omit it for every team the linked roster reaches.",
      }),
    ),
  ),
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
  week: Schema.optional(LeagueWeek).pipe(
    Schema.annotate({
      description: "The league's current scoring week, without a matchup read.",
    }),
  ),
  periods: Schema.Array(CalendarPeriod),
  dates: Schema.optional(
    Schema.Struct({
      start: Schema.optional(Schema.String),
      end: Schema.optional(Schema.String),
    }),
  ),
  games: Schema.optional(CalendarGames),
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
  groups: Schema.optional(
    Schema.Array(LeagueGroup).pipe(
      Schema.annotate({
        description:
          "Sections to include. Defaults to `overview`, `scoring`, and `roster_rules`; the response pages scoring categories unless `standings` or `draft_history` is requested.",
      }),
    ),
  ),
  standingsDetail: Schema.optional(
    StandingDetail.pipe(
      Schema.annotate({
        description:
          "`compact` (default) returns every team's rank, points, and record. `detailed` adds category totals and rotisserie points and pages teams.",
      }),
    ),
  ),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetLeagueInput = typeof GetLeagueInput.Type;

const declaredStateDetail =
  "`published` carries the league's value; `not_set` means the league declares none, not zero.";

const DeclaredNumber = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("published"),
    value: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({ status: Schema.Literal("not_set") }),
]).pipe(Schema.annotate({ description: declaredStateDetail }));

const DeclaredText = Schema.Union([
  Schema.Struct({ status: Schema.Literal("published"), value: Schema.NonEmptyString }),
  Schema.Struct({ status: Schema.Literal("not_set") }),
]).pipe(Schema.annotate({ description: declaredStateDetail }));

const DeclaredRawText = Schema.Union([
  Schema.Struct({ status: Schema.Literal("published"), value: Schema.String }),
  Schema.Struct({ status: Schema.Literal("not_set") }),
]).pipe(
  Schema.annotate({
    description:
      "`published` repeats the league's value, even an empty string. `not_set` means the league published no such field.",
  }),
);

const DeclaredFlag = Schema.Union([
  Schema.Struct({ status: Schema.Literal("published"), value: Schema.Boolean }),
  Schema.Struct({ status: Schema.Literal("not_set") }),
]).pipe(Schema.annotate({ description: declaredStateDetail }));

const TradeRatification = Schema.Literals(["vote", "commissioner", "none", "unknown"]).pipe(
  Schema.annotate({
    description:
      "How a trade is ratified: `vote`, `commissioner`, `none`, or `unknown` when no rule is named.",
  }),
);

const DeclaredTradeRatification = Schema.Union([
  Schema.Struct({ status: Schema.Literal("published"), value: TradeRatification }),
  Schema.Struct({ status: Schema.Literal("not_set") }),
]).pipe(Schema.annotate({ description: declaredStateDetail }));

export const AcquisitionLimits = Schema.Struct({
  weekly: DeclaredNumber,
  season: DeclaredNumber,
});

const AddCoverage = Schema.Union([
  Schema.Struct({ week: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) }),
  Schema.Struct({ date: Schema.NonEmptyString }),
]).pipe(
  Schema.annotate({
    description: "The period the site counts adds over: a scoring week or a date.",
  }),
);

export const AcquisitionUsage = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("published"),
    seasonMovesUsed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
      Schema.annotate({
        description: "Season moves the site reports this team used. A published zero means none.",
      }),
    ),
    weeklyAddsUsed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
      Schema.annotate({
        description:
          "Adds the site reports this team used in `coverage`. A published zero means none.",
      }),
    ),
    coverage: AddCoverage,
    seasonMovesRemaining: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
      Schema.annotate({
        description:
          "Season moves the team may still use. Absent when the league declares no such limit.",
      }),
    ),
    weeklyAddsRemaining: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
      Schema.annotate({
        description:
          "Adds the team may still use in `coverage`. Absent when the league declares no such limit.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("not_published"),
    detail: Schema.NonEmptyString.pipe(
      Schema.annotate({
        description:
          "Why usage is unknown: no counter was published, which differs from zero used.",
      }),
    ),
  }),
]);

const GamesPlayedUsage = Schema.Struct({
  status: Schema.Literal("not_published"),
  detail: Schema.NonEmptyString,
}).pipe(
  Schema.annotate({
    description: "Per-team games played is not published; `detail` says why.",
  }),
);
export type AcquisitionUsage = typeof AcquisitionUsage.Type;
export type AcquisitionLimits = typeof AcquisitionLimits.Type;

const RosterChangeRule = Schema.Literals(["same_day", "next_day", "weekly_lock"]).pipe(
  Schema.annotate({
    description:
      "What a roster move does under the published deadline: `same_day`, `next_day`, or `weekly_lock`.",
  }),
);

const RosterChange = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("published"),
    value: RosterChangeRule,
    source: Schema.Array(Schema.NonEmptyString).pipe(
      Schema.annotate({
        description:
          "The published settings fields the rule is decoded from, in the site's own field names.",
      }),
    ),
    detail: Schema.NonEmptyString.pipe(
      Schema.annotate({
        description: "The raw published values the rule was decoded from.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("not_published"),
    detail: Schema.NonEmptyString.pipe(
      Schema.annotate({
        description: "Why no rule was established.",
      }),
    ),
  }),
]);

const TransactionRules = Schema.Struct({
  waiver: Schema.Struct({
    type: DeclaredText.pipe(
      Schema.annotate({
        description: "The league's waiver system.",
      }),
    ),
    rule: DeclaredText.pipe(
      Schema.annotate({
        description: "The waiver-priority rule, such as continuous or a weekly reset.",
      }),
    ),
    usesFaab: DeclaredFlag,
  }),
  timing: Schema.Struct({
    weeklyDeadline: DeclaredRawText.pipe(
      Schema.annotate({
        description:
          "The declared weekly deadline as the site states it, including an empty string when it publishes none.",
      }),
    ),
    rosterChange: RosterChange.pipe(
      Schema.annotate({
        description:
          "The roster rule decoded from the published settings; `not_published` when none is established.",
      }),
    ),
    waiverDays: DeclaredNumber.pipe(
      Schema.annotate({
        description: "Days a dropped player stays on waivers before the free-agent pool.",
      }),
    ),
  }),
  acquisitionLimits: AcquisitionLimits.pipe(
    Schema.annotate({
      description:
        "The league's acquisition limits; each team's used and remaining counts are on its standings row.",
    }),
  ),
  trades: Schema.Struct({
    endDate: DeclaredText,
    ratification: DeclaredTradeRatification,
    objectionDays: DeclaredNumber,
    draftPicks: Schema.Union([
      Schema.Struct({ status: Schema.Literal("published"), value: Schema.Boolean }),
      Schema.Struct({ status: Schema.Literal("not_set") }),
    ]).pipe(
      Schema.annotate({
        description: "Whether the league allows traded draft picks.",
      }),
    ),
  }),
  gamesCaps: Schema.Struct({
    gamesPlayed: DeclaredNumber,
    inningsPitched: DeclaredNumber.pipe(
      Schema.annotate({
        description: "Innings-pitched cap for the season; baseball only.",
      }),
    ),
  }).pipe(
    Schema.annotate({
      description: "League caps only; per-team games played is not published.",
    }),
  ),
  detailNote: Schema.String,
});

const LeagueOverview = Schema.Struct({
  name: Schema.NonEmptyString,
  teamCount: Schema.Int.check(Schema.isGreaterThan(0)),
  scoringType: Schema.NonEmptyString,
  scoringLabel: Schema.optional(Schema.String),
  startDate: Schema.optional(Schema.String),
  endDate: Schema.optional(Schema.String),
});

const LeagueSettingsOverview = Schema.Struct({
  ...LeagueOverview.fields,
  transactionRules: TransactionRules,
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

const CategoryRole = Schema.Literals(["scoring", "informational"]).pipe(
  Schema.annotate({
    description: "`scoring` counts; `informational` is published but does not count.",
  }),
);
export type CategoryRole = typeof CategoryRole.Type;

const ScoringCategory = Schema.Struct({
  stat: StatRef,
  name: Schema.NonEmptyString,
  abbreviation: Schema.NonEmptyString,
  group: Schema.NonEmptyString,
  scoring: CategoryRole,
  detail: Schema.optional(Schema.String).pipe(
    Schema.annotate({
      description: "Why the stat is informational. Present only when `scoring` is `informational`.",
    }),
  ),
  positionTypes: Schema.Array(Schema.NonEmptyString),
  points: Schema.NullOr(Schema.String).pipe(
    Schema.annotate({
      description: "Per-stat points for a points league; null for category and rotisserie leagues.",
    }),
  ),
});

const CategoryValueScoring = Schema.optional(Schema.Literal("informational")).pipe(
  Schema.annotate({
    description: "`informational` numbers are published but not scored.",
  }),
);

export const CategoryValue = Schema.Struct({
  stat: StatRef,
  name: Schema.NonEmptyString,
  scoring: CategoryValueScoring,
  value: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description: "The published number; null is never zero.",
    }),
  ),
  detail: Schema.optional(Schema.String).pipe(
    Schema.annotate({
      description: "Why `value` is null.",
    }),
  ),
});
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
    }).pipe(
      Schema.annotate({
        description: "Absent when the format publishes no win-loss record.",
      }),
    ),
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
  acquisitionUsage: AcquisitionUsage.pipe(
    Schema.annotate({
      description:
        "This team's acquisition usage, for rivals too; `not_published` means no counter, not zero used.",
    }),
  ),
  categories: Schema.optional(Schema.Array(CategoryValue)).pipe(
    Schema.annotate({
      description: "Per-category season totals. Present only with `standingsDetail: detailed`.",
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
  acquisitionLimits: AcquisitionLimits.pipe(
    Schema.annotate({
      description:
        "The league's acquisition limits for the rows. `not_set` means the league declares none.",
    }),
  ),
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
  name: Schema.optional(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description: "The inline player name, beside the player reference; absent when unpublished.",
    }),
  ),
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

const PlayerSort = Schema.Literals([
  "name",
  "position",
  "ownership",
  "actual_rank",
  "overall_rank",
  "stat",
  "recent_rank",
]);

const PlayerSearchGames = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("date_window"),
    detail: Schema.NonEmptyString,
  }),
  Schema.Struct({
    status: Schema.Literal("scoring_week"),
    detail: Schema.NonEmptyString,
  }),
]).pipe(
  Schema.annotate({
    description:
      '`date_window` takes `{kind: "current"}` or `{start, end}` dates; `scoring_week` takes `{kind: "current"}` or `{kind: "next_weeks"}` and refuses a date window.',
  }),
);

const PlayerSearchSupport = Schema.Struct({
  status: Schema.Literals(["published", "unverified"]),
  sorts: Schema.Array(PlayerSort),
  windows: Schema.Array(RecentFormWindow),
  games: PlayerSearchGames,
  detail: Schema.NonEmptyString,
}).pipe(
  Schema.annotate({
    description:
      "The orderings and recent-form windows this league's player search accepts; `unverified` means no ranks were available to sample.",
  }),
);

export const LeagueData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  week: Schema.optional(LeagueWeek).pipe(
    Schema.annotate({
      description:
        "The league's current scoring week and range, independent of the `overview` group.",
    }),
  ),
  overview: Schema.optional(LeagueSettingsOverview),
  rosterRules: Schema.optional(RosterRules),
  scoring: Schema.optional(Schema.Array(ScoringCategory)).pipe(
    Schema.annotate({
      description:
        "This league's stat categories in order, each marked `scoring` or `informational`.",
    }),
  ),
  playerSearch: Schema.optional(PlayerSearchSupport).pipe(
    Schema.annotate({
      description: "Search orderings and windows this league publishes.",
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
      description: "Completed draft picks, one row per pick; history only, not pick ownership.",
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
  team: TeamId.pipe(
    Schema.annotate({
      description:
        "The linked team whose league scopes this read. With `scope: league` every team in that league is read.",
    }),
  ),
  scope: Schema.optional(
    Schema.Literals(["team", "league"]).pipe(
      Schema.annotate({
        description:
          "`team` pages one linked team's players; `league` pages every roster in that league, whole teams at a time. Default `team`.",
      }),
    ),
  ),
  period: Schema.optional(
    QueryPeriod.pipe(
      Schema.annotate({
        description: "The exact league week for a `team` read; a `league` read refuses it.",
      }),
    ),
  ),
  detail: Schema.optional(
    RosterDetail.pipe(
      Schema.annotate({
        description: "`full` adds `undroppable` and `ownerNote`.",
      }),
    ),
  ),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(
    PageLimit.pipe(
      Schema.annotate({
        description:
          "The most rows this page may carry: players for `scope: team`, whole teams for `scope: league`.",
      }),
    ),
  ),
});
export type GetRostersInput = typeof GetRostersInput.Type;

const PlayerTransactionTrend = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("published"),
    adds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    drops: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    window: Schema.Literal("provider_current_day").pipe(
      Schema.annotate({
        description: "The site's current day; it publishes no date with the count.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("not_published"),
    reason: Schema.NonEmptyString,
  }),
]).pipe(
  Schema.annotate({
    description:
      "Adds and drops for this player's current day across leagues; `not_published` is not zero.",
  }),
);

const PlayerWeek = Schema.Struct({
  period: QueryPeriod.pipe(
    Schema.annotate({
      description: "The scoring week these facts cover.",
    }),
  ),
  playsThisWeek: Schema.Boolean.pipe(
    Schema.annotate({
      description:
        "Whether the professional team plays in this scoring week. False is the bye week.",
    }),
  ),
  opponent: Schema.NullOr(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description: "The opponent's abbreviation; null when there is no opponent.",
    }),
  ),
  home: Schema.NullOr(Schema.Boolean),
  byeWeek: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(99)),
  ).pipe(
    Schema.annotate({
      description: "The week this team does not play; absent when unpublished.",
    }),
  ),
  projectedRank: Schema.optional(
    Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  ).pipe(
    Schema.annotate({
      description:
        "The league-scoped projected rank for the week; null when unpublished, absent when not requested.",
    }),
  ),
}).pipe(
  Schema.annotate({
    description: "Present only when the league's roster coverage is a scoring week.",
  }),
);
export type PlayerWeek = typeof PlayerWeek.Type;

export const PlayerDraft = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("drafted"),
    draftRound: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    overallPick: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    draftedBy: Schema.Struct({
      team: CounterpartyRef,
      name: Schema.optional(Schema.NonEmptyString),
    }),
    draftSeason: Schema.Int.check(Schema.isGreaterThan(1900)),
  }),
  Schema.Struct({ status: Schema.Literal("undrafted") }),
  Schema.Struct({ status: Schema.Literal("not_published") }),
]).pipe(
  Schema.annotate({
    description:
      "`undrafted`: the league drafted and passed; `not_published`: no draft history readable.",
  }),
);
export type PlayerDraft = typeof PlayerDraft.Type;

export const RosterPlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  slot: RosterSlot,
  primaryPosition: Schema.NonEmptyString,
  displayPosition: Schema.NonEmptyString,
  proTeam: Schema.NullOr(Schema.NonEmptyString),
  eligiblePositions: Schema.Array(Schema.NonEmptyString),
  editable: Schema.NullOr(Schema.Boolean).pipe(
    Schema.annotate({
      description: "Whether the site lets this player move today.",
    }),
  ),
  injury: Schema.Struct({
    reported: Schema.Boolean,
    code: Schema.optional(Schema.String),
    detail: Schema.optional(Schema.String),
  }),
  startingStatus: StartingStatus,
  week: Schema.optional(PlayerWeek),
  undroppable: Schema.optional(
    Schema.NullOr(Schema.Boolean).pipe(
      Schema.annotate({
        description: "Whether the site refuses to drop this player.",
      }),
    ),
  ),
  transactionTrend: PlayerTransactionTrend,
});
export type RosterPlayer = typeof RosterPlayer.Type;

export const RosterData = Schema.Struct({
  status: QueryStatus,
  scope: Schema.Literal("team"),
  team: QueryTeam,
  period: Schema.optional(QueryPeriod),
  coverage: Schema.Array(QueryCoverage),
  players: Schema.Array(RosterPlayer),
  ownerNote: Schema.optional(TeamOwnerNote).pipe(
    Schema.annotate({
      description:
        "The owner's note, present only when `detail` is `full`. Owner context, not a league fact.",
    }),
  ),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type RosterData = typeof RosterData.Type;

const LeagueRosterTeam = Schema.Struct({
  team: CounterpartyRef.pipe(
    Schema.annotate({
      description: "The team's private reference, sealed for this owner and league.",
    }),
  ),
  name: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description: "The team name for display; identity is the private reference, never the name.",
    }),
  ),
  owned: Schema.Boolean.pipe(
    Schema.annotate({
      description: "Whether this account linked the team; rival rosters are readable too.",
    }),
  ),
  players: Schema.Array(RosterPlayer).pipe(
    Schema.annotate({
      description: "The team's whole roster. A league page never splits a roster.",
    }),
  ),
});
export const LeagueRosterData = Schema.Struct({
  status: QueryStatus,
  scope: Schema.Literal("league"),
  team: QueryTeam,
  period: Schema.optional(QueryPeriod),
  coverage: Schema.Array(QueryCoverage),
  teams: Schema.Array(LeagueRosterTeam),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type LeagueRosterData = typeof LeagueRosterData.Type;

export const RosterResult = Schema.Union([RosterData, LeagueRosterData, NarrowingResult]);
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

const SearchAvailability = Schema.Literals(["all", "free_agent", "waiver"]).pipe(
  Schema.annotate({
    description:
      "`all` lists every player off a roster; `free_agent` lists free agents only; `waiver` lists waiver-listed players only.",
  }),
);

const GamesWindowInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("current") }),
  Schema.Struct({
    kind: Schema.Literal("next_weeks"),
    weeks: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 52 })),
  }),
  ScheduleWindowInput,
]).pipe(
  Schema.annotate({
    description:
      "`current` is the league's current window; `next_weeks` is this scoring week and the next N-1; `{start, end}` is inclusive dates. `get_league` publishes which kinds the league answers.",
  }),
);
export type GamesWindowInput = typeof GamesWindowInput.Type;

export const SearchPlayersInput = Schema.Struct({
  team: TeamId,
  query: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMaxLength(80)),
      Schema.annotate({
        description: "Case-insensitive name filter, 1 to 80 characters; omit it to list the pool.",
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
          "`actual_rank`, `overall_rank`, `stat`, `ownership` (highest first), `name`, `position`, or `recent_rank` over `window`.",
      }),
    ),
  ),
  stat: Schema.optional(
    StatRef.pipe(
      Schema.annotate({
        description:
          "The league scoring category from `get_league`. Required only for sort `stat`.",
      }),
    ),
  ),
  window: Schema.optional(
    StatWindow.pipe(
      Schema.annotate({
        description:
          "`stat` takes `season` or one `week`; `recent_rank` takes `last_days` or `last_weeks`; `get_league` publishes the league's windows.",
      }),
    ),
  ),
  gamesWindow: Schema.optional(GamesWindowInput),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type SearchPlayersInput = typeof SearchPlayersInput.Type;

const ScheduleGamesRemainingSource = Schema.Literals(["professional_games", "provider_opponent"]);

const ScheduleWindowSource = Schema.Literals(["period", "requested", "rest_of_week"]);

const ScheduleWindow = Schema.Struct({
  start: Schema.NonEmptyString,
  end: Schema.NonEmptyString,
  source: ScheduleWindowSource,
});

const SchedulePlayerGamesRemaining = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    source: ScheduleGamesRemainingSource,
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    detail: Schema.NonEmptyString,
  }),
]).pipe(
  Schema.annotate({
    description:
      "Games this player's team plays in the window the section states; `unavailable` says why.",
  }),
);

export const PlayerGameDays = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    dates: Schema.Array(Schema.NonEmptyString),
  }),
  Schema.Struct({ status: Schema.Literal("unavailable"), detail: Schema.NonEmptyString }),
]).pipe(
  Schema.annotate({
    description:
      "Dates this player's team plays in a requested window; `unavailable` is not no games.",
  }),
);
export type PlayerGameDays = typeof PlayerGameDays.Type;

export const PlayerGameWeeks = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    weeks: Schema.Array(
      Schema.Struct({
        week: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
        opponent: Schema.NonEmptyString,
        home: Schema.Boolean,
      }),
    ),
  }),
  Schema.Struct({ status: Schema.Literal("unavailable"), detail: Schema.NonEmptyString }),
]).pipe(
  Schema.annotate({
    description:
      "Scoring weeks this player's team plays in the window the section states, with the opponent and whether the game is home; a bye is absent from `weeks`.",
  }),
);
export type PlayerGameWeeks = typeof PlayerGameWeeks.Type;

const SearchPlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  draft: PlayerDraft,
  primaryPosition: Schema.NonEmptyString,
  displayPosition: Schema.NonEmptyString,
  proTeam: Schema.NullOr(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description: "The professional-team abbreviation; null when unpublished.",
    }),
  ),
  eligiblePositions: Schema.Array(Schema.NonEmptyString),
  availability: Schema.Literals(["free_agent", "waiver", "rostered", "unknown"]),
  status: Schema.Struct({
    value: Schema.Literals(["healthy", "day_to_day", "out", "injured_reserve", "unknown"]).pipe(
      Schema.annotate({
        description: "The availability the site reports; `unknown` is not healthy.",
      }),
    ),
    code: Schema.optional(Schema.String).pipe(
      Schema.annotate({
        description: "The site's status code verbatim, such as `IR-LT`; absent when healthy.",
      }),
    ),
    detail: Schema.optional(Schema.String).pipe(
      Schema.annotate({
        description: "The site's wording where it publishes one, including expected return.",
      }),
    ),
    observedAt: Schema.DateTimeUtc.pipe(
      Schema.annotate({
        description: "When this status was read from the site.",
      }),
    ),
  }),
  percentOwned: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description: "Percent owned; null when unpublished.",
    }),
  ),
  percentOwnedDelta: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Change over the site's ownership-change window (unstated). Null when unpublished.",
    }),
  ),
  percentStarted: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description: "Percent started; null when unpublished.",
    }),
  ),
  percentStartedChange: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Change over the site's started-percentage window (unstated). Null when unpublished.",
    }),
  ),
  actualRank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).pipe(
    Schema.annotate({
      description: "The site's current-season rank; it orders sort `actual_rank`.",
    }),
  ),
  overallRank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).pipe(
    Schema.annotate({
      description: "The site's overall rank; it orders sort `overall_rank`.",
    }),
  ),
  recentRank: Schema.optional(
    Schema.Struct({
      window: RecentFormWindow,
      rank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
    }).pipe(
      Schema.annotate({
        description: "The site's rank over the requested window; it orders `recent_rank`.",
      }),
    ),
  ),
  statValue: Schema.optional(Schema.NullOr(Schema.Finite)).pipe(
    Schema.annotate({
      description:
        "The site's season value for `stat`, present only with sort `stat`; null when unpublished.",
    }),
  ),
  gameDays: Schema.optional(PlayerGameDays),
  gameWeeks: Schema.optional(PlayerGameWeeks),
  week: Schema.optional(PlayerWeek),
  transactionTrend: PlayerTransactionTrend,
});

const SearchGamesWindow = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    basis: Schema.Literal("date"),
    window: ScheduleWindow,
    observedAt: Schema.DateTimeUtc,
  }),
  Schema.Struct({
    status: Schema.Literal("available"),
    basis: Schema.Literal("week"),
    weeks: Schema.Struct({
      first: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      last: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
    observedAt: Schema.DateTimeUtc,
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.NonEmptyString,
  }),
]).pipe(
  Schema.annotate({
    description:
      "The window and read time behind each row's `gameDays` (basis `date`) or `gameWeeks` (basis `week`).",
  }),
);

export const SearchPlayersData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  coverage: Schema.Array(QueryCoverage),
  players: Schema.Array(SearchPlayer),
  gamesWindow: Schema.optional(SearchGamesWindow),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type SearchPlayersData = typeof SearchPlayersData.Type;
export const SearchPlayersResult = Schema.Union([SearchPlayersData, NarrowingResult]);
export type SearchPlayersResult = typeof SearchPlayersResult.Type;

export const GetPlayersInput = Schema.Struct({
  team: TeamId.pipe(
    Schema.annotate({
      description:
        "The league that seals every reference; a player on another team in the same league resolves.",
    }),
  ),
  players: Schema.Array(PlayerRef).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(25)),
    Schema.annotate({
      description:
        "1 to 25 private player references from the league named by `team`. The whole list returns in one response.",
    }),
  ),
  period: Schema.optional(
    StatWindow.pipe(
      Schema.annotate({
        description:
          "Period for `actual_stats`: `season` (default), one `week`, `last_days`, `last_weeks`, or an inclusive `range`; `periodSupport` states what the site serves.",
      }),
    ),
  ),
  groups: Schema.optional(
    Schema.Array(PlayerGroup).pipe(
      Schema.annotate({
        description: "Groups of player facts to return.",
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
          "Averages and percentages that cannot be summed across days. Empty for a week or season basis.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.String,
  }),
]);

const ProjectionGroup = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    basis: Schema.Literal("week"),
    period: QueryPeriod,
    rank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).pipe(
      Schema.annotate({
        description:
          "The league-scoped projected rank for the week; null when the site published none for this player.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    reason: Schema.Literal("not_published"),
  }),
]).pipe(
  Schema.annotate({
    description: "The projected week rank.",
  }),
);

const StatPeriodSupport = Schema.Struct({
  sport: FantasySport,
  kinds: Schema.Struct({
    season: Schema.Literals(["native", "aggregated", "unsupported"]),
    week: Schema.Literals(["native", "aggregated", "unsupported"]),
    last_days: Schema.Literals(["native", "aggregated", "unsupported"]),
    last_weeks: Schema.Literals(["native", "aggregated", "unsupported"]),
    range: Schema.Literals(["native", "aggregated", "unsupported"]),
  }).pipe(
    Schema.annotate({
      description: "`native`, `aggregated` daily sums, or `unsupported`.",
    }),
  ),
  maximumWindowDays: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
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
}).pipe(
  Schema.annotate({
    description:
      "Absent when the site publishes no status; the reference is then named in `failures`.",
  }),
);

const PlayerIdentity = Schema.Struct({
  name: Schema.NonEmptyString,
  primaryPosition: Schema.optional(Schema.NonEmptyString),
  displayPosition: Schema.NonEmptyString,
  draft: PlayerDraft,
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
  projections: Schema.optional(ProjectionGroup),
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
  period: Schema.optional(StatWindow),
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
}).pipe(
  Schema.annotate({
    description: "Per-week game counts.",
  }),
);

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
  schedule: MatchupSchedule.pipe(
    Schema.annotate({
      description: "How remaining player-games are counted, or why they are unsupported.",
    }),
  ),
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
          "`league` returns recent league transactions; `team` restricts the read to the linked team's moves.",
      }),
    ),
  ),
  since: Schema.optional(
    Schema.DateTimeUtcFromString.pipe(
      Schema.annotate({
        description:
          "Only transactions at or after this ISO 8601 instant. The site has no date filter, so the read pages back until this bound or the event cap; `window` states which.",
      }),
    ),
  ),
  until: Schema.optional(
    Schema.DateTimeUtcFromString.pipe(
      Schema.annotate({
        description:
          "Only transactions at or before this ISO 8601 instant. Without `since`, the read pages back until this bound or the event cap.",
      }),
    ),
  ),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetTransactionsInput = typeof GetTransactionsInput.Type;

export const TransactionWindow = Schema.Struct({
  fetched: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({
      description:
        "Events read from the site. A date-bounded read may fetch several newest-first pages.",
    }),
  ),
  truncated: Schema.Boolean.pipe(
    Schema.annotate({
      description:
        "True only when the event cap stopped the read before `since`; a `since` before the oldest event reports `transaction_history_starts_after_range`.",
    }),
  ),
  earliest: Schema.optional(Schema.String),
  latest: Schema.optional(Schema.String),
});
export type TransactionWindow = typeof TransactionWindow.Type;

const TransactionTeam = Schema.Struct({
  team: CounterpartyRef,
  name: Schema.optional(Schema.NonEmptyString),
});

const TransactionMovement = Schema.Struct({
  kind: Schema.Literals(["add", "drop", "trade", "pending_trade", "other"]),
  from: Schema.NullOr(TransactionTeam),
  to: Schema.NullOr(TransactionTeam),
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
        "The traded pick's round. The site publishes no draft year or overall pick number.",
    }),
  ),
  from: Schema.NullOr(TransactionTeam),
  to: Schema.NullOr(TransactionTeam),
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
]).pipe(
  Schema.annotate({
    description:
      "`incomplete` means the movements could not be reconstructed; do not price this record.",
  }),
);

const Transaction = Schema.Struct({
  occurredAt: Schema.String,
  type: Schema.Literals([
    "add",
    "drop",
    "add_drop",
    "trade",
    "pending_trade",
    "commissioner",
    "other",
  ]),
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
  "schedule",
  "roster",
]);
export type SummaryGroup = typeof SummaryGroup.Type;

export const GetTeamSummaryInput = Schema.Struct({
  team: TeamId,
  groups: Schema.optional(
    Schema.Array(SummaryGroup).pipe(
      Schema.check(Schema.isMaxLength(6)),
      Schema.annotate({
        description:
          "`league`, `standings`, `matchup`, `roster` by default; `categories` adds season totals and matchup categories, `schedule` adds games.",
      }),
    ),
  ),
  window: Schema.optional(
    Schema.Struct({ start: ScheduleWindowDate, end: ScheduleWindowDate }).pipe(
      Schema.annotate({
        description:
          "Inclusive dates for `schedule`, instead of the scoring period; a league whose coverage is a scoring week refuses it.",
      }),
    ),
  ),
  days: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(366)).pipe(
      Schema.annotate({
        description:
          "Length of the `schedule` window from today, used only without `window`; a league with no professional games states its bound in `schedule.detail`.",
      }),
    ),
  ),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type GetTeamSummaryInput = typeof GetTeamSummaryInput.Type;

const SummaryTransactionTiming = Schema.Struct({
  weeklyDeadline: Schema.optional(Schema.String),
  rosterChange: Schema.optional(Schema.Literals(["same_day", "next_day", "weekly_lock"])),
  waiverDays: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}).annotate({ description: "The league's roster-change timing." });

const SummaryLeague = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    ...LeagueOverview.fields,
    transactionTiming: SummaryTransactionTiming,
  }),
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
  gamesBack: Schema.optional(Schema.Finite).pipe(
    Schema.annotate({
      description: "Games behind the leader. Absent when the format publishes none.",
    }),
  ),
  pointsBack: Schema.optional(Schema.Finite).pipe(
    Schema.annotate({
      description: "Points behind the leader. Absent when the format publishes none.",
    }),
  ),
});

const SummaryStandings = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    format: LeagueFormat,
    teams: Schema.Array(SummaryStandingRow),
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryAcquisitionUsage = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    limits: AcquisitionLimits,
    usage: AcquisitionUsage,
    gamesPlayedUsage: GamesPlayedUsage,
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]).pipe(
  Schema.annotate({
    description: "This team's acquisition usage and the league's limits.",
  }),
);

export const SummaryMatchupCategory = Schema.Struct({
  stat: StatRef,
  name: Schema.NonEmptyString,
  scoring: CategoryValueScoring,
  own: Schema.NullOr(Schema.Finite),
  opponent: Schema.NullOr(Schema.Finite),
  detail: Schema.optional(Schema.String).pipe(
    Schema.annotate({
      description: "Why a side is null. Present only when a side published no value.",
    }),
  ),
}).pipe(
  Schema.annotate({
    description: "One scoring category with both sides' values in one row.",
  }),
);
export type SummaryMatchupCategory = typeof SummaryMatchupCategory.Type;

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
    categories: Schema.optional(Schema.Array(SummaryMatchupCategory)),
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

const SummaryRemainingGames = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    unit: Schema.Literal("fantasy_team_player_games"),
    weeks: Schema.Array(SummaryScheduleWeek),
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryScheduledGame = Schema.Struct({
  date: Schema.optional(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description: "Absent for a scoring-week league.",
    }),
  ),
  opponent: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description: "The opponent's abbreviation.",
    }),
  ),
  home: Schema.Boolean,
  offNight: Schema.optional(Schema.Boolean).pipe(
    Schema.annotate({
      description:
        "Whether the date is a league off night; absent when the league's games are unknown, not false.",
    }),
  ),
});

export const SummarySchedulePlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  proTeam: Schema.NullOr(Schema.NonEmptyString),
  status: Schema.Literals(["scheduled", "no_games", "unknown"]).pipe(
    Schema.annotate({
      description:
        "`scheduled` when the team plays in the window, `no_games` when it does not, `unknown` when the player's professional team could not be identified.",
    }),
  ),
  gameCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({
      description: "Games the player's team plays in the window.",
    }),
  ),
  games: Schema.Array(SummaryScheduledGame),
  gamesRemaining: SchedulePlayerGamesRemaining,
});
export type SummarySchedulePlayer = typeof SummarySchedulePlayer.Type;

const SummaryScheduleDate = Schema.Struct({
  date: Schema.NonEmptyString,
  rosterGames: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({
      description: "How many of this roster's players play on this date.",
    }),
  ),
  leagueGames: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
    Schema.annotate({
      description:
        "Games the professional league has on this date; absent when the source does not cover it, never zero.",
    }),
  ),
  teamsPlaying: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
    Schema.annotate({
      description: "How many professional teams play on this date. Absent with `leagueGames`.",
    }),
  ),
  offNight: Schema.optional(Schema.Boolean).pipe(
    Schema.annotate({
      description:
        "Whether the date is a league off night; absent when the league's games are unknown, not false.",
    }),
  ),
});

export const SummaryScheduleWindow = ScheduleWindow.pipe(
  Schema.annotate({
    description:
      "The dates this schedule covers and where they came from: `period`, `requested`, or `rest_of_week`.",
  }),
);
export type SummaryScheduleWindow = typeof SummaryScheduleWindow.Type;

const SummaryOffNights = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    definition: Schema.Struct({
      name: Schema.Literal(leagueOffNightDefinition.name),
      maximumTeamShare: Schema.Literal(leagueOffNightDefinition.maximumTeamShare).pipe(
        Schema.annotate({
          description:
            "An off night is a date where fewer than this share of the league's professional teams play.",
        }),
      ),
    }),
    sport: Schema.Literal("hockey").pipe(
      Schema.annotate({
        description: "The sport whose games made off nights computable; hockey only.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.NonEmptyString,
  }),
]).pipe(
  Schema.annotate({
    description:
      "Whether off nights are computable, and their definition; unsupported means the per-date counts are absent, not false.",
  }),
);

const SummaryGamesRemainingState = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    sources: Schema.Array(ScheduleGamesRemainingSource),
    window: Schema.optional(
      SummaryScheduleWindow.pipe(
        Schema.annotate({
          description:
            "The exact dates these counts cover; absent when they follow the schedule's `period`.",
        }),
      ),
    ),
    observedAt: Schema.DateTimeUtc.pipe(
      Schema.annotate({
        description: "The oldest instant among the sources behind these counts.",
      }),
    ),
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.NonEmptyString,
  }),
]).pipe(
  Schema.annotate({
    description: "How the per-player `gamesRemaining` counts were produced.",
  }),
);

const SummarySchedule = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    coverage: Schema.Literals(["date", "week"]),
    period: Schema.optional(QueryPeriod).pipe(
      Schema.annotate({
        description:
          "The scoring period that bounds this schedule; absent when unpublished, and `window` then states the dates.",
      }),
    ),
    window: Schema.optional(SummaryScheduleWindow).pipe(
      Schema.annotate({
        description:
          "The dates this schedule covers; a scoring-week league states its week in `period` instead.",
      }),
    ),
    observedAt: Schema.DateTimeUtc.pipe(
      Schema.annotate({
        description:
          "The oldest instant these games were observed. Compare it against now to judge staleness.",
      }),
    ),
    dates: Schema.optional(Schema.Array(SummaryScheduleDate)).pipe(
      Schema.annotate({
        description:
          "Every date of the window with the roster's game count. Present only for date coverage.",
      }),
    ),
    offNights: SummaryOffNights,
    gamesRemaining: SummaryGamesRemainingState,
    players: Schema.Array(SummarySchedulePlayer).pipe(
      Schema.annotate({
        description:
          "One page of the roster's players; `page` and the cursor are shared with the roster section.",
      }),
    ),
    detail: Schema.String.pipe(
      Schema.annotate({
        description: "What this schedule covers.",
      }),
    ),
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryRosterPlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  draft: PlayerDraft,
  slot: RosterSlot,
  primaryPosition: Schema.NonEmptyString,
  eligiblePositions: Schema.Array(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description:
        "Every position the site says this player can fill; read it against `slot` to judge legality, and empty means none was published.",
    }),
  ),
  proTeam: Schema.NullOr(Schema.NonEmptyString),
  week: Schema.optional(PlayerWeek),
  injury: Schema.Struct({
    reported: Schema.Boolean,
    code: Schema.optional(Schema.String),
  }),
  startingStatus: StartingStatus,
});
export type SummaryRosterPlayer = typeof SummaryRosterPlayer.Type;

const SummaryIllegalSlot = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  slot: Schema.NonEmptyString,
  eligiblePositions: Schema.Array(Schema.NonEmptyString),
  detail: Schema.NonEmptyString,
});
export type SummaryIllegalSlot = typeof SummaryIllegalSlot.Type;

const SummaryRosterPlaces = Schema.Struct({
  maximum: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  occupied: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  reserved: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  remaining: Schema.Int,
});
type SummaryRosterPlaces = typeof SummaryRosterPlaces.Type;

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
  acquisitionUsage: Schema.optional(SummaryAcquisitionUsage),
  matchup: Schema.optional(SummaryMatchup),
  remainingPlayerGames: Schema.optional(SummaryRemainingGames),
  schedule: Schema.optional(SummarySchedule).pipe(
    Schema.annotate({
      description:
        "Present when `schedule` is requested. A league with no scoring period reads a requested `window` or the rest of the week.",
    }),
  ),
  ownerNote: TeamOwnerNote,
  agentNotes: Schema.Array(TeamAgentNote).pipe(
    Schema.annotate({
      description:
        "The twenty most recent agent notes, newest first; client memory, never the owner's note.",
    }),
  ),
  illegalSlots: Schema.optional(Schema.Array(SummaryIllegalSlot)).pipe(
    Schema.annotate({
      description:
        "Rostered players whose eligible positions exclude their league slot; absent when the roster was not read, not none.",
    }),
  ),
  rosterPlaces: Schema.optional(SummaryRosterPlaces).pipe(
    Schema.annotate({
      description:
        "The league's roster places: `maximum`, `occupied`, `reserved`, and `remaining`. Present only when the roster was read.",
    }),
  ),
  roster: Schema.optional(Schema.Array(SummaryRosterPlayer)).pipe(
    Schema.annotate({
      description:
        "One page of the roster, present only when `roster` is requested; absent is not an empty page.",
    }),
  ),
  coverage: Schema.Array(QueryCoverage),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type TeamSummaryData = typeof TeamSummaryData.Type;
export const TeamSummaryResult = Schema.Union([TeamSummaryData, NarrowingResult]);
export type TeamSummaryResult = typeof TeamSummaryResult.Type;
