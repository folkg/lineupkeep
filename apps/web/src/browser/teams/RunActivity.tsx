import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import {
  formatRangeEnd,
  formatRangeStart,
  formatReaderTime,
} from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type { LineupRunView } from "#contracts/connections/teamContract.ts";

import { groupRuns } from "./teamActivity";
import type { RunActivityEntry } from "./teamActivity";
import { quietGroupSpan, runExplanation, runStatusLabel, targetLabel } from "./teamLabels";
import type { QuietGroupSpan } from "./teamLabels";

export function RunActivity(props: RunActivityProps): JSX.Element {
  return (
    <RuleList>
      <For each={groupRuns(props.runs)}>
        {(entry) => (
          <RuleListItem>
            <Show fallback={<RunEntry entry={entry} />} when={quietRuns(entry)}>
              {(runs) => <QuietGroupSummary runs={runs()} />}
            </Show>
          </RuleListItem>
        )}
      </For>
    </RuleList>
  );
}

function QuietGroupSummary(props: { readonly runs: ReadonlyArray<LineupRunView> }): JSX.Element {
  const span = (): QuietGroupSpan => quietGroupSpan(props.runs);
  return (
    <>
      {span().count} checks changed nothing{" "}
      <Show
        fallback={
          <>
            at <Time datetime={span().from}>{formatRangeStart(span().from, span().to)}</Time>
          </>
        }
        when={span().from !== span().to}
      >
        from <Time datetime={span().from}>{formatRangeStart(span().from, span().to)}</Time> to{" "}
        <Time datetime={span().to}>{formatRangeEnd(span().from, span().to)}</Time>
      </Show>
    </>
  );
}

function RunEntry(props: { readonly entry: RunActivityEntry }): JSX.Element {
  return (
    <Show when={props.entry.type === "run" ? props.entry.run : undefined}>
      {(run) => (
        <Stack gap="xs">
          <RunLine run={run()} />
          <Show
            when={run().outcome?.kind !== "skipped" && run().outcome?.kind !== "superseded"}
          >
            <RunLink run={run()} />
          </Show>
        </Stack>
      )}
    </Show>
  );
}

function quietRuns(entry: RunActivityEntry): ReadonlyArray<LineupRunView> | undefined {
  return entry.type === "quiet" ? entry.runs : undefined;
}

function RunLine(props: { readonly run: LineupRunView }): JSX.Element {
  return (
    <>
      <Inline gap="sm" justify="between">
        <Text numeric type="body">
          {runStatusLabel(props.run.status)} · {targetLabel(props.run.target)}
        </Text>
        <Text type="meta" tone="faint">
          <Time datetime={props.run.updatedAt}>{formatReaderTime(props.run.updatedAt)}</Time>
        </Text>
      </Inline>
      <Text type="body" numeric tone="muted">
        {runExplanation(props.run)}
      </Text>
    </>
  );
}

function RunLink(props: { readonly run: LineupRunView }): JSX.Element {
  return (
    <TextLink params={{ runId: props.run.run }} to="/runs/$runId">
      View run detail
    </TextLink>
  );
}

type RunActivityProps = {
  readonly runs: ReadonlyArray<LineupRunView>;
};
