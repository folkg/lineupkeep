import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import {
  automationLabel,
  availabilityLabel,
  connectionLabel,
  formatDateTime,
  pauseResumeLabel,
  runExplanation,
  runStatusLabel,
  targetLabel,
} from "./teamLabels";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
import { useTeamsPage } from "./useTeamsPage";

export function TeamDetailPage(props: TeamDetailPageProps): JSX.Element {
  const page = useTeamsPage({
    teamsQuery: () => props.teamsQuery(),
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });
  const team = (): TeamSummaryView | undefined =>
    page.teams().find((candidate) => candidate.team.id === props.teamId);

  return (
    <AppShell>
      <Page
        lede="Automation settings and recent lineup activity for this team."
        title={team()?.team.name ?? "Team"}
      >
        <Stack gap="lg">
          <TextLink to="/teams">All teams</TextLink>
          <Show
            fallback={<LoadingState label="Loading team">Loading this team…</LoadingState>}
            when={!page.isLoading()}
          >
            <Show
              fallback={
                <EmptyState title="Team not found.">
                  This team is not available to the current account. Return to the team list.
                </EmptyState>
              }
              when={team()}
            >
              {(summary) => (
                <TeamDetail
                  pending={page.pendingTeam() === summary().team.id}
                  team={summary()}
                  onDisable={() => page.setEnabled(summary(), false)}
                  onEnable={() => page.setEnabled(summary(), true)}
                  onPause={() => page.pause(summary())}
                  onResume={() => page.resume(summary())}
                />
              )}
            </Show>
          </Show>
          <ActionFeedback feedback={page.feedback()} />
        </Stack>
      </Page>
    </AppShell>
  );
}

function TeamDetail(props: TeamDetailProps): JSX.Element {
  const enabled = (): boolean => props.team.team.automation.status !== "disabled";
  const paused = (): boolean =>
    props.team.team.automation.status === "paused-until-fantasy-day-end";
  return (
    <Stack gap="lg">
      <Stack gap="md">
        <Inline gap="md">
          <StateLine label="Availability" value={availabilityLabel(props.team)} />
          <StateLine label="Automation" value={automationLabel(props.team)} />
          <StateLine label="Yahoo" value={connectionLabel(props.team)} />
        </Inline>
        <Show when={pauseResumeLabel(props.team)}>
          {(label) => (
            <Text size="caption" tone="muted">
              {label()}
            </Text>
          )}
        </Show>
        <Inline gap="sm">
          <Show
            when={enabled()}
            fallback={
              <Button pending={props.pending} pendingLabel="Enabling…" onClick={props.onEnable}>
                Enable automation
              </Button>
            }
          >
            <Show
              when={paused()}
              fallback={
                <Button
                  pending={props.pending}
                  pendingLabel="Pausing…"
                  variant="secondary"
                  onClick={props.onPause}
                >
                  Pause for rest of fantasy day
                </Button>
              }
            >
              <Button pending={props.pending} pendingLabel="Resuming…" onClick={props.onResume}>
                Resume automation
              </Button>
            </Show>
            <Button
              pending={props.pending}
              pendingLabel="Saving…"
              variant="quiet"
              onClick={props.onDisable}
            >
              Disable
            </Button>
          </Show>
          <Show when={props.team.connectionStatus === "reconnect-required"}>
            <TextLink to="/connections">Reconnect Yahoo</TextLink>
          </Show>
        </Inline>
      </Stack>

      <Stack as="section" gap="sm" labelledBy="team-activity-title">
        <Heading id="team-activity-title" level={2} size="section">
          Recent activity
        </Heading>
        <Show
          fallback={
            <EmptyState title="No activity yet.">
              Lineup runs will appear here after the first scheduled or manual check.
            </EmptyState>
          }
          when={props.team.recentRuns.length > 0}
        >
          <RuleList>
            <For each={props.team.recentRuns}>
              {(run) => (
                <RuleListItem>
                  <Inline gap="sm" justify="between">
                    <Text size="caption">
                      {runStatusLabel(run.status)} · {targetLabel(run.target)}
                    </Text>
                    <Text size="caption" tone="faint">
                      {formatDateTime(run.updatedAt)}
                    </Text>
                  </Inline>
                  <Text size="caption" tone="muted">
                    {runExplanation(run)}
                  </Text>
                  <TextLink params={{ runId: run.run }} to="/runs/$runId">
                    View run detail
                  </TextLink>
                </RuleListItem>
              )}
            </For>
          </RuleList>
        </Show>
      </Stack>
    </Stack>
  );
}

function StateLine(props: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <Text size="caption">
      {props.label}: {props.value}
    </Text>
  );
}

type TeamDetailPageProps = {
  readonly teamId: string;
  readonly teamsQuery: Accessor<TeamListQueryOptions>;
  readonly remote: TeamRemote;
  readonly onRefresh: () => Promise<void>;
};

type TeamDetailProps = {
  readonly team: TeamSummaryView;
  readonly pending: boolean;
  readonly onEnable: () => void;
  readonly onDisable: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
};
