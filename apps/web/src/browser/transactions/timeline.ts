import { formatCalendarDate, formatClockTime } from "#browser/shared-ui/formatTime.ts";
import type {
  TransactionProposalItemView,
  TransactionProposalSetSummaryView,
  TransactionRunTiming,
} from "#contracts/connections/transactionContract.ts";

type TimelineTeam = TransactionProposalSetSummaryView["teams"][number]["team"];

export type TimelineMove = {
  readonly key: string;
  readonly set: string;
  readonly item: TransactionProposalItemView;
  readonly effectiveRule?: TransactionRunTiming;
};

export type TimelineTeamDay = {
  readonly key: string;
  readonly team: TimelineTeam;
  readonly today?: string;
  readonly runDate?: string;
  readonly triggerAt?: string;
  readonly timeZone?: string;
  readonly startsToday?: true;
  readonly moves: ReadonlyArray<TimelineMove>;
};

export type TimelineDay = {
  readonly key: string;
  readonly date?: string;
  readonly teams: ReadonlyArray<TimelineTeamDay>;
};

export type TimelineEarlierEntry = {
  readonly key: string;
  readonly set: string;
  readonly team: TimelineTeam;
  readonly updatedAt: string;
  readonly item: TransactionProposalItemView;
};

export type TransactionTimeline = {
  readonly today: TimelineDay;
  readonly future: ReadonlyArray<TimelineDay>;
  readonly earlier: ReadonlyArray<TimelineEarlierEntry>;
};

export function buildTimeline(
  openSets: ReadonlyArray<TransactionProposalSetSummaryView>,
  endedSets: ReadonlyArray<TransactionProposalSetSummaryView>,
): TransactionTimeline {
  const cards = new Map<string, MutableTeamDay>();
  const earlier: Array<TimelineEarlierEntry> = [];
  const earlierIds = new Set<string>();

  for (const set of openSets) {
    for (const entry of set.teams) {
      const byId = new Map(entry.items.map((item) => [item.id, item] as const));
      const openIds = new Set<string>();
      for (const group of entry.groups ?? groupsFromItems(entry.items, entry.today)) {
        const startsToday =
          group.date === undefined || (entry.today !== undefined && group.date === entry.today);
        const runDate = startsToday ? undefined : group.date;
        const key = `${entry.team.id}:${runDate ?? "today"}`;
        for (const id of group.items) {
          const item = byId.get(id);
          if (item === undefined) {
            throw new Error(`A run day names a move outside its team: ${id}`);
          }
          if (!isOpen(item)) {
            continue;
          }
          openIds.add(item.id);
          let card = cards.get(key);
          if (card === undefined) {
            card = createCard(key, entry, group, startsToday);
            cards.set(key, card);
          }
          card.moves.push({
            key: item.id,
            set: set.id,
            item,
            ...(group.effectiveRule === undefined ? {} : { effectiveRule: group.effectiveRule }),
          });
        }
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

  const todayTeams = [...cards.values()]
    .filter((card) => card.startsToday === true)
    .sort(compareTeamNames);
  return {
    today: { key: "today", teams: todayTeams },
    future: futureDays([...cards.values()].filter((card) => card.startsToday !== true)),
    earlier,
  };
}

export function dayMoveTotal(day: TimelineDay): number {
  return day.teams.reduce((total, card) => total + card.moves.length, 0);
}

export function dayMoves(day: TimelineDay): ReadonlyArray<TimelineMove> {
  return day.teams.flatMap((card) => card.moves);
}

export function runTimeLine(card: TimelineTeamDay): string | undefined {
  if (card.runDate === undefined) {
    return undefined;
  }
  const day = formatCalendarDate(card.runDate);
  if (card.triggerAt === undefined) {
    return `Runs ${day}.`;
  }
  const clock =
    card.timeZone === undefined
      ? formatClockTime(card.triggerAt)
      : `${formatClockTime(card.triggerAt, { timeZone: card.timeZone })} ${zoneName(card.triggerAt, card.timeZone)}`;
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

function createCard(
  key: string,
  entry: TransactionProposalSetSummaryView["teams"][number],
  group: TimelineDaySource,
  startsToday: boolean,
): MutableTeamDay {
  return {
    key,
    team: entry.team,
    ...(entry.today === undefined ? {} : { today: entry.today }),
    ...(group.date === undefined || startsToday ? {} : { runDate: group.date }),
    ...(group.triggerAt === undefined ? {} : { triggerAt: group.triggerAt }),
    ...(group.timeZone === undefined ? {} : { timeZone: group.timeZone }),
    ...(startsToday ? { startsToday: true } : {}),
    moves: [],
  };
}

function futureDays(cards: ReadonlyArray<TimelineTeamDay>): ReadonlyArray<TimelineDay> {
  const byDate = new Map<string, Array<TimelineTeamDay>>();
  for (const card of cards) {
    if (card.runDate === undefined) {
      continue;
    }
    const current = byDate.get(card.runDate) ?? [];
    current.push(card);
    byDate.set(card.runDate, current);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, teams]) => ({
      key: date,
      date,
      teams: teams.sort(compareTeamNames),
    }));
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

function compareTeamNames(left: TimelineTeamDay, right: TimelineTeamDay): number {
  return left.team.name.localeCompare(right.team.name);
}

function zoneName(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(value));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

type MutableTeamDay = TimelineTeamDay & {
  moves: Array<TimelineMove>;
};

type TimelineDaySource = {
  readonly date?: string;
  readonly triggerAt?: string;
  readonly timeZone?: string;
  readonly effectiveRule?: TransactionRunTiming;
  readonly items: ReadonlyArray<string>;
};
