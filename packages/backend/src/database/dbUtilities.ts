import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import type { GetColumnData, InferSelectModel, SQL } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect";
import { getTableConfig, pgTable } from "drizzle-orm/pg-core";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect/db";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import { Array, Effect, Schema } from "effect";

export function anyOf<Column extends PgColumn>(
  column: Column,
  values: Array.NonEmptyReadonlyArray<GetColumnData<Column, "raw">>,
): SQL<boolean> {
  return sql`${column} = ANY(${arrayParameter(column, values)})`;
}

export function unnestRows<
  Table extends PgTable,
  Key extends keyof InferSelectModel<Table> & string,
>(
  table: Table,
  rows: Array.NonEmptyReadonlyArray<Pick<InferSelectModel<NoInfer<Table>>, Key>> &
    ScalarColumns<Table, Key>,
): { readonly source: SQL; readonly column: (key: Key) => SQL } {
  const first = rows[0];
  const columns = Object.entries(getTableColumns(table)).flatMap(([key, column]) =>
    hasOwnKey(first, key) ? [{ key, column }] : [],
  );
  const names = getTableColumns(table) as Record<Key, PgColumn>;
  return {
    source: sql`unnest(${sql.join(
      columns.map(({ key, column }) =>
        arrayParameter(
          column,
          rows.map((row) => row[key]),
        ),
      ),
      sql`, `,
    )}) as batch(${sql.join(
      columns.map(({ column }) => sql.identifier(column.name)),
      sql`, `,
    )})`,
    column: (key) => sql`${sql.identifier("batch")}.${sql.identifier(names[key].name)}`,
  };
}

const postgresMaxBindParameters = 65_535;

export function maxInsertRows(table: PgTable): number {
  const columns = Object.values(getTableColumns(table)).filter(
    (column) => column.generated === undefined && column.generatedIdentity?.type !== "always",
  );
  return Math.floor(postgresMaxBindParameters / columns.length);
}

export function mutateRows<Table extends PgTable, Row, E, RD, RE, R>(
  tx: Pick<PgEffectDatabase<MutationQueryEffect, PgQueryResultHKT>, "select" | "update">,
  table: Table & ScalarColumns<NoInfer<Table>, keyof InferSelectModel<Table>>,
  options: {
    readonly where: SQL | undefined;
    readonly ids: Array.NonEmptyReadonlyArray<string>;
    readonly codec: Schema.Codec<Row, InferSelectModel<NoInfer<Table>>, RD, RE>;
    readonly plan: (locked: ReadonlyMap<string, Row>) => Effect.Effect<ReadonlyArray<Row>, E, R>;
  },
): Effect.Effect<
  ReadonlyArray<Row>,
  E | Schema.SchemaError | EffectDrizzleQueryError,
  RD | RE | R
> {
  return Effect.gen(function* () {
    const columns = getTableColumns(table);
    const config = getTableConfig(table);
    const primary = [
      ...Object.values(columns).filter((column) => column.primary),
      ...config.primaryKeys.flatMap((key) => key.columns),
    ];
    if (primary.length !== 1) {
      return yield* Effect.die(
        "mutateRows requires a single-column primary key; use a dedicated set-based mutation for composite keys",
      );
    }
    const id = Array.getUnsafe(primary, 0);
    const idKey = Object.keys(columns).find((key) => columns[key] === id);
    if (idKey === undefined) {
      return yield* Effect.die("mutateRows primary key must belong to the mutated table");
    }
    const target: PgTable = table;
    const selected = yield* tx
      .select()
      .from(target)
      .where(and(options.where, anyOf(id, options.ids)))
      .orderBy(asc(id))
      .for("update");
    const rows = yield* Effect.forEach(selected, (row) =>
      Schema.decodeUnknownEffect(Schema.toEncoded(options.codec))(row),
    );
    const locked = yield* Effect.forEach(rows, (row) => Schema.decodeEffect(options.codec)(row));
    const keyed = new Map(
      Array.zip(rows, locked).map(([row, value]) => [String(row[idKey]), value]),
    );
    const planned = yield* options.plan(keyed);
    const encoded = yield* Effect.forEach(planned, (value) =>
      Schema.encodeEffect(options.codec)(value),
    );
    const next = new Map(encoded.map((row) => [String(row[idKey]), row]));
    if (next.size !== rows.length || encoded.length !== rows.length) {
      return yield* Effect.die(
        "mutateRows plan must return one next value for every locked row, preserving primary keys",
      );
    }
    const equivalent = Schema.toEquivalence(Schema.toEncoded(options.codec));
    const changes: Array<InferSelectModel<Table>> = [];
    for (const row of rows) {
      const value = next.get(String(row[idKey]));
      if (value === undefined) {
        return yield* Effect.die("mutateRows plan must preserve every locked primary key");
      }
      if (!equivalent(row, value)) {
        changes.push(value);
      }
    }
    const results = new Map(keyed);
    if (Array.isArrayNonEmpty(changes)) {
      const batch = unnestRows<PgTable, string>(table, changes);
      const changed = yield* tx
        .update(target)
        .set(
          Object.fromEntries(
            Object.keys(columns)
              .filter((key) => key !== idKey)
              .map((key) => [key, batch.column(key)]),
          ),
        )
        .from(batch.source)
        .where(and(options.where, eq(id, batch.column(idKey))))
        .returning(getTableColumns(target));
      const decoded = yield* Effect.forEach(changed, (row) =>
        Schema.decodeUnknownEffect(options.codec)(row),
      );
      for (const [row, value] of Array.zip(changed, decoded)) {
        results.set(String(row[idKey]), value);
      }
      if (changed.length !== changes.length) {
        return yield* Effect.die("A locked mutation did not return every changed row");
      }
    }
    return [...results.values()];
  });
}

function arrayParameter(column: PgColumn, values: ReadonlyArray<unknown>): SQL {
  const array = pgTable("batch_parameter", { value: column.toBuilder().array() }).value;
  return sql`${sql.param(values, array)}::${sql.raw(column.getSQLType())}[]`;
}

type ScalarColumns<Table extends PgTable, Key extends PropertyKey> = {
  [K in keyof Table["_"]["columns"] & Key]: Table["_"]["columns"][K]["_"]["dataType"] extends
    | "json"
    | "jsonb"
    ? never
    : Extract<
          NonNullable<Table["_"]["columns"][K]["_"]["data"]>,
          ReadonlyArray<unknown>
        > extends never
      ? never
      : K;
}[keyof Table["_"]["columns"] & Key] extends never
  ? unknown
  : {
      readonly "UNNEST flattens SQL arrays; use scalar columns or a structured array-preserving write": never;
    };

interface MutationQueryEffect extends QueryEffectHKTBase {
  readonly error: EffectDrizzleQueryError;
  readonly context: never;
}

function hasOwnKey<Value extends object>(value: Value, key: PropertyKey): key is keyof Value {
  return Object.hasOwn(value, key);
}
