import { Schema } from "effect";

import { ConnectionId, ProviderKey } from "./Connection.ts";

export const TeamId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("TeamId"));
export type TeamId = typeof TeamId.Type;
export const decodeTeamId = Schema.decodeUnknownSync(TeamId);

export const FantasyLeague = Schema.Literals(["nfl", "nhl", "mlb", "nba"]);
export type FantasyLeague = typeof FantasyLeague.Type;

export const fantasySports = ["football", "hockey", "baseball", "basketball"] as const;
export const FantasySport = Schema.Literals(fantasySports);
export type FantasySport = typeof FantasySport.Type;

export const TeamAvailability = Schema.Literals(["available", "unavailable"]);
export type TeamAvailability = typeof TeamAvailability.Type;

export const TeamAutomationStatus = Schema.Literals([
  "disabled",
  "enabled",
  "paused-until-fantasy-day-end",
]);
export type TeamAutomationStatus = typeof TeamAutomationStatus.Type;

export const TeamAutomation = Schema.Struct({
  status: TeamAutomationStatus,
  changedAt: Schema.DateTimeUtc,
  pausedAt: Schema.optional(Schema.DateTimeUtc),
  resumesAt: Schema.optional(Schema.DateTimeUtc),
  timeZone: Schema.optional(Schema.NonEmptyString),
  fantasyDay: Schema.optional(Schema.NonEmptyString),
  fantasyDayVersion: Schema.optional(Schema.NonEmptyString),
});
export type TeamAutomation = typeof TeamAutomation.Type;

export const FantasyTeam = Schema.Struct({
  id: TeamId,
  connectionId: ConnectionId,
  provider: ProviderKey,
  providerTeamKey: Schema.NonEmptyString,
  providerLeagueKey: Schema.NonEmptyString,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
  name: Schema.NonEmptyString,
  availability: TeamAvailability,
  automation: TeamAutomation,
  ownerNote: Schema.NullOr(Schema.NonEmptyString),
  ownerNoteUpdatedAt: Schema.NullOr(Schema.DateTimeUtc),
  lastSeenAt: Schema.DateTimeUtc,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});
export type FantasyTeam = typeof FantasyTeam.Type;
