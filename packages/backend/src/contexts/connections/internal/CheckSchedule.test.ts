import { assert, it } from "@effect/vitest";
import { DateTime } from "effect";

import { nextCheckAt } from "./CheckSchedule.ts";

it("finds the next hourly run at the 55 minute mark", () => {
  assert.strictEqual(
    DateTime.formatIso(nextCheckAt(DateTime.makeUnsafe("2026-11-11T12:54:59.000Z"))),
    "2026-11-11T12:55:00.000Z",
  );
  assert.strictEqual(
    DateTime.formatIso(nextCheckAt(DateTime.makeUnsafe("2026-11-11T12:55:00.000Z"))),
    "2026-11-11T13:55:00.000Z",
  );
  assert.strictEqual(
    DateTime.formatIso(nextCheckAt(DateTime.makeUnsafe("2026-11-11T12:55:01.000Z"))),
    "2026-11-11T13:55:00.000Z",
  );
});
