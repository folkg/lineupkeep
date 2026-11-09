import { Effect, Schema, SchemaTransformation } from "effect";

import {
  Flag,
  IntFromStringOrNumber,
  NumberFromStringOrNumber,
  decodePayload,
  optionalNonEmpty,
  singleEntry,
} from "#yahoo/decode.ts";
import { YahooParseError } from "#yahoo/errors.ts";
import type { YahooLeagueKey } from "#yahoo/keys.ts";

export function decodeLeagueSettings(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<YahooLeagueSettings, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(LeaguePayload, payload, "read_league");
    const league = decoded.league;
    const settings = singleEntry(league.settings);
    if (settings === undefined || league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_league",
        field: "league.league_key",
      });
    }
    const weekWindow = yield* weekWindowOf(league);
    return {
      leagueKey: league.league_key,
      name: league.name,
      url: league.url,
      season: league.season,
      teamCount: league.num_teams,
      scoringType: league.scoring_type,
      scoringLabel: optionalNonEmpty(league.scoring_label),
      currentWeek: weekWindow?.current,
      startWeek: weekWindow?.start,
      endWeek: weekWindow?.end,
      startDate: optionalNonEmpty(league.start_date),
      endDate: optionalNonEmpty(league.end_date),
      currentDate: optionalNonEmpty(league.current_date),
      weeklyDeadline: league.weekly_deadline,
      editKey: league.edit_key === undefined ? undefined : String(league.edit_key),
      draftStatus: optionalNonEmpty(league.draft_status),
      settings: {
        rosterType: optionalNonEmpty(settings.roster_type),
        waiverType: optionalNonEmpty(settings.waiver_type),
        waiverRule: optionalNonEmpty(settings.waiver_rule),
        waiverTime: settings.waiver_time,
        usesFaab: settings.uses_faab,
        tradeEndDate: optionalNonEmpty(settings.trade_end_date),
        tradeRatifyType: optionalNonEmpty(settings.trade_ratify_type),
        tradeRejectTime: settings.trade_reject_time,
        canTradeDraftPicks: settings.can_trade_draft_picks,
        maxWeeklyAdds: positiveLimit(settings.max_weekly_adds),
        maxAdds: positiveLimit(settings.max_adds),
        maxGamesPlayed: positiveLimit(settings.max_games_played),
        maxInningsPitched: positiveLimit(settings.max_innings_pitched),
        rosterPositions: settings.roster_positions.map(({ roster_position }) => ({
          position: roster_position.position,
          positionType: optionalNonEmpty(roster_position.position_type),
          count: roster_position.count,
          isStartingPosition: roster_position.is_starting_position,
        })),
        statCategories: settings.stat_categories.stats.map(({ stat }) => ({
          statId: stat.stat_id,
          name: stat.name,
          displayName: stat.display_name,
          abbreviation: stat.abbr,
          group: stat.group,
          enabled: stat.enabled,
          displayOnly:
            stat.is_only_display_stat === true ||
            (stat.stat_position_types ?? []).some(
              ({ stat_position_type }) => stat_position_type.is_only_display_stat === true,
            ),
          positionTypes: (stat.stat_position_types ?? []).flatMap(({ stat_position_type }) =>
            stat_position_type.position_type === undefined
              ? []
              : [stat_position_type.position_type],
          ),
        })),
        statModifiers: (settings.stat_modifiers?.stats ?? []).map(({ stat }) => ({
          statId: stat.stat_id,
          value: stat.value,
        })),
      },
    };
  });
}

function weekWindowOf(
  league: (typeof LeaguePayload.Type)["league"],
): Effect.Effect<
  { readonly current: number; readonly start: number; readonly end: number } | undefined,
  YahooParseError
> {
  const current = league.current_week;
  const start = league.start_week;
  const end = league.end_week;
  if (current !== undefined && start !== undefined && end !== undefined) {
    return Effect.succeed({ current, start, end });
  }
  if (current === undefined && start === undefined && end === undefined) {
    return Effect.succeed(undefined);
  }
  return Effect.fail(
    new YahooParseError({
      operation: "read_league",
      field:
        current === undefined
          ? "league.current_week"
          : start === undefined
            ? "league.start_week"
            : "league.end_week",
    }),
  );
}

function positiveLimit(limit: number | undefined): number | undefined {
  return limit !== undefined && limit > 0 ? limit : undefined;
}

export type YahooLeagueSettings = {
  readonly leagueKey: string;
  readonly name: string;
  readonly url: string;
  readonly season: number;
  readonly teamCount: number;
  readonly scoringType: string;
  readonly scoringLabel?: string;
  readonly currentWeek?: number;
  readonly startWeek?: number;
  readonly endWeek?: number;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly currentDate?: string;
  readonly weeklyDeadline?: string;
  readonly editKey?: string;
  readonly draftStatus?: string;
  readonly settings: YahooLeagueSettingsValues;
};

export type YahooLeagueSettingsValues = {
  readonly rosterType?: string;
  readonly waiverType?: string;
  readonly waiverRule?: string;
  readonly waiverTime?: number;
  readonly usesFaab?: boolean;
  readonly tradeEndDate?: string;
  readonly tradeRatifyType?: string;
  readonly tradeRejectTime?: number;
  readonly canTradeDraftPicks?: boolean;
  readonly maxWeeklyAdds?: number;
  readonly maxAdds?: number;
  readonly maxGamesPlayed?: number;
  readonly maxInningsPitched?: number;
  readonly rosterPositions: ReadonlyArray<YahooRosterPosition>;
  readonly statCategories: ReadonlyArray<YahooStatCategory>;
  readonly statModifiers: ReadonlyArray<YahooStatModifier>;
};

export type YahooRosterPosition = {
  readonly position: string;
  readonly positionType?: string;
  readonly count: number;
  readonly isStartingPosition: boolean;
};

export type YahooStatCategory = {
  readonly statId: number;
  readonly name: string;
  readonly displayName: string;
  readonly abbreviation: string;
  readonly group: string;
  readonly enabled: boolean;
  readonly displayOnly: boolean;
  readonly positionTypes: ReadonlyArray<string>;
};

export type YahooStatModifier = {
  readonly statId: number;
  readonly value: number;
};

const Season = Schema.Union([Schema.String, Schema.Finite]).pipe(
  Schema.decodeTo(
    Schema.Int.check(Schema.isGreaterThan(1900)),
    SchemaTransformation.transform({
      decode: (value) => (typeof value === "number" ? value : Number(value)),
      encode: (value) => value,
    }),
  ),
);

const LeagueAttributes = Schema.Struct({
  league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
  name: Schema.NonEmptyString,
  url: Schema.String.pipe(Schema.check(Schema.isPattern(/^https:\/\/[^\s]+$/u))),
  num_teams: IntFromStringOrNumber,
  current_week: Schema.optional(IntFromStringOrNumber),
  start_week: Schema.optional(IntFromStringOrNumber),
  end_week: Schema.optional(IntFromStringOrNumber),
  start_date: Schema.optional(Schema.String),
  end_date: Schema.optional(Schema.String),
  current_date: Schema.optional(Schema.String),
  scoring_type: Schema.NonEmptyString,
  scoring_label: Schema.optional(Schema.String),
  weekly_deadline: Schema.optional(Schema.String),
  edit_key: Schema.optional(Schema.Union([Schema.String, Schema.Finite])),
  season: Season,
  draft_status: Schema.optional(Schema.String),
});

const RosterPositionAttributes = Schema.Struct({
  position: Schema.NonEmptyString,
  position_type: Schema.optional(Schema.String),
  count: IntFromStringOrNumber,
  is_starting_position: Flag,
});

const StatPositionTypeAttributes = Schema.Struct({
  stat_position_type: Schema.Struct({
    position_type: Schema.optional(Schema.String),
    is_only_display_stat: Schema.optional(Flag),
  }),
});

const StatCategoryAttributes = Schema.Struct({
  stat_id: IntFromStringOrNumber,
  name: Schema.NonEmptyString,
  display_name: Schema.NonEmptyString,
  group: Schema.NonEmptyString,
  abbr: Schema.NonEmptyString,
  enabled: Flag,
  is_only_display_stat: Schema.optional(Flag),
  stat_position_types: Schema.optional(Schema.Array(StatPositionTypeAttributes)),
});

const StatModifierAttributes = Schema.Struct({
  stat_id: IntFromStringOrNumber,
  value: NumberFromStringOrNumber,
});

const LeagueSettingsAttributes = Schema.Struct({
  can_trade_draft_picks: Schema.optional(Flag),
  max_games_played: Schema.optional(IntFromStringOrNumber),
  max_innings_pitched: Schema.optional(IntFromStringOrNumber),
  max_weekly_adds: Schema.optional(IntFromStringOrNumber),
  max_adds: Schema.optional(IntFromStringOrNumber),
  roster_type: Schema.optional(Schema.String),
  waiver_type: Schema.optional(Schema.String),
  waiver_rule: Schema.optional(Schema.String),
  waiver_time: Schema.optional(IntFromStringOrNumber),
  uses_faab: Schema.optional(Flag),
  trade_end_date: Schema.optional(Schema.String),
  trade_ratify_type: Schema.optional(Schema.String),
  trade_reject_time: Schema.optional(IntFromStringOrNumber),
  roster_positions: Schema.Array(
    Schema.Struct({
      roster_position: RosterPositionAttributes,
    }),
  ),
  stat_categories: Schema.Struct({
    stats: Schema.Array(Schema.Struct({ stat: StatCategoryAttributes })),
  }),
  stat_modifiers: Schema.optional(
    Schema.Struct({
      stats: Schema.Array(Schema.Struct({ stat: StatModifierAttributes })),
    }),
  ),
});

const LeaguePayload = Schema.Struct({
  league: Schema.Struct({
    ...LeagueAttributes.fields,
    settings: Schema.Union([Schema.Array(LeagueSettingsAttributes), LeagueSettingsAttributes]),
  }),
});
