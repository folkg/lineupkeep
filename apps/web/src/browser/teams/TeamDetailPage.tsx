import { EffectArray, EffectOption, EffectString } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import {
  UnsavedChangesScope,
  UnsavedNavigationGuard,
} from "#browser/navigation/UnsavedChanges.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Card } from "#browser/shared-ui/Card.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Definition, DefinitionList } from "#browser/shared-ui/DefinitionList.tsx";
import { Disclosure } from "#browser/shared-ui/Disclosure.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { IconNavLink } from "#browser/shared-ui/IconNavLink.tsx";
import { ArrowLeftIcon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { SeasonArea } from "#browser/shared-ui/SeasonArea.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type {
  TeamControlData,
  TeamOverviewView,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { RunActivity } from "./RunActivity";
import { TeamAttention } from "./TeamAttention";
import { TeamControls } from "./TeamControls";
import { teamContextLabel } from "./teamLabels";
import { TeamNote } from "./TeamNote";
import { teamLastRun } from "./teamPending";
import { TeamProviderLink } from "./TeamProviderLink";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
import { useTeamNote } from "./useTeamNote";
import { useTeamOverview } from "./useTeamOverview";
import { useTeamsPage } from "./useTeamsPage";

export function TeamDetailPage(props: TeamDetailPageProps): JSX.Element {
  const page = useTeamsPage({
    teamsQuery: () => props.teamsQuery(),
    includeCards: false,
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });
  const team = (): TeamSummaryView | undefined => {
    const teams = page.teams();
    const teamId = props.teamId;
    return EffectOption.getOrUndefined(
      EffectArray.findFirst(teams, (candidate) => candidate.team.id === teamId),
    );
  };
  const titleAside = (): JSX.Element | undefined => {
    const summary = team();
    return summary === undefined ? undefined : <TeamProviderLink team={summary.team} />;
  };

  return (
    <AppShell footer={<TeamReportFooter team={team} />}>
      <Page
        back={
          <IconNavLink label="Back to teams" to="/teams">
            <ArrowLeftIcon size="md" />
          </IconNavLink>
        }
        title={team()?.team.name ?? "Team"}
        titleAside={titleAside()}
        titleVariant="display"
      >
        <UnsavedChangesScope>
          <Stack gap="lg">
            <Show
              fallback={<LoadingState label="Loading team">Loading this team…</LoadingState>}
              when={!page.isLoading()}
            >
              <Show
                fallback={
                  <EmptyState title="Team not found.">
                    This team is not available to the current account. Return to the team list.
                  </EmptyState>
                }
                when={team()}
              >
                {(summary) => (
                  <TeamDetail
                    team={summary()}
                    remote={props.remote}
                    onOptimistic={page.beginControl}
                  />
                )}
              </Show>
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
  const overview = useTeamOverview(
    () => props.team.team.id,
    () => props.remote,
  );
  return (
    <Stack gap="2xl">
      <Stack gap="md">
        <Stack gap="xs">
          <Text type="meta" tone="muted">
            {teamContextLabel(props.team.team, props.team.connectionCount)}
          </Text>
          <TeamAttention team={props.team} />
        </Stack>
        <TeamControls team={props.team} remote={props.remote} onOptimistic={props.onOptimistic} />
      </Stack>

      <TeamSeasonOverview
        facts={overview.facts()}
        loading={overview.loading()}
        failed={overview.failed()}
      />

      <Stack as="section" gap="sm" labelledBy="team-activity-title">
        <SectionTitle id="team-activity-title">Recent activity</SectionTitle>
        <Show
          fallback={<NoChecksToday team={props.team} />}
          when={props.team.recentRuns.length > 0}
        >
          <RunActivity runs={props.team.recentRuns} />
        </Show>
      </Stack>

      <TeamNote note={note} />
    </Stack>
  );
}

function TeamSeasonOverview(props: {
  readonly facts: TeamOverviewView | undefined;
  readonly loading: boolean;
  readonly failed: boolean;
}): JSX.Element {
  const facts = (): TeamOverviewView | undefined => props.facts;
  const league = (): TeamOverviewView["league"] => facts()?.league;
  const standing = (): TeamOverviewView["standing"] => facts()?.standing;
  const matchup = (): TeamOverviewView["matchup"] => facts()?.matchup;
  const number = (value: number | null | undefined): string =>
    value === null || value === undefined
      ? "Not published"
      : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const cap = (): NonNullable<TeamOverviewView["league"]>["gamesCaps"] | undefined =>
    league()?.gamesCaps;
  const hasCap = (): boolean =>
    cap()?.gamesPlayed !== undefined || cap()?.inningsPitched !== undefined;
  const usage = ():
    | Extract<NonNullable<TeamOverviewView["gamesUsage"]>, { readonly status: "available" }>
    | undefined => {
    const value = facts()?.gamesUsage;
    return value?.status === "available" ? value : undefined;
  };
  const usageReason = (): string => {
    const value = facts()?.gamesUsage;
    return value?.status === "not_published"
      ? value.detail
      : "The provider did not publish this team's cap usage.";
  };
  return (
    <Card
      header={<SectionTitle id="team-season-title">Season overview</SectionTitle>}
      labelledBy="team-season-title"
    >
      <Stack gap="md">
        <SeasonArea detail>
          <Show
            fallback={
              <Text type="meta" tone="muted">
                {props.failed
                  ? "Season facts could not be loaded. Controls and activity remain available."
                  : props.loading
                    ? "Loading season facts."
                    : (facts()?.reason ?? "Season facts were not published.")}
              </Text>
            }
            when={facts() !== undefined && facts()?.reason === undefined}
          >
            <Stack gap="md">
              <DefinitionList compact>
                <Definition
                  compact
                  term="Place"
                  value={
                    standing()?.rank === null || standing()?.rank === undefined
                      ? (facts()?.standingReason ?? "Place not published.")
                      : `${standing()?.rank} of ${league()?.teamCount ?? "team count not published"}`
                  }
                />
                <Definition
                  compact
                  term="Record"
                  value={
                    facts()?.record === undefined
                      ? (facts()?.recordReason ?? "Record not published.")
                      : recordLabel(facts()?.record)
                  }
                />
                <Definition
                  compact
                  term="Points"
                  value={number(standing()?.pointsFor ?? standing()?.points)}
                />
                <Definition
                  compact
                  term="Points against"
                  value={number(standing()?.pointsAgainst)}
                />
                <Definition compact term="Behind leader" value={number(standing()?.pointsBack)} />
                <Definition
                  compact
                  term="Scoring format"
                  value={league()?.scoringLabel ?? scoringFormatLabel(facts()?.format)}
                />
                <Show
                  when={
                    league()?.weeklyDeadline !== undefined &&
                    league()?.weeklyDeadline !== "" &&
                    league()?.weeklyDeadline !== "intraday"
                  }
                >
                  <Definition compact term="Lineup changes" value="Weekly" />
                </Show>
                <Show
                  when={
                    facts()?.seasonProgress?.currentPeriod !== undefined &&
                    facts()?.seasonProgress?.lastPeriod !== undefined
                  }
                >
                  <Definition
                    compact
                    term="Season progress"
                    value={`Week ${facts()?.seasonProgress?.currentPeriod} of ${facts()?.seasonProgress?.lastPeriod}`}
                  />
                </Show>
                <Show when={facts()?.seasonProgress?.endDate ?? league()?.endDate}>
                  <Definition
                    compact
                    term="Season ends"
                    value={facts()?.seasonProgress?.endDate ?? league()?.endDate ?? ""}
                  />
                </Show>
              </DefinitionList>
              <Stack gap="sm">
                <SectionTitle>Current matchup</SectionTitle>
                <Show
                  fallback={
                    <Text type="meta" tone="muted">
                      {facts()?.matchupReason ?? "No current matchup was published."}
                    </Text>
                  }
                  when={matchup()}
                >
                  {(current) => (
                    <>
                      <Inline gap="sm">
                        <Text type="body">
                          Week {current().week} · Against {current().opponent}
                        </Text>
                        <Show when={current().statusLabel}>
                          <Text type="meta" tone="muted">
                            {current().statusLabel}
                          </Text>
                        </Show>
                      </Inline>
                      <DefinitionList compact>
                        <Definition compact term="Your points" value={number(current().points)} />
                        <Definition
                          compact
                          term="Opponent points"
                          value={number(current().opponentPoints)}
                        />
                        <Definition
                          compact
                          term="Your projected points"
                          value={number(current().projectedPoints)}
                        />
                        <Definition
                          compact
                          term="Opponent projected points"
                          value={number(current().opponentProjectedPoints)}
                        />
                        <Show when={current().remainingGames !== undefined}>
                          <Definition
                            compact
                            term="Your remaining games"
                            value={number(current().remainingGames)}
                          />
                        </Show>
                        <Show when={current().opponentRemainingGames !== undefined}>
                          <Definition
                            compact
                            term="Opponent remaining games"
                            value={number(current().opponentRemainingGames)}
                          />
                        </Show>
                      </DefinitionList>
                    </>
                  )}
                </Show>
              </Stack>
              <Disclosure summary="Scoring detail">
                <Stack gap="sm">
                  <Show
                    when={facts()?.format === "rotisserie"}
                    fallback={
                      <Show
                        when={(matchup()?.categories.length ?? 0) > 0}
                        fallback={
                          <Text type="meta" tone="muted">
                            {facts()?.categoryReason ?? "Category values were not published."}
                          </Text>
                        }
                      >
                        <DefinitionList compact>
                          {EffectArray.map(matchup()?.categories ?? [], (row) => (
                            <Definition
                              compact
                              term={`${row.name}${row.scoring === "informational" ? " (informational)" : ""}`}
                              value={`You: ${number(row.own)} · Opponent: ${number(row.opponent)}`}
                            />
                          ))}
                        </DefinitionList>
                      </Show>
                    }
                  >
                    <Show
                      when={(facts()?.categoryPoints?.length ?? 0) > 0}
                      fallback={
                        <Text type="meta" tone="muted">
                          {facts()?.categoryReason ?? "Season category points were not published."}
                        </Text>
                      }
                    >
                      <DefinitionList compact>
                        {EffectArray.map(facts()?.categoryPoints ?? [], (row) => (
                          <Definition
                            compact
                            term={`${row.name}${row.scoring === "informational" ? " (informational)" : ""}`}
                            value={number(row.value)}
                          />
                        ))}
                      </DefinitionList>
                    </Show>
                  </Show>
                </Stack>
              </Disclosure>
              <Show when={hasCap()}>
                <Stack gap="sm">
                  <SectionTitle>Season caps</SectionTitle>
                  <DefinitionList compact>
                    <Show when={cap()?.gamesPlayed !== undefined}>
                      <Definition compact term="Games cap" value={number(cap()?.gamesPlayed)} />
                    </Show>
                    <Show when={cap()?.inningsPitched !== undefined}>
                      <Definition
                        compact
                        term="Innings cap"
                        value={number(cap()?.inningsPitched)}
                      />
                    </Show>
                    <Show when={usage()}>
                      <>
                        {EffectArray.map(usage()?.games ?? [], (row) => (
                          <Definition
                            compact
                            term={`${row.position} games`}
                            value={`${number(row.played)} played · ${number(row.projected)} projected`}
                          />
                        ))}
                        <Show when={usage()?.innings}>
                          {(innings) => (
                            <Definition
                              compact
                              term="Innings pitched"
                              value={`${number(innings().pitched)} pitched · ${number(innings().projected)} projected`}
                            />
                          )}
                        </Show>
                      </>
                    </Show>
                  </DefinitionList>
                  <Show when={usage() === undefined}>
                    <Notice tone="neutral" title="Usage not published">
                      <Text type="meta">{usageReason()}</Text>
                    </Notice>
                  </Show>
                </Stack>
              </Show>
            </Stack>
          </Show>
        </SeasonArea>
      </Stack>
    </Card>
  );
}

function scoringFormatLabel(format: TeamOverviewView["format"]): string {
  switch (format) {
    case "head_to_head_categories":
      return "Head to head categories";
    case "head_to_head_points":
      return "Head to head points";
    case "rotisserie":
      return "Rotisserie";
    case "unknown":
    case undefined:
      return "Unknown scoring format";
  }
}

function recordLabel(record: TeamOverviewView["record"]): string {
  if (record === undefined) {
    return "Record not published.";
  }
  const totals = `${record.wins}-${record.losses}-${record.ties}`;
  return record.percentage === null
    ? `${totals} (percentage not published)`
    : `${totals} (${EffectString.replace(record.percentage.toFixed(3), /^0/u, "")})`;
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

function NoChecksToday(props: NoChecksTodayProps): JSX.Element {
  return (
    <EmptyState title="No checks today.">
      <Show
        fallback="Checks will appear here after the first scheduled or manual run."
        when={teamLastRun(props.team)}
      >
        {(run) => (
          <>
            The last check was{" "}
            <Time datetime={run().updatedAt}>{formatReaderTime(run().updatedAt)}</Time>.
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
  readonly remote: TeamRemote;
  readonly onOptimistic: (input: TeamControlData) => void;
};

type NoChecksTodayProps = {
  readonly team: TeamSummaryView;
};
