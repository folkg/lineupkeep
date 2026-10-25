import { mkdir, mkdtempDisposable, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { scenarioFiles, selectServiceModule } from "#e2e/verify/scenarios.ts";

it("selects only the chosen task's service module and rejects ambiguous selections", async () => {
  await using temporary = await mkdtempDisposable(join(tmpdir(), "verification-programs-"));
  const root = temporary.path;
  await mkdir(join(root, "e2e/scenarios"), { recursive: true });
  await writeFile(join(root, "e2e/scenarios/services.ts"), "export {};");
  await writeFile(join(root, ".gitignore"), "e2e/scratch/");
  for (const task of ["first", "second"]) {
    const directory = join(root, "e2e/scratch", task);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "services.ts"), "export {};");
  }

  expect(scenarioFiles(root, ["e2e/scratch/first/proof.e2e.ts"])).toEqual([
    "e2e/scenarios/services.ts",
    "e2e/scratch/first/services.ts",
  ]);
  expect(selectServiceModule(root, [])).toBe("e2e/scenarios/services.ts");
  expect(selectServiceModule(root, ["e2e/scratch/without-module/proof.e2e.ts"])).toBe(
    "e2e/verificationPrograms.ts",
  );
  expect(selectServiceModule(root, ["e2e/scratch/first/proof.e2e.ts"])).toBe(
    "e2e/scratch/first/services.ts",
  );
  expect(() =>
    selectServiceModule(root, [
      "e2e/scratch/first/proof.e2e.ts",
      "e2e/scratch/second/proof.e2e.ts",
    ]),
  ).toThrow("one task");
});
