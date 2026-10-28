import { AuthService } from "@lineupkeep/backend/auth/Auth";
import { UserId } from "@lineupkeep/backend/auth/User";
import {
  HostedLinking,
  HostedLinkingSessionId,
  HostedLinkingTicket,
} from "@lineupkeep/backend/connections/HostedLinking";
import { Config, Effect, Option, Schema } from "effect";
import type { WebSocketHooks } from "h3";

import {
  encodeHostedBrowserMessage,
  parseHostedBrowserInput,
} from "#contracts/connections/hostedBrowserProtocol.ts";
import type {
  HostedBrowserFailure,
  HostedBrowserInput,
  HostedBrowserMessage,
} from "#contracts/connections/hostedBrowserProtocol.ts";
import { deploymentTarget } from "#deployment-target";
import { runBackend } from "#server/backendEntry.ts";

import type {
  HostedBrowserCallbacks,
  HostedBrowserHandle,
  HostedBrowserSession,
} from "./HostedBrowser.ts";
import { providerLoginConfig } from "./providerLogin.ts";

const maximumPendingInputs = 64;
const maximumStreamMessages = 500;
const maximumStreamMessageBytes = 4_096;

export function hostedLinkingHooks(
  request: Request,
  sessionId: string,
): Promise<Partial<WebSocketHooks>> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Promise.resolve(rejectUpgrade(426, "WebSocket upgrade is required."));
  }
  const ticket = hostedLinkingTicket(request.headers.get("cookie"));
  if (ticket === undefined) {
    return Promise.resolve(rejectUpgrade(401, "Unauthorized"));
  }
  return authorizeStream(request, sessionId, ticket);
}

async function authorizeStream(
  request: Request,
  sessionId: string,
  ticket: string,
): Promise<Partial<WebSocketHooks>> {
  const authorized = await runBackend(
    request,
    "hosted_linking.stream",
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const session = yield* auth.getSession(request.headers);
      if (session === undefined) {
        return yield* Effect.fail("unauthorized");
      }
      const userId = yield* Schema.decodeEffect(UserId)(session.user.id);
      const hosted = yield* HostedLinking;
      const linking = yield* hosted.authorize(userId, {
        id: yield* Schema.decodeEffect(HostedLinkingSessionId)(sessionId),
        ticket,
      });
      const environment = yield* Config.Literals(
        ["development", "production", "test"],
        "APP_ENV",
      ).pipe(
        Config.orElse(() => Config.Literals(["development", "production", "test"], "NODE_ENV")),
        Config.withDefault("production"),
      );
      return { userId, linking, environment };
    }).pipe(Effect.option),
  );
  if (authorized._tag === "None") {
    return rejectUpgrade(401, "Unauthorized");
  }
  const { userId, linking, environment } = authorized.value;
  const factory = deploymentTarget.hostedBrowser;
  if (factory === undefined) {
    return rejectUpgrade(501, "Hosted browser linking is unavailable");
  }
  const providerLogin = providerLoginConfig(environment, request.url, linking.provider);
  const browserSession: HostedBrowserSession = {
    id: linking.id,
    userId,
    connectionId: linking.connectionId,
    expiresAt: linking.expiresAt,
    loginUrl: providerLogin.loginUrl,
    ...(providerLogin.fixtureOrigin === undefined
      ? {}
      : { fixtureOrigin: providerLogin.fixtureOrigin }),
  };

  let browser: HostedBrowserHandle | undefined;
  const pendingInputs: HostedBrowserInput[] = [];
  let peerForHooks: StreamPeer | undefined;
  let settled = false;
  let closed = false;
  let messageCount = 0;

  const send = (peer: StreamPeer, message: HostedBrowserMessage): void => {
    try {
      peer.send(encodeHostedBrowserMessage(message));
    } catch {
      closed = true;
    }
  };
  const sendInput = (input: HostedBrowserInput): void => {
    if (browser === undefined) {
      if (pendingInputs.length < maximumPendingInputs) {
        pendingInputs.push(input);
      }
      return;
    }
    browser.input(input);
  };
  const settle = (): void => {
    settled = true;
  };
  const closeBrowser = async (): Promise<void> => {
    await browser?.close().catch(() => undefined);
    browser = undefined;
  };
  const failStream = async (peer: StreamPeer, reason: HostedBrowserFailure): Promise<void> => {
    settle();
    send(peer, { _tag: "Failed", reason });
    await closeBrowser();
    await runBackend(
      request,
      "hosted_linking.fail",
      Effect.gen(function* () {
        const hosted = yield* HostedLinking;
        return yield* hosted.fail(userId, { id: linking.id }, providerFailureReason(reason));
      }).pipe(Effect.ignore),
    ).catch(() => undefined);
  };

  const callbacks: HostedBrowserCallbacks = {
    onFrame: (frame) => {
      if (!closed) {
        try {
          peerForHooks?.send(frame);
        } catch {
          closed = true;
        }
      }
    },
    onMessage: (message) => {
      if (closed) {
        return;
      }
      const peer = peerForHooks;
      if (peer === undefined) {
        return;
      }
      if (message._tag === "Ready" || message._tag === "Failed" || message._tag === "Expired") {
        settle();
      }
      send(peer, message);
    },
    complete: async (session) => {
      settle();
      const completed = await runBackend(
        request,
        "hosted_linking.complete",
        Effect.gen(function* () {
          const hosted = yield* HostedLinking;
          return yield* hosted.complete(userId, {
            id: linking.id,
            ticket,
            provider: linking.provider,
            session,
          });
        }).pipe(Effect.result),
      ).catch(() => undefined);
      if (completed === undefined || completed._tag === "Failure") {
        return {
          status: "failed",
          reason:
            completed === undefined ? "completion_failed" : completionFailure(completed.failure),
        };
      }
      return {
        status: "ready",
        teamsDiscovered: completed.success.teamsDiscovered,
      };
    },
    fault: async (reason) => {
      await runBackend(
        request,
        "hosted_linking.fail",
        Effect.gen(function* () {
          const hosted = yield* HostedLinking;
          return yield* hosted.fail(userId, { id: linking.id }, providerFailureReason(reason));
        }).pipe(Effect.ignore),
      ).catch(() => undefined);
    },
    expire: async () => {
      await runBackend(
        request,
        "hosted_linking.expire",
        Effect.gen(function* () {
          const hosted = yield* HostedLinking;
          return yield* hosted.expire(userId, [{ id: linking.id }]);
        }).pipe(Effect.ignore),
      ).catch(() => undefined);
    },
  };

  const hooks = {
    open: (peer: StreamPeer) => {
      peerForHooks = peer;
      void (async () => {
        try {
          const opened = await factory.open(browserSession, callbacks);
          if (closed) {
            await opened.close();
            return;
          }
          browser = opened;
          for (const input of pendingInputs) {
            browser.input(input);
          }
          pendingInputs.length = 0;
        } catch {
          await failStream(peer, "browser_unavailable");
        }
      })();
    },
    message: (peer: StreamPeer, message: StreamMessage) => {
      messageCount++;
      if (messageCount > maximumStreamMessages) {
        peer.close(1008, "Too many control messages");
        return;
      }
      const text = message.text();
      if (text.length > maximumStreamMessageBytes) {
        peer.close(1008, "Control message is too large");
        return;
      }
      const parsed = parseHostedBrowserInput(text);
      if (parsed !== undefined) {
        sendInput(parsed);
      }
    },
    close: () => {
      closed = true;
      const wasSettled = settled;
      settled = true;
      void closeBrowser().then(async () => {
        if (!wasSettled) {
          await runBackend(
            request,
            "hosted_linking.cancel",
            Effect.gen(function* () {
              const hosted = yield* HostedLinking;
              return yield* hosted.cancel(userId, [{ id: linking.id }]);
            }).pipe(Effect.ignore),
          ).catch(() => undefined);
        }
      });
    },
  };

  return hooks;
}

function hostedLinkingTicket(cookieHeader: string | null): string | undefined {
  if (cookieHeader === null) {
    return undefined;
  }
  for (const entry of cookieHeader.split(";")) {
    const [name, value] = entry.split("=");
    if (name?.trim() === "lineupkeep_hosted_link" && value !== undefined) {
      return Option.getOrUndefined(Schema.decodeOption(HostedLinkingTicket)(value.trim()));
    }
  }
  return undefined;
}

function rejectUpgrade(status: number, message: string): Partial<WebSocketHooks> {
  return {
    upgrade: () => {
      throw new Response(message, {
        status,
        headers: { "cache-control": "no-store" },
      });
    },
  };
}

function providerFailureReason(
  failure: HostedBrowserFailure,
): "session_rejected" | "provider_unavailable" | "link_expired" | "persistence_failed" {
  switch (failure) {
    case "session_rejected":
      return "session_rejected";
    case "provider_unavailable":
      return "provider_unavailable";
    case "expired":
      return "link_expired";
    case "browser_unavailable":
    case "page_unavailable":
    case "completion_failed":
      return "persistence_failed";
  }
}

function completionFailure(error: unknown): HostedBrowserFailure {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    switch (error._tag) {
      case "connection.provider_rejected":
      case "hosted_linking.not_active":
      case "hosted_linking.ticket_rejected":
      case "hosted_linking.not_found":
        return "session_rejected";
      case "connection.provider_unavailable":
        return "provider_unavailable";
      case "connection.link_expired":
      case "hosted_linking.expired":
        return "expired";
    }
  }
  return "completion_failed";
}

type StreamPeer = {
  readonly send: (data: string | Uint8Array) => void;
  readonly close: (code?: number, reason?: string) => void;
};

type StreamMessage = {
  readonly text: () => string;
};
