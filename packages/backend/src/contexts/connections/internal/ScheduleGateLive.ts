import { Effect, Layer } from "effect";

import { GameSourceRegistry } from "#contexts/connections/GameSource.ts";
import { ProfessionalCalendar } from "#contexts/connections/ProfessionalCalendar.ts";
import { ScheduleGate } from "#contexts/connections/ScheduleGate.ts";

import { evaluateScheduleGate } from "./LineupScheduleGate.ts";
import { ObservedFactRepository } from "./ObservedFactRepository.ts";

export const ScheduleGateLive = Layer.effect(
  ScheduleGate,
  Effect.gen(function* () {
    const facts = yield* ObservedFactRepository;
    const calendar = yield* ProfessionalCalendar;
    const sources = yield* GameSourceRegistry;

    return ScheduleGate.of({
      evaluate: (input) =>
        evaluateScheduleGate({
          ...input,
          facts,
          calendar,
          hasGameSource: sources.sourceFor(input.team.league) !== undefined,
        }),
    });
  }),
);
