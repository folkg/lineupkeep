const nflLeagueAttributes = {
  league_key: "466.l.4000",
  league_id: "4000",
  name: "Synthetic NFL League",
  url: "https://football.fantasysports.yahoo.com/f1/4000",
  recordbook_url: "https://football.fantasysports.yahoo.com/f1/4000/recordbook",
  logo_url: "https://s.yimg.com/synthetic-nfl.png",
  draft_status: "postdraft",
  num_teams: 12,
  max_teams: "20",
  edit_key: "42",
  weekly_deadline: "",
  roster_type: "head",
  league_update_timestamp: "1790000000",
  scoring_type: "head",
  scoring_label: "H2H",
  league_type: "private",
  renew: "allowed",
  renewed: "",
  felo_tier: "silver",
  is_highscore: true,
  is_guillotine: "0",
  matchup_week: 6,
  iris_group_chat_id: "",
  allow_add_to_dl_extra_pos: 1,
  is_pro_league: "0",
  is_cash_league: "0",
  current_week: 6,
  start_week: "1",
  start_date: "2026-09-03",
  end_week: "17",
  end_date: "2026-12-28",
  is_plus_league: "0",
  game_code: "nfl",
  season: "2026",
};

const nflSettingsFragment = {
  draft_type: "live",
  is_auction_draft: "0",
  scoring_type: "head",
  scoring_label: "H2H",
  custom_scoring_preset_name: "",
  custom_scoring_preset_logo: "",
  is_highscore: true,
  invite_permission: "commissioner",
  uses_playoff: "1",
  has_playoff_consolation_games: false,
  playoff_start_week: "15",
  uses_playoff_reseeding: 0,
  has_multiweek_championship: 1,
  waiver_type: "FR",
  waiver_rule: "continuous",
  uses_faab: "0",
  draft_time: "1790000000",
  draft_pick_time: "90",
  post_draft_players: "W",
  max_teams: "20",
  waiver_time: "1",
  trade_end_date: "2026-11-20",
  trade_ratify_type: "commish",
  trade_reject_time: "2",
  player_pool: "ALL",
  cant_cut_list: "none",
  draft_together: 0,
  sendbird_channel_url: "https://synthetic.invalid/nfl-channel",
  league_premium_features: [],
  pickem_enabled: 0,
  uses_fractional_points: 1,
  uses_negative_points: 1,
  roster_positions: [
    { roster_position: { position: "QB", position_type: "O", count: 1, is_starting_position: 1 } },
    { roster_position: { position: "WR", position_type: "O", count: 2, is_starting_position: 1 } },
    {
      roster_position: { position: "W/R/T", position_type: "O", count: 1, is_starting_position: 1 },
    },
    { roster_position: { position: "BN", position_type: "B", count: 6, is_starting_position: 0 } },
    { roster_position: { position: "IR", position_type: "I", count: 1, is_starting_position: 0 } },
  ],
  stat_categories: {
    groups: [
      { group: { group_name: "passing", group_display_name: "Passing", group_abbr: "PAS" } },
      { group: { group_name: "rushing", group_display_name: "Rushing", group_abbr: "RUS" } },
    ],
    stats: [
      {
        stat: {
          stat_id: 4,
          enabled: "1",
          name: "Passing Yards",
          display_name: "Pass Yds",
          group: "passing",
          abbr: "PY",
          sort_order: "1",
          position_type: "O",
          stat_position_types: [{ stat_position_type: { position_type: "O" } }],
        },
      },
      {
        stat: {
          stat_id: 9,
          enabled: "1",
          name: "Rushing Touchdowns",
          display_name: "Rush TD",
          group: "rushing",
          abbr: "RTD",
          sort_order: "2",
          position_type: "O",
          stat_position_types: [{ stat_position_type: { position_type: "O" } }],
        },
      },
      {
        stat: {
          stat_id: 13,
          enabled: "0",
          name: "Receptions",
          display_name: "Rec",
          group: "receiving",
          abbr: "REC",
          sort_order: "3",
          position_type: "O",
          is_only_display_stat: "1",
          stat_position_types: [
            { stat_position_type: { position_type: "O", is_only_display_stat: "1" } },
          ],
        },
      },
    ],
  },
  stat_modifiers: {
    stats: [
      { stat: { stat_id: 4, value: "0.04" } },
      { stat: { stat_id: 9, value: "6" } },
      { stat: { stat_id: 13, value: "0.5" } },
    ],
    count: 3,
  },
};

function nflLeaguePayload(
  attributes: Readonly<Record<string, unknown>>,
  settings: Readonly<Record<string, unknown>> = nflSettingsFragment,
): {
  fantasy_content: Record<string, unknown>;
} {
  return {
    fantasy_content: {
      "xml:lang": "en-US",
      "yahoo:uri": "/fantasy/v2/league/466.l.4000/settings",
      copyright: "Data provided by InnoDB",
      refresh_rate: "60",
      league: [attributes, { settings: [settings], count: 1 }],
    },
  };
}

export const yahooNflLeagueSettings = nflLeaguePayload(nflLeagueAttributes);

export const yahooNflLeagueSettingsWithoutEndWeek = nflLeaguePayload(
  withoutAttribute(nflLeagueAttributes, "end_week"),
);

export const yahooNflLeagueSettingsWithTextTeamCount = nflLeaguePayload({
  ...nflLeagueAttributes,
  num_teams: "twelve",
});

export const yahooNflLeagueSettingsForAnotherLeague = nflLeaguePayload({
  ...nflLeagueAttributes,
  league_key: "466.l.9999",
});

export const yahooNflLeagueSettingsWithGamesLimit = nflLeaguePayload(nflLeagueAttributes, {
  ...nflSettingsFragment,
  max_games_played: "162",
  max_innings_pitched: "1400",
});

export const yahooNflLeagueSettingsWithPitcherSlot = nflLeaguePayload(nflLeagueAttributes, {
  ...nflSettingsFragment,
  max_games_played: "162",
  max_innings_pitched: "1400",
  roster_positions: [
    ...nflSettingsFragment.roster_positions,
    { roster_position: { position: "P", position_type: "P", count: 1, is_starting_position: 1 } },
  ],
});

export const yahooNflPlayerDetailsWithOwnership = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: {
      league_key: "466.l.4000",
      players: {
        "0": {
          player: [
            [
              { player_key: "466.p.20001" },
              { name: { full: "Synthetic Owned Starter" } },
              {
                percent_started: {
                  coverage_type: "week",
                  week: "6",
                  value: 20,
                  percent_started_cut_types: {
                    "0": { percent_started_cut_type: { cut_type: "platinum", value: 20 } },
                    count: 1,
                  },
                },
              },
              {
                percent_owned: {
                  coverage_type: "week",
                  week: "6",
                  value: 80,
                  delta: "2",
                },
              },
              {
                player_ranks: {
                  "0": { player_rank: { rank_type: "L4W", rank_value: "1" } },
                  "1": { player_rank: { rank_type: "PW", rank_value: "1" } },
                  "2": { player_rank: { rank_type: "PN4W", rank_value: "1" } },
                  count: 4,
                },
              },
            ],
          ],
        },
        "1": {
          player: [
            [
              { player_key: "466.p.20002" },
              { name: { full: "Synthetic Crowd Starter" } },
              {
                percent_started: {
                  coverage_type: "week",
                  week: "6",
                  value: 90,
                  percent_started_cut_types: {
                    "0": { percent_started_cut_type: { cut_type: "platinum", value: 90 } },
                    count: 1,
                  },
                },
              },
              {
                percent_owned: {
                  coverage_type: "week",
                  week: "6",
                  value: 5,
                  delta: "0",
                },
              },
              {
                player_ranks: {
                  "0": { player_rank: { rank_type: "L4W", rank_value: "30" } },
                  count: 1,
                },
              },
            ],
          ],
        },
        count: 2,
      },
    },
  },
};

export const yahooNflGamesPlayed = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: {
      league_key: "466.l.4000",
      teams: {
        "0": {
          team: [
            { team_key: "466.l.4000.t.1" },
            { name: "Synthetic Team" },
            {
              games_played: {
                "0": {
                  games_played_by_position_type: {
                    position_type: "B",
                    games_played: {
                      "0": {
                        games_played_by_position: {
                          position: "QB",
                          games_played: { played: 12, max: 17, projected: 17 },
                        },
                      },
                      count: 1,
                    },
                  },
                },
                "1": {
                  games_played_by_position_type: {
                    position_type: "P",
                    innings_pitched: { pitched: "82.1", max: "1400", projected: "1400.1" },
                  },
                },
                count: 2,
              },
            },
          ],
        },
        count: 1,
      },
    },
  },
};

export const yahooNflLeagueSettingsWith = (
  attributes: Readonly<Record<string, unknown>>,
): { fantasy_content: Record<string, unknown> } =>
  nflLeaguePayload({ ...nflLeagueAttributes, ...attributes });

export const yahooNflLeagueSettingsWithSettings = (
  settings: Readonly<Record<string, unknown>>,
): { fantasy_content: Record<string, unknown> } =>
  nflLeaguePayload(nflLeagueAttributes, { ...nflSettingsFragment, ...settings });

function withoutAttribute<T extends Record<string, unknown>>(
  record: T,
  attribute: keyof T,
): Record<string, unknown> {
  const { [attribute]: _removed, ...rest } = record;
  return rest;
}

export const yahooNhlLeagueSettings = {
  fantasy_content: {
    "xml:lang": "en-US",
    "yahoo:uri": "/fantasy/v2/league/466.l.4001/settings",
    copyright: "Data provided by InnoDB",
    refresh_rate: "60",
    league: [
      {
        league_key: "466.l.4001",
        league_id: "4001",
        name: "Synthetic NHL League",
        url: "https://hockey.fantasysports.yahoo.com/hockey/4001",
        recordbook_url: "https://hockey.fantasysports.yahoo.com/hockey/4001/recordbook",
        logo_url: "https://s.yimg.com/synthetic-nhl.png",
        draft_status: "postdraft",
        num_teams: 10,
        max_teams: "20",
        edit_key: "42",
        weekly_deadline: "game",
        roster_type: "head",
        league_update_timestamp: "1790000000",
        scoring_type: "head",
        scoring_label: "H2H",
        league_type: "private",
        renew: "allowed",
        renewed: "",
        felo_tier: "bronze",
        is_highscore: false,
        is_guillotine: "0",
        matchup_week: 3,
        iris_group_chat_id: "",
        allow_add_to_dl_extra_pos: 1,
        is_pro_league: "0",
        is_cash_league: "0",
        current_week: 3,
        start_week: "1",
        start_date: "2026-10-01",
        end_week: "24",
        end_date: "2027-04-01",
        current_date: "2026-10-25",
        is_plus_league: "0",
        game_code: "nhl",
        season: "2026",
      },
      {
        settings: [
          {
            can_trade_draft_picks: "0",
            cant_cut_list: "none",
            custom_scoring_preset_logo: "",
            custom_scoring_preset_name: "",
            draft_pick_time: "90",
            draft_time: "1790000000",
            draft_together: 0,
            draft_type: "live",
            has_multiweek_championship: 1,
            has_playoff_consolation_games: false,
            invite_permission: "commissioner",
            is_auction_draft: "0",
            is_highscore: false,
            league_premium_features: [],
            max_adds: "20",
            max_teams: "20",
            max_weekly_adds: "2",
            num_playoff_consolation_teams: 0,
            num_playoff_teams: "6",
            player_pool: "ALL",
            playoff_start_week: "22",
            post_draft_players: "W",
            scoring_label: "H2H",
            scoring_type: "head",
            sendbird_channel_url: "https://synthetic.invalid/nhl-channel",
            trade_end_date: "2027-02-20",
            trade_ratify_type: "commish",
            trade_reject_time: "2",
            uses_faab: "0",
            uses_lock_eliminated_teams: 0,
            uses_median_score: false,
            uses_playoff: "1",
            uses_playoff_reseeding: 0,
            waiver_rule: "continuous",
            waiver_time: "1",
            waiver_type: "FR",
            roster_positions: [
              {
                roster_position: {
                  position: "C",
                  position_type: "P",
                  count: 2,
                  is_starting_position: 1,
                },
              },
              {
                roster_position: {
                  position: "LW",
                  position_type: "P",
                  count: 2,
                  is_starting_position: 1,
                },
              },
              {
                roster_position: {
                  position: "G",
                  position_type: "G",
                  count: 2,
                  is_starting_position: 1,
                },
              },
              { roster_position: { position: "BN", count: 4, is_starting_position: 0 } },
              { roster_position: { position: "IR", count: 1, is_starting_position: 0 } },
            ],
            stat_categories: {
              groups: [
                {
                  group: {
                    group_name: "offense",
                    group_display_name: "Offense",
                    group_abbr: "OFF",
                  },
                },
                {
                  group: {
                    group_name: "goaltending",
                    group_display_name: "Goaltending",
                    group_abbr: "GOA",
                  },
                },
              ],
              stats: [
                {
                  stat: {
                    stat_id: 11,
                    enabled: "1",
                    name: "Goals",
                    display_name: "Goals",
                    group: "offense",
                    abbr: "G",
                    sort_order: "1",
                    position_type: "P",
                    stat_position_types: [{ stat_position_type: { position_type: "P" } }],
                  },
                },
                {
                  stat: {
                    stat_id: 12,
                    enabled: "1",
                    name: "Assists",
                    display_name: "Assists",
                    group: "offense",
                    abbr: "A",
                    sort_order: "2",
                    position_type: "P",
                    stat_position_types: [{ stat_position_type: { position_type: "P" } }],
                  },
                },
                {
                  stat: {
                    stat_id: 19,
                    enabled: "1",
                    name: "Power Play Points",
                    display_name: "PP Pts",
                    group: "offense",
                    abbr: "PPP",
                    sort_order: "3",
                    position_type: "P",
                    stat_position_types: [{ stat_position_type: { position_type: "P" } }],
                  },
                },
              ],
            },
          },
          {
            min_games_played: "3",
            week_has_enough_qualifying_days: {
              "1": 1,
              "2": 1,
              "3": 0,
            },
          },
        ],
        count: 2,
      },
    ],
  },
};

export const yahooNhlRotoLeagueSettings = {
  fantasy_content: {
    "xml:lang": "en-US",
    "yahoo:uri": "/fantasy/v2/league/466.l.4002/settings",
    copyright: "Data provided by InnoDB",
    refresh_rate: "60",
    league: [
      {
        league_key: "466.l.4002",
        league_id: "4002",
        name: "Synthetic Roto League",
        url: "https://hockey.fantasysports.yahoo.com/hockey/4002",
        recordbook_url: "https://hockey.fantasysports.yahoo.com/hockey/4002/recordbook",
        logo_url: "https://s.yimg.com/synthetic-roto.png",
        draft_status: "postdraft",
        num_teams: 12,
        max_teams: "20",
        edit_key: "2026-10-25",
        weekly_deadline: "",
        roster_type: "roster",
        league_update_timestamp: "1790000000",
        scoring_type: "roto",
        scoring_label: "Roto",
        league_type: "private",
        renew: "allowed",
        renewed: "",
        felo_tier: null,
        is_highscore: false,
        is_guillotine: "0",
        iris_group_chat_id: "",
        allow_add_to_dl_extra_pos: 1,
        is_pro_league: "0",
        is_cash_league: "0",
        start_date: "2026-10-01",
        end_date: "2027-04-01",
        current_date: "2026-10-25",
        is_plus_league: "0",
        password: "",
        short_invitation_url: "",
        game_code: "nhl",
        season: "2026",
      },
      {
        settings: [
          {
            can_trade_draft_picks: "0",
            cant_cut_list: "none",
            custom_scoring_preset_logo: "",
            custom_scoring_preset_name: "",
            draft_pick_time: "90",
            draft_time: "1790000000",
            draft_together: 0,
            draft_type: "live",
            invite_permission: "commissioner",
            is_auction_draft: "0",
            is_highscore: false,
            is_publicly_viewable: 1,
            league_premium_features: [],
            max_adds: "20",
            max_teams: "20",
            persistent_url: "",
            player_pool: "ALL",
            post_draft_players: "W",
            roster_import_deadline: "",
            scoring_label: "Roto",
            scoring_type: "roto",
            sendbird_channel_url: "https://synthetic.invalid/roto-channel",
            trade_end_date: "2027-02-20",
            trade_ratify_type: "commish",
            trade_reject_time: "2",
            uses_faab: "0",
            uses_median_score: false,
            uses_playoff: "0",
            uses_roster_import: 0,
            waiver_rule: "continuous",
            waiver_time: "1",
            waiver_type: "FR",
            roster_positions: [
              {
                roster_position: {
                  position: "C",
                  position_type: "P",
                  count: 2,
                  is_starting_position: 1,
                },
              },
              {
                roster_position: {
                  position: "LW",
                  position_type: "P",
                  count: 2,
                  is_starting_position: 1,
                },
              },
              {
                roster_position: {
                  position: "D",
                  position_type: "P",
                  count: 4,
                  is_starting_position: 1,
                },
              },
              { roster_position: { position: "BN", count: 4, is_starting_position: 0 } },
              { roster_position: { position: "IR", count: 1, is_starting_position: 0 } },
            ],
            stat_categories: {
              groups: [
                {
                  group: {
                    group_name: "offense",
                    group_display_name: "Offense",
                    group_abbr: "OFF",
                  },
                },
                {
                  group: {
                    group_name: "goaltending",
                    group_display_name: "Goaltending",
                    group_abbr: "GOA",
                  },
                },
              ],
              stats: [
                {
                  stat: {
                    stat_id: 11,
                    enabled: "1",
                    name: "Goals",
                    display_name: "Goals",
                    group: "offense",
                    abbr: "G",
                    sort_order: "1",
                    position_type: "P",
                    stat_position_types: [{ stat_position_type: { position_type: "P" } }],
                  },
                },
                {
                  stat: {
                    stat_id: 12,
                    enabled: "1",
                    name: "Assists",
                    display_name: "Assists",
                    group: "offense",
                    abbr: "A",
                    sort_order: "2",
                    position_type: "P",
                    stat_position_types: [{ stat_position_type: { position_type: "P" } }],
                  },
                },
                {
                  stat: {
                    stat_id: 31,
                    enabled: "1",
                    name: "Shots on Goal",
                    display_name: "Shots",
                    group: "offense",
                    abbr: "SOG",
                    sort_order: "3",
                    position_type: "P",
                    stat_position_types: [
                      { stat_position_type: { position_type: "P", is_only_display_stat: "1" } },
                    ],
                    is_only_display_stat: "1",
                  },
                },
              ],
            },
          },
          [],
        ],
        count: 2,
      },
    ],
  },
};

const nhlLeagueAttributes = yahooNhlLeagueSettings.fantasy_content.league[0];

export function yahooNhlLeagueSettingsWith(attributes: Readonly<Record<string, unknown>>): {
  fantasy_content: Record<string, unknown>;
} {
  return {
    fantasy_content: {
      ...yahooNhlLeagueSettings.fantasy_content,
      "yahoo:uri": `/fantasy/v2/league/${String(attributes["league_key"])}/settings`,
      league: [
        { ...nhlLeagueAttributes, ...attributes },
        yahooNhlLeagueSettings.fantasy_content.league[1],
      ],
    },
  };
}

export const yahooNflRoster = {
  fantasy_content: {
    team: [
      {
        team_key: "466.l.4000.t.1",
        team_id: "1",
        name: "Synthetic Team",
        url: "https://football.fantasysports.yahoo.com/f1/4000/1",
      },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "466.p.20001" },
                    { player_id: "20001" },
                    { name: { full: "Synthetic Starter", first: "Synthetic", last: "Starter" } },
                    { editorial_team_abbr: "SYN" },
                    { editorial_team_full_name: "Synthetic Franchise" },
                    { display_position: "QB" },
                    { position_type: "O" },
                    { primary_position: "QB" },
                    {
                      eligible_positions: {
                        "0": { position: "QB" },
                        "1": { position: "W/R" },
                        count: 2,
                      },
                    },
                    { bye_weeks: { week: "7" } },
                    { opponent: "SEA" },
                    {
                      starting_status: {
                        "0": { coverage_type: "week", week: "6" },
                        "1": { is_starting: 1 },
                        count: 2,
                      },
                    },
                    { is_undroppable: "0" },
                    { transactions: { total: "120", adds: "37", drops: "3", trades: "80" } },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "week", week: "6" },
                      { position: "QB" },
                      { is_flex: 0 },
                    ],
                  },
                  { is_editable: "1" },
                ],
              },
              "1": {
                player: [
                  [
                    { player_key: "466.p.20002" },
                    { player_id: "20002" },
                    { name: { full: "Synthetic Reserve", first: "Synthetic", last: "Reserve" } },
                    { editorial_team_abbr: "SYN" },
                    { display_position: "WR" },
                    { position_type: "O" },
                    { primary_position: "WR" },
                    { eligible_positions: { "0": { position: "WR" }, count: 1 } },
                    { opponent: null },
                    { status: "O" },
                    { status_full: "Out" },
                    { injury_note: "Synthetic injury note" },
                    { is_undroppable: "1" },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "week", week: "6" },
                      { position: "BN" },
                      { is_flex: 0 },
                    ],
                  },
                  { is_editable: "0" },
                ],
              },
              count: 2,
            },
          },
          coverage_type: "week",
          week: 6,
          is_prescoring: 0,
          is_editable: 1,
          bye_week_sponsor: {
            sponsor_name: "Synthetic Sponsor",
            bye_week_copy: "Synthetic bye copy",
            light_theme_image_url_web: "https://s.yimg.com/synthetic-light-web.png",
            dark_theme_image_url_web: "https://s.yimg.com/synthetic-dark-web.png",
            light_theme_image_url_mobile: "https://s.yimg.com/synthetic-light-mobile.png",
            dark_theme_image_url_mobile: "https://s.yimg.com/synthetic-dark-mobile.png",
          },
        },
      },
    ],
  },
};

export const yahooNhlRoster = {
  fantasy_content: {
    team: [
      {
        team_key: "466.l.4002.t.3",
        team_id: "3",
        name: "Synthetic Team",
        url: "https://hockey.fantasysports.yahoo.com/hockey/4002/3",
      },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "466.p.30001" },
                    { player_id: "30001" },
                    { name: { full: "Synthetic Skater", first: "Synthetic", last: "Skater" } },
                    { display_position: "C,LW" },
                    { position_type: "P" },
                    { primary_position: "C" },
                    {
                      eligible_positions: {
                        "0": { position: "C" },
                        "1": { position: "LW" },
                        count: 2,
                      },
                    },
                    { opponent: "TOR" },
                    { is_undroppable: "0" },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "date", date: "2026-10-25" },
                      { position: "C" },
                      { is_flex: 1 },
                    ],
                  },
                  { is_editable: "1" },
                ],
              },
              "1": {
                player: [
                  [
                    { player_key: "466.p.30002" },
                    { player_id: "30002" },
                    { name: { full: "Synthetic Goalie", first: "Synthetic", last: "Goalie" } },
                    { display_position: "G" },
                    { position_type: "G" },
                    { primary_position: "G" },
                    { eligible_positions: { "0": { position: "G" }, count: 1 } },
                    { opponent: null },
                    { is_undroppable: "0" },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "date", date: "2026-10-25" },
                      { position: "BN" },
                      { is_flex: 0 },
                    ],
                  },
                  { is_editable: "1" },
                ],
              },
              count: 2,
            },
          },
          coverage_type: "date",
          date: "2026-10-25",
          is_prescoring: 0,
          is_editable: 1,
          minimum_games: 3,
        },
      },
    ],
  },
};

export const yahooRosterWithOpponentKinds = {
  fantasy_content: {
    team: [
      { team_key: "466.l.4002.t.3" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "466.p.30001" },
                    { name: { full: "Synthetic At Home" } },
                    { display_position: "C" },
                    { primary_position: "C" },
                    { eligible_positions: [{ position: "C" }] },
                    { opponent: "TOR" },
                    {
                      starting_status: {
                        "0": { coverage_type: "date", date: "2026-10-25" },
                        "1": { is_starting: 0 },
                        count: 2,
                      },
                    },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "date", date: "2026-10-25" },
                      { position: "C" },
                    ],
                  },
                ],
              },
              "1": {
                player: [
                  [
                    { player_key: "466.p.30002" },
                    { name: { full: "Synthetic Off Night" } },
                    { display_position: "C" },
                    { primary_position: "C" },
                    { eligible_positions: [{ position: "C" }] },
                    { opponent: null },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "date", date: "2026-10-25" },
                      { position: "C" },
                    ],
                  },
                ],
              },
              "2": {
                player: [
                  [
                    { player_key: "466.p.30003" },
                    { name: { full: "Synthetic On Bye" } },
                    { display_position: "C" },
                    { primary_position: "C" },
                    { eligible_positions: [{ position: "C" }] },
                    { opponent: "Bye" },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "date", date: "2026-10-25" },
                      { position: "BN" },
                    ],
                  },
                ],
              },
              count: 3,
            },
          },
          coverage_type: "date",
          date: "2026-10-25",
        },
      },
    ],
  },
};

export const yahooRosterWithConfirmedStart = {
  fantasy_content: {
    team: [
      { team_key: "466.l.4002.t.3" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "466.p.30001" },
                    { name: { full: "Synthetic Confirmed Goalie" } },
                    { display_position: "G" },
                    { primary_position: "G" },
                    { eligible_positions: [{ position: "G" }] },
                    { opponent: "TOR" },
                    {
                      starting_status: {
                        "0": { coverage_type: "date", date: "2026-10-25" },
                        "1": { is_starting: 1 },
                        count: 2,
                      },
                    },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "date", date: "2026-10-25" },
                      { position: "G" },
                    ],
                  },
                ],
              },
              count: 1,
            },
          },
          coverage_type: "date",
          date: "2026-10-25",
        },
      },
    ],
  },
};

export const yahooRosterWithoutOpponent = {
  fantasy_content: {
    team: [
      { team_key: "466.l.4002.t.3" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "466.p.30001" },
                    { name: { full: "Synthetic At Home" } },
                    { display_position: "C" },
                    { primary_position: "C" },
                    { eligible_positions: [{ position: "C" }] },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "date", date: "2026-10-25" },
                      { position: "C" },
                    ],
                  },
                ],
              },
              count: 1,
            },
          },
          coverage_type: "date",
          date: "2026-10-25",
        },
      },
    ],
  },
};

const playerIdentityFragments = [
  { player_key: "466.p.20001" },
  { player_id: "20001" },
  {
    name: {
      full: "Synthetic Starter",
      first: "Synthetic",
      last: "Starter",
      ascii_first: "Synthetic",
      ascii_last: "Starter",
    },
  },
  { url: "https://sports.yahoo.com/synthetic-player" },
  { editorial_player_key: "466.p.20001" },
  { editorial_team_key: "466.l.5000" },
  { editorial_team_full_name: "Synthetic City" },
  { editorial_team_abbr: "SYN" },
  { editorial_team_url: "https://sports.yahoo.com/synthetic-team" },
  { is_keeper: "0" },
  { uniform_number: "12" },
  { display_position: "QB" },
  { headshot: { image_url: "https://s.yimg.com/synthetic-headshot.png" } },
  { is_undroppable: "0" },
  { position_type: "O" },
  { primary_position: "QB" },
  { eligible_positions: [{ position: "QB" }] },
  { eligible_positions_to_add: [] },
  [],
  { has_player_notes: "0" },
  [],
  { player_notes_last_timestamp: "0" },
];

export const yahooNflWeekPlayerDetails = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        players: {
          "0": {
            player: [
              playerIdentityFragments,
              {
                player_stats: {
                  "0": { coverage_type: "week", week: "6" },
                  stats: [
                    { stat: { stat_id: 4, value: "287" } },
                    { stat: { stat_id: 9, value: 2 } },
                    { stat: { stat_id: 79, value: "-" } },
                  ],
                },
                player_points: {
                  "0": { coverage_type: "week", week: "6" },
                  total: "24.48",
                },
              },
              {
                percent_started: percentStartedFragments({
                  coverage: { coverage_type: "week", week: "6" },
                  value: 38,
                  delta: 10,
                  cuts: [{ cutType: "platinum", value: 0 }],
                }),
              },
              {
                ownership: {
                  "0": {
                    teams: {
                      "0": {
                        team: [
                          [
                            { team_key: "466.l.4000.t.1" },
                            { team_id: "1" },
                            { name: "Synthetic Team" },
                            { is_owned_by_current_login: 1 },
                            { url: "https://football.fantasysports.yahoo.com/f1/4000/1" },
                          ],
                        ],
                      },
                      count: 1,
                    },
                  },
                  ownership_type: "team",
                  owner_team_key: "466.l.4000.t.1",
                  owner_team_name: "Synthetic Team",
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflSeasonPlayerDetails = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        players: {
          "0": {
            player: [
              playerIdentityFragments,
              {
                player_stats: {
                  "0": { coverage_type: "season", season: "2026" },
                  stats: [
                    { stat: { stat_id: 4, value: "1640" } },
                    { stat: { stat_id: 9, value: "11" } },
                    { stat: { stat_id: 79, value: "-" } },
                  ],
                },
                player_advanced_stats: {
                  "0": { coverage_type: "season", season: "2026" },
                  stats: [{ stat: { stat_id: 81, value: "12.5" } }],
                },
                player_points: {
                  "0": { coverage_type: "season", season: "2026" },
                  total: "142.1",
                },
              },
              {
                percent_started: percentStartedFragments({
                  coverage: { coverage_type: "week", week: "6" },
                  value: 38,
                  delta: 10,
                  cuts: [{ cutType: "platinum", value: 0 }],
                }),
              },
              {
                ownership: {
                  ownership_type: "freeagents",
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNhlSeasonPlayerDetails = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4002",
        league_id: "4002",
        name: "Synthetic Roto League",
        url: "https://hockey.fantasysports.yahoo.com/hockey/4002",
      },
      {
        players: {
          "0": {
            player: [
              [
                { player_key: "466.p.30001" },
                { player_id: "30001" },
                {
                  name: {
                    full: "Synthetic Skater",
                    first: "Synthetic",
                    last: "Skater",
                    ascii_first: "Synthetic",
                    ascii_last: "Skater",
                  },
                },
                { url: "https://sports.yahoo.com/synthetic-skater" },
                { editorial_player_key: "466.p.30001" },
                { editorial_team_key: "466.l.5001" },
                { editorial_team_full_name: "Synthetic City" },
                { editorial_team_abbr: "SYN" },
                { editorial_team_url: "https://sports.yahoo.com/synthetic-skater-team" },
                { is_keeper: "0" },
                { uniform_number: "11" },
                { display_position: "C,LW" },
                { headshot: { image_url: "https://s.yimg.com/synthetic-skater.png" } },
                { is_undroppable: "0" },
                { position_type: "P" },
                { primary_position: "C" },
                { eligible_positions: [{ position: "C" }, { position: "LW" }] },
                { eligible_positions_to_add: [] },
                [],
                { has_player_notes: "0" },
                [],
                { player_notes_last_timestamp: "0" },
              ],
              {
                player_stats: {
                  "0": { coverage_type: "season", season: "2026" },
                  stats: [
                    { stat: { stat_id: 11, value: "4" } },
                    { stat: { stat_id: 12, value: "6" } },
                    { stat: { stat_id: 31, value: "23" } },
                  ],
                },
                player_advanced_stats: {
                  "0": { coverage_type: "season", season: "2026" },
                  stats: [{ stat: { stat_id: 35, value: "18:24" } }],
                },
              },
              {
                percent_started: percentStartedFragments({
                  coverage: { coverage_type: "date", date: "2026-10-26" },
                  value: 43,
                  delta: -3,
                  cuts: [{ cutType: "platinum", value: 0 }],
                }),
              },
              {
                ownership: {
                  ownership_type: "waivers",
                  owner_team_key: "466.l.4002.t.3",
                  owner_team_name: "Synthetic Team",
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNhlWeekPlayerDetails = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4002",
        league_id: "4002",
        name: "Synthetic Roto League",
        url: "https://hockey.fantasysports.yahoo.com/hockey/4002",
      },
      {
        players: {
          "0": {
            player: [
              [
                { player_key: "466.p.30001" },
                { player_id: "30001" },
                { name: { full: "Synthetic Skater", first: "Synthetic", last: "Skater" } },
                { display_position: "C,LW" },
                { position_type: "P" },
                { primary_position: "C" },
                { eligible_positions: [{ position: "C" }, { position: "LW" }] },
                { is_undroppable: "0" },
              ],
              {
                percent_started: percentStartedFragments({
                  coverage: { coverage_type: "date", date: "2026-10-26" },
                  value: 43,
                  delta: -3,
                  cuts: [{ cutType: "platinum", value: 0 }],
                }),
              },
              {
                ownership: {
                  ownership_type: "team",
                  owner_team_key: "466.l.4002.t.3",
                  owner_team_name: "Synthetic Team",
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflTransactions = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.tr.1",
                transaction_id: "1",
                type: "add/drop",
                status: "successful",
                timestamp: "1791000000",
              },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "466.p.20003" },
                        { player_id: "20003" },
                        {
                          name: {
                            full: "Synthetic Addition",
                            first: "Synthetic",
                            last: "Addition",
                            ascii_first: "Synthetic",
                            ascii_last: "Addition",
                          },
                        },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "WR" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: [
                          {
                            type: "add",
                            source_type: "freeagents",
                            destination_type: "team",
                            destination_team_key: "466.l.4000.t.1",
                            destination_team_name: "Synthetic Team",
                          },
                        ],
                      },
                    ],
                  },
                  "1": {
                    player: [
                      [
                        { player_key: "466.p.20004" },
                        { player_id: "20004" },
                        {
                          name: {
                            full: "Synthetic Drop",
                            first: "Synthetic",
                            last: "",
                            ascii_first: "Synthetic",
                            ascii_last: "",
                          },
                        },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "RB" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "drop",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.1",
                          source_team_name: "Synthetic Team",
                          destination_type: "waivers",
                        },
                      },
                    ],
                  },
                  count: 2,
                },
              },
            ],
          },
          "1": {
            transaction: [
              {
                transaction_key: "466.l.4000.tr.2",
                transaction_id: "2",
                type: "drop",
                status: "successful",
                timestamp: "1790900000",
              },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "466.p.20005" },
                        { player_id: "20005" },
                        {
                          name: {
                            full: "Synthetic Retired",
                            first: "Synthetic",
                            last: "Retired",
                            ascii_first: "Synthetic",
                            ascii_last: "Retired",
                          },
                        },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "TE" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "drop",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.2",
                          source_team_name: "Synthetic Rival",
                          destination_type: "freeagents",
                        },
                      },
                    ],
                  },
                  count: 1,
                },
              },
            ],
          },
          count: 2,
        },
      },
    ],
  },
};

export const yahooNflTradeTransactions = {
  fantasy_content: {
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.tr.7",
                transaction_id: "7",
                type: "trade",
                status: "successful",
                timestamp: "1791190000",
                trader_team_key: "466.l.4000.t.1",
                trader_team_name: "Synthetic Team",
                tradee_team_key: "466.l.4000.t.2",
                tradee_team_name: "Synthetic Rival",
              },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "466.p.20003" },
                        { player_id: "20003" },
                        { name: { full: "Synthetic Sender", first: "Synthetic", last: "Sender" } },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "WR" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "trade",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.1",
                          source_team_name: "Synthetic Team",
                          destination_type: "team",
                          destination_team_key: "466.l.4000.t.2",
                          destination_team_name: "Synthetic Rival",
                        },
                      },
                    ],
                  },
                  "1": {
                    player: [
                      [
                        { player_key: "466.p.20006" },
                        { player_id: "20006" },
                        { name: { full: "Synthetic Return", first: "Synthetic", last: "Return" } },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "RB" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "trade",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.2",
                          source_team_name: "Synthetic Rival",
                          destination_type: "team",
                          destination_team_key: "466.l.4000.t.1",
                          destination_team_name: "Synthetic Team",
                        },
                      },
                    ],
                  },
                  count: 2,
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflTradeTransactionsWithoutPartyKeys = {
  fantasy_content: {
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.tr.8",
                transaction_id: "8",
                type: "trade",
                status: "successful",
                timestamp: "1791100000",
              },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "466.p.20003" },
                        { player_id: "20003" },
                        { name: { full: "Synthetic Sender", first: "Synthetic", last: "Sender" } },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "WR" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "trade",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.1",
                          source_team_name: "Synthetic Team",
                          destination_type: "team",
                          destination_team_key: "466.l.4000.t.2",
                          destination_team_name: "Synthetic Rival",
                        },
                      },
                    ],
                  },
                  "1": {
                    player: [
                      [
                        { player_key: "466.p.20006" },
                        { player_id: "20006" },
                        { name: { full: "Synthetic Return", first: "Synthetic", last: "Return" } },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "RB" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "trade",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.2",
                          source_team_name: "Synthetic Rival",
                          destination_type: "team",
                          destination_team_key: "466.l.4000.t.1",
                          destination_team_name: "Synthetic Team",
                        },
                      },
                    ],
                  },
                  count: 2,
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflEmptyTradeTransaction = {
  fantasy_content: {
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.tr.9",
                transaction_id: "9",
                type: "trade",
                status: "successful",
                timestamp: "1791000000",
                trader_team_key: "466.l.4000.t.1",
                trader_team_name: "Synthetic Team",
                tradee_team_key: "466.l.4000.t.2",
                tradee_team_name: "Synthetic Rival",
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflSinglePlayerTrade = {
  fantasy_content: {
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.tr.10",
                transaction_id: "10",
                type: "trade",
                status: "successful",
                timestamp: "1791000000",
                trader_team_key: "466.l.4000.t.1",
                trader_team_name: "Synthetic Team",
                tradee_team_key: "466.l.4000.t.2",
                tradee_team_name: "Synthetic Rival",
              },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "466.p.20003" },
                        { player_id: "20003" },
                        { name: { full: "Synthetic Sender", first: "Synthetic", last: "Sender" } },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "WR" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "trade",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.1",
                          source_team_name: "Synthetic Team",
                          destination_type: "team",
                          destination_team_key: "466.l.4000.t.2",
                          destination_team_name: "Synthetic Rival",
                        },
                      },
                    ],
                  },
                  count: 1,
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflTradeWithPicks = {
  fantasy_content: {
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.tr.11",
                transaction_id: "11",
                type: "trade",
                status: "successful",
                timestamp: "1791000000",
                trader_team_key: "466.l.4000.t.1",
                trader_team_name: "Synthetic Team",
                tradee_team_key: "466.l.4000.t.2",
                tradee_team_name: "Synthetic Rival",
              },
              {
                picks: [
                  {
                    pick: {
                      source_team_key: "466.l.4000.t.1",
                      source_team_name: "Synthetic Team",
                      destination_team_key: "466.l.4000.t.2",
                      destination_team_name: "Synthetic Rival",
                      original_team_key: "466.l.4000.t.1",
                      original_team_name: "Synthetic Team",
                      round: "10",
                    },
                  },
                  {
                    pick: {
                      source_team_key: "466.l.4000.t.2",
                      source_team_name: "Synthetic Rival",
                      destination_team_key: "466.l.4000.t.1",
                      destination_team_name: "Synthetic Team",
                      original_team_key: "466.l.4000.t.2",
                      original_team_name: "Synthetic Rival",
                      round: "1",
                    },
                  },
                ],
              },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "466.p.20003" },
                        { player_id: "20003" },
                        { name: { full: "Synthetic Sender", first: "Synthetic", last: "Sender" } },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "WR" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "trade",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.1",
                          source_team_name: "Synthetic Team",
                          destination_type: "team",
                          destination_team_key: "466.l.4000.t.2",
                          destination_team_name: "Synthetic Rival",
                        },
                      },
                    ],
                  },
                  count: 1,
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflPendingTrades = {
  fantasy_content: {
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.pt.7",
                type: "pending_trade",
                status: "proposed",
                trader_team_key: "466.l.4000.t.2",
                trader_team_name: "Synthetic Rival",
                tradee_team_key: "466.l.4000.t.1",
                tradee_team_name: "Synthetic Team",
                trade_proposed_time: "1791000000",
                tradee_unused_roster_spots: "0",
                current_login_can_respond: "1",
                trade_roster_reflect_key: "466.l.4000.tr.1",
                trade_note: "A synthetic offer.",
              },
              {
                picks: [
                  {
                    pick: {
                      source_team_key: "466.l.4000.t.2",
                      source_team_name: "Synthetic Rival",
                      destination_team_key: "466.l.4000.t.1",
                      destination_team_name: "Synthetic Team",
                      original_team_key: "466.l.4000.t.1",
                      original_team_name: "Synthetic Team",
                      round: "3",
                    },
                  },
                ],
              },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "466.p.20003" },
                        { player_id: "20003" },
                        {
                          name: {
                            full: "Synthetic Incoming",
                            first: "Synthetic",
                            last: "Incoming",
                          },
                        },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "WR" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "pending_trade",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.2",
                          source_team_name: "Synthetic Rival",
                          destination_type: "team",
                          destination_team_key: "466.l.4000.t.1",
                          destination_team_name: "Synthetic Team",
                        },
                      },
                    ],
                  },
                  "1": {
                    player: [
                      [
                        { player_key: "466.p.20004" },
                        { player_id: "20004" },
                        {
                          name: {
                            full: "Synthetic Outgoing",
                            first: "Synthetic",
                            last: "Outgoing",
                          },
                        },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "RB" },
                        { position_type: "O" },
                      ],
                      {
                        transaction_data: {
                          type: "pending_trade",
                          source_type: "team",
                          source_team_key: "466.l.4000.t.1",
                          source_team_name: "Synthetic Team",
                          destination_type: "team",
                          destination_team_key: "466.l.4000.t.2",
                          destination_team_name: "Synthetic Rival",
                        },
                      },
                    ],
                  },
                  count: 2,
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflPendingTradeTransaction = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.pt.9",
                type: "pending_trade",
                status: "proposed",
                timestamp: "1791000000",
                trader_team_key: "466.l.4000.t.2",
                trader_team_name: "Synthetic Rival",
                tradee_team_key: "466.l.4000.t.1",
                tradee_team_name: "Synthetic Team",
              },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "466.p.20003" },
                        { name: { full: "Synthetic Incoming" } },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "WR" },
                      ],
                      {
                        transaction_data: {
                          type: "pending_trade",
                          source_team_key: "466.l.4000.t.2",
                          source_team_name: "Synthetic Rival",
                          destination_team_key: "466.l.4000.t.1",
                          destination_team_name: "Synthetic Team",
                        },
                      },
                    ],
                  },
                  "1": {
                    player: [
                      [
                        { player_key: "466.p.20004" },
                        { name: { full: "Synthetic Outgoing" } },
                        { editorial_team_abbr: "SYN" },
                        { display_position: "RB" },
                      ],
                      {
                        transaction_data: {
                          type: "pending_trade",
                          source_team_key: "466.l.4000.t.1",
                          source_team_name: "Synthetic Team",
                          destination_team_key: "466.l.4000.t.2",
                          destination_team_name: "Synthetic Rival",
                        },
                      },
                    ],
                  },
                  count: 2,
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflPickOnlyTrade = {
  fantasy_content: {
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.tr.12",
                transaction_id: "12",
                type: "trade",
                status: "successful",
                timestamp: "1791000000",
                trader_team_key: "466.l.4000.t.1",
                trader_team_name: "Synthetic Team",
                tradee_team_key: "466.l.4000.t.2",
                tradee_team_name: "Synthetic Rival",
              },
              {
                picks: [
                  {
                    pick: {
                      source_team_key: "466.l.4000.t.1",
                      source_team_name: "Synthetic Team",
                      destination_team_key: "466.l.4000.t.2",
                      destination_team_name: "Synthetic Rival",
                      original_team_key: "466.l.4000.t.1",
                      original_team_name: "Synthetic Team",
                      round: "2",
                    },
                  },
                  {
                    pick: {
                      source_team_key: "466.l.4000.t.2",
                      source_team_name: "Synthetic Rival",
                      destination_team_key: "466.l.4000.t.1",
                      destination_team_name: "Synthetic Team",
                      original_team_key: "466.l.4000.t.2",
                      original_team_name: "Synthetic Rival",
                      round: "12",
                    },
                  },
                ],
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflDraftResults = {
  fantasy_content: {
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
        draft_status: "postdraft",
      },
      {
        draft_results: {
          "0": {
            draft_result: {
              "0": {
                players: {
                  "0": {
                    player: [
                      [{ player_key: "466.p.20003" }, { name: { full: "Synthetic Pick One" } }],
                    ],
                  },
                  count: 1,
                },
              },
              pick: "1",
              round: "1",
              team_key: "466.l.4000.t.1",
              player_key: "466.p.20003",
            },
          },
          "1": {
            draft_result: {
              "0": {
                players: {
                  "0": {
                    player: [
                      [{ player_key: "466.p.20006" }, { name: { full: "Synthetic Pick Two" } }],
                    ],
                  },
                  count: 1,
                },
              },
              pick: "2",
              round: "1",
              team_key: "466.l.4000.t.2",
              player_key: "466.p.20006",
            },
          },
          "2": {
            draft_result: {
              pick: "3",
              round: "2",
              team_key: "466.l.4000.t.1",
              player_key: "466.p.20009",
            },
          },
          count: 3,
        },
      },
    ],
  },
};

export const yahooSession = {
  fantasy_content: {
    "xml:lang": "en-US",
    "yahoo:uri": "/fantasy/v2/users;use_login=1",
    users: {
      "0": {
        user: [{ guid: "SYNTHETICGUID" }],
      },
      count: 1,
    },
  },
};

const nflTeamEntry = [
  { team_key: "466.l.4000.t.1" },
  { team_id: "1" },
  { name: "Synthetic NFL Team" },
  { is_owned_by_current_login: 1 },
  { url: "https://football.fantasysports.yahoo.com/f1/4000/1" },
  { team_logos: [{ team_logo: { size: "large", url: "https://s.yimg.com/synthetic-nfl.png" } }] },
  { number_of_moves: "4" },
  { roster_adds: { coverage_type: "week", coverage_value: "8", value: "0" } },
  [],
  { managers: [{ manager: { manager_id: "1", is_current_login: "1" } }] },
  [],
];

const nflSecondTeamEntry = [
  { team_key: "466.l.4000.t.2" },
  { team_id: "2" },
  { name: "Synthetic NFL Team Two" },
  { is_owned_by_current_login: 0 },
  { url: "https://football.fantasysports.yahoo.com/f1/4000/2" },
  [],
  { managers: [{ manager: { manager_id: "2" } }] },
  [],
];

const nhlTeamEntry = [
  { team_key: "466.l.4002.t.3" },
  { team_id: "3" },
  { name: "Synthetic NHL Team" },
  { is_owned_by_current_login: 1 },
  { url: "https://hockey.fantasysports.yahoo.com/hockey/4002/3" },
  { team_logos: [{ team_logo: { size: "large", url: "https://s.yimg.com/synthetic-nhl.png" } }] },
  [],
  { managers: [{ manager: { manager_id: "1", is_current_login: "1" } }] },
  [],
];

const nflTeamEntryWithoutUrl = nflTeamEntry.filter((fragment) => !("url" in fragment));

const nhlDiscoverLeagueSettings = yahooNhlLeagueSettingsWith({
  league_key: "466.l.4002",
  league_id: "4002",
  name: "Synthetic NHL League",
  url: "https://hockey.fantasysports.yahoo.com/hockey/4002",
});

export const yahooDiscoverWithBothLeagues = yahooDiscoverPayload([
  {
    code: "nfl",
    leagues: [{ settings: yahooNflLeagueSettings, teams: [nflTeamEntry] }],
  },
  {
    code: "nhl",
    leagues: [{ settings: nhlDiscoverLeagueSettings, teams: [nhlTeamEntry] }],
  },
]);

export const yahooDiscoverWithTwoFootballTeams = yahooDiscoverPayload([
  {
    code: "nfl",
    leagues: [{ settings: yahooNflLeagueSettings, teams: [nflTeamEntry, nflSecondTeamEntry] }],
  },
  {
    code: "nhl",
    leagues: [{ settings: nhlDiscoverLeagueSettings, teams: [nhlTeamEntry] }],
  },
]);

export const yahooNflDiscoverWithoutTeamUrl = yahooDiscoverPayload([
  {
    code: "nfl",
    leagues: [{ settings: yahooNflLeagueSettings, teams: [nflTeamEntryWithoutUrl] }],
  },
]);

export const yahooNflDiscoverWithMalformedSettings = yahooDiscoverPayload([
  {
    code: "nfl",
    leagues: [
      {
        settings: {
          fantasy_content: {
            league: [nflLeagueAttributes, { settings: [{ roster_positions: "wrong" }] }],
          },
        },
        teams: [nflTeamEntry],
      },
    ],
  },
]);

export const yahooDiscoverWithUnrequestedGame = yahooDiscoverPayload([
  { code: "nba", leagues: [] },
]);

function yahooDiscoverPayload(
  games: ReadonlyArray<{
    readonly code: "nfl" | "nhl" | "nba" | "mlb";
    readonly leagues: ReadonlyArray<{
      readonly settings: { readonly fantasy_content: Record<string, unknown> };
      readonly teams: ReadonlyArray<ReadonlyArray<unknown>>;
    }>;
  }>,
): { fantasy_content: Record<string, unknown> } {
  return {
    fantasy_content: {
      users: {
        "0": {
          user: [
            { guid: "SYNTHETICGUID" },
            {
              games: Object.fromEntries(
                games.map((game, gameIndex) => [
                  String(gameIndex),
                  {
                    game: [
                      [{ game_key: "466" }, { code: game.code }, { season: "2026" }],
                      {
                        leagues: {
                          ...Object.fromEntries(
                            game.leagues.map((league, leagueIndex) => {
                              const { attributes, settings } = leagueFragments(league.settings);
                              return [
                                String(leagueIndex),
                                {
                                  league: [
                                    attributes,
                                    { settings: [settings] },
                                    {
                                      teams: {
                                        ...Object.fromEntries(
                                          league.teams.map((team, teamIndex) => [
                                            String(teamIndex),
                                            { team: [team, []] },
                                          ]),
                                        ),
                                        count: league.teams.length,
                                      },
                                    },
                                  ],
                                },
                              ];
                            }),
                          ),
                          count: game.leagues.length,
                        },
                      },
                    ],
                  },
                ]),
              ),
              count: games.length,
            },
          ],
        },
        count: 1,
      },
    },
  };
}

function leagueFragments(fixture: { readonly fantasy_content: Record<string, unknown> }): {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly settings: Readonly<Record<string, unknown>>;
} {
  const fragments = fixture.fantasy_content["league"];
  const attributes = isReadonlyArray(fragments) ? fragments[0] : undefined;
  const container = isReadonlyArray(fragments) ? fragments[1] : undefined;
  const settings =
    isRecord(container) && isReadonlyArray(container["settings"])
      ? container["settings"][0]
      : undefined;
  if (!isRecord(attributes) || !isRecord(settings)) {
    throw new Error("A league settings fixture must publish league attributes and settings.");
  }
  return { attributes, settings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReadonlyArray(value: unknown): value is ReadonlyArray<unknown> {
  return Array.isArray(value);
}

const nflFreeAgentPlayers = {
  "0": {
    player: [
      [
        { player_key: "466.p.20006" },
        { player_id: "20006" },
        {
          name: {
            full: "Synthetic Free Agent",
            first: "Synthetic",
            last: "Agent",
            ascii_first: "Synthetic",
            ascii_last: "Agent",
          },
        },
        { url: "https://sports.yahoo.com/synthetic-free-agent" },
        { editorial_team_abbr: "SYN" },
        { editorial_team_key: "nfl.t.2" },
        { is_keeper: "0" },
        { uniform_number: "8" },
        { display_position: "WR" },
        { headshot: { image_url: "https://s.yimg.com/synthetic-free-agent.png" } },
        { is_undroppable: "0" },
        { position_type: "O" },
        { primary_position: "WR" },
        { eligible_positions: [{ position: "WR" }, { position: "W/R" }] },
        { status: false },
        [],
      ],
      { ownership: [{ ownership_type: "freeagents" }] },
      {
        percent_owned: [{ coverage_type: "week", week: "6" }, { value: 42.5 }, { delta: "3" }],
      },
      {
        percent_started: [{ coverage_type: "week", week: "6" }, { value: 31.5 }, { delta: -2 }],
      },
      {
        player_ranks: {
          "0": { player_rank: { rank_type: "OR", rank_value: "22" } },
          "1": { player_rank: { rank_type: "S", rank_value: "14", rank_season: "2026" } },
          "2": { player_rank: { rank_type: "S", rank_value: "88", rank_season: "2025" } },
          count: 3,
        },
      },
      {
        player_stats: {
          "0": { coverage_type: "season", season: "2026" },
          stats: [{ stat: { stat_id: 4, value: "1989" } }, { stat: { stat_id: 9, value: "14" } }],
        },
      },
      { transactions: { total: "52", adds: "40", drops: "10", trades: "2" } },
    ],
  },
  "2": {
    player: [
      [
        { player_key: "466.p.20008" },
        { player_id: "20008" },
        {
          name: {
            full: "Synthetic Unstarted",
            first: "Synthetic",
            last: "Unstarted",
            ascii_first: "Synthetic",
            ascii_last: "Unstarted",
          },
        },
        { display_position: "TE" },
        { position_type: "O" },
        { primary_position: "TE" },
        { eligible_positions: [{ position: "TE" }] },
        { status: "PUP-2027" },
        [],
      ],
      { ownership: [{ ownership_type: "freeagents" }] },
      {
        percent_owned: [{ coverage_type: "week", week: "6" }, { value: 0 }, { delta: "0" }],
      },
      {
        player_ranks: {
          "0": { player_rank: { rank_type: "OR", rank_value: "3" } },
          "1": { player_rank: { rank_type: "S", rank_value: "7", rank_season: "2026" } },
          count: 2,
        },
      },
      {
        player_stats: {
          "0": { coverage_type: "season", season: "2026" },
          stats: [{ stat: { stat_id: 4, value: 0 } }],
        },
      },
    ],
  },
  "1": {
    player: [
      [
        { player_key: "466.p.20007" },
        { player_id: "20007" },
        {
          name: {
            full: "Synthetic Waiver",
            first: "Synthetic",
            last: "Waiver",
            ascii_first: "Synthetic",
            ascii_last: "Waiver",
          },
        },
        { display_position: "RB" },
        { position_type: "O" },
        { primary_position: "RB" },
        { eligible_positions: [{ position: "RB" }] },
        { status: "IR-LT" },
        { status_full: "Injured Reserve - Long Term" },
        { injury_note: "Out for the season after surgery." },
        [],
      ],
      { ownership: [{ ownership_type: "waivers" }] },
      {
        player_ranks: {
          "0": { player_rank: { rank_type: "OR", rank_value: "41" } },
          "1": { player_rank: { rank_type: "S", rank_value: "63", rank_season: "2026" } },
          count: 2,
        },
      },
    ],
  },
  count: 3,
};

export const yahooNflAggregateFreeAgents = yahooAggregatePlayerSearch([
  { leagueKey: "466.l.4000", players: nflFreeAgentPlayers },
]);

export function yahooAggregatePlayerSearch(
  leagues: ReadonlyArray<{ readonly leagueKey: string; readonly players: unknown }>,
): { fantasy_content: Record<string, unknown> } {
  return {
    fantasy_content: {
      users: {
        "0": {
          user: [
            { guid: "SYNTHETICGUID" },
            {
              games: {
                "0": {
                  game: [
                    [{ game_key: "466" }, { code: "nfl" }, { season: "2026" }],
                    {
                      leagues: {
                        ...Object.fromEntries(
                          leagues.map(({ leagueKey, players }, index) => [
                            String(index),
                            {
                              league: [{ league_key: leagueKey }, { players }],
                            },
                          ]),
                        ),
                        count: leagues.length,
                      },
                    },
                  ],
                },
                count: 1,
              },
            },
          ],
        },
        count: 1,
      },
    },
  };
}

function nflMatchupTeam(
  key: string,
  name: string,
  total: string,
  projected: string,
  winProbability: number,
): unknown[] {
  return [
    [
      { team_key: key },
      { team_id: key.slice(key.lastIndexOf(".t.") + 3) },
      { name },
      { url: `https://football.fantasysports.yahoo.com/f1/4000/${key.slice(-1)}` },
      { team_logos: [{ team_logo: { size: "large", url: "https://s.yimg.com/synthetic.png" } }] },
      { waiver_priority: 1 },
      { number_of_moves: 1 },
      { number_of_trades: 0 },
      { league_scoring_type: "head" },
      { draft_position: 1 },
      [],
    ],
    [
      {
        team_points: { coverage_type: "week", week: "6", total },
        team_projected_points: { coverage_type: "week", week: "6", total: projected },
        win_probability: winProbability,
      },
    ],
  ];
}

export const yahooNflMatchups = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        scoreboard: {
          "0": {
            matchups: {
              "0": {
                matchup: {
                  "0": {
                    teams: {
                      "0": {
                        team: nflMatchupTeam(
                          "466.l.4000.t.1",
                          "Synthetic NFL Team",
                          "101.25",
                          "109.4",
                          0.62,
                        ),
                      },
                      "1": {
                        team: nflMatchupTeam(
                          "466.l.4000.t.2",
                          "Synthetic Rival",
                          "98.5",
                          "104.1",
                          0.38,
                        ),
                      },
                      count: 2,
                    },
                  },
                  week: "6",
                  week_start: "2026-10-15",
                  week_end: "2026-10-19",
                  status: "postevent",
                  is_playoffs: "0",
                  is_consolation: "0",
                  is_matchup_of_the_week: "0",
                  is_tied: 0,
                },
              },
              count: 1,
            },
          },
          week: "6",
        },
      },
    ],
  },
};

export const yahooNflLeagueTeams = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        teams: {
          "0": {
            team: [nflTeamEntry, []],
          },
          "1": {
            team: [
              [
                { team_key: "466.l.4000.t.2" },
                { team_id: "2" },
                { name: "Synthetic Rival" },
                { is_owned_by_current_login: 0 },
                [],
              ],
              [],
            ],
          },
          count: 2,
        },
      },
    ],
  },
};

export const yahooNflLeagueTeamsWithFaab = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        teams: {
          "0": {
            team: [[...nflTeamEntry, { faab_balance: "42" }], []],
          },
          "1": {
            team: [
              [
                { team_key: "466.l.4000.t.2" },
                { team_id: "2" },
                { name: "Synthetic Rival" },
                { is_owned_by_current_login: 0 },
                [],
              ],
              [],
            ],
          },
          count: 2,
        },
      },
    ],
  },
};

export const yahooNflLeagueTeamsForAnotherLeague = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        teams: {
          "0": {
            team: [
              [{ team_key: "466.l.4001.t.1" }, { team_id: "1" }, { name: "Foreign Team" }],
              [],
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNhlAvailableDraftPicks = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4001",
        league_id: "4001",
        name: "Synthetic NHL League",
        url: "https://hockey.fantasysports.yahoo.com/hockey/4001",
      },
      {
        teams: {
          "0": {
            team: [
              [{ team_key: "466.l.4001.t.1" }, { team_id: "1" }, { name: "Synthetic Team" }],
              {
                available_draft_picks: {
                  picks: [1, 2, 3].map((round) => ({ pick: { round } })),
                },
              },
            ],
          },
          "1": {
            team: [
              [{ team_key: "466.l.4001.t.2" }, { team_id: "2" }, { name: "Synthetic Rival" }],
              {
                available_draft_picks: {
                  picks: [1, 2].map((round) => ({ pick: { round } })),
                },
              },
            ],
          },
          count: 2,
        },
      },
    ],
  },
};

export const yahooNhlAvailableDraftPicksWithoutOneTeam = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4001",
        league_id: "4001",
        name: "Synthetic NHL League",
        url: "https://hockey.fantasysports.yahoo.com/hockey/4001",
      },
      {
        teams: {
          "0": {
            team: [
              [{ team_key: "466.l.4001.t.1" }, { team_id: "1" }, { name: "Synthetic Team" }],
              {
                available_draft_picks: {
                  picks: [{ pick: { round: 1 } }],
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooNflRosterWeekMismatch = {
  fantasy_content: {
    team: [
      {
        team_key: "466.l.4000.t.1",
        team_id: "1",
        name: "Synthetic Team",
      },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "466.p.20001" },
                    { player_id: "20001" },
                    { name: { full: "Synthetic Starter" } },
                    { display_position: "QB" },
                    { position_type: "O" },
                    { primary_position: "QB" },
                    { eligible_positions: [{ position: "QB" }] },
                    { opponent: "SEA" },
                  ],
                  {
                    selected_position: [{ coverage_type: "week", week: "7" }, { position: "QB" }],
                  },
                  { is_editable: "1" },
                ],
              },
              count: 1,
            },
          },
          coverage_type: "week",
          week: 6,
          is_prescoring: 0,
          is_editable: 1,
        },
      },
    ],
  },
};

export const yahooEmptyRoster = {
  fantasy_content: {
    team: [
      {
        team_key: "466.l.4000.t.1",
        team_id: "1",
        name: "Synthetic Team",
      },
      {
        roster: {
          "0": {
            players: {
              count: 0,
            },
          },
          coverage_type: "week",
          week: 6,
          is_prescoring: 0,
          is_editable: 1,
        },
      },
    ],
  },
};

export const yahooRosterFragments = {
  fantasy_content: {
    team: [
      { team_key: "461.l.1000.t.1" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [{ player_key: "461.p.10001" }],
                  {
                    selected_position: [{ coverage_type: "week", week: "3" }, { position: "QB" }],
                  },
                  { is_editable: "1" },
                ],
              },
              count: 1,
            },
          },
          count: 1,
        },
      },
    ],
  },
};

export const yahooRosterWithCoverageMetadata = {
  fantasy_content: {
    team: [
      { team_key: "461.l.1000.t.1" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [{ player_key: "461.p.10001" }],
                  {
                    selected_position: [{ coverage_type: "week", week: "3" }, { position: "QB" }],
                  },
                  { is_editable: "1" },
                ],
              },
              count: 1,
            },
          },
          coverage_type: "week",
          week: "3",
          is_prescoring: 0,
        },
      },
    ],
  },
};

export const yahooLeagueSettingsFragments = {
  fantasy_content: {
    league: [
      { league_key: "465.l.2000" },
      {
        settings: [
          {
            roster_type: "head",
            roster_positions: [
              { roster_position: { position: "C", count: 2, is_starting_position: 1 } },
              { roster_position: { position: "BN", count: 6, is_starting_position: 0 } },
            ],
          },
        ],
      },
    ],
  },
};

export const yahooSingleEntryCollections = {
  fantasy_content: {
    league: [
      { league_key: "465.l.2000" },
      {
        settings: [
          {
            roster_positions: {
              "0": { roster_position: { position: "G", count: 1, is_starting_position: 1 } },
              count: 1,
            },
            stat_categories: {
              stats: {
                "0": {
                  stat: {
                    stat_id: 31,
                    name: "Goals",
                    stat_position_types: [{ stat_position_type: { position_type: "P" } }],
                  },
                },
                count: 1,
              },
            },
          },
        ],
      },
    ],
  },
};

export const yahooNestedTeams = {
  fantasy_content: {
    users: {
      "0": {
        user: [
          { guid: "SYNTHETICGUID" },
          {
            games: {
              "0": {
                game: [
                  { game_key: "461" },
                  { code: "nfl" },
                  { season: "2026" },
                  {
                    teams: {
                      "0": {
                        team: [
                          [
                            { team_key: "461.l.1000.t.1" },
                            { name: "Alpha" },
                            {
                              team_logos: [
                                { team_logo: { size: "large", url: "https://s.yimg.com" } },
                              ],
                            },
                            { managers: [{ manager: { manager_id: "1" } }] },
                            [],
                          ],
                          [],
                        ],
                      },
                      count: 1,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
      count: 1,
    },
  },
};

export const yahooTeamFragments = {
  fantasy_content: {
    users: {
      "0": {
        user: [
          { guid: "SYNTHETICGUID" },
          {
            games: {
              "0": {
                game: [
                  { game_key: "461" },
                  { code: "nfl" },
                  { season: "2026" },
                  {
                    teams: {
                      "0": {
                        team: {
                          team_key: "461.l.1000.t.1",
                          name: "Alpha",
                          is_editable: "0",
                        },
                      },
                      "1": {
                        team: {
                          team_key: "461.l.1000.t.2",
                          name: "Beta",
                        },
                      },
                      count: 2,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
      count: 1,
    },
  },
};

function standingsTeam(key: string, name: string, fragments: ReadonlyArray<unknown>): unknown[] {
  return [
    [
      { team_key: key },
      { team_id: key.slice(key.lastIndexOf(".t.") + 3) },
      { name },
      { url: `https://football.fantasysports.yahoo.com/f1/4000/${key.slice(-1)}` },
      { team_logos: [{ team_logo: { size: "large", url: "https://s.yimg.com/synthetic.png" } }] },
      { waiver_priority: 1 },
      { number_of_moves: 1 },
      { roster_adds: { coverage_type: "week", coverage_value: 6, value: "2" } },
      { number_of_trades: 0 },
      { league_scoring_type: "head" },
      { draft_position: 1 },
      [],
    ],
    ...fragments,
  ];
}

function standingsPayload(
  leagueKey: string,
  leagueName: string,
  teams: ReadonlyArray<unknown>,
): { fantasy_content: Record<string, unknown> } {
  const entries: Record<string, unknown> = {};
  teams.forEach((team, index) => {
    entries[String(index)] = { team };
  });
  entries["count"] = teams.length;
  return {
    fantasy_content: {
      "xml:lang": "en-US",
      league: [
        {
          league_key: leagueKey,
          league_id: leagueKey.slice(leagueKey.indexOf(".l.") + 3),
          name: leagueName,
          url: "https://football.fantasysports.yahoo.com/f1/4000",
          num_teams: 2,
          scoring_type: "head",
          current_week: 6,
          start_week: "1",
          end_week: "17",
          season: "2026",
        },
        {
          standings: {
            "0": { teams: entries },
            count: 1,
          },
        },
      ],
    },
  };
}

export const yahooNflStandings = standingsPayload("466.l.4000", "Synthetic NFL League", [
  standingsTeam("466.l.4000.t.1", "Synthetic NFL Team", [
    {
      team_points: { coverage_type: "season", season: "2026", total: "1583.16" },
    },
    {
      team_standings: {
        rank: "1",
        playoff_seed: "4",
        outcome_totals: { wins: "8", losses: 6, ties: 0, percentage: ".571" },
        streak: { type: "loss", value: "2" },
        points_for: "1583.16",
        points_against: 1447.26,
      },
    },
  ]),
  standingsTeam("466.l.4000.t.2", "Synthetic Rival", [
    {
      team_points: { coverage_type: "season", season: "2026", total: "1494.02" },
    },
    {
      team_standings: {
        rank: "2",
        playoff_seed: "3",
        outcome_totals: { wins: "6", losses: "8", ties: "0", percentage: ".429" },
        streak: { type: "win", value: "1" },
        points_for: "1494.02",
        points_against: 1501.44,
      },
    },
  ]),
]);

export const yahooNflStandingsWithAcquisitionUsage = standingsPayload(
  "466.l.4004",
  "Synthetic Acquisition League",
  [
    [
      [
        { team_key: "466.l.4004.t.1" },
        { team_id: "1" },
        { name: "Synthetic Zero Team" },
        { number_of_moves: "0" },
        { roster_adds: { coverage_type: "week", coverage_value: "9", value: "0" } },
      ],
    ],
    [[{ team_key: "466.l.4004.t.2" }, { team_id: "2" }, { name: "Synthetic Silent Team" }]],
  ],
);

export const yahooNhlCategoryStandings = standingsPayload(
  "466.l.4002",
  "Synthetic NHL Categories",
  [
    standingsTeam("466.l.4002.t.3", "Synthetic NHL Team", [
      {
        team_points: { coverage_type: "season", season: "2026", total: "48" },
      },
      {
        team_standings: {
          rank: "1",
          playoff_seed: "1",
          outcome_totals: { wins: "9", losses: "3", ties: "1", percentage: ".731" },
        },
      },
      {
        team_stats: {
          coverage_type: "season",
          season: "2026",
          stats: {
            "0": { stat: { stat_id: "1", value: "37" } },
            "1": { stat: { stat_id: "2", value: "54" } },
            count: 2,
          },
        },
      },
    ]),
    standingsTeam("466.l.4002.t.4", "Synthetic Rival", [
      {
        team_points: { coverage_type: "season", season: "2026", total: "41" },
      },
      {
        team_standings: {
          rank: "2",
          outcome_totals: { wins: "7", losses: "5", ties: "1", percentage: ".577" },
        },
      },
      {
        team_stats: {
          coverage_type: "season",
          season: "2026",
          stats: {
            "0": { stat: { stat_id: "1", value: "31" } },
            "1": { stat: { stat_id: "2", value: "49" } },
            count: 2,
          },
        },
      },
    ]),
  ],
);

const nhlRotoCategoryIds = [1, 2, 3, 8, 14, 31, 32, 19, 22, 23, 25, 24, 26] as const;
const nhlRotoUnscoredIds = [29, 30] as const;

type RotoTeamFixture = {
  readonly key: string;
  readonly name: string;
  readonly rank: number;
  readonly pointsBack: string;
  readonly pointsFor: string;
  readonly points: Readonly<Record<number, string>>;
  readonly totals: Readonly<Record<number, string>>;
};

function rotoStandingsTeam(team: RotoTeamFixture): unknown[] {
  const entries = (values: Readonly<Record<number, string>>): Record<string, unknown> => {
    const stats: Record<string, unknown> = {};
    [...nhlRotoCategoryIds, ...nhlRotoUnscoredIds].forEach((statId, index) => {
      stats[String(index)] = {
        stat: { stat_id: String(statId), value: values[statId] ?? "" },
      };
    });
    stats["count"] = nhlRotoCategoryIds.length + nhlRotoUnscoredIds.length;
    return stats;
  };
  return standingsTeam(team.key, team.name, [
    {
      team_points: {
        coverage_type: "season",
        season: "2026",
        total: String(
          nhlRotoCategoryIds.reduce((sum, statId) => sum + (Number(team.points[statId]) || 0), 0),
        ),
        stats: entries(team.points),
      },
    },
    {
      team_standings: {
        rank: String(team.rank),
        points_back: team.pointsBack,
        points_change: "1.5",
        points_for: team.pointsFor,
      },
    },
    {
      team_stats: {
        coverage_type: "season",
        season: "2026",
        stats: entries(team.totals),
      },
    },
  ]);
}

export const yahooNhlRotoStandings = standingsPayload("466.l.4003", "Synthetic NHL Roto", [
  rotoStandingsTeam({
    key: "466.l.4003.t.1",
    name: "Synthetic Roto Team",
    rank: 1,
    pointsBack: "0",
    pointsFor: "86.5",
    points: {
      1: "12",
      2: "8.5",
      3: "10",
      8: "11",
      14: "9",
      31: "13",
      32: "6.5",
      19: "4",
      22: "",
      23: "7",
      24: "",
      25: "",
      26: "11",
      29: "162",
      30: "15",
    },
    totals: {
      1: "37",
      2: "54",
      3: "91",
      8: "22",
      14: "120",
      31: "88",
      32: "64",
      19: "5",
      22: "51",
      23: "2.63",
      24: "437",
      25: "386",
      26: "0.883",
      29: "162",
      30: "15",
    },
  }),
  rotoStandingsTeam({
    key: "466.l.4003.t.2",
    name: "Synthetic Roto Rival",
    rank: 2,
    pointsBack: "3.5",
    pointsFor: "83",
    points: {
      1: "9",
      2: "11",
      3: "8",
      8: "7",
      14: "12",
      31: "10",
      32: "9",
      19: "6",
      22: "",
      23: "5",
      24: "",
      25: "",
      26: "9",
      29: "141",
      30: "22",
    },
    totals: {
      1: "29",
      2: "61",
      3: "90",
      8: "18",
      14: "131",
      31: "77",
      32: "70",
      19: "6",
      22: "63",
      23: "3.11",
      24: "498",
      25: "435",
      26: "0.874",
      29: "141",
      30: "22",
    },
  }),
  rotoStandingsTeam({
    key: "466.l.4003.t.3",
    name: "Synthetic Roto Third",
    rank: 3,
    pointsBack: "11",
    pointsFor: "75.5",
    points: {
      1: "6",
      2: "4",
      3: "5",
      8: "3",
      14: "7",
      31: "8",
      32: "4",
      19: "2",
      22: "",
      23: "3",
      24: "",
      25: "",
      26: "4",
      29: "118",
      30: "9",
    },
    totals: {
      1: "21",
      2: "40",
      3: "61",
      8: "11",
      14: "96",
      31: "59",
      32: "44",
      19: "2",
      22: "70",
      23: "3.92",
      24: "705",
      25: "635",
      26: "0.901",
      29: "118",
      30: "9",
    },
  }),
]);

type NhlMatchupStat = { readonly stat_id: string; readonly value: string | null };

const nhlMatchupStats: ReadonlyArray<NhlMatchupStat> = [
  { stat_id: "1", value: "6" },
  { stat_id: "2", value: "9" },
];

function nhlMatchupTeam(
  key: string,
  name: string,
  total: string,
  remaining: { readonly completed: number; readonly live: number; readonly remaining: number },
  stats: ReadonlyArray<NhlMatchupStat> = nhlMatchupStats,
): unknown[] {
  return [
    [
      { team_key: key },
      { team_id: key.slice(key.lastIndexOf(".t.") + 3) },
      { name },
      { url: `https://hockey.fantasysports.yahoo.com/hockey/4002/${key.slice(-1)}` },
      { team_logos: [{ team_logo: { size: "large", url: "https://s.yimg.com/synthetic.png" } }] },
      { waiver_priority: 1 },
      { number_of_moves: 1 },
      { number_of_trades: 0 },
      { league_scoring_type: "head" },
      [],
    ],
    [
      {
        team_points: { coverage_type: "week", week: "4", total },
        team_remaining_games: {
          coverage_type: "week",
          week: "4",
          total: {
            completed_games: remaining.completed,
            live_games: remaining.live,
            remaining_games: remaining.remaining,
          },
        },
        team_stats: {
          coverage_type: "week",
          week: "4",
          stats: {
            ...Object.fromEntries(stats.map((stat, index) => [String(index), { stat }])),
            count: stats.length,
          },
        },
      },
    ],
  ];
}

function nhlMatchupsWithStats(input: {
  readonly home: ReadonlyArray<NhlMatchupStat>;
  readonly away: ReadonlyArray<NhlMatchupStat>;
}): { fantasy_content: Record<string, unknown> } {
  return {
    fantasy_content: {
      "xml:lang": "en-US",
      league: [
        {
          league_key: "466.l.4002",
          league_id: "4002",
          name: "Synthetic NHL Categories",
          url: "https://hockey.fantasysports.yahoo.com/hockey/4002",
          current_week: 4,
          start_week: "1",
          end_week: "24",
          season: "2026",
        },
        {
          scoreboard: {
            week: "4",
            "0": {
              matchups: {
                "0": {
                  matchup: {
                    "0": {
                      teams: {
                        "0": {
                          team: nhlMatchupTeam(
                            "466.l.4002.t.3",
                            "Synthetic NHL Team",
                            "12",
                            { completed: 51, live: 3, remaining: 0 },
                            input.home,
                          ),
                        },
                        "1": {
                          team: nhlMatchupTeam(
                            "466.l.4002.t.4",
                            "Synthetic Rival",
                            "9",
                            { completed: 48, live: 2, remaining: 4 },
                            input.away,
                          ),
                        },
                        count: 2,
                      },
                    },
                    week: "4",
                    week_start: "2026-10-19",
                    week_end: "2026-10-25",
                    status: "midevent",
                    is_playoffs: "1",
                    is_consolation: "0",
                    is_tied: 0,
                    stat_winners: [
                      { stat_winner: { stat_id: "1", winner_team_key: "466.l.4002.t.3" } },
                      { stat_winner: { stat_id: "2", is_tied: "1" } },
                    ],
                  },
                },
                count: 1,
              },
            },
          },
        },
      ],
    },
  };
}

export const yahooNhlMatchupsWithGames = nhlMatchupsWithStats({
  home: nhlMatchupStats,
  away: nhlMatchupStats,
});

export const yahooNhlMatchupsWithMissingStatValue = nhlMatchupsWithStats({
  home: [...nhlMatchupStats, { stat_id: "26", value: null }],
  away: nhlMatchupStats,
});

export const yahooNflPlayerDetailsWithPopulatedCut = playerDetailsPayload({
  leagueKey: "466.l.4000",
  leagueName: "Synthetic NFL League",
  playerKeys: ["466.p.20001", "466.p.20002"],
  players: [
    {
      displayPosition: "QB",
      primaryPosition: "QB",
      eligiblePositions: ["QB"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "week", week: "6" },
        value: 38,
        delta: 10,
        cuts: [{ cutType: "platinum", value: 41 }],
      }),
    },
    {
      displayPosition: "WR",
      primaryPosition: "WR",
      eligiblePositions: ["WR"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "week", week: "6" },
        value: 72,
        delta: -4,
        cuts: [{ cutType: "platinum", value: 65 }],
      }),
    },
  ],
});

export const yahooNflPlayerWeeks = {
  fantasy_content: {
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
      },
      {
        players: {
          "0": {
            player: [
              [
                { player_key: "466.p.20001" },
                { opponent: "@SEA" },
                {
                  player_ranks: {
                    "0": {
                      player_rank: {
                        rank_type: "PW",
                        rank_value: "3",
                        rank_week: "6",
                      },
                    },
                    count: 1,
                  },
                },
              ],
            ],
          },
          "1": {
            player: [
              [
                { player_key: "466.p.20002" },
                { opponent: null },
                {
                  player_ranks: {
                    "0": {
                      player_rank: {
                        rank_type: "PW",
                        rank_value: "8",
                        rank_week: "6",
                      },
                    },
                    count: 1,
                  },
                },
              ],
            ],
          },
          "2": {
            player: [
              [
                { player_key: "466.p.20003" },
                { opponent: "BUF" },
                {
                  player_ranks: {
                    "0": {
                      player_rank: {
                        rank_type: "PW",
                        rank_value: "14",
                        rank_week: "5",
                      },
                    },
                    count: 1,
                  },
                },
              ],
            ],
          },
          count: 3,
        },
      },
    ],
  },
};

export const yahooNflPlayerDetailsWithProjectedWeekRanks = playerDetailsPayload({
  leagueKey: "466.l.4000",
  leagueName: "Synthetic NFL League",
  playerKeys: ["466.p.20001", "466.p.20002"],
  players: [
    {
      displayPosition: "QB",
      primaryPosition: "QB",
      eligiblePositions: ["QB"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "week", week: "6" },
        value: 38,
        cuts: [{ cutType: "platinum", value: 41 }],
      }),
      ranks: [
        { type: "L4W", rank: "3" },
        { type: "PW", rank: "3", week: "6" },
        { type: "PN4W", rank: "5" },
      ],
    },
    {
      displayPosition: "WR",
      primaryPosition: "WR",
      eligiblePositions: ["WR"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "week", week: "6" },
        value: 72,
        cuts: [{ cutType: "platinum", value: 65 }],
      }),
      ranks: [
        { type: "L4W", rank: "12" },
        { type: "PW", rank: "8", week: "6" },
        { type: "PN4W", rank: "9" },
      ],
    },
  ],
});

export const yahooNflPlayerDetailsWithDefaultRanks = playerDetailsPayload({
  leagueKey: "466.l.4000",
  leagueName: "Synthetic NFL League",
  playerKeys: ["466.p.20001", "466.p.20002"],
  players: [
    {
      displayPosition: "QB",
      primaryPosition: "QB",
      eligiblePositions: ["QB"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "week", week: "6" },
        value: 38,
        cuts: [{ cutType: "platinum", value: 41 }],
      }),
      ranks: [{ type: "OR", rank: "22" }],
    },
    {
      displayPosition: "WR",
      primaryPosition: "WR",
      eligiblePositions: ["WR"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "week", week: "6" },
        value: 72,
        cuts: [{ cutType: "platinum", value: 65 }],
      }),
      ranks: [{ type: "OR", rank: "41" }],
    },
  ],
});

export const yahooNflPlayerDetailsWithUnpopulatedCut = playerDetailsPayload({
  leagueKey: "466.l.4000",
  leagueName: "Synthetic NFL League",
  playerKeys: ["466.p.20001", "466.p.20002"],
  players: [
    {
      displayPosition: "QB",
      primaryPosition: "QB",
      eligiblePositions: ["QB"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "week", week: "6" },
        value: 38,
        cuts: [{ cutType: "platinum", value: 0 }],
      }),
    },
    {
      displayPosition: "WR",
      primaryPosition: "WR",
      eligiblePositions: ["WR"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "week", week: "6" },
        value: 72,
        cuts: [{ cutType: "platinum", value: 0 }],
      }),
    },
  ],
});

export const yahooNhlPlayerDetailsWithoutStartedPercentage = playerDetailsPayload({
  leagueKey: "466.l.4002",
  leagueName: "Synthetic Roto League",
  playerKeys: ["466.p.30001"],
  players: [
    {
      displayPosition: "C,LW",
      primaryPosition: "C",
      eligiblePositions: ["C", "LW"],
      percentStarted: undefined,
    },
  ],
});

export const yahooNhlPlayerDetailsWithMissingStartedValue = playerDetailsPayload({
  leagueKey: "466.l.4002",
  leagueName: "Synthetic Roto League",
  playerKeys: ["466.p.30001", "466.p.30002"],
  players: [
    {
      displayPosition: "G",
      primaryPosition: "G",
      eligiblePositions: ["G", "IR+"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "date", date: "2026-10-26" },
        cuts: [{ cutType: "platinum", value: undefined }],
      }),
    },
    {
      displayPosition: "C",
      primaryPosition: "C",
      eligiblePositions: ["C"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "date", date: "2026-10-26" },
        value: 43,
        delta: -3,
        cuts: [{ cutType: "platinum", value: 0 }],
      }),
    },
  ],
});

export const yahooNhlPlayerDetailsWithUnparseableStartedValue = playerDetailsPayload({
  leagueKey: "466.l.4002",
  leagueName: "Synthetic Roto League",
  playerKeys: ["466.p.30001"],
  players: [
    {
      displayPosition: "C,LW",
      primaryPosition: "C",
      eligiblePositions: ["C", "LW"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "date", date: "2026-10-26" },
        value: "n/a",
        cuts: [{ cutType: "platinum", value: 0 }],
      }),
    },
  ],
});

export const yahooNflPlayerDetailsWithMismatchedStartedCoverage = playerDetailsPayload({
  leagueKey: "466.l.4000",
  leagueName: "Synthetic NFL League",
  playerKeys: ["466.p.20001"],
  players: [
    {
      displayPosition: "QB",
      primaryPosition: "QB",
      eligiblePositions: ["QB"],
      percentStarted: percentStartedFragments({
        coverage: { coverage_type: "week", week: "5" },
        value: 38,
        cuts: [{ cutType: "platinum", value: 0 }],
      }),
    },
  ],
});

function playerRanksPayload(
  ranks: ReadonlyArray<{ readonly type: string; readonly rank: string; readonly week?: string }>,
): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  ranks.forEach((rank, index) => {
    entries[String(index)] = {
      player_rank: {
        rank_type: rank.type,
        rank_value: rank.rank,
        ...(rank.week === undefined ? {} : { rank_week: rank.week }),
      },
    };
  });
  entries["count"] = ranks.length;
  return entries;
}

function percentStartedFragments(input: {
  readonly coverage: Readonly<Record<string, string>>;
  readonly value?: number | string;
  readonly delta?: number | string;
  readonly cuts?: ReadonlyArray<{ readonly cutType: string; readonly value?: number | string }>;
}): ReadonlyArray<unknown> {
  const fragments: Array<unknown> = [input.coverage];
  if (input.value !== undefined) {
    fragments.push({ value: input.value });
  }
  if (input.delta !== undefined) {
    fragments.push({ delta: input.delta });
  }
  if (input.cuts !== undefined && input.cuts.length > 0) {
    fragments.push({
      percent_started_cut_types: input.cuts.map((cut) => ({
        percent_started_cut_type: [
          input.coverage,
          { cut_type: cut.cutType },
          ...(cut.value === undefined ? [] : [{ value: cut.value }]),
        ],
      })),
    });
  }
  return fragments;
}

function playerDetailsPayload(input: {
  readonly leagueKey: string;
  readonly leagueName: string;
  readonly playerKeys: ReadonlyArray<string>;
  readonly players: ReadonlyArray<{
    readonly displayPosition: string;
    readonly primaryPosition: string;
    readonly eligiblePositions: ReadonlyArray<string>;
    readonly percentStarted: ReadonlyArray<unknown> | undefined;
    readonly ranks?: ReadonlyArray<{
      readonly type: string;
      readonly rank: string;
      readonly week?: string;
    }>;
  }>;
}): { fantasy_content: Record<string, unknown> } {
  const entries: Record<string, unknown> = {};
  input.players.forEach((player, index) => {
    const playerKey = input.playerKeys[index] ?? `466.p.9${String(index)}`;
    entries[String(index)] = {
      player: [
        [
          { player_key: playerKey },
          { player_id: playerKey.slice(playerKey.lastIndexOf(".p.") + 3) },
          {
            name: {
              full: `Synthetic Player ${String(index + 1)}`,
              first: "Synthetic",
              last: `Player ${String(index + 1)}`,
            },
          },
          { display_position: player.displayPosition },
          { position_type: "O" },
          { primary_position: player.primaryPosition },
          {
            eligible_positions: player.eligiblePositions.map((position) => ({ position })),
          },
        ],
        ...(player.percentStarted === undefined
          ? []
          : [{ percent_started: player.percentStarted }]),
        ...(player.ranks === undefined ? [] : [{ player_ranks: playerRanksPayload(player.ranks) }]),
        {
          ownership: { ownership_type: "team" },
        },
      ],
    };
  });
  entries["count"] = input.players.length;
  return {
    fantasy_content: {
      "xml:lang": "en-US",
      league: [
        {
          league_key: input.leagueKey,
          league_id: input.leagueKey.slice(input.leagueKey.indexOf(".l.") + 3),
          name: input.leagueName,
        },
        { players: entries },
      ],
    },
  };
}

export function yahooNhlDatePlayerDetails(
  date: string,
  players: ReadonlyArray<{
    readonly playerKey: string;
    readonly name: string;
    readonly stats: ReadonlyArray<{ readonly statId: number; readonly value: string }>;
  }>,
): { fantasy_content: Record<string, unknown> } {
  const entries: Record<string, unknown> = {};
  players.forEach((player, index) => {
    entries[String(index)] = {
      player: [
        [
          { player_key: player.playerKey },
          { player_id: player.playerKey.slice(player.playerKey.lastIndexOf(".p.") + 3) },
          { name: { full: player.name, first: "Synthetic", last: player.name } },
          { display_position: "C,LW" },
          { position_type: "P" },
          { primary_position: "C" },
          { eligible_positions: [{ position: "C" }, { position: "LW" }] },
        ],
        {
          player_stats: {
            "0": { coverage_type: "date", date },
            stats: player.stats.map(({ statId, value }) => ({ stat: { stat_id: statId, value } })),
          },
        },
        { ownership: { ownership_type: "waivers" } },
      ],
    };
  });
  entries["count"] = players.length;
  return {
    fantasy_content: {
      "xml:lang": "en-US",
      league: [
        {
          league_key: "466.l.4002",
          league_id: "4002",
          name: "Synthetic Roto League",
          url: "https://hockey.fantasysports.yahoo.com/hockey/4002",
        },
        { players: entries },
      ],
    },
  };
}

export function yahooNhlDatedRoster(input: {
  readonly date: string;
  readonly teamKey?: string;
  readonly players: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly proTeam: string;
    readonly proTeamKey?: string;
    readonly opponent: string | null;
    readonly slot?: string;
  }>;
}): { fantasy_content: Record<string, unknown> } {
  const entries = Object.fromEntries(
    input.players.map((player, index) => [
      String(index),
      {
        player: [
          [
            { player_key: player.key },
            { name: { full: player.name, first: "Synthetic", last: "Player" } },
            ...(player.proTeamKey === undefined ? [] : [{ editorial_team_key: player.proTeamKey }]),
            { editorial_team_abbr: player.proTeam },
            { display_position: "C" },
            { position_type: "P" },
            { primary_position: "C" },
            { eligible_positions: { "0": { position: "C" }, count: 1 } },
            { opponent: player.opponent },
            { is_undroppable: "0" },
          ],
          {
            selected_position: [
              { coverage_type: "date", date: input.date },
              { position: player.slot ?? "C" },
            ],
          },
          { is_editable: "1" },
        ],
      },
    ]),
  );
  return {
    fantasy_content: {
      team: [
        { team_key: input.teamKey ?? "466.l.4002.t.3" },
        {
          roster: {
            "0": { players: { ...entries, count: input.players.length } },
            count: 1,
            coverage_type: "week",
            date: input.date,
            is_prescoring: 0,
          },
        },
      ],
    },
  };
}

export const yahooNflLeagueRosters = {
  fantasy_content: {
    "xml:lang": "en-US",
    league: [
      {
        league_key: "466.l.4000",
        league_id: "4000",
        name: "Synthetic NFL League",
        url: "https://football.fantasysports.yahoo.com/f1/4000",
      },
      {
        teams: {
          "0": {
            team: [
              [
                { team_key: "466.l.4000.t.1" },
                { team_id: "1" },
                { name: "Synthetic Team" },
                { is_owned_by_current_login: 1 },
              ],
              {
                roster: {
                  "0": {
                    players: {
                      "0": {
                        player: [
                          [
                            { player_key: "466.p.20001" },
                            { player_id: "20001" },
                            {
                              name: {
                                full: "Synthetic Starter",
                                first: "Synthetic",
                                last: "Starter",
                              },
                            },
                            { editorial_team_abbr: "SYN" },
                            { display_position: "QB" },
                            { position_type: "O" },
                            { primary_position: "QB" },
                            { eligible_positions: [{ position: "QB" }, { position: "W/R" }] },
                            { bye_weeks: { week: "7" } },
                            { is_undroppable: "0" },
                          ],
                          {
                            selected_position: [
                              { coverage_type: "week", week: "6" },
                              { position: "QB" },
                              { is_flex: 0 },
                            ],
                          },
                        ],
                      },
                      "1": {
                        player: [
                          [
                            { player_key: "466.p.20002" },
                            { player_id: "20002" },
                            {
                              name: {
                                full: "Synthetic Reserve",
                                first: "Synthetic",
                                last: "Reserve",
                              },
                            },
                            { editorial_team_abbr: "SYN" },
                            { display_position: "WR" },
                            { position_type: "O" },
                            { primary_position: "WR" },
                            { eligible_positions: [{ position: "WR" }] },
                            { status: "O" },
                            { status_full: "Out" },
                            { injury_note: "Synthetic injury note" },
                            { is_undroppable: "1" },
                          ],
                          {
                            selected_position: [
                              { coverage_type: "week", week: "6" },
                              { position: "BN" },
                              { is_flex: 0 },
                            ],
                          },
                        ],
                      },
                      count: 2,
                    },
                  },
                  coverage_type: "week",
                  week: "6",
                },
              },
            ],
          },
          "1": {
            team: [
              [
                { team_key: "466.l.4000.t.2" },
                { team_id: "2" },
                { name: "Synthetic Rival" },
                { is_owned_by_current_login: 0 },
              ],
              {
                roster: {
                  "0": {
                    players: {
                      "0": {
                        player: [
                          [
                            { player_key: "466.p.20003" },
                            { player_id: "20003" },
                            {
                              name: {
                                full: "Synthetic Rival Player",
                                first: "Synthetic",
                                last: "Rival",
                              },
                            },
                            { editorial_team_abbr: "SYN" },
                            { display_position: "RB" },
                            { position_type: "O" },
                            { primary_position: "RB" },
                            { eligible_positions: [{ position: "RB" }] },
                            { is_undroppable: "0" },
                          ],
                          {
                            selected_position: [
                              { coverage_type: "week", week: "6" },
                              { position: "RB" },
                              { is_flex: 0 },
                            ],
                          },
                        ],
                      },
                      count: 1,
                    },
                  },
                  coverage_type: "week",
                  week: "6",
                },
              },
            ],
          },
          count: 2,
        },
      },
    ],
  },
};

export const yahooNflLeagueRostersForAnotherLeague = {
  fantasy_content: {
    league: [
      { league_key: "466.l.4000" },
      {
        teams: {
          "0": {
            team: [
              [{ team_key: "467.l.4000.t.1" }, { name: "Synthetic Other League Team" }],
              {
                roster: {
                  "0": {
                    players: {
                      "0": {
                        player: [
                          [
                            { player_key: "466.p.20001" },
                            { name: { full: "Synthetic Starter" } },
                            { display_position: "QB" },
                            { primary_position: "QB" },
                          ],
                          {
                            selected_position: [
                              { coverage_type: "week", week: "6" },
                              { position: "QB" },
                            ],
                          },
                        ],
                      },
                      count: 1,
                    },
                  },
                  coverage_type: "week",
                  week: "6",
                },
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};
