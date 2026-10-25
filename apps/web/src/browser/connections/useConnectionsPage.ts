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
  const [cancelingId, setCancelingId] = createSignal<string>();
  let pendingRequestId: string | undefined;

  const reportFailure = (error: unknown): void => {
    const failure = describeConnectionFailure(error);
    setFeedback({
      type: "attention",
      message: failure.message,
      ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
    });
  };

  const start = useMutation(() => ({
    ...connectionMutations.start(props.remote()),
    onSuccess: (change: ConnectionChangeView, variables, onMutateResult, context) => {
      storeRefreshedConnections(change, variables, onMutateResult, context);
      pendingRequestId = undefined;
      setFeedback({ type: "success", message: "Link started." });
    },
    onError: reportFailure,
  }));
  const cancel = useMutation(() => ({
    ...connectionMutations.cancel(props.remote()),
    onSuccess: (change: ConnectionChangeView, variables, onMutateResult, context) => {
      storeRefreshedConnections(change, variables, onMutateResult, context);
      setFeedback({ type: "success", message: "Link cancelled." });
    },
    onError: reportFailure,
    onSettled: () => setCancelingId(undefined),
  }));

  return {
    connections: () => connections.data,
    isLoading: () => connections.isPending,
    loadFailure: () => connections.error,
    feedback,
    isStarting: () => start.isPending,
    cancelingId,
    refresh: () => props.onRefresh(),
    startLinking: () => {
      pendingRequestId ??= crypto.randomUUID();
      setFeedback({ type: "pending", message: "Starting link…" });
      void start.mutate({ requestId: pendingRequestId, provider: "yahoo" });
    },
    cancelLinking: (connection: ConnectionView) => {
      setCancelingId(connection.id);
      setFeedback({ type: "pending", message: "Cancelling link…" });
      void cancel.mutate({ id: connection.id });
    },
  };
}

export type ConnectionsPageController = {
  readonly connections: Accessor<ReadonlyArray<ConnectionView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly isStarting: Accessor<boolean>;
  readonly cancelingId: Accessor<string | undefined>;
  readonly refresh: () => Promise<void>;
  readonly startLinking: () => void;
  readonly cancelLinking: (connection: ConnectionView) => void;
};

type ConnectionsPageOptions = {
  readonly connectionsQuery: Accessor<ConnectionListQueryOptions>;
  readonly remote: Accessor<ConnectionRemote>;
  readonly onRefresh: () => Promise<void>;
};
