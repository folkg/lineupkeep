import { Schema } from "effect";
import type { DateTime } from "effect";

import { endOfFantasyDay } from "#contexts/connections/FantasyDay.ts";
import { ProfessionalGame } from "#contexts/connections/ProfessionalGame.ts";
import type { ProviderFantasyDay } from "#contexts/connections/Provider.ts";

export const scheduleObservationSubjectKinds = [
  "professional_team",
  "professional_game",
  "fantasy_team",
] as const;
export type ScheduleObservationSubjectKind = (typeof scheduleObservationSubjectKinds)[number];

export const scheduleObservationKinds = [
  "league_season",
  "professional_game",
  "provider_opponent",
] as const;
export type ScheduleObservationKind = (typeof scheduleObservationKinds)[number];

export const scheduleObservationConfidences = [
  "authoritative",
  "corroborated",
  "reported",
] as const;
export type ScheduleObservationConfidence = (typeof scheduleObservationConfidences)[number];

export type ScheduleObservationWindow = {
  readonly from: string;
  readonly to: string;
};

export type ScheduleObservationRefreshPolicy = {
  readonly maximumAgeEndsAt: (
    window: ScheduleObservationWindow,
    fantasyDay: ProviderFantasyDay,
  ) => DateTime.Utc;
  readonly reReadWhen: (
    window: ScheduleObservationWindow,
    now: DateTime.Utc,
    fantasyDay: ProviderFantasyDay,
  ) => boolean;
};

export const scheduleObservationRefreshPolicies: {
  readonly provider_opponent: ScheduleObservationRefreshPolicy;
} = {
  provider_opponent: {
    maximumAgeEndsAt: (window, fantasyDay) => endOfFantasyDay(window.to, fantasyDay),
    reReadWhen: () => false,
  },
};

const providerOpponentPlayer = Schema.Struct({
  providerPlayerKey: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  proTeamKey: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  proTeamAbbreviation: Schema.NullOr(Schema.NonEmptyString),
  games: Schema.Array(
    Schema.Struct({
      opponent: Schema.NonEmptyString,
      home: Schema.Boolean,
    }),
  ),
});

export const providerOpponentValue = Schema.Struct({
  players: Schema.Array(providerOpponentPlayer),
});
export type ProviderOpponentValue = typeof providerOpponentValue.Type;

export const professionalGameValue = ProfessionalGame;
