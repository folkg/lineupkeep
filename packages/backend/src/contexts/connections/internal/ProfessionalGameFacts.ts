import { DateTime, Effect } from "effect";

import type { FantasyLeague } from "#contexts/connections/FantasyTeam.ts";
import type {
  GameSourceCoverage,
  GameSourceGame,
  GameSourceLeagueWeek,
  GameSourceShape,
  GameSourceTeam,
} from "#contexts/connections/GameSource.ts";
import { GameSourceResponseInvalid } from "#contexts/connections/GameSource.ts";
import type { GameSourceFailure, GameSourceKey } from "#contexts/connections/GameSource.ts";
import type {
  ProfessionalGameFact,
  ProfessionalGameWeek,
  UnresolvedProfessionalTeam,
} from "#contexts/connections/ProfessionalCalendar.ts";
import { ProfessionalGameFactStale } from "#contexts/connections/ProfessionalCalendar.ts";
import type {
  ProfessionalGame,
  ProfessionalGameFreshness,
  ProfessionalGameTeam,
} from "#contexts/connections/ProfessionalGame.ts";
import { professionalGameIsFresh } from "#contexts/connections/ProfessionalGame.ts";
import type { QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";

import type {
  ObservedFactRepository,
  ProfessionalGameObservation,
  ProfessionalGameObservationWrite,
} from "./ObservedFactRepository.ts";
import { resolveProfessionalTeams } from "./ProfessionalTeamIdentity.ts";

export function readProfessionalGameWeek(input: {
  readonly facts: ObservedFactRepository["Service"];
  readonly source: GameSourceShape;
  readonly coverage: GameSourceCoverage;
  readonly league: FantasyLeague;
  readonly weekStart: string;
  readonly freshness: ProfessionalGameFreshness;
  readonly notBefore?: DateTime.Utc;
}): Effect.Effect<
  ProfessionalGameWeek,
  ProfessionalGameFactStale | GameSourceFailure | QueryPersistenceFailed
> {
  const weekEnd = addDays(input.weekStart, input.source.capabilities.weekDays - 1);
  const read = Effect.fn("ProfessionalGameFacts.readLeagueWeek")(function* () {
    const now = yield* DateTime.now;
    const stored = (yield* input.facts.readProfessionalGames({
      from: input.weekStart,
      to: weekEnd,
    })).filter(
      (row) =>
        row.value.league === input.league &&
        row.window.from === input.weekStart &&
        row.window.to === weekEnd,
    );
    const current = newestObservation(stored);
    const unresolved = current.flatMap(unresolvedTeamsOf);
    const awaitingMapping =
      unresolved.length > 0 &&
      (yield* input.facts.readProviderTeamIdentities({
        sport: input.coverage.sport,
        identifiers: unresolved.map((team) => team.sourceTeamAbbreviation),
      })).length > 0;
    const settled =
      current.length > 0 &&
      !awaitingMapping &&
      current.every((row) =>
        professionalGameIsFresh({
          game: row.value,
          observedAt: row.observedAt,
          now,
          freshness: input.freshness,
          ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
        }),
      );
    if (settled) {
      return servedWeek({
        games: current.map((row) => gameFactOf(input.source.key, row)),
        observedAt: newestObservedAt(current),
        league: input.league,
        weekStart: input.weekStart,
        weekEnd,
        source: input.source.key,
      });
    }

    const week = yield* input.source
      .readLeagueWeek({ league: input.league, weekStart: input.weekStart })
      .pipe(
        Effect.mapError((cause) =>
          current.length === 0
            ? cause
            : ProfessionalGameFactStale.make({
                weekStart: input.weekStart,
                previousObservedAt: newestObservedAt(current),
                cause,
              }),
        ),
      );
    yield* assertWeek(week, input.weekStart, weekEnd, input.source.key);

    const observedAt = yield* DateTime.now;
    const resolution = yield* resolveProfessionalTeams({
      facts: input.facts,
      sport: input.coverage.sport,
      source: input.source.key,
      now: observedAt,
      teams: week.games.flatMap((game) => [game.home, game.away]),
    });
    const observations = week.games.map((game) =>
      observationOf({
        game,
        league: week.league,
        weekStart: input.weekStart,
        weekEnd,
        sourceTeam: (team) => professionalTeamOf(team, resolution.bySourceIdentifier),
        observedAt,
      }),
    );
    yield* input.facts.recordProfessionalGames({
      source: input.source.key,
      confidence: "authoritative",
      observations,
    });
    return servedWeek({
      games: observations.map((row) => gameFactOf(input.source.key, row)),
      observedAt,
      league: input.league,
      weekStart: input.weekStart,
      weekEnd,
      source: input.source.key,
    });
  });
  return read();
}

function observationOf(input: {
  readonly game: GameSourceGame;
  readonly league: FantasyLeague;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly sourceTeam: (team: GameSourceTeam) => ProfessionalGameTeam;
  readonly observedAt: DateTime.Utc;
}): ProfessionalGameObservationWrite {
  return {
    subjectKey: `${input.league}:${input.game.id}`,
    window: { from: input.weekStart, to: input.weekEnd },
    value: {
      league: input.league,
      date: input.game.date,
      startTime: input.game.startTime,
      home: input.sourceTeam(input.game.home),
      away: input.sourceTeam(input.game.away),
      venue: input.game.venue,
      status: input.game.status,
    },
    observedAt: input.observedAt,
    sourceReference: input.game.id,
  };
}

function professionalTeamOf(
  team: GameSourceTeam,
  resolved: ReadonlyMap<string, string | null>,
): ProfessionalGameTeam {
  return {
    providerTeamKey: resolved.get(team.identifier) ?? null,
    sourceTeamIdentifier: team.identifier,
    sourceTeamAbbreviation: team.abbreviation,
    sourceTeamName: team.name,
  };
}

function gameFactOf(
  source: GameSourceKey,
  observation: {
    readonly value: ProfessionalGame;
    readonly observedAt: DateTime.Utc;
    readonly sourceReference: string;
  },
): ProfessionalGameFact {
  return {
    game: observation.value,
    source,
    sourceReference: observation.sourceReference,
    observedAt: observation.observedAt,
  };
}

function assertWeek(
  week: GameSourceLeagueWeek,
  weekStart: string,
  weekEnd: string,
  source: GameSourceKey,
): Effect.Effect<void, GameSourceResponseInvalid> {
  if (week.weekStart !== weekStart || week.weekEnd !== weekEnd) {
    return GameSourceResponseInvalid.make({ source, field: "week" });
  }
  for (const game of week.games) {
    if (game.date < weekStart || game.date > weekEnd) {
      return GameSourceResponseInvalid.make({ source, field: "games.date" });
    }
  }
  return Effect.void;
}

function servedWeek(input: {
  readonly games: ReadonlyArray<ProfessionalGameFact>;
  readonly observedAt: DateTime.Utc;
  readonly league: FantasyLeague;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly source: GameSourceKey;
}): ProfessionalGameWeek {
  const games = input.games.toSorted(
    (left, right) =>
      left.game.date.localeCompare(right.game.date) ||
      left.sourceReference.localeCompare(right.sourceReference),
  );
  return {
    league: input.league,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    source: input.source,
    observedAt: input.observedAt,
    games,
    unresolvedTeams: games.flatMap((fact) => unresolvedTeamsOfFact(fact)),
  };
}

function unresolvedTeamsOfFact(
  fact: ProfessionalGameFact,
): ReadonlyArray<UnresolvedProfessionalTeam> {
  const sides = [
    { side: "home" as const, team: fact.game.home },
    { side: "away" as const, team: fact.game.away },
  ];
  return sides.flatMap(({ side, team }) =>
    team.providerTeamKey === null
      ? [
          {
            game: fact.sourceReference,
            side,
            identifier: team.sourceTeamIdentifier,
            name: team.sourceTeamName,
          },
        ]
      : [],
  );
}

function unresolvedTeamsOf(observation: ProfessionalGameObservation): ReadonlyArray<{
  readonly sourceTeamAbbreviation: string;
}> {
  return [observation.value.home, observation.value.away].flatMap((team) =>
    team.providerTeamKey === null ? [{ sourceTeamAbbreviation: team.sourceTeamAbbreviation }] : [],
  );
}

function newestObservation(
  observations: ReadonlyArray<ProfessionalGameObservation>,
): ReadonlyArray<ProfessionalGameObservation> {
  if (observations.length === 0) {
    return [];
  }
  const newest = DateTime.toEpochMillis(newestObservedAt(observations));
  return observations.filter(
    (observation) => DateTime.toEpochMillis(observation.observedAt) === newest,
  );
}

function newestObservedAt(observations: ReadonlyArray<ProfessionalGameObservation>): DateTime.Utc {
  const newest = observations.reduce<DateTime.Utc | undefined>(
    (latest, observation) =>
      latest === undefined ||
      DateTime.toEpochMillis(observation.observedAt) > DateTime.toEpochMillis(latest)
        ? observation.observedAt
        : latest,
    undefined,
  );
  if (newest === undefined) {
    throw new Error("A served game week must cover at least one observation");
  }
  return newest;
}

function addDays(date: string, days: number): string {
  const parsed = DateTime.makeUnsafe(`${date}T00:00:00.000Z`);
  return DateTime.formatIsoDate(DateTime.add(parsed, { days }));
}
