import { globSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getTableName, getTableSchema, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { Array as EffectArray } from "effect";

import { findTableOwnershipConflicts } from "./tableOwnership.ts";
const EffectString = {
  indexOf: (self: string, search: string): number => self.indexOf(search),
  slice: (self: string, start?: number, end?: number): string => self.slice(start, end),
};

const contextsRoot = fileURLToPath(new URL("../src/contexts", import.meta.url));
const definitions = await Promise.all(
  EffectArray.map(
    globSync("*/internal/**/*{Table,Tables}.ts", { cwd: contextsRoot }),
    async (file) => {
      const owner = EffectString.slice(file, 0, EffectString.indexOf(file, sep));
      const tableModule: unknown = await import(pathToFileURL(join(contextsRoot, file)).href);
      return EffectArray.map(
        EffectArray.filter(
          Object.values(
            Effect.runSync(
              Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))(tableModule),
            ),
          ),
          (value) => is(value, PgTable),
        ),
        (table) => ({
          owner,
          name: `${getTableSchema(table) ?? "public"}.${getTableName(table)}`,
        }),
      );
    },
  ),
);
const conflicts = findTableOwnershipConflicts(definitions.flat());
if (conflicts.length > 0) {
  throw new Error(
    EffectArray.join(
      EffectArray.map(
        conflicts,
        ({ name, owners }) =>
          `Table ${name} is owned by ${EffectArray.join(owners, ", ")}; multiple owners break context isolation. Keep its declaration in one context's internal Table/Tables module and use that context's public service elsewhere.`,
      ),
      "\n",
    ),
  );
}
console.log("✔ no physical table ownership conflicts found");
