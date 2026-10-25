import { mutationOptions } from "@tanstack/solid-query";

import type { ConsentRemote } from "./consentRemote";

export const consentMutation = (
  remote: ConsentRemote,
): Omit<
  import("@tanstack/solid-query").MutationOptions<
    string,
    Error,
    {
      readonly query: string;
      readonly accept: boolean;
    },
    unknown
  >,
  "mutationKey"
> =>
  mutationOptions({
    mutationFn: (input: { readonly query: string; readonly accept: boolean }) =>
      remote.decide(input),
  });
