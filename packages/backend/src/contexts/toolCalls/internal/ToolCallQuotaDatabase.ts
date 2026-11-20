import { defineRelations } from "drizzle-orm";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect/db";
import * as PgDrizzle from "drizzle-orm/postgres/effect";
import type {
  EffectPostgresQueryEffectHKT,
  EffectPostgresQueryResultHKT,
} from "drizzle-orm/postgres/effect";
import { Context, Layer } from "effect";

import { toolCallQuota } from "./ToolCallQuotaTables.ts";

export const toolCallQuotaRelations = defineRelations({ toolCallQuota });

export class ToolCallQuotaDatabase extends Context.Service<
  ToolCallQuotaDatabase,
  PgEffectDatabase<
    EffectPostgresQueryEffectHKT,
    EffectPostgresQueryResultHKT,
    typeof toolCallQuotaRelations
  >
>()("@lineupkeep/backend/contexts/toolCalls/internal/ToolCallQuotaDatabase") {
  static readonly layer = Layer.effect(
    this,
    PgDrizzle.makeWithDefaults({ relations: toolCallQuotaRelations }),
  );
}
