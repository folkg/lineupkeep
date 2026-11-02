import { DateTime, Effect, Layer, Option, Schema } from "effect";

import { FantasyLeague } from "#contexts/connections/FantasyTeam.ts";
import { GameSourceRegistry } from "#contexts/connections/GameSource.ts";
import type { ProfessionalGameWeek } from "#contexts/connections/ProfessionalCalendar.ts";
import { ProfessionalCalendarUnavailable } from "#contexts/connections/ProfessionalCalendar.ts";
import { ProfessionalCalendar } from "#contexts/connections/ProfessionalCalendar.ts";
import { professionalGameFreshness } from "#contexts/connections/ProfessionalGame.ts";

import { readProfessionalGameWeek } from "./ProfessionalGameFacts.ts";
import { ScheduleObservationRepository } from "./ScheduleObservationRepository.ts";

const CalendarDate = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)));

const ReadLeagueWeek = Schema.Struct({
  league: FantasyLeague,
  weekStart: CalendarDate,
  freshness: Schema.Literals(professionalGameFreshness),
  notBefore: Schema.optional(Schema.DateTimeUtc),
});

const ReadGames = Schema.Struct({
  league: FantasyLeague,
  from: CalendarDate,
  to: CalendarDate,
  freshness: Schema.Literals(professionalGameFreshness),
  notBefore: Schema.optional(Schema.DateTimeUtc),
});

export const ProfessionalCalendarLive = Layer.effect(
  ProfessionalCalendar,
  Effect.gen(function* () {
    const store = yield* ScheduleObservationRepository;
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
        store,
        source: covered.source,
        coverage: covered.coverage,
        league: input.league,
        weekStart,
        freshness: input.freshness,
        ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
      });
    });

    const readGames: ProfessionalCalendar["Service"]["readGames"] = Effect.fn(
      "ProfessionalCalendar.readGames",
    )(function* (unchecked) {
      const input = yield* Schema.decodeEffect(ReadGames)(unchecked).pipe(
        Effect.mapError(() =>
          ProfessionalCalendarUnavailable.make({
            league: unchecked.league,
            reason: "invalid_window",
          }),
        ),
      );
      const from = calendarDateOf(input.from);
      const to = calendarDateOf(input.to);
      if (from === undefined || to === undefined || from > to) {
        return yield* ProfessionalCalendarUnavailable.make({
          league: input.league,
          reason: "invalid_window",
        });
      }
      const covered = sources.sourceFor(input.league);
      if (covered === undefined) {
        return yield* ProfessionalCalendarUnavailable.make({
          league: input.league,
          reason: "no_source",
        });
      }
      const weeks: Array<ProfessionalGameWeek> = [];
      for (let weekStart = from; weekStart <= to;) {
        weeks.push(
          yield* readProfessionalGameWeek({
            store,
            source: covered.source,
            coverage: covered.coverage,
            league: input.league,
            weekStart,
            freshness: input.freshness,
            ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
          }),
        );
        weekStart = addDays(weekStart, covered.source.capabilities.weekDays);
      }
      const served = weeks.map((week) => ({
        ...week,
        games: week.games.filter((fact) => fact.game.date >= from && fact.game.date <= to),
      }));
      return {
        league: input.league,
        from,
        to,
        source: covered.source.key,
        teamCount: covered.coverage.teamCount,
        observedAt: oldestObservedAt(served),
        games: served
          .flatMap((week) => week.games)
          .toSorted(
            (left, right) =>
              left.game.date.localeCompare(right.game.date) ||
              left.sourceReference.localeCompare(right.sourceReference),
          ),
        unresolvedTeams: served.flatMap((week) => week.unresolvedTeams),
      };
    });

    return { readLeagueWeek, readGames };
  }),
);

function calendarDateOf(value: string): string | undefined {
  const parsed = DateTime.make(`${value}T00:00:00.000Z`);
  if (Option.isNone(parsed)) {
    return undefined;
  }
  return DateTime.formatIsoDate(DateTime.toUtc(parsed.value)) === value ? value : undefined;
}

function addDays(date: string, days: number): string {
  const parsed = DateTime.makeUnsafe(`${date}T00:00:00.000Z`);
  return DateTime.formatIsoDate(DateTime.add(parsed, { days }));
}

function oldestObservedAt(
  weeks: ReadonlyArray<{ readonly observedAt: DateTime.Utc }>,
): DateTime.Utc {
  let oldest: DateTime.Utc | undefined;
  for (const week of weeks) {
    if (
      oldest === undefined ||
      DateTime.toEpochMillis(week.observedAt) < DateTime.toEpochMillis(oldest)
    ) {
      oldest = week.observedAt;
    }
  }
  if (oldest === undefined) {
    throw new Error("A served game window must cover at least one week");
  }
  return oldest;
}
