import { expect, it } from "vitest";

import { cardFormatLabel, periodParts } from "./seasonLabels";

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

it("uses short scoring labels in a card badge", () => {
  expect(cardFormatLabel("head_to_head_categories")).toBe("Categories");
  expect(cardFormatLabel("head_to_head_points")).toBe("Points");
  expect(cardFormatLabel("points")).toBe("Points");
  expect(cardFormatLabel("rotisserie")).toBe("Rotisserie");
  expect(cardFormatLabel("unknown")).toBeUndefined();
  expect(cardFormatLabel(undefined)).toBeUndefined();
});
