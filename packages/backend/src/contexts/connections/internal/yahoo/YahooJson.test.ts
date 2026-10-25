import { assert, it } from "@effect/vitest";

import { normalizeYahooJson } from "./YahooJson.ts";
import {
  yahooLeagueSettingsFragments,
  yahooNestedTeams,
  yahooRosterFragments,
  yahooRosterWithCoverageMetadata,
  yahooSession,
  yahooSingleEntryCollections,
  yahooTeamFragments,
} from "./YahooPayloadFixturesTest.ts";

it("unwraps counted Yahoo resources into ordered arrays", () => {
  const normalized = normalizeYahooJson(yahooSession);

  assert.deepStrictEqual(normalized, {
    "xml:lang": "en-US",
    "yahoo:uri": "/fantasy/v2/users;use_login=1",
    users: [{ guid: "SYNTHETICGUID" }],
  });
});

it("merges positional resource fragments and nested collections", () => {
  const normalized = normalizeYahooJson(yahooTeamFragments);

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
  const normalized = normalizeYahooJson(yahooNestedTeams);

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
                team_logos: [{ team_logo: { size: "large", url: "https://s.yimg.com" } }],
                managers: [{ manager: { manager_id: "1" } }],
              },
            ],
          },
        ],
      },
    ],
  });
});

it("keeps repeated single-key attribute entries in order instead of merging them", () => {
  const normalized = normalizeYahooJson(yahooLeagueSettingsFragments);

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

it("keeps one-entry nested collections while merging a settings fragment list", () => {
  const normalized = normalizeYahooJson(yahooSingleEntryCollections);

  assert.deepStrictEqual(normalized, {
    league: {
      league_key: "465.l.2000",
      settings: {
        roster_positions: [
          { roster_position: { position: "G", count: 1, is_starting_position: 1 } },
        ],
        stat_categories: {
          stats: [
            {
              stat: {
                stat_id: 31,
                name: "Goals",
                stat_position_types: [{ stat_position_type: { position_type: "P" } }],
              },
            },
          ],
        },
      },
    },
  });
});

it("keeps nested roster resources while merging team attribute fragments", () => {
  const normalized = normalizeYahooJson(yahooRosterFragments);

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

it("separates entries from sibling metadata in a mixed collection", () => {
  const normalized = normalizeYahooJson(yahooRosterWithCoverageMetadata);

  assert.deepStrictEqual(normalized, {
    team: {
      team_key: "461.l.1000.t.1",
      roster: {
        coverage_type: "week",
        week: "3",
        is_prescoring: 0,
        entries: [
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
