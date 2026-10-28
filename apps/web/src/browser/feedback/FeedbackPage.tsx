import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { FeedbackContextView } from "#contracts/feedback/feedbackContract.ts";

import { feedbackKinds } from "./feedbackDraft";
import { FeedbackForm } from "./FeedbackForm";
import { feedbackContextSummary } from "./feedbackLabels";
import type { FeedbackListQueryOptions } from "./feedbackQueries";
import type { FeedbackRemote } from "./feedbackRemote";
import { FeedbackReportList } from "./FeedbackReportList";
import { useFeedbackPage } from "./useFeedbackPage";

export function FeedbackPage(props: FeedbackPageProps): JSX.Element {
  const page = useFeedbackPage({
    reportsQuery: () => props.reportsQuery(),
    remote: () => props.remote,
    initialContext: () => props.initialContext(),
    onRefresh: () => props.onRefresh(),
  });
  const about = (): string | undefined => feedbackContextSummary(props.initialContext());

  return (
    <AppShell>
      <Page
        lede="Report a bug, wrong data, or something that got in your way. Agents acting for this account can send reports too."
        title="Feedback"
      >
        <Stack gap="xl">
          <Stack as="section" gap="md" labelledBy="feedback-form-title">
            <Heading id="feedback-form-title" level={2} size="section">
              Send a report
            </Heading>
            <Show when={about()}>
              {(summary) => (
                <Text size="caption" tone="muted">
                  {summary()}
                </Text>
              )}
            </Show>
            <FeedbackForm
              draft={page.draft()}
              errors={page.errors()}
              submitting={page.submitting()}
              onBody={page.setBody}
              onKind={(value) => page.setKind(feedbackKinds.find((kind) => kind === value) ?? "")}
              onSubmit={page.send}
              onTitle={page.setTitle}
            />
            <ActionFeedback feedback={page.feedback()} />
          </Stack>
          <FeedbackReportList
            isLoading={page.isLoading}
            loadFailure={page.loadFailure}
            reports={page.reports}
            onRefresh={page.refresh}
          />
        </Stack>
      </Page>
    </AppShell>
  );
}

type FeedbackPageProps = {
  readonly reportsQuery: Accessor<FeedbackListQueryOptions>;
  readonly remote: FeedbackRemote;
  readonly initialContext: Accessor<FeedbackContextView>;
  readonly onRefresh: () => Promise<void>;
};
