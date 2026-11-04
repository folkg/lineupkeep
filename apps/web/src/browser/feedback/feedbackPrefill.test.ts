import { expect, it } from "vitest";

import {
  feedbackContextFromSearch,
  feedbackTitleFromSearch,
  parseFeedbackSearch,
} from "./feedbackPrefill";

const team = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";

it("keeps a known surface and a team reference from the link", () => {
  const search = parseFeedbackSearch({ surface: "run", team });

  expect(search).toEqual({ surface: "run", team });
  expect(feedbackContextFromSearch(search)).toEqual({ surface: "run", team });
});

it("drops unknown surfaces, non-UUID team references, and repeated parameters", () => {
  const search = parseFeedbackSearch({
    surface: "admin",
    team: ["not-a-team"],
    other: team,
  });

  expect(search).toEqual({});
  expect(feedbackContextFromSearch(search)).toEqual({});
});

it("accepts a plain surface without a team reference", () => {
  expect(parseFeedbackSearch({ surface: "connections" })).toEqual({ surface: "connections" });
});

it("prefills a team report title from the team name the link carries", () => {
  const search = parseFeedbackSearch({ surface: "team", team, teamName: "Bread Roller" });

  expect(search).toEqual({ surface: "team", team, teamName: "Bread Roller" });
  expect(feedbackTitleFromSearch(search)).toBe("Problem with Bread Roller");
  expect(feedbackContextFromSearch(search)).toEqual({ surface: "team", team });
});

it("leaves the title empty when the link carries no team name", () => {
  const search = parseFeedbackSearch({ surface: "team", team });

  expect(feedbackTitleFromSearch(search)).toBe("");
});

it("drops a blank or repeated team name", () => {
  expect(parseFeedbackSearch({ surface: "team", team, teamName: "   " })).toEqual({
    surface: "team",
    team,
  });
  expect(parseFeedbackSearch({ surface: "team", team, teamName: ["Bread Roller"] })).toEqual({
    surface: "team",
    team,
  });
});
