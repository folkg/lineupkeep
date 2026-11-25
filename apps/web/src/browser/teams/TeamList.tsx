import { EffectArray } from "@lineupkeep/collections";
import { EffectString } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import type { ActionState } from "#browser/shared-ui/actionState.ts";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Card, CardNote } from "#browser/shared-ui/Card.tsx";
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
import type {
  TeamCardView,
  TeamControlData,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";
import { sportDisplayName } from "#contracts/connections/teamVocabulary.ts";

import { cardFormatLabel, scoringLabel } from "./seasonLabels";
import { TeamAttention } from "./TeamAttention";
import { TeamControls } from "./TeamControls";
import { lastCheckStatus, showsProvider, teamContextLabel } from "./teamLabels";
import type { LastCheckStatus } from "./teamLabels";
import { teamAutomation, teamLastRun } from "./teamPending";
import { TeamProviderLink } from "./TeamProviderLink";
import type { TeamRemote } from "./teamRemote";
import { TeamSeasonFacts } from "./TeamSeasonFacts";
import { nextCheckStatus } from "./teamStatus";
import type { CheckStatus } from "./teamStatus";

export function TeamList(props: TeamListProps): JSX.Element {
  const clock = createMinuteClock(() => props.dataUpdatedAt());
  const settling = createSettle(() => !props.isLoading() && props.teams().length > 0);
  const showProvider = (): boolean => showsProvider(props.teams());

  return (
    <Stack as="section" gap="md" labelledBy="teams-list-title">
      <SectionTitle
        id="teams-list-title"
        action={
          <IconButton
            confirmed
            disabled={EffectArray.some(props.teams(), (team) => team.pending !== undefined)}
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
          <Text type="meta">Turn on Lineup checks for the teams you want managed.</Text>
        </Notice>
      </Show>
      <Show
        fallback={<LoadingState label="Loading teams">Loading your teams…</LoadingState>}
        when={!props.isLoading() && (props.loadFailure() !== null || !props.cardFactsLoading())}
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
            <RuleList
              busy={props.refreshState() === "working"}
              settling={settling()}
              surface="cards"
            >
              <For each={teamsBySportThenName(props.teams())}>
                {(team) => (
                  <TeamCard
                    now={clock.now}
                    team={team}
                    facts={
                      EffectArray.filter(
                        props.cardFacts() ?? [],
                        (card) => card.summary.team.id === team.team.id,
                      )[0]
                    }
                    factsFailure={props.cardFactsFailure()}
                    remote={props.remote}
                    showProvider={showProvider}
                    onOptimistic={props.onOptimistic}
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

function TeamCard(props: TeamCardProps): JSX.Element {
  const nameId = (): string => `team-card-${props.team.team.id}`;
  const format = (): string | undefined =>
    props.facts?.season === undefined
      ? undefined
      : (cardFormatLabel(props.facts.season.format) ??
        scoringLabel(props.facts.season.scoringLabel));

  return (
    <Card
      as="li"
      badge={format() === undefined ? undefined : <Badge tone="neutral">{format()}</Badge>}
      footer={
        <TeamControls
          compact
          showPauseNote={false}
          team={props.team}
          remote={props.remote}
          onOptimistic={props.onOptimistic}
        />
      }
      header={
        <Inline gap="sm">
          <TextLink
            id={nameId()}
            params={{ teamId: props.team.team.id }}
            preload="intent"
            type="card-title"
            to="/teams/$teamId"
          >
            {props.team.team.name}
          </TextLink>
          <TeamProviderLink team={props.team.team} />
        </Inline>
      }
      labelledBy={nameId()}
      meta={
        <Text type="meta" tone="muted">
          {teamContextLabel(props.team.team, props.showProvider())}
        </Text>
      }
    >
      <Stack gap="sm">
        <Show
          fallback={<TeamAttention team={props.team} />}
          when={props.team.connectionStatus === "ready"}
        >
          <TeamSeasonFacts facts={props.facts} failed={props.factsFailure} />
        </Show>
        <CardNote>
          <CheckSummary now={props.now} team={props.team} />
        </CardNote>
      </Stack>
    </Card>
  );
}

function CheckSummary(props: {
  readonly team: TeamSummaryView;
  readonly now: Accessor<Date>;
}): JSX.Element {
  const next = (): CheckStatus => nextCheckStatus(props.team, props.now());
  const last = (): LastCheckStatus | undefined =>
    lastCheckStatus(teamLastRun(props.team), props.now());
  return (
    <Inline gap="lg" justify="between" align="start">
      <Stack gap="2xs">
        <Text type="meta" tone="muted">
          Next check
        </Text>
        <Text type="body-strong">{next().value}</Text>
        <Show when={next().note}>
          {(note) => (
            <Text type="meta" tone="muted">
              {note()}
            </Text>
          )}
        </Show>
      </Stack>
      <Stack gap="2xs">
        <Text type="meta" tone="muted">
          Last check
        </Text>
        <Show fallback={<Text type="body-strong">No checks yet</Text>} when={last()}>
          {(status) => (
            <>
              <Text type="body-strong">{status().value}</Text>
              <Show when={status().note}>
                {(note) => (
                  <Text type="meta" tone="muted">
                    {note()}
                  </Text>
                )}
              </Show>
            </>
          )}
        </Show>
      </Stack>
    </Inline>
  );
}

type TeamListProps = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly cardFacts: Accessor<ReadonlyArray<TeamCardView> | undefined>;
  readonly cardFactsFailure: Accessor<boolean>;
  readonly cardFactsLoading: Accessor<boolean>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly refreshState: Accessor<ActionState>;
  readonly dataUpdatedAt: Accessor<number>;
  readonly onOptimistic: (input: TeamControlData) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshTeams: () => void;
  readonly remote: TeamRemote;
};

type TeamCardProps = {
  readonly team: TeamSummaryView;
  readonly facts: TeamCardView | undefined;
  readonly factsFailure: boolean;
  readonly now: Accessor<Date>;
  readonly remote: TeamRemote;
  readonly showProvider: Accessor<boolean>;
  readonly onOptimistic: (input: TeamControlData) => void;
};

function teamsBySportThenName(
  teams: ReadonlyArray<TeamSummaryView>,
): ReadonlyArray<TeamSummaryView> {
  return [...teams].sort((left, right) => {
    const sport = EffectString.localeCompare(
      sportDisplayName(left.team.sport),
      sportDisplayName(right.team.sport),
    );
    return sport === 0 ? EffectString.localeCompare(left.team.name, right.team.name) : sport;
  });
}

function allTeamsIdle(teams: ReadonlyArray<TeamSummaryView>): boolean {
  return (
    teams.length > 0 &&
    EffectArray.every(
      teams,
      (summary) =>
        summary.connectionStatus === "ready" && teamAutomation(summary).status === "disabled",
    )
  );
}
