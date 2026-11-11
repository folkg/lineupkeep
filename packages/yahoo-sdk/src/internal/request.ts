import type { YahooCoverage } from "#yahoo/keys.ts";

import type { YahooStatQuery } from "./player.ts";
import type { RecentFormWindow } from "./recentForm.ts";
import { recentFormSpec } from "./recentForm.ts";

export function coverageSuffix(coverage: YahooCoverage | undefined): string {
  return coverage === undefined
    ? ""
    : coverage.type === "week"
      ? `;week=${String(coverage.week)}`
      : `;date=${coverage.date}`;
}

export function statsQueryOf(query: YahooStatQuery): Readonly<Record<string, string>> {
  switch (query.type) {
    case "season":
      return { "stats.type": "season" };
    case "week":
      return { "stats.type": "week", "stats.week": String(query.week) };
    case "date":
      return { "stats.type": "date", "stats.date": query.date };
  }
}

export function searchSortFragment(
  sort: string,
  statType: "season" | "week",
  statId: number | undefined,
  recentWindow: RecentFormWindow | undefined,
): string {
  if (sort === "recent_rank") {
    if (recentWindow === undefined) {
      throw new Error("A recent-rank sort needs a window.");
    }
    const window = recentFormSpec(recentWindow);
    return `sort=${window.sort}${
      window.sortType === undefined ? "" : `;sort_type=${window.sortType}`
    }`;
  }
  switch (sort) {
    case "name":
    case "position":
      return "sort=NAME";
    case "ownership":
      return "sort=R_PO";
    case "actual_rank":
      return `sort=AR;sort_type=${statType}`;
    case "overall_rank":
      return `sort=OR;sort_type=${statType}`;
    case "stat":
      if (statId === undefined) {
        throw new Error("A stat sort needs a stat id.");
      }
      return `sort=${String(statId)};sort_type=${statType}`;
    default:
      return "sort=NAME";
  }
}
