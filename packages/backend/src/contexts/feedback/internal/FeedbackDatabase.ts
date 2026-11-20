import { defineRelations } from "drizzle-orm";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect/db";
import * as PgDrizzle from "drizzle-orm/postgres/effect";
import type {
  EffectPostgresQueryEffectHKT,
  EffectPostgresQueryResultHKT,
} from "drizzle-orm/postgres/effect";
import { Context, Layer } from "effect";

import { feedback, feedbackQuota } from "./FeedbackTables.ts";

export const feedbackRelations = defineRelations({ feedback, feedbackQuota });

export class FeedbackDatabase extends Context.Service<
  FeedbackDatabase,
  PgEffectDatabase<
    EffectPostgresQueryEffectHKT,
    EffectPostgresQueryResultHKT,
    typeof feedbackRelations
  >
>()("@lineupkeep/backend/contexts/feedback/internal/FeedbackDatabase") {
  static readonly layer = Layer.effect(
    this,
    PgDrizzle.makeWithDefaults({ relations: feedbackRelations }),
  );
}
