import { DateTime } from "effect";

import type { ProfessionalGame } from "#contexts/connections/ProfessionalGame.ts";
import { leagueOffNightDefinition } from "#contexts/connections/ProfessionalGame.ts";

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
    [...byDate.entries()].map(([date, entry]) => [
      date,
      { date, games: entry.games, teamsPlaying: entry.teams.size },
    ]),
  );
}

function gamesForTeam(
  games: ReadonlyArray<ProfessionalGame>,
  providerTeamKey: string,
): ReadonlyArray<ProfessionalGame> {
  return games.filter(
    (game) =>
      game.home.providerTeamKey === providerTeamKey ||
      game.away.providerTeamKey === providerTeamKey,
  );
}

export function countGamesForTeam(
  games: ReadonlyArray<ProfessionalGame>,
  providerTeamKey: string,
): number {
  return gamesForTeam(games, providerTeamKey).filter(gameCanBePlayed).length;
}

export function gameDatesForTeam(
  games: ReadonlyArray<ProfessionalGame>,
  providerTeamKey: string,
): ReadonlyArray<string> {
  return [
    ...new Set(
      gamesForTeam(games, providerTeamKey)
        .filter(gameCanBePlayed)
        .map((game) => game.date),
    ),
  ].sort();
}

export function nextGameForTeams(input: {
  readonly games: ReadonlyArray<ProfessionalGame>;
  readonly providerTeamKeys: ReadonlySet<string>;
  readonly after: DateTime.Utc;
}): ProfessionalGame | undefined {
  return input.games
    .filter((game) => gameCanBePlayed(game) && gameInvolvesTeam(game, input.providerTeamKeys))
    .filter(
      (game) =>
        game.startTime !== null &&
        DateTime.toEpochMillis(game.startTime.instant) > DateTime.toEpochMillis(input.after),
    )
    .toSorted((left, right) => startMillis(left) - startMillis(right))[0];
}

export function gameInvolvesTeam(
  game: ProfessionalGame,
  providerTeamKeys: ReadonlySet<string>,
): boolean {
  return (
    (game.home.providerTeamKey !== null && providerTeamKeys.has(game.home.providerTeamKey)) ||
    (game.away.providerTeamKey !== null && providerTeamKeys.has(game.away.providerTeamKey))
  );
}

export function gameCanBePlayed(game: ProfessionalGame): boolean {
  return game.status !== "cancelled" && game.status !== "postponed";
}

function startMillis(game: ProfessionalGame): number {
  return game.startTime === null
    ? Number.POSITIVE_INFINITY
    : DateTime.toEpochMillis(game.startTime.instant);
}

function gameTeams(game: ProfessionalGame): ReadonlyArray<string> {
  return [game.home, game.away].map(
    (team) => team.providerTeamKey ?? `source:${team.sourceTeamIdentifier}`,
  );
}
