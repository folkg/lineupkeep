import { Schema } from "effect";
import type { DateTime } from "effect";

import { endOfFantasyDay } from "#contexts/connections/FantasyDay.ts";
import type { ProviderFantasyDay } from "#contexts/connections/Provider.ts";

export const observedFactSubjectKinds = [
  "professional_team",
  "professional_game",
  "fantasy_team",
] as const;

export const observedFactKinds = [
  "league_season",
  "game_fixture",
  "game_start_time",
  "game_status",
  "game_venue",
  "provider_opponent",
] as const;

export const observedFactConfidences = ["authoritative", "corroborated", "reported"] as const;
export type ObservedFactConfidence = (typeof observedFactConfidences)[number];

export type FactWindow = {
  readonly from: string;
  readonly to: string;
};

export type FactRefreshPolicy = {
  readonly maximumAgeEndsAt: (window: FactWindow, fantasyDay: ProviderFantasyDay) => DateTime.Utc;
  readonly reReadWhen: (
    window: FactWindow,
    now: DateTime.Utc,
    fantasyDay: ProviderFantasyDay,
  ) => boolean;
};

export const factRefreshPolicies: { readonly provider_opponent: FactRefreshPolicy } = {
  provider_opponent: {
    maximumAgeEndsAt: (window, fantasyDay) => endOfFantasyDay(window.to, fantasyDay),
    reReadWhen: () => false,
  },
};

const providerOpponentPlayer = Schema.Struct({
  providerPlayerKey: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
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
