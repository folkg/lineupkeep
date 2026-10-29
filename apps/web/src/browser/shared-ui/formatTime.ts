const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const minuteMillis = 60_000;
const hourMillis = 60 * minuteMillis;
const dayMillis = 24 * hourMillis;
const relativeWindowMillis = 7 * dayMillis;

export function formatDateTime(value: string | Date): string {
  return dateTimeFormat.format(toDate(value));
}

export function formatReaderTime(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value);
  const difference = date.getTime() - now.getTime();
  const magnitude = Math.abs(difference);

  if (magnitude < minuteMillis) {
    return difference >= 0 ? "in less than a minute" : "just now";
  }
  if (magnitude < hourMillis) {
    return relativeTimeFormat.format(Math.round(difference / minuteMillis), "minute");
  }
  if (magnitude < dayMillis) {
    return relativeTimeFormat.format(Math.round(difference / hourMillis), "hour");
  }
  if (magnitude < relativeWindowMillis) {
    return relativeTimeFormat.format(Math.round(difference / dayMillis), "day");
  }
  return dateTimeFormat.format(date);
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
