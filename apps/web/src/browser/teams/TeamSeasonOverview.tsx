import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Card } from "#browser/shared-ui/Card.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { SeasonArea } from "#browser/shared-ui/SeasonArea.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { OverviewLoadingRows } from "#browser/shared-ui/Skeleton.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

import { formatLabel, number, scoringLabel } from "./seasonLabels";
import { SeasonSummary } from "./SeasonSummary";
import type { SeasonSummaryData } from "./SeasonSummary";

export function TeamSeasonOverview(props: {
  readonly facts: TeamOverviewView | undefined;
  readonly loading: boolean;
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
      ...(value.standing === undefined ? {} : { standing: value.standing }),
      ...(value.record === undefined ? {} : { record: value.record }),
      ...(value.matchup === undefined ? {} : { matchup: value.matchup }),
      ...(value.categoryPoints === undefined ? {} : { categoryPoints: value.categoryPoints }),
      ...(league()?.gamesCaps === undefined ? {} : { caps: league()?.gamesCaps }),
    };
  };
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
  return (
    <Card
      badge={format() === undefined ? undefined : <Badge tone="neutral">{format()}</Badge>}
      header={<SectionTitle id="team-season-title">Season overview</SectionTitle>}
      labelledBy="team-season-title"
    >
      <SeasonArea detail loading={props.loading}>
        <Show
          fallback={
            <Show
              fallback={
                <Text type="meta" tone="muted">
                  {props.failed
                    ? "Season facts could not be loaded. Controls and activity remain available."
                    : (facts()?.reason ?? "Season facts were not published.")}
                </Text>
              }
              when={props.loading}
            >
              <Stack gap="md">
                <Text type="meta" tone="muted">
                  Loading season facts.
                </Text>
                <OverviewLoadingRows count={5} paired />
              </Stack>
            </Show>
          }
          when={data()}
        >
          {(summary) => (
            <Stack gap="lg">
              <SeasonSummary
                capsHeading="Season caps"
                data={summary()}
                detail
                matchupHeading="Current matchup"
              />
              <Show when={usage().length > 0 || innings() !== undefined}>
                <Stack gap="sm">
                  <SectionTitle level={3}>Cap usage</SectionTitle>
                  <Stack gap="2xs">
                    <For each={usage()}>
                      {(row) => (
                        <Inline gap="sm" justify="between">
                          <Text type="meta" tone="muted">
                            {row.position} games
                          </Text>
                          <Text type="meta" numeric>
                            {number(row.played)} played · {number(row.projected)} projected
                          </Text>
                        </Inline>
                      )}
                    </For>
                    <Show when={innings()}>
                      {(value) => (
                        <Inline gap="sm" justify="between">
                          <Text type="meta" tone="muted">
                            Innings pitched
                          </Text>
                          <Text type="meta" numeric>
                            {number(value().pitched)} pitched · {number(value().projected)}{" "}
                            projected
                          </Text>
                        </Inline>
                      )}
                    </Show>
                  </Stack>
                </Stack>
              </Show>
            </Stack>
          )}
        </Show>
      </SeasonArea>
    </Card>
  );
}
