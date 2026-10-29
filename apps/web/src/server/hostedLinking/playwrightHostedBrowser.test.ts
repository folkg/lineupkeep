import { readdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { decodeConnectionId } from "@lineupkeep/backend/connections/Connection";
import { HostedLinkingSessionId } from "@lineupkeep/backend/connections/HostedLinking";
import { DateTime, Deferred, Effect, Redacted, Schema, Scope } from "effect";

import type { HostedBrowserMessage } from "#contracts/connections/hostedBrowserProtocol.ts";

import type { HostedBrowserSession } from "./HostedBrowser.ts";
import { createPlaywrightHostedBrowser } from "./playwrightHostedBrowser.ts";

it.live(
  "streams frames, forwards input, captures T/Y, and removes the profile",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const blocked = yield* trackedServer(() => undefined);
        const server = yield* fakeProviderServer(blocked.url);
        const profileRoot = yield* temporaryDirectory();
        const factory = createPlaywrightHostedBrowser({ profileRoot });
        const firstFrame = yield* Deferred.make<void>();
        const waiting = yield* Deferred.make<void>();
        const acceptsInput = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<HostedBrowserMessage>();
        let captured: string | undefined;
        const faults: string[] = [];

        const handle = yield* Effect.promise(() =>
          factory.open(sessionFor(server.url), {
            onFrame: () => {
              Deferred.doneUnsafe(firstFrame, Effect.void);
            },
            onMessage: (message) => {
              if (message._tag === "Status" && message.status === "waiting") {
                Deferred.doneUnsafe(waiting, Effect.void);
              }
              if (message._tag === "AcceptsInput") {
                Deferred.doneUnsafe(acceptsInput, Effect.void);
              }
              if (message._tag === "Ready" || message._tag === "Failed") {
                Deferred.doneUnsafe(completed, Effect.succeed(message));
              }
            },
            complete: (session) => {
              captured = Redacted.value(session);
              return Promise.resolve({ status: "ready", connectionId, teamsDiscovered: 2 });
            },
            fault: (reason) => {
              faults.push(reason);
              return Promise.resolve();
            },
            expire: () => Promise.resolve(),
          }),
        );

        yield* Deferred.await(firstFrame);
        yield* Deferred.await(waiting);
        yield* Deferred.await(acceptsInput);
        handle.input({ _tag: "Text", text: "user@example.test" });
        handle.input({ _tag: "Key", key: "Enter" });

        const message = yield* Deferred.await(completed);
        assert.deepStrictEqual(message, {
          _tag: "Ready",
          connectionId,
          teamsDiscovered: 2,
        });
        assert.strictEqual(captured, "T=temporary-session-token; Y=temporary-user-token");
        assert.deepStrictEqual(faults, []);
        yield* waitForEmptyDirectory(profileRoot);
        assert.strictEqual(blocked.requests(), 0);
      }),
    ),
  60_000,
);

it.live(
  "streams an identity-provider popup and relays input to the active target",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* popupProviderServer();
        const profileRoot = yield* temporaryDirectory();
        const factory = createPlaywrightHostedBrowser({ profileRoot });
        const ready = yield* Deferred.make<void>();
        const twoFactor = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<HostedBrowserMessage>();
        let captured: string | undefined;
        let frames = 0;

        const handle = yield* Effect.promise(() =>
          factory.open(sessionFor(server.url), {
            onFrame: () => {
              frames++;
            },
            onMessage: (message) => {
              if (message._tag === "Status" && message.status === "waiting") {
                Deferred.doneUnsafe(ready, Effect.void);
              }
              if (message._tag === "Status" && message.status === "two-factor") {
                Deferred.doneUnsafe(twoFactor, Effect.void);
              }
              if (message._tag === "Ready" || message._tag === "Failed") {
                Deferred.doneUnsafe(completed, Effect.succeed(message));
              }
            },
            complete: (session) => {
              captured = Redacted.value(session);
              return Promise.resolve({ status: "ready", connectionId, teamsDiscovered: 2 });
            },
            fault: () => Promise.resolve(),
            expire: () => Promise.resolve(),
          }),
        );

        yield* Deferred.await(ready);
        yield* Effect.sleep("500 millis");
        handle.input({ _tag: "Key", key: "Enter" });
        yield* Deferred.await(twoFactor);
        yield* Effect.sleep("500 millis");
        handle.input({ _tag: "Text", text: "person@example.test" });
        handle.input({ _tag: "Key", key: "Enter" });

        const message = yield* Deferred.await(completed);
        assert.deepStrictEqual(message, {
          _tag: "Ready",
          connectionId,
          teamsDiscovered: 2,
        });
        assert.strictEqual(captured, "T=temporary-session-token; Y=temporary-user-token");
        assert.isAbove(frames, 0);
        yield* waitForEmptyDirectory(profileRoot);
      }),
    ),
  60_000,
);

it.live(
  "returns to the provider page when its identity popup closes",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* popupProviderServer();
        const profileRoot = yield* temporaryDirectory();
        const factory = createPlaywrightHostedBrowser({ profileRoot });
        const ready = yield* Deferred.make<void>();
        const twoFactor = yield* Deferred.make<void>();
        const returned = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<HostedBrowserMessage>();
        let sawTwoFactor = false;
        let captured: string | undefined;

        const handle = yield* Effect.promise(() =>
          factory.open(sessionFor(server.url, "/login-close"), {
            onFrame: () => undefined,
            onMessage: (message) => {
              if (message._tag !== "Status") {
                if (message._tag === "Ready" || message._tag === "Failed") {
                  Deferred.doneUnsafe(completed, Effect.succeed(message));
                }
                return;
              }
              if (message.status === "waiting") {
                Deferred.doneUnsafe(ready, Effect.void);
              }
              if (message.status === "two-factor") {
                sawTwoFactor = true;
                Deferred.doneUnsafe(twoFactor, Effect.void);
              }
              if (message.status === "waiting" && sawTwoFactor) {
                Deferred.doneUnsafe(returned, Effect.void);
              }
            },
            complete: (session) => {
              captured = Redacted.value(session);
              return Promise.resolve({ status: "ready", connectionId, teamsDiscovered: 1 });
            },
            fault: () => Promise.resolve(),
            expire: () => Promise.resolve(),
          }),
        );

        yield* Deferred.await(ready);
        yield* Effect.sleep("500 millis");
        handle.input({ _tag: "Key", key: "Enter" });
        yield* Deferred.await(twoFactor);
        yield* Deferred.await(returned);
        yield* Effect.sleep("500 millis");
        handle.input({ _tag: "Text", text: "person@example.test" });
        handle.input({ _tag: "Key", key: "Enter" });

        const message = yield* Deferred.await(completed);
        assert.strictEqual(message._tag, "Ready");
        assert.strictEqual(captured, "T=temporary-session-token; Y=temporary-user-token");
        yield* waitForEmptyDirectory(profileRoot);
      }),
    ),
  60_000,
);

it.live(
  "expires the browser and removes the profile when the session runs out",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* idleProviderServer();
        const profileRoot = yield* temporaryDirectory();
        const factory = createPlaywrightHostedBrowser({ profileRoot });
        const expired = yield* Deferred.make<void>();

        const handle = yield* Effect.promise(() =>
          factory.open(
            {
              ...sessionFor(server.url),
              expiresAt: DateTime.addDuration(DateTime.nowUnsafe(), "700 millis"),
            },
            {
              onFrame: () => undefined,
              onMessage: (message) => {
                if (message._tag === "Expired") {
                  Deferred.doneUnsafe(expired, Effect.void);
                }
              },
              complete: () => Promise.resolve({ status: "failed", reason: "completion_failed" }),
              fault: () => Promise.resolve(),
              expire: () => Promise.resolve(),
            },
          ),
        );

        yield* Deferred.await(expired);
        yield* Effect.promise(() => handle.close());
        yield* waitForEmptyDirectory(profileRoot);
      }),
    ),
  60_000,
);

it.live(
  "applies the session viewport profile to the provider page",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reports: Array<URL> = [];
        const typed: Array<string> = [];
        const submissions: Array<string> = [];
        const server = yield* viewportProviderServer(reports, typed, submissions);
        const profileRoot = yield* temporaryDirectory();
        const factory = createPlaywrightHostedBrowser({ profileRoot });

        yield* Effect.promise(() => observeViewport(server.url, factory, reports, typed));
        assert.strictEqual(reports.length, 2);
        assert.deepStrictEqual(metricsOf(reports[0]), { width: 390, height: 844 });
        assert.deepStrictEqual(metricsOf(reports[1]), { width: 1100, height: 720 });
        assert.deepStrictEqual(typed, ["phone-user"]);
        assert.deepStrictEqual(submissions, ["email=phone-user"]);
      }),
    ),
  120_000,
);

function sessionFor(
  origin: URL,
  path = "/login",
  id = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
): HostedBrowserSession {
  return {
    id: Schema.decodeSync(HostedLinkingSessionId)(id),
    userId: decodeUserId("owner"),
    expiresAt: DateTime.addDuration(DateTime.nowUnsafe(), "1 minute"),
    loginUrl: new URL(path, origin),
    viewport: "desktop",
    fixtureOrigin: origin.origin,
  };
}

async function observeViewport(
  origin: URL,
  factory: ReturnType<typeof createPlaywrightHostedBrowser>,
  reports: Array<URL>,
  typed: Array<string>,
): Promise<void> {
  for (const viewport of ["phone", "desktop"] as const) {
    const reported = reports.length;
    const ready = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const sessionId =
      viewport === "phone"
        ? "018f79ea-7d86-7c18-9b4a-8b4d0c9164a7"
        : "018f79ea-7d86-7c18-9b4a-8b4d0c9164a8";
    const handle = await factory.open(
      { ...sessionFor(origin, "/login", sessionId), viewport },
      {
        onFrame: () => undefined,
        onMessage: (message) => {
          if (message._tag === "Status" && message.status === "waiting") {
            ready.resolve();
          }
          if (message._tag === "Ready") {
            completed.resolve();
          }
        },
        complete: () => Promise.resolve({ status: "ready", connectionId, teamsDiscovered: 1 }),
        fault: () => Promise.resolve(),
        expire: () => Promise.resolve(),
      },
    );
    try {
      await settled(ready.promise, `${viewport} page to finish loading`);
      for (let attempt = 0; attempt < 100 && reports.length === reported; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (reports.length === reported) {
        throw new Error(`The ${viewport} provider page did not report its viewport`);
      }
      if (viewport === "phone") {
        handle.input({ _tag: "Text", text: "phone-user" });
        await settled(waitForLength(typed, 1), "the provider field to receive typed text");
        handle.input({ _tag: "Key", key: "Enter" });
        await settled(completed.promise, "the phone sign-in to complete");
      }
    } finally {
      await settled(handle.close(), `${viewport} browser to close`);
    }
  }
}

function waitForLength(values: ReadonlyArray<unknown>, length: number): Promise<void> {
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (values.length >= length) {
        clearInterval(poll);
        resolve();
      }
    }, 20);
  });
}

function settled<T>(work: Promise<T>, label: string, millis = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), millis);
    work.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function metricsOf(report: URL | undefined): { width: number; height: number } {
  if (report === undefined) {
    throw new Error("The provider page did not report its viewport");
  }
  return {
    width: Number(report.searchParams.get("width")),
    height: Number(report.searchParams.get("height")),
  };
}

function viewportProviderServer(
  reports: Array<URL>,
  typed: Array<string>,
  submissions: Array<string>,
): Effect.Effect<TestServer, never, Scope.Scope> {
  return Effect.acquireRelease(
    startServer((request: IncomingMessage, response: ServerResponse) => {
      if (request.url?.startsWith("/metrics") === true) {
        reports.push(new URL(request.url, "http://127.0.0.1"));
        response.writeHead(200, { "content-type": "image/gif" });
        response.end();
        return;
      }
      if (request.url?.startsWith("/typed") === true) {
        typed.push(new URL(request.url, "http://127.0.0.1").searchParams.get("value") ?? "");
        response.writeHead(200, { "content-type": "image/gif" });
        response.end();
        return;
      }
      if (request.method === "POST") {
        const chunks: Array<Buffer> = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          submissions.push(Buffer.concat(chunks).toString("utf8"));
          response.writeHead(200, {
            "content-type": "text/html",
            "set-cookie": [
              "T=temporary-session-token; Path=/; HttpOnly; SameSite=Lax",
              "Y=temporary-user-token; Path=/; HttpOnly; SameSite=Lax",
            ],
          });
          response.end("<html><body>Signed in</body></html>");
        });
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body>
    <form method="POST" action="/signed-in">
      <label>Email <input name="email" autofocus autocomplete="off"></label>
      <button type="submit">Sign in</button>
    </form>
    <script>
      new Image().src = "/metrics?width=" + window.innerWidth + "&height=" + window.innerHeight;
      document.querySelector("input").addEventListener("input", (event) => {
        new Image().src = "/typed?value=" + encodeURIComponent(event.target.value);
      });
    </script>
  </body>
</html>`);
    }),
    closeServer,
  );
}

const connectionId = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a3");

function popupProviderServer(): Effect.Effect<TestServer, never, Scope.Scope> {
  return Effect.acquireRelease(
    startServer((request: IncomingMessage, response: ServerResponse) => {
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
      if (request.url?.startsWith("/verify/identity") === true) {
        response.end(identityPopupPage);
        return;
      }
      if (request.url?.startsWith("/verify/close") === true) {
        response.end(closingPopupPage);
        return;
      }
      response.end(
        request.url?.startsWith("/login-close") === true ? closingProviderPage : popupProviderPage,
      );
    }),
    closeServer,
  );
}

const popupProviderPage = `<!doctype html>
<html>
  <body>
    <form method="POST" action="/signed-in" onsubmit="if (!window.identityOpened) { window.identityOpened = true; window.open('/verify/identity','identity','width=900,height=700'); return false; }">
      <label>Email <input name="email" autofocus autocomplete="off"></label>
      <button>Sign in with Google</button>
      <script>document.querySelector('input[name=email]').focus();</script>
    </form>
  </body>
</html>`;

const closingProviderPage = `<!doctype html>
<html>
  <body>
    <form method="POST" action="/signed-in" onsubmit="if (!window.identityOpened) { window.identityOpened = true; window.open('/verify/close','identity','width=900,height=700'); return false; }">
      <label>Email <input name="email" autofocus autocomplete="off"></label>
      <button>Verify identity</button>
      <script>document.querySelector('input[name=email]').focus();</script>
    </form>
  </body>
</html>`;

const identityPopupPage = `<!doctype html>
<html>
  <body>
    <form method="POST" action="/signed-in">
      <label>Google email <input name="email" autofocus autocomplete="off"></label>
      <button>Continue</button>
      <script>document.querySelector('input[name=email]').focus();</script>
    </form>
  </body>
</html>`;

const closingPopupPage = `<!doctype html>
<html>
  <body>
    <p>Verifying the sign-in</p>
    <script>setTimeout(function () { window.close(); }, 800);</script>
  </body>
</html>`;

type TestServer = {
  readonly server: Server;
  readonly url: URL;
  readonly requests: () => number;
};

function fakeProviderServer(blocked: URL): Effect.Effect<TestServer, never, Scope.Scope> {
  return Effect.acquireRelease(
    startServer((request: IncomingMessage, response: ServerResponse) => {
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
      <label>Email <input name="email" autofocus autocomplete="off"></label>
      <label>Password <input name="password" type="password"></label>
      <button type="submit">Sign in</button>
    </form>
    <img src="${blocked.href}pixel" alt="">
  </body>
</html>`);
    }),
    closeServer,
  );
}

function idleProviderServer(): Effect.Effect<TestServer, never, Scope.Scope> {
  return Effect.acquireRelease(
    startServer((_request: IncomingMessage, response: ServerResponse) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body>Waiting for sign-in</body></html>");
    }),
    closeServer,
  );
}

function trackedServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Effect.Effect<TestServer, never, Scope.Scope> {
  let count = 0;
  return Effect.acquireRelease(
    startServer((request, response) => {
      count++;
      handler(request, response);
      response.writeHead(200, { "content-type": "image/gif" });
      response.end();
    }).pipe(Effect.map((server) => ({ ...server, requests: () => count }))),
    closeServer,
  );
}

function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Effect.Effect<TestServer> {
  return Effect.tryPromise({
    try: () =>
      new Promise<TestServer>((resolve, reject) => {
        const server = createServer(handler);
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (address === null || typeof address === "string") {
            reject(new Error("The test server has no loopback port"));
            return;
          }
          resolve({ server, url: new URL(`http://127.0.0.1:${address.port}/`), requests: () => 0 });
        });
      }),
    catch: (cause) => new Error("The test server could not start", { cause }),
  }).pipe(Effect.orDie);
}

function closeServer(server: TestServer): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => new Promise<void>((resolve) => server.server.close(() => resolve())),
    catch: () => new Error("The test server could not stop"),
  }).pipe(Effect.orDie);
}

function temporaryDirectory(): Effect.Effect<string, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        import("node:fs/promises").then(({ mkdtemp }) =>
          mkdtemp(join(tmpdir(), "lineupkeep-browser-test-")),
        ),
      catch: (cause) => new Error("The test directory could not be created", { cause }),
    }).pipe(Effect.orDie),
    (directory) =>
      Effect.tryPromise({
        try: () =>
          import("node:fs/promises").then(({ rm }) =>
            rm(directory, { recursive: true, force: true }),
          ),
        catch: (cause) => new Error("The test directory could not be removed", { cause }),
      }).pipe(Effect.orDie),
  );
}

function waitForEmptyDirectory(directory: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 50; attempt++) {
      const entries = yield* Effect.promise(() => readdir(directory));
      if (entries.length === 0) {
        return;
      }
      yield* Effect.sleep("100 millis");
    }
    const entries = yield* Effect.promise(() => readdir(directory));
    assert.deepStrictEqual(entries, []);
  });
}
