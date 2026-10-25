import { lookup } from "node:dns/promises";
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request } from "node:https";
import type { RequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ReadableStream as NodeReadableStream } from "node:stream/web";

import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import { Schema } from "effect";

import { PublicInternet } from "#runtime/PublicInternet.ts";

export const publicInternetProcess = makePublicInternetProcess({
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  connect: request,
});

export function makePublicInternetProcess(
  network: ProcessNetwork,
): import("effect/Layer").Layer<PublicInternet, never, never> {
  return PublicInternet.fromTransport(async (webRequest, init) => {
    const url = new URL(webRequest.url);
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    const addresses = await network.resolve(hostname);
    init.signal.throwIfAborted();
    const pinned = addresses[0];
    if (pinned === undefined || addresses.some(({ address }) => !isPublicRoutableHost(address))) {
      throw new Error("Public DNS answers required");
    }
    const headers = Object.fromEntries(webRequest.headers);
    headers["host"] = url.host;

    if (
      webRequest.body !== null &&
      !webRequest.headers.has("content-length") &&
      !webRequest.headers.has("transfer-encoding")
    ) {
      headers["transfer-encoding"] = "chunked";
    }
    return new Promise<Response>((resolve, reject) => {
      const outgoing = network.connect(
        url,
        {
          agent: false,
          method: webRequest.method,
          headers,
          servername: isIP(hostname) === 0 ? hostname : undefined,
          signal: init.signal,

          lookup: (_hostname, options, callback) => {
            if (options.all === true) {
              callback(null, [pinned]);
            } else {
              callback(null, pinned.address, pinned.family);
            }
          },
        },
        (incoming) => {
          try {
            const status = Schema.decodeUnknownSync(ResponseStatus)(incoming.statusCode);
            const noBody = webRequest.method === "HEAD" || [204, 205, 304].includes(status);
            if (noBody) {
              incoming.destroy();
            }
            resolve(
              new Response(
                noBody ? null : Schema.decodeUnknownSync(WebBody)(Readable.toWeb(incoming)),
                {
                  headers: responseHeaders(incoming.headers),
                  status,
                  statusText: incoming.statusMessage,
                },
              ),
            );
          } catch {
            incoming.destroy();
            reject(new Error("Invalid HTTPS response"));
          }
        },
      );
      outgoing.once("error", reject);
      if (webRequest.body === null) {
        outgoing.end();
      } else {
        void pipeline(
          Readable.fromWeb(Schema.decodeUnknownSync(NodeBody)(webRequest.body)),
          outgoing,
          { signal: init.signal },
        ).catch(reject);
      }
    });
  });
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item);
      }
    } else if (value !== undefined) {
      result.append(name, value);
    }
  }
  return result;
}

const ResponseStatus = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(200),
  Schema.isLessThanOrEqualTo(599),
);

const WebBody = Schema.instanceOf(ReadableStream);
const NodeBody = Schema.instanceOf(NodeReadableStream);

type ProcessNetwork = {
  readonly resolve: (
    hostname: string,
  ) => Promise<ReadonlyArray<{ address: string; family: number }>>;
  readonly connect: (
    url: URL,
    options: RequestOptions,
    respond: (response: IncomingMessage) => void,
  ) => ClientRequest;
};
