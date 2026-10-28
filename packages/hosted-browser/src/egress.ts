import { lookup } from "node:dns/promises";
import { createServer, request as sendRequest } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { BlockList, connect as openSocket, isIP } from "node:net";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";

export type EgressRefusalReason = "non_public_address" | "unresolvable" | "invalid_destination";

export type EgressRefusal = {
  readonly host: string;
  readonly reason: EgressRefusalReason;
};

export type EgressProxyOptions = {
  readonly fixtureOrigins?: ReadonlyArray<string>;
  readonly resolve?: (hostname: string) => Promise<ReadonlyArray<string>>;
  readonly dial?: (address: string, port: number) => Promise<Socket>;
  readonly onRefused?: (refusal: EgressRefusal) => void;
};

export type EgressProxy = {
  readonly url: string;
  readonly refusals: () => ReadonlyArray<EgressRefusal>;
  readonly close: () => Promise<void>;
};

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return !refusedIpv4.check(address, "ipv4");
  }
  if (isIP(address) !== 6) {
    return false;
  }
  const mapped = mappedIpv4(address);
  if (mapped !== undefined) {
    return isPublicAddress(mapped);
  }
  return publicIpv6.check(address, "ipv6") && !refusedIpv6.check(address, "ipv6");
}

export function choosePublicAddress(
  addresses: ReadonlyArray<string>,
):
  | { readonly _tag: "Allowed"; readonly address: string }
  | { readonly _tag: "Refused"; readonly reason: EgressRefusalReason } {
  if (addresses.length === 0) {
    return { _tag: "Refused", reason: "unresolvable" };
  }
  if (!addresses.every(isPublicAddress)) {
    return { _tag: "Refused", reason: "non_public_address" };
  }
  const address = addresses.find((candidate) => isIP(candidate) === 4) ?? addresses[0];
  return address === undefined
    ? { _tag: "Refused", reason: "unresolvable" }
    : { _tag: "Allowed", address };
}

export async function createEgressProxy(options: EgressProxyOptions = {}): Promise<EgressProxy> {
  const fixtureAuthorities = new Set((options.fixtureOrigins ?? []).map(fixtureAuthority));
  const refusals: EgressRefusal[] = [];
  const refusedKeys = new Set<string>();
  const sockets = new Set<Duplex>();
  const resolve = options.resolve ?? resolveHostname;
  const dial = options.dial ?? dialAddress;
  const server = createServer();
  let closing = false;

  const refuse = (host: string, reason: EgressRefusalReason): EgressRefusal => {
    const refusal = { host, reason };
    const key = `${reason}\u0000${host}`;
    if (!refusedKeys.has(key)) {
      refusedKeys.add(key);
      refusals.push(refusal);
      options.onRefused?.(refusal);
    }
    return refusal;
  };

  const destination = async (
    host: string,
    port: number,
  ): Promise<
    | { readonly _tag: "Allowed"; readonly address: string }
    | { readonly _tag: "Refused"; readonly refusal: EgressRefusal }
  > => {
    if (!isValidHostname(host) || !isValidPort(port)) {
      return {
        _tag: "Refused",
        refusal: refuse(host, "invalid_destination"),
      };
    }
    if (fixtureAuthorities.has(authorityKey(host, port))) {
      const addresses = literalAddress(host) ?? (await addressesOf(host, resolve));
      if (addresses === undefined) {
        return { _tag: "Refused", refusal: refuse(host, "unresolvable") };
      }
      const address = addresses[0];
      return address === undefined
        ? { _tag: "Refused", refusal: refuse(host, "unresolvable") }
        : { _tag: "Allowed", address };
    }
    const addresses = literalAddress(host) ?? (await addressesOf(host, resolve));
    if (addresses === undefined) {
      return { _tag: "Refused", refusal: refuse(host, "unresolvable") };
    }
    const chosen = choosePublicAddress(addresses);
    if (chosen._tag === "Refused") {
      return { _tag: "Refused", refusal: refuse(host, chosen.reason) };
    }
    return chosen;
  };

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  server.on("request", (request, response) => {
    void forwardHttpRequest(request, response);
  });

  server.on("connect", (request, clientSocket, head) => {
    sockets.add(clientSocket);
    clientSocket.once("close", () => sockets.delete(clientSocket));
    void tunnel(request, clientSocket, head);
  });

  server.on("upgrade", (request, clientSocket, head) => {
    sockets.add(clientSocket);
    clientSocket.once("close", () => sockets.delete(clientSocket));
    void forwardUpgrade(request, clientSocket, head);
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
  });

  async function forwardHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const target = httpTarget(request.url);
    if (target === undefined) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("The secure browser received an invalid destination.");
      return;
    }
    const allowed = await destination(target.host, target.port);
    if (allowed._tag === "Refused") {
      response.writeHead(403, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(refusalPage(allowed.refusal));
      return;
    }
    const headers = { ...request.headers };
    delete headers["proxy-connection"];
    const upstream = sendRequest({
      host: allowed.address,
      port: target.port,
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers,
    });
    upstream.once("response", (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    });
    upstream.once("error", () => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        response.end(`The secure browser could not reach ${target.host}.`);
      } else {
        response.destroy();
      }
    });
    response.once("close", () => upstream.destroy());
    request.pipe(upstream);
  }

  async function forwardUpgrade(
    request: IncomingMessage,
    clientSocket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const target = httpTarget(request.url);
    if (target === undefined) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const allowed = await destination(target.host, target.port);
    if (allowed._tag === "Refused") {
      const text = refusalText(allowed.refusal);
      clientSocket.end(
        `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`,
      );
      return;
    }
    const headers = { ...request.headers };
    delete headers["proxy-connection"];
    const upstream = sendRequest({
      host: allowed.address,
      port: target.port,
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers,
    });
    upstream.once("upgrade", (response, upstreamSocket, upstreamHead) => {
      sockets.add(upstreamSocket);
      upstreamSocket.once("close", () => sockets.delete(upstreamSocket));
      clientSocket.write(
        `HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? "Switching Protocols"}\r\n`,
      );
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        clientSocket.write(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`);
      }
      clientSocket.write("\r\n");
      if (upstreamHead.length > 0) {
        clientSocket.write(upstreamHead);
      }
      if (head.length > 0) {
        upstreamSocket.write(head);
      }
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.once("error", () => clientSocket.destroy());
      clientSocket.once("error", () => upstreamSocket.destroy());
      clientSocket.once("close", () => upstreamSocket.destroy());
      upstreamSocket.once("close", () => clientSocket.destroy());
    });
    upstream.once("response", (response) => {
      clientSocket.write(
        `HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? "Bad Gateway"}\r\n`,
      );
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        clientSocket.write(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`);
      }
      clientSocket.write("\r\n");
      response.pipe(clientSocket);
    });
    upstream.once("error", () => clientSocket.destroy());
    clientSocket.once("close", () => upstream.destroy());
    upstream.end();
  }

  async function tunnel(
    request: IncomingMessage,
    clientSocket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const target = connectTarget(request.url);
    if (target === undefined) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const allowed = await destination(target.host, target.port);
    if (allowed._tag === "Refused") {
      clientSocket.end(
        `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(
          refusalText(allowed.refusal),
        )}\r\nConnection: close\r\n\r\n${refusalText(allowed.refusal)}`,
      );
      return;
    }
    if (closing) {
      clientSocket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    let upstream: Socket;
    try {
      upstream = await dial(allowed.address, target.port);
    } catch {
      clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    upstream.once("error", () => clientSocket.destroy());
    clientSocket.once("error", () => upstream.destroy());
    clientSocket.once("close", () => upstream.destroy());
    upstream.once("close", () => clientSocket.destroy());
  }

  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The egress proxy did not bind a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    refusals: () => [...refusals],
    close: async () => {
      closing = true;
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections();
      });
    },
  };
}

function fixtureAuthority(origin: string): string {
  const url = new URL(origin);
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error("A hosted browser fixture origin must use a loopback host");
  }
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  return authorityKey(stripBrackets(url.hostname), port);
}

function isLoopbackHostname(hostname: string): boolean {
  const host = stripBrackets(hostname).toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function httpTarget(requestUrl: string | undefined):
  | {
      readonly host: string;
      readonly port: number;
      readonly pathname: string;
      readonly search: string;
    }
  | undefined {
  if (requestUrl === undefined) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }
  const host = stripBrackets(url.hostname);
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  return { host, port, pathname: url.pathname, search: url.search };
}

function connectTarget(
  authority: string | undefined,
): { readonly host: string; readonly port: number } | undefined {
  if (authority === undefined) {
    return undefined;
  }
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end === -1) {
      return undefined;
    }
    const host = authority.slice(1, end);
    const remainder = authority.slice(end + 1);
    if (remainder === "") {
      return { host, port: 443 };
    }
    if (!remainder.startsWith(":")) {
      return undefined;
    }
    return { host, port: Number(remainder.slice(1)) };
  }
  const colon = authority.lastIndexOf(":");
  if (colon === -1) {
    return { host: authority, port: 443 };
  }
  return { host: authority.slice(0, colon), port: Number(authority.slice(colon + 1)) };
}

function authorityKey(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

function isValidHostname(host: string): boolean {
  return (
    isIP(host) !== 0 ||
    (host.length >= 1 && host.length <= 253 && !/[\s/:@\\]/u.test(host) && host !== ".")
  );
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function literalAddress(host: string): ReadonlyArray<string> | undefined {
  return isIP(host) === 0 ? undefined : [host];
}

async function addressesOf(
  host: string,
  resolve: (hostname: string) => Promise<ReadonlyArray<string>>,
): Promise<ReadonlyArray<string> | undefined> {
  try {
    const addresses = await resolve(host);
    return addresses.length === 0 ? undefined : addresses;
  } catch {
    return undefined;
  }
}

async function resolveHostname(hostname: string): Promise<ReadonlyArray<string>> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
}

function dialAddress(address: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = openSocket({ host: address, port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function mappedIpv4(address: string): string | undefined {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address);
  const dottedAddress = dotted?.[1];
  if (dottedAddress !== undefined) {
    return dottedAddress;
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(address);
  if (hex === null) {
    return undefined;
  }
  const highHex = hex[1];
  const lowHex = hex[2];
  if (highHex === undefined || lowHex === undefined) {
    return undefined;
  }
  const high = Number.parseInt(highHex, 16);
  const low = Number.parseInt(lowHex, 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function refusalText(refusal: EgressRefusal): string {
  switch (refusal.reason) {
    case "non_public_address":
      return `The secure browser refused to connect to ${refusal.host} because it resolves to an address that is not on the public internet.`;
    case "unresolvable":
      return `The secure browser refused to connect to ${refusal.host} because the name could not be resolved.`;
    case "invalid_destination":
      return `The secure browser refused to connect to ${refusal.host} because it is not a valid destination.`;
  }
}

function refusalPage(refusal: EgressRefusal): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Connection refused</title></head><body><main><h1>Connection refused</h1><p>${escapeHtml(refusalText(refusal))}</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

const refusedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  refusedIpv4.addSubnet(network, prefix, "ipv4");
}

const publicIpv6 = new BlockList();
publicIpv6.addSubnet("2000::", 3, "ipv6");

const refusedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  refusedIpv6.addSubnet(network, prefix, "ipv6");
}
