import { DateTime, Schema } from "effect";

import { fantasyDayLabel } from "#contexts/connections/FantasyDay.ts";
import { LineupTargetPeriod } from "#contexts/connections/LineupRun.ts";
import type { ProviderFantasyDay, ProviderLeagueSettings } from "#contexts/connections/Provider.ts";

export type TargetResolution =
  | { readonly status: "resolved"; readonly target: LineupTargetPeriod }
  | {
      readonly status: "blocked";
      readonly reason:
        | "unsupported_period"
        | "stale_period"
        | "outside_season"
        | "no_period_window";
      readonly detail: string;
    };

export function resolveTarget(
  requested: LineupTargetPeriod,
  league: ProviderLeagueSettings,
  fantasyDay: ProviderFantasyDay,
  now: DateTime.Utc,
): TargetResolution {
  switch (league.rosterCoverage) {
    case "week":
      return resolveWeekTarget(requested, league);
    case "date":
      return resolveDateTarget(requested, league, fantasyDayLabel(now, fantasyDay));
  }
}

function resolveWeekTarget(
  requested: LineupTargetPeriod,
  league: ProviderLeagueSettings,
): TargetResolution {
  const window = league.periodWindow;
  if (requested.coverage === "date") {
    return unsupportedPeriod("scoring week");
  }
  if (window === undefined) {
    return {
      status: "blocked",
      reason: "no_period_window",
      detail:
        "Your league publishes no scoring-week window for this league, so a scoring week cannot be resolved.",
    };
  }
  const week = requested.coverage === "current" ? window.current : requested.week;
  if (week < window.start || week > window.end) {
    return {
      status: "blocked",
      reason: "outside_season",
      detail: `Week ${String(week)} is outside the league's declared scoring range (weeks ${String(window.start)} to ${String(window.end)}).`,
    };
  }
  if (week !== window.current) {
    return {
      status: "blocked",
      reason: "stale_period",
      detail: `Week ${String(week)} is not the current scoring week at your league (week ${String(window.current)}).`,
    };
  }
  return { status: "resolved", target: { coverage: "week", week } };
}

function resolveDateTarget(
  requested: LineupTargetPeriod,
  league: ProviderLeagueSettings,
  today: string,
): TargetResolution {
  if (requested.coverage === "week") {
    return unsupportedPeriod("date");
  }
  const date = requested.coverage === "current" ? today : requested.date;
  if (!withinSeason(league, date)) {
    return {
      status: "blocked",
      reason: "outside_season",
      detail: `The fantasy day at your league ${date} is outside the league's declared season (${seasonRange(league)}).`,
    };
  }
  if (date !== today) {
    return {
      status: "blocked",
      reason: "stale_period",
      detail: `Date ${date} is not the current fantasy day at your league (${today}).`,
    };
  }
  return {
    status: "resolved",
    target: Schema.decodeSync(LineupTargetPeriod)({ coverage: "date", date }),
  };
}

function unsupportedPeriod(scopedBy: "scoring week" | "date"): TargetResolution {
  return {
    status: "blocked",
    reason: "unsupported_period",
    detail: `This league's roster is scoped by ${scopedBy}, so the requested period cannot be resolved.`,
  };
}

function withinSeason(league: ProviderLeagueSettings, date: string): boolean {
  return (
    (league.startDate === undefined || date >= league.startDate) &&
    (league.endDate === undefined || date <= league.endDate)
  );
}

function seasonRange(league: ProviderLeagueSettings): string {
  return league.startDate === undefined || league.endDate === undefined
    ? "not published"
    : `${league.startDate} to ${league.endDate}`;
}
