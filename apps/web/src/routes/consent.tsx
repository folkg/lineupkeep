import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { returnToClient } from "#browser/consent/consentLocation.ts";
import { ConsentPage } from "#browser/consent/ConsentPage.tsx";
import { consentQueries } from "#browser/consent/consentQueries.ts";
import { consentRemote } from "#browser/consent/consentRemote.ts";
import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";

export const Route = createFileRoute("/consent")({
  ssr: "data-only",
  context: () => {
    const query = consentRemote.currentQuery();
    return { query, requestQuery: consentQueries.request(consentRemote, query) };
  },
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context }) => context.queryClient.prefetchQuery(context.requestQuery),
  component: ConsentRoute,
});

function ConsentRoute(): JSX.Element {
  const context = Route.useRouteContext();
  return (
    <ConsentPage
      query={context().query}
      requestQuery={() => context().requestQuery}
      remote={consentRemote}
      onConfirmed={returnToClient}
    />
  );
}
