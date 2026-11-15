const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const rangeStartFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const rangeTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long" });

const calendarDateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const minuteMillis = 60_000;
const hourMillis = 60 * minuteMillis;
const dayMillis = 24 * hourMillis;
const relativeWindowMillis = 7 * dayMillis;

export function formatDateTime(value: string | Date): string {
  return dateTimeFormat.format(toDate(value));
}

export function formatRangeStart(from: string | Date, to: string | Date): string {
  const start = toDate(from);
  const end = toDate(to);
  if (!sameReaderDay(start, end)) {
    return dateTimeFormat.format(start);
  }
  return `${rangeStartFormat.format(start)}, ${rangeTimeFormat.format(start)}`;
}

export function formatRangeEnd(from: string | Date, to: string | Date): string {
  const start = toDate(from);
  const end = toDate(to);
  return sameReaderDay(start, end) ? rangeTimeFormat.format(end) : dateTimeFormat.format(end);
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

export function formatWeekday(value: string | Date): string {
  return weekdayFormat.format(toDate(value));
}

export function formatCalendarDate(value: string): string {
  return calendarDateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export function formatClockTime(value: string | Date, reader: ClockReader = {}): string {
  const format =
    reader.locale === undefined && reader.timeZone === undefined
      ? rangeTimeFormat
      : new Intl.DateTimeFormat(reader.locale, {
          hour: "numeric",
          minute: "2-digit",
          ...(reader.timeZone === undefined ? {} : { timeZone: reader.timeZone }),
        });
  return format.format(toDate(value)).replace(/\b(AM|PM)\b/gu, (period) => period.toLowerCase());
}

export type ClockReader = {
  readonly locale?: string;
  readonly timeZone?: string;
};

function sameReaderDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
