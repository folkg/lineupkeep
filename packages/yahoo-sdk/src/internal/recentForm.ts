import type { YahooPlayerRank } from "./player.ts";

export type RecentFormWindow =
  | { readonly type: "days"; readonly days: 7 | 14 | 30 }
  | { readonly type: "weeks"; readonly weeks: 4 };

type RecentFormSpec = {
  readonly sort: string;
  readonly sortType: string | undefined;
  readonly rankName: string;
  readonly rankType: string;
};

const specs: Readonly<Record<string, RecentFormSpec>> = {
  "days:7": { sort: "AR_L7", sortType: undefined, rankName: "last7days", rankType: "L7" },
  "days:14": { sort: "AR_L14", sortType: undefined, rankName: "last14days", rankType: "L14" },
  "days:30": { sort: "AR_L30", sortType: undefined, rankName: "last30days", rankType: "L30" },
  "weeks:4": { sort: "AR_L4W", sortType: "last4weeks", rankName: "last4weeks", rankType: "L4W" },
};

export const recentFormWindows: ReadonlyArray<RecentFormWindow> = [
  { type: "days", days: 7 },
  { type: "days", days: 14 },
  { type: "days", days: 30 },
  { type: "weeks", weeks: 4 },
];

export function recentFormSpec(window: RecentFormWindow): RecentFormSpec {
  const spec = specs[windowKey(window)];
  if (spec === undefined) {
    throw new Error("A recent-form window must name 7, 14, or 30 days or 4 weeks.");
  }
  return spec;
}

function recentFormRankType(window: RecentFormWindow): string {
  return recentFormSpec(window).rankType;
}

export function recentFormRankName(window: RecentFormWindow): string {
  return recentFormSpec(window).rankName;
}

export function recentFormRankNames(): ReadonlyArray<string> {
  return recentFormWindows.map((window) => recentFormSpec(window).rankName);
}

export function recentFormRankOf(
  ranks: ReadonlyArray<YahooPlayerRank>,
  window: RecentFormWindow,
): number | null {
  return ranks.find((rank) => rank.type === recentFormRankType(window))?.value ?? null;
}

export function publishedRecentFormWindows(
  players: ReadonlyArray<{ readonly ranks: ReadonlyArray<YahooPlayerRank> }>,
): ReadonlyArray<RecentFormWindow> {
  return recentFormWindows.filter((window) =>
    players.some((player) => recentFormRankOf(player.ranks, window) !== null),
  );
}

export function sameRecentFormWindow(left: RecentFormWindow, right: RecentFormWindow): boolean {
  return windowKey(left) === windowKey(right);
}

function windowKey(window: RecentFormWindow): string {
  return window.type === "days" ? `days:${String(window.days)}` : `weeks:${String(window.weeks)}`;
}
