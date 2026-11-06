import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import {
  UnsavedChangesScope,
  UnsavedNavigationGuard,
} from "#browser/navigation/UnsavedChanges.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { ButtonLink } from "#browser/shared-ui/ButtonLink.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
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
import { TeamProviderLink } from "./TeamProviderLink";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
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
  const titleAside = (): JSX.Element | undefined => {
    const summary = team();
    return summary === undefined ? undefined : <TeamProviderLink team={summary.team} />;
  };

  return (
    <AppShell>
      <Page
        back={
          <TextLink tone="quiet" to="/teams">
            Back to teams
          </TextLink>
        }
        title={team()?.team.name ?? "Team"}
        titleAside={titleAside()}
      >
        <UnsavedChangesScope>
          <Stack gap="lg">
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
            {teamContextLabel(props.team.team, props.team.connectionCount)}
          </Text>
          <TeamAttention team={props.team} />
        </Stack>
        <TeamControls team={props.team} remote={props.remote} />
      </Stack>

      <Stack as="section" gap="sm" labelledBy="team-activity-title">
        <SectionTitle id="team-activity-title">Recent activity</SectionTitle>
        <Show
          fallback={<NoChecksToday team={props.team} />}
          when={props.team.recentRuns.length > 0}
        >
          <RunActivity runs={props.team.recentRuns} />
        </Show>
      </Stack>

      <TeamNote note={note} />

      <Inline gap="sm">
        <ButtonLink
          variant="secondary"
          search={{
            surface: "team",
            team: props.team.team.id,
            teamName: props.team.team.name,
          }}
          to="/feedback"
        >
          Report a problem with this team
        </ButtonLink>
      </Inline>
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
