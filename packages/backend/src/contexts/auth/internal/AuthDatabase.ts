import { defineRelations } from "drizzle-orm";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { Context, Duration, Effect, Layer, Redacted } from "effect";
import postgres from "postgres";

import { DatabaseConnection } from "#database/DatabaseConnection.ts";

import * as authSchema from "./AuthTables.ts";
import * as oauthSchema from "./OAuthTables.ts";

export const authRelations = defineRelations({ ...authSchema, ...oauthSchema }, (r) => ({
  user: { accounts: r.many.account(), sessions: r.many.session() },
  account: { user: r.one.user({ from: r.account.userId, to: r.user.id }) },
  session: { user: r.one.user({ from: r.session.userId, to: r.user.id }) },
}));

export class AuthDatabase extends Context.Service<
  AuthDatabase,
  PgAsyncDatabase<PgQueryResultHKT, typeof authRelations>
>()("@lineupkeep/backend/contexts/auth/internal/AuthDatabase") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const connection = yield* DatabaseConnection;
      const client = yield* Effect.acquireRelease(
        Effect.sync(() =>
          postgres(Redacted.value(connection.url), {
            idle_timeout: Duration.toSeconds(connection.idleTimeout),
          }),
        ),
        (client) => Effect.promise(() => client.end({ timeout: 5 })),
      );
      return drizzle({ client, relations: authRelations });
    }),
  );
}
