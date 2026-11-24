import { describe, expect, it } from "vitest";

import { periodLabel } from "./seasonLabels";

describe("periodLabel", () => {
  it("splits the regular season from the playoff weeks", () => {
    expect(periodLabel(9, 26, false, true, 23)).toBe(
      "Week 9 of 22 regular · 13 left · 4 playoff weeks",
    );
  });

  it("counts the playoff round once the regular season ends", () => {
    expect(periodLabel(24, 26, false, true, 23)).toBe("Playoffs · Week 2 of 4");
  });

  it("omits the remaining count on the last regular-season week", () => {
    expect(periodLabel(22, 26, false, true, 23)).toBe("Week 22 of 22 regular · 4 playoff weeks");
  });

  it("keeps the plain week window when the league does not publish playoffs", () => {
    expect(periodLabel(9, 26, false, false, 23)).toBe("Week 9 of 26");
    expect(periodLabel(9, 26, false, undefined, undefined)).toBe("Week 9 of 26");
  });
});
