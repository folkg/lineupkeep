import { Effect, Layer } from "effect";

import {
  LineupDelivery,
  LineupDeliveryFailed,
  LineupWorker,
} from "#contexts/connections/LineupWork.ts";

export const LineupDeliveryLocal = Layer.effect(
  LineupDelivery,
  Effect.gen(function* () {
    const worker = yield* LineupWorker;
    return LineupDelivery.of({
      enqueueMany: (inputs) =>
        worker.deliver(inputs.flatMap((input) => input.runs)).pipe(
          Effect.asVoid,
          Effect.mapError(() => LineupDeliveryFailed.make({ reason: "unavailable" })),
        ),
    });
  }),
);
