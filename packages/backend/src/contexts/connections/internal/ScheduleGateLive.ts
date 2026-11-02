import { Effect, Layer } from "effect";

import { GameSourceRegistry } from "#contexts/connections/GameSource.ts";
import { ProfessionalCalendar } from "#contexts/connections/ProfessionalCalendar.ts";
import { ScheduleGate } from "#contexts/connections/ScheduleGate.ts";

import { evaluateScheduleGate } from "./LineupScheduleGate.ts";
import { ScheduleObservationRepository } from "./ScheduleObservationRepository.ts";

export const ScheduleGateLive = Layer.effect(
  ScheduleGate,
  Effect.gen(function* () {
    const store = yield* ScheduleObservationRepository;
    const calendar = yield* ProfessionalCalendar;
    const sources = yield* GameSourceRegistry;

    return ScheduleGate.of({
      evaluate: (input) =>
        evaluateScheduleGate({
          ...input,
          store,
          calendar,
          hasGameSource: sources.sourceFor(input.team.league) !== undefined,
        }),
    });
  }),
);
