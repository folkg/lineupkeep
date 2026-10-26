import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempDisposable, writeFile } from "node:fs/promises";
import { createServer as httpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

const relayStartupTimeoutMillis = 10_000;

it.each(["127.0.0.1", "localhost"])(
  "keeps the public port reserved while its dynamic %s upstream starts",
  async (host) => {
    await using fixture = await relayFixture();
    const { address, target, upstream } = fixture;
    await expectPortReserved(Number(address.port));

    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const assigned = upstream.address();
    if (assigned === null || typeof assigned === "string") {
      throw new Error("Upstream needs an assigned TCP port");
    }
    await writeFile(target, `http://${host}:${assigned.port}`);
    const response = await fetch(address);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(address.host);
    await expectPortReserved(Number(address.port));
  },
);

it.each(["0.0.0.0", "::", "0:0:0:0:0:0:0:0"])("refuses to start a relay on wildcard %s", (bind) => {
  const relay = spawnSync(process.execPath, ["infra/local/loopbackRelay.ts"], {
    env: { ...process.env, RELAY_HOST: "127.0.0.1", RELAY_PORT: "1", RELAY_BIND: bind },
    encoding: "utf8",
    timeout: 5000,
  });

  expect(relay.status).not.toBe(0);
  expect(relay.stderr).toContain("Relay bind address must be a non-wildcard IP address");
});

async function relayFixture(): Promise<{
  address: URL;
  target: string;
  upstream: ReturnType<typeof httpServer>;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  await using resources = new AsyncDisposableStack();
  const directory = resources.use(await mkdtempDisposable(join(tmpdir(), "lineupkeep-relay-")));
  const target = join(directory.path, "upstream");
  const upstream = httpServer((request, response) => response.end(request.headers.host));
  resources.defer(async () => {
    upstream.closeAllConnections();
    if (!upstream.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
  const relay = spawn(process.execPath, ["infra/local/loopbackRelay.ts"], {
    env: { ...process.env, RELAY_BIND: "127.0.0.1", RELAY_TARGET_FILE: target },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(relay, "exit");
  resources.defer(async () => {
    relay.kill("SIGTERM");
    await exited;
  });
  let output = "";
  relay.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  await expect
    .poll(() => /http:\/\/127\.0\.0\.1:\d+/u.exec(output)?.[0], {
      timeout: relayStartupTimeoutMillis,
    })
    .toBeDefined();
  const address = new URL(/http:\/\/127\.0\.0\.1:\d+/u.exec(output)?.[0] ?? "");
  const cleanup = resources.move();
  return { address, target, upstream, [Symbol.asyncDispose]: () => cleanup.disposeAsync() };
}

async function expectPortReserved(port: number): Promise<void> {
  await using competitor = createServer();
  const rejected = new Promise<Error>((resolve, reject) => {
    competitor.once("error", resolve);
    competitor.once("listening", () => reject(new Error("The public relay port was released")));
  });
  competitor.listen(port, "127.0.0.1");
  expect(await rejected).toMatchObject({ code: "EADDRINUSE" });
}
