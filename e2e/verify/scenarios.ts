import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { scratchTasks } from "./source.ts";

export function scenarioFiles(
  root: string,
  selection: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return ["e2e/scenarios", ...scratchTasks(selection)]
    .flatMap((directory) =>
      readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
        .map((entry) => relative(root, join(entry.parentPath, entry.name))),
    )
    .toSorted();
}

export function selectServiceModule(root: string, selection: ReadonlyArray<string>): string {
  const tasks = scratchTasks(selection);
  const modules = tasks
    .map((task) => `${task}/services.ts`)
    .filter((path) => existsSync(join(root, path)));
  if (modules.length > 1) {
    throw new Error("Select one task's service programs per run.");
  }
  return (
    modules[0] ?? (tasks.length === 0 ? "e2e/scenarios/services.ts" : "e2e/verificationPrograms.ts")
  );
}
