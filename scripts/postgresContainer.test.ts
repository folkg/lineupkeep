import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  containerNameFor,
  postgresContainer,
  testContainers,
} from "@lineupkeep/tools/local-stack/postgresContainer.ts";
import { expect, it } from "vitest";

it("manages only containers named for a run", () => {
  const runId = randomUUID();

  const owned = postgresContainer(containerNameFor(runId), "/lock");

  expect(owned.name).toBe(`lineupkeep-test-${runId.replaceAll("-", "")}`);
  expect(() => postgresContainer("lineupkeep-postgres", "/lock")).toThrow("Refusing to manage");
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

it("lists only disposable test containers that name their checkout's lock, keeping it verbatim", async () => {
  await using docker = await fakeDocker();
  const labelled = containerNameFor(randomUUID());
  const unlabelled = containerNameFor(randomUUID());
  const lock = "/check\tout\nwith delimiters/.artifacts/.lock";
  await docker.listContainers([
    { name: labelled, labels: { "lineupkeep.lock": lock } },
    { name: unlabelled, labels: {} },
    { name: "lineupkeep-postgres", labels: { "lineupkeep.lock": "/elsewhere" } },
  ]);

  const containers = await testContainers(AbortSignal.timeout(10_000));

  expect(containers).toEqual([{ name: labelled, lockDirectory: lock }]);
});

it("skips a listed container that disappears before it is inspected", async () => {
  await using docker = await fakeDocker();
  const vanishing = containerNameFor(randomUUID());
  const remaining = containerNameFor(randomUUID());
  await docker.listContainers([
    { name: vanishing, labels: { "lineupkeep.lock": "/one/.artifacts/.lock" } },
    { name: remaining, labels: { "lineupkeep.lock": "/two/.artifacts/.lock" } },
  ]);
  await docker.vanish(0);

  const containers = await testContainers(AbortSignal.timeout(10_000));

  expect(containers).toEqual([{ name: remaining, lockDirectory: "/two/.artifacts/.lock" }]);
});

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
  container) if [ -f "${folder}/inspect-$3.json" ]; then cat "${folder}/inspect-$3.json"; elif [ -f "${state}/$3" ]; then printf '[{"Name":"/%s","Config":{"Labels":{"lineupkeep.disposable":"test-database","lineupkeep.lock":"/lock"}}}]' "$3"; else echo "Error: No such object: $3" >&2; exit 1; fi ;;
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
            Config: {
              Labels: { "lineupkeep.disposable": "test-database", "lineupkeep.lock": lock },
            },
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
              Labels: { "lineupkeep.disposable": "test-database", "lineupkeep.lock": "/lock" },
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
