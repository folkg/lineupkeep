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
  ordinal,
  periodParts,
  placeLabel,
  recordLabel,
} from "./seasonLabels";

type SeasonFormat =
  | "head_to_head_categories"
  | "head_to_head_points"
  | "rotisserie"
  | "points"
  | "unknown";

export type SeasonSummaryData = {
  readonly format?: SeasonFormat;
  readonly teamCount?: number;
  readonly seasonOver?: boolean;
  readonly currentPeriod?: number;
  readonly lastPeriod?: number;
  readonly usesPlayoffs?: boolean;
  readonly playoffStartWeek?: number;
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
  readonly usage?: ReadonlyArray<{
    readonly position: string;
    readonly played: number;
    readonly projected: number;
  }>;
  readonly innings?: {
    readonly pitched: number;
    readonly projected: number;
  };
};

export type CategoryRow = NonNullable<TeamOverviewView["categoryPoints"]>[number];

export function SeasonFacts(props: {
  readonly data: SeasonSummaryData;
  readonly usage?: ReadonlyArray<{
    readonly position: string;
    readonly played: number;
    readonly projected: number;
  }>;
  readonly innings?: { readonly pitched: number; readonly projected: number };
}): JSX.Element {
  const standing = (): SeasonSummaryData["standing"] => props.data.standing;
  const format = (): SeasonFormat | undefined => props.data.format;
  const showPoints = (): boolean => format() !== "head_to_head_categories";
  const showAgainst = (): boolean => format() === "head_to_head_points" || format() === "points";
  const place = (): string | undefined => placeLabel(standing()?.rank, props.data.teamCount);
  const record = (): string | undefined => recordLabel(props.data.record);
  const period = (): ReturnType<typeof periodParts> =>
    periodParts(
      props.data.currentPeriod,
      props.data.lastPeriod,
      props.data.seasonOver,
      props.data.usesPlayoffs,
      props.data.playoffStartWeek,
    );
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
    <Stack gap="md">
      <Stack gap="2xs">
        <Text type="label" tone="faint">
          Place
        </Text>
        <Show when={place() ?? record()}>
          <Inline gap="sm" align="baseline">
            <Show when={place()}>{(value) => <Text type="body-strong">{value()}</Text>}</Show>
            <Show when={record()}>
              {(value) => (
                <Text type="body-strong" tone="muted">
                  {value()}
                </Text>
              )}
            </Show>
          </Inline>
        </Show>
        <Show when={period()}>
          {(value) => (
            <>
              <Text type="body">{value().headline}</Text>
              <For each={value().details}>
                {(line) => (
                  <Text type="meta" tone="muted">
                    {line}
                  </Text>
                )}
              </For>
            </>
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
      <Show when={caps().length > 0 || (props.usage?.length ?? 0) > 0 || props.innings}>
        <Stack gap="2xs">
          <Text type="label" tone="faint">
            Cap usage
          </Text>
          <For each={caps()}>
            {(line) => (
              <Text type="meta" tone="muted">
                {line}
              </Text>
            )}
          </For>
          <For each={props.usage ?? []}>
            {(row) => (
              <Inline gap="sm" justify="between">
                <Text type="meta" tone="muted">
                  {row.position} games
                </Text>
                <Text type="meta">
                  {number(row.played)} played · {number(row.projected)} projected
                </Text>
              </Inline>
            )}
          </For>
          <Show when={props.innings}>
            {(value) => (
              <Inline gap="sm" justify="between">
                <Text type="meta" tone="muted">
                  Innings pitched
                </Text>
                <Text type="meta">
                  {number(value().pitched)} pitched · {number(value().projected)} projected
                </Text>
              </Inline>
            )}
          </Show>
        </Stack>
      </Show>
    </Stack>
  );
}

export function MatchupSummary(props: {
  readonly data: SeasonSummaryData;
  readonly categoryRows: ReadonlyArray<CategoryRow>;
  readonly categoryValuesLoading: boolean;
}): JSX.Element {
  const matchup = (): SeasonSummaryData["matchup"] => props.data.matchup;
  const format = (): SeasonFormat | undefined => props.data.format;
  const showPoints = (): boolean => format() !== "head_to_head_categories";
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
  const totalPoints = (): number | undefined => {
    const rows = EffectArray.filter(
      props.categoryRows,
      (row) => row.scoring !== "informational" && row.value !== null,
    );
    return rows.length === 0
      ? undefined
      : EffectArray.reduce(rows, 0, (total, row) => total + (row.value ?? 0));
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
  const categoryWins = (): { readonly wins: number; readonly losses: number } | undefined => {
    if (format() !== "head_to_head_categories") {
      return undefined;
    }
    const rows = matchupCategories();
    if (rows.length === 0) {
      return undefined;
    }
    return {
      wins: EffectArray.filter(rows, (row) => categoryWinner(row, "own")).length,
      losses: EffectArray.filter(rows, (row) => categoryWinner(row, "opponent")).length,
    };
  };
  return (
    <Stack gap="md">
      <Show when={matchup()}>
        <Stack gap="2xs">
          <Text type="body">{opponentLine()}</Text>
          <Show when={scoreLine()}>
            <ScorePair
              points={matchup()?.points ?? null}
              opponentPoints={matchup()?.opponentPoints ?? null}
              type="body-strong"
            />
          </Show>
          <Show when={projectedLine()}>
            <ScorePair
              prefix="Projected"
              points={matchup()?.projectedPoints ?? null}
              opponentPoints={matchup()?.opponentProjectedPoints ?? null}
              tone="muted"
              type="meta"
            />
          </Show>
          <Show when={categoryRecordLine()}>
            {(value) => <Text type="body-strong">{value()}</Text>}
          </Show>
          <Show when={remainingLine()}>
            {(value) => (
              <Text type="meta" tone="muted">
                {value()}
              </Text>
            )}
          </Show>
        </Stack>
      </Show>
      <Show when={format() === "rotisserie" && props.categoryRows.length > 0}>
        <Table
          columns={[
            { label: "Category" },
            { label: "Stat", align: "end", width: "w-16" },
            { label: "Place", align: "end", width: "w-14" },
            { label: "Pts", align: "end", width: "w-12" },
          ]}
          footer={
            <FooterLine
              label="Total points"
              loading={props.categoryValuesLoading && totalPoints() === undefined}
              value={totalPoints() === undefined ? "–" : number(totalPoints() ?? 0)}
            />
          }
          label="My categories"
          rows={EffectArray.map(props.categoryRows, (row) => [
            <Text type="body">{row.name}</Text>,
            <CategoryValue
              loading={props.categoryValuesLoading && row.total === null}
              value={row.total === null ? "–" : categoryStat(row.name, row.total)}
            />,
            <CategoryValue
              loading={props.categoryValuesLoading && row.place === null}
              value={row.place === null ? "–" : ordinal(row.place)}
            />,
            <CategoryValue
              loading={props.categoryValuesLoading && row.value === null}
              value={row.value === null ? "–" : number(row.value)}
            />,
          ])}
        />
      </Show>
      <Show when={matchupCategories().length > 0}>
        <Table
          columns={[
            { label: "Category" },
            { label: "You", align: "end", width: "w-16" },
            { label: "Them", align: "end", width: "w-16" },
          ]}
          footerCells={
            categoryWins() === undefined
              ? undefined
              : [
                  <Text type="meta" tone="muted">
                    Wins
                  </Text>,
                  <Text type="body-strong">{String(categoryWins()?.wins)}</Text>,
                  <Text type="body-strong">{String(categoryWins()?.losses)}</Text>,
                ]
          }
          label="Matchup categories"
          rows={EffectArray.map(matchupCategories(), (row) => [
            <Text type="body">{row.name}</Text>,
            <MatchupValue
              loading={props.categoryValuesLoading}
              name={row.name}
              value={row.own}
              winner={categoryWinner(row, "own")}
            />,
            <MatchupValue
              loading={props.categoryValuesLoading}
              name={row.name}
              value={row.opponent}
              winner={categoryWinner(row, "opponent")}
            />,
          ])}
        />
      </Show>
    </Stack>
  );
}

function CategoryValue(props: { readonly loading: boolean; readonly value: string }): JSX.Element {
  return (
    <Show fallback={<Text type="body">{props.value}</Text>} when={props.loading}>
      <Inline gap="2xs" justify="end">
        <Skeleton height="h-[1.125rem]" width="w-10" />
      </Inline>
    </Show>
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
      fallback={
        <Inline gap="2xs" justify="end">
          <Skeleton height="h-[1.125rem]" width="w-10" />
        </Inline>
      }
      when={!props.loading || props.value !== null}
    >
      <Text type={props.winner ? "body-strong" : "body"}>
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

export function ScorePair(props: {
  readonly points: number | null;
  readonly opponentPoints: number | null;
  readonly type: "body-strong" | "meta";
  readonly tone?: "muted";
  readonly prefix?: string;
}): JSX.Element {
  return (
    <Inline gap="2xs" align="baseline">
      <Show when={props.prefix}>
        {(prefix) => (
          <Text type={props.type} tone={props.tone}>
            {prefix()}
          </Text>
        )}
      </Show>
      <Text type={props.type} tone={props.tone}>
        {scoreText(props.points)}
      </Text>
      <Text type={props.type} tone={props.tone}>
        to
      </Text>
      <Text type={props.type} tone={props.tone}>
        {scoreText(props.opponentPoints)}
      </Text>
    </Inline>
  );
}

function FooterLine(props: {
  readonly label: string;
  readonly value: string;
  readonly loading?: boolean;
}): JSX.Element {
  return (
    <Inline gap="sm" justify="between">
      <Text type="meta" tone="muted">
        {props.label}
      </Text>
      <Show fallback={<Text type="body-strong">{props.value}</Text>} when={props.loading === true}>
        <Skeleton height="h-[1.125rem]" width="w-8" />
      </Show>
    </Inline>
  );
}

function scoreText(value: number | null): string {
  return value === null ? "–" : matchupNumber(value);
}

type MatchupCategory = NonNullable<TeamOverviewView["matchup"]>["categories"][number];
