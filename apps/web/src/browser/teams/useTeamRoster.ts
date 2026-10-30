import { useQuery } from "@tanstack/solid-query";
import type { UseQueryResult } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";

import type { TeamRosterView } from "#contracts/connections/teamContract.ts";

import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export function useTeamRoster(options: {
  readonly teamId: Accessor<string>;
  readonly remote: Accessor<TeamRemote>;
}): UseQueryResult<TeamRosterView, Error> {
  return useQuery(() => teamQueries.roster(options.remote(), options.teamId()));
}
