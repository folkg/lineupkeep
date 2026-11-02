import type { SQL } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import type { EffectPgQueryEffectHKT } from "drizzle-orm/effect-postgres";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect/db";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import { Context, Effect, Layer, Schema } from "effect";

type PrivacyQueryResult = {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly rowCount: number;
};

export type PrivacyDatabaseShape = {
  readonly execute: (statement: SQL) => Effect.Effect<PrivacyQueryResult, EffectDrizzleQueryError>;
  readonly transaction: <A, E>(
    use: (tx: PrivacyDatabaseShape) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | PrivacyDatabaseUnavailable>;
};

export class PrivacyDatabase extends Context.Service<PrivacyDatabase, PrivacyDatabaseShape>()(
  "@lineupkeep/backend/contexts/privacy/internal/PrivacyDatabase",
) {
  static readonly layer = Layer.effect(
    this,
    Effect.map(PgDrizzle.makeWithDefaults(), (database) => privacyDatabaseOf(database)),
  );
}

class PrivacyDatabaseUnavailable extends Schema.TaggedError<
  PrivacyDatabaseUnavailable,
  { readonly brand: unique symbol }
>()("privacy_database.unavailable", {
  cause: Schema.Defect(),
}) {}

export function privacyDatabaseOf(database: DriverDatabase): PrivacyDatabaseShape {
  return {
    execute: (statement) => Effect.map(database.execute(statement), privacyQueryResult),
    transaction: (use) =>
      database
        .transaction((tx) => use(privacyDatabaseOf(tx)))
        .pipe(Effect.mapError((cause) => PrivacyDatabaseUnavailable.make({ cause }))),
  };
}

type DriverDatabase = PgEffectDatabase<EffectPgQueryEffectHKT, PgQueryResultHKT>;

function privacyQueryResult(result: unknown): PrivacyQueryResult {
  if (typeof result !== "object" || result === null || !("rows" in result)) {
    throw new Error("A database query did not return rows.");
  }
  const rows = result.rows;
  if (!Array.isArray(rows)) {
    throw new Error("A database query did not return an array of rows.");
  }
  const rowCount =
    "rowCount" in result && typeof result.rowCount === "number" ? result.rowCount : rows.length;
  return { rows: rows.map(recordOf), rowCount };
}

function recordOf(row: unknown): Record<string, unknown> {
  if (typeof row !== "object" || row === null) {
    throw new Error("A database row was not an object.");
  }
  return Object.fromEntries(Object.entries(row));
}
