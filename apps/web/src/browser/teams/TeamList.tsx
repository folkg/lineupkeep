import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import type { ActionState } from "#browser/shared-ui/actionState.ts";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Card } from "#browser/shared-ui/Card.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { IconButton } from "#browser/shared-ui/IconButton.tsx";
import { RefreshIcon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { RuleList } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { createSettle } from "#browser/shared-ui/settle.ts";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { createMinuteClock } from "#browser/timing/minuteClock.ts";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";
import { sportDisplayName } from "#contracts/connections/teamVocabulary.ts";

import { TeamAttention } from "./TeamAttention";
import { TeamControls } from "./TeamControls";
import { checkTallyLabel, lastCheckLine, teamContextLabel } from "./teamLabels";
import { TeamProviderLink } from "./TeamProviderLink";
import type { TeamRemote } from "./teamRemote";
import { teamStatusBadge, teamStatusLine } from "./teamStatus";
import type { TeamStatusBadge } from "./teamStatus";

export function TeamList(props: TeamListProps): JSX.Element {
  const clock = createMinuteClock(() => props.dataUpdatedAt());
  const settling = createSettle(() => !props.isLoading() && props.teams().length > 0);

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
            <RuleList settling={settling()} surface="cards">
              <For each={teamsBySportThenName(props.teams())}>
                {(team) => <TeamCard now={clock.now} team={team} remote={props.remote} />}
              </For>
            </RuleList>
          </Show>
        </Show>
      </Show>
    </Stack>
  );
}

function TeamCard(props: TeamCardProps): JSX.Element {
  const nameId = (): string => `team-card-${props.team.team.id}`;
  const statusBadge = (): TeamStatusBadge => teamStatusBadge(props.team);

  return (
    <Card
      as="li"
      badge={<Badge tone={statusBadge().tone}>{statusBadge().label}</Badge>}
      footer={
        <TeamControls compact showPauseNote={false} team={props.team} remote={props.remote} />
      }
      header={
        <Inline gap="sm">
          <TextLink
            id={nameId()}
            params={{ teamId: props.team.team.id }}
            size="team"
            to="/teams/$teamId"
          >
            {props.team.team.name}
          </TextLink>
          <TeamProviderLink team={props.team.team} />
        </Inline>
      }
      labelledBy={nameId()}
      meta={
        <Text size="caption" tone="muted">
          {teamContextLabel(props.team.team, props.team.connectionCount)}
        </Text>
      }
    >
      <Stack gap="xs">
        <Text reserve="two-lines" size="caption" tone="muted">
          {teamStatusLine(props.team, props.now())}
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
        <TeamAttention team={props.team} />
      </Stack>
    </Card>
  );
}

type TeamListProps = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly refreshState: Accessor<ActionState>;
  readonly dataUpdatedAt: Accessor<number>;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshTeams: () => void;
  readonly remote: TeamRemote;
};

type TeamCardProps = {
  readonly team: TeamSummaryView;
  readonly now: Accessor<Date>;
  readonly remote: TeamRemote;
};

function teamsBySportThenName(
  teams: ReadonlyArray<TeamSummaryView>,
): ReadonlyArray<TeamSummaryView> {
  return [...teams].sort((left, right) => {
    const sport = sportDisplayName(left.team.sport).localeCompare(
      sportDisplayName(right.team.sport),
    );
    return sport === 0 ? left.team.name.localeCompare(right.team.name) : sport;
  });
}

function allTeamsIdle(teams: ReadonlyArray<TeamSummaryView>): boolean {
  return (
    teams.length > 0 &&
    teams.every(
      (summary) =>
        summary.connectionStatus === "ready" && summary.team.automation.status === "disabled",
    )
  );
}
