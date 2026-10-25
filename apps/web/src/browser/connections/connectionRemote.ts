import type {
  ConnectionChangeView,
  ConnectionIdData,
  ConnectionView,
  StartLinkingData,
} from "#contracts/connections/connectionContract.ts";
import {
  approveLinkingServerFn,
  cancelLinkingServerFn,
  listConnectionsServerFn,
  startLinkingServerFn,
} from "#server-functions/connections/connectionServerFunctions.ts";

import { requireConnectionSuccess } from "./connectionFailure";

export const connectionRemote: ConnectionRemote = {
  list: (options) =>
    listConnectionsServerFn({ signal: options.signal }).then(requireConnectionSuccess),
  start: (input) => startLinkingServerFn({ data: input }).then(requireConnectionSuccess),
  approve: (input) => approveLinkingServerFn({ data: input }).then(requireConnectionSuccess),
  cancel: (input) => cancelLinkingServerFn({ data: input }).then(requireConnectionSuccess),
};

export type ConnectionRemote = {
  readonly list: (options: ConnectionListRequestOptions) => Promise<ReadonlyArray<ConnectionView>>;
  readonly start: (input: StartLinkingData) => Promise<ConnectionChangeView>;
  readonly approve: (input: ConnectionIdData) => Promise<ConnectionChangeView>;
  readonly cancel: (input: ConnectionIdData) => Promise<ConnectionChangeView>;
};

type ConnectionListRequestOptions = {
  readonly signal: AbortSignal;
};
