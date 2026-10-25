import { QueryClient, isServer } from "@tanstack/solid-query";

import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) =>
          !(error instanceof AuthenticationRequestFailure) && count < (isServer ? 0 : 3),
      },
    },
  });
}
