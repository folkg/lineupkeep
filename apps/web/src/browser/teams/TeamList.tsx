import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { TeamAttention } from "./TeamAttention";
import { TeamControls } from "./TeamControls";
import { checkTallyLabel, lastCheckLine, teamContextLabel } from "./teamLabels";
import type { TeamRemote } from "./teamRemote";

export function TeamList(props: TeamListProps): JSX.Element {
  return (
    <Stack as="section" gap="md" labelledBy="teams-list-title">
      <Inline gap="md">
        <Heading id="teams-list-title" level={2} size="section">
          Your teams
        </Heading>
        <Button
          pending={props.refreshing()}
          pendingLabel="Refreshing teams…"
          variant="link"
          onClick={props.onRefreshTeams}
        >
          Refresh teams
        </Button>
      </Inline>
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
                  pendingLabel: "Refreshing…",
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
                <TextLink to="/connections">Connect {defaultProviderName()}</TextLink> to import the
                teams this account can manage. If you join another league on {defaultProviderName()}
                , refresh to import it.
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
    <RuleListItem layout="columns">
      <Stack gap="xs">
        <TextLink params={{ teamId: props.team.team.id }} size="item" to="/teams/$teamId">
          {props.team.team.name}
        </TextLink>
        <Text size="caption" tone="muted">
          {teamContextLabel(props.team.team)}
        </Text>
        <Show
          fallback={
            <Text size="caption" tone="muted">
              No lineup checks have run yet.
            </Text>
          }
          when={props.team.lastRun}
        >
          {(run) => (
            <Text size="caption" tone="muted">
              {lastCheckLine(run())}
            </Text>
          )}
        </Show>
        <Show when={checkTallyLabel(props.team.recentRuns)}>
          {(tally) => (
            <Text size="caption" tone="faint">
              {tally()}
            </Text>
          )}
        </Show>
        <TeamAttention remote={props.remote} team={props.team} />
      </Stack>
      <TeamControls team={props.team} remote={props.remote} />
    </RuleListItem>
  );
}

type TeamListProps = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly refreshing: Accessor<boolean>;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshTeams: () => void;
  readonly remote: TeamRemote;
};

type TeamRowProps = {
  readonly team: TeamSummaryView;
  readonly remote: TeamRemote;
};
