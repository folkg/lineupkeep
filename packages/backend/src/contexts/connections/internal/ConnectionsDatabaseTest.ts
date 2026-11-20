import * as PgDrizzle from "drizzle-orm/postgres/effect";
import { Layer } from "effect";

import { DatabaseTest } from "#database/internal/DatabaseTest.ts";

import { ConnectionsDatabase, connectionsRelations } from "./ConnectionsDatabase.ts";

export const ConnectionsDatabaseTest = Layer.effect(
  ConnectionsDatabase,
  PgDrizzle.makeWithDefaults({ relations: connectionsRelations }),
).pipe(Layer.provide(DatabaseTest));
