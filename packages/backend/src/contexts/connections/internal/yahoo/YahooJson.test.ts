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

it("preserves empty successful collections and ignores non-JSON content", () => {
  assert.deepStrictEqual(normalizeYahooJson({ fantasy_content: { users: { count: 0 } } }), {
    users: [],
  });
  assert.isUndefined(normalizeYahooJson({ error: { description: "private" } }));
  assert.isUndefined(normalizeYahooJson("not an object"));
});

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
