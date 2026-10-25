import type {
  CompleteLinkingData,
  ConnectionChangeView,
  ConnectionIdData,
  ConnectionView,
  ReconnectData,
  StartLinkingData,
  StartReconnectData,
} from "#contracts/connections/connectionContract.ts";
import {
  approveLinkingServerFn,
  cancelLinkingServerFn,
  completeLinkingServerFn,
  disconnectServerFn,
  listConnectionsServerFn,
  reconnectServerFn,
  startLinkingServerFn,
  startReconnectServerFn,
} from "#server-functions/connections/connectionServerFunctions.ts";

import { requireConnectionSuccess } from "./connectionFailure";

export const connectionRemote: ConnectionRemote = {
  list: (options) =>
    listConnectionsServerFn({ signal: options.signal }).then(requireConnectionSuccess),
  start: (input) => startLinkingServerFn({ data: input }).then(requireConnectionSuccess),
  startReconnect: (input) => startReconnectServerFn({ data: input }).then(requireConnectionSuccess),
  approve: (input) => approveLinkingServerFn({ data: input }).then(requireConnectionSuccess),
  cancel: (input) => cancelLinkingServerFn({ data: input }).then(requireConnectionSuccess),
  disconnect: (input) => disconnectServerFn({ data: input }).then(requireConnectionSuccess),
  complete: (input) => completeLinkingServerFn({ data: input }).then(requireConnectionSuccess),
  reconnect: (input) => reconnectServerFn({ data: input }).then(requireConnectionSuccess),
};

export type ConnectionRemote = {
  readonly list: (options: ConnectionListRequestOptions) => Promise<ReadonlyArray<ConnectionView>>;
  readonly start: (input: StartLinkingData) => Promise<ConnectionChangeView>;
  readonly startReconnect: (input: StartReconnectData) => Promise<ConnectionChangeView>;
  readonly approve: (input: ConnectionIdData) => Promise<ConnectionChangeView>;
  readonly cancel: (input: ConnectionIdData) => Promise<ConnectionChangeView>;
  readonly disconnect: (input: ConnectionIdData) => Promise<ConnectionChangeView>;
  readonly complete: (input: CompleteLinkingData) => Promise<ConnectionChangeView>;
  readonly reconnect: (input: ReconnectData) => Promise<ConnectionChangeView>;
};

type ConnectionListRequestOptions = {
  readonly signal: AbortSignal;
};
