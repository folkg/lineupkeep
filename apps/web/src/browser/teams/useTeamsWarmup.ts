import { useQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";

import { teamQueries } from "./teamQueries";
import { teamRemote } from "./teamRemote";

export function useTeamsWarmup(enabled: Accessor<boolean>): void {
  useQuery(() => ({
    ...teamQueries.list(teamRemote),
    enabled: enabled(),
  }));
  useQuery(() => ({
    ...teamQueries.cards(teamRemote),
    enabled: enabled(),
  }));
}
