import type { JSX } from "@solidjs/web";
import { Errored, For, Loading, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamReserveSlotAttentionView } from "#contracts/connections/teamContract.ts";

export function TeamRosterAttention(props: TeamRosterAttentionProps): JSX.Element {
  return (
    <Errored
      fallback={() => (
        <Text size="caption" tone="faint">
          The roster could not be checked just now.
        </Text>
      )}
    >
      <Loading
        fallback={
          <Text size="caption" tone="faint">
            Checking the roster…
          </Text>
        }
      >
        <Show when={props.attention().length > 0}>
          <Stack gap="xs">
            <For each={props.attention()}>
              {(item) => <Text size="caption">{item.detail}</Text>}
            </For>
          </Stack>
        </Show>
      </Loading>
    </Errored>
  );
}

type TeamRosterAttentionProps = {
  readonly attention: Accessor<ReadonlyArray<TeamReserveSlotAttentionView>>;
};
