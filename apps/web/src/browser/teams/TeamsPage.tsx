import type { JSX } from "@solidjs/web";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";

import { TeamList } from "./TeamList";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
import { useTeamsPage } from "./useTeamsPage";

export function TeamsPage(props: TeamsPageProps): JSX.Element {
  const page = useTeamsPage({
    teamsQuery: () => props.teamsQuery(),
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });

  return (
    <AppShell>
      <Page
        lede="Choose which teams Lineupkeep manages. You can turn lineup checks on or off for each team, and pause one when you want to take over."
        title="Teams"
      >
        <Stack gap="lg">
          <TeamList
            isLoading={page.isLoading}
            loadFailure={page.loadFailure}
            pendingTeam={page.pendingTeam}
            refreshing={page.refreshing}
            teams={page.teams}
            onPause={page.pause}
            onRefresh={page.refresh}
            onRefreshTeams={page.refreshTeams}
            onResume={page.resume}
            onSetEnabled={page.setEnabled}
          />
          <ActionFeedback feedback={page.feedback()} />
        </Stack>
      </Page>
    </AppShell>
  );
}

type TeamsPageProps = {
  readonly teamsQuery: Accessor<TeamListQueryOptions>;
  readonly remote: TeamRemote;
  readonly onRefresh: () => Promise<void>;
};
