import { DateTime } from "effect";

import type { LineupRun } from "#contexts/connections/LineupRun.ts";
import type { ProfessionalGame } from "#contexts/connections/ProfessionalGame.ts";
import type {
  ScheduleGateDecision,
  ScheduleGateRunReason,
  TodayLineupRun,
} from "#contexts/connections/ScheduleGate.ts";

import { gameCanBePlayed, gameInvolvesTeam, nextGameForTeams } from "./LeagueSchedule.ts";

const lineupTickIntervalMinutes = 60;

export function nextLineupTick(now: DateTime.Utc): DateTime.Utc {
  return DateTime.add(now, { minutes: lineupTickIntervalMinutes });
}

export function todayRunOf(runs: ReadonlyArray<LineupRun>): TodayLineupRun {
  const verified = runs.some(
    (run) =>
      run.outcome?.verified === true &&
      (run.outcome.kind === "changed" || run.outcome.kind === "no_op"),
  );
  if (verified) {
    return { kind: "verified" };
  }
  const latest = runs[0];
  if (latest === undefined) {
    return { kind: "none" };
  }
  return latest.outcome?.kind === "blocked" ? { kind: "blocked" } : { kind: "unverified" };
}

export function decideScheduleGate(input: {
  readonly now: DateTime.Utc;
  readonly dayStartedAt: DateTime.Utc;
  readonly dayEndsAt: DateTime.Utc;
  readonly today: string;
  readonly nextTickAt: DateTime.Utc;
  readonly nextTickDate: string;
  readonly games: ReadonlyArray<ProfessionalGame>;
  readonly providerGameKeys: ReadonlySet<string>;
  readonly teamKeys: ReadonlySet<string>;
  readonly todayRun: TodayLineupRun;
}): ScheduleGateDecision {
  for (const key of input.providerGameKeys) {
    const games = input.games.filter(
      (game) => gameCanBePlayed(game) && gameInvolvesTeam(game, new Set([key])),
    );
    if (games.some((game) => game.startTime === null)) {
      return run("game_start_unknown");
    }
    if (
      !games.some(
        (game) =>
          game.startTime !== null &&
          DateTime.toEpochMillis(game.startTime.instant) >=
            DateTime.toEpochMillis(input.dayStartedAt) &&
          DateTime.toEpochMillis(game.startTime.instant) < DateTime.toEpochMillis(input.dayEndsAt),
      )
    ) {
      return run("provider_game_missing_from_source");
    }
  }

  for (const game of input.games) {
    if (!gameInvolvesTeam(game, input.teamKeys)) {
      continue;
    }
    if (game.startTime === null) {
      if (game.date >= input.today && game.date <= input.nextTickDate) {
        return run("game_start_unknown");
      }
      continue;
    }
    const start = DateTime.toEpochMillis(game.startTime.instant);
    if (
      gameCanBePlayed(game) &&
      start > DateTime.toEpochMillis(input.now) &&
      start <= DateTime.toEpochMillis(input.nextTickAt)
    ) {
      return run("game_before_next_tick");
    }
  }

  switch (input.todayRun.kind) {
    case "none":
      return run("no_run_today");
    case "blocked":
      return run("last_run_blocked");
    case "unverified":
      return run("last_run_unverified");
    case "verified":
      break;
  }

  const nextGame = nextGameForTeams({
    games: input.games,
    providerTeamKeys: input.teamKeys,
    after: input.now,
  });
  return {
    kind: "skip",
    summary:
      nextGame === undefined || nextGame.startTime === null
        ? `No rostered player has a game in the next seven days. The next scheduled check is ${formatTick(input.nextTickAt)}.`
        : `Nothing to check before ${formatTick(input.nextTickAt)}. The next game is ${formatGameStart(nextGame)}.`,
    ...(nextGame === undefined || nextGame.startTime === null
      ? {}
      : { nextGameAt: nextGame.startTime.instant }),
  };
}

function run(reason: ScheduleGateRunReason): ScheduleGateDecision {
  return { kind: "run", reason };
}

function formatDate(at: DateTime.Utc): string {
  return DateTime.formatIsoDate(at);
}

function formatTick(at: DateTime.Utc): string {
  const parts = DateTime.toPartsUtc(at);
  return `${formatDate(at)} ${pad(parts.hour)}:${pad(parts.minute)} UTC`;
}

function formatGameStart(game: ProfessionalGame): string {
  if (game.startTime === null) {
    return "an unstated time";
  }
  const parts = DateTime.toPartsUtc(game.startTime.instant);
  const weekday = weekdayNames[parts.weekDay] ?? "day";
  return `${weekday} ${formatDate(game.startTime.instant)} at ${pad(parts.hour)}:${pad(parts.minute)} UTC`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
