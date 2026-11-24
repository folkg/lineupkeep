import { EffectArray } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Skeleton } from "#browser/shared-ui/Skeleton.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Table } from "#browser/shared-ui/Table.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

import {
  categoryStat,
  matchupNumber,
  number,
  periodLabel,
  placeLabel,
  recordLabel,
} from "./seasonLabels";

type SeasonFormat =
  | "head_to_head_categories"
  | "head_to_head_points"
  | "rotisserie"
  | "points"
  | "unknown";

type MatchupCategory = NonNullable<TeamOverviewView["matchup"]>["categories"][number];

export type SeasonSummaryData = {
  readonly format?: SeasonFormat;
  readonly teamCount?: number;
  readonly seasonOver?: boolean;
  readonly currentPeriod?: number;
  readonly lastPeriod?: number;
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

export function SeasonSummary(props: {
  readonly data: SeasonSummaryData;
  readonly categoryValuesLoading?: boolean;
}): JSX.Element {
  const standing = (): SeasonSummaryData["standing"] => props.data.standing;
  const matchup = (): SeasonSummaryData["matchup"] => props.data.matchup;
  const format = (): SeasonFormat | undefined => props.data.format;
  const showPoints = (): boolean => format() !== "head_to_head_categories";
  const showAgainst = (): boolean => format() === "head_to_head_points" || format() === "points";
  const place = (): string | undefined => placeLabel(standing()?.rank, props.data.teamCount);
  const record = (): string | undefined => recordLabel(props.data.record);
  const period = (): string | undefined =>
    periodLabel(props.data.currentPeriod, props.data.lastPeriod, props.data.seasonOver);
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
  const opponentLine = (): string | undefined => {
    const current = matchup();
    return current === undefined
      ? undefined
      : `Week ${String(current.week)} vs ${current.opponent}`;
  };
  const scoreLine = (): string | undefined => {
    const current = matchup();
    if (
      current === undefined ||
      !showPoints() ||
      (current.points === null && current.opponentPoints === null)
    ) {
      return undefined;
    }
    return `${scoreText(current.points)} to ${scoreText(current.opponentPoints)}`;
  };
  const projectedLine = (): string | undefined => {
    const current = matchup();
    if (
      current === undefined ||
      !showPoints() ||
      (current.projectedPoints === null && current.opponentProjectedPoints === null)
    ) {
      return undefined;
    }
    return `Projected ${scoreText(current.projectedPoints)} to ${scoreText(current.opponentProjectedPoints)}`;
  };
  const remainingLine = (): string | undefined => {
    const current = matchup();
    if (current?.remainingGames === undefined) {
      return undefined;
    }
    return `${number(current.remainingGames)} games left${
      current.opponentRemainingGames === undefined
        ? ""
        : ` · ${number(current.opponentRemainingGames)} for them`
    }`;
  };
  const matchupCategories = (): ReadonlyArray<MatchupCategory> =>
    format() === "head_to_head_categories"
      ? EffectArray.filter(matchup()?.categories ?? [], (row) => row.scoring !== "informational")
      : [];
  const categoryRecordLine = (): string | undefined => {
    const current = matchup();
    if (current === undefined || format() !== "head_to_head_categories") {
      return undefined;
    }
    const categories = current.categories;
    const wins = EffectArray.filter(categories, (category) => category.result === "win").length;
    const losses = EffectArray.filter(categories, (category) => category.result === "loss").length;
    const ties = EffectArray.filter(categories, (category) => category.result === "tie").length;
    return `${String(wins)}-${String(losses)}-${String(ties)}`;
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
      <Stack gap="2xs">
        <Text type="label" tone="faint">
          Place
        </Text>
        <Show when={place()}>{(value) => <Text type="body-strong">{value()}</Text>}</Show>
        <Show when={record()}>{(value) => <Text type="meta">{value()}</Text>}</Show>
        <Show when={period()}>
          {(value) => (
            <Text type="meta" tone="muted">
              {value()}
            </Text>
          )}
        </Show>
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
          <Text type="body">{opponentLine()}</Text>
          <Show when={scoreLine()}>
            {(value) => (
              <Text numeric type="body-strong">
                {value()}
              </Text>
            )}
          </Show>
          <Show when={projectedLine()}>
            {(value) => (
              <Text type="meta" tone="muted">
                {value()}
              </Text>
            )}
          </Show>
          <Show when={categoryRecordLine()}>{(value) => <Text type="meta">{value()}</Text>}</Show>
          <Show when={remainingLine()}>
            {(value) => (
              <Text type="meta" tone="muted">
                {value()}
              </Text>
            )}
          </Show>
        </Stack>
      </Show>
      <Show when={matchupCategories().length > 0}>
        <Stack gap="sm">
          <Text type="label" tone="faint">
            Matchup categories
          </Text>
          <Table
            columns={[
              { label: "Category" },
              { label: "You", align: "end", width: "w-16" },
              { label: "Them", align: "end", width: "w-16" },
            ]}
            label="Matchup categories"
            rows={EffectArray.map(matchupCategories(), (row) => [
              <Text type="body">{row.name}</Text>,
              <MatchupValue
                loading={props.categoryValuesLoading === true}
                name={row.name}
                value={row.own}
                winner={categoryWinner(row, "own")}
              />,
              <MatchupValue
                loading={props.categoryValuesLoading === true}
                name={row.name}
                value={row.opponent}
                winner={categoryWinner(row, "opponent")}
              />,
            ])}
          />
        </Stack>
      </Show>
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

function MatchupValue(props: {
  readonly name: string;
  readonly value: number | null;
  readonly winner: boolean;
  readonly loading: boolean;
}): JSX.Element {
  return (
    <Show
      fallback={<Skeleton height="h-3" width="w-10" />}
      when={!props.loading || props.value !== null}
    >
      <Text numeric type={props.winner ? "body-strong" : "meta"}>
        {props.value === null ? "–" : categoryStat(props.name, props.value)}
      </Text>
    </Show>
  );
}

function categoryWinner(row: MatchupCategory, side: "own" | "opponent"): boolean {
  if (row.result === "win") {
    return side === "own";
  }
  if (row.result === "loss") {
    return side === "opponent";
  }
  if (row.result === "tie" || row.own === null || row.opponent === null) {
    return false;
  }
  return side === "own" ? row.own > row.opponent : row.opponent > row.own;
}

function scoreText(value: number | null): string {
  return value === null ? "–" : matchupNumber(value);
}
