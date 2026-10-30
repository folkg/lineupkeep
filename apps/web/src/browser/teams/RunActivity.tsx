import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Disclosure } from "#browser/shared-ui/Disclosure.tsx";
import { formatDateTime, formatReaderTime } from "#browser/shared-ui/formatTime.ts";
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
            <Show when={quietRuns(entry)} fallback={<RunEntry entry={entry} />}>
              {(runs) => <QuietGroup runs={runs()} />}
            </Show>
          </RuleListItem>
        )}
      </For>
    </RuleList>
  );
}

function QuietGroup(props: { readonly runs: ReadonlyArray<LineupRunView> }): JSX.Element {
  return (
    <Disclosure bordered={false} summary={<QuietGroupSummary runs={props.runs} />}>
      <RuleList>
        <For each={props.runs}>
          {(run) => (
            <RuleListItem>
              <RunLine run={run} />
              <RunLink run={run} />
            </RuleListItem>
          )}
        </For>
      </RuleList>
    </Disclosure>
  );
}

function QuietGroupSummary(props: { readonly runs: ReadonlyArray<LineupRunView> }): JSX.Element {
  const span = (): QuietGroupSpan => quietGroupSpan(props.runs);
  return (
    <>
      {span().count} checks changed nothing between{" "}
      <Time datetime={span().from}>{formatDateTime(span().from)}</Time> and{" "}
      <Time datetime={span().to}>{formatDateTime(span().to)}</Time>
    </>
  );
}

function RunEntry(props: { readonly entry: RunActivityEntry }): JSX.Element {
  return (
    <Show when={props.entry.type === "run" ? props.entry.run : undefined}>
      {(run) => (
        <Stack gap="xs">
          <RunLine run={run()} />
          <RunLink run={run()} />
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
        <Text size="caption">
          {runStatusLabel(props.run.status)} · {targetLabel(props.run.target)}
        </Text>
        <Text size="caption" tone="faint">
          <Time datetime={props.run.updatedAt}>{formatReaderTime(props.run.updatedAt)}</Time>
        </Text>
      </Inline>
      <Text size="caption" tone="muted">
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
