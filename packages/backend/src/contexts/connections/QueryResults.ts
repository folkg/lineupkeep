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
  RosterSlot,
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

const declaredStateDetail =
  "`published` carries the value the league declares. `not_set` means the league declares no such rule; it is never zero and never a derived guess.";

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
      "`published` carries the value exactly as the league states it, including an empty string when the league publishes no value for that rule. `not_set` means the league published no such field; the two are different statements.",
  }),
);

const DeclaredFlag = Schema.Union([
  Schema.Struct({ status: Schema.Literal("published"), value: Schema.Boolean }),
  Schema.Struct({ status: Schema.Literal("not_set") }),
]).pipe(Schema.annotate({ description: declaredStateDetail }));

const TradeRatification = Schema.Literals(["vote", "commissioner", "none", "unknown"]).pipe(
  Schema.annotate({
    description:
      "How a trade is ratified: `vote` by league managers, `commissioner` by the commissioner, `none` when no review follows acceptance, or `unknown` for a rule this server cannot name.",
  }),
);

const DeclaredTradeRatification = Schema.Union([
  Schema.Struct({ status: Schema.Literal("published"), value: TradeRatification }),
  Schema.Struct({ status: Schema.Literal("not_set") }),
]).pipe(Schema.annotate({ description: declaredStateDetail }));

export const AcquisitionLimits = Schema.Struct({
  weekly: DeclaredNumber.pipe(
    Schema.annotate({ description: "Acquisitions the league allows each team per week." }),
  ),
  season: DeclaredNumber.pipe(
    Schema.annotate({ description: "Acquisitions the league allows each team per season." }),
  ),
});

const AddCoverage = Schema.Union([
  Schema.Struct({ week: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) }),
  Schema.Struct({ date: Schema.NonEmptyString }),
]).pipe(
  Schema.annotate({
    description:
      "The period the provider's adds count covers: the league's scoring week, or a date for a league the provider counts by day.",
  }),
);

export const AcquisitionUsage = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("published"),
    seasonMovesUsed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
      Schema.annotate({
        description:
          "Season-long moves the provider reports this team has used. A published zero means the provider reported none; it is never a missing count.",
      }),
    ),
    weeklyAddsUsed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
      Schema.annotate({
        description:
          "Adds the provider reports this team has used in `coverage`. A published zero means the provider reported none; it is never a missing count.",
      }),
    ),
    coverage: AddCoverage,
    seasonMovesRemaining: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
      Schema.annotate({
        description:
          "Season moves the team may still use before reaching the league limit, so a client does not subtract the count itself. Absent when the league declares no such limit; never manufactured against no limit.",
      }),
    ),
    weeklyAddsRemaining: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
      Schema.annotate({
        description:
          "Adds the team may still use in `coverage` before reaching the league limit. Absent when the league declares no such limit; never manufactured against no limit.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("not_published"),
    detail: Schema.NonEmptyString.pipe(
      Schema.annotate({
        description:
          "Why this team's acquisition usage is unknown. The provider published no such counter, which is different from reporting zero used.",
      }),
    ),
  }),
]);

const GamesPlayedUsage = Schema.Struct({
  status: Schema.Literal("not_published"),
  detail: Schema.NonEmptyString,
}).pipe(
  Schema.annotate({
    description:
      "Per-team games played is not published. The provider's `teams;out=games_played` read returns an empty per-team node, and its roster, standings, and players reads refuse that output, so only the league's games-played cap is known.",
  }),
);
export type AcquisitionUsage = typeof AcquisitionUsage.Type;
export type AcquisitionLimits = typeof AcquisitionLimits.Type;

const RosterChangeRule = Schema.Literals(["same_day", "next_day", "weekly_lock"]).pipe(
  Schema.annotate({
    description:
      "What a roster move does under this league's published deadline: `same_day` takes effect that day, `next_day` takes effect the next day, and `weekly_lock` waits for the league's weekly lock.",
  }),
);

const RosterChange = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("published"),
    value: RosterChangeRule,
    source: Schema.Array(Schema.NonEmptyString).pipe(
      Schema.annotate({
        description:
          "The published settings fields the rule is decoded from, in order, as the provider's own field names. A deadline field alone can establish an intraday, game-time, or weekday rule; an empty deadline is read together with the provider's current editable-period field.",
      }),
    ),
    detail: Schema.NonEmptyString.pipe(
      Schema.annotate({
        description:
          "The raw published values the rule was decoded from, so a client can audit the interpretation rather than trusting it.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("not_published"),
    detail: Schema.NonEmptyString.pipe(
      Schema.annotate({
        description:
          "The published settings do not establish a rule, so none is stated. This is not a default and never a guess.",
      }),
    ),
  }),
]);

const TransactionRules = Schema.Struct({
  waiver: Schema.Struct({
    type: DeclaredText.pipe(
      Schema.annotate({ description: "The provider's waiver-system type for this league." }),
    ),
    rule: DeclaredText.pipe(
      Schema.annotate({
        description:
          "The provider's waiver-priority rule for this league, such as continuous or a weekly reset.",
      }),
    ),
    usesFaab: DeclaredFlag.pipe(
      Schema.annotate({
        description: "Whether the league awards free agents through FAAB bids.",
      }),
    ),
  }),
  timing: Schema.Struct({
    weeklyDeadline: DeclaredRawText.pipe(
      Schema.annotate({
        description:
          "The league's declared weekly deadline exactly as the provider states it, such as `intraday`, `game`, a weekday, or an empty string when the league publishes no weekly deadline. An empty string is published rather than reported as `not_set`.",
      }),
    ),
    rosterChange: RosterChange.pipe(
      Schema.annotate({
        description:
          "The provider-neutral rule decoded from the published deadline and, when the deadline is empty, the provider's current editable period. Every published rule names its source fields and repeats the raw values; when the published fields do not establish a rule, the entry is `not_published` and no rule is stated.",
      }),
    ),
    waiverDays: DeclaredNumber.pipe(
      Schema.annotate({
        description: "Days a dropped player stays on waivers before joining the free-agent pool.",
      }),
    ),
  }),
  acquisitionLimits: AcquisitionLimits.pipe(
    Schema.annotate({
      description:
        "The league's acquisition limits. Each team's used count is published with its standings row, where `seasonMovesRemaining` and `weeklyAddsRemaining` are stated beside these limits when the league declares them.",
    }),
  ),
  trades: Schema.Struct({
    endDate: DeclaredText.pipe(
      Schema.annotate({
        description: "Last date on which a trade may be made, as the provider publishes it.",
      }),
    ),
    ratification: DeclaredTradeRatification.pipe(
      Schema.annotate({ description: "How a trade is ratified in this league." }),
    ),
    objectionDays: DeclaredNumber.pipe(
      Schema.annotate({ description: "Days a manager has to object to a trade." }),
    ),
  }),
  gamesCaps: Schema.Struct({
    gamesPlayed: DeclaredNumber.pipe(
      Schema.annotate({
        description:
          "Games-played cap for the season. Published only when this league declares one.",
      }),
    ),
    inningsPitched: DeclaredNumber.pipe(
      Schema.annotate({
        description:
          "Innings-pitched cap for the season, which applies to baseball only. Published only when this league declares one.",
      }),
    ),
  }),
  detailNote: Schema.String,
});

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
    description:
      "Whether this league scores the stat. `scoring` counts toward this league's result; `informational` is published by the provider for this league but does not count, such as a stat the provider marks display-only.",
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
      description:
        "Why this stat is informational. Present only when `scoring` is `informational`; absent for a scoring category.",
    }),
  ),
  positionTypes: Schema.Array(Schema.NonEmptyString),
  points: Schema.NullOr(Schema.String).pipe(
    Schema.annotate({
      description:
        "Per-stat scoring points for a points league. Null means the provider publishes no per-stat points for this league, which is every categories and rotisserie league.",
    }),
  ),
});

const CategoryValueScoring = Schema.optional(Schema.Literal("informational")).pipe(
  Schema.annotate({
    description:
      "Absent when the league scores this category. `informational` means the provider publishes the number but the league does not score it, so it is never treated as a scored value.",
  }),
);

export const CategoryValue = Schema.Struct({
  stat: StatRef,
  name: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description:
        "The league scoring category's name, inlined so the number needs no dictionary read.",
    }),
  ),
  scoring: CategoryValueScoring,
  value: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "The published number, or null when the provider published no value for this category. Null is never read as zero.",
    }),
  ),
  detail: Schema.optional(Schema.String).pipe(
    Schema.annotate({
      description:
        "Why `value` is null. Present only with a null value, and never used to explain a published number.",
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
  acquisitionUsage: AcquisitionUsage.pipe(
    Schema.annotate({
      description:
        "This team's acquisition usage, published even for a rival so a waiver decision compares against the league without another call. `not_published` is stated with the provider's missing counter, never as zero used.",
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
  acquisitionLimits: AcquisitionLimits.pipe(
    Schema.annotate({
      description:
        "The league's acquisition limits, published once for the rows. A team's remaining count is present only for a limit published here; `not_set` means the league declares none, so no row manufactures a remaining count.",
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
  overview: Schema.optional(LeagueSettingsOverview),
  rosterRules: Schema.optional(RosterRules),
  scoring: Schema.optional(Schema.Array(ScoringCategory)).pipe(
    Schema.annotate({
      description:
        "This league's configured stat categories in order, each marked `scoring` or `informational`. Present when the `scoring` group is requested and whenever standings rows carry stat references, which the compact standings form does not.",
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

const PlayerTransactionTrend = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("published"),
    adds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    drops: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    window: Schema.Literal("provider_current_day").pipe(
      Schema.annotate({
        description:
          "The day these counts cover. The provider publishes no window or date with the count, so this states the provider's current day; the enclosing result's `coverage` carries the instant the read was made.",
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
      "The provider's own count of adds and drops of this player on its current day, across the provider's leagues. This is not percent owned and not a change in percent owned. `not_published` means the provider returned no count for this player; it is never reported as zero.",
  }),
);

export const RosterPlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  slot: RosterSlot,
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
  transactionTrend: PlayerTransactionTrend,
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

const SearchDate = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
  Schema.annotate({
    description:
      "Calendar date as `YYYY-MM-DD`. The provider's league player pool is date-addressable only for a league whose coverage is a date; a scoring-week league reports that it cannot date a pool player.",
  }),
);

export const SearchPlayersInput = Schema.Struct({
  team: TeamId,
  date: Schema.optional(SearchDate).pipe(
    Schema.annotate({
      description:
        "Read each pool row's opponent on this date. The date is used only when the league's coverage is a date; a scoring-week league states that its pool read returns the week's opponent rather than a dated one.",
    }),
  ),
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
  proTeam: Schema.NullOr(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description:
        "The player's professional team abbreviation as the provider publishes it, the same value a roster entry carries under `proTeam`, so a pool player joins a schedule without another read. Null means the provider published no professional team for this row.",
    }),
  ),
  eligiblePositions: Schema.Array(Schema.NonEmptyString),
  availability: Schema.Literals(["free_agent", "waiver", "rostered", "unknown"]),
  status: Schema.Struct({
    value: Schema.Literals(["healthy", "day_to_day", "out", "injured_reserve", "unknown"]).pipe(
      Schema.annotate({
        description:
          "The provider's availability for this player: `healthy`, `day_to_day`, `out`, `injured_reserve`, or `unknown` for a code this adapter has not been taught. `unknown` never means healthy.",
      }),
    ),
    code: Schema.optional(Schema.String).pipe(
      Schema.annotate({
        description:
          "The provider's own status code, kept verbatim (for example `IR-LT`). Absent when the provider reports the player healthy.",
      }),
    ),
    detail: Schema.optional(Schema.String).pipe(
      Schema.annotate({
        description:
          "The provider's own wording where it publishes one, such as an injury note. The provider publishes no separate expected-return field; any such text appears here.",
      }),
    ),
    observedAt: Schema.DateTimeUtc.pipe(
      Schema.annotate({
        description:
          "When this status was read from the provider. Compare it against now to judge staleness.",
      }),
    ),
  }),
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
  opponent: Schema.optional(
    Schema.Union([
      Schema.Struct({
        status: Schema.Literal("scheduled"),
        opponent: Schema.NonEmptyString.pipe(
          Schema.annotate({
            description:
              "The opponent's professional-team abbreviation for the date stated in the result's `schedule`. The provider publishes no full name or start time.",
          }),
        ),
        home: Schema.Boolean.pipe(
          Schema.annotate({ description: "Whether the player's professional team is at home." }),
        ),
      }),
      Schema.Struct({ status: Schema.Literal("no_game") }),
      Schema.Struct({
        status: Schema.Literal("not_published"),
        detail: Schema.NonEmptyString,
      }),
    ]),
  ).pipe(
    Schema.annotate({
      description:
        "This pool row's opponent for the date and source stated in the result's `schedule`, present only when that schedule is `available`. `no_game` means the provider published no opponent for this player on that date; `not_published` means the field was absent and no opponent is claimed.",
    }),
  ),
  transactionTrend: PlayerTransactionTrend,
});

const SearchSchedule = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    date: SearchDate.pipe(
      Schema.annotate({
        description: "The date every row's `opponent` describes, as requested by this call.",
      }),
    ),
    source: Schema.Literal("league_player_pool").pipe(
      Schema.annotate({
        description:
          "The read that produced the dated opponents: the league's player pool for the requested date. The provider details of that read are recorded in the research notes, not assumed by a client.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("not_published"),
    detail: Schema.NonEmptyString.pipe(
      Schema.annotate({
        description:
          "Why no dated opponent is published: the league's coverage is a scoring week or its settings could not be read. No dated opponent is inferred in either case; a row whose opponent field was absent states that separately.",
      }),
    ),
  }),
]).pipe(
  Schema.annotate({
    description:
      "Where the dated opponents on this page came from, or why none is published. Present only when `date` was requested.",
  }),
);

export const SearchPlayersData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  coverage: Schema.Array(QueryCoverage),
  players: Schema.Array(SearchPlayer),
  schedule: Schema.optional(SearchSchedule),
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
  "schedule",
  "roster",
]);
export type SummaryGroup = typeof SummaryGroup.Type;

const SummaryWindowDate = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
  Schema.annotate({ description: "Calendar date as `YYYY-MM-DD`." }),
);

export const GetTeamSummaryInput = Schema.Struct({
  team: TeamId,
  groups: Schema.optional(
    Schema.Array(SummaryGroup).pipe(
      Schema.check(Schema.isMaxLength(6)),
      Schema.annotate({
        description:
          "Sections to include. Defaults to `league`, `standings`, `matchup`, and `roster`. `categories` adds the season category totals and points plus the matchup's per-category values. `schedule` adds each rostered player's scheduled games for the window this result states, with a per-date roster count. The roster and schedule sections page with the returned cursor.",
      }),
    ),
  ),
  window: Schema.optional(
    Schema.Struct({ start: SummaryWindowDate, end: SummaryWindowDate }).pipe(
      Schema.annotate({
        description:
          "Inclusive date window for the `schedule` group. It is used instead of the league's scoring period and is the way to read a schedule for a league whose provider publishes no period, such as a rotisserie hockey league. The provider bounds one schedule read to 21 dates, so a wider window is refused with that limit rather than truncated.",
      }),
    ),
  ),
  days: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(366)).pipe(
      Schema.annotate({
        description:
          "Length in days of the `schedule` window, counted from the provider's current date for the league. It is used only when `window` is absent, and takes precedence over the league's scoring period. The provider bounds one schedule read to 21 dates and refuses a longer window with that limit rather than truncating it, so a longer `days` value is refused too. Omitting both `window` and `days` keeps the scoring period when the league has one and otherwise reads from the provider's current date through the end of that week.",
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
  gamesBack: Schema.optional(Schema.Finite).pipe(
    Schema.annotate({
      description: "Games behind the leader. Absent when the format publishes no such number.",
    }),
  ),
  pointsBack: Schema.optional(Schema.Finite).pipe(
    Schema.annotate({
      description: "Points behind the leader. Absent when the format publishes no such number.",
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
    description:
      "This team's acquisition usage beside the league's limits, so a waiver decision needs no second call. The limits are also published here because the summary omits the full transaction rules.",
  }),
);

export const SummaryMatchupCategory = Schema.Struct({
  stat: StatRef,
  name: Schema.NonEmptyString,
  scoring: CategoryValueScoring,
  own: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description: "This team's value for the category, or null when unpublished.",
    }),
  ),
  opponent: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description: "The opponent's value for the category, or null when unpublished.",
    }),
  ),
  detail: Schema.optional(Schema.String).pipe(
    Schema.annotate({
      description:
        "Why a side is null. Present only when at least one side published no value; a published number is never explained away.",
    }),
  ),
}).pipe(
  Schema.annotate({
    description:
      "One scoring category with both sides' values in one row, so the category name, stat reference, and scoring marking are not repeated twice.",
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
      description:
        "The date this game is played. Omitted when the league's coverage is a scoring week, where the opponent covers the week rather than one date.",
    }),
  ),
  opponent: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description:
        "The opponent's professional-team abbreviation. The provider publishes no full name or start time.",
    }),
  ),
  home: Schema.Boolean.pipe(
    Schema.annotate({ description: "Whether the player's team is at home for this game." }),
  ),
});

export const SummarySchedulePlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  proTeam: Schema.NullOr(Schema.NonEmptyString),
  status: Schema.Literals(["scheduled", "no_games"]).pipe(
    Schema.annotate({
      description:
        "`scheduled` when the player's team plays in the window this section states, `no_games` when the provider publishes no game for them in it. `no_games` is an answer about the player, not a statement that the provider is unsupported.",
    }),
  ),
  gameCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({
      description:
        "Number of games the player's team plays in the window this section states: the dates with an opponent, or one opponent when the league's coverage is a scoring week.",
    }),
  ),
  games: Schema.Array(SummaryScheduledGame),
});
export type SummarySchedulePlayer = typeof SummarySchedulePlayer.Type;

const SummaryScheduleDate = Schema.Struct({
  date: Schema.NonEmptyString,
  rosterGames: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({
      description:
        "How many of this roster's players play on this date, so a light night needs no client-side arithmetic.",
    }),
  ),
});

export const SummaryScheduleWindow = Schema.Struct({
  start: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "First date the schedule covers, inclusive." }),
  ),
  end: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "Last date the schedule covers, inclusive." }),
  ),
  source: Schema.Literals(["period", "requested", "rest_of_week"]).pipe(
    Schema.annotate({
      description:
        "Where this window came from. `period` is the league's own scoring-period window; `requested` is a `window` or `days` argument on this call; `rest_of_week` is the default for a league with no scoring period, counted from the provider's current date through the end of that week. The dates covered are in `start` and `end`, never inferred by the client.",
    }),
  ),
});
export type SummaryScheduleWindow = typeof SummaryScheduleWindow.Type;

const SummarySchedule = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    coverage: Schema.Literals(["date", "week"]),
    period: Schema.optional(QueryPeriod).pipe(
      Schema.annotate({
        description:
          "The scoring period that bounds this schedule. Absent for a league whose provider publishes no scoring period, such as a rotisserie league; `window` states the dates covered instead.",
      }),
    ),
    window: Schema.optional(SummaryScheduleWindow).pipe(
      Schema.annotate({
        description:
          "The inclusive dates this schedule covers and where they came from. Present for date coverage; a scoring-week league states the week in `period` instead.",
      }),
    ),
    observedAt: Schema.DateTimeUtc.pipe(
      Schema.annotate({
        description:
          "When these games were read from the provider. Compare it against now to judge staleness.",
      }),
    ),
    dates: Schema.optional(Schema.Array(SummaryScheduleDate)).pipe(
      Schema.annotate({
        description:
          "Every date of the window with the roster's game count for it. Present only for date coverage; a scoring-week league has no per-date view.",
      }),
    ),
    players: Schema.Array(SummarySchedulePlayer).pipe(
      Schema.annotate({
        description:
          "One page of the roster's players. The roster and schedule sections share `page` and the returned cursor.",
      }),
    ),
    detail: Schema.String.pipe(
      Schema.annotate({
        description:
          "What this schedule covers and what the provider does not publish: no start times, no season-long schedule, and for a scoring-week league no count of games inside the week.",
      }),
    ),
  }),
  Schema.Struct({ status: Schema.Literal("unsupported"), detail: Schema.String }),
]);

const SummaryRosterPlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  slot: RosterSlot,
  primaryPosition: Schema.NonEmptyString,
  proTeam: Schema.NullOr(Schema.NonEmptyString),
  injury: Schema.Struct({
    reported: Schema.Boolean,
    code: Schema.optional(Schema.String),
  }),
});
export type SummaryRosterPlayer = typeof SummaryRosterPlayer.Type;

const TeamOwnerNote = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("provided"),
    text: Schema.NonEmptyString,
    updatedAt: Schema.optional(Schema.DateTimeUtc),
  }),
  Schema.Struct({ status: Schema.Literal("not_set") }),
]).pipe(
  Schema.annotate({
    description:
      "The note the team's owner wrote in Lineupkeep. This is owner context, not a provider fact: the provider and the league do not publish it, so it is not a rule, a scoring setting, or a fact the league said. It can explain keepers, dynasty cost, salary, or why a player is held. The owner can change or clear it, and it is never a place for passwords, tokens, or provider session material.",
  }),
);

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
        "Each rostered player's scheduled games for the window stated in this section, present when the `schedule` group is requested. A league whose provider publishes no scoring period reads a requested `window` or the rest of the week; when neither is available the section says so and names the argument to pass.",
    }),
  ),
  probableStarters: Schema.optional(
    Schema.Struct({
      status: Schema.Literal("unsupported"),
      detail: Schema.String,
    }),
  ),
  ownerNote: TeamOwnerNote,
  roster: Schema.optional(Schema.Array(SummaryRosterPlayer)).pipe(
    Schema.annotate({
      description:
        "One page of this team's roster, present only when `roster` is among the requested groups. The key is absent when the group was not requested, which is different from an empty page; the roster and schedule sections share `page` and the returned cursor.",
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
