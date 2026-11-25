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
import { ArrowLeftIcon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type {
  TeamCardView,
  TeamControlData,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { RunActivity } from "./RunActivity";
import { TeamAttention } from "./TeamAttention";
import { TeamControls } from "./TeamControls";
import { showsProvider, teamContextLabel } from "./teamLabels";
import { TeamNote } from "./TeamNote";
import { toTeamOverviewFromCard } from "./teamOverviewFromCard";
import { teamLastRun } from "./teamPending";
import { TeamProviderLink } from "./TeamProviderLink";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
import { TeamSeasonOverview } from "./TeamSeasonOverview";
import { useTeamNote } from "./useTeamNote";
import { useTeamOverview } from "./useTeamOverview";
import { useTeamsPage } from "./useTeamsPage";

export function TeamDetailPage(props: TeamDetailPageProps): JSX.Element {
  const page = useTeamsPage({
    teamsQuery: () => props.teamsQuery(),
    includeCards: true,
    teamId: () => props.teamId,
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });
  const team = (): TeamSummaryView | undefined => page.team();
  const readyTeam = (): TeamSummaryView | undefined =>
    page.cardFactsLoading() ? undefined : team();
  const card = (): TeamCardView | undefined => page.card();
  const teams = (): ReadonlyArray<TeamSummaryView> => page.teams();
  const showProvider = (): boolean => showsProvider(teams());

  return (
    <AppShell footer={<TeamReportFooter team={team} />}>
      <Page
        back={
          <TextLink leadingIcon={<ArrowLeftIcon size="sm" />} to="/teams" type="meta">
            All teams
          </TextLink>
        }
        title={team()?.team.name ?? "Team"}
        titleVariant="name"
      >
        <UnsavedChangesScope>
          <Stack gap="lg">
            <Show
              fallback={
                <Show
                  fallback={
                    <EmptyState title="Team not found.">
                      This team is not available to the current account. Return to the team list.
                    </EmptyState>
                  }
                  when={page.isLoading() || team() !== undefined}
                >
                  <LoadingState label="Loading team">Loading this team…</LoadingState>
                </Show>
              }
              when={readyTeam()}
            >
              {(summary) => (
                <TeamDetail
                  team={summary()}
                  card={card()}
                  remote={props.remote}
                  showProvider={showProvider()}
                  onOptimistic={page.beginControl}
                />
              )}
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
  const needsOverview = (): boolean =>
    props.card === undefined ||
    props.card.season?.format === "rotisserie" ||
    props.card.season?.maxGamesPlayed !== undefined ||
    props.card.season?.maxInningsPitched !== undefined;
  const overview = useTeamOverview(
    () => props.team.team.id,
    () => props.remote,
    needsOverview,
  );
  const facts = (): ReturnType<typeof toTeamOverviewFromCard> | undefined =>
    props.card === undefined
      ? overview.loading()
        ? undefined
        : overview.facts()
      : toTeamOverviewFromCard(props.card, overview.facts());
  return (
    <Stack gap="xl">
      <Stack gap="md">
        <Stack gap="2xs">
          <Text type="meta" tone="muted">
            {teamContextLabel(props.team.team, props.showProvider)}
          </Text>
          <TeamAttention team={props.team} />
        </Stack>
        <Inline fullWidth growFirst gap="md" justify="between">
          <TeamControls team={props.team} remote={props.remote} onOptimistic={props.onOptimistic} />
          <TeamProviderLink team={props.team.team} showProvider={props.showProvider} />
        </Inline>
      </Stack>

      <TeamSeasonOverview
        facts={facts()}
        categoryValuesLoading={props.card !== undefined && overview.loading()}
        failed={props.card === undefined && overview.failed()}
      />

      <Stack as="section" gap="sm" labelledBy="team-activity-title">
        <SectionTitle id="team-activity-title">Lineup runs</SectionTitle>
        <Show fallback={<NoRunsToday team={props.team} />} when={props.team.recentRuns.length > 0}>
          <RunActivity runs={props.team.recentRuns} />
        </Show>
      </Stack>

      <TeamNote note={note} />
    </Stack>
  );
}

function TeamReportFooter(props: {
  readonly team: Accessor<TeamSummaryView | undefined>;
}): JSX.Element {
  return (
    <Show
      fallback={
        <TextLink tone="quiet" to="/feedback">
          Feedback
        </TextLink>
      }
      when={props.team()}
    >
      {(team) => (
        <TextLink
          search={{ surface: "team", team: team().team.id, teamName: team().team.name }}
          tone="quiet"
          to="/feedback"
        >
          Report a problem with this team
        </TextLink>
      )}
    </Show>
  );
}

function NoRunsToday(props: NoRunsTodayProps): JSX.Element {
  return (
    <EmptyState title="No lineup runs today.">
      <Show
        fallback="Runs appear after the first scheduled or manual check."
        when={teamLastRun(props.team)}
      >
        {(run) => (
          <>
            Last run: <Time datetime={run().updatedAt}>{formatReaderTime(run().updatedAt)}</Time>
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
  readonly card: TeamCardView | undefined;
  readonly remote: TeamRemote;
  readonly showProvider: boolean;
  readonly onOptimistic: (input: TeamControlData) => void;
};

type NoRunsTodayProps = {
  readonly team: TeamSummaryView;
};
