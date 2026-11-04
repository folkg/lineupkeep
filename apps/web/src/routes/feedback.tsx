import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { FeedbackPage } from "#browser/feedback/FeedbackPage.tsx";
import {
  feedbackContextFromSearch,
  feedbackTitleFromSearch,
  parseFeedbackSearch,
} from "#browser/feedback/feedbackPrefill.ts";
import { feedbackQueries, refreshFeedbackReports } from "#browser/feedback/feedbackQueries.ts";
import { feedbackRemote } from "#browser/feedback/feedbackRemote.ts";
import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";

export const Route = createFileRoute("/feedback")({
  ssr: true,
  validateSearch: parseFeedbackSearch,
  context: () => ({ reportsQuery: feedbackQueries.list(feedbackRemote) }),
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context }) => context.queryClient.ensureQueryData(context.reportsQuery),
  component: FeedbackRoute,
});

function FeedbackRoute(): JSX.Element {
  const context = Route.useRouteContext();
  const search = Route.useSearch();
  return (
    <FeedbackPage
      reportsQuery={() => context().reportsQuery}
      remote={feedbackRemote}
      initialContext={() => feedbackContextFromSearch(search())}
      initialTitle={() => feedbackTitleFromSearch(search())}
      teamName={() => search().teamName}
      onRefresh={() => refreshFeedbackReports(context().queryClient)}
    />
  );
}
