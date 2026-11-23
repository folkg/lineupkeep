import { EffectArray } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Inline } from "#browser/shared-ui/Inline.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

import { number, placeLabel, recordLabel } from "./seasonLabels";

type SeasonFormat =
  | "head_to_head_categories"
  | "head_to_head_points"
  | "rotisserie"
  | "points"
  | "unknown";

export type SeasonSummaryData = {
  readonly format?: SeasonFormat;
  readonly teamCount?: number;
  readonly standing?: {
    readonly rank: number | null;
    readonly points: number | null;
    readonly pointsFor: number | null;
    readonly pointsAgainst: number | null;
    readonly pointsBack: number | null;
  };
  readonly record?: {
    readonly wins: number;
    readonly losses: number;
    readonly ties: number;
    readonly percentage: number | null;
  };
  readonly matchup?: TeamOverviewView["matchup"];
  readonly categoryPoints?: TeamOverviewView["categoryPoints"];
  readonly caps?: {
    readonly gamesPlayed?: number;
    readonly inningsPitched?: number;
  };
};

export function SeasonSummary(props: {
  readonly data: SeasonSummaryData;
  readonly detail: boolean;
  readonly matchupHeading?: string;
  readonly capsHeading?: string;
}): JSX.Element {
  const standing = (): SeasonSummaryData["standing"] => props.data.standing;
  const matchup = (): SeasonSummaryData["matchup"] => props.data.matchup;
  const place = (): string | undefined => placeLabel(standing()?.rank, props.data.teamCount);
  const record = (): string | undefined => recordLabel(props.data.record);
  const format = (): SeasonFormat | undefined => props.data.format;
  const showPoints = (): boolean => format() !== "head_to_head_categories";
  const showAgainst = (): boolean => format() === "head_to_head_points" || format() === "points";
  const pointsFor = (): number | undefined =>
    format() === "rotisserie"
      ? (standing()?.points ?? undefined)
      : (standing()?.pointsFor ?? undefined);
  const pointsAgainst = (): number | undefined => standing()?.pointsAgainst ?? undefined;
  const pointsBack = (): number | undefined => standing()?.pointsBack ?? undefined;
  const categoryRecord = (): string | undefined => {
    const categories = matchup()?.categories ?? [];
    const wins = EffectArray.filter(categories, (category) => category.result === "win").length;
    const losses = EffectArray.filter(categories, (category) => category.result === "loss").length;
    const ties = EffectArray.filter(categories, (category) => category.result === "tie").length;
    return wins + losses + ties === 0
      ? undefined
      : `${String(wins)}-${String(losses)}-${String(ties)} categories`;
  };
  const categoryRows = (): ReadonlyArray<
    NonNullable<TeamOverviewView["matchup"]>["categories"][number]
  > =>
    EffectArray.filter(
      matchup()?.categories ?? [],
      (category) => category.own !== null && category.opponent !== null,
    );
  const categoryPoints = (): ReadonlyArray<
    NonNullable<TeamOverviewView["categoryPoints"]>[number]
  > => EffectArray.filter(props.data.categoryPoints ?? [], (category) => category.value !== null);
  const scoreText = (value: number | null): string => (value === null ? "–" : number(value));
  const countText = (value: number | undefined): string =>
    value === undefined ? "–" : number(value);
  const caps = (): ReadonlyArray<string> => {
    const value = props.data.caps;
    return [
      ...(value?.gamesPlayed === undefined ? [] : [`Max ${number(value.gamesPlayed)} games`]),
      ...(value?.inningsPitched === undefined
        ? []
        : [`Max ${number(value.inningsPitched)} innings`]),
    ];
  };
  return (
    <Stack gap="sm">
      <Show when={place() ?? record()}>
        <Inline gap="sm" align="baseline">
          <Show when={place()}>{(value) => <Text type="body-strong">{value()}</Text>}</Show>
          <Show when={record()}>{(value) => <Text type="meta">{value()}</Text>}</Show>
        </Inline>
      </Show>
      <Show
        when={
          showPoints() &&
          (pointsFor() !== undefined ||
            (showAgainst() && (pointsAgainst() !== undefined || pointsBack() !== undefined)))
        }
      >
        <Inline gap="sm" align="baseline">
          <Show when={pointsFor() !== undefined}>
            <Text type="body-strong">
              {number(pointsFor() ?? 0)}{" "}
              <Text as="span" type="meta">
                points
              </Text>
            </Text>
          </Show>
          <Show when={showAgainst() && pointsAgainst() !== undefined}>
            <Text type="meta">{number(pointsAgainst() ?? 0)} against</Text>
          </Show>
          <Show when={showAgainst() && pointsBack() !== undefined}>
            <Text type="meta">{number(pointsBack() ?? 0)} behind leader</Text>
          </Show>
        </Inline>
      </Show>
      <Show when={matchup()}>
        {(current) => (
          <Stack gap="xs">
            <Show when={props.matchupHeading}>
              {(heading) => <SectionTitle level={3}>{heading()}</SectionTitle>}
            </Show>
            <Text type="meta" tone="muted">
              Week {String(current().week)} · vs {current().opponent}
            </Text>
            <Show
              when={
                showPoints() && (current().points !== null || current().opponentPoints !== null)
              }
            >
              <Text type="body-strong" numeric>
                {scoreText(current().points)} to {scoreText(current().opponentPoints)}
              </Text>
            </Show>
            <Show
              when={
                showPoints() &&
                (current().projectedPoints !== null || current().opponentProjectedPoints !== null)
              }
            >
              <Text type="meta" tone="muted">
                Projected {scoreText(current().projectedPoints)} to{" "}
                {scoreText(current().opponentProjectedPoints)}
              </Text>
            </Show>
            <Show when={categoryRecord()}>
              {(value) => (
                <Text type="meta" tone="muted">
                  {value()}
                </Text>
              )}
            </Show>
            <Show when={props.detail && categoryRows().length > 0}>
              <Stack gap="2xs">
                <For each={categoryRows()}>
                  {(category) => (
                    <Inline gap="sm" justify="between">
                      <Text type="meta" tone="muted">
                        {category.name}
                        {category.scoring === "informational" ? " (info)" : ""}
                      </Text>
                      <Text type="meta" numeric>
                        {scoreText(category.own)} to {scoreText(category.opponent)}
                      </Text>
                    </Inline>
                  )}
                </For>
              </Stack>
            </Show>
            <Show when={props.detail && categoryPoints().length > 0}>
              <Stack gap="2xs">
                <For each={categoryPoints()}>
                  {(category) => (
                    <Inline gap="sm" justify="between">
                      <Text type="meta" tone="muted">
                        {category.name}
                        {category.scoring === "informational" ? " (info)" : ""}
                      </Text>
                      <Text type="meta" numeric>
                        {scoreText(category.value)}
                      </Text>
                    </Inline>
                  )}
                </For>
              </Stack>
            </Show>
            <Show when={props.detail && current().remainingGames !== undefined}>
              <Text type="meta" tone="muted">
                {countText(current().remainingGames)} games left
                {current().opponentRemainingGames === undefined
                  ? ""
                  : ` · ${countText(current().opponentRemainingGames)} for them`}
              </Text>
            </Show>
          </Stack>
        )}
      </Show>
      <Show when={props.detail && caps().length > 0}>
        <Show when={props.capsHeading}>
          {(heading) => <SectionTitle level={3}>{heading()}</SectionTitle>}
        </Show>
        <Inline gap="sm">
          <For each={caps()}>
            {(line) => (
              <Text type="meta" tone="muted">
                {line}
              </Text>
            )}
          </For>
        </Inline>
      </Show>
    </Stack>
  );
}
