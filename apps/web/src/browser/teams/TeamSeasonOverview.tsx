import { EffectArray } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Badge } from "#browser/shared-ui/Badge.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Split } from "#browser/shared-ui/Split.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

import { cardFormatLabel, scoringLabel } from "./seasonLabels";
import { MatchupSummary, SeasonFacts } from "./SeasonSummary";
import type { CategoryRow, SeasonSummaryData } from "./SeasonSummary";

export function TeamSeasonOverview(props: {
  readonly facts: TeamOverviewView | undefined;
  readonly categoryValuesLoading?: boolean;
  readonly failed: boolean;
}): JSX.Element {
  const facts = (): TeamOverviewView | undefined => props.facts;
  const league = (): TeamOverviewView["league"] => facts()?.league;
  const format = (): string | undefined =>
    cardFormatLabel(facts()?.format) ?? scoringLabel(league()?.scoringLabel);
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
      ...(value.seasonProgress?.usesPlayoffs === undefined
        ? {}
        : { usesPlayoffs: value.seasonProgress.usesPlayoffs }),
      ...(value.seasonProgress?.playoffStartWeek === undefined
        ? {}
        : { playoffStartWeek: value.seasonProgress.playoffStartWeek }),
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
      ? "Season facts could not be loaded. Lineup runs remain available."
      : (facts()?.reason ?? "Season facts were not published.");
  return (
    <Show
      fallback={
        <Stack as="section" gap="sm" labelledBy="team-season-title">
          <SectionTitle id="team-season-title">Season</SectionTitle>
          <Text type="meta" tone="muted">
            {failure()}
          </Text>
        </Stack>
      }
      when={data()}
    >
      {(summary) => (
        <Split
          aside={
            <Stack as="section" gap="sm" labelledBy="team-season-title">
              <SectionTitle id="team-season-title">Season</SectionTitle>
              <SeasonFacts data={summary()} innings={innings()} usage={usage()} />
            </Stack>
          }
        >
          <Stack as="section" gap="md" labelledBy="team-week-title">
            <SectionTitle
              action={format() === undefined ? undefined : <Badge tone="neutral">{format()}</Badge>}
              id="team-week-title"
            >
              {title()}
            </SectionTitle>
            <MatchupSummary
              categoryRows={categoryRows()}
              categoryValuesLoading={categoryValuesLoading()}
              data={summary()}
            />
          </Stack>
        </Split>
      )}
    </Show>
  );
}

function effectArrayFilter(rows: ReadonlyArray<CategoryRow>): ReadonlyArray<CategoryRow> {
  return EffectArray.filter(rows, (row) => row.scoring !== "informational");
}
