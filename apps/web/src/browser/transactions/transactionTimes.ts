import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type { ClockReader } from "#browser/shared-ui/formatTime.ts";
import type { TransactionMoveView } from "#contracts/connections/transactionContract.ts";

const clockFormats = new Map<string, Intl.DateTimeFormat>();

function formatRunClock(value: string | Date, reader: ClockReader = {}): string {
  return clockFormat(reader).format(toDate(value));
}

function ranNowLine(runAt: string | Date, reader: ClockReader = {}): string {
  return `Ran now at ${formatRunClock(runAt, reader)}`;
}

function ranOnScheduleLine(runAt: string | Date, reader: ClockReader = {}): string {
  return `Ran on schedule at ${formatRunClock(runAt, reader)}`;
}

export function scheduledRunLine(
  runDay: string,
  nextRunAt: string | Date | undefined,
  reader: ClockReader = {},
): string {
  return nextRunAt === undefined
    ? `Runs ${formatCalendarDate(runDay)}`
    : `Runs ${formatCalendarDate(runDay)} at ${formatRunClock(nextRunAt, reader)}`;
}

export function formatLocalDate(value: string | Date, reader: ClockReader = {}): string {
  return dateFormat(reader).format(toDate(value));
}

export function moveTimingLine(input: {
  readonly move: TransactionMoveView;
  readonly today: boolean;
  readonly nextRunAt: string | undefined;
  readonly reader?: ClockReader;
}): string | undefined {
  const move = input.move;
  if (move.result === "executed") {
    if (move.runAt === undefined) {
      return move.runDecidedBy === "system" ? "Ran on schedule." : "Ran now.";
    }
    return move.runDecidedBy === "system"
      ? ranOnScheduleLine(move.runAt, input.reader)
      : ranNowLine(move.runAt, input.reader);
  }
  if (move.result !== undefined) {
    return undefined;
  }
  if (input.today) {
    return undefined;
  }
  if (move.runDay === undefined) {
    return undefined;
  }
  return move.decision === "confirmed"
    ? scheduledRunLine(move.runDay, input.nextRunAt, input.reader)
    : `Waits for ${formatCalendarDate(move.runDay)}. Confirming runs the group that day`;
}

export function resultRunLabel(move: TransactionMoveView): string {
  return move.runDecidedBy === "system" ? "Ran on schedule" : "Ran now";
}

function clockFormat(reader: ClockReader): Intl.DateTimeFormat {
  const key = `${reader.locale ?? ""}|${reader.timeZone ?? ""}`;
  const held = clockFormats.get(key);
  if (held !== undefined) {
    return held;
  }
  const format = new Intl.DateTimeFormat(reader.locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(reader.timeZone === undefined ? {} : { timeZone: reader.timeZone }),
  });
  clockFormats.set(key, format);
  return format;
}

function dateFormat(reader: ClockReader): Intl.DateTimeFormat {
  const key = `date|${reader.locale ?? ""}|${reader.timeZone ?? ""}`;
  const held = clockFormats.get(key);
  if (held !== undefined) {
    return held;
  }
  const format = new Intl.DateTimeFormat(reader.locale, {
    day: "numeric",
    month: "long",
    ...(reader.timeZone === undefined ? {} : { timeZone: reader.timeZone }),
  });
  clockFormats.set(key, format);
  return format;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
