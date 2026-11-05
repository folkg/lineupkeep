import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { RuleList } from "#browser/shared-ui/RuleList.tsx";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";

import { ConnectionCard } from "./ConnectionCard";

export function ConnectionList(props: ConnectionListProps): JSX.Element {
  return (
    <Show
      fallback={<LoadingState label="Loading connections">Loading your connections…</LoadingState>}
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
              Connect an account above to see the teams this account can manage.
            </EmptyState>
          }
          when={props.connections().length > 0}
        >
          <RuleList>
            <For each={props.connections()}>
              {(connection) => (
                <ConnectionCard
                  connection={connection}
                  disconnecting={props.disconnectingId() === connection.id}
                  reconnecting={props.reconnectingId() === connection.id}
                  onDisconnect={() => props.onDisconnect(connection)}
                  onReconnect={() => props.onReconnect(connection)}
                />
              )}
            </For>
          </RuleList>
        </Show>
      </Show>
    </Show>
  );
}

type ConnectionListProps = {
  readonly connections: Accessor<ReadonlyArray<ConnectionView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly disconnectingId: Accessor<string | undefined>;
  readonly reconnectingId: Accessor<string | undefined>;
  readonly onDisconnect: (connection: ConnectionView) => void;
  readonly onReconnect: (connection: ConnectionView) => void;
  readonly onRefresh: () => Promise<void>;
};
