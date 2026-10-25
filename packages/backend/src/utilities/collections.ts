import { Array, Effect } from "effect";

export function chunked<A, B, E, R>(
  items: Iterable<A>,
  size: number,
  run: (chunk: Array.NonEmptyArray<A>) => Effect.Effect<ReadonlyArray<B>, E, R>,
): Effect.Effect<ReadonlyArray<B>, E, R> {
  return Effect.gen(function* () {
    if (!Number.isSafeInteger(size) || size <= 0) {
      return yield* Effect.die(new RangeError("Chunk size must be a positive safe integer"));
    }
    const results: Array<B> = [];
    let chunk: Array<A> = [];
    for (const item of items) {
      chunk.push(item);
      if (chunk.length === size && Array.isArrayNonEmpty(chunk)) {
        for (const result of yield* run(chunk)) {
          results.push(result);
        }
        chunk = [];
      }
    }
    if (Array.isArrayNonEmpty(chunk)) {
      for (const result of yield* run(chunk)) {
        results.push(result);
      }
    }
    return results;
  });
}
