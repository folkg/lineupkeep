import { EffectArray } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { CardNote } from "#browser/shared-ui/Card.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Skeleton } from "#browser/shared-ui/Skeleton.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamCardView } from "#contracts/connections/teamContract.ts";

import { number, placeLabel, recordLabel } from "./seasonLabels";
import type { SeasonSummaryData } from "./SeasonSummary";

export function TeamSeasonFacts(props: {
  readonly facts: TeamCardView | undefined;
  readonly failed: boolean;
  readonly loading: boolean;
}): JSX.Element {
  const showSkeleton = (): boolean =>
    props.loading && !props.failed && props.facts?.season === undefined;
  const data = (): SeasonSummaryData | undefined => {
    const season = props.facts?.season;
    if (season === undefined) {
      return undefined;
    }
    return {
      format: season.format,
      teamCount: season.teamCount,
      standing: season.standing,
      record: season.standing?.record,
      ...(season.matchup === undefined ? {} : { matchup: season.matchup }),
    };
  };
  return (
    <Show
      fallback={
        <Show
          fallback={<CardSeasonFactsSkeleton />}
          when={
            !showSkeleton() &&
            (props.failed || props.facts?.reason !== undefined || props.facts?.season === undefined)
          }
        >
          <Text type="meta" tone="muted">
            {props.failed
              ? "Season facts could not be loaded. Lineup checks and controls are still available."
              : (props.facts?.reason ?? "Season facts were not published for this team.")}
          </Text>
        </Show>
      }
      when={data()}
    >
      {(facts) => <CardSeasonFacts data={facts()} />}
    </Show>
  );
}

function CardSeasonFactsSkeleton(): JSX.Element {
  return (
    <Stack gap="sm">
      <Stack gap="2xs">
        <Skeleton height="h-3" width="w-16" />
        <Skeleton height="h-5" width="w-28" />
        <Skeleton height="h-3" width="w-36" />
      </Stack>
      <CardNote>
        <Stack gap="2xs">
          <Skeleton height="h-3" width="w-24" />
          <Skeleton height="h-5" width="w-40" />
          <Skeleton height="h-5" width="w-24" />
          <Skeleton height="h-3" width="w-36" />
        </Stack>
      </CardNote>
    </Stack>
  );
}

function CardSeasonFacts(props: { readonly data: SeasonSummaryData }): JSX.Element {
  const standing = (): SeasonSummaryData["standing"] => props.data.standing;
  const matchup = (): SeasonSummaryData["matchup"] => props.data.matchup;
  const format = (): SeasonSummaryData["format"] => props.data.format;
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
    return current === undefined
      ? undefined
      : `Week ${String(current.week)} vs ${current.opponent}`;
  };
  const scoreLine = (): string | undefined => {
    const current = matchup();
    if (current === undefined || !showPoints()) {
      return undefined;
    }
    if (current.points === null && current.opponentPoints === null) {
      return undefined;
    }
    return `${scoreText(current.points)} to ${scoreText(current.opponentPoints)}`;
  };
  const projectedLine = (): string | undefined => {
    const current = matchup();
    if (current === undefined || !showPoints()) {
      return undefined;
    }
    if (current.projectedPoints === null && current.opponentProjectedPoints === null) {
      return undefined;
    }
    return `Projected ${scoreText(current.projectedPoints)} to ${scoreText(current.opponentProjectedPoints)}`;
  };
  const categoryRecord = (): string | undefined => {
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
  return (
    <Stack gap="sm">
      <Stack gap="2xs">
        <Text type="label" tone="faint">
          Season
        </Text>
        <Show when={place() ?? record()}>
          <Inline gap="sm" align="baseline">
            <Show when={place()}>{(value) => <Text type="body-strong">{value()}</Text>}</Show>
            <Show when={record()}>{(value) => <Text type="body-strong">{value()}</Text>}</Show>
          </Inline>
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
        <CardNote>
          <Stack gap="2xs">
            <Text type="label" tone="faint">
              Current matchup
            </Text>
            <Text type="body-strong">{matchupLine()}</Text>
            <Show when={scoreLine()}>
              {(value) => (
                <Text type="body-strong" numeric>
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
            <Show when={categoryRecord()}>
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
        </CardNote>
      </Show>
    </Stack>
  );
}

function scoreText(value: number | null): string {
  return value === null ? "–" : number(value);
}
