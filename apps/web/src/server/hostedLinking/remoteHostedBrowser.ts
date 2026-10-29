import { signHostedBrowserDescriptor } from "@lineupkeep/hosted-browser/descriptor";
import {
  encodeHostedBrowserInput,
  parseTransportMessage,
} from "@lineupkeep/hosted-browser/protocol";
import { DateTime, Redacted } from "effect";
import { WebSocket } from "ws";
import type { RawData } from "ws";

import type {
  HostedBrowserCallbacks,
  HostedBrowserFactory,
  HostedBrowserHandle,
} from "./HostedBrowser.ts";

const handshakeTimeoutMillis = 10_000;
const closeTimeoutMillis = 5_000;

export type RemoteHostedBrowserOptions = {
  readonly url: string;
  readonly descriptorKey: string;
  readonly identityToken: (audience: string) => Promise<string>;
};

export function createRemoteHostedBrowser(
  options: RemoteHostedBrowserOptions,
): HostedBrowserFactory {
  const live = new Set<WebSocket>();
  const audience = options.url.replace(/\/+$/u, "");
  const streamUrl = `${audience.replace(/^http/u, "ws")}/session`;

  return {
    open: async (session, callbacks) => {
      const token = await options.identityToken(audience);
      const descriptor = signHostedBrowserDescriptor(options.descriptorKey, {
        sessionId: session.id,
        expiresAt: DateTime.toEpochMillis(session.expiresAt),
        loginUrl: session.loginUrl.href,
        viewport: session.viewport,
      });
      const socket = new WebSocket(streamUrl, {
        headers: { authorization: `Bearer ${token}` },
        handshakeTimeout: handshakeTimeoutMillis,
        maxPayload: 4_000_000,
      });
      live.add(socket);
      try {
        await opened(socket);
      } catch (error) {
        live.delete(socket);
        socket.terminate();
        throw error;
      }
      socket.send(descriptor);
      return streamHandle(socket, callbacks, () => live.delete(socket));
    },
    closeAll: async () => {
      await Promise.all([...live].map((socket) => closeSocket(socket)));
      live.clear();
    },
  };
}

function streamHandle(
  socket: WebSocket,
  callbacks: HostedBrowserCallbacks,
  forget: () => void,
): HostedBrowserHandle {
  let terminal = false;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    forget();
    await closeSocket(socket);
  };

  const reportUnavailable = (): void => {
    if (terminal) {
      return;
    }
    terminal = true;
    callbacks.onMessage({ _tag: "Failed", reason: "browser_unavailable" });
    void callbacks.fault("browser_unavailable").catch(() => undefined);
  };

  socket.on("message", (data: RawData, isBinary: boolean) => {
    if (closed) {
      return;
    }
    if (isBinary) {
      const frame = rawDataBytes(data);
      if (frame !== undefined) {
        callbacks.onFrame(frame);
      }
      return;
    }
    const message = parseTransportMessage(rawDataText(data) ?? "");
    if (message === undefined) {
      return;
    }
    switch (message._tag) {
      case "Status":
        callbacks.onMessage({ _tag: "Status", status: message.status });
        return;
      case "Refused":
        callbacks.onMessage({
          _tag: "Refused",
          host: message.host,
          reason: message.reason,
        });
        return;
      case "Captured":
        terminal = true;
        void completeSession(callbacks, message.session)
          .catch(() => undefined)
          .finally(() => {
            void close();
          });
        return;
      case "Failed":
        terminal = true;
        callbacks.onMessage({ _tag: "Failed", reason: message.reason });
        void callbacks
          .fault(message.reason)
          .catch(() => undefined)
          .finally(() => {
            void close();
          });
        return;
      case "Expired":
        terminal = true;
        callbacks.onMessage({ _tag: "Expired" });
        void callbacks
          .expire()
          .catch(() => undefined)
          .finally(() => {
            void close();
          });
        return;
    }
  });

  socket.on("error", () => {
    reportUnavailable();
  });
  socket.on("close", () => {
    forget();
    if (!closed) {
      closed = true;
      reportUnavailable();
    }
  });

  return {
    input: (input) => {
      if (!closed && socket.readyState === WebSocket.OPEN) {
        socket.send(encodeHostedBrowserInput(input));
      }
    },
    close: async () => {
      terminal = true;
      await close();
    },
  };
}

async function completeSession(
  callbacks: HostedBrowserCallbacks,
  cookieHeader: string,
): Promise<void> {
  const completion = await callbacks.complete(Redacted.make(cookieHeader));
  callbacks.onMessage(
    completion.status === "ready"
      ? {
          _tag: "Ready",
          connectionId: completion.connectionId,
          teamsDiscovered: completion.teamsDiscovered,
        }
      : { _tag: "Failed", reason: completion.reason },
  );
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", () => reject(new Error("The hosted browser stream could not open")));
    socket.once("unexpected-response", (_request, response) => {
      reject(new Error(`The hosted browser refused the stream (${response.statusCode})`));
    });
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      socket.terminate();
      resolve();
    }, closeTimeoutMillis);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.close(1000, "Closing the hosted browser");
  });
}

function rawDataText(data: RawData): string | undefined {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return undefined;
}

function rawDataBytes(data: RawData): Uint8Array | undefined {
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return undefined;
}
