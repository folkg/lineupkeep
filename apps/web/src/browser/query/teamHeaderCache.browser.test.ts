import { expect, it } from "vitest";

import {
  clearCachedTeamHeaders,
  readCachedTeamHeaders,
  storeCachedTeamHeaders,
} from "./teamHeaderCache";

it("keeps team headers for the matching viewer and clears them on request", () => {
  clearCachedTeamHeaders();
  storeCachedTeamHeaders("viewer-a", [
    { id: "team-1", name: "Bread Roller", sportLabel: "Hockey", leagueName: "Sunday League" },
  ]);

  expect(readCachedTeamHeaders("viewer-a")).toEqual([
    { id: "team-1", name: "Bread Roller", sportLabel: "Hockey", leagueName: "Sunday League" },
  ]);
  expect(readCachedTeamHeaders("viewer-b")).toEqual([]);

  clearCachedTeamHeaders();
  expect(readCachedTeamHeaders("viewer-a")).toEqual([]);
});

it("ignores malformed cached rows", () => {
  clearCachedTeamHeaders();
  localStorage.setItem("lineupkeep.team-headers.v1", "viewer-a\nid=team-1\nname=No sport");
  expect(readCachedTeamHeaders("viewer-a")).toEqual([]);
});
