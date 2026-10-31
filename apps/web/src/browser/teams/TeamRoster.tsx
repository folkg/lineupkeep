import type { JSX } from "@solidjs/web";
import { Errored, For, Show } from "solid-js";

import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type {
  TeamRosterPlayerView,
  TeamRosterTrendView,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { rosterTrendLabel } from "./teamLabels";
import type { TeamRemote } from "./teamRemote";
import { useTeamRoster } from "./useTeamRoster";

export function TeamRoster(props: TeamRosterProps): JSX.Element {
  return (
    <Stack as="section" gap="sm" labelledBy="team-roster-title">
      <Heading id="team-roster-title" level={2} size="section">
        Roster
      </Heading>
      <Text size="caption" tone="muted">
        Adds and drops are the provider's counts for its current day, across all of its leagues.
        They are not percent owned.
      </Text>
      <Show
        fallback={
          <EmptyState title="Roster unavailable.">
            Lineupkeep cannot read this team, so it cannot show the roster.
          </EmptyState>
        }
        when={props.team.team.availability.status === "available"}
      >
        <RosterBody remote={props.remote} teamId={props.team.team.id} />
      </Show>
    </Stack>
  );
}

function RosterBody(props: RosterBodyProps): JSX.Element {
  const roster = useTeamRoster({
    teamId: () => props.teamId,
    remote: () => props.remote,
  });

  return (
    <Errored
      fallback={
        <EmptyState title="Roster unavailable.">
          We could not read this roster from the provider. Try again in a moment.
        </EmptyState>
      }
    >
      <Show
        fallback={<LoadingState label="Loading roster">Loading this roster…</LoadingState>}
        when={!roster.isPending}
      >
        <Show
          fallback={
            <EmptyState title="Roster unavailable.">
              We could not read this roster from the provider. Try again in a moment.
            </EmptyState>
          }
          when={roster.data}
        >
          {(data) => (
            <Show
              fallback={
                <EmptyState title="Roster unavailable.">
                  The provider did not return this roster. Try again in a moment.
                </EmptyState>
              }
              when={data().status === "ok"}
            >
              <Show
                fallback={<EmptyState title="No players.">This roster is empty.</EmptyState>}
                when={data().players.length > 0}
              >
                <RuleList>
                  <For each={data().players}>{(player) => <RosterEntry player={player} />}</For>
                </RuleList>
                <Show when={data().observedAt}>
                  {(observedAt) => (
                    <Text size="caption" tone="faint">
                      Read <Time datetime={observedAt()}>{formatReaderTime(observedAt())}</Time>
                    </Text>
                  )}
                </Show>
              </Show>
            </Show>
          )}
        </Show>
      </Show>
    </Errored>
  );
}

function RosterEntry(props: { readonly player: TeamRosterPlayerView }): JSX.Element {
  return (
    <RuleListItem>
      <Inline gap="sm" justify="between">
        <Text>{props.player.name}</Text>
        <Text size="caption" tone="faint">
          {props.player.slot.status === "verified" ? props.player.slot.slot : "Slot unverified"}
        </Text>
      </Inline>
      <Text size="caption" tone="muted">
        {positionLine(props.player)}
      </Text>
      <Show when={props.player.slot.status === "unverified" ? props.player.slot : undefined}>
        {(slot) => (
          <Text size="caption" tone="muted">
            {slot().reason}
          </Text>
        )}
      </Show>
      <Show when={props.player.injury.reported}>
        <Text size="caption" tone="muted">
          {injuryLine(props.player)}
        </Text>
      </Show>
      <Trend trend={props.player.trend} />
    </RuleListItem>
  );
}

function Trend(props: { readonly trend: TeamRosterTrendView }): JSX.Element {
  return (
    <Show
      fallback={<UnpublishedTrend trend={props.trend} />}
      when={props.trend.status === "published" ? props.trend : undefined}
    >
      {(trend) => (
        <Text size="caption" tone="muted">
          {rosterTrendLabel(trend())}
        </Text>
      )}
    </Show>
  );
}

function UnpublishedTrend(props: { readonly trend: TeamRosterTrendView }): JSX.Element {
  return (
    <Show
      fallback={
        <Text size="caption" tone="faint">
          Trends not published.
        </Text>
      }
      when={props.trend.status === "not_published" ? props.trend : undefined}
    >
      {(trend) => (
        <Text size="caption" tone="faint">
          Trends not published. {trend().reason}
        </Text>
      )}
    </Show>
  );
}

function positionLine(player: TeamRosterPlayerView): string {
  return player.proTeam === null
    ? player.displayPosition
    : `${player.displayPosition} · ${player.proTeam}`;
}

function injuryLine(player: TeamRosterPlayerView): string {
  if (player.injury.detail !== undefined) {
    return `Availability: ${player.injury.detail}`;
  }
  if (player.injury.code !== undefined) {
    return `Availability: ${player.injury.code}`;
  }
  return "Availability reported";
}

type TeamRosterProps = {
  readonly team: TeamSummaryView;
  readonly remote: TeamRemote;
};

type RosterBodyProps = {
  readonly teamId: string;
  readonly remote: TeamRemote;
};
