import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Array as EffectArray } from "effect";

import { NarrowingResult, QueryPage } from "#contexts/connections/QueryValues.ts";

import { fitPage } from "./QueryBudget.ts";

const NamesResult = Schema.Struct({
  names: Schema.Array(Schema.String),
  page: QueryPage,
});

it.effect("refuses a record that cannot fit the hard byte limit", () =>
  Effect.gen(function* () {
    const rows = [{ name: "x".repeat(40_000) }];
    const result = yield* fitPage({
      schema: NamesResult,
      rows,
      offset: 0,
      limit: 50,
      resource: "roster",
      groups: undefined,
      remedy: "Request a smaller limit.",
      build: (selected, page) => ({ names: EffectArray.map(selected, (row) => row.name), page }),
      makeNext: () => Effect.succeed("continuation"),
      recordLabel: () => "quoted name",
    });

    assert.isTrue(Schema.is(NarrowingResult)(result));
  }),
);

it.effect("applies a caller-supplied budget instead of the shared default", () =>
  Effect.gen(function* () {
    const rows = [{ name: "a".repeat(30_000) }];
    const input = {
      schema: NamesResult,
      rows,
      offset: 0,
      limit: 50,
      resource: "team_summary.roster",
      groups: undefined,
      remedy: "Request fewer groups.",
      build: (selected: ReadonlyArray<{ readonly name: string }>, page: QueryPage) => ({
        names: EffectArray.map(selected, (row) => row.name),
        page,
      }),
      makeNext: () => Effect.succeed("continuation"),
      recordLabel: () => undefined,
    } as const;

    const shared = yield* fitPage(input);
    assert.isFalse(Schema.is(NarrowingResult)(shared));

    const summary = yield* fitPage({
      ...input,
      budget: { targetBytes: 20 * 1024, hardLimitBytes: 28 * 1024 },
    });
    assert.isTrue(Schema.is(NarrowingResult)(summary));
  }),
);
