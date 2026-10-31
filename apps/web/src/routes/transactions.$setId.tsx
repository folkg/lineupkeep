import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { transactionQueries } from "#browser/transactions/transactionQueries.ts";
import { transactionRemote } from "#browser/transactions/transactionRemote.ts";
import { TransactionReviewPage } from "#browser/transactions/TransactionReviewPage.tsx";

export const Route = createFileRoute("/transactions/$setId")({
  ssr: true,
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(transactionQueries.review(transactionRemote, params.setId)),
  component: TransactionReviewRoute,
});

function TransactionReviewRoute(): JSX.Element {
  const params = Route.useParams();
  return (
    <TransactionReviewPage
      reviewQuery={() => transactionQueries.review(transactionRemote, params().setId)}
      remote={() => transactionRemote}
    />
  );
}
