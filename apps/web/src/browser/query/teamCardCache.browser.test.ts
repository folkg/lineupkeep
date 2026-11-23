import { jsonString } from "@lineupkeep/collections";
import { expect, it } from "vitest";

import { clearCachedTeamCards, readCachedTeamCards, storeCachedTeamCards } from "./teamCardCache";

it("keeps cards for the matching viewer and clears them on request", () => {
  clearCachedTeamCards();
  storeCachedTeamCards("viewer-a", []);

  expect(readCachedTeamCards("viewer-a")).toEqual([]);
  expect(readCachedTeamCards("viewer-b")).toEqual([]);

  clearCachedTeamCards();
  expect(readCachedTeamCards("viewer-a")).toEqual([]);
});

it("ignores malformed cached cards", () => {
  clearCachedTeamCards();
  localStorage.setItem("lineupkeep.team-card-facts.v1", jsonString({ viewerId: "viewer-a" }));
  expect(readCachedTeamCards("viewer-a")).toEqual([]);

  localStorage.setItem(
    "lineupkeep.team-card-facts.v1",
    jsonString({ viewerId: "viewer-a", cards: [{ summary: {} }] }),
  );
  expect(readCachedTeamCards("viewer-a")).toEqual([]);
});
