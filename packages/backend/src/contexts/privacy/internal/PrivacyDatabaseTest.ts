import * as PgDrizzle from "drizzle-orm/postgres/effect";
import { Effect, Layer } from "effect";

import { DatabaseTest } from "#database/internal/DatabaseTest.ts";

import { PrivacyDatabase, privacyDatabaseOf } from "./PrivacyDatabase.ts";

export const PrivacyDatabaseTest = Layer.effect(
  PrivacyDatabase,
  Effect.map(PgDrizzle.makeWithDefaults(), privacyDatabaseOf),
).pipe(Layer.provide(DatabaseTest));
