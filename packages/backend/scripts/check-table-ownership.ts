import { globSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getTableName, getTableSchema, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { Schema } from "effect";

import { findTableOwnershipConflicts } from "./tableOwnership.ts";

const contextsRoot = fileURLToPath(new URL("../src/contexts", import.meta.url));
const definitions = await Promise.all(
  globSync("*/internal/**/*{Table,Tables}.ts", { cwd: contextsRoot }).map(async (file) => {
    const owner = file.slice(0, file.indexOf(sep));
    const tableModule: unknown = await import(pathToFileURL(join(contextsRoot, file)).href);
    return Object.values(
      Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(tableModule),
    )
      .filter((value) => is(value, PgTable))
      .map((table) => ({
        owner,
        name: `${getTableSchema(table) ?? "public"}.${getTableName(table)}`,
      }));
  }),
);
const conflicts = findTableOwnershipConflicts(definitions.flat());
if (conflicts.length > 0) {
  throw new Error(
    conflicts
      .map(
        ({ name, owners }) =>
          `Table ${name} is owned by ${owners.join(", ")}; multiple owners break context isolation. Keep its declaration in one context's internal Table/Tables module and use that context's public service elsewhere.`,
      )
      .join("\n"),
  );
}
console.log("✔ no physical table ownership conflicts found");
