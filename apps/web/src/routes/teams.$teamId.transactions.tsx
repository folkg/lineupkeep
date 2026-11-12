import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { transactionQueries } from "#browser/transactions/transactionQueries.ts";
import { transactionRemote } from "#browser/transactions/transactionRemote.ts";
import { TransactionsPage } from "#browser/transactions/TransactionsPage.tsx";

export const Route = createFileRoute("/teams/$teamId/transactions")({
  ssr: false,
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context, params }) =>
    context.queryClient.ensureInfiniteQueryData(
      transactionQueries.list(transactionRemote, { team: params.teamId, state: "open" }),
    ),
  component: TransactionsRoute,
});

function TransactionsRoute(): JSX.Element {
  const params = Route.useParams();
  return <TransactionsPage teamId={params().teamId} remote={transactionRemote} />;
}
