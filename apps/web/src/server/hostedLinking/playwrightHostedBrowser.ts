import { createHostedBrowser } from "@lineupkeep/hosted-browser/browser";
import { DateTime, Redacted } from "effect";

import type { HostedBrowserMessage } from "#contracts/connections/hostedBrowserProtocol.ts";

import type {
  HostedBrowserCallbacks,
  HostedBrowserFactory,
  HostedBrowserSession,
} from "./HostedBrowser.ts";

export function createPlaywrightHostedBrowser(
  options: { readonly profileRoot?: string } = {},
): HostedBrowserFactory {
  const browser = createHostedBrowser(options);
  return {
    open: async (session, callbacks) => {
      const handle = await browser.open(
        {
          id: session.id,
          expiresAt: DateTime.toEpochMillis(session.expiresAt),
          loginUrl: session.loginUrl.href,
          allowedOrigins: session.allowedOrigins,
        },
        {
          onFrame: callbacks.onFrame,
          onStatus: (status) => callbacks.onMessage({ _tag: "Status", status }),
          onCaptured: (cookieHeader) => {
            void completeSession(session, callbacks, cookieHeader);
          },
          onFailure: (reason) => {
            callbacks.onMessage({ _tag: "Failed", reason });
            void callbacks.fault(reason);
          },
          onExpired: () => {
            callbacks.onMessage({ _tag: "Expired" });
            void callbacks.expire();
          },
        },
      );
      return { input: handle.input, close: handle.close };
    },
    closeAll: browser.closeAll,
  };
}

async function completeSession(
  session: HostedBrowserSession,
  callbacks: HostedBrowserCallbacks,
  cookieHeader: string,
): Promise<void> {
  const completion = await callbacks.complete(Redacted.make(cookieHeader));
  const message: HostedBrowserMessage =
    completion.status === "ready"
      ? {
          _tag: "Ready",
          connectionId: session.connectionId,
          teamsDiscovered: completion.teamsDiscovered,
        }
      : { _tag: "Failed", reason: completion.reason };
  callbacks.onMessage(message);
}

export const playwrightHostedBrowser: HostedBrowserFactory = createPlaywrightHostedBrowser();
