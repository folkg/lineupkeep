import { Effect, Schema } from "effect";

import { IntFromStringOrNumber, decodePayload } from "#yahoo/decode.ts";
import { YahooParseError } from "#yahoo/errors.ts";

export function decodeDashboard(
  payload: unknown,
): Effect.Effect<YahooMobileDashboard, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(DashboardPayload, payload, "read_mobile_dashboard");
    const leagues = Object.values(decoded.my_leagues_and_team_keys).map(leagueOf);
    return {
      leagueKeys: decoded.my_league_keys ?? leagues.map((league) => league.leagueKey),
      leagues: leagues.toSorted((left, right) =>
        left.leagueKey < right.leagueKey ? -1 : left.leagueKey > right.leagueKey ? 1 : 0,
      ),
    };
  });
}

export function decodeLeagueAndTeams(
  payload: unknown,
): Effect.Effect<YahooStatcloudLeagueAndTeams, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(LeagueAndTeamsPayload, payload, "read_statcloud_league");
    const league = Object.values(decoded.league)[0];
    return {
      league: league === undefined ? undefined : leagueOf(league),
      teams: Object.values(decoded.teams).map(statcloudTeamOf),
    };
  });
}

export function decodeMatchups(
  payload: unknown,
): Effect.Effect<YahooStatcloudMatchups, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(MatchupsPayload, payload, "read_statcloud_matchups");
    return {
      matchups: decoded.matchups.map(matchupOf),
      teams: Object.fromEntries(
        Object.entries(decoded.teams ?? {}).map(([key, team]) => [key, statcloudTeamOf(team)]),
      ),
    };
  });
}

export function decodePlayoffs(
  payload: unknown,
): Effect.Effect<YahooStatcloudPlayoffs, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(PlayoffsPayload, payload, "read_statcloud_playoffs");
    return {
      matchups: decoded.matchups.map(matchupOf),
      slots: Object.fromEntries(
        Object.entries(decoded.playoff_matchup_slots ?? {}).map(([key, slot]) => [
          key,
          {
            isChampionshipLevel: slot.is_championship_level,
            displayName: slot.display_name,
            placeMatchup: slot.place_matchup,
            round: slot.round_num,
            previousMatchupSlots: slot.previous_matchup_slots ?? [],
            winnerMatchupSlot: slot.winner_matchup_slot ?? undefined,
          },
        ]),
      ),
    };
  });
}

export function decodeMatchupScores(
  payload: unknown,
): Effect.Effect<YahooStatcloudMatchupScores, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(
      MatchupScoresPayload,
      payload,
      "read_statcloud_matchup_scores",
    );
    return {
      matchups: decoded.matchups.map(matchupOf),
      playerScores: Object.fromEntries(
        Object.entries(decoded.player_scores).map(([teamKey, scores]) => [
          teamKey,
          scores.map((score) => ({
            playerKey: score.player_key,
            teamKey: score.team_key,
            rosterPosition: score.roster_position,
            score: score.score,
            initialProjectedScore: score.initial_projected_score,
            liveProjectedScore: score.live_projected_score,
            minutesRemaining: score.minutes_remaining,
          })),
        ]),
      ),
      teams: Object.fromEntries(
        Object.entries(decoded.teams).map(([key, team]) => [key, statcloudTeamOf(team)]),
      ),
    };
  });
}

function leagueOf(league: typeof LeaguePayload.Type): YahooMobileLeague {
  return {
    leagueKey: league.league_key,
    name: league.league_name,
    teamKeys: league.team_keys ?? [],
    gameCode: league.fantasy_game_code,
    season: league.season,
    week: league.week ?? undefined,
    startWeek: league.start_week,
    endWeek: league.end_week,
    startDate: league.start_date ?? undefined,
    endDate: league.end_date ?? undefined,
    scoringType: league.scoring_config?.scoring_type,
    scoringLabel: league.scoring_config?.scoring_label ?? undefined,
    draftStatus: league.draft_status ?? undefined,
    leagueType: league.league_type ?? undefined,
    usesPlayoffs: league.uses_playoffs ?? undefined,
    playoffStartWeek: league.playoff_start_week ?? undefined,
    isAuction: league.is_auction ?? undefined,
    isBestBall: league.is_best_ball_league ?? undefined,
    isGuillotine: league.is_guillotine ?? undefined,
    usesMedianScore: league.uses_median_score ?? undefined,
    isPrivateChatAvailable: league.is_private_chat_available ?? undefined,
  };
}

function statcloudTeamOf(team: typeof StatcloudTeamPayload.Type): YahooStatcloudTeam {
  return {
    teamKey: team.team_key,
    name: team.team_name,
    url: team.team_url ?? undefined,
    imageUrl: team.image_url ?? undefined,
    managers: (team.managers ?? []).map((manager) => ({
      guid: manager.guid ?? undefined,
      isCommissioner: manager.is_commissioner,
    })),
    waiverPriority: team.waiver_info?.priority,
    faabBalance: team.waiver_info?.faab_balance,
    streak: team.streak ?? undefined,
    moves: team.activity?.number_of_moves,
    trades: team.activity?.number_of_trades,
    divisionId: team.division_id ?? undefined,
    previousSeasonRank: team.previous_season_team_rank ?? undefined,
  };
}

function matchupOf(matchup: typeof MatchupPayload.Type): YahooStatcloudMatchup {
  return {
    week: matchup.week,
    weekStartDate: matchup.week_start_date ?? undefined,
    weekEndDate: matchup.week_end_date ?? undefined,
    status: matchup.status ?? undefined,
    winnerTeamKey: matchup.winner_team_key ?? undefined,
    isMatchupOfTheWeek: matchup.is_matchup_of_the_week ?? undefined,
    teams: matchup.teams.map((team) => ({
      teamKey: team.team_key,
      score: team.score ?? undefined,
      initialProjectedScore: team.initial_projected_score ?? undefined,
      liveProjectedScore: team.live_projected_score ?? undefined,
      winProbability: team.win_probability ?? undefined,
      currentWinPct: team.current_win_pct ?? undefined,
      playersGameState:
        team.players_game_state === undefined
          ? undefined
          : {
              pregame: team.players_game_state.pregame,
              inProgress: team.players_game_state.in_progress,
              final: team.players_game_state.final,
            },
    })),
  };
}

export type YahooMobileDashboard = {
  readonly leagueKeys: ReadonlyArray<string>;
  readonly leagues: ReadonlyArray<YahooMobileLeague>;
};

export type YahooMobileLeague = {
  readonly leagueKey: string;
  readonly name: string;
  readonly teamKeys: ReadonlyArray<string>;
  readonly gameCode: string;
  readonly season: number;
  readonly week?: number;
  readonly startWeek: number;
  readonly endWeek: number;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly scoringType?: string;
  readonly scoringLabel?: string;
  readonly draftStatus?: string;
  readonly leagueType?: string;
  readonly usesPlayoffs?: boolean;
  readonly playoffStartWeek?: number;
  readonly isAuction?: boolean;
  readonly isBestBall?: boolean;
  readonly isGuillotine?: boolean;
  readonly usesMedianScore?: boolean;
  readonly isPrivateChatAvailable?: boolean;
};

export type YahooStatcloudTeam = {
  readonly teamKey: string;
  readonly name: string;
  readonly url?: string;
  readonly imageUrl?: string;
  readonly managers: ReadonlyArray<{ readonly guid?: string; readonly isCommissioner: boolean }>;
  readonly waiverPriority?: number;
  readonly faabBalance?: number;
  readonly streak?: string;
  readonly moves?: number;
  readonly trades?: number;
  readonly divisionId?: number;
  readonly previousSeasonRank?: number;
};

export type YahooStatcloudLeagueAndTeams = {
  readonly league?: YahooMobileLeague;
  readonly teams: ReadonlyArray<YahooStatcloudTeam>;
};

export type YahooStatcloudMatchup = {
  readonly week: number;
  readonly weekStartDate?: string;
  readonly weekEndDate?: string;
  readonly status?: string;
  readonly winnerTeamKey?: string;
  readonly isMatchupOfTheWeek?: boolean;
  readonly teams: ReadonlyArray<{
    readonly teamKey: string;
    readonly score?: string;
    readonly initialProjectedScore?: string;
    readonly liveProjectedScore?: string;
    readonly winProbability?: string;
    readonly currentWinPct?: string;
    readonly playersGameState?: {
      readonly pregame: number;
      readonly inProgress: number;
      readonly final: number;
    };
  }>;
};

export type YahooStatcloudMatchups = {
  readonly matchups: ReadonlyArray<YahooStatcloudMatchup>;
  readonly teams: Readonly<Record<string, YahooStatcloudTeam>>;
};

export type YahooStatcloudPlayoffs = {
  readonly matchups: ReadonlyArray<YahooStatcloudMatchup>;
  readonly slots: Readonly<Record<string, YahooPlayoffSlot>>;
};

export type YahooPlayoffSlot = {
  readonly isChampionshipLevel: boolean;
  readonly displayName: string;
  readonly placeMatchup: number;
  readonly round: number;
  readonly previousMatchupSlots: ReadonlyArray<string>;
  readonly winnerMatchupSlot?: string;
};

export type YahooStatcloudMatchupScores = YahooStatcloudMatchups & {
  readonly playerScores: Readonly<
    Record<
      string,
      ReadonlyArray<{
        readonly playerKey: string;
        readonly teamKey: string;
        readonly rosterPosition: string;
        readonly score: string;
        readonly initialProjectedScore: string;
        readonly liveProjectedScore: string;
        readonly minutesRemaining: number;
      }>
    >
  >;
};

const NullableString = Schema.optional(Schema.NullOr(Schema.String));
const NullableInt = Schema.optional(Schema.NullOr(IntFromStringOrNumber));
const NullableBool = Schema.optional(Schema.NullOr(Schema.Boolean));

const LeaguePayload = Schema.Struct({
  league_key: Schema.String,
  league_name: Schema.String,
  team_keys: Schema.optional(Schema.Array(Schema.String)),
  fantasy_game_code: Schema.String,
  season: IntFromStringOrNumber,
  week: NullableInt,
  start_week: IntFromStringOrNumber,
  end_week: IntFromStringOrNumber,
  start_date: NullableString,
  end_date: NullableString,
  draft_status: NullableString,
  league_type: NullableString,
  uses_playoffs: NullableBool,
  playoff_start_week: NullableInt,
  is_auction: NullableBool,
  is_best_ball_league: NullableBool,
  is_guillotine: NullableBool,
  uses_median_score: NullableBool,
  is_private_chat_available: NullableBool,
  scoring_config: Schema.optional(
    Schema.Struct({ scoring_type: Schema.String, scoring_label: NullableString }),
  ),
});

const DashboardPayload = Schema.Struct({
  my_leagues_and_team_keys: Schema.Record(Schema.String, LeaguePayload),
  my_league_keys: Schema.optional(Schema.Array(Schema.String)),
});

const StatcloudTeamPayload = Schema.Struct({
  team_key: Schema.String,
  team_name: Schema.String,
  team_url: NullableString,
  image_url: NullableString,
  managers: Schema.optional(
    Schema.Array(Schema.Struct({ guid: NullableString, is_commissioner: Schema.Boolean })),
  ),
  waiver_info: Schema.optional(
    Schema.Struct({
      priority: Schema.optional(IntFromStringOrNumber),
      faab_balance: Schema.optional(IntFromStringOrNumber),
    }),
  ),
  streak: NullableString,
  activity: Schema.optional(
    Schema.Struct({
      number_of_moves: Schema.optional(IntFromStringOrNumber),
      number_of_trades: Schema.optional(IntFromStringOrNumber),
    }),
  ),
  division_id: NullableInt,
  previous_season_team_rank: NullableInt,
});

const LeagueAndTeamsPayload = Schema.Struct({
  league: Schema.Record(Schema.String, LeaguePayload),
  teams: Schema.Record(Schema.String, StatcloudTeamPayload),
});

const MatchupTeamPayload = Schema.Struct({
  team_key: Schema.String,
  score: NullableString,
  initial_projected_score: NullableString,
  live_projected_score: NullableString,
  win_probability: NullableString,
  current_win_pct: NullableString,
  players_game_state: Schema.optional(
    Schema.Struct({
      pregame: IntFromStringOrNumber,
      in_progress: IntFromStringOrNumber,
      final: IntFromStringOrNumber,
    }),
  ),
});

const MatchupPayload = Schema.Struct({
  week: IntFromStringOrNumber,
  week_start_date: NullableString,
  week_end_date: NullableString,
  status: NullableString,
  winner_team_key: NullableString,
  is_matchup_of_the_week: NullableBool,
  teams: Schema.Array(MatchupTeamPayload),
});

const MatchupsPayload = Schema.Struct({
  matchups: Schema.Array(MatchupPayload),
  teams: Schema.optional(Schema.Record(Schema.String, StatcloudTeamPayload)),
});

const PlayoffSlotPayload = Schema.Struct({
  is_championship_level: Schema.Boolean,
  display_name: Schema.String,
  place_matchup: IntFromStringOrNumber,
  round_num: IntFromStringOrNumber,
  previous_matchup_slots: Schema.optional(Schema.Array(Schema.String)),
  winner_matchup_slot: NullableString,
});

const PlayoffsPayload = Schema.Struct({
  matchups: Schema.Array(MatchupPayload),
  playoff_matchup_slots: Schema.optional(Schema.Record(Schema.String, PlayoffSlotPayload)),
});

const PlayerScorePayload = Schema.Struct({
  player_key: Schema.String,
  team_key: Schema.String,
  roster_position: Schema.String,
  score: Schema.String,
  initial_projected_score: Schema.String,
  live_projected_score: Schema.String,
  minutes_remaining: IntFromStringOrNumber,
});

const MatchupScoresPayload = Schema.Struct({
  matchups: Schema.Array(MatchupPayload),
  player_scores: Schema.Record(Schema.String, Schema.Array(PlayerScorePayload)),
  teams: Schema.Record(Schema.String, StatcloudTeamPayload),
});
