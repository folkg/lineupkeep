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
            <Show fallback={<RunEntry run={runForEntry(entry)} />} when={quietRuns(entry)}>
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
    <Text type="meta" tone="muted">
      {span().count === 1
        ? "1 lineup run made no change"
        : `${String(span().count)} lineup runs made no change`}{" "}
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
    </Text>
  );
}

function RunEntry(props: { readonly run: LineupRunView }): JSX.Element {
  return (
    <Stack gap="xs">
      <RunLine run={props.run} />
      <Show
        when={props.run.outcome?.kind !== "skipped" && props.run.outcome?.kind !== "superseded"}
      >
        <RunLink run={props.run} />
      </Show>
    </Stack>
  );
}

function runForEntry(entry: RunActivityEntry): LineupRunView {
  if (entry.type === "run") {
    return entry.run;
  }
  const run = entry.runs[0];
  if (run === undefined) {
    throw new Error("A quiet group needs at least one run");
  }
  return run;
}

function quietRuns(entry: RunActivityEntry): ReadonlyArray<LineupRunView> | undefined {
  if (entry.type !== "quiet") {
    return undefined;
  }
  const only = entry.runs[0];
  return entry.runs.length === 1 && only?.outcome?.kind === "skipped" ? undefined : entry.runs;
}

function RunLine(props: { readonly run: LineupRunView }): JSX.Element {
  return (
    <>
      <Inline gap="sm" justify="between">
        <Text type="body-strong">
          {runStatusLabel(props.run.status)} · {targetLabel(props.run.target)}
        </Text>
        <Text type="meta" tone="muted">
          <Time datetime={props.run.updatedAt}>{formatReaderTime(props.run.updatedAt)}</Time>
        </Text>
      </Inline>
      <Text type="meta" tone="muted">
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
