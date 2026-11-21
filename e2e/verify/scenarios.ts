import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { Array as EffectArray } from "effect";
import { Order as EffectOrder } from "effect";

import { scratchTasks } from "./source.ts";

function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

export function scenarioFiles(
  root: string,
  selection: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return EffectArray.sort(
    EffectArray.flatMap(["e2e/scenarios", ...scratchTasks(selection)], (directory) => {
      const flatMapped1 = EffectArray.map(
        EffectArray.filter(
          readdirSync(join(root, directory), { recursive: true, withFileTypes: true }),
          (entry) => entry.isFile() && entry.name.endsWith(".ts"),
        ),
        (entry) => relative(root, join(entry.parentPath, entry.name)),
      );
      return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
    }),
    EffectOrder.String,
  );
}

export function selectServiceModule(root: string, selection: ReadonlyArray<string>): string {
  const tasks = scratchTasks(selection);
  const modules = EffectArray.filter(
    EffectArray.map(tasks, (task) => `${task}/services.ts`),
    (path) => existsSync(join(root, path)),
  );
  if (modules.length > 1) {
    throw new Error("Select one task's service programs per run.");
  }
  return (
    modules[0] ?? (tasks.length === 0 ? "e2e/scenarios/services.ts" : "e2e/verificationPrograms.ts")
  );
}
