import type { RecentFormWindow, StatWindow } from "./Provider.ts";

export function statWindowDays(window: StatWindow): number | undefined {
  switch (window.kind) {
    case "last_days":
      return window.days;
    case "last_weeks":
      return window.weeks * 7;
    case "season":
    case "week":
    case "range":
      return undefined;
  }
}

export function sameStatWindow(left: StatWindow, right: StatWindow): boolean {
  const leftDays = statWindowDays(left);
  const rightDays = statWindowDays(right);
  if (leftDays !== undefined || rightDays !== undefined) {
    return leftDays !== undefined && rightDays !== undefined && leftDays === rightDays;
  }
  switch (left.kind) {
    case "season":
      return right.kind === "season";
    case "week":
      return right.kind === "week" && left.week === right.week;
    case "range":
      return right.kind === "range" && left.start === right.start && left.end === right.end;
    case "last_days":
    case "last_weeks":
      return false;
  }
}

export function nearestStatWindow(
  requested: StatWindow,
  supported: ReadonlyArray<RecentFormWindow>,
): RecentFormWindow | undefined {
  const requestedDays = statWindowDays(requested);
  if (requestedDays === undefined || supported.length === 0) {
    return undefined;
  }
  return supported.reduce((nearest, candidate) => {
    const days = statWindowDays(candidate) ?? 0;
    const nearestDays = statWindowDays(nearest) ?? 0;
    const distance = Math.abs(days - requestedDays);
    const nearestDistance = Math.abs(nearestDays - requestedDays);
    if (distance !== nearestDistance) {
      return distance < nearestDistance ? candidate : nearest;
    }
    return days > nearestDays ? candidate : nearest;
  });
}

export function describeStatWindow(window: StatWindow): string {
  switch (window.kind) {
    case "season":
      return "the season";
    case "week":
      return `scoring week ${String(window.week)}`;
    case "last_days":
      return window.days === 1 ? "the last day" : `the last ${String(window.days)} days`;
    case "last_weeks":
      return window.weeks === 1 ? "the last week" : `the last ${String(window.weeks)} weeks`;
    case "range":
      return `${window.start} to ${window.end}`;
  }
}

export function statWindowKey(window: StatWindow): string {
  switch (window.kind) {
    case "season":
      return "season";
    case "week":
      return `week:${String(window.week)}`;
    case "last_days":
      return `last_days:${String(window.days)}`;
    case "last_weeks":
      return `last_weeks:${String(window.weeks)}`;
    case "range":
      return `range:${window.start}..${window.end}`;
  }
}
