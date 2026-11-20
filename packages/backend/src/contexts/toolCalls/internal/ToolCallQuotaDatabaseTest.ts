import * as PgDrizzle from "drizzle-orm/postgres/effect";
import { Layer } from "effect";

import { DatabaseTest } from "#database/internal/DatabaseTest.ts";

import { ToolCallQuotaDatabase, toolCallQuotaRelations } from "./ToolCallQuotaDatabase.ts";

export const ToolCallQuotaDatabaseTest = Layer.effect(
  ToolCallQuotaDatabase,
  PgDrizzle.makeWithDefaults({ relations: toolCallQuotaRelations }),
).pipe(Layer.provide(DatabaseTest));
