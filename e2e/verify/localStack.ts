import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  LocalDestroySchema,
  LocalEndpointsSchema,
  LocalRunSchema,
} from "@sourdough/tools/local-stack/contract.ts";
import type { LocalRun } from "@sourdough/tools/local-stack/contract.ts";
import {
  postgresContainer,
  removeOwnedContainer,
} from "@sourdough/tools/local-stack/postgresContainer.ts";
import { Schema } from "effect";

import type { OwnedInfrastructure } from "./lifecycle.ts";

export function localStack(name: string, lockDirectory: string): OwnedInfrastructure {
  let child: ChildProcess | undefined;
  let exited: Promise<void> | undefined;
  return {
    name,
    create: async (signal, adopt) => {
      const run = await journaledRun(lockDirectory);
      const log = await open(join(run.directory, "alchemy.log"), "a");
      child = spawn(process.execPath, ["infra/local/driver.ts", manifest(run.directory)], {
        cwd: run.cwd,
        env: driverEnvironment(),
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      });
      exited = new Promise<void>((resolve, reject) => {
        child?.once("error", reject);
        child?.once("exit", () => resolve());
      });
      void exited.then(
        () => log.close(),
        () => log.close(),
      );
      if (child.pid !== undefined) {
        adopt(child.pid);
      }

      for (;;) {
        signal.throwIfAborted();
        if (hasExited(child)) {
          throw new Error("Alchemy startup failed; see alchemy.log");
        }
        const content = await readFile(join(run.directory, "endpoints.json"), "utf8").catch(
          (error: unknown) => {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
              return undefined;
            }
            throw error;
          },
        );
        if (content !== undefined) {
          const endpoints = Schema.decodeSync(Schema.fromJsonString(LocalEndpointsSchema))(content);
          return {
            database: new URL(endpoints.database),
            ports: {
              app: Number(new URL(endpoints.application).port),
              email: Number(new URL(endpoints.email).port),
              traces: Number(new URL(endpoints.traces).port),
              ...(endpoints.inspector === undefined
                ? {}
                : { inspector: Number(new URL(endpoints.inspector).port) }),
            },
            ...(endpoints.inspector === undefined ? {} : { inspector: endpoints.inspector }),
          };
        }
        await delay(100, undefined, { signal });
      }
    },
    remove: async (signal) => {
      const run = await journaledRun(lockDirectory);
      if (run.databaseName !== name) {
        throw new Error("Journaled resource name does not match recovery");
      }
      if (child !== undefined && exited !== undefined && child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([exited, delay(20_000, undefined, { signal })]);
        if (!hasExited(child)) {
          child.kill("SIGKILL");
          await exited;
        }
      }
      const outcome = join(run.directory, "alchemy-destroy.json");
      await rm(outcome, { force: true });
      const log = await open(join(run.directory, "alchemy-destroy.log"), "a");
      const destroy = spawn(
        process.execPath,
        ["infra/local/driver.ts", manifest(run.directory), "--destroy"],
        {
          cwd: run.cwd,
          env: driverEnvironment(),
          stdio: ["ignore", log.fd, log.fd],
          signal,
          killSignal: "SIGKILL",
        },
      );
      let failure: unknown;
      try {
        await new Promise<void>((resolve, reject) => {
          destroy.once("error", reject);
          destroy.once("exit", (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`Alchemy destroy exited ${code}; see alchemy-destroy.log`)),
          );
        });
      } catch (error) {
        failure = error;
      } finally {
        await log.close();
      }

      await removeOwnedContainer(`${name}-web`, lockDirectory, "test-web", signal, false);
      await postgresContainer(name, lockDirectory).remove(signal, false);
      if (failure !== undefined) {
        throw failure;
      }
      const { remainingResources } = Schema.decodeSync(Schema.fromJsonString(LocalDestroySchema))(
        await readFile(outcome, "utf8"),
      );
      if (remainingResources.length > 0) {
        throw new Error(`Alchemy still owns resources: ${remainingResources.join(", ")}`);
      }
    },
  };
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function journaledRun(lockDirectory: string): Promise<LocalRun> {
  const owner = Schema.decodeSync(
    Schema.fromJsonString(Schema.Struct({ directory: Schema.String })),
  )(await readFile(join(lockDirectory, "owner.json"), "utf8"));
  return Schema.decodeSync(Schema.fromJsonString(LocalRunSchema))(
    await readFile(manifest(owner.directory), "utf8"),
  );
}

export function manifest(directory: string): string {
  return join(directory, "alchemy-run.json");
}

function driverEnvironment(): Record<string, string | undefined> {
  return {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    TMPDIR: process.env["TMPDIR"],
    NODE_ENV: "production",
  };
}
