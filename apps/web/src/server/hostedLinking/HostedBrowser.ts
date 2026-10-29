import type { UserId } from "@lineupkeep/backend/auth/User";
import type { ConnectionId } from "@lineupkeep/backend/connections/Connection";
import type { HostedLinkingSessionId } from "@lineupkeep/backend/connections/HostedLinking";
import type { DateTime, Redacted } from "effect";

import type {
  HostedBrowserFailure,
  HostedBrowserInput,
  HostedBrowserMessage,
} from "#contracts/connections/hostedBrowserProtocol.ts";

export type HostedBrowserSession = {
  readonly id: HostedLinkingSessionId;
  readonly userId: UserId;
  readonly expiresAt: DateTime.Utc;
  readonly loginUrl: URL;
  readonly fixtureOrigin?: string;
};

export type HostedBrowserCompletion =
  | {
      readonly status: "ready";
      readonly connectionId: ConnectionId;
      readonly teamsDiscovered: number;
    }
  | { readonly status: "failed"; readonly reason: HostedBrowserFailure };

export type HostedBrowserCallbacks = {
  readonly onFrame: (frame: Uint8Array) => void;
  readonly onMessage: (message: HostedBrowserMessage) => void;
  readonly complete: (session: Redacted.Redacted<string>) => Promise<HostedBrowserCompletion>;
  readonly fault: (reason: HostedBrowserFailure) => Promise<void>;
  readonly expire: () => Promise<void>;
};

export type HostedBrowserHandle = {
  readonly input: (input: HostedBrowserInput) => void;
  readonly close: () => Promise<void>;
};

export type HostedBrowserFactory = {
  readonly open: (
    session: HostedBrowserSession,
    callbacks: HostedBrowserCallbacks,
  ) => Promise<HostedBrowserHandle>;

  readonly closeAll: () => Promise<void>;
};
