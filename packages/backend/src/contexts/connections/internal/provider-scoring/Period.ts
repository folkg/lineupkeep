import { dual } from "effect/Function";

import type { Period } from "./types.ts";

export function periodKey(period: Period): string {
  return period.kind === "week" ? `week:${String(period.week)}` : `date:${period.date}`;
}

export const periodsEqual: {
  (right: Period): (left: Period) => boolean;
  (left: Period, right: Period): boolean;
} = dual(2, (left: Period, right: Period): boolean => periodKey(left) === periodKey(right));
