import type {
  CompleteLinkingInput,
  ConnectionError,
  ConnectionIdInput,
  ConnectionStatus,
  ProviderKey,
  ReconnectInput,
  StartLinkingInput,
  StartReconnectInput,
} from "@lineupkeep/backend/connections/Connection";

import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";
import type { UseCaseResult } from "#contracts/useCaseContract.ts";

export type ConnectionView = {
  readonly id: string;
  readonly provider: ProviderKey;
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
    | "connection.input_invalid"
    | HostedLinkingMutationError["type"];
};
export type ConnectionRequestResult<A> =
  | UseCaseResult<A, ConnectionMutationError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };

export type HostedLinkingSessionView = {
  readonly id: string;
  readonly connectionId: string;
  readonly provider: ProviderKey;
  readonly status: "active" | "completing" | "completed" | "cancelled" | "expired" | "failed";
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
  readonly expiredAt?: string;
  readonly failedAt?: string;
  readonly failureReason?: string;
};

export type StartHostedLinkingView = {
  readonly session: HostedLinkingSessionView;
  readonly streamPath: string;
};

export type CancelHostedLinkingView = {
  readonly session: HostedLinkingSessionView;
};

export type HostedLinkingMutationError = {
  readonly type:
    | import("@lineupkeep/backend/connections/HostedLinking").HostedLinkingError["_tag"]
    | ConnectionError["_tag"]
    | "hosted_browser.unsupported"
    | "hosted_linking.input_invalid";
};
