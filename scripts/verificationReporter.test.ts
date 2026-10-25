import { expect, it } from "vitest";

import { verificationVerdict } from "#e2e/verify/reporter.ts";

it("does not call an expected test failure a verified behavior", () => {
  const attempts = [{ status: "failed", expectedStatus: "failed" }] as const;

  const verdict = verificationVerdict("passed", 1, attempts);

  expect(verdict).toBe("failed");
});

it.each([
  { label: "no selected tests", planned: 0, attempts: [] },
  {
    label: "a skipped test",
    planned: 1,
    attempts: [{ status: "skipped", expectedStatus: "skipped" }],
  },
  {
    label: "incomplete coverage",
    planned: 2,
    attempts: [{ status: "passed", expectedStatus: "passed" }],
  },
])("reports $label as blocked rather than passed", ({ planned, attempts }) => {
  const verdict = verificationVerdict("passed", planned, attempts);

  expect(verdict).toBe("blocked");
});

it("reports startup failure as blocked when no assertions ran", () => {
  const verdict = verificationVerdict("failed", 1, []);

  expect(verdict).toBe("blocked");
});

it("reports completed passing assertions as passed", () => {
  const attempts = [{ status: "passed", expectedStatus: "passed" }];

  const verdict = verificationVerdict("passed", 1, attempts);

  expect(verdict).toBe("passed");
});
