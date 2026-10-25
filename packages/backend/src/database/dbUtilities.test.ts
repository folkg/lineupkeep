import { PgliteClient } from "@effect/sql-pglite";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import * as EffectDrizzle from "drizzle-orm/effect-pglite";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { Array as EffectArray, Data, Effect, Exit, Schema } from "effect";
import { expect, expectTypeOf } from "vitest";

import { maxInsertRows, mutateRows, unnestRows } from "./dbUtilities.ts";

it("requires table-matched scalar unnest rows", () => {
  expectTypeOf<EffectArray.NonEmptyReadonlyArray<{ tags: string[] }>>().not.toExtend<
    Parameters<typeof unnestRows<typeof arrayRecords, "tags">>[1]
  >();
  expectTypeOf<Parameters<typeof unnestRows<typeof arrayRecords, "id">>[1]>().toEqualTypeOf<
    EffectArray.NonEmptyReadonlyArray<{ id: string }>
  >();
  expectTypeOf<typeof arrayRecords>().not.toExtend<
    Parameters<typeof mutateRows<typeof arrayRecords, unknown, never, never, never, never>>[1]
  >();
});

it("counts insertable columns, including defaults but excluding generated columns", () => {
  const table = pgTable("generated_records", {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: text("title").default("default"),
    length: integer("length").generatedAlwaysAs(() => records.count.getSQL()),
  });

  expect(maxInsertRows(records)).toBe(Math.floor(65_535 / 7));
  expect(maxInsertRows(table)).toBe(65_535);
});

it.effect(
  "round-trips a non-lifecycle codec, updates only changed owned rows, and returns ID order",
  () =>
    Effect.gen(function* () {
      const client = yield* PgliteClient.PgliteClient;
      yield* Effect.promise(() =>
        client.pglite.exec(
          "create table entities (key text primary key, count text not null, owner text not null)",
        ),
      );
      const db = yield* EffectDrizzle.makeWithDefaults();
      yield* db.insert(entities).values([
        { key: "b", count: "2", owner: "mine" },
        { key: "a", count: "1", owner: "mine" },
        { key: "c", count: "3", owner: "theirs" },
      ]);
      const codec = Schema.Struct({
        key: Schema.String,
        count: Schema.FiniteFromString,
        owner: Schema.String,
      });
      const where = eq(entities.owner, "mine");

      const changed = yield* db.transaction((tx) =>
        mutateRows(tx, entities, {
          where,
          ids: ["b", "c", "a"],
          codec,
          plan: (locked) =>
            Effect.succeed(
              [...locked.values()]
                .toReversed()
                .map((row) => ({ ...row, count: row.key === "b" ? 20 : row.count })),
            ),
        }),
      );

      expect(changed).toEqual([
        { key: "a", count: 1, owner: "mine" },
        { key: "b", count: 20, owner: "mine" },
      ]);

      const unchanged = yield* db.transaction((tx) =>
        mutateRows(tx, entities, {
          where,
          ids: ["b", "a"],
          codec,
          plan: (locked) => Effect.succeed([...locked.values()].map((row) => ({ ...row }))),
        }),
      );

      expect(unchanged).toEqual(changed);
      const rejected = yield* Effect.flip(
        db.transaction((tx) =>
          mutateRows(tx, entities, {
            where,
            ids: ["a", "b"],
            codec,
            plan: () => Effect.fail(new PlanRejected()),
          }),
        ),
      );
      expect(rejected).toBeInstanceOf(PlanRejected);
      expect(
        (yield* db.select().from(entities)).toSorted((a, b) => a.key.localeCompare(b.key)),
      ).toEqual([
        { key: "a", count: "1", owner: "mine" },
        { key: "b", count: "20", owner: "mine" },
        { key: "c", count: "3", owner: "theirs" },
      ]);
      const incomplete = yield* Effect.exit(
        db.transaction((tx) =>
          mutateRows(tx, entities, {
            where,
            ids: ["a", "b"],
            codec,
            plan: () => Effect.succeed([]),
          }),
        ),
      );
      expect(Exit.isFailure(incomplete)).toBe(true);
      expect(String(incomplete)).toContain("one next value for every locked row");
      const changedKey = yield* Effect.exit(
        db.transaction((tx) =>
          mutateRows(tx, entities, {
            where,
            ids: ["a", "b"],
            codec,
            plan: (locked) =>
              Effect.succeed(
                [...locked.values()].map((row) => ({ ...row, key: `${row.key}-changed` })),
              ),
          }),
        ),
      );
      expect(Exit.isFailure(changedKey)).toBe(true);
      expect(String(changedKey)).toContain("preserve every locked primary key");
    }).pipe(Effect.provide(PgliteClient.layer())),
);

it.effect("rejects composite primary keys with a constructive remedy before querying", () =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzle.makeWithDefaults();
    const table = pgTable(
      "composite",
      { first: text("first").notNull(), second: text("second").notNull() },
      (table) => [primaryKey({ columns: [table.first, table.second] })],
    );
    const result = yield* Effect.exit(
      mutateRows(db, table, {
        where: undefined,
        ids: ["a"],
        codec: Schema.Struct({ first: Schema.String, second: Schema.String }),
        plan: (locked) => Effect.succeed([...locked.values()]),
      }),
    );

    expect(Exit.isFailure(result)).toBe(true);
    expect(String(result)).toContain("single-column primary key");
    expect(String(result)).toContain("dedicated set-based mutation");
  }).pipe(Effect.provide(PgliteClient.layer())),
);

class PlanRejected extends Data.TaggedError("PlanRejected") {}

const entities = pgTable("entities", {
  key: text("key").primaryKey(),
  count: text("count").notNull(),
  owner: text("owner").notNull(),
});

const records = pgTable("records", {
  id: uuid("id").primaryKey(),
  title: text("title").default("database default"),
  count: integer("row_count"),
  enabled: boolean("enabled"),
  at: timestamp("at", { withTimezone: true }),
  data: jsonb("data"),
  owner: text("owner"),
});

const arrayRecords = pgTable("array_records", {
  id: text("id").primaryKey(),
  tags: text("tags").array(),
});
