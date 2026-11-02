import * as PgliteDrizzle from "drizzle-orm/effect-pglite";
import { Effect, Layer } from "effect";

import { DatabaseTest } from "#database/internal/DatabaseTest.ts";

import { PrivacyDatabase, privacyDatabaseOf } from "./PrivacyDatabase.ts";

export const PrivacyDatabaseTest = Layer.effect(
  PrivacyDatabase,
  Effect.map(PgliteDrizzle.makeWithDefaults(), privacyDatabaseOf),
).pipe(Layer.provide(DatabaseTest));
