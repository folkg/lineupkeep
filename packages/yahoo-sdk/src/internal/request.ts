import type { YahooCoverage } from "#yahoo/keys.ts";

import type { YahooStatQuery } from "./player.ts";

const recentSortTokens = {
  last7days: "AR_L7",
  last14days: "AR_L14",
  last30days: "AR_L30",
} as const;

export type SearchRecentWindow = keyof typeof recentSortTokens;

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

export function searchSortToken(
  sort: string,
  statId: number | undefined,
  recentWindow: SearchRecentWindow | undefined,
): string {
  switch (sort) {
    case "name":
    case "position":
      return "NAME";
    case "ownership":
      return "R_PO";
    case "actual_rank":
      return "AR";
    case "overall_rank":
      return "OR";
    case "stat":
      return String(statId);
    case "recent_rank":
      if (recentWindow === undefined) {
        throw new Error("A recent-rank sort needs a window.");
      }
      return recentSortTokens[recentWindow];
    default:
      return "NAME";
  }
}
