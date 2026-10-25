import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Definition, DefinitionList } from "#browser/shared-ui/DefinitionList.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import type { LineupRunView } from "#contracts/connections/teamContract.ts";

import { describeRunFailure } from "./teamFailure";
import {
  formatDateTime,
  runExplanation,
  runStatusLabel,
  targetLabel,
  triggerLabel,
} from "./teamLabels";
import type { TeamListQueryOptions, TeamRunQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
import { useRunPage } from "./useRunPage";

export function RunDetailPage(props: RunDetailPageProps): JSX.Element {
  const page = useRunPage({
    runQuery: () => props.runQuery(),
    teamsQuery: () => props.teamsQuery(),
    onRefresh: () => props.onRefresh(),
  });

  return (
    <AppShell>
      <Page lede="What the durable lineup run checked and what it observed." title="Lineup run">
        <Stack gap="lg">
          <Show
            fallback={<LoadingState label="Loading run">Loading this run…</LoadingState>}
            when={!page.isLoading()}
          >
            <Show
              fallback={
                <Text size="body" tone="muted">
                  {page.failure() === undefined || page.failure() === null
                    ? "This run is not available to the current account."
                    : describeRunFailure(page.failure())}
                </Text>
              }
              when={page.run()}
            >
              {(run) => (
                <RunDetail
                  run={run()}
                  teamName={page.team()?.team.name ?? "Unknown team"}
                  teamId={run().team}
                />
              )}
            </Show>
          </Show>
          <TextLink to="/teams">All teams</TextLink>
        </Stack>
      </Page>
    </AppShell>
  );
}

function RunDetail(props: {
  readonly run: LineupRunView;
  readonly teamName: string;
  readonly teamId: string;
}): JSX.Element {
  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Heading level={2} size="section">
          {props.teamName}
        </Heading>
        <Inline gap="sm">
          <Text size="caption">
            {runStatusLabel(props.run.status)} · {targetLabel(props.run.target)}
          </Text>
          <Text size="caption" tone="faint">
            {triggerLabel(props.run)}
          </Text>
        </Inline>
        <Text size="body">{runExplanation(props.run)}</Text>
      </Stack>

      <DefinitionList>
        <Definition term="Started" value={formatDateTime(props.run.createdAt)} />
        <Definition term="Last updated" value={formatDateTime(props.run.updatedAt)} />
        <Definition term="Attempts" value={String(props.run.attempts)} />
        <Definition term="Team" value={props.teamName} />
        <Definition term="Implementation" value={props.run.implementationVersion} />
        <Show when={props.run.pending?.retryAt}>
          {(retryAt) => <Definition term="Retry at" value={formatDateTime(retryAt())} />}
        </Show>
      </DefinitionList>

      <Show when={props.run.outcome}>
        {(outcome) => (
          <Stack gap="sm">
            <Heading level={2} size="section">
              Observed result
            </Heading>
            <Text size="caption" tone="muted">
              {outcome().verified ? "Verified against the provider." : "Not yet verified."}
              {outcome().reconciled ? " Reconciled after an uncertain write." : ""}
            </Text>
            <Show
              fallback={
                <Text size="caption" tone="muted">
                  No player assignments needed to change.
                </Text>
              }
              when={outcome().changes.length > 0}
            >
              <RuleList>
                <For each={outcome().changes}>
                  {(change) => (
                    <RuleListItem>
                      <Text size="caption" weight="semibold">
                        {change.name}
                      </Text>
                      <Text size="caption" tone="muted">
                        {change.from} → {change.to}
                      </Text>
                    </RuleListItem>
                  )}
                </For>
              </RuleList>
            </Show>
            <Text size="caption" tone="faint">
              {outcome().lockedPlayers} locked · {outcome().editablePlayers} editable players
            </Text>
          </Stack>
        )}
      </Show>
    </Stack>
  );
}

type RunDetailPageProps = {
  readonly runId: string;
  readonly runQuery: Accessor<TeamRunQueryOptions>;
  readonly teamsQuery: Accessor<TeamListQueryOptions>;
  readonly remote: TeamRemote;
  readonly onRefresh: () => Promise<void>;
};
