import { queryOptions } from "@tanstack/solid-query";

import type { SessionView } from "#contracts/auth/authContract.ts";

import type { SessionRemote } from "./sessionRemote";

export const sessionQueries = {
  current: (remote: Pick<SessionRemote, "load">) =>
    queryOptions({
      queryKey: ["session"] as const,
      queryFn: (): Promise<SessionView> => remote.load(),

      staleTime: Number.POSITIVE_INFINITY,
    }),
};
