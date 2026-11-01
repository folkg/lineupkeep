import { DateTime, Schema } from "effect";

import { ConnectionId, ProviderKey } from "./Connection.ts";

export const TeamId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("TeamId"));
export type TeamId = typeof TeamId.Type;
export const decodeTeamId = Schema.decodeUnknownSync(TeamId);

export const FantasyLeague = Schema.Literals(["nfl", "nhl", "mlb", "nba"]);
export type FantasyLeague = typeof FantasyLeague.Type;

export const FantasySport = Schema.Literals(["football", "hockey", "baseball", "basketball"]);
export type FantasySport = typeof FantasySport.Type;

export const TeamUnavailabilityReason = Schema.Literals([
  "provider_refused",
  "not_listed",
  "connection_unavailable",
]);
export type TeamUnavailabilityReason = typeof TeamUnavailabilityReason.Type;

const teamAvailabilityStaleAfterMillis = 3 * 60 * 60 * 1000;

export const TeamAvailability = Schema.Union([
  Schema.Struct({ status: Schema.Literal("unobserved") }),
  Schema.Struct({
    status: Schema.Literal("available"),
    observedAt: Schema.DateTimeUtc,
  }),
  Schema.Struct({
    status: Schema.Literal("stale"),
    observedAt: Schema.DateTimeUtc,
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    reason: TeamUnavailabilityReason,
    detail: Schema.NonEmptyString,
    observedAt: Schema.DateTimeUtc,
    consecutiveRefusals: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
]);
export type TeamAvailability = typeof TeamAvailability.Type;

export function observedTeamAvailability(
  availability: TeamAvailability,
  now: DateTime.Utc,
): TeamAvailability {
  if (availability.status !== "available") {
    return availability;
  }
  const age = DateTime.toEpochMillis(now) - DateTime.toEpochMillis(availability.observedAt);
  return age > teamAvailabilityStaleAfterMillis
    ? { status: "stale", observedAt: availability.observedAt }
    : availability;
}

export function describeUnavailableTeam(
  availability: Extract<TeamAvailability, { readonly status: "unavailable" }>,
): string {
  const seen =
    availability.reason !== "provider_refused"
      ? ""
      : availability.consecutiveRefusals > 1
        ? `Seen on ${String(availability.consecutiveRefusals)} consecutive checks.`
        : "Seen once. The next check will try again. ";
  return `${availability.detail} ${seen}Last observed ${DateTime.formatIso(availability.observedAt)}.`;
}

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
