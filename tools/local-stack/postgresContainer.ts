import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { Schema } from "effect";
import postgres from "postgres";

export function postgresContainer(name: string, lockDirectory: string): DisposableDatabase {
  if (!ownedContainerName.test(name)) {
    throw new Error(`Refusing to manage ${name}: it is not a disposable test database container.`);
  }
  return {
    name,
    create: async (signal) => {
      await docker(["image", "inspect", image], signal).catch(() =>
        docker(["pull", "--quiet", image], signal),
      );
      await docker([
        "create",
        "--name",
        name,
        "--label",
        `${disposableLabel}=test-database`,
        "--label",
        `${lockLabel}=${lockDirectory}`,
        "--publish",
        "127.0.0.1::5432",
        "--tmpfs",
        "/var/lib/postgresql",
        "--env",
        `POSTGRES_USER=${credentials.user}`,
        "--env",
        `POSTGRES_PASSWORD=${credentials.password}`,
        "--env",
        `POSTGRES_DB=${credentials.database}`,
        image,
        ...serverSettings.flatMap((setting) => ["-c", setting]),
      ]);
      await docker(["start", name]);
      return postgresConnection(name, signal);
    },
    remove: (signal, confirmed) =>
      removeOwnedContainer(name, lockDirectory, "test-database", signal, confirmed),
  };
}

export async function removeOwnedContainer(
  name: string,
  lockDirectory: string,
  kind: "test-database" | "test-web",
  signal: AbortSignal,
  creationConfirmed: boolean,
): Promise<void> {
  if (!ownedContainerName.test(name)) {
    throw new Error(`Refusing to remove an unrecognized disposable container: ${name}`);
  }
  await clientsFinished(name, signal);
  await removeIfPresent(name, lockDirectory, kind, signal);
  if (creationConfirmed) {
    return;
  }

  for (let quietSince = Date.now(); Date.now() - quietSince < absenceQuietMs;) {
    await delay(absencePollMs, undefined, { signal });
    if (await removeIfPresent(name, lockDirectory, kind, signal)) {
      quietSince = Date.now();
    }
  }
}

export async function postgresConnection(name: string, signal: AbortSignal): Promise<URL> {
  const published = await docker(["port", name, "5432/tcp"], signal);
  const port = /^127\.0\.0\.1:(\d+)$/mu.exec(published)?.[1];
  if (port === undefined) {
    throw new Error(`${name} published no loopback port: ${published}`);
  }
  const url = new URL(
    `postgres://${credentials.user}:${credentials.password}@127.0.0.1:${port}/${credentials.database}`,
  );
  await waitUntilReady(url, signal);
  return url;
}

export async function testContainers(
  signal: AbortSignal,
  kind: "test-database" | "test-web" = "test-database",
): Promise<ReadonlyArray<{ readonly name: string; readonly lockDirectory: string }>> {
  const ids = (
    await docker(["ps", "--all", "--quiet", "--filter", `label=${disposableLabel}=${kind}`], signal)
  )
    .split("\n")
    .filter(Boolean);

  const containers = (
    await Promise.all(
      ids.map(async (id) => {
        try {
          return Schema.decodeUnknownSync(InspectedContainers)(
            await docker(["container", "inspect", id], signal),
          );
        } catch (error) {
          if (error instanceof Error && /No such (container|object)/u.test(error.message)) {
            return [];
          }
          throw error;
        }
      }),
    )
  ).flat();
  return containers.flatMap((container) => {
    const name = container.Name.replace(/^\//u, "");
    const lockDirectory = container.Config.Labels?.[lockLabel];
    return ownedContainerName.test(name) && lockDirectory !== undefined && lockDirectory !== ""
      ? [{ name, lockDirectory }]
      : [];
  });
}

async function removeIfPresent(
  name: string,
  lockDirectory: string,
  kind: "test-database" | "test-web",
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const [container] = Schema.decodeSync(InspectedContainers)(
      await docker(["container", "inspect", name], signal),
    );
    if (
      container?.Config.Labels?.[disposableLabel] !== kind ||
      container.Config.Labels[lockLabel] !== lockDirectory
    ) {
      throw new Error(`Refusing removal: ${name} has different ownership labels`);
    }
    const removed = await docker(["rm", "--force", "--volumes", name], signal);
    return removed === name;
  } catch (error) {
    if (error instanceof Error && /No such (container|object)/u.test(error.message)) {
      return false;
    }
    throw error;
  }
}

async function clientsFinished(name: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    const { stdout } = await run("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8", signal });
    const clients = stdout
      .split("\n")
      .filter((line) => line.includes(name) && /\bdocker\b/u.test(line))
      .filter((line) => Number(line.trim().split(/\s+/u)[0]) !== process.pid);
    if (clients.length === 0) {
      return;
    }
    await delay(absencePollMs, undefined, { signal });
  }
}

export function containerNameFor(runId: string): string {
  return `lineupkeep-test-${runId.replaceAll("-", "")}`;
}

export async function waitUntilReady(url: URL, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + readyMs;
  for (;;) {
    signal.throwIfAborted();
    const sql = postgres(url.href, { max: 1, connect_timeout: 2, onnotice: () => undefined });
    try {
      await sql`create extension if not exists pg_stat_statements`;
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`The test database did not become ready within ${readyMs} ms.`, {
          cause: error,
        });
      }
    } finally {
      await sql.end({ timeout: 1 });
    }
    await delay(200, undefined, { signal });
  }
}

export async function docker(
  arguments_: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const { stdout } = await run("docker", arguments_, {
      encoding: "utf8",
      ...(signal === undefined ? { timeout: dockerCommandMs } : { signal }),
    });
    return stdout.trim();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Docker is required for the disposable test database; install and start it.");
    }
    const stderr =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new Error(`docker ${arguments_[0] ?? ""} failed: ${stderr}`, { cause: error });
  }
}

const run = promisify(execFile);

export const image = "postgres:18-alpine";

const credentials = {
  user: "lineupkeep",
  password: "lineupkeep_test_only",
  database: "lineupkeep_test",
};

export const serverSettings = [
  "shared_preload_libraries=pg_stat_statements,auto_explain",
  "pg_stat_statements.track=all",
  "auto_explain.log_min_duration=0",
  "auto_explain.log_analyze=on",
  "auto_explain.log_timing=off",
  "auto_explain.log_buffers=on",
  "auto_explain.log_format=json",
  "logging_collector=on",
  "log_destination=jsonlog",
  "log_rotation_age=0",
  "log_rotation_size=0",
];

const ownedContainerName =
  /^(?:lineupkeep-test-[0-9a-f]{32}(?:-web)?|lineupkeep-alchemy-[a-z0-9-]+)$/u;
const InspectedContainers = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      Name: Schema.String,
      Config: Schema.Struct({
        Labels: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
      }),
    }),
  ),
);
const disposableLabel = "lineupkeep.disposable";
const lockLabel = "lineupkeep.lock";

const absenceQuietMs = 2000;
const absencePollMs = 250;

const readyMs = 60_000;

const dockerCommandMs = 60_000;

export type DisposableDatabase = {
  readonly name: string;
  readonly create: (signal: AbortSignal) => Promise<URL>;
  readonly remove: (signal: AbortSignal, creationConfirmed: boolean) => Promise<void>;
};
