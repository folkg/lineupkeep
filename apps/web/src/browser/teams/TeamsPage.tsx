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
        lede="Lineup checks run once an hour for each team you turn on. Pause a team when you want to take over."
        title="Teams"
      >
        <Stack gap="lg">
          <TeamList
            isLoading={page.isLoading}
            loadFailure={page.loadFailure}
            refreshing={page.refreshing}
            remote={props.remote}
            teams={page.teams}
            onRefresh={page.refresh}
            onRefreshTeams={page.refreshTeams}
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
