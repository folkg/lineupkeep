import { expect, it } from "vitest";

import {
  buildClientErrorReport,
  buildSlowInteractionReport,
  createSendBudget,
  parseTraceId,
} from "./telemetry";

it("classifies a client error without reading arbitrary exception text", () => {
  const error = new Error("private-client-message", { cause: new Error("private-client-cause") });
  error.name = "private-client-name";

  const report = buildClientErrorReport(
    error,
    { ownerPath: ["<App>", "<NotesPage>"], boundaryPath: ["<App>", "<Errored>"] },
    { pathname: "/notes" },
    "0af7651916cd43dd8448eb211c80319c",
  );

  expect(report).toEqual({
    kind: "client_error",
    message: "ui.boundary_caught",
    thrownIn: "<App> › <NotesPage>",
    caughtBy: "<App> › <Errored>",
    pathname: "/notes",
    clientTraceId: "0af7651916cd43dd8448eb211c80319c",
  });
  expect(JSON.stringify(report)).not.toContain("private-");
});

it("classifies thrown values without invoking custom serialization", () => {
  const error = {
    toString: () => {
      throw new Error("must not serialize exceptions");
    },
  };

  const report = buildClientErrorReport(error, {}, { pathname: "/" }, undefined);

  expect(report).toMatchObject({ kind: "client_error", message: "ui.boundary_caught" });
});

it("builds a slow interaction report from holds", () => {
  const event = {
    name: "click",
    target: 'button#save "Save"',
    settledMs: 840,
    holds: [
      {
        blockers: ["saveNote"],
        holdMs: 812,
        acknowledgements: [],
      },
    ],
  };

  const report = buildSlowInteractionReport(event);

  expect(report).toEqual({
    kind: "slow_interaction",
    name: "click",
    target: 'button#save "Save"',
    settledMs: 840,
    holds: [{ blockers: "saveNote", holdMs: 812, acknowledged: false }],
  });
});

it("limits reports per window", () => {
  let now = 0;
  const budget = createSendBudget(2, 60_000, () => now);

  const first = budget.take();
  const second = budget.take();
  const third = budget.take();
  now = 60_001;
  const afterWindow = budget.take();

  expect([first, second, third, afterWindow]).toEqual([true, true, false, true]);
});

it("parses trace ids from traceparent values", () => {
  const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

  const parsed = parseTraceId(traceparent);
  const missing = parseTraceId(undefined);
  const malformed = parseTraceId("not-a-traceparent");

  expect(parsed).toBe("0af7651916cd43dd8448eb211c80319c");
  expect(missing).toBeUndefined();
  expect(malformed).toBeUndefined();
});
