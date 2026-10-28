import { readdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { signHostedBrowserDescriptor } from "@lineupkeep/hosted-browser/descriptor";
import {
  encodeHostedBrowserInput,
  parseTransportMessage,
  type HostedBrowserStatus,
} from "@lineupkeep/hosted-browser/protocol";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import type { RawData } from "ws";

import { createHostedBrowserService, type HostedBrowserSessionEvent } from "./server.ts";

const descriptorKey = "service-test-descriptor-key";

it("streams provider sign-in, captures the session, and removes the profile", async () => {
  const provider = await startServer(providerHandler);
  const profileRoot = await mkdtemp(join(tmpdir(), "lineupkeep-service-test-"));
  const events: HostedBrowserSessionEvent[] = [];
  const service = createHostedBrowserService({
    descriptorKey,
    fixtureOrigin: provider.url.origin,
    profileRoot,
    log: (event) => events.push(event),
  });
  const port = await service.listen(0);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ready" });

    const session = {
      sessionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
      expiresAt: Date.now() + 60_000,
      loginUrl: provider.url.href,
    };
    const client = new WebSocket(`ws://127.0.0.1:${port}/session`);
    const clientClosed = closed(client);
    const statuses: HostedBrowserStatus[] = [];
    const frames: Array<Uint8Array> = [];
    const waiting = Promise.withResolvers<void>();
    const captured = Promise.withResolvers<string>();

    client.on("message", (data, isBinary) => {
      if (isBinary) {
        const frame = rawDataBytes(data);
        if (frame !== undefined) {
          frames.push(frame);
        }
        return;
      }
      const message = parseTransportMessage(rawDataText(data) ?? "");
      if (message?._tag === "Status") {
        statuses.push(message.status);
        if (message.status === "waiting") {
          waiting.resolve();
        }
      }
      if (message?._tag === "Captured") {
        captured.resolve(message.session);
      }
    });

    await opened(client);
    client.send(signHostedBrowserDescriptor(descriptorKey, session));
    await waiting.promise;

    client.send(encodeHostedBrowserInput({ _tag: "Text", text: "hosted-user" }));
    client.send(encodeHostedBrowserInput({ _tag: "Key", key: "Enter" }));

    expect(await captured.promise).toBe("T=temporary-session-token; Y=temporary-user-token");
    expect(frames.length).toBeGreaterThan(0);
    expect(statuses[0]).toBe("starting");
    expect(await clientClosed).toBe(1000);
    await waitForEmptyDirectory(profileRoot);
    expect(events.at(-1)).toMatchObject({ outcome: "captured" });
  } finally {
    await service.close();
    await closeServer(provider.server);
    await rm(profileRoot, { recursive: true, force: true });
  }
}, 60_000);

it("refuses non-public destinations, names them, and records them in the outcome", async () => {
  let blockedRequests = 0;
  const blocked = await startServer((_request, response) => {
    blockedRequests++;
    response.writeHead(200, { "content-type": "image/gif" });
    response.end();
  });
  const provider = await startServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html>
<html>
  <body>
    <img src="http://169.254.169.254/latest/meta-data/" alt="">
    <img src="http://${blocked.url.host}/pixel" alt="">
    <img src="http://localhost:${blocked.url.port}/pixel" alt="">
  </body>
</html>`);
  });
  const profileRoot = await mkdtemp(join(tmpdir(), "lineupkeep-service-test-"));
  const events: HostedBrowserSessionEvent[] = [];
  const settled = Promise.withResolvers<HostedBrowserSessionEvent>();
  const service = createHostedBrowserService({
    descriptorKey,
    fixtureOrigin: provider.url.origin,
    profileRoot,
    log: (event) => {
      events.push(event);
      if (event.outcome === "cancelled") {
        settled.resolve(event);
      }
    },
  });
  const port = await service.listen(0);
  try {
    const client = new WebSocket(`ws://127.0.0.1:${port}/session`);
    const clientClosed = closed(client);
    const waiting = Promise.withResolvers<void>();
    const refusals = Promise.withResolvers<Array<{ host: string; reason: string }>>();
    const seen: Array<{ host: string; reason: string }> = [];
    client.on("message", (data, isBinary) => {
      if (isBinary) {
        return;
      }
      const message = parseTransportMessage(rawDataText(data) ?? "");
      if (message?._tag === "Status" && message.status === "waiting") {
        waiting.resolve();
      }
      if (message?._tag === "Refused") {
        seen.push({ host: message.host, reason: message.reason });
        if (seen.length === 3) {
          refusals.resolve(seen);
        }
      }
    });

    await opened(client);
    client.send(
      signHostedBrowserDescriptor(descriptorKey, {
        sessionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a6",
        expiresAt: Date.now() + 60_000,
        loginUrl: provider.url.href,
      }),
    );
    await waiting.promise;
    const refused = await refusals.promise;

    expect(refused).toEqual(
      expect.arrayContaining([
        { host: "169.254.169.254", reason: "non_public_address" },
        { host: "127.0.0.1", reason: "non_public_address" },
        { host: "localhost", reason: "non_public_address" },
      ]),
    );
    expect(blockedRequests).toBe(0);

    client.close(1000, "Test finished");
    expect(await clientClosed).toBe(1000);
    const outcome = await settled.promise;
    expect(outcome.outcome).toBe("cancelled");
    expect(outcome.refused?.map((refusal) => refusal.host).sort()).toEqual([
      "127.0.0.1",
      "169.254.169.254",
      "localhost",
    ]);
    expect(outcome.refused?.every((refusal) => refusal.reason === "non_public_address")).toBe(true);
  } finally {
    await service.close();
    await closeServer(blocked.server);
    await closeServer(provider.server);
    await rm(profileRoot, { recursive: true, force: true });
  }
}, 60_000);

it("refuses forged descriptors, replayed sessions, and a second browser", async () => {
  const provider = await startServer(providerHandler);
  const profileRoot = await mkdtemp(join(tmpdir(), "lineupkeep-service-test-"));
  const service = createHostedBrowserService({
    descriptorKey,
    fixtureOrigin: provider.url.origin,
    profileRoot,
    log: () => undefined,
  });
  const port = await service.listen(0);
  try {
    const forged = new WebSocket(`ws://127.0.0.1:${port}/session`);
    await opened(forged);
    forged.send(JSON.stringify({ payload: "forged", signature: "forged" }));
    expect(await closed(forged)).toBe(1008);

    const session = {
      sessionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3",
      expiresAt: Date.now() + 60_000,
      loginUrl: provider.url.href,
    };
    const envelope = signHostedBrowserDescriptor(descriptorKey, session);
    const first = new WebSocket(`ws://127.0.0.1:${port}/session`);
    const firstClosed = closed(first);
    const waiting = Promise.withResolvers<void>();
    first.on("message", (data, isBinary) => {
      if (isBinary) {
        return;
      }
      const message = parseTransportMessage(rawDataText(data) ?? "");
      if (message?._tag === "Status" && message.status === "waiting") {
        waiting.resolve();
      }
    });
    await opened(first);
    first.send(envelope);
    await waiting.promise;

    const replay = new WebSocket(`ws://127.0.0.1:${port}/session`);
    await opened(replay);
    replay.send(envelope);
    expect(await closed(replay)).toBe(1008);

    const competing = new WebSocket(`ws://127.0.0.1:${port}/session`);
    await opened(competing);
    competing.send(
      signHostedBrowserDescriptor(descriptorKey, {
        ...session,
        sessionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a4",
      }),
    );
    expect(await closed(competing)).toBe(1013);

    first.close(1000, "Test finished");
    expect(await firstClosed).toBe(1000);
    await waitForEmptyDirectory(profileRoot);
  } finally {
    await service.close();
    await closeServer(provider.server);
    await rm(profileRoot, { recursive: true, force: true });
  }
}, 60_000);

it("destroys the browser and profile when the service stops", async () => {
  const provider = await startServer(providerHandler);
  const profileRoot = await mkdtemp(join(tmpdir(), "lineupkeep-service-test-"));
  const events: HostedBrowserSessionEvent[] = [];
  const service = createHostedBrowserService({
    descriptorKey,
    fixtureOrigin: provider.url.origin,
    profileRoot,
    log: (event) => events.push(event),
  });
  const port = await service.listen(0);
  try {
    const session = {
      sessionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a5",
      expiresAt: Date.now() + 60_000,
      loginUrl: provider.url.href,
    };
    const client = new WebSocket(`ws://127.0.0.1:${port}/session`);
    const clientClosed = closed(client);
    const waiting = Promise.withResolvers<void>();
    client.on("message", (data, isBinary) => {
      if (isBinary) {
        return;
      }
      const message = parseTransportMessage(rawDataText(data) ?? "");
      if (message?._tag === "Status" && message.status === "waiting") {
        waiting.resolve();
      }
    });
    await opened(client);
    client.send(signHostedBrowserDescriptor(descriptorKey, session));
    await waiting.promise;

    await service.close();

    expect(await clientClosed).toBe(1001);
    await waitForEmptyDirectory(profileRoot);
    expect(events.at(-1)).toMatchObject({ outcome: "shutdown" });
  } finally {
    await service.close();
    await closeServer(provider.server);
    await rm(profileRoot, { recursive: true, force: true });
  }
}, 60_000);

function providerHandler(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === "POST") {
    response.writeHead(200, {
      "content-type": "text/html",
      "set-cookie": [
        "T=temporary-session-token; Path=/; HttpOnly; SameSite=Lax",
        "Y=temporary-user-token; Path=/; HttpOnly; SameSite=Lax",
      ],
    });
    response.end("<html><body>Signed in</body></html>");
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html>
<html>
  <body>
    <form method="POST" action="/signed-in">
      <label>Username <input name="username" autofocus autocomplete="off"></label>
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`);
}

function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ readonly server: Server; readonly url: URL }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The test server has no loopback port"));
        return;
      }
      resolve({ server, url: new URL(`http://127.0.0.1:${address.port}/`) });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise<number>((resolve) => {
    socket.once("close", (code) => resolve(code));
  });
}

async function waitForEmptyDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await readdir(directory)).length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(await readdir(directory)).toEqual([]);
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
