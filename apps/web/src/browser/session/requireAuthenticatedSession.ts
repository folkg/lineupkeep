import { redirect } from "@tanstack/solid-router";

import type { SessionView } from "#contracts/auth/authContract.ts";

export function requireAuthenticatedSession(
  loadSession: LoadSession,
  returnTo: string,
): Promise<Extract<SessionView, { status: "authenticated" }>> {
  return loadSession().then((session) => {
    if (session.status === "anonymous") {
      throw redirect({ to: "/auth", search: { redirect: returnTo } });
    }
    return session;
  });
}

type LoadSession = () => Promise<SessionView>;
