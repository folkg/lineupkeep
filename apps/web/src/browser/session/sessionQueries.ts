import { queryOptions } from "@tanstack/solid-query";

import type { SessionView } from "#contracts/auth/authContract.ts";

import type { SessionRemote } from "./sessionRemote";

export const sessionQueries = {
  currentKey: ["session"] as const,
  current: (remote: Pick<SessionRemote, "load">) =>
    queryOptions({
      queryKey: sessionQueries.currentKey,
      queryFn: (): Promise<SessionView> => remote.load(),

      staleTime: Number.POSITIVE_INFINITY,
    }),
};
