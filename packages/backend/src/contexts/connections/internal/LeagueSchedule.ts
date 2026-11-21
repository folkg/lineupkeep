import { DateTime } from "effect";
import { Array as EffectArray } from "effect";
import { Order as EffectOrder } from "effect";
import { dual } from "effect/Function";

import type { ProfessionalGame } from "#contexts/connections/ProfessionalGame.ts";
import { leagueOffNightDefinition } from "#contexts/connections/ProfessionalGame.ts";

function sortWithComparator<A>(
  self: ReadonlyArray<A>,
  compare: (left: A, right: A) => number,
): ReadonlyArray<A> {
  return EffectArray.sort(
    self,
    EffectOrder.make<A>((left, right) => {
      const result = compare(left, right);
      return result < 0 ? -1 : result > 0 ? 1 : 0;
    }),
  );
}

const leagueOffNightTeamShare = leagueOffNightDefinition.maximumTeamShare;

export type LeagueGamesOnDate = {
  readonly date: string;
  readonly games: number;
  readonly teamsPlaying: number;
};

export function isLeagueOffNight(input: {
  readonly teamsPlaying: number;
  readonly teamCount: number;
}): boolean {
  return input.teamsPlaying < input.teamCount * leagueOffNightTeamShare;
}

export function leagueGamesByDate(
  games: ReadonlyArray<ProfessionalGame>,
): ReadonlyMap<string, LeagueGamesOnDate> {
  const byDate = new Map<string, { games: number; teams: Set<string> }>();
  for (const game of games) {
    if (!gameCanBePlayed(game)) {
      continue;
    }
    const entry = byDate.get(game.date) ?? { games: 0, teams: new Set<string>() };
    entry.games += 1;
    for (const team of gameTeams(game)) {
      entry.teams.add(team);
    }
    byDate.set(game.date, entry);
  }
  return new Map(
    EffectArray.map([...byDate.entries()], ([date, entry]) => [
      date,
      { date, games: entry.games, teamsPlaying: entry.teams.size },
    ]),
  );
}

export const gamesForTeam: {
  (
    providerTeamKey: string,
  ): (games: ReadonlyArray<ProfessionalGame>) => ReadonlyArray<ProfessionalGame>;
  (
    games: ReadonlyArray<ProfessionalGame>,
    providerTeamKey: string,
  ): ReadonlyArray<ProfessionalGame>;
} = dual(
  2,
  (
    games: ReadonlyArray<ProfessionalGame>,
    providerTeamKey: string,
  ): ReadonlyArray<ProfessionalGame> =>
    EffectArray.filter(
      EffectArray.filter(
        games,
        (game) =>
          game.home.providerTeamKey === providerTeamKey ||
          game.away.providerTeamKey === providerTeamKey,
      ),
      gameCanBePlayed,
    ),
);

export const countGamesForTeam: {
  (providerTeamKey: string): (games: ReadonlyArray<ProfessionalGame>) => number;
  (games: ReadonlyArray<ProfessionalGame>, providerTeamKey: string): number;
} = dual(
  2,
  (games: ReadonlyArray<ProfessionalGame>, providerTeamKey: string): number =>
    gamesForTeam(games, providerTeamKey).length,
);

export const gameDatesForTeam: {
  (providerTeamKey: string): (games: ReadonlyArray<ProfessionalGame>) => ReadonlyArray<string>;
  (games: ReadonlyArray<ProfessionalGame>, providerTeamKey: string): ReadonlyArray<string>;
} = dual(
  2,
  (games: ReadonlyArray<ProfessionalGame>, providerTeamKey: string): ReadonlyArray<string> =>
    [...new Set(EffectArray.map(gamesForTeam(games, providerTeamKey), (game) => game.date))].sort(),
);

export function nextGameForTeams(input: {
  readonly games: ReadonlyArray<ProfessionalGame>;
  readonly providerTeamKeys: ReadonlySet<string>;
  readonly after: DateTime.Utc;
}): ProfessionalGame | undefined {
  return sortWithComparator(
    EffectArray.filter(
      EffectArray.filter(
        input.games,
        (game) => gameCanBePlayed(game) && gameInvolvesTeam(game, input.providerTeamKeys),
      ),
      (game) =>
        game.startTime !== null &&
        DateTime.toEpochMillis(game.startTime.instant) > DateTime.toEpochMillis(input.after),
    ),
    (left, right) => startMillis(left) - startMillis(right),
  )[0];
}

export const gameInvolvesTeam: {
  (providerTeamKeys: ReadonlySet<string>): (game: ProfessionalGame) => boolean;
  (game: ProfessionalGame, providerTeamKeys: ReadonlySet<string>): boolean;
} = dual(
  2,
  (game: ProfessionalGame, providerTeamKeys: ReadonlySet<string>): boolean =>
    (game.home.providerTeamKey !== null && providerTeamKeys.has(game.home.providerTeamKey)) ||
    (game.away.providerTeamKey !== null && providerTeamKeys.has(game.away.providerTeamKey)),
);

export function gameCanBePlayed(game: ProfessionalGame): boolean {
  return game.status !== "cancelled" && game.status !== "postponed";
}

function startMillis(game: ProfessionalGame): number {
  return game.startTime === null
    ? Number.POSITIVE_INFINITY
    : DateTime.toEpochMillis(game.startTime.instant);
}

function gameTeams(game: ProfessionalGame): ReadonlyArray<string> {
  return EffectArray.map(
    [game.home, game.away],
    (team) => team.providerTeamKey ?? `source:${team.sourceTeamIdentifier}`,
  );
}
