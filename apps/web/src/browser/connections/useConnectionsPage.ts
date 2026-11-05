import { useMutation, useQuery } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import { departureDurationMs } from "#browser/shared-ui/actionState.ts";
import { scheduleDelay } from "#browser/timing/delay.ts";
import type {
  ConnectionChangeView,
  ConnectionView,
} from "#contracts/connections/connectionContract.ts";

import { describeConnectionFailure } from "./connectionFailure";
import { connectionMutations, storeRefreshedConnections } from "./connectionMutations";
import type { ConnectionListQueryOptions } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";

export function useConnectionsPage(props: ConnectionsOptions): ConnectionsController {
  const connections = useQuery(() => props.connectionsQuery());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [departingId, setDepartingId] = createSignal<string>();

  const reportFailure = (error: unknown): void => {
    const failure = describeConnectionFailure(error);
    setFeedback({
      type: "attention",
      message: failure.message,
      ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
    });
  };

  const disconnect = useMutation(() => ({
    ...connectionMutations.disconnect(props.remote()),
    onSuccess: (change: ConnectionChangeView, variables, onMutateResult, context) => {
      setDepartingId(variables.id);
      scheduleDelay(() => {
        storeRefreshedConnections(change, variables, onMutateResult, context);
        setDepartingId(undefined);
      }, departureDurationMs);
      setFeedback({ type: "success", message: "Disconnected. You can connect again at any time." });
    },
    onError: reportFailure,
  }));

  return {
    connections: () =>
      connections.data.filter((connection) => connection.status !== "disconnected"),
    isLoading: () => connections.isPending,
    loadFailure: () => connections.error,
    feedback,
    departingId,
    disconnectingId: () => (disconnect.isPending ? disconnect.variables?.id : undefined),
    refresh: () => props.onRefresh(),
    disconnectLinking: (connection: ConnectionView) => {
      setFeedback(undefined);
      void disconnect.mutate({ id: connection.id });
    },
  };
}

export type ConnectionsController = {
  readonly connections: Accessor<ReadonlyArray<ConnectionView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly departingId: Accessor<string | undefined>;
  readonly disconnectingId: Accessor<string | undefined>;
  readonly refresh: () => Promise<void>;
  readonly disconnectLinking: (connection: ConnectionView) => void;
};

type ConnectionsOptions = {
  readonly connectionsQuery: () => ConnectionListQueryOptions;
  readonly remote: () => ConnectionRemote;
  readonly onRefresh: () => Promise<void>;
};
