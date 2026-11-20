import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type { ClockReader } from "#browser/shared-ui/formatTime.ts";
import type {
  TransactionMoveView,
  TransactionWaiverRuleView,
} from "#contracts/connections/transactionContract.ts";

const clockFormats = new Map<string, Intl.DateTimeFormat>();
const dayFormats = new Map<string, Intl.DateTimeFormat>();
const dayKeyFormats = new Map<string, Intl.DateTimeFormat>();

export function plannedMoment(
  value: string | Date,
  reader: ClockReader = {},
  now: Date = new Date(),
): string {
  return formatDatedMoment(value, reader, now);
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

export function timingLine(
  move: TransactionMoveView,
  reader: ClockReader = {},
  now: Date = new Date(),
): string | undefined {
  if (move.kind === "waiver_claim" && move.phase !== "won") {
    return undefined;
  }
  if (move.effectiveDate === undefined) {
    return undefined;
  }
  if (move.result === "failed" || move.result === "skipped" || move.result === "unknown") {
    return undefined;
  }
  if (move.result === "executed") {
    return `Took effect ${formatCalendarDate(move.effectiveDate)}.`;
  }
  if (move.sendsAt !== undefined) {
    const run = plannedMoment(move.sendsAt, reader, now);
    return move.decision === "confirmed"
      ? `Runs ${withPeriod(run)} Takes effect ${formatCalendarDate(move.effectiveDate)}.`
      : `Runs ${run} if you confirm. Takes effect ${formatCalendarDate(move.effectiveDate)}.`;
  }
  return `Runs when you confirm. Takes effect ${formatCalendarDate(move.effectiveDate)}.`;
}

export function moveOutcomeLabel(move: TransactionMoveView): string | undefined {
  return moveOutcome(move)?.label;
}

export function moveOutcome(move: TransactionMoveView): MoveOutcome | undefined {
  if (move.decision === "discarded") {
    return { label: "Discarded", icon: "ban", tone: "muted" };
  }
  switch (move.phase) {
    case "with_league":
      return { label: "With the league", icon: "hourglass", tone: "muted" };
    case "won":
      return { label: "Claim won", icon: "badge-check", tone: "action" };
    case "lost":
      return move.result === "executed"
        ? { label: "Claim lost, fallback ran", icon: "iteration-ccw", tone: "action" }
        : move.result === "failed"
          ? { label: "All choices failed", icon: "x", tone: "danger" }
          : { label: "Claim lost", icon: "circle-slash", tone: "muted" };
    case undefined:
      break;
  }
  switch (move.result) {
    case "executed":
      return move.runDecidedBy === "system"
        ? { label: "Ran on schedule", icon: "clock-check", tone: "action" }
        : { label: "Ran immediately", icon: "check", tone: "action" };
    case "pending":
      return { label: "Waiting for the league", icon: "hourglass", tone: "muted" };
    case "failed":
      return { label: "Failed", icon: "x", tone: "danger" };
    case "skipped":
      return { label: "Skipped", icon: "skip-forward", tone: "muted" };
    case "unknown":
      return { label: "Unknown outcome", icon: "circle-question-mark", tone: "muted" };
    case "withdrawn":
      return { label: "Withdrawn", icon: "undo-2", tone: "muted" };
    case "expired":
      return { label: "Expired", icon: "timer-off", tone: "muted" };
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
  reader: ClockReader = {},
  now: Date = new Date(),
): string | undefined {
  if (move.confirmation === undefined) {
    return undefined;
  }
  const at = formatDatedMoment(move.confirmation.at, reader, now);
  if (move.decision === "confirmed" && move.sendsAt !== undefined) {
    return `Scheduled on ${at} to run ${withPeriod(plannedMoment(move.sendsAt, reader, now))}`;
  }
  return `You submitted this on ${at}.`;
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

function withPeriod(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
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

export type MoveOutcomeIcon =
  | "badge-check"
  | "ban"
  | "check"
  | "circle-question-mark"
  | "circle-slash"
  | "clock-check"
  | "hourglass"
  | "iteration-ccw"
  | "skip-forward"
  | "timer-off"
  | "undo-2"
  | "x";

export type MoveOutcome = {
  readonly label: string;
  readonly icon: MoveOutcomeIcon;
  readonly tone: "action" | "danger" | "muted";
};
