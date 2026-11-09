import type { YahooCoverage } from "#yahoo/keys.ts";

import type { YahooStatQuery } from "./player.ts";

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

export function searchSortToken(sort: string, statId: number | undefined): string {
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
    default:
      return "NAME";
  }
}
