import type { Period } from "./types.ts";

export function periodKey(period: Period): string {
  return period.kind === "week" ? `week:${String(period.week)}` : `date:${period.date}`;
}

export function periodsEqual(left: Period, right: Period): boolean {
  return periodKey(left) === periodKey(right);
}
