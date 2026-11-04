import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { FeedbackReportView } from "#contracts/feedback/feedbackContract.ts";

import {
  feedbackContextSummary,
  feedbackKindLabel,
  feedbackStatusDetail,
  feedbackStatusLabel,
  formatFeedbackDate,
} from "./feedbackLabels";

export function FeedbackReportList(props: FeedbackReportListProps): JSX.Element {
  return (
    <Stack as="section" gap="md" labelledBy="feedback-reports-title">
      <SectionTitle
        id="feedback-reports-title"
        action={
          <Button variant="link" onClick={() => void props.onRefresh()}>
            Refresh
          </Button>
        }
      >
        Your reports
      </SectionTitle>
      <Show
        fallback={<LoadingState label="Loading reports">Loading your reports…</LoadingState>}
        when={!props.isLoading()}
      >
        <Show
          fallback={
            <ActionFeedback
              feedback={{
                type: "attention",
                message: "We could not load your reports.",
                recovery: {
                  label: "Refresh",
                  pendingLabel: "Refreshing…",
                  onAction: props.onRefresh,
                },
              }}
            />
          }
          when={props.loadFailure() === null}
        >
          <Show
            fallback={
              <EmptyState title="No reports yet.">
                Send one above. Reports and their status stay listed here.
              </EmptyState>
            }
            when={props.reports().length > 0}
          >
            <RuleList>
              <For each={props.reports()}>{(report) => <ReportRow report={report} />}</For>
            </RuleList>
          </Show>
        </Show>
      </Show>
      <Text size="caption" tone="faint">
        Reports stay listed while they are open. Closed reports are removed 180 days after they
        close.
      </Text>
    </Stack>
  );
}

function ReportRow(props: { readonly report: FeedbackReportView }): JSX.Element {
  const about = (): string | undefined => feedbackContextSummary(props.report.context);
  return (
    <RuleListItem>
      <Inline gap="sm">
        <Text size="caption" weight="semibold">
          {props.report.title}
        </Text>
        <Text as="span" size="caption" tone="muted">
          {feedbackKindLabel(props.report.kind)} · {feedbackStatusLabel(props.report.status)}
        </Text>
      </Inline>
      <Text size="caption" tone="muted" wrap="preserve">
        {props.report.body}
      </Text>
      <Text size="caption" tone="muted">
        {feedbackStatusDetail(props.report)}
      </Text>
      <Inline gap="sm">
        <Text as="span" numeric size="caption" tone="faint">
          Reported {formatFeedbackDate(props.report.createdAt)}
        </Text>
        <Show when={about()}>
          {(summary) => (
            <Text as="span" size="caption" tone="faint">
              {summary()}
            </Text>
          )}
        </Show>
        <Text as="span" size="caption" tone="faint">
          From {props.report.submitter === "agent" ? "an agent" : "this account"}
        </Text>
      </Inline>
    </RuleListItem>
  );
}

type FeedbackReportListProps = {
  readonly reports: Accessor<ReadonlyArray<FeedbackReportView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly onRefresh: () => Promise<void>;
};
