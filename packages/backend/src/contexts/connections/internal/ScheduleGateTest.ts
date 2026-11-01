import { Effect, Layer } from "effect";

import { ScheduleGate } from "#contexts/connections/ScheduleGate.ts";

export const ScheduleGateTest = Layer.succeed(ScheduleGate)({
  evaluate: () => Effect.succeed({ kind: "run", reason: "game_before_next_tick" }),
});
