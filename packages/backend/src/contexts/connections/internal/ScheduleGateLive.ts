import { Effect, Layer } from "effect";

import { GameSourceRegistry } from "#contexts/connections/GameSource.ts";
import { ProfessionalCalendar } from "#contexts/connections/ProfessionalCalendar.ts";
import { ScheduleGate } from "#contexts/connections/ScheduleGate.ts";

import { LineupRunRepository } from "./LineupRunRepository.ts";
import { evaluateScheduleGate } from "./LineupScheduleGate.ts";
import { ScheduleObservationRepository } from "./ScheduleObservationRepository.ts";

export const ScheduleGateLive = Layer.effect(
  ScheduleGate,
  Effect.gen(function* () {
    const store = yield* ScheduleObservationRepository;
    const calendar = yield* ProfessionalCalendar;
    const runs = yield* LineupRunRepository;
    const sources = yield* GameSourceRegistry;

    return ScheduleGate.of({
      evaluate: (input) =>
        evaluateScheduleGate({
          ...input,
          store,
          calendar,
          runs,
          hasGameSource: sources.sourceFor(input.team.league) !== undefined,
        }),
    });
  }),
);
