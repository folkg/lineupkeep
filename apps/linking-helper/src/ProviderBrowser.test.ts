import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, it } from "@effect/vitest";
import { Duration, Effect, Redacted, Scope } from "effect";

import { ProviderBrowser, ProviderBrowserLive } from "./ProviderBrowser.ts";

it.live(
  "extracts only the T and Y provider cookies from a temporary profile and removes it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const browser = yield* ProviderBrowser;
        const server = yield* fakeYahooServer();
        const profileRoot = yield* temporaryDirectory();

        const session = yield* browser.signIn({
          loginUrl: server.url,
          headless: true,
          timeout: Duration.seconds(5),
          profileRoot,
        });

        assert.strictEqual(
          Redacted.value(session),
          "T=temporary-session-token; Y=temporary-user-token",
        );
        assert.deepStrictEqual(yield* Effect.promise(() => readdir(profileRoot)), []);
      }),
    ).pipe(Effect.provide(ProviderBrowserLive)),
  30_000,
);

it.live(
  "removes the temporary profile when provider sign-in times out",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const browser = yield* ProviderBrowser;
        const server = yield* idleServer();
        const profileRoot = yield* temporaryDirectory();

        const error = yield* Effect.flip(
          browser.signIn({
            loginUrl: server.url,
            headless: true,
            timeout: Duration.seconds(1),
            profileRoot,
          }),
        );

        assert.strictEqual(error._tag, "linking_helper.provider_login_timed_out");
        assert.deepStrictEqual(yield* Effect.promise(() => readdir(profileRoot)), []);
      }),
    ).pipe(Effect.provide(ProviderBrowserLive)),
  30_000,
);

type TestServer = {
  readonly server: Server;
  readonly url: URL;
};

function fakeYahooServer(): Effect.Effect<TestServer, never, Scope.Scope> {
  return Effect.acquireRelease(
    startServer((request: IncomingMessage, response: ServerResponse) => {
      if (request.url === "/") {
        response.writeHead(302, { location: "/signed-in" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html",
        "set-cookie": [
          "T=temporary-session-token; Path=/; HttpOnly",
          "Y=temporary-user-token; Path=/; HttpOnly",
          "OTHER=unrelated-cookie; Path=/",
        ],
      });
      response.end("<html><body>Signed in</body></html>");
    }),
    closeServer,
  );
}

function idleServer(): Effect.Effect<TestServer, never, Scope.Scope> {
  return Effect.acquireRelease(
    startServer((_request: IncomingMessage, response: ServerResponse) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body>Sign in</body></html>");
    }),
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
          resolve({ server, url: new URL(`http://127.0.0.1:${address.port}/`) });
        });
      }),
    catch: (cause) => new Error("The test server could not start", { cause }),
  }).pipe(Effect.orDie);
}

function closeServer(testServer: TestServer): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve) => {
        testServer.server.close(() => resolve());
      }),
    catch: (cause) => new Error("The test server could not stop", { cause }),
  }).pipe(Effect.orDie);
}

function temporaryDirectory(): Effect.Effect<string, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "lineupkeep-helper-test-")),
      catch: (cause) => new Error("The test profile root could not be created", { cause }),
    }).pipe(Effect.orDie),
    (directory) =>
      Effect.tryPromise({
        try: () => rm(directory, { recursive: true, force: true }),
        catch: (cause) => new Error("The test profile root could not be removed", { cause }),
      }).pipe(Effect.orDie),
  );
}
