import { EffectArray } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Inline } from "#browser/shared-ui/Inline.tsx";
import { TextSkeleton } from "#browser/shared-ui/Skeleton.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Table } from "#browser/shared-ui/Table.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

import { matchupFacts, seasonFacts, scoreText, totalCategoryPoints } from "./seasonFacts";
import type {
  CategoryRow,
  MatchupFactsView,
  MatchupLead,
  SeasonFactsData,
  SeasonFactsView,
} from "./seasonFacts";
import { categoryStat, number, ordinal } from "./seasonLabels";

export function SeasonFacts(props: SeasonFactsProps): JSX.Element {
  const season = (): SeasonFactsView => seasonFacts(props.data);
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
        <Text type="meta" tone="muted">
          Place
        </Text>
        <Show when={season().place ?? season().record}>
          <Inline gap="sm" align="baseline">
            <Show when={season().place}>
              {(value) => <Text type="body-strong">{value()}</Text>}
            </Show>
            <Show when={season().record}>
              {(value) => (
                <Text type="meta" tone="muted">
                  {value()}
                </Text>
              )}
            </Show>
          </Inline>
        </Show>
        <Show when={season().period}>
          {(value) => (
            <>
              <Text type="meta">{value().headline}</Text>
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
        <Show when={season().pointsLine}>
          {(value) => (
            <Text type="meta" tone="muted">
              {value()}
            </Text>
          )}
        </Show>
      </Stack>
      <Show when={caps().length > 0 || (props.usage?.length ?? 0) > 0 || props.innings}>
        <Stack gap="2xs">
          <Text type="meta" tone="muted">
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

export function MatchupSummary(props: MatchupSummaryProps): JSX.Element {
  const facts = (): MatchupFactsView | undefined => matchupFacts(props.data);
  const totalPoints = (): number | undefined => totalCategoryPoints(props.categoryRows);
  const matchupCategories = (): ReadonlyArray<MatchupCategory> =>
    props.data.format === "head_to_head_categories"
      ? EffectArray.filter(
          props.data.matchup?.categories ?? [],
          (row) => row.scoring !== "informational",
        )
      : [];
  return (
    <Stack gap="md">
      <Show when={facts()}>
        {(matchup) => (
          <Stack gap="2xs">
            <Show when={matchup().lead}>{(lead) => <MatchupLeadLine lead={lead()} />}</Show>
            <Show when={matchup().projected}>
              {(score) => (
                <ScorePair
                  opponentPoints={score().opponentPoints}
                  points={score().points}
                  prefix="Projected"
                  tone="muted"
                  type="meta"
                />
              )}
            </Show>
            <Text type="meta" tone="muted">
              {matchup().opponent}
            </Text>
            <Show when={matchup().remaining}>
              {(line) => (
                <Text type="meta" tone="muted">
                  {line()}
                </Text>
              )}
            </Show>
          </Stack>
        )}
      </Show>
      <Show when={props.data.format === "rotisserie" && props.categoryRows.length > 0}>
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
              value={row.total === null ? "–" : categoryStat(row.total)}
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

export function MatchupLeadLine(props: { readonly lead: MatchupLead }): JSX.Element {
  const categories = (): Extract<MatchupLead, { kind: "categories" }> | undefined =>
    props.lead.kind === "categories" ? props.lead : undefined;
  const points = (): Extract<MatchupLead, { kind: "points" }> | undefined =>
    props.lead.kind === "points" ? props.lead : undefined;
  return (
    <Show
      fallback={
        <Show when={points()}>
          {(lead) => (
            <ScorePair
              opponentPoints={lead().score.opponentPoints}
              points={lead().score.points}
              type="body-strong"
            />
          )}
        </Show>
      }
      when={categories()}
    >
      {(lead) => <Text type="body-strong">{lead().record}</Text>}
    </Show>
  );
}

export function ScorePair(props: {
  readonly points: number | null;
  readonly opponentPoints: number | null;
  readonly type: "body-strong" | "meta";
  readonly tone?: "muted";
  readonly prefix?: string;
}): JSX.Element {
  const prefix = (): string => (props.prefix === undefined ? "" : `${props.prefix} `);
  return (
    <Text type={props.type} tone={props.tone}>
      {`${prefix()}${scoreText(props.points)} to ${scoreText(props.opponentPoints)}`}
    </Text>
  );
}

function CategoryValue(props: { readonly loading: boolean; readonly value: string }): JSX.Element {
  return (
    <Show fallback={<Text type="body">{props.value}</Text>} when={props.loading}>
      <TextSkeleton type="body" width="w-full" />
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
      fallback={<TextSkeleton type="body" width="w-full" />}
      when={!props.loading || props.value !== null}
    >
      <Text type={props.winner ? "body-strong" : "body"}>
        {props.value === null ? "–" : categoryStat(props.value)}
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
        <TextSkeleton type="body-strong" width="w-full" />
      </Show>
    </Inline>
  );
}

type MatchupCategory = NonNullable<TeamOverviewView["matchup"]>["categories"][number];

type SeasonFactsProps = {
  readonly data: SeasonFactsData;
  readonly usage?: ReadonlyArray<{
    readonly position: string;
    readonly played: number;
    readonly projected: number;
  }>;
  readonly innings?: { readonly pitched: number; readonly projected: number };
};

type MatchupSummaryProps = {
  readonly data: SeasonFactsData;
  readonly categoryRows: ReadonlyArray<CategoryRow>;
  readonly categoryValuesLoading: boolean;
};
