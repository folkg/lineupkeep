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
import { defaultProviderName, providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import {
  automationLabel,
  availabilityLabel,
  connectionLabel,
  pauseResumeLabel,
  runExplanation,
  runStatusLabel,
} from "./teamLabels";

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
                {(team) => (
                  <TeamRow
                    pending={props.pendingTeam() === team.team.id}
                    team={team}
                    onDisable={() => props.onSetEnabled(team, false)}
                    onEnable={() => props.onSetEnabled(team, true)}
                    onPause={() => props.onPause(team)}
                    onResume={() => props.onResume(team)}
                  />
                )}
              </For>
            </RuleList>
          </Show>
        </Show>
      </Show>
    </Stack>
  );
}

function TeamRow(props: TeamRowProps): JSX.Element {
  const enabled = (): boolean => props.team.team.automation.status !== "disabled";
  const paused = (): boolean =>
    props.team.team.automation.status === "paused-until-fantasy-day-end";
  return (
    <RuleListItem layout="columns">
      <Stack gap="sm">
        <Inline gap="sm">
          <TextLink params={{ teamId: props.team.team.id }} size="item" to="/teams/$teamId">
            {props.team.team.name}
          </TextLink>
          <Text size="caption" tone="muted">
            {leagueLabel(props.team.team.league)} · {sportLabel(props.team.team.sport)} ·{" "}
            {providerDisplayName(props.team.team.provider)}
          </Text>
        </Inline>
        <Inline gap="md">
          <StatusText>{availabilityLabel(props.team)}</StatusText>
          <StatusText>{automationLabel(props.team)}</StatusText>
          <StatusText>{connectionLabel(props.team)}</StatusText>
        </Inline>
        <Show when={pauseResumeLabel(props.team)}>
          {(label) => (
            <Text size="caption" tone="muted">
              {label()}
            </Text>
          )}
        </Show>
        <LastRun team={props.team} />
      </Stack>
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
          <TextLink to="/connections">
            Reconnect {providerDisplayName(props.team.team.provider)}
          </TextLink>
        </Show>
      </Inline>
    </RuleListItem>
  );
}

function LastRun(props: { readonly team: TeamSummaryView }): JSX.Element {
  return (
    <Show
      fallback={
        <Text size="caption" tone="muted">
          No lineup runs yet.
        </Text>
      }
      when={props.team.lastRun}
    >
      {(run) => (
        <Stack gap="xs">
          <Text size="caption" weight="semibold">
            {runStatusLabel(run().status)}
          </Text>
          <Text size="caption" tone="muted">
            {runExplanation(run())}
          </Text>
          <TextLink params={{ runId: run().run }} to="/runs/$runId">
            View run detail
          </TextLink>
        </Stack>
      )}
    </Show>
  );
}

function StatusText(props: { readonly children: JSX.Element }): JSX.Element {
  return (
    <Text as="span" size="caption" tone="muted">
      {props.children}
    </Text>
  );
}

function leagueLabel(league: TeamSummaryView["team"]["league"]): string {
  return league === "nfl" ? "NFL" : "NHL";
}

function sportLabel(sport: TeamSummaryView["team"]["sport"]): string {
  return sport === "football" ? "Football" : "Hockey";
}

type TeamListProps = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly pendingTeam: Accessor<string | undefined>;
  readonly refreshing: Accessor<boolean>;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshTeams: () => void;
  readonly onSetEnabled: (team: TeamSummaryView, enabled: boolean) => void;
  readonly onPause: (team: TeamSummaryView) => void;
  readonly onResume: (team: TeamSummaryView) => void;
};

type TeamRowProps = {
  readonly team: TeamSummaryView;
  readonly pending: boolean;
  readonly onEnable: () => void;
  readonly onDisable: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
};
