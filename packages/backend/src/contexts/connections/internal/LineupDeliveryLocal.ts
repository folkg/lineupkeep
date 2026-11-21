import { Effect, Layer } from "effect";
import { Array as EffectArray } from "effect";

import {
  LineupDelivery,
  LineupDeliveryFailed,
  LineupWorker,
} from "#contexts/connections/LineupWork.ts";
function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

export const LineupDeliveryLocal = Layer.effect(
  LineupDelivery,
  Effect.gen(function* () {
    const worker = yield* LineupWorker;
    return LineupDelivery.of({
      enqueueMany: (inputs) =>
        worker
          .deliver(
            EffectArray.flatMap(inputs, (input) => {
              const flatMapped1 = input.runs;
              return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
            }),
          )
          .pipe(
            Effect.asVoid,
            Effect.mapError(() => LineupDeliveryFailed.make({ reason: "unavailable" })),
          ),
    });
  }),
);
