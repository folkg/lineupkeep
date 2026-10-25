import { DateTime, Schema } from "effect";

import { Provider } from "./Connection.ts";
import { FantasyLeague } from "./FantasyTeam.ts";

/**
 * The provider's fantasy-day boundary. Yahoo's public deadline guidance uses
 * Pacific time, but its exact rollover has not been verified live. Keep the
 * policy explicit and versioned so a future confirmation changes one seam.
 */
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
  switch (provider) {
    case "yahoo":
      return {
        provider,
        league,
        ...yahooPacificMidnight,
      };
  }
}

/**
 * The next Pacific calendar midnight after `now`, computed with named-zone
 * calendar arithmetic so 23- and 25-hour days are handled without a fixed
 * offset. The result is an absolute instant.
 */
export function nextFantasyDayBoundary(now: DateTime.Utc, policy: FantasyDayPolicy): DateTime.Utc {
  const zoned = DateTime.setZoneNamedUnsafe(now, policy.timeZone);
  const startOfToday = DateTime.startOf(zoned, "day");
  return DateTime.toUtc(DateTime.add(startOfToday, { days: 1 }));
}

/** The local calendar date the paused fantasy day belongs to. */
export function fantasyDayLabel(now: DateTime.Utc, policy: FantasyDayPolicy): string {
  return DateTime.formatIsoDate(DateTime.setZoneNamedUnsafe(now, policy.timeZone));
}

export function hasFantasyDayEnded(
  now: DateTime.Utc,
  resumeAt: DateTime.Utc,
): boolean {
  return DateTime.toEpochMillis(now) >= DateTime.toEpochMillis(resumeAt);
}
