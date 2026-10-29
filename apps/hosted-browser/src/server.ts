import { createServer } from "node:http";
import type { ServerResponse } from "node:http";

import { createHostedBrowser, type HostedBrowserHandle } from "@lineupkeep/hosted-browser/browser";
import {
  verifyHostedBrowserDescriptor,
  type HostedBrowserDescriptor,
} from "@lineupkeep/hosted-browser/descriptor";
import type { EgressRefusal } from "@lineupkeep/hosted-browser/egress";
import {
  encodeTransportMessage,
  parseHostedBrowserInput,
  type HostedBrowserFailure,
  type HostedBrowserInput,
  type HostedBrowserTransportMessage,
} from "@lineupkeep/hosted-browser/protocol";
import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";

const descriptorTimeoutMillis = 5_000;
const shutdownTimeoutMillis = 4_000;
const maximumInputMessages = 2_000;
const maximumPendingInputs = 64;
const sessionPath = "/session";

export type HostedBrowserServiceOptions = {
  readonly descriptorKey: string;
  readonly fixtureOrigin?: string;
  readonly profileRoot?: string;
  readonly chromiumSandbox?: boolean;
  readonly log?: (event: HostedBrowserSessionEvent) => void;
};

export type HostedBrowserService = {
  readonly listen: (port: number) => Promise<number>;
  readonly close: () => Promise<void>;
};

type HostedBrowserSessionOutcome =
  | "captured"
  | "cancelled"
  | "expired"
  | "failed"
  | "rejected"
  | "shutdown";

export type HostedBrowserSessionEvent = {
  readonly event: "hosted_browser.session";
  readonly outcome: HostedBrowserSessionOutcome;
  readonly durationMillis: number;
  readonly sessionId?: string;
  readonly failure?: HostedBrowserFailure;
  readonly refused?: ReadonlyArray<EgressRefusal>;
};

export function createHostedBrowserService(
  options: HostedBrowserServiceOptions,
): HostedBrowserService {
  const browser = createHostedBrowser({
    profileRoot: options.profileRoot,
    chromiumSandbox: options.chromiumSandbox,
  });
  const log = options.log ?? writeLog;
  const seenSessions = new Set<string>();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1_024 });
  let live: LiveSession | undefined;
  let shuttingDown = false;

  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      respond(response, 200, { status: shuttingDown ? "stopping" : "ready" });
      return;
    }
    respond(response, 404, { status: "not_found" });
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== sessionPath || shuttingDown) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (peer) => {
      sockets.emit("connection", peer, request);
    });
  });

  sockets.on("connection", (peer) => {
    acceptSession(peer);
  });

  function acceptSession(peer: WebSocket): void {
    const startedAt = Date.now();
    const reject = (outcome: HostedBrowserSessionOutcome, code: number, reason: string): void => {
      log({ event: "hosted_browser.session", outcome, durationMillis: Date.now() - startedAt });
      peer.close(code, reason);
    };
    const descriptorTimer = setTimeout(() => {
      reject("rejected", 1008, "Session descriptor required");
    }, descriptorTimeoutMillis);
    peer.once("close", () => clearTimeout(descriptorTimer));

    peer.once("message", (data: RawData, isBinary: boolean) => {
      clearTimeout(descriptorTimer);
      const text = isBinary ? undefined : textOf(data);
      const descriptor =
        text === undefined
          ? undefined
          : verifyHostedBrowserDescriptor(options.descriptorKey, text, Date.now());
      if (descriptor === undefined) {
        reject("rejected", 1008, "Invalid session descriptor");
        return;
      }
      if (seenSessions.has(descriptor.sessionId)) {
        reject("rejected", 1008, "Session descriptor already used");
        return;
      }
      if (live !== undefined) {
        log({
          event: "hosted_browser.session",
          outcome: "rejected",
          durationMillis: Date.now() - startedAt,
          sessionId: descriptor.sessionId,
          failure: "browser_unavailable",
        });
        peer.close(1013, "The hosted browser is busy");
        return;
      }
      seenSessions.add(descriptor.sessionId);
      void runSession(peer, descriptor, startedAt);
    });
  }

  async function runSession(
    peer: WebSocket,
    descriptor: HostedBrowserDescriptor,
    startedAt: number,
  ): Promise<void> {
    let inputCount = 0;
    let terminal: HostedBrowserSessionOutcome | undefined;
    let handle: HostedBrowserHandle | undefined;
    const refused: EgressRefusal[] = [];
    const pendingInputs: HostedBrowserInput[] = [];
    const handleReady = Promise.withResolvers<void>();
    const liveSession: LiveSession = {
      sessionId: descriptor.sessionId,
      startedAt,
      stop: () => settle("shutdown"),
      close: async () => {
        await handleReady.promise;
        await handle?.close().catch(() => undefined);
      },
    };
    live = liveSession;

    const settle = (outcome: HostedBrowserSessionOutcome, failure?: HostedBrowserFailure): void => {
      if (terminal !== undefined) {
        return;
      }
      terminal = outcome;
      if (live === liveSession) {
        live = undefined;
      }
      log({
        event: "hosted_browser.session",
        outcome,
        durationMillis: Date.now() - startedAt,
        sessionId: descriptor.sessionId,
        ...(failure === undefined ? {} : { failure }),
        ...(refused.length === 0 ? {} : { refused: [...refused] }),
      });
      peer.removeAllListeners("message");
    };
    const send = (message: HostedBrowserTransportMessage): void => {
      if (peer.readyState === WebSocket.OPEN) {
        peer.send(encodeTransportMessage(message));
      }
    };

    peer.on("message", (data, isBinary) => {
      inputCount++;
      if (inputCount > maximumInputMessages) {
        peer.close(1008, "Too many control messages");
        return;
      }
      const text = isBinary ? undefined : textOf(data);
      const input = text === undefined ? undefined : parseHostedBrowserInput(text);
      if (input === undefined) {
        return;
      }
      if (handle === undefined) {
        if (pendingInputs.length < maximumPendingInputs) {
          pendingInputs.push(input);
        }
        return;
      }
      handle.input(input);
    });
    peer.on("close", () => {
      if (terminal !== undefined) {
        return;
      }
      settle("cancelled");
      void handle?.close().catch(() => undefined);
    });
    peer.on("error", () => {
      if (terminal !== undefined) {
        return;
      }
      settle("cancelled");
      void handle?.close().catch(() => undefined);
    });

    try {
      handle = await browser.open(
        {
          id: descriptor.sessionId,
          expiresAt: descriptor.expiresAt,
          loginUrl: descriptor.loginUrl,
          viewport: descriptor.viewport,
          ...(options.fixtureOrigin === undefined ? {} : { fixtureOrigin: options.fixtureOrigin }),
        },
        {
          onFrame: (frame) => {
            if (peer.readyState === WebSocket.OPEN) {
              peer.send(frame, { binary: true });
            }
          },
          onStatus: (status) => send({ _tag: "Status", status }),
          onAcceptsInput: () => send({ _tag: "AcceptsInput" }),
          onRefused: (refusal) => {
            refused.push(refusal);
            send({ _tag: "Refused", host: refusal.host, reason: refusal.reason });
          },
          onCaptured: (cookieHeader) => {
            send({ _tag: "Captured", session: cookieHeader });
            settle("captured");
            peer.close(1000, "Captured");
          },
          onFailure: (reason) => {
            send({ _tag: "Failed", reason });
            settle("failed", reason);
            peer.close(1011, "Browser failed");
          },
          onExpired: () => {
            send({ _tag: "Expired" });
            settle("expired");
            peer.close(1000, "Expired");
          },
        },
      );
      for (const input of pendingInputs) {
        handle.input(input);
      }
      pendingInputs.length = 0;
      if (terminal !== undefined) {
        await handle.close().catch(() => undefined);
      }
    } catch {
      if (terminal === undefined) {
        send({ _tag: "Failed", reason: "browser_unavailable" });
        settle("failed", "browser_unavailable");
        peer.close(1011, "Browser unavailable");
      }
    } finally {
      handleReady.resolve();
    }
  }

  return {
    listen: (port) =>
      new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", () => {
          const address = server.address();
          if (address === null || typeof address === "string") {
            reject(new Error("The hosted browser service did not bind a port"));
            return;
          }
          resolve(address.port);
        });
      }),
    close: async () => {
      shuttingDown = true;
      const active = live;
      if (active !== undefined) {
        live = undefined;
        active.stop();
        await Promise.race([
          active.close(),
          new Promise<void>((resolve) => setTimeout(resolve, shutdownTimeoutMillis)),
        ]);
      }
      for (const client of sockets.clients) {
        client.close(1001, "Service shutting down");
      }
      await browser.closeAll().catch(() => undefined);
      for (const client of sockets.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function writeLog(event: HostedBrowserSessionEvent): void {
  console.log(JSON.stringify(event));
}

function textOf(data: RawData): string | undefined {
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

type LiveSession = {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly stop: () => void;
  readonly close: () => Promise<void>;
};
