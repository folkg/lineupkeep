import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { NarrowingResult, QueryPage } from "#contexts/connections/QueryValues.ts";

import { fitPage } from "./QueryBudget.ts";

const NamesResult = Schema.Struct({
  names: Schema.Array(Schema.String),
  page: QueryPage,
});

it.effect("refuses a record whose escaped text copy cannot fit the hard byte limit", () =>
  Effect.gen(function* () {
    const rows = [{ name: '"'.repeat(3_400) }];
    const result = yield* fitPage({
      schema: NamesResult,
      rows,
      offset: 0,
      limit: 50,
      resource: "roster",
      groups: undefined,
      remedy: "Request a smaller limit.",
      build: (selected, page) => ({ names: selected.map((row) => row.name), page }),
      makeNext: () => Effect.succeed("continuation"),
      recordLabel: () => "quoted name",
    });

    assert.isTrue(Schema.is(NarrowingResult)(result));
  }),
);
