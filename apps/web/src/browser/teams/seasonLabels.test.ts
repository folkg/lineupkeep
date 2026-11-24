import { expect, it } from "vitest";

import { periodLabel, periodParts } from "./seasonLabels";

it("keeps a compact week label for card surfaces", () => {
  expect(periodLabel(9, 26, false, true, 23)).toBe(
    "Week 9 of 22 regular · 13 left · 4 playoff weeks",
  );
  expect(periodLabel(24, 26, false, true, 23)).toBe("Playoffs · Week 2 of 4");
  expect(periodLabel(22, 26, false, true, 23)).toBe("Week 22 of 22 regular · 4 playoff weeks");
  expect(periodLabel(9, 26, false, false, 23)).toBe("Week 9 of 26");
  expect(periodLabel(9, 26, false, undefined, undefined)).toBe("Week 9 of 26");
});

it("splits the detail week into a headline and its regular and playoff notes", () => {
  expect(periodParts(9, 26, false, true, 23)).toEqual({
    headline: "Week 9 of 22 regular",
    details: ["13 regular weeks left", "4 playoff weeks"],
  });
  expect(periodParts(24, 26, false, true, 23)).toEqual({
    headline: "Playoffs · Week 2 of 4",
    details: [],
  });
  expect(periodParts(22, 26, false, true, 23)).toEqual({
    headline: "Week 22 of 22 regular",
    details: ["4 playoff weeks"],
  });
  expect(periodParts(9, 26, false, false, 23)).toEqual({
    headline: "Week 9 of 26",
    details: [],
  });
});
