import { assert, describe, it } from "@effect/vitest";

import { normalizeYahooJson } from "./json.ts";

describe("Yahoo JSON normalization", () => {
  it("reads the fantasy content wrapper and keeps ordered collection entries", () => {
    const payload = {
      fantasy_content: {
        league: [
          { league_key: "466.l.4000", name: "Synthetic NFL League" },
          {
            teams: {
              "0": { team: [{ team_key: "466.l.4000.t.1" }, { name: "Synthetic Team" }] },
              "1": { team: [{ team_key: "466.l.4000.t.2" }, { name: "Synthetic Rival" }] },
              count: 2,
            },
          },
        ],
      },
    };

    assert.deepStrictEqual(normalizeYahooJson(payload), {
      league: {
        league_key: "466.l.4000",
        name: "Synthetic NFL League",
        teams: [
          { team_key: "466.l.4000.t.1", name: "Synthetic Team" },
          { team_key: "466.l.4000.t.2", name: "Synthetic Rival" },
        ],
      },
    });
  });

  it("keeps a plural collection of repeated fields as ordered entries", () => {
    const payload = {
      fantasy_content: {
        league: [
          { league_key: "466.l.4000" },
          {
            players: {
              "0": { player: [{ player_key: "466.p.20001" }] },
              "1": { player: [{ player_key: "466.p.20002" }] },
              count: 2,
            },
          },
        ],
      },
    };

    assert.deepStrictEqual(normalizeYahooJson(payload), {
      league: {
        league_key: "466.l.4000",
        players: [{ player_key: "466.p.20001" }, { player_key: "466.p.20002" }],
      },
    });
  });

  it("separates numeric collection entries from coverage metadata", () => {
    const payload = {
      fantasy_content: {
        team: [
          { team_key: "466.l.4000.t.1" },
          {
            roster: {
              "0": { players: { "0": { player: [{ player_key: "466.p.20001" }] }, count: 1 } },
              coverage_type: "week",
              week: "6",
            },
          },
        ],
      },
    };

    assert.deepStrictEqual(normalizeYahooJson(payload), {
      team: {
        team_key: "466.l.4000.t.1",
        roster: {
          coverage_type: "week",
          week: "6",
          entries: [{ players: [{ player_key: "466.p.20001" }] }],
        },
      },
    });
  });

  it("returns undefined when the fantasy content wrapper is absent", () => {
    assert.strictEqual(normalizeYahooJson({ service: { crumb: "synthetic" } }), undefined);
  });
});
