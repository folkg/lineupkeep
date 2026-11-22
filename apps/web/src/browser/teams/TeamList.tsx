import { EffectArray } from "@lineupkeep/collections";
import { EffectString } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import type { CachedTeamHeader } from "#browser/query/teamHeaderCache.ts";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import type { ActionState } from "#browser/shared-ui/actionState.ts";
import { Card } from "#browser/shared-ui/Card.tsx";
import { EmptyState } from "#browser/shared-ui/CollectionState.tsx";
import { IconButton } from "#browser/shared-ui/IconButton.tsx";
import { RefreshIcon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { RuleList } from "#browser/shared-ui/RuleList.tsx";
import { SeasonArea } from "#browser/shared-ui/SeasonArea.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { createSettle } from "#browser/shared-ui/settle.ts";
import { CardSkeletonList } from "#browser/shared-ui/Skeleton.tsx";
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

import { TeamAttention } from "./TeamAttention";
import { TeamControls } from "./TeamControls";
import { checkTallyLabel, lastCheckLine, teamContextLabel } from "./teamLabels";
import { teamAutomation, teamLastRun } from "./teamPending";
import { TeamProviderLink } from "./TeamProviderLink";
import type { TeamRemote } from "./teamRemote";
import { TeamSeasonFacts } from "./TeamSeasonFacts";
import { teamStatusLine } from "./teamStatus";

export function TeamList(props: TeamListProps): JSX.Element {
  const clock = createMinuteClock(() => props.dataUpdatedAt());
  const settling = createSettle(() => !props.isLoading() && props.teams().length > 0);
  const skeletonCards = (): ReadonlyArray<SkeletonCard> | undefined =>
    props.cachedHeaders.length === 0
      ? undefined
      : EffectArray.map(props.cachedHeaders, (header) => ({
          title: header.name,
          meta:
            header.leagueName === undefined
              ? header.sportLabel
              : `${header.sportLabel} · ${header.leagueName}`,
        }));

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
        fallback={<CardSkeletonList cards={skeletonCards()} season />}
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
                    factsLoading={props.cardFactsLoading()}
                    remote={props.remote}
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

  return (
    <Card
      as="li"
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
          {teamContextLabel(props.team.team, props.team.connectionCount)}
        </Text>
      }
    >
      <Stack gap="xs">
        <SeasonArea>
          <TeamSeasonFacts
            facts={props.facts}
            failed={props.factsFailure}
            loading={props.factsLoading}
          />
        </SeasonArea>
        <Text reserve="two-lines" type="meta" tone="muted">
          {teamStatusLine(props.team, props.now())}
        </Text>
        <Show
          fallback={
            <Text numeric type="meta" tone="muted">
              No lineup checks have run yet.
            </Text>
          }
          when={teamLastRun(props.team)}
        >
          {(run) => (
            <Text numeric type="meta" tone="muted">
              {lastCheckLine(run())}
            </Text>
          )}
        </Show>
        <Show when={checkTallyLabel(props.team.recentRuns)}>
          {(tally) => (
            <Text numeric type="meta" tone="faint">
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
  readonly cardFacts: Accessor<ReadonlyArray<TeamCardView> | undefined>;
  readonly cardFactsFailure: Accessor<boolean>;
  readonly cardFactsLoading: Accessor<boolean>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly refreshState: Accessor<ActionState>;
  readonly dataUpdatedAt: Accessor<number>;
  readonly cachedHeaders: ReadonlyArray<CachedTeamHeader>;
  readonly onOptimistic: (input: TeamControlData) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshTeams: () => void;
  readonly remote: TeamRemote;
};

type TeamCardProps = {
  readonly team: TeamSummaryView;
  readonly facts: TeamCardView | undefined;
  readonly factsFailure: boolean;
  readonly factsLoading: boolean;
  readonly now: Accessor<Date>;
  readonly remote: TeamRemote;
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

type SkeletonCard = { readonly title: string; readonly meta: string };
