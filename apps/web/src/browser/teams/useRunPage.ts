import { useQuery } from "@tanstack/solid-query";

import type { TeamRunQueryOptions } from "./teamQueries";

export function useRunPage(props: RunPageOptions): RunPageController {
  const run = useQuery(() => props.runQuery());
  const teams = useQuery(() => props.teamsQuery());
  return {
    run: () => (run.isPending ? undefined : run.data.run),
    team: () => {
      if (run.isPending || teams.isPending) {
        return undefined;
      }
      const current = run.data.run;
      return teams.data.find((candidate) => candidate.team.id === current.team);
    },
    isLoading: () => run.isPending,
    failure: () => (run.isPending ? undefined : run.error),
    refresh: () => props.onRefresh(),
  };
}

export type RunPageController = {
  readonly run: () => import("#contracts/connections/teamContract.ts").LineupRunView | undefined;
  readonly team: () => import("#contracts/connections/teamContract.ts").TeamSummaryView | undefined;
  readonly isLoading: () => boolean;
  readonly failure: () => Error | null | undefined;
  readonly refresh: () => Promise<void>;
};

type RunPageOptions = {
  readonly runQuery: () => TeamRunQueryOptions;
  readonly teamsQuery: () => import("./teamQueries").TeamListQueryOptions;
  readonly onRefresh: () => Promise<void>;
};
