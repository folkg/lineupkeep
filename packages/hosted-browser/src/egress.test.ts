import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createTcpServer, connect } from "node:net";
import type { Server, Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  choosePublicAddress,
  createEgressProxy,
  isPublicAddress,
  maximumReportedRefusals,
  type EgressProxy,
  type EgressRefusal,
} from "./egress.ts";

const live: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(live.splice(0).map((entry) => entry.close()));
});

describe("public address classification", () => {
  it.each([
    ["8.8.8.8", true],
    ["93.184.216.34", true],
    ["2606:4700:4700::1111", true],
    ["2001:4860:4860::8888", true],
    ["169.254.169.254", false],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.5.4", false],
    ["192.168.5.6", false],
    ["169.254.1.1", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["::1", false],
    ["::", false],
    ["fc00::1", false],
    ["fe80::1", false],
    ["ff02::1", false],
    ["2001:db8::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:7f00:1", false],
    ["::ffff:8.8.8.8", true],
  ])("classifies %s as public=%s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it("refuses a destination when any resolved address is non-public", () => {
    expect(choosePublicAddress(["93.184.216.34", "10.0.0.5"])).toEqual({
      _tag: "Refused",
      reason: "non_public_address",
    });
    expect(choosePublicAddress([])).toEqual({ _tag: "Refused", reason: "unresolvable" });
    expect(choosePublicAddress(["93.184.216.34"])).toEqual({
      _tag: "Allowed",
      address: "93.184.216.34",
    });
    expect(choosePublicAddress(["2606:4700:4700::1111", "93.184.216.34"])).toEqual({
      _tag: "Allowed",
      address: "93.184.216.34",
    });
  });
});

describe("address-based egress proxy", () => {
  it.each([
    ["the metadata endpoint", "169.254.169.254", "non_public_address"],
    ["IPv4 loopback", "127.0.0.1", "non_public_address"],
    ["RFC1918 10/8", "10.1.2.3", "non_public_address"],
    ["RFC1918 172.16/12", "172.16.5.4", "non_public_address"],
    ["RFC1918 192.168/16", "192.168.5.6", "non_public_address"],
    ["IPv4 link-local", "169.254.1.1", "non_public_address"],
    ["CGNAT", "100.64.0.1", "non_public_address"],
    ["IPv6 loopback", "::1", "non_public_address"],
    ["IPv6 unique local", "fc00::1", "non_public_address"],
    ["IPv6 link-local", "fe80::1", "non_public_address"],
  ])("refuses %s by address", async (_label, address, reason) => {
    const dialed: Array<{ address: string; port: number }> = [];
    const refusals: EgressRefusal[] = [];
    const proxy = await trackedProxy({
      resolve: () => Promise.reject(new Error("An IP literal must not be resolved")),
      dial: (target, port) => {
        dialed.push({ address: target, port });
        return Promise.reject(new Error("A refused destination must not be dialed"));
      },
      onRefused: (refusal) => refusals.push(refusal),
    });

    const response = await connectRequest(proxy.url, `${formatAuthority(address)}:80`);

    expect(response.status).toBe(403);
    expect(dialed).toEqual([]);
    expect(refusals).toEqual([{ host: address, reason }]);
    expect(proxy.refusals()).toEqual([{ host: address, reason }]);
    response.socket.destroy();
  });

  it("stops reporting new refusals after a bounded number and still refuses them", async () => {
    const refusals: EgressRefusal[] = [];
    const proxy = await trackedProxy({
      resolve: () => Promise.reject(new Error("An IP literal must not be resolved")),
      onRefused: (refusal) => refusals.push(refusal),
    });

    for (let index = 0; index <= maximumReportedRefusals; index += 1) {
      const response = await connectRequest(proxy.url, `10.0.${String(index)}.1:80`);
      expect(response.status).toBe(403);
      response.socket.destroy();
    }

    expect(proxy.refusals()).toHaveLength(maximumReportedRefusals);
    expect(refusals).toHaveLength(maximumReportedRefusals);
  });

  it("allows a public host and dials the verified address, not the name", async () => {
    const echo = await trackedTcpServer((socket) => socket.pipe(socket));
    const dialed: Array<{ address: string; port: number }> = [];
    const proxy = await trackedProxy({
      resolve: (hostname) => {
        expect(hostname).toBe("identity.example.test");
        return Promise.resolve(["93.184.216.34"]);
      },
      dial: async (address, port) => {
        dialed.push({ address, port });
        return connectTo(echo.port);
      },
    });

    const response = await connectRequest(proxy.url, "identity.example.test:443");
    expect(response.status).toBe(200);
    response.socket.write("ping");
    expect(await readData(response.socket)).toBe("ping");
    expect(dialed).toEqual([{ address: "93.184.216.34", port: 443 }]);
    response.socket.destroy();
  });

  it("tunnels a websocket upgrade through the verified address", async () => {
    const echoingSocket = await trackedTcpServer((socket) => {
      let handshake = "";
      let open = false;
      socket.on("data", (chunk: Buffer) => {
        if (open) {
          socket.write(chunk);
          return;
        }
        handshake += chunk.toString("latin1");
        if (!handshake.includes("\r\n\r\n")) {
          return;
        }
        open = true;
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
        );
      });
    });
    const proxy = await trackedProxy({
      fixtureOrigins: [`http://127.0.0.1:${echoingSocket.port}`],
    });

    const response = await upgradeRequest(
      proxy.url,
      `http://127.0.0.1:${echoingSocket.port}/socket`,
    );

    expect(response.status).toBe(101);
    response.socket.write("ping");
    expect(await readData(response.socket)).toBe("ping");
    response.socket.destroy();
  });

  it("refuses a public name that resolves to a private address", async () => {
    const refusals: EgressRefusal[] = [];
    const proxy = await trackedProxy({
      resolve: () => Promise.resolve(["93.184.216.34", "10.0.0.5"]),
      dial: () => Promise.reject(new Error("A refused destination must not be dialed")),
      onRefused: (refusal) => refusals.push(refusal),
    });

    const response = await connectRequest(proxy.url, "rebind.example.test:443");

    expect(response.status).toBe(403);
    expect(refusals).toEqual([{ host: "rebind.example.test", reason: "non_public_address" }]);
    response.socket.destroy();
  });

  it("resolves again for every connection, so a later private answer is refused", async () => {
    const echo = await trackedTcpServer((socket) => socket.pipe(socket));
    const answers = [["93.184.216.34"], ["127.0.0.1"]];
    const dialed: Array<string> = [];
    const proxy = await trackedProxy({
      resolve: () => Promise.resolve(answers.shift() ?? ["127.0.0.1"]),
      dial: (address) => {
        dialed.push(address);
        return connectTo(echo.port);
      },
    });

    const first = await connectRequest(proxy.url, "changing.example.test:443");
    expect(first.status).toBe(200);
    first.socket.destroy();

    const second = await connectRequest(proxy.url, "changing.example.test:443");
    expect(second.status).toBe(403);
    expect(dialed).toEqual(["93.184.216.34"]);
    second.socket.destroy();
  });

  it("refuses an unresolved public name", async () => {
    const refusals: EgressRefusal[] = [];
    const proxy = await trackedProxy({
      resolve: () => Promise.reject(new Error("ENOTFOUND")),
      onRefused: (refusal) => refusals.push(refusal),
    });

    const response = await connectRequest(proxy.url, "missing.example.test:443");

    expect(response.status).toBe(403);
    expect(refusals).toEqual([{ host: "missing.example.test", reason: "unresolvable" }]);
    response.socket.destroy();
  });

  it("names the refused host in a plain HTTP refusal page", async () => {
    const refusals: EgressRefusal[] = [];
    const proxy = await trackedProxy({
      resolve: () => Promise.resolve(["127.0.0.1"]),
      onRefused: (refusal) => refusals.push(refusal),
    });

    const response = await plainRequest(proxy.url, "http://intranet.example.test/secret");

    expect(response.status).toBe(403);
    expect(response.body).toContain("intranet.example.test");
    expect(response.body).toContain("not on the public internet");
    expect(refusals).toEqual([{ host: "intranet.example.test", reason: "non_public_address" }]);
  });

  it("permits a loopback origin only when it is the explicit fixture origin", async () => {
    const fixture = await trackedHttpServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`fixture ${request.url}`);
    });
    const proxy = await trackedProxy({
      fixtureOrigins: [fixture.url],
      resolve: () => Promise.resolve(["127.0.0.1"]),
    });

    const response = await plainRequest(proxy.url, `${fixture.url}login`);

    expect(response.status).toBe(200);
    expect(response.body).toBe("fixture /login");
  });
});

async function trackedProxy(
  options: Parameters<typeof createEgressProxy>[0] = {},
): Promise<EgressProxy> {
  const proxy = await createEgressProxy(options);
  live.push(proxy);
  return proxy;
}

async function trackedTcpServer(handler: (socket: Socket) => void): Promise<{
  readonly port: number;
  readonly close: () => Promise<void>;
}> {
  const server = createTcpServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The test server did not bind a port");
  }
  const entry = { port: address.port, close: () => closeServer(server) };
  live.push(entry);
  return entry;
}

async function trackedHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const server = createHttpServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The test server did not bind a port");
  }
  const entry = {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => closeServer(server),
  };
  live.push(entry);
  return entry;
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function connectTo(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function connectRequest(
  proxyUrl: string,
  authority: string,
): Promise<{ readonly status: number; readonly socket: Socket }> {
  const url = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    let received = "";
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    const onData = (chunk: Buffer): void => {
      received += chunk.toString("latin1");
      const lineEnd = received.indexOf("\r\n");
      if (lineEnd === -1) {
        return;
      }
      socket.off("data", onData);
      const status = Number(received.slice(0, lineEnd).split(" ")[1]);
      resolve({ status, socket });
    };
    socket.on("data", onData);
  });
}

function upgradeRequest(
  proxyUrl: string,
  target: string,
): Promise<{ readonly status: number; readonly socket: Socket }> {
  const url = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      host: url.hostname,
      port: Number(url.port),
      method: "GET",
      path: target,
      headers: {
        host: new URL(target).host,
        connection: "Upgrade",
        upgrade: "websocket",
      },
    });
    outgoing.once("upgrade", (response, socket) => {
      resolve({ status: response.statusCode ?? 0, socket });
    });
    outgoing.once("response", (response) => {
      resolve({ status: response.statusCode ?? 0, socket: response.socket });
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

function plainRequest(
  proxyUrl: string,
  target: string,
): Promise<{ readonly status: number; readonly body: string }> {
  const url = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: url.hostname,
        port: Number(url.port),
        method: "GET",
        path: target,
        headers: { host: new URL(target).host },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

function readData(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8")));
  });
}

function formatAuthority(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}
