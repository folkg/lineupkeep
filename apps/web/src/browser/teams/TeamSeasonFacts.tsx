import { EffectString } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Definition, DefinitionList } from "#browser/shared-ui/DefinitionList.tsx";
import { OverviewLoadingRows } from "#browser/shared-ui/Skeleton.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamCardView } from "#contracts/connections/teamContract.ts";

export function TeamSeasonFacts(props: {
  readonly facts: TeamCardView | undefined;
  readonly failed: boolean;
  readonly loading: boolean;
}): JSX.Element {
  const season = (): TeamCardView["season"] => props.facts?.season;
  const standing = (): NonNullable<TeamCardView["season"]>["standing"] => season()?.standing;
  const points = (): number | null | undefined => standing()?.pointsFor;
  const record = (): string => {
    if (season()?.format === "rotisserie") {
      return "This format does not publish a win-loss record.";
    }
    const published = standing()?.record;
    if (published === undefined) {
      return "Record not published.";
    }
    const totals = `${published.wins}-${published.losses}-${published.ties}`;
    return published.percentage === null
      ? `${totals} (percentage not published)`
      : `${totals} (${percentage(published.percentage)})`;
  };

  return (
    <Show
      fallback={
        <Stack gap="sm">
          <Text type="meta" tone="muted">
            {props.failed
              ? "Season facts could not be loaded. Lineup checks and controls are still available."
              : (props.facts?.reason ??
                (props.loading
                  ? "Loading season facts."
                  : "Season facts were not published for this team."))}
          </Text>
          <Show when={props.loading && !props.failed && props.facts?.reason === undefined}>
            <OverviewLoadingRows count={8} paired />
          </Show>
        </Stack>
      }
      when={season()}
    >
      {(facts) => (
        <>
          <DefinitionList compact paired>
            <Show
              when={
                standing()?.rank !== null &&
                standing()?.rank !== undefined &&
                facts().teamCount !== undefined
              }
            >
              <Definition
                compact
                term="Place"
                value={`${ordinal(standing()?.rank ?? 0)} of ${facts().teamCount}`}
              />
            </Show>
            <Show when={standing() !== undefined}>
              <Definition compact term="Record" value={record()} />
            </Show>
            <Show when={points() !== null && points() !== undefined}>
              <Definition compact term="Points" value={number(points() ?? 0)} />
            </Show>
            <Show
              when={standing()?.pointsAgainst !== null && standing()?.pointsAgainst !== undefined}
            >
              <Definition
                compact
                term="Points against"
                value={number(standing()?.pointsAgainst ?? 0)}
              />
            </Show>
            <Show when={standing()?.pointsBack !== null && standing()?.pointsBack !== undefined}>
              <Definition
                compact
                term="Behind leader"
                value={number(standing()?.pointsBack ?? 0)}
              />
            </Show>
            <Definition
              compact
              term="Scoring format"
              value={scoringLabel(facts().scoringLabel) ?? scoringFormatLabel(facts().format)}
            />
            <Show when={facts().maxGamesPlayed !== undefined && (facts().maxGamesPlayed ?? 0) > 0}>
              <Definition compact term="Games cap" value={number(facts().maxGamesPlayed ?? 0)} />
            </Show>
            <Show
              when={facts().maxInningsPitched !== undefined && (facts().maxInningsPitched ?? 0) > 0}
            >
              <Definition
                compact
                term="Innings cap"
                value={number(facts().maxInningsPitched ?? 0)}
              />
            </Show>
            <Show
              when={
                facts().weeklyDeadline !== undefined &&
                facts().weeklyDeadline !== "" &&
                facts().weeklyDeadline !== "intraday"
              }
            >
              <Definition compact term="Lineup changes" value="Weekly" />
            </Show>
            <Show
              when={
                facts().seasonOver !== true &&
                facts().currentWeek !== undefined &&
                facts().endWeek !== undefined
              }
            >
              <Definition
                compact
                term="Season progress"
                value={`Week ${facts().currentWeek} of ${facts().endWeek}`}
              />
            </Show>
            <Show
              when={
                facts().endDate !== undefined &&
                (facts().currentWeek === undefined || facts().seasonOver === true)
              }
            >
              <Definition
                compact
                term="Season window"
                value={
                  facts().seasonOver === true
                    ? `Season ended ${facts().endDate}`
                    : `Season ends ${facts().endDate}`
                }
              />
            </Show>
          </DefinitionList>
          <Show when={standing() === undefined}>
            <Text type="meta" tone="muted">
              Standings were not published for this team.
            </Text>
          </Show>
          <Show when={standing() !== undefined && (points() === null || points() === undefined)}>
            <Text type="meta" tone="muted">
              Points were not published for this team.
            </Text>
          </Show>
        </>
      )}
    </Show>
  );
}

function ordinal(rank: number): string {
  const suffix =
    rank % 100 >= 11 && rank % 100 <= 13
      ? "th"
      : rank % 10 === 1
        ? "st"
        : rank % 10 === 2
          ? "nd"
          : rank % 10 === 3
            ? "rd"
            : "th";
  return `${rank}${suffix}`;
}

function scoringFormatLabel(format: NonNullable<TeamCardView["season"]>["format"]): string {
  switch (format) {
    case "head_to_head_categories":
      return "Head to head categories";
    case "head_to_head_points":
      return "Head to head points";
    case "rotisserie":
      return "Rotisserie";
    case "points":
      return "Points";
    case "unknown":
      return "Unknown scoring format";
  }
}

export function scoringLabel(label: string | undefined): string | undefined {
  if (label === undefined) {
    return undefined;
  }
  switch (EffectString.toLowerCase(EffectString.trim(label))) {
    case "h2h":
    case "head to head":
      return "Head to head";
    case "h2h cat":
    case "h2h cats":
    case "h2h categories":
    case "head to head, categories":
      return "Head to head categories";
    case "h2h points":
    case "h2h pts":
    case "head to head, points":
      return "Head to head points";
    case "roto":
      return "Rotisserie";
    default:
      return label;
  }
}

function percentage(value: number): string {
  return EffectString.replace(value.toFixed(3), /^0/u, "");
}

function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
