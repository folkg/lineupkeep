import { mkdtempDisposable, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { assertDeployableComposition, assertClientModules } from "./verifyComposition.ts";
it("rejects a server bundle containing the E2E runtime composition", async () => {
  await using temporary = await mkdtempDisposable(join(tmpdir(), "lineupkeep-composition-"));
  const directory = temporary.path;
  await mkdir(join(directory, "chunks"));
  await writeFile(
    join(directory, "chunks", "runtime.mjs"),
    'throw new Error("E2E_TEST_COMPOSITION_DO_NOT_DEPLOY");',
  );

  await expect(assertDeployableComposition(pathToFileURL(`${directory}/`))).rejects.toThrow(
    "rebuild without E2E_TEST_COMPOSITION, then rerun bun run targets:verify",
  );
});

it("marks the verification route handler as non-deployable", async () => {
  const source = await readFile(new URL("../../../e2e/serviceHandler.ts", import.meta.url), "utf8");

  expect(source).toContain("E2E_TEST_COMPOSITION_DO_NOT_DEPLOY");
});

it("accepts a deployable server bundle", async () => {
  await using temporary = await mkdtempDisposable(join(tmpdir(), "lineupkeep-composition-"));
  const directory = temporary.path;
  await writeFile(join(directory, "server.js"), 'export const application = "production";');

  await expect(
    assertDeployableComposition(pathToFileURL(`${directory}/`)),
  ).resolves.toBeUndefined();
});

it.each([
  "/app/node_modules/effect/dist/Schema.js",
  "/app/node_modules/@effect/platform-node/dist/index.js",
  "/app/packages/backend/src/contexts/inventory/Inventory.ts",
  "/app/packages/backend/src/contexts/inventory/internal/InventoryLimits.ts",
  "/app/apps/web/src/server/inventory.ts",
])("rejects server implementation in a generated client chunk: %s", (id) => {
  expect(() => assertClientModules([id])).toThrow("Keep backend and Effect values inside erased");
});

it("accepts frontend modules and primitive public domain limits", () => {
  expect(() =>
    assertClientModules([
      "/app/apps/web/src/browser/inventory/input.ts",
      "/app/packages/backend/src/contexts/inventory/InventoryLimits.ts",
      "/app/node_modules/@tanstack/start-client-core/dist/esm/createServerFn.js",
    ]),
  ).not.toThrow();
});
