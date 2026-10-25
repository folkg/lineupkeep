import { execFileSync } from "node:child_process";
import { readFile, mkdir, mkdtempDisposable, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findTableOwnershipConflicts } from "@lineupkeep/backend/scripts/tableOwnership.ts";
import { Schema } from "effect";
import { expect, it } from "vitest";

import dependencyConfiguration from "#repo/.dependency-cruiser.ts";
import lintConfiguration from "#repo/oxlint.config.ts";

import {
  checkUnusedExports,
  checkMigrationDiscovery,
  checkTableOwnership,
} from "./architectureFixture.ts";
it.each([false, true])(
  "permits consumed backend exports with production=%s",
  async (production) => {
    const result = await checkUnusedExports(consumedBackendFixture, production);

    expect(result.status, result.output).toBe(0);
  },
);

it.each([false, true])(
  "keeps unused backend exports visible with production=%s",
  async (production) => {
    const result = await checkUnusedExports(
      {
        ...consumedBackendFixture,
        "packages/backend/src/contexts/calendar/internal/CalendarRepository.ts":
          "export const forgotten = 1;",
      },
      production,
    );

    expect(result.status, result.output).toBeGreaterThan(0);
    expect(result.output).toContain("forgotten");
  },
);

it("discovers only owned table modules for migrations in an unlisted domain", async () => {
  const files = {
    "packages/backend/src/contexts/calendar/internal/AppointmentTable.ts":
      "export const value = 1;",
    "packages/backend/src/contexts/calendar/internal/nested/CalendarTables.ts":
      "export const value = 1;",
    "packages/backend/src/contexts/calendar/internal/AppointmentTable.test.ts":
      "export const value = 1;",
    "packages/backend/src/contexts/calendar/internal/CalendarRepository.ts":
      "export const value = 1;",
    "packages/backend/src/contexts/calendar/CalendarTable.ts": "export const value = 1;",
  };

  const result = await checkMigrationDiscovery(files);

  expect(result.status, result.output).toBe(0);
  expect(JSON.parse(result.output)).toEqual([
    "packages/backend/src/contexts/calendar/internal/AppointmentTable.ts",
    "packages/backend/src/contexts/calendar/internal/nested/CalendarTables.ts",
  ]);
});

it("discovers duplicate table declarations through the architecture command", async () => {
  const files = {
    "packages/backend/src/contexts/auth/internal/AuthTables.ts":
      'import { pgTable, text } from "drizzle-orm/pg-core"; export const user = pgTable("user", { id: text().primaryKey() });',
    "packages/backend/src/contexts/workspaces/internal/UserTable.ts":
      'import { pgTable as table, text } from "drizzle-orm/pg-core"; export const user = table("user", { id: text().primaryKey() });',
  };

  const result = await checkTableOwnership(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("Table public.user is owned by auth, workspaces");
  expect(result.output).toContain("internal Table/Tables module");
  expect(result.output).toContain("public service elsewhere");
});

it("permits repeated definitions within one owner and distinct physical schemas", () => {
  const declarations = [
    { owner: "auth", name: "public.user" },
    { owner: "auth", name: "public.user" },
    { owner: "workspaces", name: "workspaces.user" },
  ];

  const conflicts = findTableOwnershipConflicts(declarations);

  expect(conflicts).toEqual([]);
});

it("keeps a concrete remedy in every dependency rule's diagnostic contract", () => {
  const configuration = Schema.decodeUnknownSync(
    Schema.Struct({
      forbidden: Schema.Array(Schema.Struct({ name: Schema.String, comment: Schema.String })),
    }),
  )(dependencyConfiguration);

  expect(configuration.forbidden.length).toBeGreaterThan(0);
  expect(new Set(configuration.forbidden.map((rule) => rule.name)).size).toBe(
    configuration.forbidden.length,
  );
  for (const rule of configuration.forbidden) {
    expect(rule.name.trim()).not.toBe("");
    expectRemedy(rule.comment);
  }
});

it("keeps remedies in configured lint diagnostics, including override messages", () => {
  const messages = Object.values(configuredMessages(lintConfiguration));

  expect(messages.length).toBeGreaterThan(0);
  for (const message of messages) {
    expectRemedy(message);
  }
});

it("keeps Bun-dispatched Alchemy on its Node branch without inherited credentials", async () => {
  await using temporary = await mkdtempDisposable(join(tmpdir(), "alchemy-node-"));
  const directory = temporary.path;
  const report = join(directory, "runtime.json");
  const hook = join(directory, "probe.mjs");
  await writeFile(
    hook,
    `
    import { registerHooks } from "node:module";
    import { writeFileSync } from "node:fs";
    registerHooks({ load(url, context, next) {
      if (url.endsWith("/alchemy/bin/register-oxc.js")) {
        writeFileSync(${JSON.stringify(report)}, JSON.stringify({
          runtime: process.release.name,
          version: process.versions.node,
          npmExecpath: process.env.npm_execpath ?? null,
          bun: typeof globalThis.Bun,
          cloudCredential: process.env.AWS_ACCESS_KEY_ID ?? null,
        }));
      }
      return next(url, context);
    }});
  `,
  );

  execFileSync("bun", ["--filter", "@lineupkeep/infra", "plan", "--help"], {
    cwd: new URL("../", import.meta.url),
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      TMPDIR: process.env["TMPDIR"],
      NODE_OPTIONS: `--import=${hook}`,
    },
    encoding: "utf8",
    timeout: 30_000,
    stdio: "pipe",
  });
  const observed: unknown = JSON.parse(await readFile(report, "utf8"));

  expect(observed).toEqual({
    runtime: "node",
    version: process.versions.node,
    npmExecpath: null,
    bun: "undefined",
    cloudCredential: null,
  });
}, 30_000);

it("includes root tooling and scratch scenarios without generated TypeScript", async () => {
  await using temporary = await mkdtempDisposable(join(tmpdir(), "tooling-membership-"));
  const directory = temporary.path;
  const expected = [
    "knip.ts",
    "vitest.config.ts",
    "apps/web/src/server.ts",
    "packages/backend/src/example.ts",
    "infra/example.ts",
    "scripts/example.ts",
    "tools/example.ts",
    "e2e/scratch/example.ts",
  ];
  const generated = [
    "apps/web/dist/generated.ts",
    "apps/web/.output/generated.ts",
    "infra/.alchemy/generated.ts",
    "packages/backend/node_modules/generated.ts",
  ];
  await writeFile(
    join(directory, "tsconfig.json"),
    await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"),
  );
  for (const path of [...expected, ...generated]) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), "export {};");
  }

  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
      "--showConfig",
      "--project",
      join(directory, "tsconfig.json"),
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  const config = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({
        files: Schema.Array(Schema.String),
      }),
    ),
  )(output);

  expect(config.files).toEqual(expect.arrayContaining(expected.map((path) => `./${path}`)));
  for (const path of generated) {
    expect(config.files).not.toContain(`./${path}`);
  }
});

const consumedBackendFixture = {
  "package.json": JSON.stringify({
    private: true,
    type: "module",
    workspaces: ["packages/*", "apps/*"],
  }),
  "apps/web/src/server/targets/node.ts":
    'import { used } from "@lineupkeep/backend/calendar/Calendar"; console.log(used);',
  "packages/backend/src/contexts/calendar/Calendar.ts":
    'export { used } from "#contexts/calendar/internal/calendarValue.ts";',
  "packages/backend/src/contexts/calendar/internal/calendarValue.ts": "export const used = 1;",
};

function expectRemedy(message: string): void {
  expect(message.trim().length).toBeGreaterThan(30);
  expect(message).toMatch(
    /; .*(?:use|keep|pass|call|compose|import|declare|define|delegate|move|receive|depend|register|read|write|yield|expose|send|start|build|fix|extract|encode|put|invoke|wait)/iu,
  );
}

function configuredMessages(value: unknown, path = ""): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const location = path === "" ? key : `${path}.${key}`;
      if (key === "message") {
        expect(typeof entry, location).toBe("string");
        return typeof entry === "string" ? [[location, entry]] : [];
      }
      return Object.entries(configuredMessages(entry, location));
    }),
  );
}
