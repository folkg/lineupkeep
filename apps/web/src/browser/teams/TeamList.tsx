import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import type { ActionState } from "#browser/shared-ui/actionState.ts";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { IconButton } from "#browser/shared-ui/IconButton.tsx";
import { RefreshIcon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { TeamAttention } from "./TeamAttention";
import { TeamControls } from "./TeamControls";
import { checkTallyLabel, lastCheckLine, pauseResumeLabel, teamContextLabel } from "./teamLabels";
import { TeamProviderLink } from "./TeamProviderLink";
import type { TeamRemote } from "./teamRemote";

export function TeamList(props: TeamListProps): JSX.Element {
  return (
    <Stack as="section" gap="md" labelledBy="teams-list-title">
      <SectionTitle
        id="teams-list-title"
        action={
          <IconButton
            confirmed
            label="Refresh teams"
            state={props.refreshState()}
            onClick={props.onRefreshTeams}
          >
            <RefreshIcon size="md" />
          </IconButton>
        }
      >
        Your teams
      </SectionTitle>
      <Text as="span" role="status" srOnly>
        {props.refreshState() === "done" ? "Teams refreshed." : ""}
      </Text>
      <Show
        when={!props.isLoading() && props.loadFailure() === null && allTeamsIdle(props.teams())}
      >
        <Notice tone="neutral" title="No teams are being checked.">
          <Text size="caption">Turn on Lineup checks for the teams you want managed.</Text>
        </Notice>
      </Show>
      <Show
        fallback={<LoadingState label="Loading teams">Loading your teams…</LoadingState>}
        when={!props.isLoading()}
      >
        <Show
          fallback={
            <ActionFeedback
              feedback={{
                type: "attention",
                message: "We could not load your teams.",
                recovery: {
                  label: "Refresh",
                  onAction: props.onRefresh,
                },
              }}
            />
          }
          when={props.loadFailure() === null}
        >
          <Show
            fallback={
              <EmptyState title="No teams yet.">
                <TextLink to="/account">Connect an account</TextLink> to import the teams this
                account can manage. If you join another league, refresh to import it.
              </EmptyState>
            }
            when={props.teams().length > 0}
          >
            <RuleList>
              <For each={props.teams()}>
                {(team) => <TeamRow team={team} remote={props.remote} />}
              </For>
            </RuleList>
          </Show>
        </Show>
      </Show>
    </Stack>
  );
}

function TeamRow(props: TeamRowProps): JSX.Element {
  return (
    <RuleListItem dense layout="columns">
      <Stack gap="xs">
        <Inline gap="sm">
          <TextLink params={{ teamId: props.team.team.id }} size="item" to="/teams/$teamId">
            {props.team.team.name}
          </TextLink>
          <TeamProviderLink team={props.team.team} />
        </Inline>
        <Text size="caption" tone="muted">
          {teamContextLabel(props.team.team, props.team.connectionCount)}
        </Text>
        <Show
          fallback={
            <Text numeric size="caption" tone="muted">
              No lineup checks have run yet.
            </Text>
          }
          when={props.team.lastRun}
        >
          {(run) => (
            <Text numeric size="caption" tone="muted">
              {lastCheckLine(run())}
            </Text>
          )}
        </Show>
        <Show when={checkTallyLabel(props.team.recentRuns)}>
          {(tally) => (
            <Text numeric size="caption" tone="faint">
              {tally()}
            </Text>
          )}
        </Show>
        <Show when={pauseResumeLabel(props.team.team.automation)}>
          {(note) => (
            <Text size="caption" tone="muted">
              {note()}
            </Text>
          )}
        </Show>
        <TeamAttention team={props.team} />
      </Stack>
      <TeamControls
        align="end"
        compact
        showPauseNote={false}
        showProvider={false}
        team={props.team}
        remote={props.remote}
      />
    </RuleListItem>
  );
}

type TeamListProps = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly refreshState: Accessor<ActionState>;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshTeams: () => void;
  readonly remote: TeamRemote;
};

type TeamRowProps = {
  readonly team: TeamSummaryView;
  readonly remote: TeamRemote;
};

function allTeamsIdle(teams: ReadonlyArray<TeamSummaryView>): boolean {
  return (
    teams.length > 0 &&
    teams.every(
      (summary) =>
        summary.connectionStatus === "ready" && summary.team.automation.status === "disabled",
    )
  );
}
