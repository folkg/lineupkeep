import { useMutation, useQuery } from "@tanstack/solid-query";
import { useLocation, useNavigate, useRouteContext } from "@tanstack/solid-router";

import { sessionMutations } from "#browser/session/sessionMutations.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";

export function useSessionActions(): {
  isSignedIn: () => boolean;
  isSigningOut: () => boolean;
  signOut: () => Promise<void>;
} {
  const context = useRouteContext({ from: "__root__" });
  const session = useQuery(() => sessionQueries.current(context().sessionRemote));
  const signOut = useMutation(() => sessionMutations.signOut(context().sessionRemote));
  const navigate = useNavigate();
  const location = useLocation();

  return {
    isSignedIn: () => session.isSuccess && session.data.status === "authenticated",
    isSigningOut: () => signOut.isPending,

    signOut: async () => {
      await navigate({ to: "/" });
      if (location().pathname === "/") {
        await signOut.mutate();
      }
    },
  };
}
