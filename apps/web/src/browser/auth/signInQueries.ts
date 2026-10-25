import { queryOptions } from "@tanstack/solid-query";

import type { SignInMethodsView } from "#contracts/auth/authContract.ts";

import type { SignInRemote } from "./signInRemote";

export const signInQueries = {
  methods: (remote: Pick<SignInRemote, "loadMethods">) =>
    queryOptions({
      queryKey: ["sign-in", "methods"] as const,
      queryFn: (): Promise<SignInMethodsView> => remote.loadMethods(),

      staleTime: Number.POSITIVE_INFINITY,
    }),
};

export type SignInMethodsQueryOptions = ReturnType<typeof signInQueries.methods>;
