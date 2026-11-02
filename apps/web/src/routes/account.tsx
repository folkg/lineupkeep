import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { AccountDataPage } from "#browser/account/AccountDataPage.tsx";
import { accountRemote } from "#browser/account/accountRemote.ts";
import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";

export const Route = createFileRoute("/account")({
  ssr: true,
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  component: AccountRoute,
});

function AccountRoute(): JSX.Element {
  const context = Route.useRouteContext();
  return (
    <AccountDataPage remote={accountRemote} onErased={() => context().queryClient.resetQueries()} />
  );
}
