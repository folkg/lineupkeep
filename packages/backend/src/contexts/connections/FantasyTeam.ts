import { Schema } from "effect";

import { ConnectionId, Provider } from "./Connection.ts";

export const TeamId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("TeamId"));
export type TeamId = typeof TeamId.Type;
export const decodeTeamId = Schema.decodeUnknownSync(TeamId);

export const FantasyLeague = Schema.Literals(["nfl", "nhl"]);
export type FantasyLeague = typeof FantasyLeague.Type;

export const FantasySport = Schema.Literals(["football", "hockey"]);
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
  policyVersion: Schema.optional(Schema.NonEmptyString),
});
export type TeamAutomation = typeof TeamAutomation.Type;

export const FantasyTeam = Schema.Struct({
  id: TeamId,
  connectionId: ConnectionId,
  provider: Provider,
  providerTeamKey: Schema.NonEmptyString,
  providerLeagueKey: Schema.NonEmptyString,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
  name: Schema.NonEmptyString,
  availability: TeamAvailability,
  automation: TeamAutomation,
  lastSeenAt: Schema.DateTimeUtc,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});
export type FantasyTeam = typeof FantasyTeam.Type;
