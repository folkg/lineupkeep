import { EffectArray } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { CardNote } from "#browser/shared-ui/Card.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { TextSkeleton } from "#browser/shared-ui/Skeleton.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamCardView } from "#contracts/connections/teamContract.ts";

import { matchupNumber, number, periodLabel, placeLabel, recordLabel } from "./seasonLabels";
import { ScorePair } from "./SeasonSummary";
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
      seasonOver: season.seasonOver,
      ...(season.currentWeek === undefined ? {} : { currentPeriod: season.currentWeek }),
      ...(season.endWeek === undefined ? {} : { lastPeriod: season.endWeek }),
      ...(season.usesPlayoffs === undefined ? {} : { usesPlayoffs: season.usesPlayoffs }),
      ...(season.playoffStartWeek === undefined
        ? {}
        : { playoffStartWeek: season.playoffStartWeek }),
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
              ? "Season facts could not be loaded. Lineup runs and controls are still available."
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
        <TextSkeleton type="meta" width="w-16" />
        <TextSkeleton type="body-strong" width="w-24" />
        <TextSkeleton type="meta" width="w-40" />
      </Stack>
      <CardNote>
        <Stack gap="2xs">
          <TextSkeleton type="meta" width="w-32" />
          <TextSkeleton type="body-strong" width="w-28" />
          <TextSkeleton type="meta" width="w-36" />
          <TextSkeleton type="meta" width="w-48" />
          <TextSkeleton type="meta" width="w-32" />
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
  const period = (): string | undefined =>
    periodLabel(
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
    return `${String(wins)}-${String(losses)}-${String(ties)}`;
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
        <Text type="meta" tone="muted">
          Season
        </Text>
        <Show when={place() ?? record()}>
          <Inline gap="sm" align="baseline">
            <Show when={place()}>{(value) => <Text type="body-strong">{value()}</Text>}</Show>
            <Show when={record()}>{(value) => <Text type="meta">{value()}</Text>}</Show>
          </Inline>
        </Show>
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
        <CardNote>
          <Stack gap="2xs">
            <Text type="meta" tone="muted">
              Current matchup
            </Text>
            <Show when={categoryRecord()}>
              {(value) => <Text type="body-strong">{value()}</Text>}
            </Show>
            <Show when={categoryRecord() === undefined}>
              <Show when={scoreLine()}>
                <ScorePair
                  points={matchup()?.points ?? null}
                  opponentPoints={matchup()?.opponentPoints ?? null}
                  type="body-strong"
                />
              </Show>
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
            <Text type="meta" tone="muted">
              {matchupLine()}
            </Text>
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
  return value === null ? "–" : matchupNumber(value);
}
