import { useMutation, useQuery } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  ConnectionChangeView,
  ConnectionView,
} from "#contracts/connections/connectionContract.ts";

import { describeConnectionFailure } from "./connectionFailure";
import { connectionMutations, storeRefreshedConnections } from "./connectionMutations";
import type { ConnectionListQueryOptions } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";

export function useConnectionsPage(props: ConnectionsPageOptions): ConnectionsPageController {
  const connections = useQuery(() => props.connectionsQuery());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [disconnectingId, setDisconnectingId] = createSignal<string>();

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
      storeRefreshedConnections(change, variables, onMutateResult, context);
      setFeedback({ type: "success", message: "Disconnected. You can connect again at any time." });
    },
    onError: reportFailure,
    onSettled: () => setDisconnectingId(undefined),
  }));

  return {
    connections: () => connections.data,
    isLoading: () => connections.isPending,
    loadFailure: () => connections.error,
    feedback,
    disconnectingId,
    refresh: () => props.onRefresh(),
    disconnectLinking: (connection: ConnectionView) => {
      setDisconnectingId(connection.id);
      setFeedback({ type: "pending", message: "Disconnecting…" });
      void disconnect.mutate({ id: connection.id });
    },
  };
}

export type ConnectionsPageController = {
  readonly connections: Accessor<ReadonlyArray<ConnectionView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly disconnectingId: Accessor<string | undefined>;
  readonly refresh: () => Promise<void>;
  readonly disconnectLinking: (connection: ConnectionView) => void;
};

type ConnectionsPageOptions = {
  readonly connectionsQuery: Accessor<ConnectionListQueryOptions>;
  readonly remote: Accessor<ConnectionRemote>;
  readonly onRefresh: () => Promise<void>;
};
