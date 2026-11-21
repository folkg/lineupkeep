import { DateTime } from "effect";
import { dual } from "effect/Function";

const hourMillis = 60 * 60 * 1000;
const checkMinuteMillis = 55 * 60 * 1000;

export function nextCheckAt(at: DateTime.Utc): DateTime.Utc {
  const millis = DateTime.toEpochMillis(at);
  const hourStart = millis - (millis % hourMillis);
  const candidate = hourStart + checkMinuteMillis;
  return DateTime.makeUnsafe(candidate > millis ? candidate : candidate + hourMillis);
}

export const firstCheckOnDay: {
  (timeZone: string): (date: string) => DateTime.Utc;
  (date: string, timeZone: string): DateTime.Utc;
} = dual(2, (date: string, timeZone: string): DateTime.Utc => {
  const start = DateTime.toUtc(
    DateTime.makeZonedUnsafe(`${date}T00:00:00`, {
      timeZone,
      adjustForTimeZone: true,
    }),
  );
  return nextCheckAt(start);
});
