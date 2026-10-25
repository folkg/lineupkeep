import { defineRelations } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import type { EffectPgQueryEffectHKT } from "drizzle-orm/effect-postgres";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect/db";
import { Context, Layer } from "effect";

import { providerConnections } from "./ConnectionTables.ts";
import {
  lineupDeliveries,
  lineupRequests,
  lineupRunAttempts,
  lineupRunDiagnostics,
  lineupRuns,
  lineupTeamLeases,
  lineupWriteIntents,
} from "./LineupRunTables.ts";

export const connectionsRelations = defineRelations({
  providerConnections,
  lineupRequests,
  lineupRuns,
  lineupDeliveries,
  lineupTeamLeases,
  lineupRunAttempts,
  lineupRunDiagnostics,
  lineupWriteIntents,
});

export class ConnectionsDatabase extends Context.Service<
  ConnectionsDatabase,
  PgEffectDatabase<EffectPgQueryEffectHKT, PgQueryResultHKT, typeof connectionsRelations>
>()("@lineupkeep/backend/contexts/connections/internal/ConnectionsDatabase") {
  static readonly layer = Layer.effect(
    this,
    PgDrizzle.makeWithDefaults({ relations: connectionsRelations }),
  );
}
