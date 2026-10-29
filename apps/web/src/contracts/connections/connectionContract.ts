import type {
  ConnectionError,
  ConnectionIdInput,
  ConnectionStatus,
} from "@lineupkeep/backend/connections/Connection";

import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";
import type { HostedBrowserViewportProfile } from "#contracts/connections/hostedBrowserProtocol.ts";
import type { UseCaseResult } from "#contracts/useCaseContract.ts";

export type ConnectionView = {
  readonly id: string;
  readonly provider: string;
  readonly status: ConnectionStatus;
  readonly teamCount: number;
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

export type ConnectionIdData = typeof ConnectionIdInput.Encoded;
export type ConnectionMutationError = {
  readonly type:
    | ConnectionError["_tag"]
    | "connection.input_invalid"
    | HostedLinkingMutationError["type"];
};
export type ConnectionRequestResult<A> =
  | UseCaseResult<A, ConnectionMutationError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };

export type HostedLinkingSessionView = {
  readonly id: string;
  readonly connectionId?: string;
  readonly provider: string;
  readonly status: "active" | "completing" | "completed" | "cancelled" | "expired" | "failed";
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
  readonly expiredAt?: string;
  readonly failedAt?: string;
  readonly failureReason?: string;
};

export type StartHostedLinkingData = {
  readonly provider: string;
  readonly connectionId?: string;
  readonly viewport: HostedBrowserViewportProfile;
};

export type StartHostedLinkingView = {
  readonly session: HostedLinkingSessionView;
  readonly streamPath: string;
  readonly viewport: HostedBrowserViewportProfile;
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
