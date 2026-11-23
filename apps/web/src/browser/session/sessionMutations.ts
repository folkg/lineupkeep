import { mutationOptions } from "@tanstack/solid-query";

import { clearCachedTeamCards } from "#browser/query/teamCardCache.ts";
import { clearCachedTeamHeaders } from "#browser/query/teamHeaderCache.ts";

import { sessionQueries } from "./sessionQueries";
import type { SessionRemote } from "./sessionRemote";

export const sessionMutations = {
  signOut: (remote: Pick<SessionRemote, "signOut">) =>
    mutationOptions({
      mutationKey: ["session", "sign-out"],
      mutationFn: () => remote.signOut(),

      onSuccess: (_data, _variables, _onMutateResult, context) => {
        clearCachedTeamHeaders();
        clearCachedTeamCards();
        context.client.removeQueries({
          predicate: (query) => query.queryKey[0] !== sessionQueries.currentKey[0],
        });
        return context.client.invalidateQueries({ queryKey: sessionQueries.currentKey });
      },
    }),
};
