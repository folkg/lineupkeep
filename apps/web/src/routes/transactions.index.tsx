import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { transactionQueries } from "#browser/transactions/transactionQueries.ts";
import { transactionRemote } from "#browser/transactions/transactionRemote.ts";
import { TransactionsPage } from "#browser/transactions/TransactionsPage.tsx";

export const Route = createFileRoute("/transactions/")({
  ssr: true,
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context }) => {
    const query = transactionQueries.timeline(transactionRemote);
    if (context.queryClient.isMutating() > 0) {
      return context.queryClient.ensureInfiniteQueryData(query);
    }
    void context.queryClient.prefetchInfiniteQuery(query);
  },
  component: TransactionsRoute,
});

function TransactionsRoute(): JSX.Element {
  return <TransactionsPage remote={transactionRemote} />;
}
