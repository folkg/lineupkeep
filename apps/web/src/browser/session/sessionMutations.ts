import { mutationOptions } from "@tanstack/solid-query";

import { sessionQueries } from "./sessionQueries";
import type { SessionRemote } from "./sessionRemote";

export const sessionMutations = {
  signOut: (remote: Pick<SessionRemote, "signOut">) =>
    mutationOptions({
      mutationKey: ["session", "sign-out"],
      mutationFn: () => remote.signOut(),

      onSuccess: (_data, _variables, _onMutateResult, context) => {
        context.client.removeQueries({
          predicate: (query) => query.queryKey[0] !== sessionQueries.currentKey[0],
        });
        return context.client.invalidateQueries({ queryKey: sessionQueries.currentKey });
      },
    }),
};
