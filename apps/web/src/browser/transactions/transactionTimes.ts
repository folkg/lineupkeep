import { EffectArray, EffectOption } from "@lineupkeep/collections";
import { EffectString } from "@lineupkeep/collections";

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
  if (move.kind === "waiver_claim" && move.status !== "claim_won") {
    return undefined;
  }
  if (move.effectiveDate === undefined) {
    return undefined;
  }
  switch (move.status) {
    case "ran_immediately":
    case "ran_on_schedule":
    case "claim_won":
    case "claim_lost_fallback_ran":
      return `Took effect ${formatCalendarDate(move.effectiveDate)}.`;
    case "failed":
    case "skipped":
    case "unknown":
    case "claim_lost":
    case "claim_lost_retrying":
    case "all_choices_failed":
    case "fallback_unknown":
    case "offer_sent":
    case "claim_waiting":
    case "discarded":
      return undefined;
    case "open_undecided":
    case "open_saved":
    case "open_now":
    case "open_confirmed":
      break;
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
  switch (move.status) {
    case "discarded":
      return { label: "Discarded", icon: "ban", tone: "muted" };
    case "ran_immediately":
      return { label: "Ran immediately", icon: "check", tone: "action" };
    case "ran_on_schedule":
      return { label: "Ran on schedule", icon: "clock-check", tone: "action" };
    case "claim_waiting":
      return { label: "With the league", icon: "hourglass", tone: "muted" };
    case "claim_won":
      return { label: "Claim won", icon: "badge-check", tone: "action" };
    case "claim_lost":
      return { label: "Claim lost", icon: "circle-slash", tone: "muted" };
    case "claim_lost_fallback_ran":
      return { label: "Claim lost, fallback ran", icon: "iteration-ccw", tone: "action" };
    case "claim_lost_retrying":
      return { label: "Claim lost, retrying", icon: "rotate-cw", tone: "muted" };
    case "all_choices_failed":
      return { label: "All choices failed", icon: "x", tone: "danger" };
    case "fallback_unknown":
      return { label: "Unknown outcome", icon: "circle-question-mark", tone: "muted" };
    case "offer_sent":
      return { label: "Offer sent", icon: "send-horizontal", tone: "muted" };
    case "failed":
      return { label: "Failed", icon: "x", tone: "danger" };
    case "skipped":
      return { label: "Skipped", icon: "skip-forward", tone: "muted" };
    case "unknown":
      return { label: "Unknown outcome", icon: "circle-question-mark", tone: "muted" };
    case "open_undecided":
    case "open_saved":
    case "open_now":
    case "open_confirmed":
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
  return EffectString.endsWith(text, ".") ? text : `${text}.`;
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
    EffectOption.getOrUndefined(EffectArray.findFirst(parts, (held) => held.type === type))
      ?.value ?? "";
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
  | "rotate-cw"
  | "send-horizontal"
  | "skip-forward"
  | "x";

export type MoveOutcome = {
  readonly label: string;
  readonly icon: MoveOutcomeIcon;
  readonly tone: "action" | "danger" | "muted";
};
