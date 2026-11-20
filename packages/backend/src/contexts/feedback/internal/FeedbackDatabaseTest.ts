import * as PgDrizzle from "drizzle-orm/postgres/effect";
import { Layer } from "effect";

import { DatabaseTest } from "#database/internal/DatabaseTest.ts";

import { FeedbackDatabase, feedbackRelations } from "./FeedbackDatabase.ts";

export const FeedbackDatabaseTest = Layer.effect(
  FeedbackDatabase,
  PgDrizzle.makeWithDefaults({ relations: feedbackRelations }),
).pipe(Layer.provide(DatabaseTest));
