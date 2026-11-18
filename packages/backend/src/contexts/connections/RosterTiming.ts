import { DateTime } from "effect";

import type { ProviderLeagueSettings, ProviderRosterCoverage } from "./Provider.ts";

function rosterChangeDate(timing: RosterChangeTiming): string | undefined {
  return effectiveDateOf(timing.rule, timing.currentDate) ?? timing.currentDate;
}

export function rosterCoverageOf(
  league: Pick<ProviderLeagueSettings, "rosterCoverage" | "periodWindow" | "rosterChange"> & {
    readonly currentDate: string | undefined;
  },
): ProviderRosterCoverage | undefined {
  if (league.rosterCoverage === "week") {
    const week = league.periodWindow?.current;
    return week === undefined ? undefined : { type: "week", week };
  }
  const date = rosterChangeDate({
    rule: league.rosterChange?.rule,
    currentDate: league.currentDate,
  });
  return date === undefined ? undefined : { type: "date", date };
}

function effectiveDateOf(
  rule: RosterChangeRule | undefined,
  currentDate: string | undefined,
): string | undefined {
  switch (rule) {
    case "same_day":
      return currentDate;
    case "next_day":
      return currentDate === undefined ? undefined : nextCalendarDate(currentDate);
    case "weekly_lock":
    case undefined:
      return undefined;
  }
}

type RosterChangeTiming = {
  readonly rule: RosterChangeRule | undefined;
  readonly currentDate: string | undefined;
};

type RosterChangeRule = "same_day" | "next_day" | "weekly_lock";

function nextCalendarDate(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    return undefined;
  }
  const parsed = DateTime.makeUnsafe(`${date}T00:00:00.000Z`);
  return DateTime.formatIsoDate(DateTime.add(parsed, { days: 1 }));
}
