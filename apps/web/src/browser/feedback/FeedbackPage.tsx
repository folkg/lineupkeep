import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
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
    initialTitle: () => props.initialTitle(),
    onRefresh: () => props.onRefresh(),
  });
  const about = (): string | undefined =>
    feedbackContextSummary(props.initialContext(), props.teamName());

  return (
    <AppShell>
      <Page
        lede="Report a bug, wrong data, or something that got in your way. Agents acting for this account can send reports too."
        title="Feedback"
      >
        <Stack gap="xl">
          <Stack as="section" gap="md" labelledBy="feedback-form-title">
            <SectionTitle id="feedback-form-title">Send a report</SectionTitle>
            <Show when={about()}>{(summary) => <Text size="body">{summary()}</Text>}</Show>
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
  readonly initialTitle: Accessor<string>;
  readonly teamName: Accessor<string | undefined>;
  readonly onRefresh: () => Promise<void>;
};
