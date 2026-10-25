import { glob, readFile } from "node:fs/promises";

import type { Plugin } from "vite";
export async function assertDeployableComposition(directory: URL): Promise<void> {
  for await (const path of glob("**/*.{js,mjs,cjs}", { cwd: directory })) {
    if (
      (await readFile(new URL(path, directory), "utf8")).includes(
        "E2E_TEST_COMPOSITION_DO_NOT_DEPLOY",
      )
    ) {
      throw new Error(
        "E2E test composition contains test-only services and must not reach production; rebuild without E2E_TEST_COMPOSITION, then rerun bun run targets:verify.",
      );
    }
  }
}

export function clientBoundary(): Plugin {
  return {
    name: "client-execution-boundary",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") {
          assertClientModules(Object.keys(output.modules));
        }
      }
    },
  };
}

export function assertClientModules(modules: ReadonlyArray<string>): void {
  for (const id of modules) {
    if (isServerModule(id)) {
      throw new Error(
        `Server implementation reached the client bundle: ${id}. Keep backend and Effect values inside erased server-function validators/handlers; only primitive domain Limits modules may be shared.`,
      );
    }
  }
}

function isServerModule(id: string): boolean {
  return (
    /(?:^|\/)(?:effect|@effect)\//u.test(id) ||
    /\/apps\/web\/src\/server(?:\/|\.ts)/u.test(id) ||
    (id.includes("/packages/backend/src/") && !/\/contexts\/[^/]+\/[^/]+Limits\.ts$/u.test(id))
  );
}
