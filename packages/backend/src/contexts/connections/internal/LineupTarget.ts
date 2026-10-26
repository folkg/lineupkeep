import { DateTime, Schema } from "effect";

import type { FantasyDayPolicy } from "#contexts/connections/FantasyDay.ts";
import { fantasyDayLabel } from "#contexts/connections/FantasyDay.ts";
import { LineupTargetPeriod } from "#contexts/connections/LineupRun.ts";
import type { ProviderLeagueSettings } from "#contexts/connections/Provider.ts";

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
  policy: FantasyDayPolicy,
  now: DateTime.Utc,
): TargetResolution {
  switch (league.rosterCoverage) {
    case "week":
      return resolveWeekTarget(requested, league);
    case "date":
      return resolveDateTarget(requested, league, fantasyDayLabel(now, policy));
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
        "The provider publishes no scoring-week window for this league, so a scoring week cannot be resolved.",
    };
  }
  const week = requested.coverage === "current" ? window.currentWeek : requested.week;
  if (week < window.startWeek || week > window.endWeek) {
    return {
      status: "blocked",
      reason: "outside_season",
      detail: `Week ${String(week)} is outside the league's declared scoring range (weeks ${String(window.startWeek)} to ${String(window.endWeek)}).`,
    };
  }
  if (week !== window.currentWeek) {
    return {
      status: "blocked",
      reason: "stale_period",
      detail: `Week ${String(week)} is not the provider's current scoring week (week ${String(window.currentWeek)}).`,
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
      detail: `The provider's fantasy day ${date} is outside the league's declared season (${seasonRange(league)}).`,
    };
  }
  if (date !== today) {
    return {
      status: "blocked",
      reason: "stale_period",
      detail: `Date ${date} is not the provider's current fantasy day (${today}).`,
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
