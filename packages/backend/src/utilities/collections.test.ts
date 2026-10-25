import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { chunked } from "./collections.ts";

it.effect("consumes iterables lazily and concatenates sequential results in order", () =>
  Effect.gen(function* () {
    const steps: Array<string> = [];
    function* items(): Generator<number> {
      for (let i = 0; i < 5; i++) {
        steps.push(`read ${i}`);
        yield i;
      }
    }
    const program = chunked(items(), 2, (chunk) =>
      Effect.sync(() => {
        steps.push(`run ${chunk.join(",")}`);
        return chunk.map((n) => n * 2);
      }),
    );
    assert.deepStrictEqual(steps, []);

    const result = yield* program;

    assert.deepStrictEqual(result, [0, 2, 4, 6, 8]);
    assert.deepStrictEqual(steps, [
      "read 0",
      "read 1",
      "run 0,1",
      "read 2",
      "read 3",
      "run 2,3",
      "read 4",
      "run 4",
    ]);
  }),
);

it.effect("hands each callback a fresh mutable non-empty chunk", () =>
  Effect.gen(function* () {
    const chunks: Array<[number, ...Array<number>]> = [];
    const items = [1, 2, 3, 4, 5];
    const result = yield* chunked(items, 2, (chunk) =>
      Effect.sync(() => {
        chunks.push(chunk);
        chunk.push(chunk[0] * 10);
        return chunk;
      }),
    );

    assert.deepStrictEqual(result, [1, 2, 10, 3, 4, 30, 5, 50]);
    assert.deepStrictEqual(chunks, [
      [1, 2, 10],
      [3, 4, 30],
      [5, 50],
    ]);
    assert.notStrictEqual(chunks[0], chunks[1]);
    assert.notStrictEqual(chunks[1], chunks[2]);
    assert.deepStrictEqual(items, [1, 2, 3, 4, 5]);
  }),
);

it.effect("stops reading and running at the first failure", () =>
  Effect.gen(function* () {
    let read = 0;
    function* items(): Generator<number> {
      while (read < 10) {
        yield read++;
      }
    }
    const result = yield* Effect.flip(
      chunked(items(), 2, (chunk) =>
        chunk[0] === 2 ? Effect.fail("stopped") : Effect.succeed(chunk),
      ),
    );

    assert.strictEqual(result, "stopped");
    assert.strictEqual(read, 4);
  }),
);

it.effect("returns no results and never runs for empty input", () =>
  Effect.gen(function* () {
    const result = yield* chunked([], 2, () => Effect.die("must not run"));
    assert.deepStrictEqual(result, []);
  }),
);

it.effect("rejects sizes that cannot make bounded progress", () =>
  Effect.gen(function* () {
    for (const size of [0, -1, 1.5, Infinity, NaN]) {
      const exit = yield* Effect.exit(chunked([1], size, Effect.succeed));
      assert.strictEqual(exit._tag, "Failure");
    }
  }),
);
