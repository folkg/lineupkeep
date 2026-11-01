import { DateTime, Effect, Layer, Option, Schema } from "effect";

import { FantasyLeague } from "#contexts/connections/FantasyTeam.ts";
import { GameSourceRegistry } from "#contexts/connections/GameSource.ts";
import { ProfessionalCalendarUnavailable } from "#contexts/connections/ProfessionalCalendar.ts";
import { ProfessionalCalendar } from "#contexts/connections/ProfessionalCalendar.ts";
import { professionalGameFreshness } from "#contexts/connections/ProfessionalGame.ts";

import { ObservedFactRepository } from "./ObservedFactRepository.ts";
import { readProfessionalGameWeek } from "./ProfessionalGameFacts.ts";

const ReadLeagueWeek = Schema.Struct({
  league: FantasyLeague,
  weekStart: Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u))),
  freshness: Schema.Literals(professionalGameFreshness),
});

export const ProfessionalCalendarLive = Layer.effect(
  ProfessionalCalendar,
  Effect.gen(function* () {
    const facts = yield* ObservedFactRepository;
    const sources = yield* GameSourceRegistry;

    const readLeagueWeek: ProfessionalCalendar["Service"]["readLeagueWeek"] = Effect.fn(
      "ProfessionalCalendar.readLeagueWeek",
    )(function* (unchecked) {
      const input = yield* Schema.decodeEffect(ReadLeagueWeek)(unchecked).pipe(
        Effect.mapError(() =>
          ProfessionalCalendarUnavailable.make({
            league: unchecked.league,
            reason: "invalid_week",
          }),
        ),
      );
      const weekStart = calendarDateOf(input.weekStart);
      if (weekStart === undefined) {
        return yield* ProfessionalCalendarUnavailable.make({
          league: input.league,
          reason: "invalid_week",
        });
      }
      const covered = sources.sourceFor(input.league);
      if (covered === undefined) {
        return yield* ProfessionalCalendarUnavailable.make({
          league: input.league,
          reason: "no_source",
        });
      }
      return yield* readProfessionalGameWeek({
        facts,
        source: covered.source,
        coverage: covered.coverage,
        league: input.league,
        weekStart,
        freshness: input.freshness,
      });
    });

    return { readLeagueWeek };
  }),
);

function calendarDateOf(value: string): string | undefined {
  const parsed = DateTime.make(`${value}T00:00:00.000Z`);
  if (Option.isNone(parsed)) {
    return undefined;
  }
  return DateTime.formatIsoDate(DateTime.toUtc(parsed.value)) === value ? value : undefined;
}
