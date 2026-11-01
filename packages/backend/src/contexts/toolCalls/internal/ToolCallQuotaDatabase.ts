import { defineRelations } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import type { EffectPgQueryEffectHKT } from "drizzle-orm/effect-postgres";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect/db";
import { Context, Layer } from "effect";

import { toolCallQuota } from "./ToolCallQuotaTables.ts";

export const toolCallQuotaRelations = defineRelations({ toolCallQuota });

export class ToolCallQuotaDatabase extends Context.Service<
  ToolCallQuotaDatabase,
  PgEffectDatabase<EffectPgQueryEffectHKT, PgQueryResultHKT, typeof toolCallQuotaRelations>
>()("@lineupkeep/backend/contexts/toolCalls/internal/ToolCallQuotaDatabase") {
  static readonly layer = Layer.effect(
    this,
    PgDrizzle.makeWithDefaults({ relations: toolCallQuotaRelations }),
  );
}
