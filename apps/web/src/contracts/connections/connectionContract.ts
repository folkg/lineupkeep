import type {
  CompleteLinkingInput,
  ConnectionError,
  ConnectionIdInput,
  ConnectionStatus,
  Provider,
  ReconnectInput,
  StartLinkingInput,
  StartReconnectInput,
} from "@lineupkeep/backend/connections/Connection";

import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";
import type { UseCaseResult } from "#contracts/useCaseContract.ts";

export type ConnectionView = {
  readonly id: string;
  readonly provider: Provider;
  readonly status: ConnectionStatus;
  readonly pairingCode?: string;
  readonly linkingExpiresAt?: string;
  readonly approvedAt?: string;
  readonly credentialGeneration?: number;
  readonly reconnectRequiredAt?: string;
  readonly disconnectedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ConnectionChangeView = {
  readonly connection: ConnectionView;
  readonly connections: ReadonlyArray<ConnectionView>;
};

export type StartLinkingData = typeof StartLinkingInput.Encoded;
export type StartReconnectData = typeof StartReconnectInput.Encoded;
export type ConnectionIdData = typeof ConnectionIdInput.Encoded;
export type CompleteLinkingData = typeof CompleteLinkingInput.Encoded;
export type ReconnectData = typeof ReconnectInput.Encoded;
export type ConnectionMutationError = {
  readonly type:
    | ConnectionError["_tag"]
    | "connection.device_rejected"
    | "connection.input_invalid";
};
export type ConnectionRequestResult<A> =
  | UseCaseResult<A, ConnectionMutationError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
