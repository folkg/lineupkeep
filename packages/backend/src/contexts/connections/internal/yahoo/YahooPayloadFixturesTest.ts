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

function nflLeaguePayload(attributes: Readonly<Record<string, unknown>>): {
  fantasy_content: Record<string, unknown>;
} {
  return {
    fantasy_content: {
      "xml:lang": "en-US",
      "yahoo:uri": "/fantasy/v2/league/466.l.4000/settings",
      copyright: "Data provided by InnoDB",
      refresh_rate: "60",
      league: [attributes, { settings: [nflSettingsFragment], count: 1 }],
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
        edit_key: "42",
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
                    { is_undroppable: "0" },
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
                    { display_position: "WR" },
                    { position_type: "O" },
                    { primary_position: "WR" },
                    { eligible_positions: { "0": { position: "WR" }, count: 1 } },
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
  [],
  { managers: [{ manager: { manager_id: "1", is_current_login: "1" } }] },
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

export const yahooNflTeams = {
  fantasy_content: {
    "xml:lang": "en-US",
    "yahoo:uri": "/fantasy/v2/users;use_login=1/games;game_keys=nfl/teams",
    users: {
      "0": {
        user: [
          { guid: "SYNTHETICGUID" },
          {
            games: {
              "0": {
                game: [
                  [
                    { game_key: "466" },
                    { game_id: "466" },
                    { name: "Football" },
                    { code: "nfl" },
                    { type: "full" },
                    { url: "https://football.fantasysports.yahoo.com/f1" },
                    { season: "2026" },
                    { is_registration_over: 1 },
                    { is_game_over: 0 },
                    { is_offseason: 0 },
                    { is_live_draft_lobby_active: 0 },
                    [],
                  ],
                  {
                    teams: {
                      "0": {
                        team: [nflTeamEntry, []],
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

export const yahooNhlTeams = {
  fantasy_content: {
    "xml:lang": "en-US",
    "yahoo:uri": "/fantasy/v2/users;use_login=1/games;game_keys=nhl/teams",
    users: {
      "0": {
        user: [
          { guid: "SYNTHETICGUID" },
          {
            games: {
              "0": {
                game: [
                  [
                    { game_key: "466" },
                    { game_id: "466" },
                    { name: "Hockey" },
                    { code: "nhl" },
                    { type: "full" },
                    { url: "https://hockey.fantasysports.yahoo.com/hockey" },
                    { season: "2026" },
                    { is_registration_over: 1 },
                    { is_game_over: 0 },
                    { is_offseason: 0 },
                    { is_live_draft_lobby_active: 0 },
                    [],
                  ],
                  {
                    teams: {
                      "0": {
                        team: [nhlTeamEntry, []],
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

export const yahooNflFreeAgents = {
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
                { is_keeper: "0" },
                { uniform_number: "8" },
                { display_position: "WR" },
                { headshot: { image_url: "https://s.yimg.com/synthetic-free-agent.png" } },
                { is_undroppable: "0" },
                { position_type: "O" },
                { primary_position: "WR" },
                { eligible_positions: [{ position: "WR" }, { position: "W/R" }] },
                [],
              ],
              { ownership: [{ ownership_type: "freeagents" }] },
              {
                percent_owned: [
                  { coverage_type: "week", week: "6" },
                  { value: 42.5 },
                  { delta: "3" },
                ],
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
                [],
              ],
              { ownership: [{ ownership_type: "waivers" }] },
            ],
          },
          count: 2,
        },
      },
    ],
  },
};

function nflMatchupTeam(key: string, name: string, total: string, projected: string): unknown[] {
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
        team_projected_points: { coverage_type: "week", week: "7", total: projected },
        team_remaining_games: {
          coverage_type: "week",
          week: "6",
          total: { remaining_games: 1, live_games: 0, completed_games: 1 },
        },
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
                        ),
                      },
                      "1": {
                        team: nflMatchupTeam("466.l.4000.t.2", "Synthetic Rival", "98.5", "104.1"),
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
                  stat_winners: [
                    {
                      stat_winner: {
                        stat_id: "4",
                        winner_team_key: "466.l.4000.t.1",
                      },
                    },
                  ],
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
              [
                { team_key: "466.l.4001.t.1" },
                { team_id: "1" },
                { name: "Foreign Team" },
              ],
              [],
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
