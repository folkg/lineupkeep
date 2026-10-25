import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  containerNameFor,
  postgresContainer,
  testContainers,
} from "@sourdough/tools/local-stack/postgresContainer.ts";
import { Schema } from "effect";
import { assert, expect, it, vi } from "vitest";

import {
  isOrphaned,
  LockHeld,
  recoverVerification,
  runVerification,
  type OwnedInfrastructure,
  type Stack,
  type VerificationCommand,
  type VerificationPlan,
} from "#e2e/verify/lifecycle.ts";

vi.setConfig({ testTimeout: 30_000 });

it("drops the database and releases the lock after a command fails", async () => {
  await using fixture = await lifecycleFixture();

  const outcome = await runVerification(await fixture.plan([fixture.script("process.exit(3)")]));

  expect(outcome.status).toBe("failed");
  expect(outcome.cleanupComplete).toBe(true);
  expect(fixture.database.exists).toBe(false);
  const next = await runVerification(await fixture.plan([fixture.script("")]));
  expect(next.status).toBe("completed");
});

it("stops a command that ignores interruption, then cleans up", async () => {
  await using fixture = await lifecycleFixture();
  const pidFile = join(fixture.folder, "stubborn.pid");
  const interruption = new AbortController();
  const stubborn = fixture.script(`
    process.on("SIGINT", () => {});
    require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    setInterval(() => {}, 1000);
  `);

  const running = runVerification(await fixture.plan([stubborn], interruption.signal));
  await expect.poll(() => existsSync(pidFile)).toBe(true);
  interruption.abort(new Error("Operator interrupted"));
  const outcome = await running;

  expect(outcome.status).toBe("interrupted");
  expect(outcome.failure).toContain("Operator interrupted");
  expect(outcome.cleanupComplete).toBe(true);
  expect(fixture.database.exists).toBe(false);
  expect(isRunning(Number(await readFile(pidFile, "utf8")))).toBe(false);
});

it("stops descendants that detached from the command's process group", async () => {
  await using fixture = await lifecycleFixture();
  const pidFile = join(fixture.folder, "server.pid");

  const outcome = await runVerification(
    await fixture.plan([fixture.detachedServer(pidFile, 1500)]),
  );

  expect(outcome.status).toBe("completed");
  expect(outcome.cleanupComplete).toBe(true);
  expect(isRunning(Number(await readFile(pidFile, "utf8")))).toBe(false);
});

it("attempts every release when one fails and keeps the lock for recovery", async () => {
  await using fixture = await lifecycleFixture();
  fixture.database.failRemove = true;
  const pidFile = join(fixture.folder, "server.pid");

  const outcome = await runVerification(
    await fixture.plan([fixture.detachedServer(pidFile, 1500)]),
  );

  expect(outcome.cleanupComplete).toBe(false);
  expect(outcome.lock).toBe("retained");
  expect(outcome.steps).toContainEqual(expect.objectContaining({ status: "failed" }));
  expect(isRunning(Number(await readFile(pidFile, "utf8")))).toBe(false);
  await expect(runVerification(await fixture.plan([fixture.script("")]))).rejects.toThrow(LockHeld);
});

it("reports a missing executable as a failed run and still cleans up", async () => {
  await using fixture = await lifecycleFixture();
  const missing = { ...fixture.script(""), executable: join(fixture.folder, "no-such-tool") };

  const outcome = await runVerification(await fixture.plan([missing]));

  expect(outcome.status).toBe("failed");
  expect(outcome.failure).toContain("ENOENT");
  expect(outcome.cleanupComplete).toBe(true);
  expect(fixture.database.exists).toBe(false);
});

it("stops a run that exceeds its deadline and still cleans up", async () => {
  await using fixture = await lifecycleFixture();
  const hanging = fixture.script("setInterval(() => {}, 1000)");

  const outcome = await runVerification(await fixture.plan([hanging], AbortSignal.timeout(500)));

  expect(outcome.status).toBe("interrupted");
  expect(outcome.failure).toContain("timeout");
  expect(outcome.cleanupComplete).toBe(true);
  expect(fixture.database.exists).toBe(false);
});

it("cleans up when a command's log cannot be created", async () => {
  await using fixture = await lifecycleFixture();
  const plan = await fixture.plan([fixture.script("")]);
  await mkdir(join(plan.directory, "command.log"));

  const outcome = await runVerification(plan);

  expect(outcome.status).toBe("failed");
  expect(outcome.cleanupComplete).toBe(true);
  expect(fixture.database.exists).toBe(false);
});

it("releases the lock when only the cleanup report cannot be written", async () => {
  await using fixture = await lifecycleFixture();
  const plan = await fixture.plan([fixture.script("")]);
  await mkdir(join(plan.directory, "cleanup.json"));

  const outcome = await runVerification(plan);

  expect(outcome.cleanupComplete).toBe(true);
  expect(outcome.problems).toEqual([expect.stringContaining("Cleanup report")]);
  const next = await runVerification(await fixture.plan([fixture.script("")]));
  expect(next.status).toBe("completed");
});

it("passes resource-reported endpoints to commands without borrowing occupied ports", async () => {
  await using fixture = await lifecycleFixture();
  await using occupied = await listeningServer();
  const stackFile = join(fixture.folder, "stack.json");
  const plan = {
    ...(await fixture.plan([])),
    infrastructure: {
      ...(await fixture.plan([])).infrastructure,
      create: async () => {
        await using app = await listeningServer();
        await using email = await listeningServer();
        await using traces = await listeningServer();
        return {
          database: new URL("postgres://fixture.invalid/verify_fixture"),
          ports: {
            app: Number(app.url.port),
            email: Number(email.url.port),
            traces: Number(traces.url.port),
          },
        };
      },
    },
    commands: (stack: Stack) => [
      fixture.script(
        `require("node:fs").writeFileSync(${JSON.stringify(stackFile)}, ${JSON.stringify(JSON.stringify({ database: stack.database.href, ports: stack.ports }))})`,
      ),
    ],
  };

  const outcome = await runVerification(plan);

  expect(outcome.status).toBe("completed");
  const stack = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({ database: Schema.String, ports: Schema.Record(Schema.String, Schema.Int) }),
    ),
  )(await readFile(stackFile, "utf8"));
  expect(stack.database).toBe("postgres://fixture.invalid/verify_fixture");
  const ports = Object.values(stack.ports);
  expect(Object.keys(stack.ports)).toEqual(["app", "email", "traces"]);
  expect(new Set(ports).size).toBe(3);
  expect(ports).not.toContain(Number(occupied.url.port));
  expect(occupied.listening()).toBe(true);
});

it("recovers an abandoned run's resources before starting", async () => {
  await using fixture = await lifecycleFixture();
  const pidFile = join(fixture.folder, "server.pid");
  const databaseFile = join(fixture.folder, "database");
  await using owner = await fixture.killableOwner({
    pidFile,
    databaseFile,
    command: "detached-server",
  });
  owner.kill();
  await owner.exited;

  const outcome = await runVerification({
    ...(await fixture.plan([fixture.script("")])),
    infrastructureNamed: (name) => fileDatabase(name, databaseFile),
  });

  expect(outcome.recoveredRun).toBe("owned");
  expect(outcome.status).toBe("completed");
  expect(isRunning(Number(await readFile(pidFile, "utf8")))).toBe(false);
  expect(existsSync(databaseFile)).toBe(false);
});

it("refuses to start or recover while the lock's owner is still running", async () => {
  await using fixture = await lifecycleFixture();
  const pidFile = join(fixture.folder, "server.pid");
  const databaseFile = join(fixture.folder, "database");
  await using owner = await fixture.killableOwner({
    pidFile,
    databaseFile,
    command: "detached-server",
  });
  const lock = join(fixture.folder, ".lock");

  const refused = runVerification(await fixture.plan([fixture.script("")]));
  const recovery = await recoverVerification(lock, (name) => fileDatabase(name, databaseFile), 300);

  await expect(refused).rejects.toMatchObject({ inProgress: true });
  expect(recovery.status).toBe("owner-running");
  expect(isRunning(Number(await readFile(pidFile, "utf8")))).toBe(true);
  expect(existsSync(databaseFile)).toBe(true);
  owner.kill();
  await owner.exited;
  const recovered = await recoverVerification(
    lock,
    (name) => fileDatabase(name, databaseFile),
    300,
  );
  expect(recovered.status).toBe("recovered");
});

it("kills owned processes at once after a second interruption", async () => {
  await using fixture = await lifecycleFixture();
  const pidFile = join(fixture.folder, "stubborn.pid");
  const interruption = new AbortController();
  const urgency = new AbortController();
  const stubborn = fixture.script(`
    process.on("SIGINT", () => {});
    require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    setInterval(() => {}, 1000);
  `);
  const plan = {
    ...(await fixture.plan([stubborn], interruption.signal)),
    urgent: urgency.signal,
    shutdownMs: 60_000,
  };

  const started = Date.now();
  const running = runVerification(plan);
  await expect.poll(() => existsSync(pidFile)).toBe(true);
  interruption.abort(new Error("Operator interrupted"));
  urgency.abort();
  const outcome = await running;

  expect(outcome.status).toBe("interrupted");
  expect(outcome.cleanupComplete).toBe(true);
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(isRunning(Number(await readFile(pidFile, "utf8")))).toBe(false);
});

it("journals a command with no descendants, so recovery can stop it", async () => {
  await using fixture = await lifecycleFixture();
  const pidFile = join(fixture.folder, "command.pid");
  const databaseFile = join(fixture.folder, "database");
  await using owner = await fixture.killableOwner({ pidFile, databaseFile, command: "childless" });
  owner.kill();
  await owner.exited;

  const outcome = await recoverVerification(
    join(fixture.folder, ".lock"),
    (name) => fileDatabase(name, databaseFile),
    300,
  );

  expect(outcome.status).toBe("recovered");
  expect(isRunning(Number(await readFile(pidFile, "utf8")))).toBe(false);
});

it("removes a partly created database when recovering a run killed during its creation", async () => {
  await using fixture = await lifecycleFixture();
  const databaseFile = join(fixture.folder, "database");
  await using owner = await fixture.killableOwner({
    pidFile: join(fixture.folder, "unused.pid"),
    databaseFile,
    command: "childless",
    createHangs: true,
  });
  owner.kill();
  await owner.exited;

  const outcome = await recoverVerification(
    join(fixture.folder, ".lock"),
    (name) => fileDatabase(name, databaseFile),
    300,
  );

  expect(outcome.status).toBe("recovered");
  expect(existsSync(databaseFile)).toBe(false);
});

it("removes a database whose creation failed partway, and releases the lock", async () => {
  await using fixture = await lifecycleFixture();
  fixture.database.create = "partly-then-fail";

  const outcome = await runVerification(await fixture.plan([fixture.script("")]));

  expect(outcome.status).toBe("failed");
  expect(outcome.cleanupComplete).toBe(true);
  expect(outcome.lock).toBe("released");
  expect(fixture.database.exists).toBe(false);
});

it("stops a run whose database creation exceeds its deadline", async () => {
  await using fixture = await lifecycleFixture();
  fixture.database.create = "hang";

  const outcome = await runVerification(
    await fixture.plan([fixture.script("")], AbortSignal.timeout(300)),
  );

  expect(outcome.status).toBe("interrupted");
  expect(outcome.cleanupComplete).toBe(true);
  expect(fixture.database.exists).toBe(false);
});

it("lets only one recovery act on an abandoned lock at a time", async () => {
  await using fixture = await lifecycleFixture();
  const pidFile = join(fixture.folder, "server.pid");
  const databaseFile = join(fixture.folder, "database");
  await using owner = await fixture.killableOwner({
    pidFile,
    databaseFile,
    command: "detached-server",
  });
  owner.kill();
  await owner.exited;
  const lock = join(fixture.folder, ".lock");
  const gate = Promise.withResolvers<void>();
  const first = recoverVerification(
    lock,
    (name) => fileDatabase(name, databaseFile, gate.promise),
    300,
  );
  await expect.poll(() => existsSync(join(lock, "recovery-1"))).toBe(true);

  const second = await recoverVerification(lock, (name) => fileDatabase(name, databaseFile), 300);
  gate.resolve();

  expect(second.status).toBe("recovery-in-progress");
  expect((await first).status).toBe("recovered");
  expect(existsSync(lock)).toBe(false);
});

it("stops a descendant that a process spawns while being stopped", async () => {
  await using fixture = await lifecycleFixture();
  const latePidFile = join(fixture.folder, "late.pid");
  const spawnsOnTerm = fixture.script(`
    const { spawn } = require("node:child_process");
    const server = spawn(process.execPath, ["-e", ${JSON.stringify(`
      process.on("SIGTERM", () => {
        const late = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
        require("node:fs").writeFileSync(${JSON.stringify(latePidFile)}, String(late.pid));
        late.unref();
        setTimeout(() => process.exit(0), 300);
      });
      setInterval(() => {}, 1000);
    `)}], { detached: true, stdio: "ignore" });
    server.unref();
    setTimeout(() => {}, 1000);
  `);

  const outcome = await runVerification(await fixture.plan([spawnsOnTerm]));

  expect(outcome.cleanupComplete).toBe(true);
  expect(isRunning(Number(await readFile(latePidFile, "utf8")))).toBe(false);
});

it("leaves a lock alone when it was recovered and retaken while a late recovery waited", async () => {
  await using fixture = await lifecycleFixture();
  const lock = join(fixture.folder, ".lock");
  const databaseFile = join(fixture.folder, "database");
  await using owner = await fixture.killableOwner({
    pidFile: join(fixture.folder, "server.pid"),
    databaseFile,
    command: "detached-server",
  });
  owner.kill();
  await owner.exited;
  await using late = await fixture.pausedRecovery(databaseFile);
  await recoverVerification(lock, (name) => fileDatabase(name, databaseFile), 300);
  const livePid = join(fixture.folder, "live.pid");
  const live = runVerification(
    await fixture.plan([
      fixture.script(
        `require("node:fs").writeFileSync(${JSON.stringify(livePid)}, "1"); setTimeout(() => {}, 1500);`,
      ),
    ]),
  );
  await expect.poll(() => existsSync(livePid)).toBe(true);

  const status = await late.resume();

  expect(status).toBe("lock-changed");
  expect(existsSync(join(lock, "owner.json"))).toBe(true);
  expect((await live).lock).toBe("released");
});

it("stops before starting a command when interrupted while its log opens", async () => {
  await using fixture = await lifecycleFixture();
  const interruption = new AbortController();
  const startedFile = join(fixture.folder, "started");
  using _announce = vi.spyOn(console, "log").mockImplementation((message: unknown) => {
    if (message === "Application verification: command") {
      interruption.abort(new Error("Operator interrupted"));
    }
  });
  const plan = await fixture.plan(
    [
      fixture.script(
        `require("node:fs").writeFileSync(${JSON.stringify(startedFile)}, "1"); setInterval(() => {}, 1000);`,
      ),
    ],
    interruption.signal,
  );

  const outcome = await runVerification(plan);

  expect(outcome.status).toBe("interrupted");
  expect(existsSync(startedFile)).toBe(false);
  expect(outcome.cleanupComplete).toBe(true);
});

it("removes a created database even when its journal cannot be updated", async () => {
  await using fixture = await lifecycleFixture();
  const plan = await fixture.plan([fixture.script("")]);
  const create = plan.infrastructure.create;
  const brokenJournal = {
    ...plan,
    infrastructure: {
      ...plan.infrastructure,
      create: async (signal: AbortSignal) => {
        const url = await create(signal, () => {});

        await mkdir(join(plan.lockDirectory, "owner.json.tmp"));
        return url;
      },
    },
  };

  const outcome = await runVerification(brokenJournal);

  expect(outcome.status).toBe("failed");
  expect(fixture.database.exists).toBe(false);
});

it("recovers past a claim left by a recovery that died", async () => {
  await using fixture = await lifecycleFixture();
  const lock = join(fixture.folder, ".lock");
  const databaseFile = join(fixture.folder, "database");
  await using owner = await fixture.killableOwner({
    pidFile: join(fixture.folder, "server.pid"),
    databaseFile,
    command: "detached-server",
  });
  owner.kill();
  await owner.exited;

  const deadHolder = Schema.decodeSync(
    Schema.fromJsonString(Schema.Struct({ owner: Schema.Unknown })),
  )(await readFile(join(lock, "owner.json"), "utf8")).owner;
  await mkdir(join(lock, "recovery-1"));
  await writeFile(join(lock, "recovery-1", "holder.json"), JSON.stringify(deadHolder));

  const outcome = await recoverVerification(lock, (name) => fileDatabase(name, databaseFile), 300);

  expect(outcome.status).toBe("recovered");
  expect(existsSync(lock)).toBe(false);
});

it("ignores an unpublished claim left by a recovery that died while claiming", async () => {
  await using fixture = await lifecycleFixture();
  const lock = join(fixture.folder, ".lock");
  const databaseFile = join(fixture.folder, "database");
  await using owner = await fixture.killableOwner({
    pidFile: join(fixture.folder, "server.pid"),
    databaseFile,
    command: "detached-server",
  });
  owner.kill();
  await owner.exited;
  await mkdir(join(lock, "staging-12345-1"));

  const outcome = await recoverVerification(lock, (name) => fileDatabase(name, databaseFile), 300);

  expect(outcome.status).toBe("recovered");
});

it("reports a claim without a readable holder as damaged rather than recovering past it", async () => {
  await using fixture = await lifecycleFixture();
  const lock = join(fixture.folder, ".lock");
  const databaseFile = join(fixture.folder, "database");
  await using owner = await fixture.killableOwner({
    pidFile: join(fixture.folder, "server.pid"),
    databaseFile,
    command: "detached-server",
  });
  owner.kill();
  await owner.exited;
  await mkdir(join(lock, "recovery-1"));

  const outcome = await recoverVerification(lock, (name) => fileDatabase(name, databaseFile), 300);

  expect(outcome.status).toBe("damaged-recovery-claim");
  expect(existsSync(databaseFile)).toBe(true);
  await rm(join(lock, "recovery-1"), { recursive: true });
  expect(
    (await recoverVerification(lock, (name) => fileDatabase(name, databaseFile), 300)).status,
  ).toBe("recovered");
});

it("acquires nothing, not even an abandoned lock, when cancelled before it starts", async () => {
  await using fixture = await lifecycleFixture();
  const cancelled = new AbortController();
  cancelled.abort(new Error("Operator interrupted"));

  const run = runVerification(await fixture.plan([fixture.script("")], cancelled.signal));

  await expect(run).rejects.toThrow("Operator interrupted");
  expect(fixture.database.creations).toBe(0);
  expect(existsSync(join(fixture.folder, ".lock"))).toBe(false);
});

it("manages only containers named for a run", () => {
  const runId = randomUUID();

  const owned = postgresContainer(containerNameFor(runId), "/lock");

  expect(owned.name).toBe(`sourdough-test-${runId.replaceAll("-", "")}`);
  expect(() => postgresContainer("sourdough-postgres", "/lock")).toThrow("Refusing to manage");
});

it("removes a container that an orphaned Docker client finishes creating after its run died", async () => {
  await using docker = await fakeDocker();
  const name = containerNameFor(randomUUID());
  const orphan = spawn(docker.executable, ["create", "--name", name], {
    detached: true,
    stdio: "ignore",
    env: docker.environment,
  });
  orphan.unref();
  await expect.poll(() => docker.calls()).toContain(`create --name ${name}`);

  await postgresContainer(name, "/lock").remove(AbortSignal.timeout(20_000), false);

  expect(existsSync(join(docker.state, name))).toBe(false);
  expect(docker.calls().filter((call) => call.startsWith("rm "))).not.toHaveLength(0);
});

it("refuses removal when a journaled container name has another checkout's ownership label", async () => {
  await using docker = await fakeDocker();
  const name = containerNameFor(randomUUID());
  await docker.presentContainer(name, "/another-checkout/.lock");

  await expect(
    postgresContainer(name, "/lock").remove(AbortSignal.timeout(10_000), true),
  ).rejects.toThrow("ownership");
  expect(existsSync(join(docker.state, name))).toBe(true);
});

it("confirms absence when Docker force-removal succeeds without removing a container", async () => {
  await using docker = await fakeDocker();
  const name = containerNameFor(randomUUID());
  await docker.absentRemovalSucceeds(name);

  await postgresContainer(name, "/lock").remove(AbortSignal.timeout(10_000), false);

  expect(docker.calls()).toContain(`rm --force --volumes ${name}`);
});

it("treats a container as orphaned only when its checkout's lock is gone or another run's", async () => {
  await using fixture = await lifecycleFixture();
  const lock = join(fixture.folder, ".lock");
  const running = runVerification(
    await fixture.plan([fixture.script("setTimeout(() => {}, 1500)")]),
  );
  await expect.poll(() => existsSync(join(lock, "owner.json"))).toBe(true);

  const ownRun = await isOrphaned(lock, "verify_fixture");
  const otherRun = await isOrphaned(lock, "sourdough-test-0123456789abcdef0123456789abcdef");
  await running;
  const afterRelease = await isOrphaned(lock, "verify_fixture");

  expect(ownRun).toBe(false);
  expect(otherRun).toBe(true);
  expect(afterRelease).toBe(true);
});

it("never treats a container as orphaned when its checkout's lock cannot be read", async () => {
  await using fixture = await lifecycleFixture();
  const lock = join(fixture.folder, ".lock");
  await mkdir(lock);
  await writeFile(join(lock, "owner.json"), "{ damaged");

  const orphaned = await isOrphaned(lock, "verify_fixture");

  expect(orphaned).toBe(false);
});

it("lists only disposable test containers that name their checkout's lock, keeping it verbatim", async () => {
  await using docker = await fakeDocker();
  const labelled = containerNameFor(randomUUID());
  const unlabelled = containerNameFor(randomUUID());
  const lock = "/check\tout\nwith delimiters/.artifacts/.lock";
  await docker.listContainers([
    { name: labelled, labels: { "sourdough.lock": lock } },
    { name: unlabelled, labels: {} },
    { name: "sourdough-postgres", labels: { "sourdough.lock": "/elsewhere" } },
  ]);

  const containers = await testContainers(AbortSignal.timeout(10_000));

  expect(containers).toEqual([{ name: labelled, lockDirectory: lock }]);
});

it("skips a listed container that disappears before it is inspected", async () => {
  await using docker = await fakeDocker();
  const vanishing = containerNameFor(randomUUID());
  const remaining = containerNameFor(randomUUID());
  await docker.listContainers([
    { name: vanishing, labels: { "sourdough.lock": "/one/.artifacts/.lock" } },
    { name: remaining, labels: { "sourdough.lock": "/two/.artifacts/.lock" } },
  ]);
  await docker.vanish(0);

  const containers = await testContainers(AbortSignal.timeout(10_000));

  expect(containers).toEqual([{ name: remaining, lockDirectory: "/two/.artifacts/.lock" }]);
});

it("never treats a container as orphaned when its lock exists without a readable owner", async () => {
  await using fixture = await lifecycleFixture();
  const missing = join(fixture.folder, "missing", ".lock");
  const dangling = join(fixture.folder, "dangling", ".lock");
  await mkdir(missing, { recursive: true });
  await mkdir(dangling, { recursive: true });
  await symlink(join(fixture.folder, "nowhere.json"), join(dangling, "owner.json"));

  const orphaned = [
    await isOrphaned(missing, "verify_fixture"),
    await isOrphaned(dangling, "verify_fixture"),
  ];

  expect(orphaned).toEqual([false, false]);
});

async function lifecycleFixture(): Promise<{
  folder: string;
  database: FakeDatabase;
  script: (code: string, name?: string) => VerificationCommand;
  detachedServer: (pidFile: string, lingerMs: number) => VerificationCommand;
  plan: (
    commands: ReadonlyArray<VerificationCommand>,
    signal?: AbortSignal,
  ) => Promise<VerificationPlan>;
  killableOwner: (options: {
    readonly pidFile: string;
    readonly databaseFile: string;
    readonly command: "detached-server" | "childless";
    readonly createHangs?: boolean;
  }) => Promise<{
    kill: () => boolean;
    exited: Promise<unknown>;
    [Symbol.asyncDispose]: () => Promise<void>;
  }>;
  pausedRecovery: (databaseFile: string) => Promise<{
    resume: () => Promise<string>;
    [Symbol.asyncDispose]: () => Promise<void>;
  }>;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  const folder = await mkdtemp(join(tmpdir(), "verification-lifecycle-"));
  const lifecycle = new URL("../e2e/verify/lifecycle.ts", import.meta.url).pathname;
  const database: FakeDatabase = {
    exists: false,
    failRemove: false,
    creations: 0,
    create: "succeed",
  };
  const disposable: OwnedInfrastructure = {
    name: "verify_fixture",
    create: (signal) => {
      database.creations += 1;
      if (database.create === "hang") {
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("Creation was cancelled.")), {
            once: true,
          });
        });
      }
      database.exists = true;
      return database.create === "partly-then-fail"
        ? Promise.reject(new Error("the server did not become ready"))
        : Promise.resolve({
            database: new URL("postgres://fixture.invalid/verify_fixture"),
            ports: {},
          });
    },
    remove: () => {
      if (database.failRemove) {
        return Promise.reject(new Error("Docker is unavailable"));
      }
      database.exists = false;
      return Promise.resolve();
    },
  };
  const script = (code: string, name = "command"): VerificationCommand => ({
    name,
    executable: process.execPath,
    arguments: ["-e", code],
    cwd: folder,
    environment: process.env,
  });
  const detachedServer = (pidFile: string, lingerMs: number): VerificationCommand =>
    script(`
      const { spawn } = require("node:child_process");
      const server = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
      require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(server.pid));
      server.unref();
      setTimeout(() => {}, ${lingerMs});
    `);
  return {
    folder,
    database,
    script,
    detachedServer,
    plan: async (
      commands: ReadonlyArray<VerificationCommand>,
      signal = new AbortController().signal,
    ): Promise<VerificationPlan> => {
      const runId = randomUUID();
      const directory = join(folder, runId);
      await mkdir(directory);
      return {
        runId,
        directory,
        lockDirectory: join(folder, ".lock"),
        infrastructure: disposable,
        commands: () => commands,
        signal,
        urgent: new AbortController().signal,
        shutdownMs: 300,
        infrastructureNamed: (name) => ({ ...disposable, name }),
      };
    },
    killableOwner: async (options: {
      readonly pidFile: string;
      readonly databaseFile: string;
      readonly command: "detached-server" | "childless";
      readonly createHangs?: boolean;
    }) => {
      const path = join(folder, "owner.ts");
      await mkdir(join(folder, "owned"));
      const command =
        options.command === "detached-server"
          ? detachedServer(options.pidFile, 60_000)
          : script(`
              require("node:fs").writeFileSync(${JSON.stringify(options.pidFile)}, String(process.pid));
              setInterval(() => {}, 1000);
            `);
      await writeFile(
        path,
        `
        import { writeFile, rm } from "node:fs/promises";
        import { runVerification } from ${JSON.stringify(lifecycle)};
        const database = (name) => ({
          name,
          create: async () => {
            await writeFile(${JSON.stringify(options.databaseFile)}, name);
            ${options.createHangs === true ? "await new Promise(() => {});" : ""}
            return { database: new URL("postgres://fixture.invalid/" + name), ports: {} };
          },
          remove: () => rm(${JSON.stringify(options.databaseFile)}, { force: true }),
        });
        await runVerification({
          runId: "owned",
          directory: ${JSON.stringify(join(folder, "owned"))},
          lockDirectory: ${JSON.stringify(join(folder, ".lock"))},
          infrastructure: database("verify_owned"),
          infrastructureNamed: database,
          commands: () => [${JSON.stringify(command)}],

          signal: new AbortController().signal,
          urgent: new AbortController().signal,
          shutdownMs: 300,
        });
        `,
      );
      const owner = spawn(process.execPath, [path], { stdio: "ignore" });
      await using resources = new AsyncDisposableStack();
      const exited = new Promise((resolve) => owner.once("exit", resolve));
      resources.defer(async () => {
        owner.kill("SIGKILL");
        await exited;
      });
      if (options.createHangs === true) {
        await expect
          .poll(() => readFile(join(folder, ".lock", "owner.json"), "utf8").catch(() => ""), {
            timeout: 10_000,
          })
          .toContain('"creating"');
      } else {
        await expect.poll(() => existsSync(options.pidFile), { timeout: 10_000 }).toBe(true);

        await delay(500);
      }
      const cleanup = resources.move();
      return {
        kill: () => owner.kill("SIGKILL"),
        exited,
        [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
      };
    },

    pausedRecovery: async (databaseFile: string) => {
      const bin = join(folder, "pausing-bin");
      await mkdir(bin);
      const ps = spawnSync("sh", ["-c", "command -v ps"], { encoding: "utf8" }).stdout.trim();
      await writeFile(join(bin, "pause"), "");
      await writeFile(
        join(bin, "ps"),
        `#!/bin/sh\nif mv "${bin}/pause" "${bin}/paused" 2>/dev/null; then\n  while [ ! -f "${bin}/resume" ]; do sleep 0.05; done\nfi\nexec ${ps} "$@"\n`,
        { mode: 0o755 },
      );
      const path = join(folder, "recover.ts");
      await writeFile(
        path,
        `
        import { rm } from "node:fs/promises";
        import { recoverVerification } from ${JSON.stringify(lifecycle)};
        const database = (name) => ({ name, create: () => Promise.reject(new Error("unused")), remove: () => rm(${JSON.stringify(databaseFile)}, { force: true }) });
        const outcome = await recoverVerification(${JSON.stringify(join(folder, ".lock"))}, database, 300);
        process.stdout.write(outcome.status);
        `,
      );
      const recovery = spawn(process.execPath, [path], {
        env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
        stdio: ["ignore", "pipe", "inherit"],
      });
      await using resources = new AsyncDisposableStack();
      const exited = new Promise((resolve) => recovery.once("exit", resolve));
      resources.defer(async () => {
        recovery.kill("SIGKILL");
        await exited;
      });
      resources.defer(() => writeFile(join(bin, "resume"), ""));
      let output = "";
      recovery.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      await expect.poll(() => existsSync(join(bin, "paused")), { timeout: 10_000 }).toBe(true);
      const cleanup = resources.move();
      return {
        resume: async () => {
          await writeFile(join(bin, "resume"), "");
          await exited;
          return output;
        },
        [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
      };
    },
    [Symbol.asyncDispose]: () => rm(folder, { recursive: true, force: true }),
  };
}

type FakeDatabase = {
  exists: boolean;
  failRemove: boolean;
  creations: number;
  create: "succeed" | "partly-then-fail" | "hang";
};

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listeningServer(): Promise<{
  url: URL;
  listening: () => boolean;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  return {
    url: new URL(`http://127.0.0.1:${address.port}`),
    listening: () => server.listening,
    [Symbol.asyncDispose]: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function fileDatabase(
  name: string,
  path: string,
  removeGate: Promise<void> = Promise.resolve(),
): OwnedInfrastructure {
  return {
    name,
    create: async () => {
      await writeFile(path, name);
      return { database: new URL(`postgres://fixture.invalid/${name}`), ports: {} };
    },
    remove: async () => {
      await removeGate;
      await rm(path, { force: true });
    },
  };
}

async function fakeDocker(): Promise<{
  executable: string;
  state: string;
  listContainers: (
    containers: ReadonlyArray<{
      readonly name: string;
      readonly labels: Readonly<Record<string, string>>;
    }>,
  ) => Promise<void>;
  vanish: (index: number) => Promise<void>;
  presentContainer: (name: string, lock: string) => Promise<void>;
  absentRemovalSucceeds: (name: string) => Promise<void>;
  environment: {
    [key: string]: string | undefined;
  };
  calls: () => string[];
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  await using resources = new AsyncDisposableStack();
  const folder = await mkdtemp(join(tmpdir(), "verification-docker-"));
  resources.defer(() => rm(folder, { recursive: true, force: true }));
  const bin = join(folder, "bin");
  const state = join(folder, "state");
  await mkdir(bin);
  await mkdir(state);
  const executable = join(bin, "docker");
  await writeFile(
    executable,
    `#!/bin/sh
echo "$*" >> "${folder}/calls"
case "$1" in
  create) sleep 1; touch "${state}/$3" ;;
  ps) cat "${folder}/ids" ;;
  container) if [ -f "${folder}/inspect-$3.json" ]; then cat "${folder}/inspect-$3.json"; elif [ -f "${state}/$3" ]; then printf '[{"Name":"/%s","Config":{"Labels":{"sourdough.disposable":"test-database","sourdough.lock":"/lock"}}}]' "$3"; else echo "Error: No such object: $3" >&2; exit 1; fi ;;
  rm) if [ -f "${state}/$4" ]; then rm "${state}/$4"; else echo "Error: No such container: $4" >&2; if [ ! -f "${folder}/absent-success" ]; then exit 1; fi; fi ;;
esac
`,
    { mode: 0o755 },
  );
  const previousPath = process.env["PATH"];
  resources.defer(() => {
    if (previousPath === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = previousPath;
    }
  });
  process.env["PATH"] = `${bin}:${previousPath ?? ""}`;
  const cleanup = resources.move();
  return {
    executable,
    state,
    listContainers: async (
      containers: ReadonlyArray<{
        readonly name: string;
        readonly labels: Readonly<Record<string, string>>;
      }>,
    ) => {
      await writeFile(join(folder, "ids"), containers.map((_, index) => `id${index}`).join("\n"));
      for (const [index, container] of containers.entries()) {
        await writeFile(
          join(folder, `inspect-id${index}.json`),
          JSON.stringify([{ Name: `/${container.name}`, Config: { Labels: container.labels } }]),
        );
      }
    },
    vanish: (index: number) => rm(join(folder, `inspect-id${index}.json`)),
    presentContainer: async (name: string, lock: string) => {
      await writeFile(join(state, name), "");
      await writeFile(
        join(folder, `inspect-${name}.json`),
        JSON.stringify([
          {
            Name: `/${name}`,
            Config: { Labels: { "sourdough.disposable": "test-database", "sourdough.lock": lock } },
          },
        ]),
      );
    },
    absentRemovalSucceeds: async (name: string) => {
      await writeFile(join(folder, "absent-success"), "");
      await writeFile(
        join(folder, `inspect-${name}.json`),
        JSON.stringify([
          {
            Name: `/${name}`,
            Config: {
              Labels: { "sourdough.disposable": "test-database", "sourdough.lock": "/lock" },
            },
          },
        ]),
      );
    },
    environment: { ...process.env },
    calls: () =>
      existsSync(join(folder, "calls"))
        ? readFileSync(join(folder, "calls"), "utf8").trim().split("\n")
        : [],
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}
