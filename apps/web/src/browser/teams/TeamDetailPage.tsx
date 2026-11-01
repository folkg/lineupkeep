import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import {
  UnsavedChangesScope,
  UnsavedNavigationGuard,
} from "#browser/navigation/UnsavedChanges.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { RunActivity } from "./RunActivity";
import { TeamAttention } from "./TeamAttention";
import { TeamControls } from "./TeamControls";
import { teamContextLabel } from "./teamLabels";
import { TeamNote } from "./TeamNote";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
import { TeamRoster } from "./TeamRoster";
import { useTeamNote } from "./useTeamNote";
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
      <Page title={team()?.team.name ?? "Team"}>
        <UnsavedChangesScope>
          <Stack gap="lg">
            <TextLink to="/teams">Back to teams</TextLink>
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
                {(summary) => <TeamDetail team={summary()} remote={props.remote} />}
              </Show>
            </Show>
            <ActionFeedback feedback={page.feedback()} />
          </Stack>
          <UnsavedNavigationGuard shouldBlock={() => true} />
        </UnsavedChangesScope>
      </Page>
    </AppShell>
  );
}

function TeamDetail(props: TeamDetailProps): JSX.Element {
  const note = useTeamNote({ team: () => props.team, remote: () => props.remote });
  return (
    <Stack gap="lg">
      <Stack gap="md">
        <Stack gap="xs">
          <Text size="caption" tone="muted">
            {teamContextLabel(props.team.team)}
          </Text>
          <TeamAttention team={props.team} />
        </Stack>
        <TeamControls team={props.team} remote={props.remote} />
        <TextLink search={{ surface: "team", team: props.team.team.id }} to="/feedback">
          Report a problem with this team
        </TextLink>
      </Stack>

      <TeamNote note={note} />
      <TeamRoster remote={props.remote} teamId={props.team.team.id} />

      <Stack as="section" gap="sm" labelledBy="team-activity-title">
        <Heading id="team-activity-title" level={2} size="section">
          Recent activity
        </Heading>
        <Text size="caption" tone="muted">
          Newest first. Checks that changed nothing are grouped.
        </Text>
        <Show
          fallback={<NoChecksToday team={props.team} />}
          when={props.team.recentRuns.length > 0}
        >
          <RunActivity runs={props.team.recentRuns} />
        </Show>
      </Stack>
    </Stack>
  );
}

function NoChecksToday(props: NoChecksTodayProps): JSX.Element {
  return (
    <EmptyState title="No checks today.">
      <Show
        fallback="Checks will appear here after the first scheduled or manual run."
        when={props.team.lastRun}
      >
        {(run) => (
          <>
            The last check was{" "}
            <Time datetime={run().updatedAt}>{formatReaderTime(run().updatedAt)}</Time>.
          </>
        )}
      </Show>
    </EmptyState>
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
  readonly remote: TeamRemote;
};

type NoChecksTodayProps = {
  readonly team: TeamSummaryView;
};
