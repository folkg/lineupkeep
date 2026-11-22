import { Array as EffectArray, Option } from "effect";
import { describe, expect, it } from "vitest";

import { projectLineupOutlook } from "./outlook.ts";
import type { OutlookInput, OutlookPlayer, OutlookResult } from "./outlook.ts";

const saturday = "2026-11-21";
const sunday = "2026-11-22";

function player(
  key: string,
  slot: string,
  saturdayGame: boolean,
  sundayGame: boolean,
): OutlookPlayer {
  return {
    key,
    name: key,
    proTeam: "TEAM",
    positions: ["C"],
    slot,
    games: new Map<string, ReadonlyArray<{ opponent: string; home: boolean }> | null>([
      [saturday, saturdayGame ? [{ opponent: "A", home: true }] : null],
      [sunday, sundayGame ? [{ opponent: "B", home: false }] : null],
    ]),
  };
}

function outlook(
  players: ReadonlyArray<OutlookPlayer>,
  moves: OutlookInput["moves"] = [],
): OutlookResult {
  return projectLineupOutlook({
    players,
    moves,
    slots: [
      { position: "C", kind: "starting", count: 12, eligibility: ["C"] },
      { position: "BN", kind: "bench", count: 12, eligibility: [] },
    ],
    periods: [
      { date: saturday, start: saturday, end: saturday },
      { date: sunday, start: sunday, end: sunday },
    ],
  });
}

describe("forward lineup outlook", () => {
  it("fits Saturday's full slate and Sunday's half-full slate with the same solver", () => {
    const players = [
      ...Array.from({ length: 12 }, (_, index) => player(String(index), "C", true, index < 6)),
      player("bench", "BN", true, false),
    ];
    const result = outlook(players);
    expect(result.periods[0]?.totals).toMatchObject({
      startingSlots: 12,
      assigned: 12,
      playing: 12,
      open: 0,
    });
    expect(EffectArray.map(result.periods[0]?.sittingWithGame ?? [], (entry) => entry.key)).toEqual(
      ["bench"],
    );
    expect(result.periods[1]?.totals).toMatchObject({ playing: 6, open: 6 });
    expect(
      Option.getOrUndefined(EffectArray.findFirst(result.players, (entry) => entry.key === "bench"))
        ?.games,
    ).toEqual([{ date: saturday, opponent: "A", home: true, fitsStartingSlot: false }]);
    expect(
      Option.getOrUndefined(EffectArray.findFirst(result.players, (entry) => entry.key === "bench"))
        ?.gamesThatFit,
    ).toBe(0);
  });

  it("separates occupied no-game places, empty places, and unknown game days", () => {
    const result = outlook([
      player("idle", "C", false, false),
      { ...player("unknown", "BN", false, false), games: new Map() },
    ]);
    expect(result.periods[0]?.totals).toMatchObject({
      assigned: 1,
      playing: 0,
      open: 12,
      empty: 11,
    });
    expect(EffectArray.map(result.periods[0]?.unknownGameDays ?? [], (entry) => entry.key)).toEqual(
      ["unknown"],
    );
    expect(
      Option.getOrUndefined(
        EffectArray.findFirst(result.players, (entry) => entry.key === "unknown"),
      )?.unknownPeriods,
    ).toBe(2);
  });

  it("applies a move effective on the first day before fitting that day", () => {
    const result = outlook(
      [player("old", "C", true, false)],
      [
        {
          id: "move",
          kind: "free_agent_add",
          effectiveDate: saturday,
          order: 0,
          adds: [player("added", "BN", false, true)],
          drops: ["old"],
          validation: "stale",
          certainty: "saved",
          dependsOn: [],
          fallback: false,
        },
      ],
    );
    expect(EffectArray.map(result.periods[0]?.players ?? [], (entry) => entry.key)).toEqual([
      "added",
    ]);
    expect(EffectArray.map(result.periods[1]?.players ?? [], (entry) => entry.key)).toEqual([
      "added",
    ]);
    expect(result.periods[0]?.moves[0]?.conditional).toBe(true);
    expect(result.moves.applied).toEqual(["move"]);
  });

  it("keeps a later move out of earlier periods before replaying it", () => {
    const result = outlook(
      [player("old", "C", true, false)],
      [
        {
          id: "move",
          kind: "free_agent_add",
          effectiveDate: sunday,
          order: 0,
          adds: [player("added", "BN", false, true)],
          drops: ["old"],
          validation: "current",
          certainty: "saved",
          dependsOn: [],
          fallback: false,
        },
      ],
    );
    expect(EffectArray.map(result.periods[0]?.players ?? [], (entry) => entry.key)).toEqual([
      "old",
    ]);
    expect(EffectArray.map(result.periods[1]?.players ?? [], (entry) => entry.key)).toEqual([
      "added",
    ]);
    expect(result.periods[0]?.moves).toEqual([]);
    expect(result.periods[1]?.moves[0]?.effectiveDate).toBe(sunday);
  });

  it("lists undated, illegal, and fallback moves without applying them", () => {
    const base = {
      id: "undated",
      kind: "drop",
      order: 0,
      adds: [],
      drops: ["old"],
      validation: "unchecked" as const,
      certainty: "saved" as const,
      dependsOn: [],
      fallback: false,
    };
    const result = outlook(
      [player("old", "C", true, true)],
      [
        base,
        { ...base, id: "illegal", effectiveDate: sunday, validation: "illegal" },
        { ...base, id: "fallback", effectiveDate: sunday, fallback: true },
      ],
    );
    expect(EffectArray.map(result.moves.unapplied, (move) => move.move)).toEqual([
      "undated",
      "illegal",
      "fallback",
    ]);
    expect(EffectArray.map(result.periods[1]?.players ?? [], (entry) => entry.key)).toEqual([
      "old",
    ]);
  });

  it("fits a G position with the same starting-slot rules", () => {
    const playerAtG = { ...player("player-at-g", "G", true, false), positions: ["G"] };
    const result = projectLineupOutlook({
      players: [playerAtG],
      moves: [],
      slots: [{ position: "G", kind: "starting", count: 1, eligibility: ["G"] }],
      periods: [{ date: saturday, start: saturday, end: saturday }],
    });
    expect(result.periods[0]?.totals.playing).toBe(1);
    expect(result.players[0]?.gamesInWindow).toBe(1);
  });

  it("starts a bench player with a game on the first day", () => {
    const result = outlook([
      player("idle", "C", false, false),
      player("playing", "BN", true, false),
    ]);
    expect(result.periods[0]?.totals.playing).toBe(1);
    expect(result.periods[0]?.sittingWithGame).toEqual([]);
    expect(
      Option.getOrUndefined(EffectArray.findFirst(result.players, (row) => row.key === "playing"))
        ?.gamesThatFit,
    ).toBe(1);
  });

  it("counts each game of a doubleheader inside its stated window", () => {
    const starter = player("starter", "C", true, false);
    const result = outlook([
      {
        ...starter,
        games: new Map([
          [
            saturday,
            [
              { opponent: "A", home: true },
              { opponent: "B", home: false },
            ],
          ],
          [sunday, null],
        ]),
      },
    ]);
    expect(result.periods[0]?.games.rosterGames).toBe(2);
    expect(result.players[0]?.gamesInWindow).toBe(2);
  });
});
