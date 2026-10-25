import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";

import type { SessionView, SignInMethodsView } from "#contracts/auth/authContract.ts";
import { getAuthSession, getSignInMethods } from "#server/auth/authServer.ts";

export const getAuthSessionServerFn = createServerFn({ method: "GET" }).handler(
  (): Promise<SessionView> =>
    getAuthSession(getRequest()).then((session) =>
      session.status === "authenticated"
        ? { status: session.status, userId: session.user.id }
        : { status: session.status },
    ),
);

export const getSignInMethodsServerFn = createServerFn({ method: "GET" }).handler(
  (): Promise<SignInMethodsView> =>
    getSignInMethods(getRequest()).then((methods) => ({ google: methods.google })),
);
