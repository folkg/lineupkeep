import * as PgliteDrizzle from "drizzle-orm/effect-pglite";
import { Layer } from "effect";

import { DatabaseTest } from "#database/internal/DatabaseTest.ts";

import { FeedbackDatabase, feedbackRelations } from "./FeedbackDatabase.ts";

export const FeedbackDatabaseTest = Layer.effect(
  FeedbackDatabase,
  PgliteDrizzle.makeWithDefaults({ relations: feedbackRelations }),
).pipe(Layer.provide(DatabaseTest));
