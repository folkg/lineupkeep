import { expect, it } from "vitest";

import { describePlan, parsePlanLog } from "#e2e/verify/databaseActivity.ts";

it("reads statement plans from PostgreSQL's JSON log and ignores other entries", () => {
  const explained = {
    "Query Text": "select * from note where owner = $1 order by title limit 20",
    Plan: {
      "Node Type": "Limit",
      "Actual Rows": 20,
      "Shared Hit Blocks": 6,
      Plans: [
        {
          "Node Type": "Sort",
          Plans: [{ "Node Type": "Seq Scan", "Relation Name": "note" }],
        },
      ],
    },
  };
  const lines = [
    JSON.stringify({ message: "database system is ready to accept connections" }),
    JSON.stringify({ message: `duration: 0.512 ms  plan:\n${JSON.stringify(explained)}` }),
    "",
  ].join("\n");

  const plans = parsePlanLog(lines);

  expect(plans).toEqual([
    expect.objectContaining({
      query: "select * from note where owner = $1 order by title limit 20",
      durationMs: 0.5,
      plan: "Limit → Sort → Seq Scan on note",
      rows: 20,
      sharedBlocksHit: 6,
      sequentialScans: ["note"],
    }),
  ]);
  expect(
    describePlan({
      "Node Type": "Index Scan",
      "Index Name": "note_owner",
      "Relation Name": "note",
    }),
  ).toBe("Index Scan using note_owner on note");
});
