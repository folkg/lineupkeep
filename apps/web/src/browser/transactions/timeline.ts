import { formatCalendarDate, formatClockTime } from "#browser/shared-ui/formatTime.ts";
import type {
  TransactionProposalItemView,
  TransactionProposalSetSummaryView,
  TransactionRunTiming,
} from "#contracts/connections/transactionContract.ts";

type TimelineTeam = TransactionProposalSetSummaryView["teams"][number]["team"];

export type TimelineGroup = {
  readonly key: string;
  readonly set: string;
  readonly team: TimelineTeam;
  readonly today?: string;
  readonly runDate?: string;
  readonly triggerAt?: string;
  readonly timeZone?: string;
  readonly effectiveRule?: TransactionRunTiming;
  readonly startsToday?: true;
  readonly items: ReadonlyArray<TransactionProposalItemView>;
};

export type TimelineFutureDay = {
  readonly date: string;
  readonly groups: ReadonlyArray<TimelineGroup>;
};

export type TimelineEarlierEntry = {
  readonly key: string;
  readonly set: string;
  readonly team: TimelineTeam;
  readonly updatedAt: string;
  readonly item: TransactionProposalItemView;
};

export type TransactionTimeline = {
  readonly today: ReadonlyArray<TimelineGroup>;
  readonly future: ReadonlyArray<TimelineFutureDay>;
  readonly earlier: ReadonlyArray<TimelineEarlierEntry>;
};

export function buildTimeline(
  openSets: ReadonlyArray<TransactionProposalSetSummaryView>,
  endedSets: ReadonlyArray<TransactionProposalSetSummaryView>,
): TransactionTimeline {
  const groups: Array<TimelineGroup> = [];
  const earlier: Array<TimelineEarlierEntry> = [];
  const earlierIds = new Set<string>();

  for (const set of openSets) {
    for (const entry of set.teams) {
      const byId = new Map(entry.items.map((item) => [item.id, item] as const));
      const openIds = new Set<string>();
      for (const group of entry.groups ?? groupsFromItems(entry.items, entry.today)) {
        const items = group.items.flatMap((id) => {
          const item = byId.get(id);
          if (item === undefined) {
            throw new Error(`A run day names a move outside its team: ${id}`);
          }
          return isOpen(item) ? [item] : [];
        });
        if (items.length === 0) {
          continue;
        }
        for (const item of items) {
          openIds.add(item.id);
        }
        const startsToday =
          group.date === undefined || (entry.today !== undefined && group.date === entry.today);
        groups.push({
          key: `${set.id}:${entry.team.id}:${group.date ?? "today"}`,
          set: set.id,
          team: entry.team,
          ...(entry.today === undefined ? {} : { today: entry.today }),
          ...(group.date === undefined ? {} : { runDate: group.date }),
          ...(group.triggerAt === undefined ? {} : { triggerAt: group.triggerAt }),
          ...(group.timeZone === undefined ? {} : { timeZone: group.timeZone }),
          ...(group.effectiveRule === undefined ? {} : { effectiveRule: group.effectiveRule }),
          ...(startsToday ? { startsToday: true } : {}),
          items,
        });
      }
      for (const item of entry.items) {
        if (isOpen(item) && !openIds.has(item.id)) {
          throw new Error(`An open move is missing from its run day: ${item.id}`);
        }
        addEarlier(set, entry, item, earlier, earlierIds);
      }
    }
  }

  for (const set of endedSets) {
    for (const entry of set.teams) {
      for (const item of entry.items) {
        addEarlier(set, entry, item, earlier, earlierIds);
      }
    }
  }

  return {
    today: groups.filter((group) => group.startsToday === true),
    future: futureDays(groups.filter((group) => group.startsToday !== true)),
    earlier,
  };
}

export function moveTotal(groups: ReadonlyArray<TimelineGroup>): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

export function runTimeLine(group: TimelineGroup): string | undefined {
  if (group.runDate === undefined) {
    return undefined;
  }
  const day = formatCalendarDate(group.runDate);
  if (group.triggerAt === undefined) {
    return `Runs ${day}.`;
  }
  const clock =
    group.timeZone === undefined
      ? formatClockTime(group.triggerAt)
      : `${formatClockTime(group.triggerAt, { timeZone: group.timeZone })} ${zoneName(group.triggerAt, group.timeZone)}`;
  return `Runs ${day} at ${clock}.`;
}

export function effectiveDateLine(
  item: TransactionProposalItemView,
  rule: TransactionRunTiming | undefined,
): string | undefined {
  if (item.effectiveDate !== undefined) {
    return `Takes effect ${formatCalendarDate(item.effectiveDate)}.`;
  }
  switch (rule) {
    case "same_day":
      return "Takes effect the day it runs.";
    case "next_day":
      return "Takes effect the next day.";
    case "weekly_lock":
      return "Takes effect in the league's scoring week.";
    case "not_published":
      return "The league does not publish when this takes effect.";
    case undefined:
      return undefined;
  }
}

export function nextRunDate(today: string): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isOpen(item: TransactionProposalItemView): boolean {
  return item.state === "proposed" && !item.settled;
}

function futureDays(groups: ReadonlyArray<TimelineGroup>): ReadonlyArray<TimelineFutureDay> {
  const byDate = new Map<string, Array<TimelineGroup>>();
  for (const group of groups) {
    if (group.runDate === undefined) {
      continue;
    }
    const current = byDate.get(group.runDate) ?? [];
    current.push(group);
    byDate.set(group.runDate, current);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entries]) => ({ date, groups: entries }));
}

function groupsFromItems(
  items: ReadonlyArray<TransactionProposalItemView>,
  today: string | undefined,
): ReadonlyArray<TimelineDaySource> {
  const byDate = new Map<string, Array<string>>();
  for (const item of items) {
    const date =
      item.window !== undefined && (today === undefined || item.window > today)
        ? item.window
        : (today ?? "");
    const current = byDate.get(date) ?? [];
    current.push(item.id);
    byDate.set(date, current);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, ids]) => ({
      ...(date === "" ? {} : { date }),
      items: ids,
    }));
}

type TimelineDaySource = {
  readonly date?: string;
  readonly triggerAt?: string;
  readonly timeZone?: string;
  readonly effectiveRule?: TransactionRunTiming;
  readonly items: ReadonlyArray<string>;
};

function addEarlier(
  set: TransactionProposalSetSummaryView,
  entry: TransactionProposalSetSummaryView["teams"][number],
  item: TransactionProposalItemView,
  earlier: Array<TimelineEarlierEntry>,
  seen: Set<string>,
): void {
  if (isOpen(item) || seen.has(item.id)) {
    return;
  }
  seen.add(item.id);
  earlier.push({
    key: item.id,
    set: set.id,
    team: entry.team,
    updatedAt: set.updatedAt,
    item,
  });
}

function zoneName(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(value));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}
