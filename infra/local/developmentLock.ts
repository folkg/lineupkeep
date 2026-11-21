import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import jsonTools from "@lineupkeep/backend/runtime/JsonText";
import { Effect } from "effect";
import { Schema } from "effect";

export async function acquireDevelopmentLock(directory: URL): Promise<() => Promise<void>> {
  await mkdir(new URL("../", directory), { recursive: true });
  try {
    await mkdir(directory);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
    const owner = Effect.runSync(
      Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({ pid: Schema.Number })))(
        await readFile(new URL("owner.json", directory), "utf8"),
      ),
    );
    try {
      process.kill(owner.pid, 0);
    } catch (failure) {
      if (!(failure instanceof Error && "code" in failure && failure.code === "ESRCH")) {
        throw failure;
      }
      await rm(directory, { recursive: true });
      await mkdir(directory);
      await writeOwner(directory);
      return () => rm(directory, { recursive: true });
    }
    throw new Error(
      "Another development/database command owns this checkout. Stop it before changing development data.",
    );
  }
  await writeOwner(directory);
  return () => rm(directory, { recursive: true });
}

async function writeOwner(directory: URL): Promise<void> {
  await writeFile(new URL("owner.json", directory), jsonTools.jsonString({ pid: process.pid }), {
    mode: 0o600,
  });
}
