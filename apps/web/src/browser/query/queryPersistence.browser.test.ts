import { QueryClient } from "@tanstack/solid-query";
import { expect, it } from "vitest";

import {
  persistTeamQueries,
  removePersistedTeamQueries,
  restoreTeamQueries,
} from "./queryPersistence";

it("restores team data from local storage", async () => {
  removePersistedTeamQueries();
  const first = new QueryClient();
  const stop = persistTeamQueries(first);
  first.setQueryData(["teams", "list"], [{ team: { id: "team-1" } }]);
  first.setQueryData(["teams", "card-facts"], [{ summary: { team: { id: "team-1" } } }]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  stop();

  const second = new QueryClient();
  restoreTeamQueries(second);
  expect(second.getQueryData(["teams", "list"])).toEqual([{ team: { id: "team-1" } }]);
  expect(second.getQueryData(["teams", "card-facts"])).toEqual([
    { summary: { team: { id: "team-1" } } },
  ]);
  removePersistedTeamQueries();
});

it("leaves a query the server already supplied", async () => {
  removePersistedTeamQueries();
  const first = new QueryClient();
  const stop = persistTeamQueries(first);
  first.setQueryData(["teams", "list"], [{ team: { id: "stored-team" } }]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  stop();

  const second = new QueryClient();
  second.setQueryData(["teams", "list"], [{ team: { id: "server-team" } }]);
  restoreTeamQueries(second);
  expect(second.getQueryData(["teams", "list"])).toEqual([{ team: { id: "server-team" } }]);
  removePersistedTeamQueries();
});
