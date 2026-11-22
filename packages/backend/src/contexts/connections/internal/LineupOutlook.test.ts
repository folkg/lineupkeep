import type { OutlookResult } from "@lineupkeep/lineup-solver";
import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { decodeTeamId } from "#contexts/connections/FantasyTeam.ts";

import { outlookData } from "./LineupOutlook.ts";
import { queryBudget } from "./QueryBudget.ts";

const team = decodeTeamId("01ARZ3NDEKTSV4RRFFQ69G5FAV");
const generatedAt = DateTime.makeUnsafe("2026-11-22T12:00:00.000Z");

const projected: OutlookResult = {
  periods: [
    {
      date: "2026-11-23",
      start: "2026-11-23",
      end: "2026-11-23",
      totals: { startingSlots: 1, assigned: 0, playing: 0, open: 1, empty: 1 },
      slots: [{ position: "QB", total: 1, assigned: 0, playing: 0, open: 1, empty: 1 }],
      sittingWithGame: [],
      unknownGameDays: [],
      games: { rosterGames: 0 },
      moves: [],
      players: [],
    },
  ],
  players: [],
  windowTotals: {
    openSlotPeriods: 1,
    periodsWithOpenSlot: 1,
    rosterGames: 0,
    unknownPlayers: 0,
  },
  moves: { applied: [], unapplied: [] },
};

describe("lineup outlook read model", () => {
  it("maps a projected period without inventing a reference or a move", () => {
    const result = outlookData({
      team,
      basis: "date",
      window: { start: "2026-11-23", end: "2026-11-23", source: "requested" },
      generatedAt,
      projected,
      moves: [],
      playerRefs: new Map(),
      coverage: [],
      failures: [],
      budget: queryBudget,
    });

    expect(result).toMatchObject({
      status: "ok",
      team,
      basis: "date",
      window: { start: "2026-11-23", end: "2026-11-23", source: "requested" },
      generatedAt,
      periods: [
        {
          date: "2026-11-23",
          totals: { startingSlots: 1, assigned: 0, playing: 0, open: 1, empty: 1 },
          slots: [{ position: "QB", total: 1, assigned: 0, playing: 0, open: 1, empty: 1 }],
        },
      ],
      budget: queryBudget,
    });
  });
});
