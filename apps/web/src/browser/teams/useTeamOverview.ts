import { useQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";

import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

import type { TeamRemote } from "./teamRemote.ts";

export function useTeamOverview(
  teamId: Accessor<string>,
  remote: Accessor<TeamRemote>,
  enabled: Accessor<boolean> = () => true,
): {
  readonly facts: () => TeamOverviewView | undefined;
  readonly loading: () => boolean;
  readonly failed: () => boolean;
} {
  const overview = useQuery(() => ({
    queryKey: ["teams", "overview", teamId()],
    enabled: enabled(),
    placeholderData: { reason: "" },
    retry: false,
    queryFn: () =>
      remote().overview?.(teamId()) ??
      Promise.resolve({ reason: "Season overview is not available." }),
  }));
  return {
    facts: () => overview.data,
    loading: () => overview.isFetching,
    failed: () => overview.isError,
  };
}
