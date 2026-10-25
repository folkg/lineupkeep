import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it.each(globSync("apps/web/src/server-functions/**/*.ts"))(
  "strips backend and Effect code from the compiled browser module %s",
  (path) => {
    const result = compileClient(path, readFileSync(path, "utf8"));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("createClientRpc");
    expect(result.stdout).not.toMatch(
      /(?:from|import\()[^\n]*(?:effect|@lineupkeep\/backend|#server\/|\/server\/)/u,
    );
    expect(result.stdout).not.toMatch(
      /runUseCase|decodeResult|toStandardSchemaV1|NoteInputInvalid|Notes\.use/u,
    );
  },
);

it("strips a result-valued validator and direct use case for an unregistered domain", () => {
  const result = compileClient(
    "apps/web/src/server-functions/inventory.ts",
    `
    import { createServerFn } from "@tanstack/solid-start";
    import { Schema, Effect } from "effect";
    import { InventoryInput, Inventory } from "@lineupkeep/backend/inventory/Inventory";
    import { runUseCase } from "#server/backendEntry.ts";
    export const reserve = createServerFn({ method: "POST" })
      .validator((raw: typeof InventoryInput.Encoded) => Schema.decodeResult(InventoryInput)(raw))
      .handler(({ data }) => runUseCase(data, "inventory.reserve", (user) => Effect.flatMap(Effect.fromResult(data), (input) => Inventory.use((inventory) => inventory.reserve(user, input))), () => "safe"));
  `,
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("createClientRpc");
  expect(result.stdout).not.toMatch(/Inventory|effect|runUseCase|decodeResult/u);
});

function compileClient(
  path: string,
  source: string,
): import("child_process").SpawnSyncReturns<string> {
  const compilerUrl = new URL(
    "../node_modules/@tanstack/start-plugin-core/dist/esm/start-compiler/host.js",
    import.meta.url,
  ).href;
  const root = fileURLToPath(new URL("../", import.meta.url));
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { readFile } from "node:fs/promises";
    import { createRequire } from "node:module";
    import { createStartCompiler } from ${JSON.stringify(compilerUrl)};
    const root = ${JSON.stringify(root)};
    const compiler = createStartCompiler({
      env: "client", envName: "client", root, framework: "solid", providerEnvName: "ssr", mode: "build",
      getKnownServerFns: () => ({}),
      loadModule: async id => compiler.ingestModule({ code: await readFile(id, "utf8"), id }),
      resolveId: async (id, importer) => {
        try { return createRequire(importer ?? root + "/package.json").resolve(id); }
        catch { return null; }
      },
    });
    const result = await compiler.compile({ code: ${JSON.stringify(source)}, id: root + ${JSON.stringify(path)} });
    process.stdout.write(result.code);
  `,
    ],
    { cwd: root, encoding: "utf8", timeout: 30_000 },
  );
}
