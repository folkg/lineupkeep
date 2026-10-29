import type { HostedLinkingSessionInput } from "@lineupkeep/backend/connections/HostedLinking";

import type {
  CancelHostedLinkingView,
  ConnectionChangeView,
  ConnectionIdData,
  ConnectionView,
  StartHostedLinkingView,
} from "#contracts/connections/connectionContract.ts";
import {
  disconnectServerFn,
  listConnectionsServerFn,
} from "#server-functions/connections/connectionServerFunctions.ts";
import {
  cancelHostedLinkingServerFn,
  startHostedLinkingServerFn,
} from "#server-functions/connections/hostedLinkingServerFunctions.ts";

import { requireConnectionSuccess } from "./connectionFailure";

export const connectionRemote: ConnectionRemote = {
  list: (options) =>
    listConnectionsServerFn({ signal: options.signal }).then(requireConnectionSuccess),
  disconnect: (input) => disconnectServerFn({ data: input }).then(requireConnectionSuccess),
  startHosted: (input) =>
    startHostedLinkingServerFn({ data: input }).then(requireConnectionSuccess),
  cancelHosted: (input) =>
    cancelHostedLinkingServerFn({ data: input }).then(requireConnectionSuccess),
};

export type ConnectionRemote = {
  readonly list: (options: ConnectionListRequestOptions) => Promise<ReadonlyArray<ConnectionView>>;
  readonly disconnect: (input: ConnectionIdData) => Promise<ConnectionChangeView>;
  readonly startHosted: (input: StartHostedLinkingData) => Promise<StartHostedLinkingView>;
  readonly cancelHosted: (
    input: typeof HostedLinkingSessionInput.Encoded,
  ) => Promise<CancelHostedLinkingView>;
};

type StartHostedLinkingData = {
  readonly provider: string;
  readonly connectionId?: string;
};

type ConnectionListRequestOptions = {
  readonly signal: AbortSignal;
};
