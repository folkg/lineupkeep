import { DateTime } from "effect";
import { dual } from "effect/Function";

import type { ProviderFantasyDay } from "./Provider.ts";

export const currentFantasyDayStart: {
  (day: ProviderFantasyDay): (now: DateTime.Utc) => DateTime.Utc;
  (now: DateTime.Utc, day: ProviderFantasyDay): DateTime.Utc;
} = dual(2, (now: DateTime.Utc, day: ProviderFantasyDay): DateTime.Utc => {
  const zoned = DateTime.setZoneNamedUnsafe(now, day.timeZone);
  return DateTime.toUtc(DateTime.startOf(zoned, "day"));
});

export const nextFantasyDayBoundary: {
  (day: ProviderFantasyDay): (now: DateTime.Utc) => DateTime.Utc;
  (now: DateTime.Utc, day: ProviderFantasyDay): DateTime.Utc;
} = dual(2, (now: DateTime.Utc, day: ProviderFantasyDay): DateTime.Utc => {
  const zoned = DateTime.setZoneNamedUnsafe(now, day.timeZone);
  const startOfToday = DateTime.startOf(zoned, "day");
  return DateTime.toUtc(DateTime.add(startOfToday, { days: 1 }));
});

export const fantasyDayLabel: {
  (day: ProviderFantasyDay): (now: DateTime.Utc) => string;
  (now: DateTime.Utc, day: ProviderFantasyDay): string;
} = dual(2, (now: DateTime.Utc, day: ProviderFantasyDay): string =>
  DateTime.formatIsoDate(DateTime.setZoneNamedUnsafe(now, day.timeZone)),
);

export const startOfFantasyDay: {
  (day: ProviderFantasyDay): (date: string) => DateTime.Utc;
  (date: string, day: ProviderFantasyDay): DateTime.Utc;
} = dual(2, (date: string, day: ProviderFantasyDay): DateTime.Utc =>
  DateTime.toUtc(
    DateTime.makeZonedUnsafe(`${date}T00:00:00`, {
      timeZone: day.timeZone,
      adjustForTimeZone: true,
    }),
  ),
);

export const endOfFantasyDay: {
  (day: ProviderFantasyDay): (date: string) => DateTime.Utc;
  (date: string, day: ProviderFantasyDay): DateTime.Utc;
} = dual(2, (date: string, day: ProviderFantasyDay): DateTime.Utc => {
  const start = DateTime.makeZonedUnsafe(`${date}T00:00:00`, {
    timeZone: day.timeZone,
    adjustForTimeZone: true,
  });
  return DateTime.toUtc(DateTime.add(start, { days: 1 }));
});
