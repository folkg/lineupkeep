import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type {
  ReserveEligibilityView,
  ReserveListView,
  RosterPlacesView,
  TransactionTeamFactsView,
} from "#contracts/connections/transactionContract.ts";

export function TeamPlaces(props: TeamPlacesProps): JSX.Element {
  return (
    <Show when={props.facts}>
      {(facts) => (
        <Stack gap="2xs">
          <Text size="caption" tone="muted">
            {placesCopy(facts().places)}
          </Text>
          <For each={facts().reserve}>
            {(list) => (
              <Text size="caption" tone="muted">
                {reserveCopy(list)}
              </Text>
            )}
          </For>
        </Stack>
      )}
    </Show>
  );
}

function placesCopy(places: RosterPlacesView): string {
  return `Places: ${String(places.used)} of ${String(places.maximum)} used, ${String(places.free)} free.`;
}

function reserveCopy(list: ReserveListView): string {
  return `${list.name}: ${String(list.occupied)} of ${String(list.capacity)} used, ${String(list.free)} free, ${eligibilityCopy(list.eligibility)}.`;
}

function eligibilityCopy(eligibility: ReserveEligibilityView): string {
  switch (eligibility.kind) {
    case "published_positions":
      return eligibility.positions.length === 0
        ? "accepts any player"
        : `accepts ${eligibility.positions.join(", ")}`;
    case "injury_status":
      return "accepts an injured player";
    case "not_published":
      return "the league does not publish who it accepts";
  }
}

type TeamPlacesProps = {
  readonly facts: TransactionTeamFactsView | undefined;
};
