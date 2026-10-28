import type { AddressInfo } from "node:net";

import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { decodeConnectionId } from "@lineupkeep/backend/connections/Connection";
import { HostedLinkingSessionId } from "@lineupkeep/backend/connections/HostedLinking";
import { verifyHostedBrowserDescriptor } from "@lineupkeep/hosted-browser/descriptor";
import { encodeTransportMessage } from "@lineupkeep/hosted-browser/protocol";
import { DateTime, Redacted, Schema } from "effect";
import { expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

import type { HostedBrowserMessage } from "#contracts/connections/hostedBrowserProtocol.ts";

import type { HostedBrowserSession } from "./HostedBrowser.ts";
import { createRemoteHostedBrowser } from "./remoteHostedBrowser.ts";

const descriptorKey = "remote-browser-test-key";

it("relays the hosted browser stream and completes the owner session", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await listening(server);
  const received: Array<string | undefined> = [];
  let descriptorOrigin: string | undefined;
  server.on("connection", (socket, request) => {
    received.push(request.headers.authorization);
    socket.once("message", (data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : "";
      descriptorOrigin = verifyHostedBrowserDescriptor(descriptorKey, text, Date.now())?.loginUrl;
      socket.send(encodeTransportMessage({ _tag: "Status", status: "waiting" }));
      socket.send(Buffer.from([1, 2, 3, 4]));
      socket.send(
        encodeTransportMessage({
          _tag: "Captured",
          session: "T=temporary-session-token; Y=temporary-user-token",
        }),
      );
    });
  });

  const factory = createRemoteHostedBrowser({
    url: `http://127.0.0.1:${port(server)}`,
    descriptorKey,
    identityToken: () => Promise.resolve("test-identity-token"),
  });
  const messages: HostedBrowserMessage[] = [];
  const frames: Array<Uint8Array> = [];
  const ready = Promise.withResolvers<void>();
  let captured: string | undefined;

  try {
    const handle = await factory.open(session(), {
      onFrame: (frame) => frames.push(frame),
      onMessage: (message) => {
        messages.push(message);
        if (message._tag === "Ready") {
          ready.resolve();
        }
      },
      complete: (material) => {
        captured = Redacted.value(material);
        return Promise.resolve({ status: "ready", teamsDiscovered: 2 });
      },
      fault: () => Promise.resolve(),
      expire: () => Promise.resolve(),
    });
    await ready.promise;
    await handle.close();
  } finally {
    await factory.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  expect(received).toEqual(["Bearer test-identity-token"]);
  expect(descriptorOrigin).toBe("https://login.yahoo.com/");
  expect(frames).toEqual([new Uint8Array([1, 2, 3, 4])]);
  expect(messages).toEqual([
    { _tag: "Status", status: "waiting" },
    {
      _tag: "Ready",
      connectionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3",
      teamsDiscovered: 2,
    },
  ]);
  expect(captured).toBe("T=temporary-session-token; Y=temporary-user-token");
});

it("reports a fault when the hosted browser closes without a result", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await listening(server);
  server.on("connection", (socket: WebSocket) => {
    socket.close(1000, "Closed by the test");
  });

  const factory = createRemoteHostedBrowser({
    url: `http://127.0.0.1:${port(server)}`,
    descriptorKey,
    identityToken: () => Promise.resolve("test-identity-token"),
  });
  const failed = Promise.withResolvers<HostedBrowserMessage>();
  const faults: string[] = [];

  try {
    await factory.open(session(), {
      onFrame: () => undefined,
      onMessage: (message) => {
        if (message._tag === "Failed") {
          failed.resolve(message);
        }
      },
      complete: () => Promise.resolve({ status: "failed", reason: "completion_failed" }),
      fault: (reason) => {
        faults.push(reason);
        return Promise.resolve();
      },
      expire: () => Promise.resolve(),
    });
    expect(await failed.promise).toEqual({ _tag: "Failed", reason: "browser_unavailable" });
  } finally {
    await factory.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  expect(faults).toEqual(["browser_unavailable"]);
});

function session(): HostedBrowserSession {
  return {
    id: Schema.decodeSync(HostedLinkingSessionId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"),
    userId: decodeUserId("owner"),
    connectionId: decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a3"),
    expiresAt: DateTime.addDuration(DateTime.nowUnsafe(), "1 minute"),
    loginUrl: new URL("https://login.yahoo.com/"),
  };
}

function port(server: WebSocketServer): number {
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The test server has no loopback port");
  }
  return address.port;
}

function listening(server: WebSocketServer): Promise<void> {
  if (server.address() !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => server.once("listening", () => resolve()));
}
