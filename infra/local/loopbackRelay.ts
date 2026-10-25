import { readFile } from "node:fs/promises";
import { connect, createServer, isIP } from "node:net";
import type { Socket } from "node:net";

const host = process.env["RELAY_HOST"];
const port = Number(process.env["RELAY_PORT"]);
const bind = process.env["RELAY_BIND"];
const targetFile = process.env["RELAY_TARGET_FILE"];
if (
  targetFile === undefined &&
  (host === undefined || !Number.isInteger(port) || port < 1 || port > 65535)
) {
  throw new Error("A relay requires an explicit upstream host and port");
}
if (bind === undefined || isIP(bind) !== 4 || bind === "0.0.0.0") {
  throw new Error("Relay bind address must be a non-wildcard IP address (IPv4)");
}
const sockets = new Set<Socket>();
const server = createServer((downstream) => {
  sockets.add(downstream);
  downstream.once("close", () => sockets.delete(downstream));
  downstream.on("error", () => downstream.destroy());
  downstream.pause();
  void forward(downstream).catch(() => downstream.destroy());
});

async function forward(downstream: Socket): Promise<void> {
  const target = targetFile === undefined ? undefined : new URL(await readFile(targetFile, "utf8"));
  if (
    target !== undefined &&
    (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname))
  ) {
    throw new Error("An application relay requires a loopback HTTP upstream");
  }
  if (downstream.destroyed) {
    return;
  }
  const upstream = connect({
    host: target === undefined ? host : "127.0.0.1",
    port: target === undefined ? port : Number(target.port),
  });
  sockets.add(upstream);
  upstream.once("close", () => sockets.delete(upstream));
  upstream.once("error", () => downstream.destroy());
  downstream.once("error", () => upstream.destroy());
  downstream.once("close", () => upstream.destroy());
  upstream.once("close", () => downstream.destroy());
  downstream.pipe(upstream).pipe(downstream);
  downstream.resume();
}
server.listen(0, bind, () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Relay received no assigned address");
  }
  console.log(`Container relay ready: http://${address.address}:${address.port}`);
});
function stop(): void {
  server.close();
  for (const socket of sockets) {
    socket.destroy();
  }
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
