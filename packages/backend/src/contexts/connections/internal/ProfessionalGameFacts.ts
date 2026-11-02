import { DateTime, Effect } from "effect";

import type { FantasyLeague } from "#contexts/connections/FantasyTeam.ts";
import type {
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
  ProfessionalGameFreshness,
  ProfessionalGameTeam,
  PublishedProfessionalGame,
  PublishedProfessionalGameTeam,
} from "#contexts/connections/ProfessionalGame.ts";
import { professionalGameIsFresh } from "#contexts/connections/ProfessionalGame.ts";
import type { QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";

import type { ProfessionalTeamMatch } from "./ProfessionalTeamMap.ts";
import { matchProfessionalTeam } from "./ProfessionalTeamMap.ts";
import type {
  ScheduleObservationRepository,
  ProfessionalGameObservation,
  ProfessionalGameObservationWrite,
} from "./ScheduleObservationRepository.ts";

export function readProfessionalGameWeek(input: {
  readonly store: ScheduleObservationRepository["Service"];
  readonly source: GameSourceShape;
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
    const stored = (yield* input.store.readProfessionalGames({
      from: input.weekStart,
      to: weekEnd,
    })).filter(
      (row) =>
        row.value.league === input.league &&
        row.window.from === input.weekStart &&
        row.window.to === weekEnd,
    );
    const current = newestObservation(stored);
    const settled =
      current.length > 0 &&
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
        observations: current,
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
    const observations = week.games.map((game) =>
      observationOf({
        game,
        league: week.league,
        weekStart: input.weekStart,
        weekEnd,
        observedAt,
      }),
    );
    yield* input.store.recordProfessionalGames({
      source: input.source.key,
      confidence: "authoritative",
      observations,
    });
    return servedWeek({
      observations,
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
  readonly observedAt: DateTime.Utc;
}): ProfessionalGameObservationWrite {
  return {
    subjectKey: `${input.league}:${input.game.id}`,
    window: { from: input.weekStart, to: input.weekEnd },
    value: {
      league: input.league,
      date: input.game.date,
      startTime: input.game.startTime,
      home: publishedTeamOf(input.game.home),
      away: publishedTeamOf(input.game.away),
      venue: input.game.venue,
      status: input.game.status,
    },
    observedAt: input.observedAt,
    sourceReference: input.game.id,
  };
}

function publishedTeamOf(team: GameSourceTeam): PublishedProfessionalGameTeam {
  return {
    sourceTeamIdentifier: team.identifier,
    sourceTeamAbbreviation: team.abbreviation,
    sourceTeamName: team.name,
  };
}

function servedWeek(input: {
  readonly observations: ReadonlyArray<ObservedGame>;
  readonly observedAt: DateTime.Utc;
  readonly league: FantasyLeague;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly source: GameSourceKey;
}): ProfessionalGameWeek {
  const served = input.observations
    .map((observation) => servedGame({ league: input.league, source: input.source, observation }))
    .toSorted(
      (left, right) =>
        left.fact.game.date.localeCompare(right.fact.game.date) ||
        left.fact.sourceReference.localeCompare(right.fact.sourceReference),
    );
  return {
    league: input.league,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    source: input.source,
    observedAt: input.observedAt,
    games: served.map((entry) => entry.fact),
    unresolvedTeams: served.flatMap((entry) => entry.unresolvedTeams),
  };
}

function servedGame(input: {
  readonly league: FantasyLeague;
  readonly source: GameSourceKey;
  readonly observation: ObservedGame;
}): ServedGame {
  const home = resolveSide(input.league, input.observation.value.home);
  const away = resolveSide(input.league, input.observation.value.away);
  return {
    fact: {
      game: { ...input.observation.value, home: home.team, away: away.team },
      source: input.source,
      sourceReference: input.observation.sourceReference,
      observedAt: input.observation.observedAt,
    },
    unresolvedTeams: [
      ...unresolvedSide(input.observation.sourceReference, "home", home),
      ...unresolvedSide(input.observation.sourceReference, "away", away),
    ],
  };
}

function resolveSide(league: FantasyLeague, team: PublishedProfessionalGameTeam): ResolvedSide {
  const match = matchProfessionalTeam({
    league,
    identifier: team.sourceTeamIdentifier,
    abbreviation: team.sourceTeamAbbreviation,
    name: team.sourceTeamName,
  });
  return {
    team: {
      providerTeamKey: match.kind === "mapped" ? match.providerTeamKey : null,
      ...team,
    },
    reason: unmappedReason(match),
  };
}

function unmappedReason(
  match: ProfessionalTeamMatch,
): UnresolvedProfessionalTeam["reason"] | undefined {
  switch (match.kind) {
    case "mapped":
      return undefined;
    case "not_mapped":
      return "no_map_entry";
    case "disagrees":
      return "map_disagrees";
  }
}

function unresolvedSide(
  game: string,
  side: "home" | "away",
  resolved: ResolvedSide,
): ReadonlyArray<UnresolvedProfessionalTeam> {
  if (resolved.reason === undefined) {
    return [];
  }
  return [
    {
      game,
      side,
      identifier: resolved.team.sourceTeamIdentifier,
      name: resolved.team.sourceTeamName,
      reason: resolved.reason,
    },
  ];
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

type ObservedGame = {
  readonly value: PublishedProfessionalGame;
  readonly observedAt: DateTime.Utc;
  readonly sourceReference: string;
};

type ServedGame = {
  readonly fact: ProfessionalGameFact;
  readonly unresolvedTeams: ReadonlyArray<UnresolvedProfessionalTeam>;
};

type ResolvedSide = {
  readonly team: ProfessionalGameTeam;
  readonly reason: UnresolvedProfessionalTeam["reason"] | undefined;
};
