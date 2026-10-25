import { defineRelations } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import type { EffectPgQueryEffectHKT } from "drizzle-orm/effect-postgres";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect/db";
import { Context, Layer } from "effect";

import { feedback, feedbackQuota } from "./FeedbackTables.ts";

export const feedbackRelations = defineRelations({ feedback, feedbackQuota });

export class FeedbackDatabase extends Context.Service<
  FeedbackDatabase,
  PgEffectDatabase<EffectPgQueryEffectHKT, PgQueryResultHKT, typeof feedbackRelations>
>()("@lineupkeep/backend/contexts/feedback/internal/FeedbackDatabase") {
  static readonly layer = Layer.effect(
    this,
    PgDrizzle.makeWithDefaults({ relations: feedbackRelations }),
  );
}
