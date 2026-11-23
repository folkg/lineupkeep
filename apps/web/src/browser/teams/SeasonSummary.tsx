import { EffectArray } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Inline } from "#browser/shared-ui/Inline.tsx";
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
  readonly caps?: {
    readonly gamesPlayed?: number;
    readonly inningsPitched?: number;
  };
};

export function SeasonSummary(props: { readonly data: SeasonSummaryData }): JSX.Element {
  const standing = (): SeasonSummaryData["standing"] => props.data.standing;
  const matchup = (): SeasonSummaryData["matchup"] => props.data.matchup;
  const format = (): SeasonFormat | undefined => props.data.format;
  const showPoints = (): boolean => format() !== "head_to_head_categories";
  const showAgainst = (): boolean => format() === "head_to_head_points" || format() === "points";
  const place = (): string | undefined => placeLabel(standing()?.rank, props.data.teamCount);
  const record = (): string | undefined => recordLabel(props.data.record);
  const pointsLine = (): string | undefined => {
    if (!showPoints()) {
      return undefined;
    }
    const forValue =
      format() === "rotisserie"
        ? (standing()?.points ?? undefined)
        : (standing()?.pointsFor ?? undefined);
    const parts = [
      ...(forValue === undefined
        ? []
        : [
            format() === "rotisserie"
              ? `${number(forValue)} points`
              : `${number(forValue)} points for`,
          ]),
      ...(showAgainst() &&
      standing()?.pointsAgainst !== null &&
      standing()?.pointsAgainst !== undefined
        ? [`${number(standing()?.pointsAgainst ?? 0)} against`]
        : []),
      ...(showAgainst() && standing()?.pointsBack !== null && standing()?.pointsBack !== undefined
        ? [`${number(standing()?.pointsBack ?? 0)} behind`]
        : []),
    ];
    return parts.length === 0 ? undefined : EffectArray.join(parts, " · ");
  };
  const matchupLine = (): string | undefined => {
    const current = matchup();
    if (current === undefined) {
      return undefined;
    }
    const score =
      showPoints() && (current.points !== null || current.opponentPoints !== null)
        ? `${scoreText(current.points)} to ${scoreText(current.opponentPoints)}`
        : undefined;
    const projected =
      showPoints() && (current.projectedPoints !== null || current.opponentProjectedPoints !== null)
        ? `Projected ${scoreText(current.projectedPoints)} to ${scoreText(current.opponentProjectedPoints)}`
        : undefined;
    const categoryRecord = categoryRecordLine();
    const remaining =
      current.remainingGames === undefined
        ? undefined
        : `${number(current.remainingGames)} games left${
            current.opponentRemainingGames === undefined
              ? ""
              : ` · ${number(current.opponentRemainingGames)} for them`
          }`;
    return EffectArray.join(
      [
        `Week ${String(current.week)} vs ${current.opponent}`,
        ...(score === undefined ? [] : [score]),
        ...(projected === undefined ? [] : [projected]),
        ...(categoryRecord === undefined ? [] : [categoryRecord]),
        ...(remaining === undefined ? [] : [remaining]),
      ],
      " · ",
    );
  };
  const categoryRecordLine = (): string | undefined => {
    const current = matchup();
    if (current === undefined || format() !== "head_to_head_categories") {
      return undefined;
    }
    const categories = current.categories;
    const wins = EffectArray.filter(categories, (category) => category.result === "win").length;
    const losses = EffectArray.filter(categories, (category) => category.result === "loss").length;
    const ties = EffectArray.filter(categories, (category) => category.result === "tie").length;
    return `${String(wins)}-${String(losses)}-${String(ties)} categories`;
  };
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
    <Stack gap="lg">
      <Inline gap="lg" justify="between" align="start">
        <Stack gap="2xs">
          <Text type="label" tone="faint">
            Place
          </Text>
          <Show when={place()}>{(value) => <Text type="body-strong">{value()}</Text>}</Show>
          <Show when={record()}>{(value) => <Text type="meta">{value()}</Text>}</Show>
          <Show when={pointsLine()}>
            {(value) => (
              <Text type="meta" tone="muted">
                {value()}
              </Text>
            )}
          </Show>
        </Stack>
        <Show when={matchup()}>
          <Stack gap="2xs">
            <Text type="label" tone="faint">
              Current matchup
            </Text>
            <Text numeric type="body">
              {matchupLine()}
            </Text>
          </Stack>
        </Show>
      </Inline>
      <Show when={caps().length > 0}>
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

function scoreText(value: number | null): string {
  return value === null ? "–" : number(value);
}
