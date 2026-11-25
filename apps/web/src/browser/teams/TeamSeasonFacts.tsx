import type { TeamScoringFormat } from "@lineupkeep/backend/connections/FantasyTeam";
import { EffectArray } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { CardNote } from "#browser/shared-ui/Card.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { TextSkeleton } from "#browser/shared-ui/Skeleton.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamCardView } from "#contracts/connections/teamContract.ts";

import { matchupFacts, matchupLine, seasonFacts } from "./seasonFacts";
import type { MatchupFactsView, SeasonFactsData, SeasonFactsView } from "./seasonFacts";
import { MatchupLeadLine, ScorePair } from "./SeasonSummary";

export function TeamSeasonFacts(props: {
  readonly facts: TeamCardView | undefined;
  readonly failed: boolean;
  readonly format: TeamScoringFormat | undefined;
  readonly loading: boolean;
}): JSX.Element {
  const data = (): SeasonFactsData | undefined => {
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
          fallback={
            <Text type="meta" tone="muted">
              {props.failed
                ? "Season facts did not load. Runs and controls still work."
                : (props.facts?.reason ?? "Season facts were not published for this team.")}
            </Text>
          }
          when={props.loading}
        >
          <CardSeasonFactsSkeleton format={props.format} />
        </Show>
      }
      when={data()}
    >
      {(facts) => <CardSeasonFacts data={facts()} />}
    </Show>
  );
}

function CardSeasonFactsSkeleton(props: {
  readonly format: TeamScoringFormat | undefined;
}): JSX.Element {
  const points = (): boolean =>
    props.format === "head_to_head_points" ||
    props.format === "points" ||
    props.format === "rotisserie";
  const period = (): boolean => props.format !== "rotisserie";
  const matchup = (): boolean =>
    props.format === "head_to_head_categories" ||
    props.format === "head_to_head_points" ||
    props.format === "points";
  return (
    <Stack gap="sm">
      <Stack gap="2xs">
        <TextSkeleton type="meta" width="w-12" />
        <TextSkeleton type="body-strong" width="w-24" />
        <Show when={period()}>
          <TextSkeleton type="meta" width="w-40" />
          <TextSkeleton type="meta" width="w-32" />
        </Show>
        <Show when={points()}>
          <TextSkeleton type="meta" width="w-36" />
        </Show>
      </Stack>
      <Show when={matchup()}>
        <CardNote>
          <Stack gap="2xs">
            <TextSkeleton type="meta" width="w-28" />
            <TextSkeleton type="body-strong" width="w-16" />
            <Show when={props.format === "head_to_head_points" || props.format === "points"}>
              <TextSkeleton type="meta" width="w-32" />
            </Show>
            <Stack gap="none">
              <TextSkeleton type="meta" width="w-48" />
              <TextSkeleton type="meta" width="w-40" />
            </Stack>
          </Stack>
        </CardNote>
      </Show>
    </Stack>
  );
}

function CardSeasonFacts(props: { readonly data: SeasonFactsData }): JSX.Element {
  const season = (): SeasonFactsView => seasonFacts(props.data);
  const matchup = (): MatchupFactsView | undefined => matchupFacts(props.data);
  return (
    <Stack gap="sm">
      <Stack gap="2xs">
        <Text type="meta" tone="muted">
          Season
        </Text>
        <Show when={season().place ?? season().record}>
          <Inline gap="sm" align="baseline">
            <Show when={season().place}>
              {(value) => <Text type="body-strong">{value()}</Text>}
            </Show>
            <Show when={season().record}>{(value) => <Text type="meta">{value()}</Text>}</Show>
          </Inline>
        </Show>
        <Show when={season().period}>
          {(value) => (
            <>
              <Text type="meta">{value().headline}</Text>
              <Show when={value().details.length > 0}>
                <Text type="meta" tone="muted">
                  {EffectArray.join(value().details, " · ")}
                </Text>
              </Show>
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
      <Show when={matchup()}>
        {(facts) => (
          <CardNote>
            <Stack gap="2xs">
              <Text type="meta" tone="muted">
                Current matchup
              </Text>
              <Show when={facts().lead}>{(lead) => <MatchupLeadLine lead={lead()} />}</Show>
              <Show when={facts().projected}>
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
              <Text reserve="two-lines" type="meta" tone="muted">
                {matchupLine(facts())}
              </Text>
            </Stack>
          </CardNote>
        )}
      </Show>
    </Stack>
  );
}
