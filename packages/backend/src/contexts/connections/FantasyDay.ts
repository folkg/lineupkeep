import { DateTime, Schema } from "effect";

import { Provider } from "./Connection.ts";
import { FantasyLeague } from "./FantasyTeam.ts";

export const FantasyDayPolicy = Schema.Struct({
  provider: Provider,
  league: FantasyLeague,
  timeZone: Schema.NonEmptyString,
  boundary: Schema.Literal("local-midnight"),
  version: Schema.NonEmptyString,
});
export type FantasyDayPolicy = typeof FantasyDayPolicy.Type;

const yahooPacificMidnight = {
  timeZone: "America/Los_Angeles",
  boundary: "local-midnight" as const,
  version: "yahoo-pacific-midnight/1",
};

export function fantasyDayPolicy(provider: Provider, league: FantasyLeague): FantasyDayPolicy {
  return {
    provider,
    league,
    ...yahooPacificMidnight,
  };
}

export function nextFantasyDayBoundary(now: DateTime.Utc, policy: FantasyDayPolicy): DateTime.Utc {
  const zoned = DateTime.setZoneNamedUnsafe(now, policy.timeZone);
  const startOfToday = DateTime.startOf(zoned, "day");
  return DateTime.toUtc(DateTime.add(startOfToday, { days: 1 }));
}

export function fantasyDayLabel(now: DateTime.Utc, policy: FantasyDayPolicy): string {
  return DateTime.formatIsoDate(DateTime.setZoneNamedUnsafe(now, policy.timeZone));
}
