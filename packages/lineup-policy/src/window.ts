import { periodKey } from "./period.ts";
import type { Period } from "./types.ts";

export const trailingPeriodCount = 4;

export function trailingWindow(
  completedPeriods: ReadonlyArray<Period>,
  length: number = trailingPeriodCount,
): ReadonlyArray<Period> {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new Error("A trailing window needs a positive whole number of periods.");
  }
  const ordered = orderedPeriods(completedPeriods);
  return ordered.slice(Math.max(0, ordered.length - length));
}

function orderedPeriods(periods: ReadonlyArray<Period>): ReadonlyArray<Period> {
  const kinds = new Set(periods.map((period) => period.kind));
  if (kinds.size > 1) {
    throw new Error("A trailing window cannot mix weekly and dated periods.");
  }
  return [...periods].sort((left, right) => {
    if (left.kind === "week" && right.kind === "week") {
      return left.week - right.week;
    }
    if (left.kind === "date" && right.kind === "date") {
      return left.date.localeCompare(right.date);
    }
    throw new Error(`Periods ${periodKey(left)} and ${periodKey(right)} are not comparable.`);
  });
}
