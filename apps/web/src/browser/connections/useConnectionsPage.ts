import { useMutation, useQuery } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  ConnectionChangeView,
  ConnectionView,
} from "#contracts/connections/connectionContract.ts";
import { defaultProviderKey, defaultProviderName } from "#contracts/connections/providerLabels.ts";

import { describeConnectionFailure } from "./connectionFailure";
import { connectionMutations, storeRefreshedConnections } from "./connectionMutations";
import type { ConnectionListQueryOptions } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";

export function useConnectionsPage(props: ConnectionsPageOptions): ConnectionsPageController {
  const connections = useQuery(() => props.connectionsQuery());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [pairingCode, setPairingCode] = createSignal("");
  const [approvingId, setApprovingId] = createSignal<string>();
  const [cancelingId, setCancelingId] = createSignal<string>();
  const [disconnectingId, setDisconnectingId] = createSignal<string>();
  const [reconnectingId, setReconnectingId] = createSignal<string>();
  const [reconnectCodes, setReconnectCodes] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [helperOpen, setHelperOpen] = createSignal(false);
  let pendingRequestId: string | undefined;
  const reconnectRequestIds = new Map<string, string>();

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
      setPairingCode("");
      setFeedback({
        type: "success",
        message: "Pairing started. The request is waiting for your approval.",
      });
    },
    onError: reportFailure,
  }));
  const approve = useMutation(() => ({
    ...connectionMutations.approve(props.remote()),
    onSuccess: (change: ConnectionChangeView, variables, onMutateResult, context) => {
      storeRefreshedConnections(change, variables, onMutateResult, context);
      setFeedback({
        type: "success",
        message: "Helper approved. Lineupkeep is uploading the session.",
      });
    },
    onError: reportFailure,
    onSettled: () => setApprovingId(undefined),
  }));
  const startReconnect = useMutation(() => ({
    ...connectionMutations.startReconnect(props.remote()),
    onSuccess: (change: ConnectionChangeView, variables, onMutateResult, context) => {
      storeRefreshedConnections(change, variables, onMutateResult, context);
      setFeedback({
        type: "success",
        message: `Reconnect started. Finish the ${defaultProviderName()} sign-in in the helper, then refresh this page.`,
        recovery: {
          label: "Refresh status",
          pendingLabel: "Refreshing…",
          onAction: () => props.onRefresh(),
        },
      });
    },
    onError: reportFailure,
    onSettled: () => setReconnectingId(undefined),
  }));
  const disconnect = useMutation(() => ({
    ...connectionMutations.disconnect(props.remote()),
    onSuccess: (change: ConnectionChangeView, variables, onMutateResult, context) => {
      storeRefreshedConnections(change, variables, onMutateResult, context);
      setFeedback({ type: "success", message: "Disconnected. You can connect again at any time." });
    },
    onError: reportFailure,
    onSettled: () => setDisconnectingId(undefined),
  }));
  const cancel = useMutation(() => ({
    ...connectionMutations.cancel(props.remote()),
    onSuccess: (change: ConnectionChangeView, variables, onMutateResult, context) => {
      storeRefreshedConnections(change, variables, onMutateResult, context);
      setFeedback({
        type: "success",
        message: "Pairing cancelled. The helper cannot finish this request.",
      });
    },
    onError: reportFailure,
    onSettled: () => setCancelingId(undefined),
  }));

  return {
    connections: () => connections.data,
    isLoading: () => connections.isPending,
    loadFailure: () => connections.error,
    feedback,
    helperOpen,
    toggleHelper: () => setHelperOpen((open) => !open),
    pairingCode,
    isStarting: () => start.isPending,
    approvingId,
    cancelingId,
    disconnectingId,
    reconnectingId,
    refresh: () => props.onRefresh(),
    changePairingCode: (value: string) => setPairingCode(value),
    startLinking: () => {
      const code = pairingCode().trim();
      if (code.length === 0) {
        setFeedback({
          type: "attention",
          message: "Enter the pairing code shown by the local helper.",
        });
        return;
      }
      pendingRequestId ??= crypto.randomUUID();
      setFeedback({ type: "pending", message: "Starting helper pairing…" });
      void start.mutate({
        requestId: pendingRequestId,
        provider: defaultProviderKey,
        pairingCode: code,
      });
    },
    approveLinking: (connection: ConnectionView) => {
      setApprovingId(connection.id);
      setFeedback({ type: "pending", message: "Approving helper…" });
      void approve.mutate({ id: connection.id });
    },
    cancelLinking: (connection: ConnectionView) => {
      setCancelingId(connection.id);
      setFeedback({ type: "pending", message: "Cancelling pairing…" });
      void cancel.mutate({ id: connection.id });
    },
    reconnectCode: (connectionId) => reconnectCodes().get(connectionId) ?? "",
    changeReconnectCode: (connectionId, value) => {
      setReconnectCodes((current) => new Map(current).set(connectionId, value));
    },
    reconnectLinking: (connection: ConnectionView) => {
      const code = (reconnectCodes().get(connection.id) ?? "").trim();
      if (code.length === 0) {
        setFeedback({
          type: "attention",
          message: "Enter the pairing code shown by the local helper.",
        });
        return;
      }
      const requestId = reconnectRequestIds.get(connection.id) ?? crypto.randomUUID();
      reconnectRequestIds.set(connection.id, requestId);
      setReconnectingId(connection.id);
      setFeedback({ type: "pending", message: "Starting reconnect…" });
      void startReconnect.mutate({ requestId, id: connection.id, pairingCode: code });
      setReconnectCodes((current) => {
        const next = new Map(current);
        next.delete(connection.id);
        return next;
      });
    },
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
  readonly helperOpen: Accessor<boolean>;
  readonly toggleHelper: () => void;
  readonly pairingCode: Accessor<string>;
  readonly isStarting: Accessor<boolean>;
  readonly approvingId: Accessor<string | undefined>;
  readonly cancelingId: Accessor<string | undefined>;
  readonly disconnectingId: Accessor<string | undefined>;
  readonly reconnectingId: Accessor<string | undefined>;
  readonly refresh: () => Promise<void>;
  readonly changePairingCode: (value: string) => void;
  readonly startLinking: () => void;
  readonly approveLinking: (connection: ConnectionView) => void;
  readonly cancelLinking: (connection: ConnectionView) => void;
  readonly reconnectCode: (connectionId: string) => string;
  readonly changeReconnectCode: (connectionId: string, value: string) => void;
  readonly reconnectLinking: (connection: ConnectionView) => void;
  readonly disconnectLinking: (connection: ConnectionView) => void;
};

type ConnectionsPageOptions = {
  readonly connectionsQuery: Accessor<ConnectionListQueryOptions>;
  readonly remote: Accessor<ConnectionRemote>;
  readonly onRefresh: () => Promise<void>;
};
