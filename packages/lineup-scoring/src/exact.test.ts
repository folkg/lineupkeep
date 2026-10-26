import { describe, expect, it } from "vitest";

import {
  addExact,
  averageExact,
  compareExact,
  exactFromInteger,
  exactToUnits,
  formatExact,
  multiplyExact,
  parseExact,
  subtractExact,
} from "./exact.ts";

describe("exact decimals", () => {
  it("round trips every plain decimal without losing digits", () => {
    expect(formatExact(parseExact("0.04"))).toBe("0.04");
    expect(formatExact(parseExact("-1"))).toBe("-1");
    expect(formatExact(parseExact("10"))).toBe("10");
    expect(formatExact(parseExact("-0.1"))).toBe("-0.1");
    expect(formatExact(parseExact("0"))).toBe("0");
    expect(formatExact(parseExact("0.000"))).toBe("0");
  });

  it("adds without floating-point drift", () => {
    expect(addExact(parseExact("0.1"), parseExact("0.2"))).toEqual(parseExact("0.3"));
    expect(addExact(parseExact("0.04"), parseExact("0.1"))).toEqual(parseExact("0.14"));
    expect(subtractExact(parseExact("0.3"), parseExact("0.1"))).toEqual(parseExact("0.2"));
  });

  it("multiplies whole stat values by decimal modifiers exactly", () => {
    expect(multiplyExact(exactFromInteger(253n), parseExact("0.04"))).toEqual(parseExact("10.12"));
    expect(multiplyExact(exactFromInteger(-1n), parseExact("0.1"))).toEqual(parseExact("-0.1"));
    expect(multiplyExact(exactFromInteger(100n), parseExact("0.07"))).toEqual(parseExact("7"));
  });

  it("compares values that only differ beyond a float's precision", () => {
    expect(compareExact(parseExact("0.3"), addExact(parseExact("0.1"), parseExact("0.2")))).toBe(0);
    expect(compareExact(parseExact("0.04"), parseExact("0.0401"))).toBe(-1);
    expect(compareExact(parseExact("-2"), parseExact("-1.99"))).toBe(-1);
  });

  it("averages by rounding halves away from zero", () => {
    const periodPoints = [parseExact("1"), parseExact("2"), parseExact("2")];
    expect(averageExact(periodPoints, 2)).toEqual(parseExact("1.67"));
    expect(averageExact([parseExact("-1"), parseExact("-2")], 2)).toEqual(parseExact("-1.5"));
    expect(averageExact([parseExact("1"), parseExact("2")], 0)).toEqual(parseExact("2"));
    expect(averageExact([parseExact("1"), parseExact("1"), parseExact("2")], 0)).toEqual(
      parseExact("1"),
    );
  });

  it("converts to a declared scale with exact arithmetic", () => {
    expect(exactToUnits(parseExact("17.02"), 2)).toBe(1702n);
    expect(exactToUnits(parseExact("17.02"), 0)).toBe(17n);
    expect(exactToUnits(parseExact("17.5"), 0)).toBe(18n);
    expect(exactToUnits(parseExact("-17.5"), 0)).toBe(-18n);
    expect(exactToUnits(parseExact("7"), 3)).toBe(7000n);
  });

  it("rejects text that is not a plain decimal", () => {
    expect(() => parseExact("")).toThrow(/plain decimal/u);
    expect(() => parseExact("1e5")).toThrow(/plain decimal/u);
    expect(() => parseExact(".5")).toThrow(/plain decimal/u);
    expect(() => parseExact("1.")).toThrow(/plain decimal/u);
    expect(() => parseExact(" 1")).toThrow(/plain decimal/u);
    expect(() => parseExact("1,5")).toThrow(/plain decimal/u);
  });
});
