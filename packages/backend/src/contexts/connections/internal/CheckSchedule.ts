import { DateTime } from "effect";

const hourMillis = 60 * 60 * 1000;
const checkMinuteMillis = 55 * 60 * 1000;

export function nextCheckAt(at: DateTime.Utc): DateTime.Utc {
  const millis = DateTime.toEpochMillis(at);
  const hourStart = millis - (millis % hourMillis);
  const candidate = hourStart + checkMinuteMillis;
  return DateTime.makeUnsafe(candidate > millis ? candidate : candidate + hourMillis);
}
