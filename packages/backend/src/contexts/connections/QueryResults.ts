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
  RosterSlot,
  StatPeriod,
  StatPeriodPreset,
  StatRef,
  TeamListRow,
  TeamOwnerNote,
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

const LeagueWeek = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    current: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
      Schema.annotate({
        description: "The scoring week the league is in, as its own settings declare it.",
      }),
    ),
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
      "The league's current scoring week and the season's week range. `unsupported` with reason `not_published` means the league's site declares no scoring-week window, as a rotisserie league does; it is not week zero.",
  }),
);
type LeagueWeek = typeof LeagueWeek.Type;

const CalendarGame = Schema.Struct({
  date: Schema.optional(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description:
        "The date this game is played. Omitted when the league's coverage is a scoring week, where the opponent covers the week rather than one date.",
    }),
  ),
  opponent: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description: "The opponent's professional-team abbreviation from the league's site.",
    }),
  ),
  home: Schema.Boolean,
});
type CalendarGame = typeof CalendarGame.Type;

export const CalendarTeamGames = Schema.Struct({
  proTeam: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description: "The professional-team abbreviation the league's site publishes for the team.",
    }),
  ),
  plays: Schema.Boolean.pipe(
    Schema.annotate({
      description:
        "Whether this professional team plays at least once in the requested period. False is the bye-week answer.",
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
          "Requested professional teams the league's roster-scoped schedule does not reach, because no rostered player belongs to them. Absent when every requested team is covered, or when no `proTeams` filter was given.",
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
      "Each professional team's games in the requested period, from the league's site schedule for the linked team's roster. `not_published` means the period's dates could not be established; `unavailable` means the schedule read failed.",
  }),
);

export const GetCalendarInput = Schema.Struct({
  team: TeamId,
  period: Schema.optional(
    QueryPeriod.pipe(
      Schema.annotate({
        description:
          "The league week whose professional-team games to read into `games`. Omit it to read only the week range and periods. A week outside the league's declared range is refused.",
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
          "Professional-team abbreviations to keep in `games`, taken from pool or roster rows. Omit it for every professional team the linked team's roster reaches.",
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
      description:
        "The league's current scoring week, published without a matchup read. Absent only when the league settings could not be read.",
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
      "How a trade is ratified: `vote` by league managers, `commissioner` by the commissioner, `none` when no review follows acceptance, or `unknown` for a rule Lineupgrade cannot name.",
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
      "The period the league's site counts adds over: the league's scoring week, or a date for a league it counts by day.",
  }),
);

export const AcquisitionUsage = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("published"),
    seasonMovesUsed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
      Schema.annotate({
        description:
          "Season-long moves the league's site reports this team has used. A published zero means it reported none; it is never a missing count.",
      }),
    ),
    weeklyAddsUsed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
      Schema.annotate({
        description:
          "Adds the league's site reports this team has used in `coverage`. A published zero means it reported none; it is never a missing count.",
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
          "Why this team's acquisition usage is unknown. The league's site published no such counter, which is different from reporting zero used.",
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
      "Per-team games played is not published. `detail` carries the limitation the league's site declares, so only the league's games-played cap is known.",
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
          "The published settings fields the rule is decoded from, in order, as the league site's own field names. A deadline field alone can establish an intraday, game-time, or weekday rule; an empty deadline is read together with the current editable-period field at the league's site.",
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
      Schema.annotate({
        description: "The waiver-system type the league's site reports for this league.",
      }),
    ),
    rule: DeclaredText.pipe(
      Schema.annotate({
        description:
          "The waiver-priority rule the league's site reports for this league, such as continuous or a weekly reset.",
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
          "The league's declared weekly deadline exactly as the league's site states it, such as `intraday`, `game`, a weekday, or an empty string when the league publishes no weekly deadline. An empty string is published rather than reported as `not_set`.",
      }),
    ),
    rosterChange: RosterChange.pipe(
      Schema.annotate({
        description:
          "The rule decoded from the published deadline and, when the deadline is empty, the current editable period at the league's site. Every published rule names its source fields and repeats the raw values; when the published fields do not establish a rule, the entry is `not_published` and no rule is stated.",
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
        description: "Last date on which a trade may be made, as the league's site publishes it.",
      }),
    ),
    ratification: DeclaredTradeRatification.pipe(
      Schema.annotate({ description: "How a trade is ratified in this league." }),
    ),
    objectionDays: DeclaredNumber.pipe(
      Schema.annotate({ description: "Days a manager has to object to a trade." }),
    ),
    draftPicks: Schema.Union([
      Schema.Struct({ status: Schema.Literal("published"), value: Schema.Boolean }),
      Schema.Struct({ status: Schema.Literal("not_set") }),
    ]).pipe(
      Schema.annotate({
        description:
          "Whether this league allows draft picks to be traded. A league that allows it publishes picks only on its website, so Lineupgrade reports the rule but cannot propose a pick on our channel.",
      }),
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
      "Whether this league scores the stat. `scoring` counts toward this league's result; `informational` is published by the league's site for this league but does not count, such as a stat it marks display-only.",
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
        "Per-stat scoring points for a points league. Null means the league's site publishes no per-stat points for this league, which is every categories and rotisserie league.",
    }),
  ),
});

const CategoryValueScoring = Schema.optional(Schema.Literal("informational")).pipe(
  Schema.annotate({
    description:
      "Absent when the league scores this category. `informational` means the league's site publishes the number but the league does not score it, so it is never treated as a scored value.",
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
        "The published number, or null when the league's site published no value for this category. Null is never read as zero.",
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
        "This team's acquisition usage, published even for a rival so a waiver decision compares against the league without another call. `not_published` is stated with the missing counter from the league's site, never as zero used.",
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
  name: Schema.optional(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description:
        "The inline player name the league's site publishes for this pick, present where its draft read gives one. It sits beside the private player reference; the name is absent when the site gives none.",
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

export const LeagueData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  week: Schema.optional(LeagueWeek).pipe(
    Schema.annotate({
      description:
        "The league's current scoring week and week range, independent of the `overview` group. Absent only when the league settings could not be read.",
    }),
  ),
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
        "Completed draft picks for this league's draft, one row per pick. Present when the `draft_history` group is requested. This is history, not current or future pick ownership: the league's site publishes no pick-ownership read, and a traded pick appears on the trade transaction that moved it.",
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
        'The linked team whose league scopes this read. With `scope: "team"` it is the team whose roster is read; with `scope: "league"` it supplies the league and the ownership boundary, and every team in that league is read.',
    }),
  ),
  scope: Schema.optional(
    Schema.Literals(["team", "league"]).pipe(
      Schema.annotate({
        description:
          "`team` reads one linked team and pages its players. `league` reads every roster in the linked team's league, including teams the account does not own, and pages whole teams: a page boundary never splits a roster. The default is `team`.",
      }),
    ),
  ),
  period: Schema.optional(
    QueryPeriod.pipe(
      Schema.annotate({
        description:
          "The exact league week for a `team` read. The league's site publishes its league-wide roster output only for its current coverage, so a `league` read refuses this argument instead of reading the teams one at a time; the result's `period` or coverage states the current week or date.",
      }),
    ),
  ),
  detail: Schema.optional(RosterDetail),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(
    PageLimit.pipe(
      Schema.annotate({
        description:
          'The most rows this page may carry: players for `scope: "team"`, whole teams for `scope: "league"`. The result\'s `page.size` repeats the bound, `page.total` states the row count in the league roster read, and `page.returned` is the actual count after the result budget.',
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
        description:
          "The day these counts cover. The league's site publishes no window or date with the count, so this states the current day at the league's site; the enclosing result's `coverage` carries the instant the read was made.",
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
      "The count of adds and drops of this player on its current day that the league's site reports, across the site's leagues. This is not percent owned and not a change in percent owned. `not_published` means the site returned no count for this player; it is never reported as zero.",
  }),
);

const PlayerWeek = Schema.Struct({
  period: QueryPeriod.pipe(
    Schema.annotate({
      description: "The scoring week these facts cover: the league's current week for a pool row.",
    }),
  ),
  playsThisWeek: Schema.Boolean.pipe(
    Schema.annotate({
      description:
        "Whether this player's professional team plays in this scoring week. False is the bye-week answer.",
    }),
  ),
  opponent: Schema.NullOr(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description:
        "The opponent's professional-team abbreviation for the week, or null when the team does not play or the league's site published no opponent.",
    }),
  ),
  home: Schema.NullOr(Schema.Boolean),
  byeWeek: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(99)),
  ).pipe(
    Schema.annotate({
      description:
        "The week this professional team does not play, where the league's site publishes one. Absent when it publishes none, never guessed from the schedule.",
    }),
  ),
  projectedRank: Schema.optional(
    Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  ).pipe(
    Schema.annotate({
      description:
        "The league-scoped projected rank for this scoring week, where the league's site publishes one for this sport; null when it publishes ranks for the sport but none for this player. Absent when this read did not request it.",
    }),
  ),
}).pipe(
  Schema.annotate({
    description:
      "This player's current scoring week. Present only for a league whose declared roster coverage is a scoring week; a date-scored league has no weekly block.",
  }),
);
export type PlayerWeek = typeof PlayerWeek.Type;

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
  week: Schema.optional(PlayerWeek),
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
  scope: Schema.Literal("team"),
  team: QueryTeam,
  period: Schema.optional(QueryPeriod),
  coverage: Schema.Array(QueryCoverage),
  playerSchedule: PlayerSchedule,
  players: Schema.Array(RosterPlayer),
  ownerNote: Schema.optional(TeamOwnerNote).pipe(
    Schema.annotate({
      description:
        "The owner's note for this team, present only when `detail` is `full`. It is owner context, not a fact from the league's site or the league, and the compact roster omits it.",
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
      description:
        "The private reference of the team at the league's site, sealed for this owner and league. It opens in this league's counterparty reads and nowhere else, and is the same reference shape offers and transactions carry.",
    }),
  ),
  name: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description:
        "The team name at the league's site for display. Identity is the private reference, never the name.",
    }),
  ),
  owned: Schema.Boolean.pipe(
    Schema.annotate({
      description:
        "Whether this account linked the team. An unowned team is a rival in the same league; its players are still readable here.",
    }),
  ),
  players: Schema.Array(RosterPlayer).pipe(
    Schema.annotate({
      description:
        "The team's whole roster for this read. A league page never splits a roster across pages.",
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
          "An order the league's site backs, offered only when the linked site declares it. `actual_rank` and `overall_rank` are the actual and overall ranks from the site; `stat` orders by the league scoring category in `stat`. `ownership` orders by percent owned descending. The limitations the site declares explain any sort it refuses, such as a point-total sort for a sport that does not offer it.",
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
          "Period for a `stat` sort. `season` orders by the season rank or stat value from the league's site. `week` is available only where the site declares that its search rows publish the weekly value they order by; otherwise it answers with the remedy instead of an unexplainable order.",
      }),
    ),
  ),
  includeGames: Schema.optional(
    Schema.Boolean.pipe(
      Schema.annotate({
        description:
          "Add each pool row's games remaining for the current scoring window and the result's `gamesRemaining` section. Omit it when you only need names, ownership, availability, or ranks; the join reads the league window and the professional calendar.",
      }),
    ),
  ),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type SearchPlayersInput = typeof SearchPlayersInput.Type;

const ScheduleGamesRemainingSource = Schema.Literals(["professional_games", "provider_opponent"]);

const ScheduleWindowSource = Schema.Literals(["period", "requested", "rest_of_week"]);

const ScheduleWindow = Schema.Struct({
  start: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "First date the window covers, inclusive." }),
  ),
  end: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "Last date the window covers, inclusive." }),
  ),
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
      "Games this player's professional team plays in the window this section states. `professional_games` is counted from the professional-game source and `provider_opponent` from the opponent fact at the league's site; the source is named because the two can disagree. `unavailable` states why neither produced a count; it is never a silent zero.",
  }),
);

const SearchPlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  primaryPosition: Schema.NonEmptyString,
  displayPosition: Schema.NonEmptyString,
  proTeam: Schema.NullOr(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description:
        "The player's professional team abbreviation as the league's site publishes it, the same value a roster entry carries under `proTeam`, so a pool player joins a schedule without another read. Null means the site published no professional team for this row.",
    }),
  ),
  eligiblePositions: Schema.Array(Schema.NonEmptyString),
  availability: Schema.Literals(["free_agent", "waiver", "rostered", "unknown"]),
  status: Schema.Struct({
    value: Schema.Literals(["healthy", "day_to_day", "out", "injured_reserve", "unknown"]).pipe(
      Schema.annotate({
        description:
          "The availability the league's site reports for this player: `healthy`, `day_to_day`, `out`, `injured_reserve`, or `unknown` for a code this adapter has not been taught. `unknown` never means healthy.",
      }),
    ),
    code: Schema.optional(Schema.String).pipe(
      Schema.annotate({
        description:
          "The status code the league's site gives, kept verbatim (for example `IR-LT`). Absent when the site reports the player healthy.",
      }),
    ),
    detail: Schema.optional(Schema.String).pipe(
      Schema.annotate({
        description:
          "The wording the league's site gives where it publishes one, such as an injury note. The site publishes no separate expected-return field; any such text appears here.",
      }),
    ),
    observedAt: Schema.DateTimeUtc.pipe(
      Schema.annotate({
        description:
          "When this status was read from the league's site. Compare it against now to judge staleness.",
      }),
    ),
  }),
  percentOwned: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Percent owned as the league's site publishes it. Null means the site published no value for this row.",
    }),
  ),
  percentOwnedDelta: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Change in percent owned over the ownership-change window at the league's site. The site does not publish that window with the row, so do not read it as the fantasy day or as a scoring period. This is the only ownership-change field; null means the site published no change for this row.",
    }),
  ),
  percentStarted: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Percent started as the league's site publishes it. Null means the site published no value for this row.",
    }),
  ),
  percentStartedChange: Schema.NullOr(Schema.Finite).pipe(
    Schema.annotate({
      description:
        "Change in percent started over the started-percentage window at the league's site. The site does not publish that window with the row, so do not read it as the fantasy day or as a scoring period. Null means the site published no change for this row.",
    }),
  ),
  actualRank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).pipe(
    Schema.annotate({
      description:
        "The current-season rank the league's site gives this player, the value that orders sort `actual_rank`.",
    }),
  ),
  overallRank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).pipe(
    Schema.annotate({
      description:
        "The overall rank the league's site gives this player, the value that orders sort `overall_rank`.",
    }),
  ),
  statValue: Schema.optional(Schema.NullOr(Schema.Finite)).pipe(
    Schema.annotate({
      description:
        "The season value the league's site gives for the requested `stat` category. Present only with sort `stat`; null means the site published no value for this player.",
    }),
  ),
  gamesRemaining: Schema.optional(SchedulePlayerGamesRemaining),
  week: Schema.optional(PlayerWeek),
  transactionTrend: PlayerTransactionTrend,
});

const SearchGamesRemaining = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    window: ScheduleWindow,
    observedAt: Schema.DateTimeUtc,
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    detail: Schema.NonEmptyString,
  }),
]).pipe(
  Schema.annotate({
    description:
      "The window the pool rows' `gamesRemaining` counts cover and when their professional games were observed. Present only when `includeGames` is true. Every count is joined from the row's professional-team key, never from an abbreviation. `unsupported` states why no count is published instead of returning a zero.",
  }),
);

export const SearchPlayersData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  coverage: Schema.Array(QueryCoverage),
  players: Schema.Array(SearchPlayer),
  gamesRemaining: Schema.optional(SearchGamesRemaining),
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
        "The linked team whose league seals every player reference and whose roster supplies identity. This is context, not the subject of the read: a player on another team in the same league resolves normally. It is required because a player reference carries the owner and the league, and a query needs a league to open them.",
    }),
  ),
  players: Schema.Array(PlayerRef).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(25)),
    Schema.annotate({
      description:
        "Between 1 and 25 private player references from the league named by `team`. The whole requested list is returned in one response; an explicit list is bounded by this 25-reference cap instead of paging at a pool or roster page size.",
    }),
  ),
  period: Schema.optional(
    StatPeriod.pipe(
      Schema.annotate({
        description:
          'Period the `actual_stats` group covers. Accepted shapes: `{kind: "season"}` (the default when omitted), `{kind: "week", week}` or its short form `{week}`, `{kind: "preset", preset}` with `last_7_days`, `last_14_days`, or `last_30_days`, and `{kind: "range", start, end}` with inclusive `YYYY-MM-DD` dates. The league\'s site declares which kinds it serves natively, by aggregating daily reads, or not at all, and the result repeats that declaration in `periodSupport`; an unsupported kind is refused naming the kind and the alternative instead of substituting season totals.',
      }),
    ),
  ),
  groups: Schema.optional(
    Schema.Array(PlayerGroup).pipe(
      Schema.annotate({
        description:
          "Groups to hydrate. `actual_stats` states the basis the league's site declares: a completed week, season totals, or a daily-summed window with its covered dates. `projections` is available only where the site publishes them; otherwise the group returns an unsupported status naming that limitation. `availability` reads the selected-player status from the league's site for references that are not on the current roster, such as a free agent, waiver player, or dropped player; that is one read from the site for those references and it does not require `actual_stats`. A player the site publishes no status for carries no `availability` and is named in `failures`.",
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
          "Categories the league's site publishes but that cannot be summed across days, such as averages and percentages. Empty for a week or season basis the site serves whole.",
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
    period: QueryPeriod.pipe(
      Schema.annotate({ description: "The scoring week this projected rank covers." }),
    ),
    rank: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).pipe(
      Schema.annotate({
        description:
          "The league-scoped projected rank for the player in this week; null when the league's site published no rank for this player.",
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    reason: Schema.Literal("not_published"),
  }),
]).pipe(
  Schema.annotate({
    description:
      "The projected week rank the league's site publishes for the player. `unsupported` with reason `not_published` means the site publishes no projection for this sport or league.",
  }),
);

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
        "How the league's site serves each period kind for this sport: `native` is one series from the site, `aggregated` is a sum of reads from the site, and `unsupported` is refused with a remedy.",
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
          "`league` returns the league's recent transactions; `team` restricts the read from the league's site to the linked team's own moves. Both read newest first, and a date bound pages back through the site's history.",
      }),
    ),
  ),
  since: Schema.optional(
    Schema.DateTimeUtcFromString.pipe(
      Schema.annotate({
        description:
          "Only transactions at or after this instant. Supply an ISO 8601 instant such as `2026-09-20T00:00:00Z`; an offset form such as `2026-09-20T00:00:00-04:00` is also accepted. The league's site has no date filter, so the read pages back from its newest transaction until this bound is reached or a bounded event count is fetched; `window` states which happened.",
      }),
    ),
  ),
  until: Schema.optional(
    Schema.DateTimeUtcFromString.pipe(
      Schema.annotate({
        description:
          "Only transactions at or before this instant. Supply an ISO 8601 instant such as `2026-09-20T00:00:00Z`; an offset form is also accepted. Without `since`, the read pages back until this bound is reached or a bounded event count is fetched.",
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
        "Number of events read from the league's site. A date-bounded read may fetch several newest-first pages to reach the bound; an unbounded read fetches the most recent page only.",
    }),
  ),
  truncated: Schema.Boolean.pipe(
    Schema.annotate({
      description:
        "True only when the bounded read stopped at its event cap before reaching the requested `since`; false when the bound was reached or the site's history ended. When `since` is older than the oldest event at the site, `failures` reports `transaction_history_starts_after_range`.",
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
        "Round of the traded draft pick. The league's site publishes no draft year or overall pick number for a traded pick.",
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
          "Inclusive date window for the `schedule` group. It is used instead of the league's scoring period and is the way to read a schedule for a league whose site publishes no scoring period. The site bounds one schedule read to the number of dates it declares, and the result's `schedule.detail` states that number; a wider window is refused with the limit the site declares rather than truncated.",
      }),
    ),
  ),
  days: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(366)).pipe(
      Schema.annotate({
        description:
          "Length in days of the `schedule` window, counted from the current date at the league's site. It is used only when `window` is absent, and takes precedence over the league's scoring period. The site bounds one schedule read to the number of dates it declares, and the result's `schedule.detail` states that number; a longer window is refused with the limit the site declares rather than truncated, so a longer `days` value is refused too. Omitting both `window` and `days` keeps the scoring period when the league has one and otherwise reads from the current date at the league's site through the end of that week.",
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
        "The opponent's professional-team abbreviation. The league's site publishes no full name or start time.",
    }),
  ),
  home: Schema.Boolean.pipe(
    Schema.annotate({ description: "Whether the player's team is at home for this game." }),
  ),
  offNight: Schema.optional(Schema.Boolean).pipe(
    Schema.annotate({
      description:
        "Whether this date is a league off night under the definition in `schedule.offNights`. Absent when the league's professional games are unknown; absent is not false.",
    }),
  ),
});

export const SummarySchedulePlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  proTeam: Schema.NullOr(Schema.NonEmptyString),
  status: Schema.Literals(["scheduled", "no_games"]).pipe(
    Schema.annotate({
      description:
        "`scheduled` when the player's team plays in the window this section states, `no_games` when the league's site publishes no game for them in it. `no_games` is an answer about the player, not a statement that the site is unsupported.",
    }),
  ),
  gameCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({
      description:
        "Number of games the player's team plays in the window this section states: the dates with an opponent, or one opponent when the league's coverage is a scoring week.",
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
      description:
        "How many of this roster's players play on this date, so a light night needs no client-side arithmetic.",
    }),
  ),
  leagueGames: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
    Schema.annotate({
      description:
        "How many games the professional league has on this date, from the professional-game source. Absent when that source does not cover this league or its games are unknown, never zero by default.",
    }),
  ),
  teamsPlaying: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
    Schema.annotate({
      description:
        "How many of the league's professional teams play on this date. Absent with `leagueGames`.",
    }),
  ),
  offNight: Schema.optional(Schema.Boolean).pipe(
    Schema.annotate({
      description:
        "Whether this date is a league off night under the definition in `schedule.offNights`. Absent when the league's professional games are unknown; absent is not false.",
    }),
  ),
});

export const SummaryScheduleWindow = ScheduleWindow.pipe(
  Schema.annotate({
    description:
      "The inclusive dates this schedule covers and where they came from. `period` is the league's own scoring-period window; `requested` is a `window` or `days` argument on the call; `rest_of_week` is the default for a league with no scoring period, counted from the current date at the league's site through the end of that week. The dates covered are in `start` and `end`, never inferred by the client.",
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
            "A league off night is a date where fewer than this share of the league's professional teams play. Published so a client can compare its own threshold against the same raw per-date counts in `dates`.",
        }),
      ),
    }),
    sport: Schema.Literal("hockey").pipe(
      Schema.annotate({
        description:
          "The sport whose professional games made off nights computable. Hockey is the only supported sport today; every other sport reports `unsupported` instead.",
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
      "Whether off nights can be computed for this league, and the exact definition when they can. When unsupported, the per-date `leagueGames` and `offNight` fields are absent with this reason, never false.",
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
            "The exact inclusive dates these counts cover, when the league's site publishes them. Absent when the count follows the schedule section's `period` and the site publishes no dated window.",
        }),
      ),
    ),
    observedAt: Schema.DateTimeUtc.pipe(
      Schema.annotate({
        description:
          "The oldest instant among the sources used for these counts. The schedule section's `observedAt` is the opponent observation from the league's site; this is when the professional games behind a `professional_games` count were observed.",
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
    description:
      "How the per-player `gamesRemaining` counts were produced. `window` states the exact dates they cover when the league's site publishes them; otherwise the schedule section's `period` bounds them. A count is never zero because a source was missing: each player states its own source or an `unavailable` reason.",
  }),
);

const SummarySchedule = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    coverage: Schema.Literals(["date", "week"]),
    period: Schema.optional(QueryPeriod).pipe(
      Schema.annotate({
        description:
          "The scoring period that bounds this schedule. Absent for a league whose site publishes no scoring period; `window` states the dates covered instead.",
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
          "The oldest instant these games were observed from the league's site. Compare it against now to judge staleness.",
      }),
    ),
    dates: Schema.optional(Schema.Array(SummaryScheduleDate)).pipe(
      Schema.annotate({
        description:
          "Every date of the window with the roster's game count for it. Present only for date coverage; a scoring-week league has no per-date view. When off nights are supported, each entry also carries the league's game count, teams playing, and whether the date is an off night.",
      }),
    ),
    offNights: SummaryOffNights,
    gamesRemaining: SummaryGamesRemainingState,
    players: Schema.Array(SummarySchedulePlayer).pipe(
      Schema.annotate({
        description:
          "One page of the roster's players. The roster and schedule sections share `page` and the returned cursor.",
      }),
    ),
    detail: Schema.String.pipe(
      Schema.annotate({
        description:
          "What this schedule covers and what the league's site does not publish: no start times, no season-long schedule, and for a scoring-week league no count of games inside the week.",
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
  eligiblePositions: Schema.Array(Schema.NonEmptyString).pipe(
    Schema.annotate({
      description:
        "Every position the league's site says this player can fill, including a reserve marker while the player is eligible for that list. Read it against `slot` to see why a player is or is not legal where they sit; an empty list means the site published none, not that the player can fill nothing.",
    }),
  ),
  proTeam: Schema.NullOr(Schema.NonEmptyString),
  week: Schema.optional(PlayerWeek),
  injury: Schema.Struct({
    reported: Schema.Boolean,
    code: Schema.optional(Schema.String),
  }),
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
        "Each rostered player's scheduled games for the window stated in this section, present when the `schedule` group is requested. A league whose site publishes no scoring period reads a requested `window` or the rest of the week; when neither is available the section says so and names the argument to pass.",
    }),
  ),
  probableStarters: Schema.optional(
    Schema.Struct({
      status: Schema.Literal("unsupported"),
      detail: Schema.String,
    }),
  ),
  ownerNote: TeamOwnerNote,
  agentNotes: Schema.Array(TeamAgentNote).pipe(
    Schema.annotate({
      description:
        "The twenty most recent notes agent clients appended to this team, newest first, each with its author and time. Present as an empty array when the team has none, never absent. These are client memory, not a fact from the league's site or the league, and not the owner's instruction: `ownerNote` remains the owner's governing note and a tool write never changes it.",
    }),
  ),
  illegalSlots: Schema.optional(Schema.Array(SummaryIllegalSlot)).pipe(
    Schema.annotate({
      description:
        "Rostered players whose eligible positions do not include the slot the league declares for them, so the league's site may refuse a transaction until they move. Present only when the roster was read; absent means it was not checked, which is not the same as none. It is the league's own slot rules against the eligible positions the site lists, and nothing else: no injury check, no statistics, and no lineup decision.",
    }),
  ),
  rosterPlaces: Schema.optional(SummaryRosterPlaces).pipe(
    Schema.annotate({
      description:
        "How many roster places this team may fill, how many it fills now, how many of its players sit on a reserve list outside that count, and how many places remain. It is the same place arithmetic a proposal's order reports, so a client can check a move against the league's limit without deriving it. Present only when the roster was read.",
    }),
  ),
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
