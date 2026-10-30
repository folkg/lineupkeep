import { DateTime } from "effect";

import type { ProviderFantasyDay } from "./Provider.ts";

export function currentFantasyDayStart(now: DateTime.Utc, day: ProviderFantasyDay): DateTime.Utc {
  const zoned = DateTime.setZoneNamedUnsafe(now, day.timeZone);
  return DateTime.toUtc(DateTime.startOf(zoned, "day"));
}

export function nextFantasyDayBoundary(now: DateTime.Utc, day: ProviderFantasyDay): DateTime.Utc {
  const zoned = DateTime.setZoneNamedUnsafe(now, day.timeZone);
  const startOfToday = DateTime.startOf(zoned, "day");
  return DateTime.toUtc(DateTime.add(startOfToday, { days: 1 }));
}

export function fantasyDayLabel(now: DateTime.Utc, day: ProviderFantasyDay): string {
  return DateTime.formatIsoDate(DateTime.setZoneNamedUnsafe(now, day.timeZone));
}
