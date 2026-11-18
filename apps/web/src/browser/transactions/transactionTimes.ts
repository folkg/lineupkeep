import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type { ClockReader } from "#browser/shared-ui/formatTime.ts";
import type {
  TransactionMoveView,
  TransactionWaiverRuleView,
} from "#contracts/connections/transactionContract.ts";

const clockFormats = new Map<string, Intl.DateTimeFormat>();
const dayFormats = new Map<string, Intl.DateTimeFormat>();
const dayKeyFormats = new Map<string, Intl.DateTimeFormat>();

export function scheduledMoment(
  runDay: string,
  nextRunAt: string | Date | undefined,
  reader: ClockReader = {},
): string {
  return nextRunAt === undefined
    ? formatCalendarDate(runDay)
    : `${formatCalendarDate(runDay)} at ${clockFormat(reader).format(toDate(nextRunAt))}`;
}

function formatLocalMoment(
  value: string | Date,
  reader: ClockReader = {},
  now: Date = new Date(),
): string {
  const date = toDate(value);
  const clock = clockFormat(reader).format(date);
  const day = localDay(date, reader);
  const current = localDay(now, reader);
  if (day.key === current.key) {
    return clock;
  }
  return `${dayFormat(reader, day.year !== current.year).format(date)} at ${clock}`;
}

function formatDatedMoment(
  value: string | Date,
  reader: ClockReader = {},
  now: Date = new Date(),
): string {
  const date = toDate(value);
  const day = localDay(date, reader);
  const current = localDay(now, reader);
  return `${dayFormat(reader, day.year !== current.year).format(date)} at ${clockFormat(reader).format(date)}`;
}

export function timingLine(move: TransactionMoveView): string | undefined {
  if (move.kind === "waiver_claim" && move.phase !== "won") {
    return undefined;
  }
  if (move.effectiveDate === undefined) {
    return undefined;
  }
  if (move.runsOn !== undefined && move.runDay !== undefined && move.runsOn > move.runDay) {
    return `Runs ${formatCalendarDate(move.runsOn)}, when it takes effect.`;
  }
  return `Takes effect ${formatCalendarDate(move.effectiveDate)}.`;
}

export function moveOutcomeLabel(move: TransactionMoveView): string | undefined {
  if (move.decision === "discarded") {
    return "Discarded";
  }
  switch (move.phase) {
    case "with_league":
      return "With the league";
    case "won":
      return "Claim won";
    case "lost":
      return move.result === "executed"
        ? "Claim lost, fallback ran"
        : move.result === "failed"
          ? "All choices failed"
          : "Claim lost";
    case undefined:
      break;
  }
  switch (move.result) {
    case "executed":
      return executedLabel(move);
    case "pending":
      return "Waiting for the league";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "unknown":
      return "Unknown outcome";
    case "withdrawn":
      return "Withdrawn";
    case "expired":
      return "Expired";
    case undefined:
      return undefined;
  }
}

export function resultDetailLine(move: TransactionMoveView): string | undefined {
  return move.resultDetail;
}

export function resultTimeLine(
  move: TransactionMoveView,
  reader: ClockReader = {},
  now: Date = new Date(),
): string | undefined {
  return move.resultDetail === undefined || move.resultAt === undefined
    ? undefined
    : `${moveOutcomeLabel(move) ?? "Ended"} ${formatLocalMoment(move.resultAt, reader, now)}.`;
}

export function submittedLine(
  move: TransactionMoveView,
  nextRunAt: string | Date | undefined,
  reader: ClockReader = {},
  now: Date = new Date(),
): string | undefined {
  if (move.confirmation === undefined) {
    return undefined;
  }
  const at = formatDatedMoment(move.confirmation.at, reader, now);
  if (move.decision !== "confirmed" || move.runDay === undefined) {
    return `You submitted this on ${at}.`;
  }
  return move.kind === "waiver_claim" || move.phase !== undefined
    ? `Scheduled on ${at} for ${formatCalendarDate(move.runDay)}.`
    : `Scheduled on ${at} for ${scheduledMoment(move.runDay, nextRunAt, reader)}.`;
}

export function waiverTimingLine(waiver: TransactionWaiverRuleView | undefined): string {
  if (waiver?.rule !== undefined) {
    return `Your league's waiver rule: ${waiver.rule}.`;
  }
  if (waiver?.days !== undefined) {
    return `Your league processes waivers after ${String(waiver.days)} ${waiver.days === 1 ? "day" : "days"}.`;
  }
  if (waiver?.type !== undefined) {
    return `Your league's waiver type: ${waiver.type}.`;
  }
  return "It settles before the next check.";
}

export function discardLine(
  move: TransactionMoveView,
  reader: ClockReader = {},
  now: Date = new Date(),
): string | undefined {
  if (move.decision !== "discarded") {
    return undefined;
  }
  const actor =
    move.decidedBy === "agent"
      ? "An agent"
      : move.decidedBy === "system"
        ? "The scheduled run"
        : "You";
  const surface =
    move.decidedBy === "agent" && move.surface !== undefined ? ` over ${move.surface}` : "";
  return move.decidedAt === undefined
    ? `${actor} discarded this${surface}.`
    : `${actor} discarded this${surface} on ${formatLocalMoment(move.decidedAt, reader, now)}.`;
}

function executedLabel(move: TransactionMoveView): string {
  return move.runDecidedBy === "system" ? "Ran on schedule" : "Ran after you submitted";
}

function clockFormat(reader: ClockReader): Intl.DateTimeFormat {
  return cachedFormat(
    clockFormats,
    `clock|${keyOf(reader)}`,
    () =>
      new Intl.DateTimeFormat(reader.locale, {
        hour: "numeric",
        minute: "2-digit",
        ...(reader.timeZone === undefined ? {} : { timeZone: reader.timeZone }),
      }),
  );
}

function dayFormat(reader: ClockReader, withYear: boolean): Intl.DateTimeFormat {
  return cachedFormat(
    dayFormats,
    `day|${String(withYear)}|${keyOf(reader)}`,
    () =>
      new Intl.DateTimeFormat(reader.locale, {
        day: "numeric",
        month: "short",
        ...(withYear ? { year: "numeric" } : {}),
        ...(reader.timeZone === undefined ? {} : { timeZone: reader.timeZone }),
      }),
  );
}

function dayKeyFormat(reader: ClockReader): Intl.DateTimeFormat {
  return cachedFormat(
    dayKeyFormats,
    `day-key|${keyOf(reader)}`,
    () =>
      new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...(reader.timeZone === undefined ? {} : { timeZone: reader.timeZone }),
      }),
  );
}

function localDay(
  value: Date,
  reader: ClockReader,
): { readonly key: string; readonly year: string } {
  const parts = dayKeyFormat(reader).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((held) => held.type === type)?.value ?? "";
  const year = part("year");
  return { key: `${year}-${part("month")}-${part("day")}`, year };
}

function cachedFormat(
  formats: Map<string, Intl.DateTimeFormat>,
  key: string,
  create: () => Intl.DateTimeFormat,
): Intl.DateTimeFormat {
  const held = formats.get(key);
  if (held !== undefined) {
    return held;
  }
  const format = create();
  formats.set(key, format);
  return format;
}

function keyOf(reader: ClockReader): string {
  return `${reader.locale ?? ""}|${reader.timeZone ?? ""}`;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
