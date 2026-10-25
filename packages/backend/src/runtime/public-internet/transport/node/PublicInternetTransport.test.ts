import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { createServer, request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import type { LookupFunction } from "node:net";

import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import { assert, it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { Agent } from "undici";

import { publicInternetIsolate } from "#runtime/public-internet/transport/isolate/PublicInternetIsolate.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { makePublicInternetProcess } from "./PublicInternetProcess.ts";

for (const name of ["process", "isolate"] as const) {
  it.effect(`sends JSON and headers over ${name} HTTPS`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );

      const response = yield* internet.request(
        new Request(`${fixture.origin}/echo`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-provider-key": "private-key",
          },
          body: '{"event":"saved"}',
        }),
      );

      assert.strictEqual(yield* Effect.promise(() => response.text()), '{"event":"saved"}');
      assert.strictEqual(response.headers.get("x-received-method"), "POST");
      assert.strictEqual(response.headers.get("x-received-content-type"), "application/json");
      assert.strictEqual(response.headers.get("x-received-key"), "private-key");
      assert.strictEqual(response.headers.get("x-received-host"), new URL(fixture.origin).host);
      assert.strictEqual(response.headers.get("x-received-servername"), "public-internet.test");
    }),
  );

  it.effect(`sends bytes with other HTTP methods on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );
      for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS", "PROPFIND"]) {
        const response = yield* internet.request(
          new Request(`${fixture.origin}/echo`, {
            method,
            body: new TextEncoder().encode("bytes"),
          }),
        );

        assert.strictEqual(response.headers.get("x-received-method"), method);
        assert.strictEqual(yield* Effect.promise(() => response.text()), "bytes");
      }
    }),
  );

  it.effect(`uploads a stream before its producer finishes on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );
      const exchange = fixture.observe("/echo");
      const control = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
      const body = new ReadableStream<Uint8Array>({ start: control.resolve });
      const controller = yield* Effect.promise(() => control.promise);
      controller.enqueue(new TextEncoder().encode("first"));
      const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };

      const pending = yield* internet.request(new Request(exchange.url, init)).pipe(
        Effect.flatMap((response) => Effect.tryPromise(() => response.text())),
        Effect.forkChild,
      );
      yield* Effect.promise(() => exchange.received.promise);
      controller.enqueue(new TextEncoder().encode("second"));
      controller.close();

      assert.strictEqual(yield* Fiber.join(pending), "firstsecond");
    }),
  );

  it.effect(`cancels an unfinished upload and its socket on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );
      const exchange = fixture.observe("/echo");
      const cancelled = Promise.withResolvers<void>();
      const abort = yield* Effect.sync(() => new AbortController());
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("unfinished"));
        },
        cancel() {
          cancelled.resolve();
        },
      });
      const init: RequestInit & { duplex: "half" } = {
        method: "POST",
        body,
        duplex: "half",
        signal: abort.signal,
      };

      const pending = yield* internet.request(new Request(exchange.url, init)).pipe(
        Effect.flatMap((response) => Effect.tryPromise(() => response.text())),
        Effect.forkChild,
      );
      yield* Effect.promise(() => exchange.received.promise);
      abort.abort();
      const result = yield* Effect.exit(Fiber.join(pending));

      assert.isTrue(Exit.isFailure(result));
      yield* Effect.promise(() => cancelled.promise);
      yield* Effect.promise(() => exchange.closed.promise);
    }),
  );

  it.effect(`closes a response when its caller scope ends on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );
      const exchange = fixture.observe("/stall-body");

      yield* Effect.scoped(internet.request(new Request(exchange.url)));

      yield* Effect.promise(() => exchange.closed.promise);
    }),
  );

  it.effect(`interrupts an upload with its consumer scope on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );
      const exchange = fixture.observe("/echo");
      const cancelled = Promise.withResolvers<void>();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("unfinished"));
        },
        cancel() {
          cancelled.resolve();
        },
      });
      const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };

      const pending = yield* internet.request(new Request(exchange.url, init)).pipe(
        Effect.flatMap((response) => Effect.tryPromise(() => response.text())),
        Effect.scoped,
        Effect.forkChild,
      );
      yield* Effect.promise(() => exchange.received.promise);
      yield* Fiber.interrupt(pending);

      yield* Effect.promise(() => cancelled.promise);
      yield* Effect.promise(() => exchange.closed.promise);
    }),
  );

  it.effect(`rejects POST redirects without replaying the body on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );
      const followedBefore = fixture.followed;

      const result = yield* Effect.exit(
        internet.request(
          new Request(`${fixture.origin}/redirect`, { method: "POST", body: "private payload" }),
        ),
      );

      assert.isTrue(Exit.isFailure(result));
      assert.strictEqual(fixture.followed, followedBefore);
    }),
  );

  it.effect(`times out a POST before response headers on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );
      const exchange = fixture.observe("/stall");

      const pending = yield* internet
        .request(new Request(exchange.url, { method: "POST", body: "payload" }), { timeoutMs: 50 })
        .pipe(Effect.forkChild);
      yield* Effect.promise(() => exchange.received.promise);
      yield* TestClock.adjust(50);
      const result = yield* Effect.exit(Fiber.join(pending));

      assert.isTrue(Exit.isFailure(result));
      yield* Effect.promise(() => exchange.closed.promise);
    }),
  );

  it.effect(`keeps the deadline active through a stalled response body on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );
      const exchange = fixture.observe("/stall-body");
      const response = yield* internet.request(new Request(exchange.url), { timeoutMs: 50 });
      const reader = response.body?.getReader();
      assert.isDefined(reader);
      yield* Effect.promise(() => reader.read());

      const pending = yield* Effect.tryPromise(() => reader.read()).pipe(Effect.forkChild);
      yield* TestClock.adjust(50);
      const result = yield* Effect.exit(Fiber.join(pending));

      assert.isTrue(Exit.isFailure(result));
      yield* Effect.promise(() => exchange.closed.promise);
    }),
  );

  it.effect(`rejects oversized responses and closes the socket before EOF on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );
      const exchange = fixture.observe("/oversize");

      const response = yield* internet.request(new Request(exchange.url), { maxResponseBytes: 8 });
      const result = yield* Effect.exit(Effect.tryPromise(() => response.text()));

      assert.isTrue(Exit.isFailure(result));
      yield* Effect.promise(() => exchange.closed.promise);
    }),
  );

  it.effect(`allows an exact byte limit and a larger caller override on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );

      const exact = yield* internet.request(
        new Request(`${fixture.origin}/echo`, { method: "POST", body: "1234" }),
        { maxResponseBytes: 4 },
      );
      const text = yield* Effect.promise(() => exact.text());
      const larger = yield* internet.request(new Request(`${fixture.origin}/fixed-large`), {
        maxResponseBytes: 2_097_152,
      });
      const bytes = yield* Effect.promise(() => larger.arrayBuffer());

      assert.strictEqual(text, "1234");
      assert.strictEqual(bytes.byteLength, 1_048_577);
    }),
  );

  it.effect(`enforces the default response cap on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );

      const response = yield* internet.request(new Request(`${fixture.origin}/fixed-large`));
      const result = yield* Effect.exit(Effect.tryPromise(() => response.arrayBuffer()));

      assert.isTrue(Exit.isFailure(result));
    }),
  );

  it.effect(`preserves HEAD and bodyless statuses, including 304, on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );

      const head = yield* internet.request(
        new Request(`${fixture.origin}/echo`, { method: "HEAD" }),
      );

      assert.strictEqual(head.body, null);
      for (const status of [204, 205, 304]) {
        const response = yield* internet.request(new Request(`${fixture.origin}/status/${status}`));
        assert.strictEqual(response.status, status);
        assert.strictEqual(response.body, null);
      }
    }),
  );

  it.effect(`rejects invalid response statuses without escaping the transport on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );

      const result = yield* Effect.exit(
        internet.request(new Request(`${fixture.origin}/status/999`)),
      );

      assert.isTrue(Exit.isFailure(result));
    }),
  );

  it.effect(`verifies the TLS certificate against the original hostname on ${name}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(
        Effect.provide(name === "process" ? fixture.processLayer : publicInternetIsolate),
      );

      const result = yield* Effect.exit(
        internet.request(
          new Request(fixture.origin.replace("public-internet.test", "wrong.public-internet.test")),
        ),
      );

      assert.isTrue(Exit.isFailure(result));
    }),
  );
}

for (const autoSelectFamily of [true, false]) {
  it.effect(`pins one DNS resolution with address-family selection ${autoSelectFamily}`, () => {
    let resolutions = 0;
    const layer = makePublicInternetProcess({
      resolve: () =>
        Promise.resolve([
          { address: ++resolutions === 1 ? approvedAddress : "127.0.0.1", family: 4 },
        ]),
      connect: (url, options, callback) => {
        const connection = { ...options, ca: certificate, autoSelectFamily };
        return connectLocal(url, connection, callback);
      },
    });
    return Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
        Effect.promise(() => fixture[Symbol.asyncDispose]()),
      );
      const internet = yield* PublicInternet.pipe(Effect.provide(layer));

      const response = yield* internet.request(
        new Request(`${fixture.origin}/echo`, { headers: { host: "spoofed.test" } }),
      );
      yield* Effect.promise(() => response.text());

      assert.strictEqual(resolutions, 1);
      assert.strictEqual(response.headers.get("x-received-host"), new URL(fixture.origin).host);
      assert.strictEqual(response.headers.get("x-received-servername"), "public-internet.test");
    });
  });
}

it.effect("rejects every special-use DNS answer before opening a process connection", () =>
  Effect.gen(function* () {
    const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
      Effect.promise(() => fixture[Symbol.asyncDispose]()),
    );
    const cases = [
      [],
      [
        { address: approvedAddress, family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      ...[
        "0.0.0.0",
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "::1",
        "fc00::1",
        "fe80::1",
        "2001:db8::1",
        "::ffff:127.0.0.1",
        "100.64.0.1",
        "192.0.2.1",
        "224.0.0.1",
      ].map((address) => [{ address, family: address.includes(":") ? 6 : 4 }]),
    ];
    for (const addresses of cases) {
      let connected = false;
      const layer = makePublicInternetProcess({
        resolve: () => Promise.resolve(addresses),
        connect: () => {
          connected = true;
          throw new Error("Must not open a connection");
        },
      });

      const result = yield* Effect.exit(
        Effect.flatMap(PublicInternet, (internet) =>
          internet.request(new Request(fixture.origin, { method: "POST", body: "secret" })),
        ).pipe(Effect.provide(layer)),
      );

      assert.isTrue(Exit.isFailure(result), addresses.map(({ address }) => address).join(", "));
      assert.isFalse(connected);
    }
  }),
);

it.effect("times out unresolved DNS and refuses to connect when the answer arrives late", () => {
  const started = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<ReadonlyArray<{ address: string; family: number }>>();
  let connected = false;
  const layer = makePublicInternetProcess({
    resolve: () => {
      started.resolve();
      return answer.promise;
    },
    connect: () => {
      connected = true;
      throw new Error("Must not connect after cancellation");
    },
  });
  return Effect.gen(function* () {
    const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
      Effect.promise(() => fixture[Symbol.asyncDispose]()),
    );
    const internet = yield* PublicInternet.pipe(Effect.provide(layer));

    const pending = yield* internet
      .request(new Request(fixture.origin), { timeoutMs: 50 })
      .pipe(Effect.forkChild);
    yield* Effect.promise(() => started.promise);
    yield* TestClock.adjust(50);
    const result = yield* Effect.exit(Fiber.join(pending));
    answer.resolve([{ address: approvedAddress, family: 4 }]);
    yield* Effect.promise(() => answer.promise);

    assert.isTrue(Exit.isFailure(result));
    assert.isFalse(connected);
  });
});

it.effect("rejects an untrusted process certificate without disabling verification", () =>
  Effect.gen(function* () {
    const fixture = yield* Effect.acquireRelease(Effect.promise(setupHTTPS), (fixture) =>
      Effect.promise(() => fixture[Symbol.asyncDispose]()),
    );
    const internet = yield* PublicInternet.pipe(
      Effect.provide(makePublicInternetProcess({ resolve, connect: connectLocal })),
    );

    const result = yield* Effect.exit(internet.request(new Request(fixture.origin)));

    assert.isTrue(Exit.isFailure(result));
  }),
);

async function setupHTTPS(): Promise<HTTPSFixture> {
  await using resources = new AsyncDisposableStack();
  let origin = "";
  let followed = 0;
  let sequence = 0;
  const exchanges = new Map<string, ReturnType<typeof observe>>();
  function observe(path: string): {
    url: string;
    received: PromiseWithResolvers<void>;
    closed: PromiseWithResolvers<void>;
  } {
    const id = String(++sequence);
    const exchange = {
      url: `${origin}${path}?id=${id}`,
      received: Promise.withResolvers<void>(),
      closed: Promise.withResolvers<void>(),
    };
    exchanges.set(id, exchange);
    return exchange;
  }

  const server = createServer({ cert: certificate, key }, (request, response) => {
    const url = new URL(request.url ?? "/", origin);
    const id = url.searchParams.get("id") ?? "";
    const exchange = exchanges.get(id);
    request.on("data", () => exchange?.received.resolve());
    response.once("close", () => {
      exchange?.closed.resolve();
      exchanges.delete(id);
    });
    if (url.pathname === "/stall") {
      return;
    }
    if (url.pathname === "/stall-body") {
      response.write("a");
      return;
    }
    if (url.pathname === "/oversize") {
      response.write("1234567890");
      return;
    }
    if (url.pathname === "/fixed-large") {
      response.end(new Uint8Array(1_048_577));
      return;
    }
    if (url.pathname === "/redirect") {
      response.writeHead(307, { location: `${origin}/redirect-target` });
      response.end("redirect");
      return;
    }
    if (url.pathname === "/redirect-target") {
      followed++;
    }
    if (url.pathname.startsWith("/status/")) {
      response.statusCode = Number(url.pathname.slice("/status/".length));
      response.end();
      return;
    }
    response.setHeader("x-received-method", request.method ?? "");
    response.setHeader("x-received-content-type", request.headers["content-type"] ?? "");
    response.setHeader("x-received-key", request.headers["x-provider-key"] ?? "");
    response.setHeader("x-received-host", request.headers.host ?? "");
    response.setHeader(
      "x-received-servername",
      "servername" in request.socket ? String(request.socket.servername) : "",
    );
    request.pipe(response);
  });

  resources.defer(async () => {
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });
  const agent = new Agent({
    connect: {
      ca: certificate,
      lookup: (hostname, options, callback) => {
        void resolve(hostname).then((addresses) => {
          if (!addresses.every(({ address }) => isPublicRoutableHost(address))) {
            callback(new Error("Special-use DNS answer"), "", 4);
            return;
          }
          localAddress(hostname, options, callback);
        });
      },
    },
  });

  resources.defer(() => agent.destroy());
  const nativeFetch = globalThis.fetch;
  resources.defer(() => {
    globalThis.fetch = nativeFetch;
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Missing HTTPS test port");
  }
  origin = `https://public-internet.test:${address.port}`;
  globalThis.fetch = (request, init) => {
    const options: RequestInit & { dispatcher: Agent } = { ...init, dispatcher: agent };
    return nativeFetch(request, options);
  };
  const processLayer = makePublicInternetProcess({
    resolve,
    connect: (url, options, onResponse) =>
      connectLocal(url, { ...options, ca: certificate }, onResponse),
  });

  const ownership = resources.move();
  return {
    origin,
    observe,
    processLayer,
    get followed() {
      return followed;
    },
    [Symbol.asyncDispose]: () => ownership.disposeAsync(),
  };
}

const resolve = (_hostname: string): Promise<{ address: string; family: number }[]> =>
  Promise.resolve([{ address: approvedAddress, family: 4 }]);

function connectLocal(
  url: URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
): import("http").ClientRequest {
  return httpsRequest(
    url,
    {
      ...options,

      lookup: (hostname, lookupOptions, callback) => {
        if (options.lookup === undefined) {
          callback(new Error("Missing connection pin"), "", 4);
          return;
        }
        options.lookup(hostname, lookupOptions, (error, addresses, family) => {
          const address = typeof addresses === "string" ? addresses : addresses[0]?.address;
          if (
            error !== null ||
            address !== approvedAddress ||
            (family !== undefined && family !== 4)
          ) {
            callback(new Error("Connection did not use the approved address"), "", 4);
            return;
          }
          localAddress(hostname, lookupOptions, callback);
        });
      },
    },
    onResponse,
  );
}

const localAddress: LookupFunction = (_hostname, options, callback) => {
  if (options.all === true) {
    callback(null, [{ address: "127.0.0.1", family: 4 }]);
  } else {
    callback(null, "127.0.0.1", 4);
  }
};
const certificate = readFileSync(
  new URL("../../../fixtures/public-internet.test.crt", import.meta.url),
);
const key = readFileSync(new URL("../../../fixtures/public-internet.test.key", import.meta.url));
const approvedAddress = "93.184.216.34";

type HTTPSFixture = AsyncDisposable & {
  readonly origin: string;
  readonly followed: number;
  readonly processLayer: ReturnType<typeof makePublicInternetProcess>;
  readonly observe: (path: string) => {
    url: string;
    received: PromiseWithResolvers<void>;
    closed: PromiseWithResolvers<void>;
  };
};
