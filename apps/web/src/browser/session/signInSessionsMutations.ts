import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import type { SignInSessionListData } from "#contracts/auth/authContract.ts";

import { signInSessionsQueries } from "./signInSessionsQueries";
import type { SignInSessionsRemote } from "./signInSessionsRemote";

export const signInSessionsMutations = {
  end: (remote: Pick<SignInSessionsRemote, "end">) =>
    mutationOptions({
      mutationKey: ["sign-in-sessions", "end"],
      mutationFn: (session: string) => remote.end(session),
    }),
  endOthers: (remote: Pick<SignInSessionsRemote, "endOthers">) =>
    mutationOptions({
      mutationKey: ["sign-in-sessions", "end-others"],
      mutationFn: () => remote.endOthers(),
    }),
};

export function storeSignInSessions(
  view: SignInSessionListData,
  _variables: unknown,
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): void {
  context.client.setQueryData(signInSessionsQueries.listKey, view);
}
