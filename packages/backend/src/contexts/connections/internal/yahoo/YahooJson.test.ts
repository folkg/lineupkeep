import { assert, it } from "@effect/vitest";

import { normalizeYahooJson } from "./YahooJson.ts";

it("unwraps counted Yahoo resources into ordered arrays", () => {
  const normalized = normalizeYahooJson(rawSession);

  assert.deepStrictEqual(normalized, {
    users: [{ guid: "SYNTHETICGUID" }],
  });
});

it("merges positional resource fragments and nested collections", () => {
  const normalized = normalizeYahooJson(rawTeams);

  assert.deepStrictEqual(normalized, {
    users: [
      {
        guid: "SYNTHETICGUID",
        games: [
          {
            game_key: "461",
            code: "nfl",
            season: "2026",
            teams: [
              { team_key: "461.l.1000.t.1", name: "Alpha", is_editable: "0" },
              { team_key: "461.l.1000.t.2", name: "Beta" },
            ],
          },
        ],
      },
    ],
  });
});

it("merges nested attribute fragment lists and ignores absent placeholders", () => {
  const normalized = normalizeYahooJson(rawNestedTeams);

  assert.deepStrictEqual(normalized, {
    users: [
      {
        guid: "SYNTHETICGUID",
        games: [
          {
            game_key: "461",
            code: "nfl",
            season: "2026",
            teams: [
              {
                team_key: "461.l.1000.t.1",
                name: "Alpha",
                team_logos: { team_logo: { size: "large", url: "https://s.yimg.com" } },
                managers: { manager: { manager_id: "1" } },
              },
            ],
          },
        ],
      },
    ],
  });
});

it("keeps repeated single-key attribute entries in order instead of merging them", () => {
  const normalized = normalizeYahooJson(rawLeagueSettings);

  assert.deepStrictEqual(normalized, {
    league: {
      league_key: "465.l.2000",
      settings: {
        roster_type: "head",
        roster_positions: [
          { roster_position: { position: "C", count: 2, is_starting_position: 1 } },
          { roster_position: { position: "BN", count: 6, is_starting_position: 0 } },
        ],
      },
    },
  });
});

it("keeps nested roster resources while merging team attribute fragments", () => {
  const normalized = normalizeYahooJson(rawRoster);

  assert.deepStrictEqual(normalized, {
    team: {
      team_key: "461.l.1000.t.1",
      roster: [
        {
          players: [
            {
              player_key: "461.p.10001",
              selected_position: { coverage_type: "week", week: "3", position: "QB" },
              is_editable: "1",
            },
          ],
        },
      ],
    },
  });
});

it("preserves empty successful collections and ignores non-JSON content", () => {
  assert.deepStrictEqual(normalizeYahooJson({ fantasy_content: { users: { count: 0 } } }), {
    users: [],
  });
  assert.isUndefined(normalizeYahooJson({ error: { description: "private" } }));
  assert.isUndefined(normalizeYahooJson("not an object"));
});

const rawRoster = {
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

const rawSession = {
  fantasy_content: {
    users: {
      "0": {
        user: [{ guid: "SYNTHETICGUID" }],
      },
      count: 1,
    },
  },
};

const rawLeagueSettings = {
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

const rawNestedTeams = {
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

const rawTeams = {
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
