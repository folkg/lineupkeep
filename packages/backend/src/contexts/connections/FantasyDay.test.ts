import { env } from "node:process";

import { assert, it } from "@effect/vitest";
import { DateTime } from "effect";

import { fantasyDayPolicy, nextFantasyDayBoundary } from "./FantasyDay.ts";

const policy = fantasyDayPolicy("yahoo", "nfl");

it("expires at the next Pacific midnight rather than a fixed offset", () => {
  const beforeMidnight = nextFantasyDayBoundary(
    DateTime.makeUnsafe("2026-10-25T06:59:59Z"),
    policy,
  );
  const boundary = nextFantasyDayBoundary(DateTime.makeUnsafe("2026-10-25T07:00:00Z"), policy);

  assert.strictEqual(DateTime.formatIso(beforeMidnight), "2026-10-25T07:00:00.000Z");
  assert.strictEqual(DateTime.formatIso(boundary), "2026-10-26T07:00:00.000Z");
});

it("uses 23-hour and 25-hour calendar days across both DST transitions", () => {
  const springStart = DateTime.makeUnsafe("2026-03-08T08:00:00Z");
  const springEnd = nextFantasyDayBoundary(springStart, policy);
  const autumnStart = DateTime.makeUnsafe("2026-11-01T07:00:00Z");
  const autumnEnd = nextFantasyDayBoundary(autumnStart, policy);

  assert.strictEqual(
    (DateTime.toEpochMillis(springEnd) - DateTime.toEpochMillis(springStart)) / 3_600_000,
    23,
  );
  assert.strictEqual(
    (DateTime.toEpochMillis(autumnEnd) - DateTime.toEpochMillis(autumnStart)) / 3_600_000,
    25,
  );
});

it("is independent of the server and user process timezone", () => {
  const now = DateTime.makeUnsafe("2026-11-01T08:30:00Z");
  const original = env["TZ"];
  try {
    env["TZ"] = "Asia/Tokyo";
    const tokyo = nextFantasyDayBoundary(now, policy);
    env["TZ"] = "Europe/Berlin";
    const berlin = nextFantasyDayBoundary(now, policy);
    env["TZ"] = "UTC";
    const utc = nextFantasyDayBoundary(now, policy);

    assert.strictEqual(DateTime.formatIso(tokyo), "2026-11-02T08:00:00.000Z");
    assert.strictEqual(DateTime.formatIso(berlin), DateTime.formatIso(tokyo));
    assert.strictEqual(DateTime.formatIso(utc), DateTime.formatIso(tokyo));
  } finally {
    if (original === undefined) {
      delete env["TZ"];
    } else {
      env["TZ"] = original;
    }
  }
});
