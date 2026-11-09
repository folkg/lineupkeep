export const sessionPayload = {
  fantasy_content: {
    users: {
      "0": { user: [{ guid: "SYNTHETICGUID" }] },
      count: 1,
    },
  },
};

const leagueAttributes = {
  league_key: "466.l.4000",
  league_id: "4000",
  name: "Synthetic NFL League",
  url: "https://football.fantasysports.yahoo.com/f1/4000",
  num_teams: 12,
  current_week: 6,
  start_week: "1",
  end_week: "17",
  start_date: "2026-09-03",
  end_date: "2026-12-28",
  current_date: "2026-10-17",
  weekly_deadline: "game",
  edit_key: "42",
  scoring_type: "head",
  scoring_label: "H2H",
  season: "2026",
  draft_status: "postdraft",
};

const leagueSettings = {
  roster_type: "head",
  waiver_type: "FR",
  waiver_rule: "continuous",
  waiver_time: "1",
  uses_faab: "0",
  trade_end_date: "2026-11-20",
  trade_ratify_type: "commish",
  trade_reject_time: "2",
  can_trade_draft_picks: "1",
  max_weekly_adds: "3",
  max_adds: "40",
  roster_positions: [
    { roster_position: { position: "QB", position_type: "O", count: 1, is_starting_position: 1 } },
    { roster_position: { position: "WR", position_type: "O", count: 2, is_starting_position: 1 } },
    { roster_position: { position: "BN", position_type: "B", count: 6, is_starting_position: 0 } },
    { roster_position: { position: "IR", position_type: "I", count: 1, is_starting_position: 0 } },
  ],
  stat_categories: {
    stats: [
      {
        stat: {
          stat_id: 4,
          enabled: "1",
          name: "Passing Yards",
          display_name: "Pass Yds",
          group: "passing",
          abbr: "PY",
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
          is_only_display_stat: "1",
          stat_position_types: [
            { stat_position_type: { position_type: "O", is_only_display_stat: "1" } },
          ],
        },
      },
    ],
  },
  stat_modifiers: {
    stats: [{ stat: { stat_id: 4, value: "0.04" } }, { stat: { stat_id: 9, value: 6 } }],
  },
};

function leaguePayload(
  attributes: Readonly<Record<string, unknown>>,
  settings: Readonly<Record<string, unknown>>,
): { fantasy_content: Record<string, unknown> } {
  return {
    fantasy_content: {
      league: [attributes, { settings: [settings], count: 1 }],
    },
  };
}

export const leagueSettingsPayload = leaguePayload(leagueAttributes, leagueSettings);

export const leagueSettingsWithZeroLimits = leaguePayload(leagueAttributes, {
  ...leagueSettings,
  max_weekly_adds: "0",
  max_adds: "0",
  max_games_played: "0",
  max_innings_pitched: "0",
});

export const pendingTradeAsTransactionPayload = {
  fantasy_content: {
    league: [
      leagueAttributes,
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.pt.7",
                type: "pending_trade",
                status: "proposed",
                timestamp: "1791000000",
                trader_team_key: "466.l.4000.t.2",
                trader_team_name: "Synthetic Rival",
                tradee_team_key: "466.l.4000.t.1",
                tradee_team_name: "Synthetic Team",
              },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const leagueSettingsWithPartialWeekWindow = leaguePayload(
  { ...leagueAttributes, end_week: undefined },
  leagueSettings,
);

function playerFragments(input: {
  readonly key: string;
  readonly name: string;
  readonly displayPosition: string;
  readonly primaryPosition: string;
  readonly eligiblePositions: ReadonlyArray<string>;
  readonly proTeam?: string;
  readonly status?: string;
  readonly statusFull?: string;
  readonly injuryNote?: string;
  readonly byeWeek?: string;
  readonly undroppable?: string;
}): ReadonlyArray<unknown> {
  return [
    { player_key: input.key },
    { player_id: input.key.split(".").at(-1) },
    { name: { full: input.name } },
    ...(input.proTeam === undefined ? [] : [{ editorial_team_abbr: input.proTeam }]),
    { display_position: input.displayPosition },
    { position_type: "O" },
    { primary_position: input.primaryPosition },
    { eligible_positions: input.eligiblePositions.map((position) => ({ position })) },
    ...(input.status === undefined ? [] : [{ status: input.status }]),
    ...(input.statusFull === undefined ? [] : [{ status_full: input.statusFull }]),
    ...(input.injuryNote === undefined ? [] : [{ injury_note: input.injuryNote }]),
    ...(input.byeWeek === undefined ? [] : [{ bye_weeks: { week: input.byeWeek } }]),
    ...(input.undroppable === undefined ? [] : [{ is_undroppable: input.undroppable }]),
  ];
}

export const rosterPayload = {
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
                  ...playerFragments({
                    key: "466.p.20001",
                    name: "Synthetic Starter",
                    displayPosition: "QB",
                    primaryPosition: "QB",
                    eligiblePositions: ["QB"],
                    proTeam: "SYN",
                    byeWeek: "7",
                    undroppable: "0",
                  }),
                  {
                    selected_position: [
                      { coverage_type: "week", week: "6" },
                      { position: "QB" },
                      { is_flex: 0 },
                    ],
                  },
                  {
                    starting_status: {
                      "0": { coverage_type: "week", week: "6" },
                      "1": { is_starting: 1 },
                      count: 2,
                    },
                  },
                  { opponent: "SEA" },
                  { transactions: { total: "120", adds: "37", drops: "3", trades: "80" } },
                  { is_editable: "1" },
                ],
              },
              "1": {
                player: [
                  ...playerFragments({
                    key: "466.p.20002",
                    name: "Synthetic Reserve",
                    displayPosition: "WR",
                    primaryPosition: "WR",
                    eligiblePositions: ["WR", "W/R"],
                    proTeam: "SYN",
                    status: "O",
                    statusFull: "Out",
                    injuryNote: "Synthetic injury note",
                    undroppable: "1",
                  }),
                  {
                    selected_position: [
                      { coverage_type: "week", week: "6" },
                      { position: "BN" },
                      { is_flex: 0 },
                    ],
                  },
                  { opponent: null },
                  { is_editable: "0" },
                ],
              },
              "2": {
                player: [
                  ...playerFragments({
                    key: "466.p.20003",
                    name: "Synthetic Empty Slot",
                    displayPosition: "RB",
                    primaryPosition: "RB",
                    eligiblePositions: ["RB"],
                  }),
                  {
                    selected_position: [
                      { coverage_type: "week", week: "6" },
                      { position: "" },
                      { is_flex: 0 },
                    ],
                  },
                  { opponent: "Bye" },
                ],
              },
              count: 3,
            },
          },
          coverage_type: "week",
          week: 6,
          is_editable: 1,
        },
      },
    ],
  },
};

export const datedRosterPayload = {
  fantasy_content: {
    team: [
      { team_key: "466.l.4002.t.3", name: "Synthetic NHL Team" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  ...playerFragments({
                    key: "466.p.30001",
                    name: "Synthetic Skater",
                    displayPosition: "C,LW",
                    primaryPosition: "C",
                    eligiblePositions: ["C", "LW"],
                    proTeam: "SYN",
                  }),
                  {
                    selected_position: [
                      { coverage_type: "date", date: "2026-10-17" },
                      { position: "C" },
                      { is_flex: 0 },
                    ],
                  },
                  { opponent: "@SEA" },
                ],
              },
              count: 1,
            },
          },
          coverage_type: "date",
          date: "2026-10-17",
        },
      },
    ],
  },
};

const playerIdentity = (playerKey: string, name: string): ReadonlyArray<unknown> => [
  { player_key: playerKey },
  { player_id: playerKey.split(".").at(-1) },
  { name: { full: name } },
  { editorial_team_abbr: "SYN" },
  { display_position: "QB" },
  { position_type: "O" },
  { primary_position: "QB" },
  { eligible_positions: [{ position: "QB" }, { position: "W/R" }] },
  [],
];

export const weekPlayerDetailsPayload = {
  fantasy_content: {
    league: [
      leagueAttributes,
      {
        players: {
          "0": {
            player: [
              playerIdentity("466.p.20001", "Synthetic Starter"),
              {
                player_stats: {
                  "0": { coverage_type: "week", week: "6" },
                  stats: [
                    { stat: { stat_id: 4, value: "287" } },
                    { stat: { stat_id: 9, value: 2 } },
                    { stat: { stat_id: 79, value: "-" } },
                  ],
                },
              },
              {
                percent_owned: [{ coverage_type: "week", week: "6" }, { value: 88 }],
              },
              {
                percent_started: [
                  { coverage_type: "week", week: "6" },
                  { value: 38 },
                  { delta: 10 },
                ],
              },
              { ownership: { ownership_type: "team" } },
              { player_ranks: [{ player_rank: { rank_type: "OR", rank_value: "11" } }] },
              { is_editable: "1" },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const seasonPlayerDetailsPayload = {
  fantasy_content: {
    league: [
      leagueAttributes,
      {
        players: {
          "0": {
            player: [
              playerIdentity("466.p.20001", "Synthetic Starter"),
              {
                player_stats: {
                  "0": { coverage_type: "season", season: "2026" },
                  stats: [
                    { stat: { stat_id: 4, value: "1640" } },
                    { stat: { stat_id: 9, value: "11" } },
                  ],
                },
              },
              { ownership: { ownership_type: "freeagents" } },
            ],
          },
          count: 1,
        },
      },
    ],
  },
};

export const weekPlayerDetailsForAnotherWeek = {
  fantasy_content: {
    league: [
      leagueAttributes,
      {
        players: {
          "0": {
            player: [
              playerIdentity("466.p.20001", "Synthetic Starter"),
              {
                player_stats: {
                  "0": { coverage_type: "week", week: "5" },
                  stats: [{ stat: { stat_id: 4, value: "210" } }],
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

function matchupTeam(
  teamKey: string,
  name: string,
  points: string,
  projected: string,
  winProbability: number,
): ReadonlyArray<unknown> {
  return [
    { team_key: teamKey },
    { name },
    {
      team_points: {
        "0": { coverage_type: "week", week: "6" },
        total: points,
      },
    },
    {
      team_projected_points: {
        "0": { coverage_type: "week", week: "6" },
        total: projected,
      },
    },
    {
      team_remaining_games: {
        "0": { coverage_type: "week", week: "6" },
        total: { completed_games: "3", live_games: "1", remaining_games: "5" },
      },
    },
    {
      team_stats: {
        "0": { coverage_type: "week", week: "6" },
        stats: [{ stat: { stat_id: 4, value: "287" } }],
      },
    },
    { win_probability: winProbability },
  ];
}

export const matchupsPayload = {
  fantasy_content: {
    league: [
      leagueAttributes,
      {
        scoreboard: {
          "0": {
            matchups: {
              "0": {
                matchup: {
                  "0": {
                    teams: {
                      "0": {
                        team: matchupTeam(
                          "466.l.4000.t.1",
                          "Synthetic NFL Team",
                          "101.25",
                          "109.4",
                          0.62,
                        ),
                      },
                      "1": {
                        team: matchupTeam(
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
                  is_tied: 0,
                  stat_winners: [
                    {
                      stat_winner: {
                        stat_id: 4,
                        winner_team_key: "466.l.4000.t.1",
                        is_tied: "0",
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

export const draftResultsPayload = {
  fantasy_content: {
    league: [
      leagueAttributes,
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
              pick: "2",
              round: "1",
              team_key: "466.l.4000.t.2",
              player_key: "466.p.20006",
            },
          },
          count: 2,
        },
      },
    ],
  },
};

export const transactionsPayload = {
  fantasy_content: {
    league: [
      leagueAttributes,
      {
        transactions: {
          "0": {
            transaction: [
              {
                transaction_key: "466.l.4000.tr.1",
                type: "add/drop",
                status: "successful",
                timestamp: "1791000000",
              },
              {
                players: {
                  "0": {
                    player: [
                      ...playerFragments({
                        key: "466.p.20003",
                        name: "Synthetic Addition",
                        displayPosition: "WR",
                        primaryPosition: "WR",
                        eligiblePositions: ["WR"],
                        proTeam: "SYN",
                      }),
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
                      ...playerFragments({
                        key: "466.p.20004",
                        name: "Synthetic Drop",
                        displayPosition: "RB",
                        primaryPosition: "RB",
                        eligiblePositions: ["RB"],
                        proTeam: "SYN",
                      }),
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
          count: 1,
        },
      },
    ],
  },
};

export const pendingTradesPayload = {
  fantasy_content: {
    league: [
      leagueAttributes,
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
                      ...playerFragments({
                        key: "466.p.20003",
                        name: "Synthetic Incoming",
                        displayPosition: "WR",
                        primaryPosition: "WR",
                        eligiblePositions: ["WR"],
                        proTeam: "SYN",
                      }),
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

export const crumbPayload = { service: { crumb: "canary-crumb-value" } };

export const transactionRefusal = {
  request: {
    method: "POST",
    url: "https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions?format=json_f&crumb=%3Credacted%3E",
    headers: {
      accept: "application/json",
      "content-type": "application/xml",
      cookie: "<redacted>",
    },
    body: '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>add/drop</type><players><player><player_key>466.p.20003</player_key><transaction_data><type>add</type><destination_team_key>466.l.4000.t.1</destination_team_key></transaction_data></player><player><player_key>466.p.20004</player_key><transaction_data><type>drop</type><source_team_key>466.l.4000.t.1</source_team_key></transaction_data></player></players></transaction></fantasy_content>',
  },
  response: {
    status: 400,
    statusText: "Bad Request",
    body: `{
    "error": {
        "xml:lang": "en-us",
        "yahoo:uri": "\\/fantasy\\/v2\\/league\\/466.l.4000\\/transactions?format=json_f&amp;crumb=<redacted>",
        "description": "Player Synthetic Player is in a IR position on your roster, but is no longer on the real-life IR.  Please edit your lineup to activate this player from your IR and then attempt your transaction again.",
        "detail": null
    }
}`,
  },
};
