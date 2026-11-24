import { EffectArray } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Badge } from "#browser/shared-ui/Badge.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Skeleton } from "#browser/shared-ui/Skeleton.tsx";
import { Split } from "#browser/shared-ui/Split.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { TableSkeleton } from "#browser/shared-ui/Table.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

import { formatLabel, scoringLabel } from "./seasonLabels";
import { MatchupSummary, SeasonFacts } from "./SeasonSummary";
import type { CategoryRow, SeasonSummaryData } from "./SeasonSummary";

export function TeamSeasonOverview(props: {
  readonly facts: TeamOverviewView | undefined;
  readonly loading: boolean;
  readonly categoryValuesLoading?: boolean;
  readonly failed: boolean;
}): JSX.Element {
  const facts = (): TeamOverviewView | undefined => props.facts;
  const league = (): TeamOverviewView["league"] => facts()?.league;
  const format = (): string | undefined =>
    formatLabel(facts()?.format) ?? scoringLabel(league()?.scoringLabel);
  const data = (): SeasonSummaryData | undefined => {
    const value = facts();
    if (value === undefined || value.reason !== undefined) {
      return undefined;
    }
    return {
      ...(value.format === undefined ? {} : { format: value.format }),
      ...(league()?.teamCount === undefined ? {} : { teamCount: league()?.teamCount }),
      ...(value.seasonOver === undefined ? {} : { seasonOver: value.seasonOver }),
      ...(value.seasonProgress?.currentPeriod === undefined
        ? {}
        : { currentPeriod: value.seasonProgress.currentPeriod }),
      ...(value.seasonProgress?.lastPeriod === undefined
        ? {}
        : { lastPeriod: value.seasonProgress.lastPeriod }),
      ...(value.standing === undefined ? {} : { standing: value.standing }),
      ...(value.record === undefined ? {} : { record: value.record }),
      ...(value.matchup === undefined ? {} : { matchup: value.matchup }),
      ...(league()?.gamesCaps === undefined ? {} : { caps: league()?.gamesCaps }),
    };
  };
  const categoryRows = (): ReadonlyArray<CategoryRow> =>
    effectArrayFilter(facts()?.categoryPoints ?? []);
  const categoryValuesLoading = (): boolean =>
    props.categoryValuesLoading === true &&
    categoryRows().length > 0 &&
    EffectArray.every(categoryRows(), (row) => row.value === null);
  const usage = (): ReadonlyArray<{
    readonly position: string;
    readonly played: number;
    readonly projected: number;
  }> => {
    const value = facts()?.gamesUsage;
    return value?.status === "available" ? value.games : [];
  };
  const innings = (): { readonly pitched: number; readonly projected: number } | undefined => {
    const value = facts()?.gamesUsage;
    return value?.status === "available" ? value.innings : undefined;
  };
  const title = (): string => (facts()?.format === "rotisserie" ? "My categories" : "This week");
  const failure = (): string =>
    props.failed
      ? "Season facts could not be loaded. Checks and activity remain available."
      : (facts()?.reason ?? "Season facts were not published.");
  return (
    <Split
      aside={
        <Stack as="section" gap="sm" labelledBy="team-season-title">
          <SectionTitle id="team-season-title">Season</SectionTitle>
          <Show when={data()}>
            {(summary) => <SeasonFacts data={summary()} innings={innings()} usage={usage()} />}
          </Show>
          <Show when={data() === undefined && props.loading}>
            <SeasonSkeleton />
          </Show>
        </Stack>
      }
    >
      <Stack as="section" gap="md" labelledBy="team-week-title">
        <SectionTitle
          action={
            format() === undefined ? (
              <Show when={props.loading}>
                <Skeleton height="h-5" width="w-24" />
              </Show>
            ) : (
              <Badge tone="neutral">{format()}</Badge>
            )
          }
          id="team-week-title"
        >
          {title()}
        </SectionTitle>
        <Show
          fallback={
            <Show
              fallback={
                <Text type="meta" tone="muted">
                  {failure()}
                </Text>
              }
              when={props.loading}
            >
              <WeekSkeleton format={facts()?.format} />
            </Show>
          }
          when={data()}
        >
          {(summary) => (
            <MatchupSummary
              categoryRows={categoryRows()}
              categoryValuesLoading={categoryValuesLoading()}
              data={summary()}
            />
          )}
        </Show>
      </Stack>
    </Split>
  );
}

function effectArrayFilter(rows: ReadonlyArray<CategoryRow>): ReadonlyArray<CategoryRow> {
  return EffectArray.filter(rows, (row) => row.scoring !== "informational");
}

function SeasonSkeleton(): JSX.Element {
  return (
    <Stack gap="md">
      <Stack gap="2xs">
        <Text type="label" tone="faint">
          Place
        </Text>
        <Skeleton height="h-5" width="w-24" />
        <Skeleton height="h-3" width="w-32" />
        <Skeleton height="h-3" width="w-24" />
        <Skeleton height="h-3" width="w-40" />
      </Stack>
      <Stack gap="2xs">
        <Text type="label" tone="faint">
          Cap usage
        </Text>
        <Skeleton height="h-3" width="w-24" />
        <Skeleton height="h-3" width="w-32" />
      </Stack>
    </Stack>
  );
}

function WeekSkeleton(props: { readonly format: string | undefined }): JSX.Element {
  const rotisserie = (): boolean => props.format === "rotisserie";
  return (
    <Stack gap="md">
      <Stack gap="2xs">
        <Skeleton height="h-5" width="w-48" />
        <Skeleton height="h-5" width="w-24" />
        <Skeleton height="h-3" width="w-36" />
      </Stack>
      <TableSkeleton
        columns={
          rotisserie()
            ? [
                { label: "Category" },
                { label: "Stat", align: "end", width: "w-16" },
                { label: "Place", align: "end", width: "w-14" },
                { label: "Pts", align: "end", width: "w-12" },
              ]
            : [
                { label: "Category" },
                { label: "You", align: "end", width: "w-16" },
                { label: "Them", align: "end", width: "w-16" },
              ]
        }
        label={rotisserie() ? "My categories" : "Matchup categories"}
        rows={5}
      />
    </Stack>
  );
}
