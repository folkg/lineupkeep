import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { SummaryLoadingRows } from "#browser/shared-ui/Skeleton.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamCardView } from "#contracts/connections/teamContract.ts";

import { SeasonSummary } from "./SeasonSummary";
import type { SeasonSummaryData } from "./SeasonSummary";

export function TeamSeasonFacts(props: {
  readonly facts: TeamCardView | undefined;
  readonly failed: boolean;
  readonly loading: boolean;
}): JSX.Element {
  const showSkeleton = (): boolean =>
    props.loading && !props.failed && props.facts?.reason === undefined;
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
      caps: {
        ...(season.maxGamesPlayed === undefined ? {} : { gamesPlayed: season.maxGamesPlayed }),
        ...(season.maxInningsPitched === undefined
          ? {}
          : { inningsPitched: season.maxInningsPitched }),
      },
    };
  };
  return (
    <Show
      fallback={
        <Stack gap="sm">
          <Show
            when={
              props.failed ||
              props.facts?.reason !== undefined ||
              props.facts?.season === undefined ||
              props.loading
            }
          >
            <Text type="meta" tone="muted">
              {props.failed
                ? "Season facts could not be loaded. Lineup checks and controls are still available."
                : (props.facts?.reason ??
                  (props.loading
                    ? "Loading season facts."
                    : "Season facts were not published for this team."))}
            </Text>
          </Show>
          <Show when={showSkeleton()}>
            <SummaryLoadingRows count={1} />
          </Show>
        </Stack>
      }
      when={data()}
    >
      {(facts) => <SeasonSummary data={facts()} detail={false} />}
    </Show>
  );
}
