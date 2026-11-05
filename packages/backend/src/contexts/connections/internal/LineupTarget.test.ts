import { assert, it } from "@effect/vitest";
import { DateTime, Schema } from "effect";

import { LineupTargetPeriod } from "#contexts/connections/LineupRun.ts";
import type { LineupTargetPeriod as TargetPeriod } from "#contexts/connections/LineupRun.ts";
import type { ProviderLeagueSettings } from "#contexts/connections/Provider.ts";

import { resolveTarget } from "./LineupTarget.ts";

const footballPolicy = {
  timeZone: "America/Los_Angeles",
  boundary: "local-midnight" as const,
  version: "yahoo-pacific-midnight/1",
};
const hockeyPolicy = footballPolicy;

it("resolves the provider's current scoring week for a week-scoped roster", () => {
  const resolution = resolveTarget(
    { coverage: "current" },
    footballLeague,
    footballPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.deepStrictEqual(resolution, {
    status: "resolved",
    target: { coverage: "week", week: 3 },
  });
});

it("keeps an explicit current week for a week-scoped roster", () => {
  const resolution = resolveTarget(
    { coverage: "week", week: 3 },
    footballLeague,
    footballPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.deepStrictEqual(resolution, {
    status: "resolved",
    target: { coverage: "week", week: 3 },
  });
});

it("refuses a scoring week that is not the provider's current week", () => {
  const resolution = resolveTarget(
    { coverage: "week", week: 2 },
    footballLeague,
    footballPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.strictEqual(resolution.status, "blocked");
  if (resolution.status !== "blocked") {
    return;
  }
  assert.strictEqual(resolution.reason, "stale_period");
  assert.include(resolution.detail, "week 3");
});

it("names a scoring week outside the league's declared range", () => {
  const resolution = resolveTarget(
    { coverage: "week", week: 20 },
    footballLeague,
    footballPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.strictEqual(resolution.status, "blocked");
  if (resolution.status !== "blocked") {
    return;
  }
  assert.strictEqual(resolution.reason, "outside_season");
  assert.include(resolution.detail, "weeks 1 to 17");
});

it("names a current week the league places outside its declared range", () => {
  const resolution = resolveTarget(
    { coverage: "current" },
    { ...footballLeague, periodWindow: { current: 18, start: 1, end: 17 } },
    footballPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.strictEqual(resolution.status, "blocked");
  if (resolution.status !== "blocked") {
    return;
  }
  assert.strictEqual(resolution.reason, "outside_season");
});

it("names a week-scoped league that publishes no scoring window", () => {
  const resolution = resolveTarget(
    { coverage: "current" },
    { ...footballLeague, periodWindow: undefined },
    footballPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.strictEqual(resolution.status, "blocked");
  if (resolution.status !== "blocked") {
    return;
  }
  assert.strictEqual(resolution.reason, "no_period_window");
});

it("refuses a date target for a week-scoped roster", () => {
  const resolution = resolveTarget(
    dateTarget("2026-10-25"),
    footballLeague,
    footballPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.strictEqual(resolution.status, "blocked");
  if (resolution.status !== "blocked") {
    return;
  }
  assert.strictEqual(resolution.reason, "unsupported_period");
});

it("resolves the fantasy day for a date-scoped roster with a head-to-head week window", () => {
  const resolution = resolveTarget(
    { coverage: "current" },
    hockeyLeague,
    hockeyPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.deepStrictEqual(resolution, {
    status: "resolved",
    target: dateTarget("2026-10-25"),
  });
});

it("resolves a current date without a week window instead of reporting one missing", () => {
  const resolution = resolveTarget(
    { coverage: "current" },
    { ...hockeyLeague, periodWindow: undefined, scoringType: "roto" },
    hockeyPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.deepStrictEqual(resolution, {
    status: "resolved",
    target: dateTarget("2026-10-25"),
  });
});

it("uses the league timezone rather than UTC for the fantasy day", () => {
  const resolution = resolveTarget(
    { coverage: "current" },
    hockeyLeague,
    hockeyPolicy,
    instant("2026-10-25T06:59:00Z"),
  );

  assert.deepStrictEqual(resolution, {
    status: "resolved",
    target: dateTarget("2026-10-24"),
  });
});

it("keeps an explicit date only when it is the provider's current fantasy day", () => {
  const resolution = resolveTarget(
    dateTarget("2026-10-24"),
    hockeyLeague,
    hockeyPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.strictEqual(resolution.status, "blocked");
  if (resolution.status !== "blocked") {
    return;
  }
  assert.strictEqual(resolution.reason, "stale_period");
  assert.include(resolution.detail, "2026-10-25");
});

it("names a fantasy day outside the league's declared season", () => {
  const resolution = resolveTarget(
    { coverage: "current" },
    hockeyLeague,
    hockeyPolicy,
    instant("2027-05-01T19:00:00Z"),
  );

  assert.strictEqual(resolution.status, "blocked");
  if (resolution.status !== "blocked") {
    return;
  }
  assert.strictEqual(resolution.reason, "outside_season");
  assert.include(resolution.detail, "2026-10-01 to 2027-04-10");
});

it("refuses a scoring week for a date-scoped roster", () => {
  const resolution = resolveTarget(
    { coverage: "week", week: 3 },
    hockeyLeague,
    hockeyPolicy,
    instant("2026-10-25T19:00:00Z"),
  );

  assert.strictEqual(resolution.status, "blocked");
  if (resolution.status !== "blocked") {
    return;
  }
  assert.strictEqual(resolution.reason, "unsupported_period");
});

it("crosses the spring DST transition into a 23-hour fantasy day", () => {
  assert.deepStrictEqual(currentDate("2026-03-08T07:59:00Z"), "2026-03-07");
  assert.deepStrictEqual(currentDate("2026-03-08T08:00:00Z"), "2026-03-08");
  assert.deepStrictEqual(currentDate("2026-03-09T06:59:00Z"), "2026-03-08");
  assert.deepStrictEqual(currentDate("2026-03-09T07:00:00Z"), "2026-03-09");
});

it("crosses the autumn DST transition into a 25-hour fantasy day", () => {
  assert.deepStrictEqual(currentDate("2026-11-01T06:59:00Z"), "2026-10-31");
  assert.deepStrictEqual(currentDate("2026-11-01T07:00:00Z"), "2026-11-01");
  assert.deepStrictEqual(currentDate("2026-11-02T07:59:00Z"), "2026-11-01");
  assert.deepStrictEqual(currentDate("2026-11-02T08:00:00Z"), "2026-11-02");
});

function currentDate(at: string): string {
  const resolution = resolveTarget(
    { coverage: "current" },
    longSeasonHockeyLeague,
    hockeyPolicy,
    instant(at),
  );
  if (resolution.status !== "resolved" || resolution.target.coverage !== "date") {
    throw new Error(`Expected a resolved date target for ${at}`);
  }
  return resolution.target.date;
}

function instant(value: string): DateTime.Utc {
  return DateTime.makeUnsafe(value);
}

function dateTarget(date: string): TargetPeriod {
  return Schema.decodeSync(LineupTargetPeriod)({ coverage: "date", date });
}

const footballLeague: ProviderLeagueSettings = {
  providerLeagueKey: "461.l.1000",
  name: "Football League",
  webUrl: "https://football.fantasysports.yahoo.com/f1/1000",
  season: 2026,
  periodWindow: { current: 3, start: 1, end: 17 },
  rosterCoverage: "week",
  maxGamesPlayed: undefined,
  maxInningsPitched: undefined,
  startDate: "2026-09-03",
  endDate: "2026-12-28",
  currentDate: undefined,
  teamCount: 10,
  format: "head_to_head_categories",
  scoringType: "head",
  scoringLabel: "H2H",
  weeklyDeadline: undefined,
  rosterChange: undefined,
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
  waiverDays: undefined,
  maxWeeklyAcquisitions: undefined,
  maxSeasonAcquisitions: undefined,
  tradeEndDate: undefined,
  tradeRatification: undefined,
  tradeDraftPicks: undefined,
  tradeObjectionDays: undefined,
  draftStatus: "postdraft",
  rosterPositions: [],
  statCategories: [],
  statModifiers: [],
};

const hockeyLeague: ProviderLeagueSettings = {
  ...footballLeague,
  providerLeagueKey: "465.l.2000",
  name: "Hockey League",
  webUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
  periodWindow: { current: 3, start: 1, end: 24 },
  rosterCoverage: "date",
  maxGamesPlayed: undefined,
  maxInningsPitched: undefined,
  startDate: "2026-10-01",
  endDate: "2027-04-10",
  currentDate: undefined,
};

const longSeasonHockeyLeague: ProviderLeagueSettings = {
  ...hockeyLeague,
  startDate: "2025-10-01",
};
