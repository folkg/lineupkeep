import * as PgliteDrizzle from "drizzle-orm/effect-pglite";
import { Layer } from "effect";

import { DatabaseTest } from "#database/internal/DatabaseTest.ts";

import { ToolCallQuotaDatabase, toolCallQuotaRelations } from "./ToolCallQuotaDatabase.ts";

export const ToolCallQuotaDatabaseTest = Layer.effect(
  ToolCallQuotaDatabase,
  PgliteDrizzle.makeWithDefaults({ relations: toolCallQuotaRelations }),
).pipe(Layer.provide(DatabaseTest));
