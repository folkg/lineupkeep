import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Definition, DefinitionList } from "#browser/shared-ui/DefinitionList.tsx";
import { formatDateTime, formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type { LineupRunView } from "#contracts/connections/teamContract.ts";

import { describeRunFailure } from "./teamFailure";
import {
  provenanceExplanation,
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
  const providerName = (): string | undefined => {
    const team = page.team();
    return team === undefined ? undefined : providerDisplayName(team.team.provider);
  };

  return (
    <AppShell>
      <Page
        back={
          <Show
            fallback={
              <TextLink tone="quiet" to="/teams">
                Back to teams
              </TextLink>
            }
            when={page.team()}
          >
            {(team) => (
              <TextLink params={{ teamId: team().team.id }} tone="quiet" to="/teams/$teamId">
                Back to {team().team.name}
              </TextLink>
            )}
          </Show>
        }
        title="Lineup run"
      >
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
                  providerName={providerName()}
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
  readonly providerName: string | undefined;
  readonly teamName: string;
  readonly teamId: string;
}): JSX.Element {
  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <SectionTitle>{props.teamName}</SectionTitle>
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
        <Show when={props.run.pending?.retryAt}>
          {(retryAt) => <Definition term="Retry at" value={formatReaderTime(retryAt())} />}
        </Show>
      </DefinitionList>

      <TextLink search={{ surface: "run", team: props.teamId }} tone="quiet" to="/feedback">
        Report a problem with this run
      </TextLink>

      <Show when={props.run.outcome}>
        {(outcome) => (
          <Stack gap="sm">
            <SectionTitle>What the run found</SectionTitle>
            <Show when={outcome().provenance}>
              {(provenance) => (
                <Text size="caption" tone="muted">
                  {provenanceExplanation(provenance())}
                </Text>
              )}
            </Show>
            <Text size="caption" tone="muted">
              {outcome().verified ? confirmedLine(props.providerName) : "Not yet confirmed."}
              {outcome().reconciled ? " Checked again after an unconfirmed write." : ""}
            </Text>
            <Show
              fallback={
                <Text size="caption" tone="muted">
                  No player changes were needed.
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
            <Show when={outcome().leftInPlace}>
              {(leftInPlace) => (
                <Stack gap="sm">
                  <SectionTitle level={3}>Left in place</SectionTitle>
                  <RuleList>
                    <For each={leftInPlace()}>
                      {(player) => (
                        <RuleListItem>
                          <Inline gap="sm" align="baseline">
                            <Text size="caption" weight="semibold">
                              {player.name}
                            </Text>
                            <Text size="caption" tone="faint">
                              {player.slot}
                            </Text>
                          </Inline>
                          <Text size="body" tone="muted">
                            {player.reason}
                          </Text>
                        </RuleListItem>
                      )}
                    </For>
                  </RuleList>
                </Stack>
              )}
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

function confirmedLine(providerName: string | undefined): string {
  return providerName === undefined ? "Confirmed." : `Confirmed on ${providerName}.`;
}

type RunDetailPageProps = {
  readonly runId: string;
  readonly runQuery: Accessor<TeamRunQueryOptions>;
  readonly teamsQuery: Accessor<TeamListQueryOptions>;
  readonly remote: TeamRemote;
  readonly onRefresh: () => Promise<void>;
};
