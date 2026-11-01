import { DateTime, Schema } from "effect";

import { FantasyLeague } from "./FantasyTeam.ts";

const professionalGameStatuses = [
  "scheduled",
  "in_progress",
  "final",
  "postponed",
  "cancelled",
  "unknown",
] as const;
export type ProfessionalGameStatus = (typeof professionalGameStatuses)[number];

export const ProfessionalGameTeam = Schema.Struct({
  providerTeamKey: Schema.NullOr(Schema.NonEmptyString),
  sourceTeamIdentifier: Schema.NonEmptyString,
  sourceTeamAbbreviation: Schema.NonEmptyString,
  sourceTeamName: Schema.NonEmptyString,
});
export type ProfessionalGameTeam = typeof ProfessionalGameTeam.Type;

export const ProfessionalGame = Schema.Struct({
  league: FantasyLeague,
  date: Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u))),
  startTime: Schema.NullOr(
    Schema.Struct({
      instant: Schema.DateTimeUtcFromString,
      timeZone: Schema.NonEmptyString,
    }),
  ),
  home: ProfessionalGameTeam,
  away: ProfessionalGameTeam,
  venue: Schema.NullOr(Schema.NonEmptyString),
  status: Schema.Literals(professionalGameStatuses),
});
export type ProfessionalGame = typeof ProfessionalGame.Type;

const professionalGameAspects = ["fixture", "startTime", "status"] as const;
type ProfessionalGameAspect = (typeof professionalGameAspects)[number];

export const professionalGameFreshness = ["calendar", "status"] as const;
export type ProfessionalGameFreshness = (typeof professionalGameFreshness)[number];

const professionalGameRefreshPolicy = {
  fixture: { maximumAgeMinutes: 7 * 24 * 60 },
  startTime: {
    withinHours: 48,
    maximumAgeMinutes: 6 * 60,
    otherwiseMaximumAgeMinutes: 7 * 24 * 60,
  },
  status: {
    withinHours: 12,
    maximumAgeMinutes: 30,
    otherwiseMaximumAgeMinutes: 6 * 60,
  },
} as const;

const refreshAspects = {
  calendar: ["fixture", "startTime"],
  status: ["status"],
} as const satisfies Record<ProfessionalGameFreshness, ReadonlyArray<ProfessionalGameAspect>>;

export function professionalGameIsFresh(input: {
  readonly game: ProfessionalGame;
  readonly observedAt: DateTime.Utc;
  readonly now: DateTime.Utc;
  readonly freshness: ProfessionalGameFreshness;
}): boolean {
  const observed = DateTime.toEpochMillis(input.observedAt);
  const now = DateTime.toEpochMillis(input.now);
  const required = Math.min(
    ...refreshAspects[input.freshness].map(
      (aspect) => maximumAgeMinutes(aspect, input.game, now) * 60_000,
    ),
  );
  return now - observed < required;
}

function maximumAgeMinutes(
  aspect: ProfessionalGameAspect,
  game: ProfessionalGame,
  now: number,
): number {
  switch (aspect) {
    case "fixture":
      return professionalGameRefreshPolicy.fixture.maximumAgeMinutes;
    case "startTime":
      return startTimeMaximumAgeMinutes(game, now);
    case "status":
      return statusMaximumAgeMinutes(game, now);
  }
}

function startTimeMaximumAgeMinutes(game: ProfessionalGame, now: number): number {
  const policy = professionalGameRefreshPolicy.startTime;
  const start = startMillis(game);
  return start !== undefined && start >= now && start - now <= policy.withinHours * 3_600_000
    ? policy.maximumAgeMinutes
    : policy.otherwiseMaximumAgeMinutes;
}

function statusMaximumAgeMinutes(game: ProfessionalGame, now: number): number {
  const policy = professionalGameRefreshPolicy.status;
  const start = startMillis(game);
  const unsettled = game.status !== "final" && game.status !== "cancelled";
  const imminent =
    start !== undefined && start - now <= policy.withinHours * 3_600_000 && unsettled;
  return game.status === "in_progress" || imminent
    ? policy.maximumAgeMinutes
    : policy.otherwiseMaximumAgeMinutes;
}

function startMillis(game: ProfessionalGame): number | undefined {
  return game.startTime === null ? undefined : DateTime.toEpochMillis(game.startTime.instant);
}
