import { mutationOptions } from "@tanstack/solid-query";

import type { SessionRemote } from "./sessionRemote";

export const sessionMutations = {
  signOut: (remote: Pick<SessionRemote, "signOut">) =>
    mutationOptions({
      mutationKey: ["session", "sign-out"],
      mutationFn: () => remote.signOut(),

      onSuccess: (_data, _variables, _onMutateResult, context) => context.client.resetQueries(),
    }),
};
