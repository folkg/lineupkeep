import * as PgliteDrizzle from "drizzle-orm/effect-pglite";
import { Layer } from "effect";

import { DatabaseTest } from "#database/internal/DatabaseTest.ts";

import { ConnectionsDatabase, connectionsRelations } from "./ConnectionsDatabase.ts";

export const ConnectionsDatabaseTest = Layer.effect(
  ConnectionsDatabase,
  PgliteDrizzle.makeWithDefaults({ relations: connectionsRelations }),
).pipe(Layer.provide(DatabaseTest));
