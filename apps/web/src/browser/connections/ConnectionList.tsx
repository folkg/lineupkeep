import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";

import { ConnectionCard } from "./ConnectionCard";

export function ConnectionList(props: ConnectionListProps): JSX.Element {
  return (
    <Stack as="section" gap="md" labelledBy="connections-list-title">
      <Heading id="connections-list-title" level={2} size="section">
        Your connections
      </Heading>
      <Show
        fallback={
          <LoadingState label="Loading connections">Loading your connections…</LoadingState>
        }
        when={!props.isLoading()}
      >
        <Show
          fallback={
            <ActionFeedback
              feedback={{
                type: "attention",
                message: "We could not load your connections.",
                recovery: {
                  label: "Refresh",
                  pendingLabel: "Refreshing…",
                  onAction: props.onRefresh,
                },
              }}
            />
          }
          when={props.loadFailure() === null}
        >
          <Show
            fallback={
              <EmptyState title="No connections yet.">
                Link Yahoo to let the local helper sign in on your computer.
              </EmptyState>
            }
            when={props.connections().length > 0}
          >
            <Stack gap="md">
              <For each={props.connections()}>
                {(connection) => (
                  <ConnectionCard
                    approving={props.approvingId() === connection.id}
                    canceling={props.cancelingId() === connection.id}
                    connection={connection}
                    onApprove={() => props.onApprove(connection)}
                    onCancel={() => props.onCancel(connection)}
                  />
                )}
              </For>
            </Stack>
          </Show>
        </Show>
      </Show>
    </Stack>
  );
}

type ConnectionListProps = {
  readonly connections: Accessor<ReadonlyArray<ConnectionView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly approvingId: Accessor<string | undefined>;
  readonly cancelingId: Accessor<string | undefined>;
  readonly onApprove: (connection: ConnectionView) => void;
  readonly onCancel: (connection: ConnectionView) => void;
  readonly onRefresh: () => Promise<void>;
};
