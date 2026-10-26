import { describe, expect, it } from "vitest";

import type { Period } from "./types.ts";
import { trailingPeriodCount, trailingWindow } from "./window.ts";

function week(value: number): Period {
  return { kind: "week", week: value };
}

describe("trailing windows", () => {
  it("takes the most recent completed periods in chronological order", () => {
    expect(trailingPeriodCount).toBe(4);
    expect(trailingWindow([week(4), week(2), week(6), week(3), week(5), week(1)])).toEqual([
      { kind: "week", week: 3 },
      { kind: "week", week: 4 },
      { kind: "week", week: 5 },
      { kind: "week", week: 6 },
    ]);
  });

  it("keeps a shorter season intact", () => {
    expect(trailingWindow([week(1), week(2)])).toEqual([
      { kind: "week", week: 1 },
      { kind: "week", week: 2 },
    ]);
  });

  it("orders dated periods by calendar text", () => {
    expect(
      trailingWindow(
        [
          { kind: "date", date: "2026-10-24" },
          { kind: "date", date: "2026-10-22" },
          { kind: "date", date: "2026-10-23" },
        ],
        2,
      ),
    ).toEqual([
      { kind: "date", date: "2026-10-23" },
      { kind: "date", date: "2026-10-24" },
    ]);
  });

  it("rejects a window that mixes weekly and dated periods", () => {
    expect(() => trailingWindow([week(1), { kind: "date", date: "2026-10-22" }])).toThrow(
      /cannot mix weekly and dated periods/u,
    );
  });

  it("rejects a window length that is not a positive whole number", () => {
    expect(() => trailingWindow([week(1)], 0)).toThrow(/positive whole number/u);
    expect(() => trailingWindow([week(1)], 1.5)).toThrow(/positive whole number/u);
  });
});
